<?php
/**
 * Device sessions: an employee signs in only from the registered devices (one by default; the
 * administrator can raise the limit per employee and unlink devices).
 *
 * A device is recognised by a random token kept in a long-lived, HTTP-only cookie; only its hash is
 * stored. The first sign-in registers the device as the main one. With the limit reached, a sign-in
 * from another device is refused with the name of the registered device. Administrators and workplace
 * accounts are not subject to the rule.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Devices {

	const COOKIE         = 'dolly_device';
	const COOKIE_BLOCKED = 'dolly_device_blocked';
	const LIMIT_META     = 'dolly_device_limit';
	const MAX_LIMIT      = 10;

	public static function init() {
		add_filter( 'authenticate', array( __CLASS__, 'check_login' ), 100 );
		add_action( 'wp_login', array( __CLASS__, 'on_login' ), 10, 2 );
		add_action( 'init', array( __CLASS__, 'guard' ), 2 );
	}

	public static function enabled() {
		return (bool) Dolly_Settings::get( 'device_sessions' );
	}

	/** Employees only: administrators and workplace displays sign in from any device. */
	public static function applies( $user ) {
		return $user instanceof WP_User
			&& in_array( Dolly_Install::ROLE_EMPLOYEE, (array) $user->roles, true )
			&& ! user_can( $user, 'dolly_manage' )
			&& ! in_array( Dolly_Install::ROLE_WORKPLACE, (array) $user->roles, true );
	}

	public static function limit( $user_id ) {
		$v = (int) get_user_meta( $user_id, self::LIMIT_META, true );
		return max( 1, min( self::MAX_LIMIT, $v ? $v : 1 ) );
	}

	private static function table() {
		return Dolly_Install::t( 'devices' );
	}

	/** Registered (not unlinked) devices of a user, oldest first: the first one is the main device. */
	public static function active( $user_id ) {
		global $wpdb;
		$t = self::table();
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND revoked_at IS NULL ORDER BY created_at ASC, id ASC", $user_id ) ); // phpcs:ignore
	}

	/** Device of this browser/app for the user, or null. */
	private static function current( $user_id ) {
		global $wpdb;
		$token = isset( $_COOKIE[ self::COOKIE ] ) ? (string) wp_unslash( $_COOKIE[ self::COOKIE ] ) : ''; // phpcs:ignore
		if ( ! preg_match( '/^[a-f0-9]{64}$/', $token ) ) {
			return null;
		}
		$t = self::table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE token_hash = %s AND user_id = %d AND revoked_at IS NULL", hash( 'sha256', $token ), $user_id ) ); // phpcs:ignore
	}

	private static function set_cookie( $name, $value, $expires, $http_only = true ) {
		if ( headers_sent() ) {
			return false;
		}
		setcookie(
			$name,
			$value,
			array(
				'expires'  => $expires,
				'path'     => '/',
				'domain'   => COOKIE_DOMAIN ? COOKIE_DOMAIN : '',
				'secure'   => is_ssl(),
				'httponly' => $http_only,
				'samesite' => 'Lax',
			)
		);
		return true;
	}

	/** "iPhone · Safari", "Android (SM-G991B) · Chrome", "PC Windows · Edge"... */
	public static function name_from_ua( $ua ) {
		$ua = (string) $ua;
		$os = __( 'Dispositivo', 'dolly-employee-management' );
		if ( false !== stripos( $ua, 'iPhone' ) ) {
			$os = 'iPhone';
		} elseif ( false !== stripos( $ua, 'iPad' ) ) {
			$os = 'iPad';
		} elseif ( false !== stripos( $ua, 'Android' ) ) {
			$os = 'Android';
			if ( preg_match( '/Android [\d.]+; ([^;)]+?)(?: Build|\))/', $ua, $m ) ) {
				$model = trim( $m[1] );
				// Recent browsers hide the model ("K"): keep it only when it says something.
				if ( strlen( $model ) > 1 && 'wv' !== $model ) {
					$os = 'Android (' . sanitize_text_field( $model ) . ')';
				}
			}
		} elseif ( false !== stripos( $ua, 'Windows' ) ) {
			$os = 'PC Windows';
		} elseif ( false !== stripos( $ua, 'Macintosh' ) ) {
			$os = 'Mac';
		} elseif ( false !== stripos( $ua, 'Linux' ) ) {
			$os = 'PC Linux';
		}
		$browser = '';
		foreach ( array( 'Edg' => 'Edge', 'SamsungBrowser' => 'Samsung Internet', 'OPR' => 'Opera', 'CriOS' => 'Chrome', 'FxiOS' => 'Firefox', 'Firefox' => 'Firefox', 'Chrome' => 'Chrome', 'Safari' => 'Safari' ) as $needle => $label ) {
			if ( false !== strpos( $ua, $needle ) ) {
				$browser = $label;
				break;
			}
		}
		return mb_substr( $os . ( $browser ? ' · ' . $browser : '' ), 0, 120 );
	}

	/** Registers this browser/app as a device of the user and stores the token in the cookie. */
	private static function register( $user_id ) {
		global $wpdb;
		$token = bin2hex( random_bytes( 32 ) );
		if ( ! self::set_cookie( self::COOKIE, $token, time() + 2 * YEAR_IN_SECONDS ) ) {
			return null;
		}
		$_COOKIE[ self::COOKIE ] = $token;
		$ua  = isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '';
		$now = Dolly_Time::now_utc();
		$wpdb->insert(
			self::table(),
			array(
				'user_id'      => $user_id,
				'token_hash'   => hash( 'sha256', $token ),
				'name'         => self::name_from_ua( $ua ),
				'user_agent'   => mb_substr( $ua, 0, 255 ),
				'created_at'   => $now,
				'last_seen_at' => $now,
			)
		);
		$id = (int) $wpdb->insert_id;
		Dolly_Audit::log( 'device_registered', 'device', $id, $user_id, '', null, array( 'name' => self::name_from_ua( $ua ) ) );
		return $id;
	}

	private static function blocked_message( $user_id ) {
		$devices = self::active( $user_id );
		$names   = array();
		foreach ( $devices as $d ) {
			$names[] = '«' . $d->name . __( '» (collegato il ', 'dolly-employee-management' ) . Dolly_Time::utc_to_local( $d->created_at, 'd/m/Y' ) . ')';
		}
		return sprintf(
			__( 'Questo account è già collegato %s: %s. Per accedere da questo dispositivo chiedi all\'amministrazione di scollegare il dispositivo precedente.', 'dolly-employee-management' ),
			count( $names ) > 1 ? __( 'al numero massimo di dispositivi', 'dolly-employee-management' ) : __( 'a un altro dispositivo', 'dolly-employee-management' ),
			implode( ', ', $names )
		);
	}

	/** Sign-in: refused from an unknown device once the limit of registered devices is reached. */
	public static function check_login( $user ) {
		if ( ! $user instanceof WP_User || ! self::enabled() || ! self::applies( $user ) ) {
			return $user;
		}
		if ( self::current( $user->ID ) || count( self::active( $user->ID ) ) < self::limit( $user->ID ) ) {
			return $user;
		}
		return new WP_Error( 'dolly_device', self::blocked_message( $user->ID ) );
	}

	/** Successful sign-in: the first device (or a further one within the limit) is registered. */
	public static function on_login( $login, $user = null ) {
		if ( ! $user instanceof WP_User || ! self::enabled() || ! self::applies( $user ) ) {
			return;
		}
		$dev = self::current( $user->ID );
		if ( $dev ) {
			self::seen( $dev, true );
		} elseif ( count( self::active( $user->ID ) ) < self::limit( $user->ID ) ) {
			self::register( $user->ID );
		}
	}

	private static function seen( $dev, $force = false ) {
		global $wpdb;
		if ( $force || time() - Dolly_Time::utc_ts( $dev->last_seen_at ) > 15 * MINUTE_IN_SECONDS ) {
			$wpdb->update( self::table(), array( 'last_seen_at' => Dolly_Time::now_utc() ), array( 'id' => (int) $dev->id ) );
			// Browsers cap the cookie lifetime (Chrome: 400 days): renew it while the device is in use,
			// otherwise the main device would stop being recognised after about a year.
			$token = isset( $_COOKIE[ self::COOKIE ] ) ? (string) wp_unslash( $_COOKIE[ self::COOKIE ] ) : ''; // phpcs:ignore
			if ( preg_match( '/^[a-f0-9]{64}$/', $token ) ) {
				self::set_cookie( self::COOKIE, $token, time() + 2 * YEAR_IN_SECONDS );
			}
		}
	}

	/**
	 * Every request of a signed-in employee: a session on a device that is not registered is adopted
	 * while there is room (e.g. sessions opened before the feature was enabled), otherwise it is closed.
	 */
	public static function guard() {
		$user = wp_get_current_user();
		if ( ! $user->exists() || ! self::enabled() || ! self::applies( $user ) ) {
			return;
		}
		$dev = self::current( $user->ID );
		if ( $dev ) {
			self::seen( $dev );
			return;
		}
		// Adoption of an existing session. The app sends several requests at once: they are serialised so
		// that only one registers the device.
		global $wpdb;
		$lock   = $wpdb->prefix . 'dolly_dev_' . (int) $user->ID;
		$locked = (bool) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 5)', $lock ) );
		$active = self::active( $user->ID );
		$room   = count( $active ) < self::limit( $user->ID );
		if ( $room ) {
			self::register( $user->ID );
		}
		if ( $locked ) {
			$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock ) );
		}
		if ( $room || headers_sent() ) {
			return;
		}
		// The requests sent in parallel with the one that has just registered the device left before its
		// cookie arrived: for a minute after a registration a session without the cookie is not closed.
		$newest = end( $active );
		if ( $newest && time() - Dolly_Time::utc_ts( $newest->created_at ) < MINUTE_IN_SECONDS ) {
			return;
		}
		// Shown on the sign-in page after the redirect.
		self::set_cookie( self::COOKIE_BLOCKED, (int) $user->ID . '|' . wp_hash( 'dolly_device_blocked|' . (int) $user->ID ), time() + 5 * MINUTE_IN_SECONDS );
		$token = wp_get_session_token();
		if ( $token ) {
			WP_Session_Tokens::get_instance( $user->ID )->destroy( $token );
		}
		wp_clear_auth_cookie();
		wp_set_current_user( 0 );
	}

	/** Message for the sign-in page when the session of this device has just been closed (shown once). */
	public static function take_blocked_message() {
		$v = isset( $_COOKIE[ self::COOKIE_BLOCKED ] ) ? (string) wp_unslash( $_COOKIE[ self::COOKIE_BLOCKED ] ) : ''; // phpcs:ignore
		// Signed value: the device names of an account are shown only to the browser that was just signed out.
		if ( ! preg_match( '/^(\d+)\|([a-f0-9]+)$/', $v, $m ) || ! hash_equals( wp_hash( 'dolly_device_blocked|' . (int) $m[1] ), $m[2] ) ) {
			return '';
		}
		self::set_cookie( self::COOKIE_BLOCKED, '', time() - DAY_IN_SECONDS );
		return self::enabled() ? self::blocked_message( (int) $m[1] ) : '';
	}

	/* ---------- Administration ---------- */

	public static function format( $d ) {
		return array(
			'id'           => (int) $d->id,
			'name'         => $d->name,
			'user_agent'   => $d->user_agent,
			'created_at'   => Dolly_Time::iso( $d->created_at ),
			'last_seen_at' => Dolly_Time::iso( $d->last_seen_at ),
		);
	}

	/** Devices and limit of one employee (tab "Gestione dispositivi" of the employee). */
	public static function for_user( $user_id ) {
		return array(
			'enabled'   => self::enabled(),
			'max_limit' => self::MAX_LIMIT,
			'limit'     => self::limit( $user_id ),
			'devices'   => array_map( array( __CLASS__, 'format' ), self::active( $user_id ) ),
		);
	}

	/** Employees with their registered devices, by surname. */
	public static function admin_list() {
		global $wpdb;
		$users = Dolly_Employees::active_ids();
		$by    = array();
		if ( $users ) {
			$t  = self::table();
			$in = implode( ',', array_map( 'intval', $users ) );
			foreach ( $wpdb->get_results( "SELECT * FROM $t WHERE user_id IN ($in) AND revoked_at IS NULL ORDER BY created_at ASC, id ASC" ) as $d ) { // phpcs:ignore
				$by[ (int) $d->user_id ][] = self::format( $d );
			}
		}
		$items = array();
		foreach ( $users as $uid ) {
			$items[] = array(
				'user_id'  => $uid,
				'employee' => Dolly_Employees::sort_name( $uid ),
				'limit'    => self::limit( $uid ),
				'devices'  => $by[ $uid ] ?? array(),
			);
		}
		usort( $items, function ( $a, $b ) {
			return strcasecmp( remove_accents( $a['employee'] ), remove_accents( $b['employee'] ) );
		} );
		return array(
			'enabled'   => self::enabled(),
			'max_limit' => self::MAX_LIMIT,
			'items'     => $items,
		);
	}

	/** Unlinks a device: the employee is signed out everywhere and the next sign-in registers the new device. */
	public static function revoke( $device_id ) {
		global $wpdb;
		$t = self::table();
		$d = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d", $device_id ) ); // phpcs:ignore
		if ( ! $d || $d->revoked_at ) {
			return new WP_Error( 'dolly_not_found', __( 'Dispositivo non trovato o già scollegato.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$wpdb->update( $t, array( 'revoked_at' => Dolly_Time::now_utc(), 'revoked_by' => get_current_user_id() ), array( 'id' => (int) $d->id ) );
		WP_Session_Tokens::get_instance( (int) $d->user_id )->destroy_all();
		Dolly_Audit::log( 'device_unlinked', 'device', (int) $d->id, (int) $d->user_id, '', array( 'name' => $d->name ), null );
		return self::admin_list();
	}

	public static function set_limit( $user_id, $limit ) {
		if ( ! Dolly_Employees::is_employee( $user_id ) ) {
			return new WP_Error( 'dolly_not_found', __( 'Dipendente non trovato.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$limit = (int) $limit;
		if ( $limit < 1 || $limit > self::MAX_LIMIT ) {
			return new WP_Error( 'dolly_invalid', __( 'Il limite deve essere compreso tra 1 e ', 'dolly-employee-management' ) . self::MAX_LIMIT . '.', array( 'status' => 400, 'fields' => array( 'limit' => __( 'Valore tra 1 e ', 'dolly-employee-management' ) . self::MAX_LIMIT . '.' ) ) );
		}
		$before = self::limit( $user_id );
		update_user_meta( $user_id, self::LIMIT_META, $limit );
		if ( $before !== $limit ) {
			Dolly_Audit::log( 'device_limit_changed', 'employee', $user_id, $user_id, '', array( 'limit' => $before ), array( 'limit' => $limit ) );
		}
		return self::admin_list();
	}
}
