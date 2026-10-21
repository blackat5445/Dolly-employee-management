<?php
/**
 * Sickness reports and private medical certificates.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class MEM_Sickness {

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
		return self::KINDS[ $kind ] ?? self::KINDS['malattia'];
	}

	/** Kind with its article, for sentences: "la malattia" / "l'infortunio". */
	public static function kind_phrase( $kind ) {
		return 'infortunio' === $kind ? 'l\'infortunio' : 'la malattia';
	}

	/** Kind of a sickness row ("malattia" for rows created before injuries existed). */
	public static function kind_of( $s ) {
		return isset( $s->kind ) && isset( self::KINDS[ $s->kind ] ) ? $s->kind : 'malattia';
	}

	public static function get( $id ) {
		global $wpdb;
		$t = MEM_Install::t( 'sickness' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d", $id ) ); // phpcs:ignore
	}

	public static function covers( $user_id, $date ) {
		global $wpdb;
		$t = MEM_Install::t( 'sickness' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND status = 'active' AND start_date <= %s AND end_date >= %s LIMIT 1", $user_id, $date, $date ) ); // phpcs:ignore
	}

	public static function range( array $user_ids, $from, $to ) {
		global $wpdb;
		if ( ! $user_ids ) {
			return array();
		}
		$t  = MEM_Install::t( 'sickness' );
		$in = implode( ',', array_map( 'intval', $user_ids ) );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id IN ($in) AND status = 'active' AND start_date <= %s AND end_date >= %s", $to, $from ) ); // phpcs:ignore
	}

	public static function certificates( $sickness_id ) {
		global $wpdb;
		$t = MEM_Install::t( 'certificates' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE sickness_id = %d ORDER BY uploaded_at ASC", $sickness_id ) ); // phpcs:ignore
	}

	public static function format( $s, $with_notes = true ) {
		$certs = array();
		foreach ( self::certificates( (int) $s->id ) as $c ) {
			$certs[] = array(
				'id'            => (int) $c->id,
				'original_name' => $c->original_name,
				'size'          => (int) $c->size_bytes,
				'uploaded_at'   => MEM_Time::iso( $c->uploaded_at ),
				'download_url'  => rest_url( MEM_REST_NS . '/certificates/' . (int) $c->id . '/download' ),
			);
		}
		return array(
			'id'                 => (int) $s->id,
			'user_id'            => (int) $s->user_id,
			'employee'           => MEM_Employees::sort_name( (int) $s->user_id ),
			'kind'               => self::kind_of( $s ),
			'kind_label'         => self::kind_label( self::kind_of( $s ) ),
			'reported_by_admin'  => (int) $s->reported_by !== (int) $s->user_id,
			'start_date'         => $s->start_date,
			'end_date'           => $s->end_date,
			'notes'              => $with_notes ? (string) $s->notes : '',
			'certificate_status' => $s->certificate_status,
			'certificate_label'  => self::CERT_STATUSES[ $s->certificate_status ] ?? $s->certificate_status,
			'certificate_due'    => $s->certificate_due,
			'conflict'           => (bool) $s->conflict,
			'conflict_details'   => (string) $s->conflict_details,
			'reviewed'           => (bool) $s->reviewed_at,
			'review_note'        => (string) $s->review_note,
			'reported_at'        => MEM_Time::iso( $s->reported_at ),
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
			$errors['kind'] = 'Scegli tra malattia e infortunio.';
		}
		if ( ! MEM_Time::is_date( $start ) ) {
			$errors['start_date'] = 'Data di inizio non valida.';
		}
		if ( ! MEM_Time::is_date( $end ) ) {
			$errors['end_date'] = 'Data di fine non valida.';
		} elseif ( empty( $errors ) && $end < $start ) {
			$errors['end_date'] = 'La data di fine deve essere uguale o successiva all\'inizio.';
		}
		if ( empty( $errors ) && ( strtotime( $end ) - strtotime( $start ) ) > 366 * DAY_IN_SECONDS ) {
			$errors['end_date'] = 'Intervallo troppo lungo.';
		}
		if ( $errors ) {
			return new WP_Error( 'mem_invalid', 'Controlla i campi evidenziati.', array( 'status' => 400, 'fields' => $errors ) );
		}

		$mode   = MEM_Settings::get( 'certificate_mode' );
		$status = 'disabled' === $mode ? 'not_required' : 'missing';
		$due    = 'deadline' === $mode ? MEM_Time::add_days( MEM_Time::today(), (int) MEM_Settings::get( 'certificate_days' ) ) : null;

		$conflicts = self::detect_conflicts( $user_id, $start, $end );
		$now       = MEM_Time::now_utc();
		$wpdb->insert(
			MEM_Install::t( 'sickness' ),
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
		$name   = MEM_Employees::display_name( $user_id );
		$period = MEM_Time::fmt_date( $start ) . ( $start !== $end ? ' – ' . MEM_Time::fmt_date( $end ) : '' );
		$label  = self::kind_label( $kind );
		$phrase = self::kind_phrase( $kind ) . ' ' . $period;
		$suffix = 'infortunio' === $kind ? 'o' : 'a';

		if ( $by_admin ) {
			MEM_Audit::log( 'sickness_created_admin', 'sickness', $id, $user_id, sanitize_textarea_field( $data['notes'] ?? '' ), null, array( 'kind' => $label, 'period' => $period ) );
			MEM_Notifications::notify_user( $user_id, 'sickness_reported', $label . ' registrat' . $suffix . ' dall\'amministratore', 'Periodo: ' . $period, 'malattia' );
		} else {
			MEM_Notifications::notify_admins( 'sickness_reported', $label . ' segnalat' . $suffix . ' da ' . $name, 'Periodo: ' . $period, 'mem-requests#malattie', 'sickness-' . $id );
		}

		if ( 'missing' === $status ) {
			MEM_Anomalies::open( $user_id, 'missing_certificate', 'cert-' . $id, $start, 'sickness', $id, 'Certificato medico mancante per ' . $phrase . ( $due ? ' (scadenza ' . MEM_Time::fmt_date( $due ) . ')' : '' ) );
			$body = 'Carica il certificato medico per ' . $phrase . ( $due ? ' entro il ' . MEM_Time::fmt_date( $due ) : '' ) . '.';
			MEM_Notifications::notify_user( $user_id, 'certificate_required', 'Certificato medico richiesto', $body, 'malattia' );
			MEM_Notifications::notify_admins( 'certificate_required', 'Certificato richiesto: ' . $name, $body, 'mem-anomalies', 'certreq-' . $id );
		}
		if ( $conflicts ) {
			MEM_Anomalies::open( $user_id, 'sickness_conflict', 'sickconf-' . $id, $start, 'sickness', $id, implode( "\n", $conflicts ) );
		}
		MEM_Anomalies::resolve_absence( $user_id, $start, $end, 'justified', 'Giustificata: ' . $phrase . '.' );
		MEM_Hours::touch( $user_id, $start, $end );
		return self::format( self::get( $id ) );
	}

	/** Conflicts with existing attendance, leave, or sickness. The report is preserved regardless. */
	private static function detect_conflicts( $user_id, $start, $end ) {
		global $wpdb;
		$out = array();
		$p   = MEM_Install::t( 'punches' );
		$dates = $wpdb->get_col( $wpdb->prepare( "SELECT DISTINCT work_date FROM $p WHERE user_id = %d AND is_active = 1 AND work_date BETWEEN %s AND %s ORDER BY work_date", $user_id, $start, $end ) ); // phpcs:ignore
		if ( $dates ) {
			$out[] = 'Timbrature presenti il ' . implode( ', ', array_map( array( 'MEM_Time', 'fmt_date' ), $dates ) ) . '.';
		}
		$r    = MEM_Install::t( 'requests' );
		$reqs = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $r WHERE user_id = %d AND type IN ('ferie','permesso','donazione') AND status IN ('pending','approved') AND " . MEM_Requests::EFFECTIVE_ROW . ' AND start_date <= %s AND end_date >= %s', $user_id, $end, $start ) ); // phpcs:ignore
		foreach ( $reqs as $q ) {
			$out[] = ( 'approved' === $q->status ? 'Approvata: ' : 'In attesa: ' ) . MEM_Requests::summary( $q ) . '.';
		}
		$s    = MEM_Install::t( 'sickness' );
		$sick = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $s WHERE user_id = %d AND status = 'active' AND start_date <= %s AND end_date >= %s", $user_id, $end, $start ) ); // phpcs:ignore
		foreach ( $sick as $x ) {
			$out[] = 'Altra segnalazione (' . strtolower( self::kind_label( self::kind_of( $x ) ) ) . ') ' . MEM_Time::fmt_date( $x->start_date ) . ' – ' . MEM_Time::fmt_date( $x->end_date ) . '.';
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
			$msg  = in_array( $code, array( UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE ), true ) ? 'Il file supera la dimensione massima consentita dal server.' : 'Nessun file ricevuto. Riprova.';
			return new WP_Error( 'mem_upload', $msg, array( 'status' => 400 ) );
		}
		if ( (int) $file['size'] > self::MAX_BYTES ) {
			return new WP_Error( 'mem_upload', 'Il file supera i 10 MB.', array( 'status' => 400 ) );
		}
		if ( ! is_uploaded_file( $file['tmp_name'] ) ) {
			return new WP_Error( 'mem_upload', 'Caricamento non valido.', array( 'status' => 400 ) );
		}
		$check = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'], self::ALLOWED );
		$ext   = $check['ext'] ? strtolower( $check['ext'] ) : '';
		$mime  = $check['type'];
		if ( ! $ext || ! isset( self::ALLOWED[ $ext ] ) || ! $mime ) {
			return new WP_Error( 'mem_upload', 'Formato non consentito. Carica un file PDF, JPG o PNG.', array( 'status' => 400 ) );
		}
		if ( function_exists( 'finfo_open' ) ) {
			$fi   = finfo_open( FILEINFO_MIME_TYPE );
			$real = finfo_file( $fi, $file['tmp_name'] );
			finfo_close( $fi );
			if ( ! in_array( $real, array_values( self::ALLOWED ), true ) ) {
				return new WP_Error( 'mem_upload', 'Il contenuto del file non corrisponde a un PDF, JPG o PNG.', array( 'status' => 400 ) );
			}
			$mime = $real;
		}
		$dir  = MEM_Install::private_dir() . '/certificates/' . gmdate( 'Y' );
		wp_mkdir_p( $dir );
		$name = bin2hex( random_bytes( 20 ) );
		$dest = $dir . '/' . $name;
		if ( ! @move_uploaded_file( $file['tmp_name'], $dest ) ) { // phpcs:ignore
			return new WP_Error( 'mem_upload', 'Impossibile salvare il file. Contatta l\'amministratore.', array( 'status' => 500 ) );
		}
		@chmod( $dest, 0640 ); // phpcs:ignore
		return array(
			'file_name'     => gmdate( 'Y' ) . '/' . $name,
			'original_name' => sanitize_file_name( $file['name'] ),
			'mime'          => $mime,
			'size_bytes'    => (int) $file['size'],
		);
	}

	/**
	 * Stores an uploaded certificate outside public uploads.
	 *
	 * @param array $file Entry from $_FILES / WP_REST_Request::get_file_params().
	 */
	public static function upload_certificate( $sickness_id, $file, $as_admin = false ) {
		global $wpdb;
		$s = self::get( $sickness_id );
		if ( ! $s ) {
			return new WP_Error( 'mem_not_found', 'Segnalazione di malattia non trovata.', array( 'status' => 404 ) );
		}
		if ( ! $as_admin && (int) $s->user_id !== get_current_user_id() ) {
			return new WP_Error( 'mem_forbidden', 'Non autorizzato.', array( 'status' => 403 ) );
		}
		$stored = self::store_upload( $file );
		if ( is_wp_error( $stored ) ) {
			return $stored;
		}
		$wpdb->insert(
			MEM_Install::t( 'certificates' ),
			array(
				'sickness_id'   => $sickness_id,
				'user_id'       => (int) $s->user_id,
				'file_name'     => $stored['file_name'],
				'original_name' => $stored['original_name'],
				'mime'          => $stored['mime'],
				'size_bytes'    => $stored['size_bytes'],
				'uploaded_by'   => get_current_user_id(),
				'uploaded_at'   => MEM_Time::now_utc(),
			)
		);
		$cert_id = (int) $wpdb->insert_id;
		if ( in_array( $s->certificate_status, array( 'missing', 'overdue', 'not_required', 'cleared' ), true ) ) {
			$wpdb->update( MEM_Install::t( 'sickness' ), array( 'certificate_status' => 'uploaded' ), array( 'id' => $sickness_id ) );
		}
		// Successful upload resolves the missing-certificate anomaly without requiring approval.
		MEM_Anomalies::resolve_by_key( 'cert-' . $sickness_id, 'certificate_uploaded', 'Certificato caricato.' );
		MEM_Notifications::notify_admins( 'certificate_uploaded', 'Certificato caricato da ' . MEM_Employees::display_name( (int) $s->user_id ), self::kind_label( self::kind_of( $s ) ) . ' ' . MEM_Time::fmt_date( $s->start_date ) . ' – ' . MEM_Time::fmt_date( $s->end_date ), 'mem-requests#malattie', 'certup-' . $cert_id );
		return self::format( self::get( $sickness_id ) );
	}

	/**
	 * Streams a certificate after authorising the current user (owner or administrator).
	 */
	public static function download( $cert_id ) {
		global $wpdb;
		$t = MEM_Install::t( 'certificates' );
		$c = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d", $cert_id ) ); // phpcs:ignore
		if ( ! $c ) {
			return new WP_Error( 'mem_not_found', 'Certificato non trovato.', array( 'status' => 404 ) );
		}
		$uid      = get_current_user_id();
		$is_admin = current_user_can( 'mem_manage' );
		if ( ! $is_admin && ( (int) $c->user_id !== $uid || ! MEM_Employees::is_active( $uid ) ) ) {
			return new WP_Error( 'mem_forbidden', 'Non sei autorizzato a scaricare questo certificato.', array( 'status' => 403 ) );
		}
		$path = MEM_Install::private_dir() . '/certificates/' . $c->file_name;
		if ( ! is_readable( $path ) || false !== strpos( $c->file_name, '..' ) ) {
			return new WP_Error( 'mem_not_found', 'File non disponibile.', array( 'status' => 404 ) );
		}
		if ( $is_admin && (int) $c->user_id !== $uid ) {
			MEM_Audit::log( 'certificate_downloaded', 'certificate', (int) $c->id, (int) $c->user_id );
		}
		nocache_headers();
		header( 'Content-Type: ' . $c->mime );
		header( 'Content-Length: ' . filesize( $path ) );
		header( 'Content-Disposition: attachment; filename="' . rawurlencode( $c->original_name ) . '"; filename*=UTF-8\'\'' . rawurlencode( $c->original_name ) );
		header( 'X-Content-Type-Options: nosniff' );
		readfile( $path ); // phpcs:ignore
		exit;
	}

	/** Disabling certificates clears outstanding requirements with an audit entry. */
	public static function clear_outstanding_requirements() {
		global $wpdb;
		$t   = MEM_Install::t( 'sickness' );
		$ids = array_map( 'intval', $wpdb->get_col( "SELECT id FROM $t WHERE certificate_status IN ('missing','overdue')" ) ); // phpcs:ignore
		if ( ! $ids ) {
			return 0;
		}
		$wpdb->query( "UPDATE $t SET certificate_status = 'cleared' WHERE id IN (" . implode( ',', $ids ) . ')' ); // phpcs:ignore
		foreach ( $ids as $id ) {
			MEM_Anomalies::resolve_by_key( 'cert-' . $id, 'certificates_disabled', 'Requisito certificato disattivato dalle impostazioni.' );
		}
		MEM_Audit::log( 'certificates_disabled', 'settings', 0, 0, 'Certificati disattivati: requisiti in sospeso annullati.', array( 'sickness_ids' => $ids ), array( 'certificate_status' => 'cleared' ) );
		return count( $ids );
	}

	/** Applies the configured deadline to outstanding requirements without one. */
	public static function apply_deadlines() {
		global $wpdb;
		$t    = MEM_Install::t( 'sickness' );
		$days = (int) MEM_Settings::get( 'certificate_days' );
		foreach ( $wpdb->get_results( "SELECT id, reported_at FROM $t WHERE certificate_status IN ('missing','overdue')" ) as $s ) { // phpcs:ignore
			$reported = MEM_Time::utc_to_local( $s->reported_at, 'Y-m-d' );
			$wpdb->update( $t, array( 'certificate_due' => MEM_Time::add_days( $reported, $days ) ), array( 'id' => $s->id ) );
		}
	}

	/** Scheduled: marks missing certificates overdue once the deadline has passed. */
	public static function check_overdue() {
		global $wpdb;
		if ( 'deadline' !== MEM_Settings::get( 'certificate_mode' ) ) {
			return;
		}
		$t    = MEM_Install::t( 'sickness' );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE certificate_status = 'missing' AND certificate_due IS NOT NULL AND certificate_due < %s", MEM_Time::today() ) ); // phpcs:ignore
		foreach ( $rows as $s ) {
			$wpdb->update( $t, array( 'certificate_status' => 'overdue' ), array( 'id' => $s->id, 'certificate_status' => 'missing' ) );
			MEM_Anomalies::mark_overdue( 'cert-' . $s->id );
			$name   = MEM_Employees::display_name( (int) $s->user_id );
			$period = MEM_Time::fmt_date( $s->start_date ) . ' – ' . MEM_Time::fmt_date( $s->end_date );
			$kind   = self::kind_of( $s );
			MEM_Notifications::notify_user( (int) $s->user_id, 'certificate_overdue', 'Certificato scaduto', 'Il termine per il certificato del' . ( 'infortunio' === $kind ? 'l\'infortunio ' : 'la malattia ' ) . $period . ' è scaduto. Caricalo appena possibile.', 'malattia', 'certover-' . $s->id );
			MEM_Notifications::notify_admins( 'certificate_overdue', 'Certificato scaduto: ' . $name, self::kind_label( $kind ) . ' ' . $period, 'mem-anomalies', 'certover-' . $s->id );
		}
	}

	public static function review( $id, $note ) {
		global $wpdb;
		$s = self::get( $id );
		if ( ! $s ) {
			return new WP_Error( 'mem_not_found', 'Segnalazione non trovata.', array( 'status' => 404 ) );
		}
		$note = sanitize_textarea_field( $note );
		if ( '' === $note ) {
			return new WP_Error( 'mem_invalid', 'Aggiungi una nota di verifica.', array( 'status' => 400, 'fields' => array( 'note' => 'Aggiungi una nota.' ) ) );
		}
		$wpdb->update( MEM_Install::t( 'sickness' ), array( 'reviewed_by' => get_current_user_id(), 'reviewed_at' => MEM_Time::now_utc(), 'review_note' => $note ), array( 'id' => $id ) );
		MEM_Anomalies::resolve_by_key( 'sickconf-' . $id, 'reviewed', $note );
		MEM_Audit::log( 'sickness_reviewed', 'sickness', $id, (int) $s->user_id, $note );
		return self::format( self::get( $id ) );
	}

	public static function query( $args ) {
		global $wpdb;
		$t      = MEM_Install::t( 'sickness' );
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
			$ids     = MEM_Workplaces::user_ids_for_workplace( (int) $args['workplace'] );
			$where[] = $ids ? 's.user_id IN (' . implode( ',', $ids ) . ')' : '1=0';
		}
		$w     = implode( ' AND ', $where );
		$per   = max( 1, min( 100, (int) ( $args['per_page'] ?? 10 ) ) );
		$page  = max( 1, (int) ( $args['page'] ?? 1 ) );
		$count = (int) ( $params ? $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t s WHERE $w", $params ) ) : $wpdb->get_var( "SELECT COUNT(*) FROM $t s WHERE $w" ) ); // phpcs:ignore
		$params[] = $per;
		$params[] = ( $page - 1 ) * $per;
		$join     = '';
		$order    = 's.start_date DESC';
		if ( 'name' === ( $args['order'] ?? '' ) ) {
			list( $join, $by ) = MEM_Employees::name_order_sql( 's.user_id' );
			$order             = $by . ', s.start_date DESC';
		}
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT s.* FROM $t s $join WHERE $w ORDER BY $order, s.id DESC LIMIT %d OFFSET %d", $params ) ); // phpcs:ignore
		return array(
			'items' => array_map( array( __CLASS__, 'format' ), $rows ),
			'total' => $count,
			'pages' => (int) ceil( $count / $per ),
			'page'  => $page,
		);
	}
}
