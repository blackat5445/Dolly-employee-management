<?php
/**
 * Clock-in verification: GPS, rotating QR/PIN challenges, and administrator exceptions.
 *
 * Challenges are derived deterministically per workplace and 15-second window with an HMAC,
 * so no rows are written every rotation and expiry is always checked against server time.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class MEM_Verification {

	const WINDOW        = 15;
	const TICKET_TTL    = 90;

	private static function secret() {
		return wp_salt( 'auth' ) . '|dolly-challenge';
	}

	public static function current_window() {
		return (int) floor( time() / self::WINDOW );
	}

	public static function challenge( $workplace_id, $window = null ) {
		$window = null === $window ? self::current_window() : (int) $window;
		$token  = substr( hash_hmac( 'sha256', 'qr|' . $workplace_id . '|' . $window, self::secret() ), 0, 24 );
		$pinraw = hexdec( substr( hash_hmac( 'sha256', 'pin|' . $workplace_id . '|' . $window, self::secret() ), 0, 12 ) );
		$pin    = str_pad( (string) ( $pinraw % 1000000 ), 6, '0', STR_PAD_LEFT );
		$code   = $workplace_id . '.' . $window . '.' . $token;
		return array(
			'workplace_id' => (int) $workplace_id,
			'window'       => $window,
			'code'         => $code,
			'qr_payload'   => add_query_arg( 'mc', $code, home_url( '/portale/' ) ),
			'pin'          => $pin,
			'starts_at'    => $window * self::WINDOW,
			'expires_at'   => ( $window + 1 ) * self::WINDOW,
		);
	}

	/** Windows that are currently acceptable: the current one and, within the grace period, the previous one. */
	private static function acceptable_windows() {
		$now     = time();
		$current = (int) floor( $now / self::WINDOW );
		$grace   = (int) MEM_Settings::get( 'challenge_grace' );
		$windows = array( $current );
		if ( $grace > 0 && ( $now - $current * self::WINDOW ) < $grace ) {
			$windows[] = $current - 1;
		}
		return $windows;
	}

	/**
	 * Validates a scanned QR code for a user. Returns ['workplace_id','method','ref'] or WP_Error.
	 */
	public static function verify_qr( $user_id, $raw ) {
		$raw = trim( (string) $raw );
		if ( false !== strpos( $raw, 'mc=' ) ) {
			$parts = wp_parse_url( $raw );
			parse_str( $parts['query'] ?? '', $q );
			$raw = $q['mc'] ?? '';
		}
		if ( ! preg_match( '/^(\d+)\.(\d+)\.([a-f0-9]{24})$/', $raw, $m ) ) {
			return new WP_Error( 'mem_qr_invalid', 'Il codice QR non è un codice presenze Dolly valido.', array( 'status' => 400 ) );
		}
		$wid    = (int) $m[1];
		$window = (int) $m[2];
		$token  = $m[3];
		$expect = self::challenge( $wid, $window );
		if ( ! hash_equals( substr( $expect['code'], -24 ), $token ) ) {
			return new WP_Error( 'mem_qr_invalid', 'Il codice QR non è valido.', array( 'status' => 400 ) );
		}
		if ( ! in_array( $wid, MEM_Workplaces::ids_for_user( $user_id ), true ) ) {
			return new WP_Error( 'mem_wrong_workplace', 'Questo codice appartiene a una sede che non ti è assegnata.', array( 'status' => 403 ) );
		}
		if ( ! in_array( $window, self::acceptable_windows(), true ) ) {
			return new WP_Error( 'mem_challenge_expired', 'Il codice QR è scaduto. Inquadra il codice aggiornato sullo schermo della sede.', array( 'status' => 410 ) );
		}
		return array(
			'workplace_id' => $wid,
			'method'       => 'qr',
			'ref'          => 'qr:' . $wid . ':' . $window,
		);
	}

	/**
	 * Validates a PIN against the user's assigned workplaces, with rate limiting of invalid attempts.
	 */
	public static function verify_pin( $user_id, $pin ) {
		$lock_key = 'mem_pin_lock_' . $user_id;
		$fail_key = 'mem_pin_fail_' . $user_id;
		$locked   = get_transient( $lock_key );
		if ( $locked ) {
			$mins = max( 1, (int) ceil( ( (int) $locked - time() ) / 60 ) );
			return new WP_Error( 'mem_pin_locked', sprintf( 'Troppi PIN errati. Riprova tra %d minuti oppure usa il QR.', $mins ), array( 'status' => 429 ) );
		}
		$pin = preg_replace( '/\D/', '', (string) $pin );
		if ( 6 !== strlen( $pin ) ) {
			return new WP_Error( 'mem_pin_invalid', 'Il PIN deve essere di 6 cifre.', array( 'status' => 400 ) );
		}
		foreach ( MEM_Workplaces::ids_for_user( $user_id ) as $wid ) {
			foreach ( self::acceptable_windows() as $window ) {
				$c = self::challenge( $wid, $window );
				if ( hash_equals( $c['pin'], $pin ) ) {
					delete_transient( $fail_key );
					return array(
						'workplace_id' => $wid,
						'method'       => 'pin',
						'ref'          => 'pin:' . $wid . ':' . $window,
					);
				}
			}
		}
		$max   = (int) MEM_Settings::get( 'pin_max_attempts' );
		$mins  = (int) MEM_Settings::get( 'pin_lock_minutes' );
		$fails = (int) get_transient( $fail_key ) + 1;
		set_transient( $fail_key, $fails, $mins * MINUTE_IN_SECONDS );
		if ( $fails >= $max ) {
			set_transient( $lock_key, time() + $mins * MINUTE_IN_SECONDS, $mins * MINUTE_IN_SECONDS );
			delete_transient( $fail_key );
			return new WP_Error( 'mem_pin_locked', sprintf( 'Troppi PIN errati. Riprova tra %d minuti oppure usa il QR.', $mins ), array( 'status' => 429 ) );
		}
		return new WP_Error( 'mem_pin_invalid', sprintf( 'PIN errato o scaduto. Tentativi rimasti: %d.', $max - $fails ), array( 'status' => 400 ) );
	}

	/**
	 * Checks the position against assigned workplaces. Location is only received during clocking.
	 */
	public static function verify_gps( $user_id, $gps ) {
		if ( ! is_array( $gps ) || ! isset( $gps['lat'], $gps['lng'] ) || ! is_numeric( $gps['lat'] ) || ! is_numeric( $gps['lng'] ) ) {
			return new WP_Error( 'mem_gps_missing', 'Posizione non disponibile. Consenti l\'accesso alla posizione e riprova.', array( 'status' => 400 ) );
		}
		$lat      = (float) $gps['lat'];
		$lng      = (float) $gps['lng'];
		$accuracy = isset( $gps['accuracy'] ) ? (int) round( (float) $gps['accuracy'] ) : null;
		$best     = null;
		$nearest  = null;
		foreach ( MEM_Workplaces::for_user( $user_id ) as $w ) {
			if ( null === $w->lat || null === $w->lng ) {
				continue;
			}
			$d = MEM_Workplaces::distance( $lat, $lng, (float) $w->lat, (float) $w->lng );
			if ( null === $nearest || $d < $nearest['distance'] ) {
				$nearest = array( 'w' => $w, 'distance' => $d );
			}
			if ( $d <= (int) $w->radius_m && ( null === $best || $d < $best['distance'] ) ) {
				$best = array( 'w' => $w, 'distance' => $d );
			}
		}
		if ( ! $best ) {
			if ( ! $nearest ) {
				return new WP_Error( 'mem_gps_no_workplace', 'Nessuna sede assegnata ha coordinate configurate. Usa il QR/PIN o contatta l\'amministratore.', array( 'status' => 400 ) );
			}
			$msg = sprintf( 'Sei a circa %d m da %s (raggio consentito %d m).', (int) round( $nearest['distance'] ), $nearest['w']->name, (int) $nearest['w']->radius_m );
			if ( $accuracy && $accuracy > (int) $nearest['w']->radius_m ) {
				$msg .= sprintf( ' La precisione del GPS è bassa (±%d m): riprova all\'aperto o usa il QR/PIN.', $accuracy );
			}
			return new WP_Error( 'mem_gps_out_of_range', $msg, array( 'status' => 403 ) );
		}
		return array(
			'workplace_id' => (int) $best['w']->id,
			'method'       => 'gps',
			'lat'          => $lat,
			'lng'          => $lng,
			'accuracy'     => $accuracy,
			'distance'     => (int) round( $best['distance'] ),
		);
	}

	/**
	 * Short-lived signed ticket proving a successful QR/PIN check, used when the employee confirms.
	 */
	public static function issue_ticket( $user_id, $result ) {
		$payload = array(
			'u' => (int) $user_id,
			'w' => (int) $result['workplace_id'],
			'm' => $result['method'],
			'r' => $result['ref'],
			'e' => time() + self::TICKET_TTL,
		);
		$json = wp_json_encode( $payload );
		$sig  = hash_hmac( 'sha256', $json, self::secret() . '|ticket' );
		return rtrim( strtr( base64_encode( $json ), '+/', '-_' ), '=' ) . '.' . $sig;
	}

	public static function read_ticket( $user_id, $ticket ) {
		$parts = explode( '.', (string) $ticket );
		if ( 2 !== count( $parts ) ) {
			return new WP_Error( 'mem_ticket_invalid', 'Verifica QR/PIN non valida. Ripeti la verifica.', array( 'status' => 400 ) );
		}
		$json = base64_decode( strtr( $parts[0], '-_', '+/' ) ); // phpcs:ignore
		if ( ! $json || ! hash_equals( hash_hmac( 'sha256', $json, self::secret() . '|ticket' ), $parts[1] ) ) {
			return new WP_Error( 'mem_ticket_invalid', 'Verifica QR/PIN non valida. Ripeti la verifica.', array( 'status' => 400 ) );
		}
		$p = json_decode( $json, true );
		if ( (int) $p['u'] !== (int) $user_id ) {
			return new WP_Error( 'mem_ticket_invalid', 'Verifica QR/PIN non valida.', array( 'status' => 403 ) );
		}
		if ( (int) $p['e'] < time() ) {
			return new WP_Error( 'mem_challenge_expired', 'La verifica QR/PIN è scaduta. Ripeti la scansione o inserisci il nuovo PIN.', array( 'status' => 410 ) );
		}
		if ( ! in_array( (int) $p['w'], MEM_Workplaces::ids_for_user( $user_id ), true ) ) {
			return new WP_Error( 'mem_wrong_workplace', 'La sede verificata non ti è assegnata.', array( 'status' => 403 ) );
		}
		return array(
			'workplace_id' => (int) $p['w'],
			'method'       => $p['m'],
			'ref'          => $p['r'],
		);
	}

	/* ---------- Administrator exceptions (bypass both GPS and QR/PIN) ---------- */

	public static function active_exception( $user_id ) {
		global $wpdb;
		$t = MEM_Install::t( 'exceptions' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND revoked_at IS NULL AND expires_at > %s ORDER BY expires_at DESC LIMIT 1", $user_id, MEM_Time::now_utc() ) ); // phpcs:ignore
	}

	public static function format_exception( $e ) {
		if ( ! $e ) {
			return null;
		}
		$now = MEM_Time::now_utc();
		return array(
			'id'         => (int) $e->id,
			'reason'     => $e->reason,
			'expires_at' => MEM_Time::iso( $e->expires_at ),
			'use_count'  => (int) $e->use_count,
			'created_by' => MEM_Employees::display_name( (int) $e->created_by ),
			'created_at' => MEM_Time::iso( $e->created_at ),
			'revoked_at' => MEM_Time::iso( $e->revoked_at ),
			'active'     => ! $e->revoked_at && $e->expires_at > $now,
		);
	}

	public static function exceptions_for( $user_id, $limit = 10 ) {
		global $wpdb;
		$t    = MEM_Install::t( 'exceptions' );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d ORDER BY id DESC LIMIT %d", $user_id, $limit ) ); // phpcs:ignore
		return array_map( array( __CLASS__, 'format_exception' ), $rows );
	}

	/**
	 * @param string|null $expires_local Rome "Y-m-d H:i" or null for 23:59 today.
	 */
	public static function create_exception( $user_id, $reason, $expires_local = null ) {
		global $wpdb;
		if ( ! MEM_Employees::is_employee( $user_id ) ) {
			return new WP_Error( 'mem_not_found', 'Dipendente non trovato.', array( 'status' => 404 ) );
		}
		$reason = sanitize_textarea_field( $reason );
		if ( '' === $reason ) {
			return new WP_Error( 'mem_invalid', 'Indica il motivo dell\'eccezione.', array( 'status' => 400, 'fields' => array( 'reason' => 'Indica il motivo.' ) ) );
		}
		if ( $expires_local ) {
			if ( ! preg_match( '/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/', $expires_local, $m ) || ! MEM_Time::is_date( $m[1] ) || ! MEM_Time::is_time( $m[2] ) ) {
				return new WP_Error( 'mem_invalid', 'Scadenza non valida.', array( 'status' => 400, 'fields' => array( 'expires_at' => 'Scadenza non valida.' ) ) );
			}
			$expires = MEM_Time::local_to_utc( $m[1], $m[2] . ':59' );
			if ( $expires <= MEM_Time::now_utc() ) {
				return new WP_Error( 'mem_invalid', 'La scadenza deve essere futura.', array( 'status' => 400, 'fields' => array( 'expires_at' => 'La scadenza deve essere futura.' ) ) );
			}
		} else {
			$expires = MEM_Time::end_of_today_utc();
		}
		$wpdb->insert(
			MEM_Install::t( 'exceptions' ),
			array(
				'user_id'    => $user_id,
				'reason'     => $reason,
				'expires_at' => $expires,
				'created_by' => get_current_user_id(),
				'created_at' => MEM_Time::now_utc(),
			)
		);
		$id = (int) $wpdb->insert_id;
		MEM_Audit::log( 'exception_created', 'exception', $id, $user_id, $reason, null, array( 'expires_at' => MEM_Time::utc_to_local( $expires, 'd/m/Y H:i' ) ) );
		return self::format_exception( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . MEM_Install::t( 'exceptions' ) . ' WHERE id = %d', $id ) ) ); // phpcs:ignore
	}

	public static function revoke_exception( $id, $reason = '' ) {
		global $wpdb;
		$t = MEM_Install::t( 'exceptions' );
		$e = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d", $id ) ); // phpcs:ignore
		if ( ! $e ) {
			return new WP_Error( 'mem_not_found', 'Eccezione non trovata.', array( 'status' => 404 ) );
		}
		if ( ! $e->revoked_at ) {
			$wpdb->update( $t, array( 'revoked_at' => MEM_Time::now_utc(), 'revoked_by' => get_current_user_id() ), array( 'id' => $id ) );
			MEM_Audit::log( 'exception_revoked', 'exception', $id, (int) $e->user_id, sanitize_textarea_field( $reason ) );
		}
		return true;
	}

	public static function mark_exception_used( $exception, $punch_id, $action ) {
		global $wpdb;
		$t = MEM_Install::t( 'exceptions' );
		$wpdb->query( $wpdb->prepare( "UPDATE $t SET use_count = use_count + 1 WHERE id = %d", $exception->id ) ); // phpcs:ignore
		MEM_Audit::log( 'exception_used', 'punch', $punch_id, (int) $exception->user_id, $exception->reason, null, array( 'exception_id' => (int) $exception->id, 'action' => $action ) );
	}
}
