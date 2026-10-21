<?php
/**
 * Workplaces, their dedicated accounts, and employee assignments (with history).
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Workplaces {

	public static function get( $id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'workplaces' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d", $id ) ); // phpcs:ignore
	}

	public static function all( $active_only = false ) {
		global $wpdb;
		$t = Dolly_Install::t( 'workplaces' );
		$w = $active_only ? 'WHERE active = 1' : '';
		return $wpdb->get_results( "SELECT * FROM $t $w ORDER BY name ASC" ); // phpcs:ignore
	}

	public static function by_account( $user_id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'workplaces' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE account_user_id = %d AND active = 1", $user_id ) ); // phpcs:ignore
	}

	public static function format( $w ) {
		if ( ! $w ) {
			return null;
		}
		$account = $w->account_user_id ? get_userdata( (int) $w->account_user_id ) : null;
		return array(
			'id'               => (int) $w->id,
			'name'             => $w->name,
			'address'          => $w->address,
			'city'             => $w->city,
			'province'         => $w->province,
			'lat'              => null === $w->lat ? null : (float) $w->lat,
			'lng'              => null === $w->lng ? null : (float) $w->lng,
			'radius_m'         => (int) $w->radius_m,
			'late_tolerance'   => isset( $w->late_tolerance ) && null !== $w->late_tolerance ? (int) $w->late_tolerance : null,
			'active'           => (bool) $w->active,
			'account_user_id'  => $w->account_user_id ? (int) $w->account_user_id : null,
			'account_username' => $account ? $account->user_login : '',
			'bluetooth'        => Dolly_Bluetooth::enabled_for( (int) $w->id ),
		);
	}

	/**
	 * Validates workplace input. Returns array of clean data or WP_Error.
	 */
	private static function clean( $data, $is_new ) {
		$out    = array();
		$errors = array();
		if ( $is_new || isset( $data['name'] ) ) {
			$out['name'] = sanitize_text_field( $data['name'] ?? '' );
			if ( '' === $out['name'] ) {
				$errors['name'] = 'Inserisci il nome della sede.';
			}
		}
		foreach ( array( 'address', 'city' ) as $k ) {
			if ( isset( $data[ $k ] ) ) {
				$out[ $k ] = sanitize_text_field( $data[ $k ] );
			}
		}
		if ( isset( $data['province'] ) ) {
			$out['province'] = strtoupper( substr( sanitize_text_field( $data['province'] ), 0, 10 ) );
		}
		foreach ( array( 'lat' => 90, 'lng' => 180 ) as $k => $max ) {
			if ( array_key_exists( $k, $data ) ) {
				if ( '' === $data[ $k ] || null === $data[ $k ] ) {
					$out[ $k ] = null;
				} elseif ( ! is_numeric( $data[ $k ] ) || abs( (float) $data[ $k ] ) > $max ) {
					$errors[ $k ] = 'lat' === $k ? 'Latitudine non valida.' : 'Longitudine non valida.';
				} else {
					$out[ $k ] = round( (float) $data[ $k ], 7 );
				}
			}
		}
		if ( isset( $data['radius_m'] ) ) {
			$r = (int) $data['radius_m'];
			if ( $r < 10 || $r > 5000 ) {
				$errors['radius_m'] = 'Il raggio deve essere compreso tra 10 e 5000 metri.';
			}
			$out['radius_m'] = $r;
		} elseif ( $is_new ) {
			$out['radius_m'] = (int) Dolly_Settings::get( 'default_radius' );
		}
		// Late-entry tolerance for this workplace; empty = plugin-wide default.
		if ( array_key_exists( 'late_tolerance', $data ) ) {
			if ( '' === $data['late_tolerance'] || null === $data['late_tolerance'] ) {
				$out['late_tolerance'] = null;
			} elseif ( ! is_numeric( $data['late_tolerance'] ) || (int) $data['late_tolerance'] < 0 || (int) $data['late_tolerance'] > 120 ) {
				$errors['late_tolerance'] = 'La tolleranza deve essere compresa tra 0 e 120 minuti.';
			} else {
				$out['late_tolerance'] = (int) $data['late_tolerance'];
			}
		}
		if ( isset( $data['active'] ) ) {
			$out['active'] = $data['active'] ? 1 : 0;
		}
		if ( $errors ) {
			return new WP_Error( 'dolly_invalid', 'Controlla i campi evidenziati.', array( 'status' => 400, 'fields' => $errors ) );
		}
		return $out;
	}

	public static function create( $data ) {
		global $wpdb;
		$clean = self::clean( $data, true );
		if ( is_wp_error( $clean ) ) {
			return $clean;
		}
		$now                 = Dolly_Time::now_utc();
		$clean['created_at'] = $now;
		$clean['updated_at'] = $now;
		$wpdb->insert( Dolly_Install::t( 'workplaces' ), $clean );
		$id = (int) $wpdb->insert_id;
		if ( ! $id ) {
			return new WP_Error( 'dolly_db', 'Impossibile salvare la sede.', array( 'status' => 500 ) );
		}
		$acc = self::save_account( $id, $data );
		if ( is_wp_error( $acc ) ) {
			return $acc;
		}
		Dolly_Audit::log( 'workplace_created', 'workplace', $id, 0, '', null, self::format( self::get( $id ) ) );
		return self::format( self::get( $id ) );
	}

	public static function update( $id, $data ) {
		global $wpdb;
		$before = self::get( $id );
		if ( ! $before ) {
			return new WP_Error( 'dolly_not_found', 'Sede non trovata.', array( 'status' => 404 ) );
		}
		$clean = self::clean( $data, false );
		if ( is_wp_error( $clean ) ) {
			return $clean;
		}
		$clean['updated_at'] = Dolly_Time::now_utc();
		$wpdb->update( Dolly_Install::t( 'workplaces' ), $clean, array( 'id' => $id ) );
		$acc = self::save_account( $id, $data );
		if ( is_wp_error( $acc ) ) {
			return $acc;
		}
		Dolly_Audit::log( 'workplace_updated', 'workplace', $id, 0, sanitize_text_field( $data['reason'] ?? '' ), self::format( $before ), self::format( self::get( $id ) ) );
		return self::format( self::get( $id ) );
	}

	/**
	 * Creates the dedicated workplace account, or updates its password.
	 */
	private static function save_account( $workplace_id, $data ) {
		global $wpdb;
		$w        = self::get( $workplace_id );
		$username = isset( $data['account_username'] ) ? sanitize_user( $data['account_username'], true ) : '';
		$password = isset( $data['account_password'] ) ? (string) $data['account_password'] : '';

		if ( $w->account_user_id && get_userdata( (int) $w->account_user_id ) ) {
			if ( '' !== $password ) {
				if ( strlen( $password ) < 8 ) {
					return new WP_Error( 'dolly_invalid', 'La password dell\'account sede deve avere almeno 8 caratteri.', array( 'status' => 400, 'fields' => array( 'account_password' => 'Minimo 8 caratteri.' ) ) );
				}
				wp_set_password( $password, (int) $w->account_user_id );
			}
			return true;
		}
		if ( '' === $username ) {
			return true; // Account can be added later.
		}
		if ( username_exists( $username ) ) {
			return new WP_Error( 'dolly_invalid', 'Nome utente già in uso.', array( 'status' => 400, 'fields' => array( 'account_username' => 'Nome utente già in uso.' ) ) );
		}
		if ( strlen( $password ) < 8 ) {
			return new WP_Error( 'dolly_invalid', 'La password dell\'account sede deve avere almeno 8 caratteri.', array( 'status' => 400, 'fields' => array( 'account_password' => 'Minimo 8 caratteri.' ) ) );
		}
		$user_id = wp_insert_user(
			array(
				'user_login'   => $username,
				'user_pass'    => $password,
				'user_email'   => '',
				'display_name' => 'Sede ' . $w->name,
				'role'         => Dolly_Install::ROLE_WORKPLACE,
			)
		);
		if ( is_wp_error( $user_id ) ) {
			return new WP_Error( 'dolly_invalid', $user_id->get_error_message(), array( 'status' => 400 ) );
		}
		update_user_meta( $user_id, 'dolly_active', 1 );
		$wpdb->update( Dolly_Install::t( 'workplaces' ), array( 'account_user_id' => $user_id ), array( 'id' => $workplace_id ) );
		return true;
	}

	/** Workplace rows assigned to a user on a date. */
	public static function for_user( $user_id, $date = null ) {
		global $wpdb;
		$date = $date ? $date : Dolly_Time::today();
		$a    = Dolly_Install::t( 'assignments' );
		$w    = Dolly_Install::t( 'workplaces' );
		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT w.* FROM $a a INNER JOIN $w w ON w.id = a.workplace_id
				WHERE a.user_id = %d AND a.valid_from <= %s AND (a.valid_to IS NULL OR a.valid_to >= %s) AND w.active = 1
				ORDER BY w.name", // phpcs:ignore
				$user_id,
				$date,
				$date
			)
		);
	}

	public static function ids_for_user( $user_id, $date = null ) {
		return array_map( 'intval', wp_list_pluck( self::for_user( $user_id, $date ), 'id' ) );
	}

	/** User IDs assigned to a workplace on a date. */
	public static function user_ids_for_workplace( $workplace_id, $date = null ) {
		global $wpdb;
		$date = $date ? $date : Dolly_Time::today();
		$a    = Dolly_Install::t( 'assignments' );
		return array_map(
			'intval',
			$wpdb->get_col(
				$wpdb->prepare(
					"SELECT DISTINCT user_id FROM $a WHERE workplace_id = %d AND valid_from <= %s AND (valid_to IS NULL OR valid_to >= %s)", // phpcs:ignore
					$workplace_id,
					$date,
					$date
				)
			)
		);
	}

	/** User IDs assigned to a workplace on at least one day of a period. */
	public static function user_ids_in_range( $workplace_id, $from, $to ) {
		global $wpdb;
		$a = Dolly_Install::t( 'assignments' );
		return array_map(
			'intval',
			$wpdb->get_col(
				$wpdb->prepare(
					"SELECT DISTINCT user_id FROM $a WHERE workplace_id = %d AND valid_from <= %s AND (valid_to IS NULL OR valid_to >= %s)", // phpcs:ignore
					$workplace_id,
					$to,
					$from
				)
			)
		);
	}

	/**
	 * Replaces a user's assignments from a date, closing previous ones (history preserved).
	 */
	public static function set_user_assignments( $user_id, array $workplace_ids, $from = null ) {
		Dolly_Analytics::bump( $user_id );
		global $wpdb;
		$from    = $from ? $from : Dolly_Time::today();
		$t       = Dolly_Install::t( 'assignments' );
		$current = self::ids_for_user( $user_id, $from );
		$new     = array_values( array_unique( array_filter( array_map( 'intval', $workplace_ids ) ) ) );
		sort( $current );
		sort( $new );
		if ( $current === $new ) {
			return false;
		}
		$prev = Dolly_Time::add_days( $from, -1 );
		// Close open assignments that are not kept.
		foreach ( array_diff( $current, $new ) as $wid ) {
			$wpdb->query( $wpdb->prepare( "UPDATE $t SET valid_to = %s WHERE user_id = %d AND workplace_id = %d AND valid_from < %s AND (valid_to IS NULL OR valid_to >= %s)", $prev, $user_id, $wid, $from, $from ) ); // phpcs:ignore
			// Assignments that start on/after $from are removed entirely (never effective).
			$wpdb->query( $wpdb->prepare( "UPDATE $t SET valid_to = %s WHERE user_id = %d AND workplace_id = %d AND valid_from >= %s AND valid_to IS NULL", $prev, $user_id, $wid, $from ) ); // phpcs:ignore
		}
		foreach ( array_diff( $new, $current ) as $wid ) {
			$wpdb->insert(
				$t,
				array(
					'user_id'      => $user_id,
					'workplace_id' => $wid,
					'valid_from'   => $from,
					'valid_to'     => null,
					'created_by'   => get_current_user_id(),
					'created_at'   => Dolly_Time::now_utc(),
				)
			);
		}
		Dolly_Audit::log( 'assignments_changed', 'user', $user_id, $user_id, '', $current, $new );
		return true;
	}

	/** Late-entry tolerance in minutes for a workplace (its own value, or the plugin-wide default). */
	public static function late_tolerance( $workplace_id ) {
		static $cache = array();
		$workplace_id = (int) $workplace_id;
		if ( ! array_key_exists( $workplace_id, $cache ) ) {
			$w                       = $workplace_id ? self::get( $workplace_id ) : null;
			$cache[ $workplace_id ] = ( $w && isset( $w->late_tolerance ) ) ? (int) $w->late_tolerance : null;
		}
		return null !== $cache[ $workplace_id ] ? $cache[ $workplace_id ] : (int) Dolly_Settings::get( 'late_tolerance' );
	}

	/** Great-circle distance in metres. */
	public static function distance( $lat1, $lng1, $lat2, $lng2 ) {
		$r    = 6371000;
		$dlat = deg2rad( $lat2 - $lat1 );
		$dlng = deg2rad( $lng2 - $lng1 );
		$a    = sin( $dlat / 2 ) ** 2 + cos( deg2rad( $lat1 ) ) * cos( deg2rad( $lat2 ) ) * sin( $dlng / 2 ) ** 2;
		return $r * 2 * atan2( sqrt( $a ), sqrt( 1 - $a ) );
	}
}
