<?php
/**
 * Employee accounts: creation, identity, deactivation, profile.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Employees {

	/** Bank details (for salary payments) stored as user meta: field => meta key. */
	const BANK_FIELDS = array(
		'iban'             => 'dolly_iban',
		'bank_beneficiary' => 'dolly_bank_beneficiary',
		'bank_name'        => 'dolly_bank_name',
		'bic'              => 'dolly_bic',
	);

	public static function bank( $user_id ) {
		$out = array();
		foreach ( self::BANK_FIELDS as $k => $meta ) {
			$out[ $k ] = (string) get_user_meta( $user_id, $meta, true );
		}
		return $out;
	}

	/** Structurally valid IBAN: country format, 27 characters for Italy, ISO 7064 mod-97 check digits. */
	public static function is_valid_iban( $iban ) {
		if ( ! preg_match( '/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/', $iban ) ) {
			return false;
		}
		if ( 0 === strpos( $iban, 'IT' ) && 27 !== strlen( $iban ) ) {
			return false;
		}
		$digits = '';
		foreach ( str_split( substr( $iban, 4 ) . substr( $iban, 0, 4 ) ) as $ch ) {
			$digits .= ( $ch >= 'A' && $ch <= 'Z' ) ? (string) ( ord( $ch ) - 55 ) : $ch;
		}
		$rem = 0;
		foreach ( str_split( $digits, 7 ) as $chunk ) {
			$rem = (int) ( $rem . $chunk ) % 97;
		}
		return 1 === $rem;
	}

	/** "IT60 **** 2345": used in notifications, emails and the audit history. */
	public static function mask_iban( $iban ) {
		return '' === (string) $iban ? '' : substr( $iban, 0, 4 ) . ' **** ' . substr( $iban, -4 );
	}

	/** Validates the bank fields present in $data. Returns array( clean values, field errors ). */
	private static function validate_bank( $data ) {
		$out    = array();
		$errors = array();
		if ( isset( $data['iban'] ) ) {
			$iban = strtoupper( preg_replace( '/[\s-]+/', '', (string) $data['iban'] ) );
			if ( '' !== $iban && ! self::is_valid_iban( $iban ) ) {
				$errors['iban'] = __( 'IBAN non valido: controlla lettere e cifre.', 'dolly-employee-management' );
			}
			$out['iban'] = $iban;
		}
		if ( isset( $data['bic'] ) ) {
			$bic = strtoupper( preg_replace( '/\s+/', '', (string) $data['bic'] ) );
			if ( '' !== $bic && ! preg_match( '/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/', $bic ) ) {
				$errors['bic'] = __( 'BIC/SWIFT non valido (8 o 11 caratteri).', 'dolly-employee-management' );
			}
			$out['bic'] = $bic;
		}
		foreach ( array( 'bank_beneficiary', 'bank_name' ) as $k ) {
			if ( isset( $data[ $k ] ) ) {
				$out[ $k ] = mb_substr( sanitize_text_field( $data[ $k ] ), 0, 140 );
			}
		}
		return array( $out, $errors );
	}

	/**
	 * Saves validated bank details. Returns the previous values when something changed, otherwise null.
	 * The audit history keeps only the masked IBAN.
	 */
	private static function save_bank( $user_id, array $bank, $reason = '' ) {
		if ( ! $bank ) {
			return null;
		}
		$before = self::bank( $user_id );
		foreach ( $bank as $k => $v ) {
			update_user_meta( $user_id, self::BANK_FIELDS[ $k ], $v );
		}
		$after = self::bank( $user_id );
		if ( $before === $after ) {
			return null;
		}
		$masked_before         = $before;
		$masked_after          = $after;
		$masked_before['iban'] = self::mask_iban( $before['iban'] );
		$masked_after['iban']  = self::mask_iban( $after['iban'] );
		Dolly_Audit::log( 'bank_details_updated', 'user', $user_id, $user_id, $reason, $masked_before, $masked_after );
		return $before;
	}

	public static function is_employee( $user_id ) {
		$u = get_userdata( $user_id );
		return $u && in_array( Dolly_Install::ROLE_EMPLOYEE, (array) $u->roles, true );
	}

	public static function is_workplace_account( $user_id ) {
		$u = get_userdata( $user_id );
		return $u && in_array( Dolly_Install::ROLE_WORKPLACE, (array) $u->roles, true );
	}

	/** Employees and workplace accounts are active unless explicitly deactivated. */
	public static function is_active( $user_id ) {
		$v = get_user_meta( $user_id, 'dolly_active', true );
		return '' === $v || '1' === (string) $v;
	}

	public static function display_name( $user_id ) {
		if ( ! $user_id ) {
			return __( 'Sistema', 'dolly-employee-management' );
		}
		$u = get_userdata( $user_id );
		if ( ! $u ) {
			return __( 'Utente #', 'dolly-employee-management' ) . (int) $user_id;
		}
		$name = trim( $u->first_name . ' ' . $u->last_name );
		return '' !== $name ? $name : $u->display_name;
	}

	/** "Surname Name" (e.g. "Abbate Giuseppe"), used in every administrator list, which is sorted by surname. */
	public static function sort_name( $user_id ) {
		static $cache = array();
		$user_id = (int) $user_id;
		if ( ! isset( $cache[ $user_id ] ) ) {
			$u                  = $user_id ? get_userdata( $user_id ) : null;
			$name               = $u ? trim( $u->last_name . ' ' . $u->first_name ) : '';
			$cache[ $user_id ] = '' !== $name ? $name : self::display_name( $user_id );
		}
		return $cache[ $user_id ];
	}

	/**
	 * SQL pieces to sort rows of a custom table by employee surname, then first name.
	 *
	 * @param string $user_col Qualified user id column, e.g. "r.user_id".
	 * @return array( join, order by )
	 */
	public static function name_order_sql( $user_col ) {
		global $wpdb;
		$join = " LEFT JOIN {$wpdb->usermeta} dolly_ln ON dolly_ln.user_id = $user_col AND dolly_ln.meta_key = 'last_name'"
			. " LEFT JOIN {$wpdb->usermeta} dolly_fn ON dolly_fn.user_id = $user_col AND dolly_fn.meta_key = 'first_name'";
		return array( $join, 'dolly_ln.meta_value ASC, dolly_fn.meta_value ASC' );
	}

	/** Every employee as { id, name ("Surname Name"), active }, sorted by surname: used by selects and chips. */
	public static function options() {
		$q   = new WP_User_Query( array( 'role' => Dolly_Install::ROLE_EMPLOYEE, 'number' => -1, 'fields' => array( 'ID' ) ) );
		$out = array();
		foreach ( $q->get_results() as $u ) {
			$out[] = array(
				'id'     => (int) $u->ID,
				'name'   => self::sort_name( (int) $u->ID ),
				'active' => self::is_active( (int) $u->ID ),
			);
		}
		usort(
			$out,
			function ( $a, $b ) {
				return strcasecmp( remove_accents( $a['name'] ), remove_accents( $b['name'] ) );
			}
		);
		return $out;
	}

	/** IDs of active employees (optionally assigned to a workplace on a date). */
	public static function active_ids( $workplace_id = 0, $date = null ) {
		$q   = new WP_User_Query(
			array(
				'role'       => Dolly_Install::ROLE_EMPLOYEE,
				'fields'     => 'ID',
				'number'     => -1,
				'meta_query' => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- plugin tables ($wpdb->prefix), values prepared or cast.
					'relation' => 'OR',
					array(
						'key'     => 'dolly_active',
						'compare' => 'NOT EXISTS',
					),
					array(
						'key'   => 'dolly_active',
						'value' => '1',
					),
				),
			)
		);
		$ids = array_map( 'intval', $q->get_results() );
		if ( $workplace_id ) {
			$ids = array_values( array_intersect( $ids, Dolly_Workplaces::user_ids_for_workplace( $workplace_id, $date ) ) );
		}
		return $ids;
	}

	public static function format( $user, $full = false ) {
		if ( ! $user instanceof WP_User ) {
			$user = get_userdata( (int) $user );
		}
		if ( ! $user ) {
			return null;
		}
		$workplaces = Dolly_Workplaces::for_user( $user->ID );
		$out        = array(
			'id'         => (int) $user->ID,
			'username'   => $user->user_login,
			'first_name' => $user->first_name,
			'last_name'  => $user->last_name,
			'name'       => self::display_name( $user->ID ),
			'sort_name'  => self::sort_name( $user->ID ),
			'email'      => $user->user_email,
			'phone'      => (string) get_user_meta( $user->ID, 'dolly_phone', true ),
			'active'     => self::is_active( $user->ID ),
			'workplaces' => array_map(
				function ( $w ) {
					return array(
						'id'   => (int) $w->id,
						'name' => $w->name,
					);
				},
				$workplaces
			),
			'schedule'   => Dolly_Schedules::format( Dolly_Schedules::current( $user->ID ) ),
			'bank'       => self::bank( $user->ID ),
		);
		if ( $full ) {
			$out['schedule_history']   = Dolly_Schedules::history( $user->ID );
			$out['deactivated_at']     = get_user_meta( $user->ID, 'dolly_deactivated_at', true );
			$out['exceptions']         = Dolly_Verification::exceptions_for( $user->ID );
			$out['registered']         = Dolly_Time::iso( $user->user_registered );
		}
		return $out;
	}

	private static function validate_identity( $data, $user_id = 0 ) {
		$errors = array();
		$out    = array();
		foreach ( array( 'first_name' => __( 'Inserisci il nome.', 'dolly-employee-management' ), 'last_name' => __( 'Inserisci il cognome.', 'dolly-employee-management' ) ) as $k => $msg ) {
			if ( isset( $data[ $k ] ) || ! $user_id ) {
				$out[ $k ] = sanitize_text_field( $data[ $k ] ?? '' );
				if ( '' === $out[ $k ] ) {
					$errors[ $k ] = $msg;
				}
			}
		}
		if ( isset( $data['email'] ) || ! $user_id ) {
			$email = sanitize_email( $data['email'] ?? '' );
			if ( ! is_email( $email ) ) {
				$errors['email'] = __( 'Indirizzo email non valido.', 'dolly-employee-management' );
			} else {
				$owner = email_exists( $email );
				if ( $owner && (int) $owner !== (int) $user_id ) {
					$errors['email'] = __( 'Email già associata a un altro account.', 'dolly-employee-management' );
				}
			}
			$out['email'] = $email;
		}
		if ( isset( $data['phone'] ) ) {
			$phone = preg_replace( '/[^0-9+ ]/', '', (string) $data['phone'] );
			if ( '' !== $phone && strlen( preg_replace( '/\D/', '', $phone ) ) < 6 ) {
				$errors['phone'] = __( 'Numero di telefono non valido.', 'dolly-employee-management' );
			}
			$out['phone'] = trim( $phone );
		}
		return array( $out, $errors );
	}

	public static function create( $data ) {
		list( $id_data, $errors )  = self::validate_identity( $data );
		list( $bank, $bank_errors ) = self::validate_bank( $data );
		$errors                     = array_merge( $errors, $bank_errors );
		$username = sanitize_user( $data['username'] ?? '', true );
		if ( '' === $username ) {
			$errors['username'] = __( 'Inserisci il nome utente.', 'dolly-employee-management' );
		} elseif ( username_exists( $username ) ) {
			$errors['username'] = __( 'Nome utente già in uso.', 'dolly-employee-management' );
		}
		$password = (string) ( $data['password'] ?? '' );
		if ( strlen( $password ) < 8 ) {
			$errors['password'] = __( 'La password deve avere almeno 8 caratteri.', 'dolly-employee-management' );
		}
		$sched = Dolly_Schedules::clean( $data['schedule'] ?? array() );
		if ( is_wp_error( $sched ) ) {
			$errors = array_merge( $errors, $sched->get_error_data()['fields'] );
		}
		$wids = array_map( 'intval', (array) ( $data['workplaces'] ?? array() ) );
		$wids = array_values( array_filter( $wids, function ( $id ) {
			return (bool) Dolly_Workplaces::get( $id );
		} ) );
		if ( ! $wids ) {
			$errors['workplaces'] = __( 'Assegna almeno una sede.', 'dolly-employee-management' );
		}
		$from = ( ! empty( $data['valid_from'] ) && Dolly_Time::is_date( $data['valid_from'] ) ) ? $data['valid_from'] : Dolly_Time::today();
		if ( $errors ) {
			return new WP_Error( 'dolly_invalid', __( 'Controlla i campi evidenziati.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => $errors ) );
		}

		$user_id = wp_insert_user(
			array(
				'user_login'   => $username,
				'user_pass'    => $password,
				'user_email'   => $id_data['email'],
				'first_name'   => $id_data['first_name'],
				'last_name'    => $id_data['last_name'],
				'display_name' => $id_data['first_name'] . ' ' . $id_data['last_name'],
				'role'         => Dolly_Install::ROLE_EMPLOYEE,
			)
		);
		if ( is_wp_error( $user_id ) ) {
			return new WP_Error( 'dolly_invalid', $user_id->get_error_message(), array( 'status' => 400 ) );
		}
		update_user_meta( $user_id, 'dolly_phone', $id_data['phone'] ?? '' );
		update_user_meta( $user_id, 'dolly_active', 1 );
		update_user_meta( $user_id, 'show_admin_bar_front', 'false' );
		foreach ( $bank as $k => $v ) {
			update_user_meta( $user_id, self::BANK_FIELDS[ $k ], $v );
		}
		Dolly_Schedules::set( $user_id, $data['schedule'], $from );
		Dolly_Workplaces::set_user_assignments( $user_id, $wids, $from );
		$after = self::format( $user_id );
		Dolly_Audit::log( 'employee_created', 'user', $user_id, $user_id, '', null, $after );
		return $after;
	}

	/**
	 * Administrator update. Username is immutable.
	 */
	public static function update( $user_id, $data ) {
		if ( ! self::is_employee( $user_id ) ) {
			return new WP_Error( 'dolly_not_found', __( 'Dipendente non trovato.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$before                     = self::format( $user_id );
		list( $id_data, $errors )   = self::validate_identity( $data, $user_id );
		list( $bank, $bank_errors ) = self::validate_bank( $data );
		$errors                     = array_merge( $errors, $bank_errors );
		$from = ( ! empty( $data['valid_from'] ) && Dolly_Time::is_date( $data['valid_from'] ) ) ? $data['valid_from'] : Dolly_Time::today();
		if ( isset( $data['schedule'] ) ) {
			$sched = Dolly_Schedules::clean( $data['schedule'] );
			if ( is_wp_error( $sched ) ) {
				$errors = array_merge( $errors, $sched->get_error_data()['fields'] );
			}
		}
		if ( isset( $data['workplaces'] ) && ! array_filter( array_map( 'intval', (array) $data['workplaces'] ) ) ) {
			$errors['workplaces'] = __( 'Assegna almeno una sede.', 'dolly-employee-management' );
		}
		if ( $errors ) {
			return new WP_Error( 'dolly_invalid', __( 'Controlla i campi evidenziati.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => $errors ) );
		}
		$update = array( 'ID' => $user_id );
		foreach ( array( 'first_name', 'last_name', 'email' ) as $k ) {
			if ( isset( $id_data[ $k ] ) ) {
				$update[ 'email' === $k ? 'user_email' : $k ] = $id_data[ $k ];
			}
		}
		if ( isset( $id_data['first_name'] ) || isset( $id_data['last_name'] ) ) {
			$u                      = get_userdata( $user_id );
			$update['display_name'] = trim( ( $id_data['first_name'] ?? $u->first_name ) . ' ' . ( $id_data['last_name'] ?? $u->last_name ) );
		}
		$r = wp_update_user( $update );
		if ( is_wp_error( $r ) ) {
			return new WP_Error( 'dolly_invalid', $r->get_error_message(), array( 'status' => 400 ) );
		}
		if ( isset( $id_data['phone'] ) ) {
			update_user_meta( $user_id, 'dolly_phone', $id_data['phone'] );
		}
		self::save_bank( $user_id, $bank, sanitize_text_field( $data['reason'] ?? '' ) );
		if ( isset( $data['schedule'] ) ) {
			Dolly_Schedules::set( $user_id, $data['schedule'], $from );
		}
		if ( isset( $data['workplaces'] ) ) {
			Dolly_Workplaces::set_user_assignments( $user_id, (array) $data['workplaces'], $from );
		}
		$after = self::format( $user_id );
		$diff_before = array_intersect_key( $before, array_flip( array( 'first_name', 'last_name', 'email', 'phone' ) ) );
		$diff_after  = array_intersect_key( $after, $diff_before );
		if ( $diff_before !== $diff_after ) {
			Dolly_Audit::log( 'employee_updated', 'user', $user_id, $user_id, sanitize_text_field( $data['reason'] ?? '' ), $diff_before, $diff_after );
		}
		return self::format( $user_id, true );
	}

	/**
	 * Activates or deactivates an employee. Deactivation destroys all sessions; history is preserved.
	 */
	public static function set_active( $user_id, $active, $reason ) {
		if ( ! self::is_employee( $user_id ) ) {
			return new WP_Error( 'dolly_not_found', __( 'Dipendente non trovato.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$reason = sanitize_textarea_field( $reason );
		if ( '' === $reason ) {
			return new WP_Error( 'dolly_invalid', __( 'Indica il motivo.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'reason' => __( 'Indica il motivo.', 'dolly-employee-management' ) ) ) );
		}
		$was = self::is_active( $user_id );
		if ( $was === (bool) $active ) {
			return self::format( $user_id, true );
		}
		update_user_meta( $user_id, 'dolly_active', $active ? 1 : 0 );
		if ( ! $active ) {
			update_user_meta( $user_id, 'dolly_deactivated_at', Dolly_Time::now_utc() );
			WP_Session_Tokens::get_instance( $user_id )->destroy_all();
		}
		Dolly_Audit::log( $active ? 'employee_reactivated' : 'employee_deactivated', 'user', $user_id, $user_id, $reason, array( 'active' => $was ), array( 'active' => (bool) $active ) );
		return self::format( $user_id, true );
	}

	public static function admin_set_password( $user_id, $password ) {
		if ( ! self::is_employee( $user_id ) ) {
			return new WP_Error( 'dolly_not_found', __( 'Dipendente non trovato.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		if ( strlen( (string) $password ) < 8 ) {
			return new WP_Error( 'dolly_invalid', __( 'La password deve avere almeno 8 caratteri.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'password' => __( 'Minimo 8 caratteri.', 'dolly-employee-management' ) ) ) );
		}
		wp_set_password( $password, $user_id ); // Also destroys existing sessions.
		Dolly_Audit::log( 'password_reset', 'user', $user_id, $user_id );
		return true;
	}

	public static function query( $args ) {
		$per   = max( 1, min( 100, (int) ( $args['per_page'] ?? 20 ) ) );
		$page  = max( 1, (int) ( $args['page'] ?? 1 ) );
		// Alphabetical by surname, then first name.
		$query = array(
			'role'        => Dolly_Install::ROLE_EMPLOYEE,
			'number'      => $per,
			'paged'       => $page,
			'meta_query'  => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- plugin tables ($wpdb->prefix), values prepared or cast.
				'relation' => 'AND',
				'dolly_ln' => array( 'key' => 'last_name', 'compare' => 'EXISTS' ),
				'dolly_fn' => array( 'key' => 'first_name', 'compare' => 'EXISTS' ),
			),
			'orderby'     => array(
				'dolly_ln' => 'ASC',
				'dolly_fn' => 'ASC',
			),
			'count_total' => true,
		);
		if ( ! empty( $args['search'] ) ) {
			$query['search']         = '*' . sanitize_text_field( $args['search'] ) . '*';
			$query['search_columns'] = array( 'user_login', 'user_email', 'display_name' );
		}
		$status = $args['status'] ?? 'all';
		if ( 'active' === $status ) {
			$query['meta_query'][] = array(
				'relation' => 'OR',
				array( 'key' => 'dolly_active', 'compare' => 'NOT EXISTS' ),
				array( 'key' => 'dolly_active', 'value' => '1' ),
			);
		} elseif ( 'inactive' === $status ) {
			$query['meta_query'][] = array( 'key' => 'dolly_active', 'value' => '0' );
		}
		if ( ! empty( $args['workplace'] ) ) {
			$ids             = Dolly_Workplaces::user_ids_for_workplace( (int) $args['workplace'] );
			$query['include'] = $ids ? $ids : array( 0 );
		}
		$q     = new WP_User_Query( $query );
		$total = (int) $q->get_total();
		return array(
			'items' => array_map( array( __CLASS__, 'format' ), $q->get_results() ),
			'total' => $total,
			'pages' => (int) ceil( $total / $per ),
			'page'  => $page,
		);
	}

	/**
	 * Employee self-service profile update: first/last name, phone, email and bank details.
	 * When the employee changes the IBAN, the administrators are notified.
	 */
	public static function update_profile( $user_id, $data ) {
		$data                       = (array) $data;
		$allowed                    = array_intersect_key( $data, array_flip( array( 'first_name', 'last_name', 'phone', 'email' ) ) );
		list( $id_data, $errors )   = self::validate_identity( $allowed, $user_id );
		list( $bank, $bank_errors ) = self::validate_bank( array_intersect_key( $data, self::BANK_FIELDS ) );
		$errors                     = array_merge( $errors, $bank_errors );
		if ( $errors ) {
			return new WP_Error( 'dolly_invalid', __( 'Controlla i campi evidenziati.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => $errors ) );
		}
		$before = self::format( $user_id );
		if ( $id_data ) {
			$update = array( 'ID' => $user_id );
			foreach ( array( 'first_name', 'last_name' ) as $k ) {
				if ( isset( $id_data[ $k ] ) ) {
					$update[ $k ] = $id_data[ $k ];
				}
			}
			if ( isset( $id_data['email'] ) ) {
				$update['user_email'] = $id_data['email'];
			}
			$u                      = get_userdata( $user_id );
			$update['display_name'] = trim( ( $id_data['first_name'] ?? $u->first_name ) . ' ' . ( $id_data['last_name'] ?? $u->last_name ) );
			$r                      = wp_update_user( $update );
			if ( is_wp_error( $r ) ) {
				return new WP_Error( 'dolly_invalid', $r->get_error_message(), array( 'status' => 400 ) );
			}
			if ( isset( $id_data['phone'] ) ) {
				update_user_meta( $user_id, 'dolly_phone', $id_data['phone'] );
			}
		}
		$after = self::format( $user_id );
		$keys  = array_flip( array( 'first_name', 'last_name', 'email', 'phone' ) );
		if ( array_intersect_key( $before, $keys ) !== array_intersect_key( $after, $keys ) ) {
			Dolly_Audit::log( 'profile_updated', 'user', $user_id, $user_id, '', array_intersect_key( $before, $keys ), array_intersect_key( $after, $keys ) );
		}

		$old_bank = self::save_bank( $user_id, $bank, __( 'Modifica dal profilo del dipendente', 'dolly-employee-management' ) );
		if ( null !== $old_bank && isset( $bank['iban'] ) && $old_bank['iban'] !== $bank['iban'] ) {
			$new_bank = self::bank( $user_id );
			$name     = self::display_name( $user_id );
			$body     = sprintf(
				__( "%1\$s ha modificato l'IBAN dal proprio profilo.\nPrecedente: %2\$s\nNuovo: %3\$s\nBeneficiario: %4\$s\nBanca: %5\$s\nBIC: %6\$s\nVerifica i dati completi in Gestione Dipendenti › Dipendenti.", 'dolly-employee-management' ),
				$name,
				'' !== $old_bank['iban'] ? self::mask_iban( $old_bank['iban'] ) : __( 'non indicato', 'dolly-employee-management' ),
				'' !== $new_bank['iban'] ? self::mask_iban( $new_bank['iban'] ) : 'rimosso',
				'' !== $new_bank['bank_beneficiary'] ? $new_bank['bank_beneficiary'] : '—',
				'' !== $new_bank['bank_name'] ? $new_bank['bank_name'] : '—',
				'' !== $new_bank['bic'] ? $new_bank['bic'] : '—'
			);
			Dolly_Notifications::notify_admins( 'iban_changed', fn () => array( __( 'IBAN modificato: ', 'dolly-employee-management' ) . $name, $body ), null, 'dolly-employees', 'iban-' . $user_id . '-' . md5( $new_bank['iban'] . '|' . time() ) );
		}
		return self::format( $user_id );
	}

	public static function change_password( $user_id, $current, $new ) {
		$u = get_userdata( $user_id );
		if ( ! $u || ! wp_check_password( (string) $current, $u->user_pass, $user_id ) ) {
			return new WP_Error( 'dolly_invalid', __( 'La password attuale non è corretta.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'current_password' => __( 'Password attuale non corretta.', 'dolly-employee-management' ) ) ) );
		}
		if ( strlen( (string) $new ) < 8 ) {
			return new WP_Error( 'dolly_invalid', __( 'La nuova password deve avere almeno 8 caratteri.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'new_password' => __( 'Minimo 8 caratteri.', 'dolly-employee-management' ) ) ) );
		}
		wp_set_password( $new, $user_id );
		// Keep the current browser signed in after the password change.
		wp_set_auth_cookie( $user_id, true, is_ssl() );
		return true;
	}
}
