<?php
/**
 * Sickness reports and private medical certificates.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Sickness {

	const MAX_BYTES = 10485760; // 10 MB.

	const ALLOWED = array(
		'pdf'  => 'application/pdf',
		'jpg'  => 'image/jpeg',
		'jpeg' => 'image/jpeg',
		'png'  => 'image/png',
	);

	const CERT_STATUSES = array(
		'not_required' => 'Non richiesto',
		'missing'      => 'Certificato mancante',
		'overdue'      => 'Certificato scaduto',
		'uploaded'     => 'Certificato caricato',
		'cleared'      => 'Requisito annullato',
	);

	const KINDS = array(
		'malattia'   => 'Malattia',
		'infortunio' => 'Infortunio',
	);

	/** Label of a report kind ("Malattia" / "Infortunio"). */
	public static function kind_label( $kind ) {
		return Dolly_I18n::t( self::KINDS[ $kind ] ?? self::KINDS['malattia'] );
	}

	/** Kind with its article, for sentences: "la malattia" / "l'infortunio". */
	public static function kind_phrase( $kind ) {
		return 'infortunio' === $kind ? 'l\'infortunio' : __( 'la malattia', 'dolly-employee-management' );
	}

	/** Kind of a sickness row ("malattia" for rows created before injuries existed). */
	public static function kind_of( $s ) {
		return isset( $s->kind ) && isset( self::KINDS[ $s->kind ] ) ? $s->kind : 'malattia';
	}

	public static function get( $id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'sickness' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d", $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	public static function covers( $user_id, $date ) {
		global $wpdb;
		$t = Dolly_Install::t( 'sickness' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND status = 'active' AND start_date <= %s AND end_date >= %s LIMIT 1", $user_id, $date, $date ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	public static function range( array $user_ids, $from, $to ) {
		global $wpdb;
		if ( ! $user_ids ) {
			return array();
		}
		$t  = Dolly_Install::t( 'sickness' );
		$in = implode( ',', array_map( 'intval', $user_ids ) );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id IN ($in) AND status = 'active' AND start_date <= %s AND end_date >= %s", $to, $from ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	public static function certificates( $sickness_id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'certificates' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE sickness_id = %d ORDER BY uploaded_at ASC", $sickness_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	public static function format( $s, $with_notes = true ) {
		$certs = array();
		foreach ( self::certificates( (int) $s->id ) as $c ) {
			$certs[] = array(
				'id'            => (int) $c->id,
				'original_name' => $c->original_name,
				'size'          => (int) $c->size_bytes,
				'uploaded_at'   => Dolly_Time::iso( $c->uploaded_at ),
				'download_url'  => rest_url( DOLLY_REST_NS . '/certificates/' . (int) $c->id . '/download' ),
			);
		}
		return array(
			'id'                 => (int) $s->id,
			'user_id'            => (int) $s->user_id,
			'employee'           => Dolly_Employees::sort_name( (int) $s->user_id ),
			'kind'               => self::kind_of( $s ),
			'kind_label'         => self::kind_label( self::kind_of( $s ) ),
			'reported_by_admin'  => (int) $s->reported_by !== (int) $s->user_id,
			'start_date'         => $s->start_date,
			'end_date'           => $s->end_date,
			'notes'              => $with_notes ? (string) $s->notes : '',
			'certificate_status' => $s->certificate_status,
			'certificate_label'  => Dolly_I18n::t( self::CERT_STATUSES[ $s->certificate_status ] ?? $s->certificate_status ),
			'certificate_due'    => $s->certificate_due,
			'protocol'           => (string) ( $s->protocol ?? '' ),
			'conflict'           => (bool) $s->conflict,
			'conflict_details'   => (string) $s->conflict_details,
			'reviewed'           => (bool) $s->reviewed_at,
			'review_note'        => (string) $s->review_note,
			'reported_at'        => Dolly_Time::iso( $s->reported_at ),
			'certificates'       => $certs,
		);
	}

	/**
	 * Reports sickness or an injury (kind "malattia" / "infortunio"). Recorded immediately without approval.
	 *
	 * @param bool $by_admin Registered by an administrator on the employee's behalf.
	 */
	public static function report( $user_id, $data, $by_admin = false ) {
		global $wpdb;
		$start  = $data['start_date'] ?? '';
		$end    = $data['end_date'] ?? $start;
		$kind   = (string) ( $data['kind'] ?? 'malattia' );
		$errors = array();
		if ( ! isset( self::KINDS[ $kind ] ) ) {
			$errors['kind'] = __( 'Scegli tra malattia e infortunio.', 'dolly-employee-management' );
		}
		if ( ! Dolly_Time::is_date( $start ) ) {
			$errors['start_date'] = __( 'Data di inizio non valida.', 'dolly-employee-management' );
		}
		if ( ! Dolly_Time::is_date( $end ) ) {
			$errors['end_date'] = __( 'Data di fine non valida.', 'dolly-employee-management' );
		} elseif ( empty( $errors ) && $end < $start ) {
			$errors['end_date'] = __( 'La data di fine deve essere uguale o successiva all\'inizio.', 'dolly-employee-management' );
		}
		if ( empty( $errors ) && ( strtotime( $end ) - strtotime( $start ) ) > 366 * DAY_IN_SECONDS ) {
			$errors['end_date'] = __( 'Intervallo troppo lungo.', 'dolly-employee-management' );
		}
		if ( $errors ) {
			return new WP_Error( 'dolly_invalid', __( 'Controlla i campi evidenziati.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => $errors ) );
		}

		$mode   = Dolly_Settings::get( 'certificate_mode' );
		$status = 'disabled' === $mode ? 'not_required' : 'missing';
		$due    = 'deadline' === $mode ? Dolly_Time::add_days( Dolly_Time::today(), (int) Dolly_Settings::get( 'certificate_days' ) ) : null;

		$conflicts = self::detect_conflicts( $user_id, $start, $end );
		$now       = Dolly_Time::now_utc();
		$wpdb->insert(
			Dolly_Install::t( 'sickness' ),
			array(
				'user_id'            => $user_id,
				'kind'               => $kind,
				'start_date'         => $start,
				'end_date'           => $end,
				'notes'              => sanitize_textarea_field( $data['notes'] ?? '' ),
				'status'             => 'active',
				'certificate_status' => $status,
				'certificate_due'    => $due,
				'conflict'           => $conflicts ? 1 : 0,
				'conflict_details'   => $conflicts ? implode( "\n", $conflicts ) : null,
				'reported_by'        => get_current_user_id(),
				'reported_at'        => $now,
			)
		);
		$id     = (int) $wpdb->insert_id;
		$name   = Dolly_Employees::display_name( $user_id );
		$period = Dolly_Time::fmt_date( $start ) . ( $start !== $end ? ' – ' . Dolly_Time::fmt_date( $end ) : '' );
		$label  = self::kind_label( $kind );
		$phrase = self::kind_phrase( $kind ) . ' ' . $period;

		if ( $by_admin ) {
			Dolly_Audit::log( 'sickness_created_admin', 'sickness', $id, $user_id, sanitize_textarea_field( $data['notes'] ?? '' ), null, array( 'kind' => $label, 'period' => $period ) );
			Dolly_Notifications::notify_user( $user_id, 'sickness_reported', fn () => array( 'infortunio' === $kind ? __( 'Infortunio registrato dall\'amministratore', 'dolly-employee-management' ) : __( 'Malattia registrata dall\'amministratore', 'dolly-employee-management' ), __( 'Periodo: ', 'dolly-employee-management' ) . $period ), null, 'malattia' );
		} else {
			Dolly_Notifications::notify_admins( 'sickness_reported', fn () => array( sprintf( 'infortunio' === $kind ? /* translators: %s: employee name. */ __( 'Infortunio segnalato da %s', 'dolly-employee-management' ) : /* translators: %s: employee name. */ __( 'Malattia segnalata da %s', 'dolly-employee-management' ), $name ), __( 'Periodo: ', 'dolly-employee-management' ) . $period ), null, 'dolly-requests#malattie', 'sickness-' . $id );
		}

		if ( 'missing' === $status ) {
			Dolly_Anomalies::open( $user_id, 'missing_certificate', 'cert-' . $id, $start, 'sickness', $id, __( 'Certificato medico mancante per ', 'dolly-employee-management' ) . $phrase . ( $due ? __( ' (scadenza ', 'dolly-employee-management' ) . Dolly_Time::fmt_date( $due ) . ')' : '' ) );
			$body = __( 'Carica il certificato medico per ', 'dolly-employee-management' ) . $phrase . ( $due ? __( ' entro il ', 'dolly-employee-management' ) . Dolly_Time::fmt_date( $due ) : '' ) . '.';
			Dolly_Notifications::notify_user( $user_id, 'certificate_required', fn () => array( __( 'Certificato medico richiesto', 'dolly-employee-management' ), $body ), null, 'malattia' );
			Dolly_Notifications::notify_admins( 'certificate_required', fn () => array( __( 'Certificato richiesto: ', 'dolly-employee-management' ) . $name, $body ), null, 'dolly-anomalies', 'certreq-' . $id );
		}
		if ( $conflicts ) {
			Dolly_Anomalies::open( $user_id, 'sickness_conflict', 'sickconf-' . $id, $start, 'sickness', $id, implode( "\n", $conflicts ) );
		}
		Dolly_Anomalies::resolve_absence( $user_id, $start, $end, 'justified', __( 'Giustificata: ', 'dolly-employee-management' ) . $phrase . '.' );
		Dolly_Hours::touch( $user_id, $start, $end );
		return self::format( self::get( $id ) );
	}

	/** Conflicts with existing attendance, leave, or sickness. The report is preserved regardless. */
	private static function detect_conflicts( $user_id, $start, $end ) {
		global $wpdb;
		$out = array();
		$p   = Dolly_Install::t( 'punches' );
		$dates = $wpdb->get_col( $wpdb->prepare( "SELECT DISTINCT work_date FROM $p WHERE user_id = %d AND is_active = 1 AND work_date BETWEEN %s AND %s ORDER BY work_date", $user_id, $start, $end ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		if ( $dates ) {
			$out[] = __( 'Timbrature presenti il ', 'dolly-employee-management' ) . implode( ', ', array_map( array( 'Dolly_Time', 'fmt_date' ), $dates ) ) . '.';
		}
		$r    = Dolly_Install::t( 'requests' );
		$reqs = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $r WHERE user_id = %d AND type IN ('ferie','permesso','donazione') AND status IN ('pending','approved') AND " . Dolly_Requests::EFFECTIVE_ROW . ' AND start_date <= %s AND end_date >= %s', $user_id, $end, $start ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		foreach ( $reqs as $q ) {
			$out[] = ( 'approved' === $q->status ? __( 'Approvata: ', 'dolly-employee-management' ) : __( 'In attesa: ', 'dolly-employee-management' ) ) . Dolly_Requests::summary( $q ) . '.';
		}
		$s    = Dolly_Install::t( 'sickness' );
		$sick = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $s WHERE user_id = %d AND status = 'active' AND start_date <= %s AND end_date >= %s", $user_id, $end, $start ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		foreach ( $sick as $x ) {
			$out[] = __( 'Altra segnalazione (', 'dolly-employee-management' ) . strtolower( self::kind_label( self::kind_of( $x ) ) ) . ') ' . Dolly_Time::fmt_date( $x->start_date ) . ' – ' . Dolly_Time::fmt_date( $x->end_date ) . '.';
		}
		return $out;
	}

	/**
	 * Validates an uploaded file (PDF, JPG or PNG up to 10 MB) and moves it to the private directory.
	 * Returns the values for the certificates table, or WP_Error.
	 *
	 * @param array $file Entry from $_FILES / WP_REST_Request::get_file_params().
	 */
	public static function store_upload( $file ) {
		if ( empty( $file ) || ! isset( $file['tmp_name'] ) || UPLOAD_ERR_OK !== (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) ) {
			$code = (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE );
			$msg  = in_array( $code, array( UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE ), true ) ? __( 'Il file supera la dimensione massima consentita dal server.', 'dolly-employee-management' ) : __( 'Nessun file ricevuto. Riprova.', 'dolly-employee-management' );
			return new WP_Error( 'dolly_upload', $msg, array( 'status' => 400 ) );
		}
		if ( (int) $file['size'] > self::MAX_BYTES ) {
			return new WP_Error( 'dolly_upload', __( 'Il file supera i 10 MB.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		if ( ! is_uploaded_file( $file['tmp_name'] ) ) {
			return new WP_Error( 'dolly_upload', __( 'Caricamento non valido.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		$check = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'], self::ALLOWED );
		$ext   = $check['ext'] ? strtolower( $check['ext'] ) : '';
		$mime  = $check['type'];
		if ( ! $ext || ! isset( self::ALLOWED[ $ext ] ) || ! $mime ) {
			return new WP_Error( 'dolly_upload', __( 'Formato non consentito. Carica un file PDF, JPG o PNG.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		if ( function_exists( 'finfo_open' ) ) {
			$fi   = finfo_open( FILEINFO_MIME_TYPE );
			$real = finfo_file( $fi, $file['tmp_name'] );
			finfo_close( $fi );
			if ( ! in_array( $real, array_values( self::ALLOWED ), true ) ) {
				return new WP_Error( 'dolly_upload', __( 'Il contenuto del file non corrisponde a un PDF, JPG o PNG.', 'dolly-employee-management' ), array( 'status' => 400 ) );
			}
			$mime = $real;
		}
		$dir  = Dolly_Install::private_dir() . '/certificates/' . gmdate( 'Y' );
		wp_mkdir_p( $dir );
		$name = bin2hex( random_bytes( 20 ) );
		$dest = $dir . '/' . $name;
		if ( ! @move_uploaded_file( $file['tmp_name'], $dest ) ) {
			return new WP_Error( 'dolly_upload', __( 'Impossibile salvare il file. Contatta l\'amministratore.', 'dolly-employee-management' ), array( 'status' => 500 ) );
		}
		@chmod( $dest, 0640 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.file_system_operations_chmod -- failure handled by the caller; private files of the plugin.
		return array(
			'file_name'     => gmdate( 'Y' ) . '/' . $name,
			'original_name' => sanitize_file_name( $file['name'] ),
			'mime'          => $mime,
			'size_bytes'    => (int) $file['size'],
		);
	}

	/** What a medical certificate needs (settings): array( 'file' => bool, 'protocol' => bool ). */
	public static function requirements() {
		return array(
			'file'     => (bool) Dolly_Settings::get( 'certificate_require_file' ),
			'protocol' => (bool) Dolly_Settings::get( 'certificate_require_protocol' ),
		);
	}

	/** Protocol number of a telematic certificate: letters, digits, spaces, "-", "/" and "."; up to 40 characters. */
	public static function clean_protocol( $value ) {
		$v = strtoupper( trim( preg_replace( '/\s+/', ' ', sanitize_text_field( (string) $value ) ) ) );
		return preg_match( '#^[A-Z0-9][A-Z0-9 ./-]{2,39}$#', $v ) ? $v : ( '' === $v ? '' : false );
	}

	/**
	 * Certificate of a sickness report: the file (PDF, JPG or PNG, stored outside public uploads) and/or
	 * the protocol number typed by the employee. The settings say which of the two are required; with
	 * neither required, one of them is enough. Already provided parts count (a protocol can be added
	 * after the file and vice versa).
	 *
	 * @param array|null $file     Entry from $_FILES / WP_REST_Request::get_file_params().
	 * @param string     $protocol Protocol number ('' = not given).
	 */
	public static function upload_certificate( $sickness_id, $file, $as_admin = false, $protocol = '' ) {
		global $wpdb;
		$s = self::get( $sickness_id );
		if ( ! $s ) {
			return new WP_Error( 'dolly_not_found', __( 'Segnalazione di malattia non trovata.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		if ( ! $as_admin && (int) $s->user_id !== get_current_user_id() ) {
			return new WP_Error( 'dolly_forbidden', __( 'Non autorizzato.', 'dolly-employee-management' ), array( 'status' => 403 ) );
		}
		$has_file = ! empty( $file ) && isset( $file['tmp_name'] ) && UPLOAD_ERR_NO_FILE !== (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE );
		$protocol = self::clean_protocol( $protocol );
		if ( false === $protocol ) {
			return new WP_Error( 'dolly_invalid', __( 'Numero di protocollo non valido.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'protocol' => __( 'Usa lettere, cifre e i segni - / . (da 3 a 40 caratteri).', 'dolly-employee-management' ) ) ) );
		}
		$need     = self::requirements();
		$had_file = (bool) self::certificates( $sickness_id );
		$errors   = array();
		if ( ! $has_file && '' === $protocol ) {
			$errors[ $need['protocol'] && ! $need['file'] ? 'protocol' : 'file' ] = $need['protocol'] && ! $need['file'] ? __( 'Inserisci il numero di protocollo.', 'dolly-employee-management' ) : __( 'Scegli il file del certificato.', 'dolly-employee-management' );
		}
		if ( ! $as_admin ) {
			if ( $need['file'] && ! $has_file && ! $had_file ) {
				$errors['file'] = __( 'Il file del certificato è obbligatorio.', 'dolly-employee-management' );
			}
			if ( $need['protocol'] && '' === $protocol && empty( $s->protocol ) ) {
				$errors['protocol'] = __( 'Il numero di protocollo è obbligatorio.', 'dolly-employee-management' );
			}
		}
		if ( $errors ) {
			return new WP_Error( 'dolly_invalid', reset( $errors ), array( 'status' => 400, 'fields' => $errors ) );
		}
		$cert_id = 0;
		if ( $has_file ) {
			$stored = self::store_upload( $file );
			if ( is_wp_error( $stored ) ) {
				return $stored;
			}
			$wpdb->insert(
				Dolly_Install::t( 'certificates' ),
				array(
					'sickness_id'   => $sickness_id,
					'user_id'       => (int) $s->user_id,
					'file_name'     => $stored['file_name'],
					'original_name' => $stored['original_name'],
					'mime'          => $stored['mime'],
					'size_bytes'    => $stored['size_bytes'],
					'uploaded_by'   => get_current_user_id(),
					'uploaded_at'   => Dolly_Time::now_utc(),
				)
			);
			$cert_id = (int) $wpdb->insert_id;
		}
		if ( '' !== $protocol && $protocol !== (string) $s->protocol ) {
			$wpdb->update( Dolly_Install::t( 'sickness' ), array( 'protocol' => $protocol ), array( 'id' => $sickness_id ) );
			Dolly_Audit::log( 'certificate_protocol', 'sickness', $sickness_id, (int) $s->user_id, '', array( 'protocol' => (string) $s->protocol ), array( 'protocol' => $protocol ) );
		}
		if ( in_array( $s->certificate_status, array( 'missing', 'overdue', 'not_required', 'cleared' ), true ) ) {
			$wpdb->update( Dolly_Install::t( 'sickness' ), array( 'certificate_status' => 'uploaded' ), array( 'id' => $sickness_id ) );
		}
		// The certificate resolves the missing-certificate anomaly without requiring approval.
		Dolly_Anomalies::resolve_by_key( 'cert-' . $sickness_id, 'certificate_uploaded', __( 'Certificato caricato.', 'dolly-employee-management' ) );
		$what = trim( ( $has_file ? __( 'File caricato.', 'dolly-employee-management' ) : '' ) . ' ' . ( '' !== $protocol ? __( 'Protocollo: ', 'dolly-employee-management' ) . $protocol : '' ) );
		Dolly_Notifications::notify_admins( 'certificate_uploaded', fn () => array( __( 'Certificato caricato da ', 'dolly-employee-management' ) . Dolly_Employees::display_name( (int) $s->user_id ), self::kind_label( self::kind_of( $s ) ) . ' ' . Dolly_Time::fmt_date( $s->start_date ) . ' – ' . Dolly_Time::fmt_date( $s->end_date ) . ' · ' . $what ), null, 'dolly-requests#malattie', 'certup-' . $sickness_id . '-' . ( $cert_id ? $cert_id : 'p' ) );
		return self::format( self::get( $sickness_id ) );
	}

	/**
	 * Streams a certificate after authorising the current user (owner or administrator).
	 */
	public static function download( $cert_id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'certificates' );
		$c = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d", $cert_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		if ( ! $c ) {
			return new WP_Error( 'dolly_not_found', __( 'Certificato non trovato.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$uid      = get_current_user_id();
		$is_admin = current_user_can( 'dolly_manage' );
		if ( ! $is_admin && ( (int) $c->user_id !== $uid || ! Dolly_Employees::is_active( $uid ) ) ) {
			return new WP_Error( 'dolly_forbidden', __( 'Non sei autorizzato a scaricare questo certificato.', 'dolly-employee-management' ), array( 'status' => 403 ) );
		}
		$path = Dolly_Install::private_dir() . '/certificates/' . $c->file_name;
		if ( ! is_readable( $path ) || false !== strpos( $c->file_name, '..' ) ) {
			return new WP_Error( 'dolly_not_found', __( 'File non disponibile.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		if ( $is_admin && (int) $c->user_id !== $uid ) {
			Dolly_Audit::log( 'certificate_downloaded', 'certificate', (int) $c->id, (int) $c->user_id );
		}
		nocache_headers();
		header( 'Content-Type: ' . $c->mime );
		header( 'Content-Length: ' . filesize( $path ) );
		header( 'Content-Disposition: attachment; filename="' . rawurlencode( $c->original_name ) . '"; filename*=UTF-8\'\'' . rawurlencode( $c->original_name ) );
		header( 'X-Content-Type-Options: nosniff' );
		readfile( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile -- private files of the plugin.
		exit;
	}

	/** Disabling certificates clears outstanding requirements with an audit entry. */
	public static function clear_outstanding_requirements() {
		global $wpdb;
		$t   = Dolly_Install::t( 'sickness' );
		$ids = array_map( 'intval', $wpdb->get_col( "SELECT id FROM $t WHERE certificate_status IN ('missing','overdue')" ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		if ( ! $ids ) {
			return 0;
		}
		$wpdb->query( "UPDATE $t SET certificate_status = 'cleared' WHERE id IN (" . implode( ',', $ids ) . ')' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		foreach ( $ids as $id ) {
			Dolly_Anomalies::resolve_by_key( 'cert-' . $id, 'certificates_disabled', __( 'Requisito certificato disattivato dalle impostazioni.', 'dolly-employee-management' ) );
		}
		Dolly_Audit::log( 'certificates_disabled', 'settings', 0, 0, __( 'Certificati disattivati: requisiti in sospeso annullati.', 'dolly-employee-management' ), array( 'sickness_ids' => $ids ), array( 'certificate_status' => 'cleared' ) );
		return count( $ids );
	}

	/** Applies the configured deadline to outstanding requirements without one. */
	public static function apply_deadlines() {
		global $wpdb;
		$t    = Dolly_Install::t( 'sickness' );
		$days = (int) Dolly_Settings::get( 'certificate_days' );
		foreach ( $wpdb->get_results( "SELECT id, reported_at FROM $t WHERE certificate_status IN ('missing','overdue')" ) as $s ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
			$reported = Dolly_Time::utc_to_local( $s->reported_at, 'Y-m-d' );
			$wpdb->update( $t, array( 'certificate_due' => Dolly_Time::add_days( $reported, $days ) ), array( 'id' => $s->id ) );
		}
	}

	/** Scheduled: marks missing certificates overdue once the deadline has passed. */
	public static function check_overdue() {
		global $wpdb;
		if ( 'deadline' !== Dolly_Settings::get( 'certificate_mode' ) ) {
			return;
		}
		$t    = Dolly_Install::t( 'sickness' );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE certificate_status = 'missing' AND certificate_due IS NOT NULL AND certificate_due < %s", Dolly_Time::today() ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		foreach ( $rows as $s ) {
			$wpdb->update( $t, array( 'certificate_status' => 'overdue' ), array( 'id' => $s->id, 'certificate_status' => 'missing' ) );
			Dolly_Anomalies::mark_overdue( 'cert-' . $s->id );
			$name   = Dolly_Employees::display_name( (int) $s->user_id );
			$period = Dolly_Time::fmt_date( $s->start_date ) . ' – ' . Dolly_Time::fmt_date( $s->end_date );
			$kind   = self::kind_of( $s );
			Dolly_Notifications::notify_user( (int) $s->user_id, 'certificate_overdue', fn () => array( __( 'Certificato scaduto', 'dolly-employee-management' ), sprintf( 'infortunio' === $kind ? /* translators: %s: period of the report (dates). */ __( 'Il termine per il certificato dell\'infortunio %s è scaduto. Caricalo appena possibile.', 'dolly-employee-management' ) : /* translators: %s: period of the report (dates). */ __( 'Il termine per il certificato della malattia %s è scaduto. Caricalo appena possibile.', 'dolly-employee-management' ), $period ) ), null, 'malattia', 'certover-' . $s->id );
			Dolly_Notifications::notify_admins( 'certificate_overdue', fn () => array( __( 'Certificato scaduto: ', 'dolly-employee-management' ) . $name, self::kind_label( $kind ) . ' ' . $period ), null, 'dolly-anomalies', 'certover-' . $s->id );
		}
	}

	public static function review( $id, $note ) {
		global $wpdb;
		$s = self::get( $id );
		if ( ! $s ) {
			return new WP_Error( 'dolly_not_found', __( 'Segnalazione non trovata.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$note = sanitize_textarea_field( $note );
		if ( '' === $note ) {
			return new WP_Error( 'dolly_invalid', __( 'Aggiungi una nota di verifica.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'note' => __( 'Aggiungi una nota.', 'dolly-employee-management' ) ) ) );
		}
		$wpdb->update( Dolly_Install::t( 'sickness' ), array( 'reviewed_by' => get_current_user_id(), 'reviewed_at' => Dolly_Time::now_utc(), 'review_note' => $note ), array( 'id' => $id ) );
		Dolly_Anomalies::resolve_by_key( 'sickconf-' . $id, 'reviewed', $note );
		Dolly_Audit::log( 'sickness_reviewed', 'sickness', $id, (int) $s->user_id, $note );
		return self::format( self::get( $id ) );
	}

	public static function query( $args ) {
		global $wpdb;
		$t      = Dolly_Install::t( 'sickness' );
		$where  = array( "s.status = 'active'" );
		$params = array();
		if ( ! empty( $args['user_id'] ) ) {
			$where[]  = 's.user_id = %d';
			$params[] = (int) $args['user_id'];
		}
		if ( ! empty( $args['certificate_status'] ) ) {
			$where[]  = 's.certificate_status = %s';
			$params[] = $args['certificate_status'];
		}
		if ( ! empty( $args['kind'] ) && isset( self::KINDS[ $args['kind'] ] ) ) {
			$where[]  = 's.kind = %s';
			$params[] = $args['kind'];
		}
		if ( ! empty( $args['workplace'] ) ) {
			$ids     = Dolly_Workplaces::user_ids_for_workplace( (int) $args['workplace'] );
			$where[] = $ids ? 's.user_id IN (' . implode( ',', $ids ) . ')' : '1=0';
		}
		$w     = implode( ' AND ', $where );
		$per   = max( 1, min( 100, (int) ( $args['per_page'] ?? 10 ) ) );
		$page  = max( 1, (int) ( $args['page'] ?? 1 ) );
		$count = (int) ( $params ? $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t s WHERE $w", $params ) ) : $wpdb->get_var( "SELECT COUNT(*) FROM $t s WHERE $w" ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- plugin tables ($wpdb->prefix), values prepared or cast.
		$params[] = $per;
		$params[] = ( $page - 1 ) * $per;
		$join     = '';
		$order    = 's.start_date DESC';
		if ( 'name' === ( $args['order'] ?? '' ) ) {
			list( $join, $by ) = Dolly_Employees::name_order_sql( 's.user_id' );
			$order             = $by . ', s.start_date DESC';
		}
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT s.* FROM $t s $join WHERE $w ORDER BY $order, s.id DESC LIMIT %d OFFSET %d", $params ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- plugin tables ($wpdb->prefix), values prepared or cast.
		return array(
			'items' => array_map( array( __CLASS__, 'format' ), $rows ),
			'total' => $count,
			'pages' => (int) ceil( $count / $per ),
			'page'  => $page,
		);
	}
}
