<?php
/**
 * Bluetooth clock-in: a small Bluetooth Low Energy device at the workplace serves a 6-digit code
 * that changes every 30 seconds. The employee's phone reads it over Bluetooth (Web Bluetooth),
 * which proves it is within a few metres of the device, and sends it to the server.
 *
 * The code is a standard TOTP (RFC 6238: HMAC-SHA1, 6 digits, 30-second step) of a per-workplace
 * secret. The device computes it itself (Wi-Fi + internet time), or the workplace tablet writes the
 * current code into it over Bluetooth, so the device needs no network. See firmware/README.md.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Bluetooth {

	const OPTION = 'dolly_bluetooth';

	/** GATT identifiers shared with the firmware and the browser code. */
	const SERVICE_UUID = '8d1f3e5a-6b2c-4c7e-9a41-2f6d0c9b7a10';
	const CODE_UUID    = '8d1f3e5a-6b2c-4c7e-9a41-2f6d0c9b7a11';
	const PUSH_UUID    = '8d1f3e5a-6b2c-4c7e-9a41-2f6d0c9b7a12';

	const STEP   = 30;
	const DIGITS = 6;

	/** Per-workplace devices: [ workplace_id => [ secret, enabled, created_at ] ]. */
	private static function all() {
		$v = get_option( self::OPTION, array() );
		return is_array( $v ) ? $v : array();
	}

	public static function device( $workplace_id ) {
		$all = self::all();
		return isset( $all[ (int) $workplace_id ] ) ? $all[ (int) $workplace_id ] : null;
	}

	public static function enabled_for( $workplace_id ) {
		$d = self::device( $workplace_id );
		return $d && ! empty( $d['enabled'] ) && ! empty( $d['secret'] );
	}

	/** Enables the device of a workplace, creating its secret the first time. */
	public static function enable( $workplace_id, $on = true ) {
		$all = self::all();
		$wid = (int) $workplace_id;
		if ( empty( $all[ $wid ]['secret'] ) ) {
			$all[ $wid ] = array(
				'secret'     => self::new_secret(),
				'created_at' => Dolly_Time::now_utc(),
			);
		}
		$all[ $wid ]['enabled'] = (bool) $on;
		update_option( self::OPTION, $all, false );
		Dolly_Audit::log( $on ? 'bluetooth_enabled' : 'bluetooth_disabled', 'workplace', $wid );
		return self::device( $wid );
	}

	/** New secret: the device must be configured again. */
	public static function regenerate( $workplace_id ) {
		$all                   = self::all();
		$wid                   = (int) $workplace_id;
		$all[ $wid ]['secret']     = self::new_secret();
		$all[ $wid ]['created_at'] = Dolly_Time::now_utc();
		$all[ $wid ]['enabled']    = true;
		update_option( self::OPTION, $all, false );
		Dolly_Audit::log( 'bluetooth_key_regenerated', 'workplace', $wid );
		return self::device( $wid );
	}

	public static function remove_workplace( $workplace_id ) {
		$all = self::all();
		unset( $all[ (int) $workplace_id ] );
		update_option( self::OPTION, $all, false );
	}

	/* ---------- TOTP (RFC 6238) ---------- */

	private static function new_secret() {
		return self::base32_encode( random_bytes( 20 ) );
	}

	public static function base32_encode( $bin ) {
		$alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
		$bits     = '';
		foreach ( str_split( $bin ) as $c ) {
			$bits .= str_pad( decbin( ord( $c ) ), 8, '0', STR_PAD_LEFT );
		}
		$out = '';
		foreach ( str_split( $bits, 5 ) as $chunk ) {
			$out .= $alphabet[ bindec( str_pad( $chunk, 5, '0' ) ) ];
		}
		return $out;
	}

	public static function base32_decode( $b32 ) {
		$alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
		$b32      = strtoupper( preg_replace( '/[^A-Za-z2-7]/', '', (string) $b32 ) );
		$bits     = '';
		foreach ( str_split( $b32 ) as $c ) {
			$bits .= str_pad( decbin( strpos( $alphabet, $c ) ), 5, '0', STR_PAD_LEFT );
		}
		$out = '';
		foreach ( str_split( $bits, 8 ) as $byte ) {
			if ( 8 === strlen( $byte ) ) {
				$out .= chr( bindec( $byte ) );
			}
		}
		return $out;
	}

	/** Code of the given 30-second step (default: now). */
	public static function totp( $secret_b32, $step = null ) {
		$step   = null === $step ? (int) floor( time() / self::STEP ) : (int) $step;
		$hash   = hash_hmac( 'sha1', pack( 'N2', 0, $step ), self::base32_decode( $secret_b32 ), true );
		$offset = ord( $hash[19] ) & 0x0F;
		$value  = ( ( ord( $hash[ $offset ] ) & 0x7F ) << 24 ) | ( ord( $hash[ $offset + 1 ] ) << 16 ) | ( ord( $hash[ $offset + 2 ] ) << 8 ) | ord( $hash[ $offset + 3 ] );
		return str_pad( (string) ( $value % 1000000 ), self::DIGITS, '0', STR_PAD_LEFT );
	}

	/** Current code of a workplace (for the tablet that relays it to the device), or null. */
	public static function current_code( $workplace_id ) {
		if ( ! self::enabled_for( $workplace_id ) ) {
			return null;
		}
		$step = (int) floor( time() / self::STEP );
		return array(
			'code'       => self::totp( self::device( $workplace_id )['secret'], $step ),
			'expires_at' => ( $step + 1 ) * self::STEP,
		);
	}

	/**
	 * Validates the "<workplace id>:<code>" value read from the device. The previous and next steps
	 * are accepted too, for small clock differences between the device and the server.
	 * Returns ['workplace_id','method','ref'] or WP_Error.
	 */
	public static function verify( $user_id, $raw ) {
		$lock_key = 'dolly_ble_lock_' . $user_id;
		$fail_key = 'dolly_ble_fail_' . $user_id;
		if ( get_transient( $lock_key ) ) {
			return new WP_Error( 'dolly_ble_locked', __( 'Too many invalid Bluetooth codes. Try again in a few minutes or use another method.', 'dolly-employee-management' ), array( 'status' => 429 ) );
		}
		if ( ! preg_match( '/^\s*(\d+):(\d{6})\s*$/', (string) $raw, $m ) ) {
			return new WP_Error( 'dolly_ble_invalid', __( 'The Bluetooth device did not provide a valid code. Move closer to the device and try again; if the problem continues, the device may not be synchronized.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		$wid  = (int) $m[1];
		$code = $m[2];
		if ( ! in_array( $wid, Dolly_Workplaces::ids_for_user( $user_id ), true ) ) {
			return new WP_Error( 'dolly_wrong_workplace', __( 'This Bluetooth device belongs to a workplace you are not assigned to.', 'dolly-employee-management' ), array( 'status' => 403 ) );
		}
		if ( ! self::enabled_for( $wid ) ) {
			return new WP_Error( 'dolly_ble_disabled', __( 'Bluetooth is not enabled for this workplace.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		$secret = self::device( $wid )['secret'];
		$now    = (int) floor( time() / self::STEP );
		foreach ( array( $now, $now - 1, $now + 1 ) as $step ) {
			if ( hash_equals( self::totp( $secret, $step ), $code ) ) {
				delete_transient( $fail_key );
				return array(
					'workplace_id' => $wid,
					'method'       => 'ble',
					'ref'          => 'ble:' . $wid . ':' . $step,
				);
			}
		}
		$max   = (int) Dolly_Settings::get( 'pin_max_attempts' );
		$mins  = (int) Dolly_Settings::get( 'pin_lock_minutes' );
		$fails = (int) get_transient( $fail_key ) + 1;
		set_transient( $fail_key, $fails, $mins * MINUTE_IN_SECONDS );
		if ( $fails >= $max ) {
			set_transient( $lock_key, 1, $mins * MINUTE_IN_SECONDS );
			delete_transient( $fail_key );
		}
		return new WP_Error( 'dolly_ble_expired', __( 'The code read from the Bluetooth device has expired or is not valid. Check that the device is on and synchronized, then try again.', 'dolly-employee-management' ), array( 'status' => 400 ) );
	}

	/* ---------- Administration ---------- */

	/** Workplace device details for the administrator (the secret is shown only here). */
	public static function admin_info( $workplace_id ) {
		$d = self::device( $workplace_id );
		return array(
			'enabled'    => self::enabled_for( $workplace_id ),
			'configured' => (bool) ( $d && ! empty( $d['secret'] ) ),
			'secret'     => $d['secret'] ?? '',
			'created_at' => isset( $d['created_at'] ) ? Dolly_Time::iso( $d['created_at'] ) : null,
			'test_code'  => $d && ! empty( $d['secret'] ) ? self::totp( $d['secret'] ) : null,
			'config'     => $d && ! empty( $d['secret'] ) ? self::firmware_config( $workplace_id, $d['secret'] ) : '',
		);
	}

	/** Contents of config.h for the firmware in firmware/dolly-ble-beacon. */
	public static function firmware_config( $workplace_id, $secret ) {
		$w    = Dolly_Workplaces::get( $workplace_id );
		$name = preg_replace( '/[^A-Za-z0-9 _-]/', '', remove_accents( Dolly_Appearance::brand() . ' ' . ( $w ? $w->name : '' ) ) );
		$name = mb_substr( trim( $name ), 0, 26 );
		return implode(
			"\n",
			array(
				'// Configuration for ' . ( $w ? $w->name : 'workplace ' . $workplace_id ) . ' - generated ' . gmdate( 'Y-m-d H:i' ) . ' UTC.',
				'// Keep this file private: anyone with the secret can generate valid codes.',
				'#pragma once',
				'',
				'#define DOLLY_WORKPLACE_ID ' . (int) $workplace_id,
				'#define DOLLY_TOTP_SECRET  "' . $secret . '"',
				'#define DOLLY_DEVICE_NAME  "' . $name . '"',
				'',
				'// Wi-Fi for the internet time (standalone mode). Leave empty to use only the workplace tablet.',
				'#define DOLLY_WIFI_SSID     ""',
				'#define DOLLY_WIFI_PASSWORD ""',
				'',
				'// Status LED: 35 = M5Stack AtomS3 Lite (RGB), 27 = M5Stack Atom Lite (RGB), -1 = none.',
				'#define DOLLY_RGB_LED_PIN 35',
				'',
				'// Transmission power: lower it to shrink the range (ESP_PWR_LVL_N12 ... ESP_PWR_LVL_P9).',
				'#define DOLLY_TX_POWER ESP_PWR_LVL_N0',
				'',
			)
		);
	}

	/** Identifiers for the browser code. */
	public static function client_config() {
		return array(
			'service' => self::SERVICE_UUID,
			'code'    => self::CODE_UUID,
			'push'    => self::PUSH_UUID,
		);
	}
}
