<?php
/**
 * Installable portal (web app manifest + service worker) and push notifications on phones.
 *
 * When the portal is added to the home screen, the employee is asked to allow notifications; the
 * browser subscription is stored here. Every in-app notification of a subscribed user is announced with
 * a Web Push message (VAPID, RFC 8292) carrying the notification itself, encrypted as RFC 8291 requires
 * (aes128gcm). Pushes (and queued emails) are sent at the end of the request that created them, so
 * delivery does not depend on the scheduler; the one-minute scheduler retries whatever is left.
 *
 * Servers without ECDH in OpenSSL (PHP < 7.3) send an empty push instead: the service worker then asks
 * the site for the new notifications (?dolly_pwa=feed, cookie authentication).
 *
 * Front-end endpoints (no rewrite rules needed): ?dolly_pwa=manifest | sw | feed
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Push {

	const STATE_NONE    = 0; // Nothing to push.
	const STATE_QUEUED  = 1; // To be sent.
	const STATE_SENT    = 2; // Push accepted by the push service.
	const STATE_SHOWN   = 3; // Shown by the service worker (empty-push fallback).
	const STATE_SENDING = 4; // Claimed by a sender (prevents duplicates between overlapping runs).

	/** Rough upper bound for the JSON payload (push services accept 4 KB including encryption overhead). */
	const MAX_BODY = 1200;

	private static $has_sub = array();
	private static $flush   = false;

	public static function init() {
		add_action( 'init', array( __CLASS__, 'handle_request' ), 1 );
		add_action( 'wp_head', array( __CLASS__, 'head' ), 2 );
	}

	public static function url( $what ) {
		return add_query_arg( 'dolly_pwa', $what, home_url( '/' ) );
	}

	private static function b64u( $s ) {
		return rtrim( strtr( base64_encode( $s ), '+/', '-_' ), '=' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- Base64url encoding required by Web Push (RFC 8291 / VAPID).
	}

	private static function b64u_decode( $s ) {
		$s = strtr( (string) $s, '-_', '+/' );
		return (string) base64_decode( $s . str_repeat( '=', ( 4 - strlen( $s ) % 4 ) % 4 ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- Base64url keys of the browser push subscription.
	}

	/* ---------- Keys ---------- */

	/**
	 * VAPID key pair (P-256), generated once. Returns array( public => base64url raw point, private => PEM )
	 * or null when the server's OpenSSL cannot create EC keys.
	 */
	public static function keys() {
		$k = get_option( 'dolly_vapid' );
		if ( is_array( $k ) && ! empty( $k['public'] ) && ! empty( $k['private'] ) ) {
			return $k;
		}
		if ( ! function_exists( 'openssl_pkey_new' ) || get_transient( 'dolly_vapid_failed' ) ) {
			return null;
		}
		$pair = self::new_ec_key();
		if ( ! $pair ) {
			set_transient( 'dolly_vapid_failed', 1, DAY_IN_SECONDS );
			return null;
		}
		$k = array(
			'public'  => self::b64u( $pair['public'] ),
			'private' => $pair['pem'],
		);
		update_option( 'dolly_vapid', $k, false );
		return $k;
	}

	/** New P-256 key: array( key => resource, pem => private PEM, public => 65-byte uncompressed point ). */
	private static function new_ec_key() {
		$res = @openssl_pkey_new( array( 'private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1' ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- failure handled by the caller.
		if ( ! $res ) {
			return null;
		}
		$pem = '';
		$d   = openssl_pkey_get_details( $res );
		if ( ! @openssl_pkey_export( $res, $pem ) || empty( $d['ec']['x'] ) || empty( $d['ec']['y'] ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- failure handled by the caller.
			return null;
		}
		return array(
			'key'    => $res,
			'pem'    => $pem,
			'public' => "\x04" . str_pad( $d['ec']['x'], 32, "\0", STR_PAD_LEFT ) . str_pad( $d['ec']['y'], 32, "\0", STR_PAD_LEFT ),
		);
	}

	/** Configuration for the portal script, or null when push is not available on this server. */
	public static function client_config() {
		$k = self::keys();
		if ( ! $k ) {
			return null;
		}
		$path = wp_parse_url( home_url( '/' ), PHP_URL_PATH );
		return array(
			'publicKey' => $k['public'],
			'sw'        => self::url( 'sw' ),
			'scope'     => $path ? $path : '/',
		);
	}

	/* ---------- Subscriptions ---------- */

	public static function subscribe( $user_id, $data ) {
		global $wpdb;
		$endpoint = (string) ( $data['endpoint'] ?? '' );
		$keys     = (array) ( $data['keys'] ?? array() );
		$host     = wp_parse_url( $endpoint, PHP_URL_HOST );
		// Only the format is checked: a DNS lookup here fails on some hosts and rejected valid phones.
		if ( 0 !== strpos( $endpoint, 'https://' ) || ! $host || strlen( $endpoint ) > 2000 ) {
			return new WP_Error( 'dolly_invalid', __( 'Iscrizione alle notifiche non valida.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		$t    = Dolly_Install::t( 'push_subs' );
		$hash = hash( 'sha256', $endpoint );
		// The same phone may have been used by another account: it now belongs to this user.
		$wpdb->delete( $t, array( 'endpoint_hash' => $hash ) );
		$wpdb->insert(
			$t,
			array(
				'user_id'       => $user_id,
				'endpoint'      => $endpoint,
				'endpoint_hash' => $hash,
				'p256dh'        => substr( sanitize_text_field( $keys['p256dh'] ?? '' ), 0, 255 ),
				'auth'          => substr( sanitize_text_field( $keys['auth'] ?? '' ), 0, 255 ),
				'user_agent'    => isset( $_SERVER['HTTP_USER_AGENT'] ) ? substr( sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ), 0, 255 ) : '',
				'created_at'    => Dolly_Time::now_utc(),
			)
		);
		unset( self::$has_sub[ $user_id ] );
		return array( 'ok' => true, 'devices' => count( self::subscriptions( $user_id ) ) );
	}

	public static function unsubscribe( $user_id, $endpoint ) {
		global $wpdb;
		$wpdb->delete( Dolly_Install::t( 'push_subs' ), array( 'user_id' => $user_id, 'endpoint_hash' => hash( 'sha256', (string) $endpoint ) ) );
		unset( self::$has_sub[ $user_id ] );
		return array( 'ok' => true, 'devices' => count( self::subscriptions( $user_id ) ) );
	}

	public static function subscriptions( $user_id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'push_subs' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d", $user_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	public static function has_subscription( $user_id ) {
		global $wpdb;
		if ( ! isset( self::$has_sub[ $user_id ] ) ) {
			$t                          = Dolly_Install::t( 'push_subs' );
			self::$has_sub[ $user_id ] = (bool) $wpdb->get_var( $wpdb->prepare( "SELECT 1 FROM $t WHERE user_id = %d LIMIT 1", $user_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		}
		return self::$has_sub[ $user_id ];
	}

	/* ---------- Sending ---------- */

	/**
	 * Asks for the pending pushes and emails to be sent when the current request ends (after the response
	 * has been delivered to the browser where the server allows it), so nobody waits for the scheduler.
	 */
	public static function request_flush() {
		if ( self::$flush ) {
			return;
		}
		self::$flush = true;
		add_action( 'shutdown', array( __CLASS__, 'flush' ), 100 );
	}

	public static function flush() {
		if ( function_exists( 'fastcgi_finish_request' ) ) {
			fastcgi_finish_request();
		}
		ignore_user_abort( true );
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 120 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- failure handled by the caller.
		}
		self::process_queue( 60 );
		Dolly_Notifications::process_queue( 30 );
	}

	/** ECDSA signature: DER SEQUENCE { INTEGER r, INTEGER s } -> raw r||s (64 bytes), as JWT ES256 requires. */
	private static function der_to_raw( $der ) {
		$pos = 2;
		if ( ord( $der[1] ) & 0x80 ) {
			$pos += ord( $der[1] ) & 0x7f;
		}
		$out = '';
		for ( $i = 0; $i < 2; $i++ ) {
			$len  = ord( $der[ $pos + 1 ] );
			$int  = ltrim( substr( $der, $pos + 2, $len ), "\x00" );
			$pos += 2 + $len;
			$out .= str_pad( $int, 32, "\x00", STR_PAD_LEFT );
		}
		return $out;
	}

	private static function jwt( $audience, $keys ) {
		$email = get_option( 'admin_email' );
		$input = self::b64u( wp_json_encode( array( 'typ' => 'JWT', 'alg' => 'ES256' ) ) ) . '.' . self::b64u(
			wp_json_encode(
				array(
					'aud' => $audience,
					'exp' => time() + 12 * HOUR_IN_SECONDS,
					// Apple rejects tokens without a valid contact.
					'sub' => is_email( $email ) ? 'mailto:' . $email : home_url( '/' ),
				),
				JSON_UNESCAPED_SLASHES
			)
		);
		$der = '';
		if ( ! openssl_sign( $input, $der, $keys['private'], OPENSSL_ALGO_SHA256 ) ) {
			return '';
		}
		return $input . '.' . self::b64u( self::der_to_raw( $der ) );
	}

	/** HKDF (RFC 5869) with SHA-256, for lengths up to 32 bytes. */
	private static function hkdf( $salt, $ikm, $info, $length ) {
		$prk = hash_hmac( 'sha256', $ikm, $salt, true );
		return substr( hash_hmac( 'sha256', $info . "\x01", $prk, true ), 0, $length );
	}

	/**
	 * Encrypts a payload for one subscription (RFC 8291 / RFC 8188, aes128gcm, single record).
	 * Returns the request body, or null when this server cannot do it (the push is then sent empty).
	 */
	private static function encrypt( $payload, $sub ) {
		if ( ! function_exists( 'openssl_pkey_derive' ) || ! in_array( 'aes-128-gcm', openssl_get_cipher_methods(), true ) ) {
			return null;
		}
		$ua_public = self::b64u_decode( $sub->p256dh );
		$auth      = self::b64u_decode( $sub->auth );
		if ( 65 !== strlen( $ua_public ) || "\x04" !== $ua_public[0] || strlen( $auth ) < 16 ) {
			return null;
		}
		$local = self::new_ec_key();
		if ( ! $local ) {
			return null;
		}
		// Subscriber key as SubjectPublicKeyInfo (P-256) for OpenSSL.
		$spki = hex2bin( '3059301306072a8648ce3d020106082a8648ce3d030107034200' ) . $ua_public;
		$pem  = "-----BEGIN PUBLIC KEY-----\n" . chunk_split( base64_encode( $spki ), 64, "\n" ) . "-----END PUBLIC KEY-----\n"; // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- PEM encoding of a public key.
		$peer = openssl_pkey_get_public( $pem );
		if ( ! $peer ) {
			return null;
		}
		$shared = openssl_pkey_derive( $peer, $local['key'] ); // ECDH: 32-byte shared secret.
		if ( ! $shared ) {
			return null;
		}
		$ikm   = self::hkdf( $auth, $shared, "WebPush: info\0" . $ua_public . $local['public'], 32 );
		$salt  = random_bytes( 16 );
		$cek   = self::hkdf( $salt, $ikm, "Content-Encoding: aes128gcm\0", 16 );
		$nonce = self::hkdf( $salt, $ikm, "Content-Encoding: nonce\0", 12 );
		$tag   = '';
		// One record: plaintext followed by the 0x02 "last record" delimiter.
		$cipher = openssl_encrypt( $payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16 );
		if ( false === $cipher ) {
			return null;
		}
		return $salt . pack( 'N', 4096 ) . chr( 65 ) . $local['public'] . $cipher . $tag;
	}

	/**
	 * Sends one push. Returns array( ok, code, error ). Expired subscriptions (404/410) are removed.
	 *
	 * @param string|null $payload JSON to deliver, or null for an empty push.
	 */
	private static function send( $sub, $keys, $payload = null ) {
		global $wpdb;
		$p = wp_parse_url( $sub->endpoint );
		if ( empty( $p['host'] ) ) {
			return array( 'ok' => false, 'code' => 0, 'error' => __( 'Indirizzo del servizio push non valido.', 'dolly-employee-management' ) );
		}
		$jwt = self::jwt( $p['scheme'] . '://' . $p['host'] . ( isset( $p['port'] ) ? ':' . $p['port'] : '' ), $keys );
		if ( '' === $jwt ) {
			return self::fail( 0, __( 'Firma VAPID non riuscita (OpenSSL).', 'dolly-employee-management' ) );
		}
		$headers = array(
			'TTL'           => '86400',
			'Urgency'       => 'high',
			'Authorization' => 'vapid t=' . $jwt . ', k=' . $keys['public'],
		);
		$body = null === $payload ? null : self::encrypt( $payload, $sub );
		if ( null !== $body ) {
			$headers['Content-Encoding'] = 'aes128gcm';
			$headers['Content-Type']     = 'application/octet-stream';
		}
		$res = wp_remote_post(
			$sub->endpoint,
			array(
				'timeout' => 10,
				'headers' => $headers,
				'body'    => null === $body ? '' : $body,
			)
		);
		if ( is_wp_error( $res ) ) {
			return self::fail( 0, __( 'Connessione al servizio push non riuscita: ', 'dolly-employee-management' ) . $res->get_error_message() );
		}
		$code = (int) wp_remote_retrieve_response_code( $res );
		$t    = Dolly_Install::t( 'push_subs' );
		if ( 404 === $code || 410 === $code ) {
			$wpdb->delete( $t, array( 'id' => (int) $sub->id ) );
			unset( self::$has_sub[ (int) $sub->user_id ] );
			return self::fail( $code, __( 'Iscrizione scaduta sul telefono: riattiva le notifiche dal Profilo.', 'dolly-employee-management' ) );
		}
		if ( $code >= 200 && $code < 300 ) {
			$wpdb->update( $t, array( 'last_success_at' => Dolly_Time::now_utc() ), array( 'id' => (int) $sub->id ) );
			update_option( 'dolly_push_last_success', time(), false );
			return array( 'ok' => true, 'code' => $code, 'error' => '' );
		}
		return self::fail( $code, 'HTTP ' . $code . ' ' . substr( wp_strip_all_tags( wp_remote_retrieve_body( $res ) ), 0, 200 ) );
	}

	private static function fail( $code, $error ) {
		update_option( 'dolly_push_last_error', Dolly_Time::now_local()->format( 'd/m/Y H:i' ) . ' · ' . $error, false );
		return array( 'ok' => false, 'code' => $code, 'error' => $error );
	}

	/** Where the phone opens a notification: the portal, which shows it in a pop-up. */
	private static function target_url( $n ) {
		$portal = Dolly_Frontend::url( 'portale' );
		if ( ! $n->link || 0 === strpos( $n->link, $portal ) ) {
			return add_query_arg( 'n', (int) $n->id, $portal );
		}
		return $n->link;
	}

	/**
	 * Sends the queued pushes (one per notification and phone). Each notification is claimed first, so the
	 * end-of-request sender and the scheduler never send it twice.
	 *
	 * @param int $user_id Only this user's notifications (0 = everybody).
	 * @return array[] One result per device: { notification, device, ok, code, error }.
	 */
	public static function process_queue( $limit = 60, $user_id = 0 ) {
		global $wpdb;
		$n    = Dolly_Install::t( 'notifications' );
		$sql  = "SELECT id, user_id, title, body, link FROM $n WHERE push_state = %d" . ( $user_id ? ' AND user_id = %d' : '' ) . ' ORDER BY id ASC LIMIT %d';
		$args = $user_id ? array( self::STATE_QUEUED, (int) $user_id, (int) $limit ) : array( self::STATE_QUEUED, (int) $limit );
		$rows = $wpdb->get_results( $wpdb->prepare( $sql, $args ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		if ( ! $rows ) {
			return array();
		}
		$keys = self::keys();
		$out  = array();
		foreach ( $rows as $row ) {
			$claimed = $wpdb->update( $n, array( 'push_state' => self::STATE_SENDING ), array( 'id' => (int) $row->id, 'push_state' => self::STATE_QUEUED ) );
			if ( ! $claimed ) {
				continue;
			}
			$payload = wp_json_encode(
				array(
					'id'    => (int) $row->id,
					'title' => $row->title,
					'body'  => mb_substr( wp_strip_all_tags( (string) $row->body ), 0, self::MAX_BODY ),
					'url'   => self::target_url( $row ),
				),
				JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
			);
			$ok = false;
			foreach ( $keys ? self::subscriptions( (int) $row->user_id ) : array() as $sub ) {
				$r     = self::send( $sub, $keys, $payload );
				$ok    = $ok || $r['ok'];
				$out[] = array_merge( array( 'notification' => (int) $row->id, 'device' => self::device_label( $sub->user_agent ) ), $r );
			}
			$wpdb->update( $n, array( 'push_state' => $ok ? self::STATE_SENT : self::STATE_NONE ), array( 'id' => (int) $row->id ) );
		}
		return $out;
	}

	private static function device_label( $ua ) {
		foreach ( array( 'iPhone' => 'iPhone', 'iPad' => 'iPad', 'Android' => 'Android', 'Windows' => 'Windows', 'Macintosh' => 'Mac' ) as $needle => $label ) {
			if ( false !== strpos( (string) $ua, $needle ) ) {
				return $label;
			}
		}
		return __( 'Dispositivo', 'dolly-employee-management' );
	}

	/**
	 * Employee "send a test": creates a notification and sends it right away, reporting what each
	 * push service answered (and whether the email channel works).
	 */
	public static function test( $user_id ) {
		$devices = count( self::subscriptions( $user_id ) );
		Dolly_Notifications::deliver( $user_id, 'test', __( 'Notifica di prova', 'dolly-employee-management' ), __( 'Se vedi questo messaggio sul telefono, le notifiche push funzionano.', 'dolly-employee-management' ), 'notifiche', true, false );
		$results = self::process_queue( 5, $user_id );
		return array(
			'available' => (bool) self::keys(),
			'encrypted' => function_exists( 'openssl_pkey_derive' ),
			'devices'   => $devices,
			'results'   => $results,
		);
	}

	/* ---------- Front-end endpoints ---------- */

	public static function handle_request() {
		if ( empty( $_GET['dolly_pwa'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only request parameter.
			return;
		}
		$what = sanitize_key( wp_unslash( $_GET['dolly_pwa'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only request parameter.
		if ( 'manifest' === $what ) {
			self::manifest();
		} elseif ( 'sw' === $what ) {
			self::service_worker();
		} elseif ( 'feed' === $what ) {
			self::feed();
		}
	}

	public static function icon_url( $size ) {
		$custom = Dolly_Appearance::app_icon_url( $size );
		if ( $custom ) {
			return $custom;
		}
		$site = function_exists( 'get_site_icon_url' ) ? get_site_icon_url( $size ) : '';
		if ( $site ) {
			return $site;
		}
		return DOLLY_URL . 'assets/img/icon-' . ( $size >= 512 ? 512 : ( $size <= 180 ? 180 : 192 ) ) . '.png';
	}

	private static function manifest() {
		nocache_headers();
		header( 'Content-Type: application/manifest+json; charset=utf-8' );
		$scope = wp_parse_url( home_url( '/' ), PHP_URL_PATH );
		echo wp_json_encode(
			array(
				'id'               => Dolly_Frontend::url( 'portale' ),
				'name'             => Dolly_Appearance::app_name(),
				'short_name'       => Dolly_Appearance::brand(),
				'lang'             => 'it',
				'start_url'        => Dolly_Frontend::url( 'portale' ),
				'scope'            => $scope ? $scope : '/',
				'display'          => 'standalone',
				'orientation'      => 'portrait',
				'background_color' => Dolly_Appearance::get( 'background' ),
				'theme_color'      => Dolly_Appearance::get( 'header_bg' ),
				'icons'            => array(
					array( 'src' => self::icon_url( 192 ), 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any' ),
					array( 'src' => self::icon_url( 512 ), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any' ),
					array( 'src' => Dolly_Appearance::app_icon_url( 512 ) ? Dolly_Appearance::app_icon_url( 512 ) : DOLLY_URL . 'assets/img/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable' ),
				),
			),
			JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
		);
		exit;
	}

	private static function service_worker() {
		header( 'Content-Type: application/javascript; charset=utf-8' );
		header( 'Cache-Control: no-cache' );
		$config = array(
			'feed'   => self::url( 'feed' ),
			'portal' => Dolly_Frontend::url( 'portale' ),
			'icon'   => self::icon_url( 192 ),
			'brand'  => Dolly_Appearance::brand(),
			'note'   => __( 'Hai una nuova notifica nel portale.', 'dolly-employee-management' ),
		);
		// A JavaScript file: the settings are JSON (wp_json_encode escapes "<", ">" and "&" with JSON_HEX_*).
		echo 'self.DOLLY_SW = ' . wp_json_encode( $config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP ) . ";\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		readfile( DOLLY_DIR . 'assets/js/dolly-sw.js' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile
		exit;
	}

	/** New notifications of the signed-in user, for the empty-push fallback of the service worker. */
	private static function feed() {
		global $wpdb;
		nocache_headers();
		header( 'Content-Type: application/json; charset=utf-8' );
		$uid   = get_current_user_id();
		$items = array();
		if ( $uid ) {
			$n    = Dolly_Install::t( 'notifications' );
			$rows = $wpdb->get_results( $wpdb->prepare( "SELECT id, title, body, link FROM $n WHERE user_id = %d AND push_state = %d ORDER BY id DESC LIMIT 5", $uid, self::STATE_SENT ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
			if ( $rows ) {
				$wpdb->query( "UPDATE $n SET push_state = " . self::STATE_SHOWN . ' WHERE id IN (' . implode( ',', array_map( 'intval', wp_list_pluck( $rows, 'id' ) ) ) . ')' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
			} else {
				$rows = $wpdb->get_results( $wpdb->prepare( "SELECT id, title, body, link FROM $n WHERE user_id = %d AND read_at IS NULL ORDER BY id DESC LIMIT 1", $uid ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
			}
			foreach ( $rows as $r ) {
				$items[] = array(
					'id'    => (int) $r->id,
					'title' => $r->title,
					'body'  => mb_substr( wp_strip_all_tags( (string) $r->body ), 0, 180 ),
					'url'   => self::target_url( $r ),
				);
			}
		}
		echo wp_json_encode( array( 'items' => $items ) );
		exit;
	}

	/** Manifest and home-screen tags on the portal pages. */
	public static function head() {
		if ( ! in_array( Dolly_Frontend::current_view(), array( 'login', 'portale', 'recupero-password' ), true ) ) {
			return;
		}
		printf( '<link rel="manifest" href="%s">' . "\n", esc_url( self::url( 'manifest' ) ) );
		printf( '<link rel="apple-touch-icon" href="%s">' . "\n", esc_url( self::icon_url( 180 ) ) );
		echo '<meta name="mobile-web-app-capable" content="yes">' . "\n";
		echo '<meta name="apple-mobile-web-app-capable" content="yes">' . "\n";
		echo '<meta name="apple-mobile-web-app-title" content="' . esc_attr( Dolly_Appearance::brand() ) . '">' . "\n";
		echo '<meta name="apple-mobile-web-app-status-bar-style" content="default">' . "\n";
	}

	/** For Settings › System status. */
	public static function status() {
		global $wpdb;
		$t    = Dolly_Install::t( 'push_subs' );
		$last = (int) get_option( 'dolly_push_last_success', 0 );
		return array(
			'available'    => (bool) self::keys(),
			'encrypted'    => function_exists( 'openssl_pkey_derive' ),
			'devices'      => (int) $wpdb->get_var( "SELECT COUNT(*) FROM $t" ), // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
			'employees'    => (int) $wpdb->get_var( "SELECT COUNT(DISTINCT user_id) FROM $t" ), // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
			'last_success' => $last ? Dolly_Time::iso( gmdate( 'Y-m-d H:i:s', $last ) ) : null,
			'last_error'   => (string) get_option( 'dolly_push_last_error', '' ),
		);
	}
}
