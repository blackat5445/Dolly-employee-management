<?php
/**
 * Plugin-wide settings stored in a single option.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Settings {

	const OPTION = 'dolly_settings';

	/** Ways an employee can prove presence at the workplace; several can be allowed at once. */
	const VERIFICATION_METHODS = array(
		'gps'   => 'GPS location',
		'qrpin' => 'QR or PIN on the workplace display',
		'ble'   => 'Bluetooth (device at the workplace)',
	);

	/** Methods that prove presence with a code from the workplace (screen or Bluetooth device). */
	const CODE_METHODS = array( 'qrpin', 'ble' );

	const CERTIFICATE_MODES = array(
		'required' => 'Required, no deadline',
		'deadline' => 'Required within X calendar days of the report',
		'disabled' => 'Disabled',
	);

	const EVENTS = array(
		'request_submitted'    => 'New request sent',
		'request_decided'      => 'Decision on a request',
		'overtime_pending'     => 'Overtime over the limit to approve',
		'oncall_pending'       => 'On-call shift to approve',
		'smart_pending'        => 'Remote work to approve',
		'document_received'    => 'New document',
		'sickness_reported'    => 'Sickness or injury reported',
		'certificate_required' => 'Certificate required',
		'certificate_overdue'  => 'Certificate overdue',
		'certificate_uploaded' => 'Certificate uploaded',
		'anomaly_created'      => 'New anomaly',
		'anomaly_resolved'     => 'Anomaly resolved',
		'iban_changed'         => 'IBAN changed by the employee',
	);

	/** Events an employee can receive (label as seen from the employee's side). */
	const EMPLOYEE_EVENTS = array(
		'request_decided'      => 'Request outcomes',
		'overtime_pending'     => 'Overtime over the limit pending approval',
		'sickness_reported'    => 'Sickness or injury recorded by the administrator',
		'certificate_required' => 'Certificate to upload (medical or donation)',
		'certificate_overdue'  => 'Certificate overdue (medical or donation)',
		'anomaly_created'      => 'New anomaly (absence, missing clock-out…)',
		'anomaly_resolved'     => 'Anomaly resolved',
		'document_received'    => 'New document (contract, tax certificate, payslip…)',
	);

	/** Events the administrators can receive. */
	const ADMIN_EVENTS = array(
		'request_submitted'    => 'New request from an employee',
		'overtime_pending'     => 'Overtime over the limit to approve',
		'oncall_pending'       => 'On-call shift to approve',
		'smart_pending'        => 'Remote work to approve',
		'sickness_reported'    => 'Sickness or injury reported by an employee',
		'certificate_required' => 'Certificate required',
		'certificate_overdue'  => 'Certificate overdue',
		'certificate_uploaded' => 'Certificate uploaded',
		'anomaly_created'      => 'New anomaly',
		'iban_changed'         => 'IBAN changed by an employee',
	);

	private static function all_on( $events ) {
		$out = array();
		foreach ( array_keys( $events ) as $e ) {
			$out[ $e ] = array(
				'portal' => true,
				'email'  => true,
			);
		}
		return $out;
	}

	public static function defaults() {
		// "events": employee notifications; "admin_events": administrator notifications.
		$events = self::all_on( self::EVENTS );
		return array(
			// Language of the portal, emails and administration: "auto" follows the site language.
			'language'                 => 'auto',
			'verification_methods'     => array( 'gps', 'qrpin' ),
			// On: GPS is checked as well, together with a workplace code (QR/PIN or Bluetooth).
			'verification_require_gps' => false,
			'default_radius'    => 100,
			'certificate_mode'  => 'required',
			'certificate_days'  => 3,
			// What the employee must provide for a medical certificate: the file and/or its protocol number.
			'certificate_require_file'     => true,
			'certificate_require_protocol' => false,
			'lunch_punch'       => true,
			'late_tolerance'    => 0,
			'exit_rounding'     => false,
			'rounding_step'     => 15,
			'overtime_auto'     => 120,
			'absence_check'     => true,
			'absence_delay'     => 60,
			'oncall_auto'       => true,
			'oncall_threshold'  => 120,
			// Smart working: the smart-working hours of a day are approved automatically, or by the administrator.
			'smart_auto'        => true,
			'holiday_increase'  => 30,
			'require_install'   => true,
			// Reminder mode: push reminders N minutes before the shift start / after the shift end.
			'reminder_entry'         => false,
			'reminder_entry_minutes' => array( 5 ),
			'reminder_exit'          => false,
			'reminder_exit_minutes'  => array( 5 ),
			// Blood donation certificate (same modes as the medical certificate).
			'donation_certificate_mode' => 'required',
			'donation_certificate_days' => 3,
			// Device sessions: employees sign in from a limited number of registered devices.
			'device_sessions'   => true,
			'notify_portal'     => true,
			'notify_email'      => true,
			'events'            => $events,
			'admin_notify_portal' => true,
			'admin_notify_email'  => true,
			'admin_events'      => $events,
			'admin_recipients'  => array(),
			'logo_id'           => 0,
			'pin_max_attempts'  => 5,
			'pin_lock_minutes'  => 10,
			'challenge_grace'   => 5,
			'cron_key'          => '',
		);
	}

	public static function all() {
		$saved = get_option( self::OPTION, array() );
		$saved = is_array( $saved ) ? $saved : array();
		unset( $saved['exit_delay'] ); // Replaced by automatic overtime (version 1.1).
		// Before version 1.10 a single mode was stored: gps, qrpin, either (GPS or QR/PIN) or both (GPS and QR/PIN).
		if ( ! isset( $saved['verification_methods'] ) && isset( $saved['verification_mode'] ) ) {
			$map                               = array(
				'gps'    => array( array( 'gps' ), false ),
				'qrpin'  => array( array( 'qrpin' ), false ),
				'either' => array( array( 'gps', 'qrpin' ), false ),
				'both'   => array( array( 'qrpin' ), true ),
			);
			$old                               = $map[ $saved['verification_mode'] ] ?? $map['either'];
			$saved['verification_methods']     = $old[0];
			$saved['verification_require_gps'] = $old[1];
		}
		unset( $saved['verification_mode'] );
		// Before version 1.5 one set of switches served everybody: administrators start from those values.
		foreach ( array( 'admin_events' => 'events', 'admin_notify_portal' => 'notify_portal', 'admin_notify_email' => 'notify_email' ) as $new => $old ) {
			if ( ! isset( $saved[ $new ] ) && isset( $saved[ $old ] ) ) {
				$saved[ $new ] = $saved[ $old ];
			}
		}
		$all = array_merge( self::defaults(), $saved );
		// Merge nested events so newly added events default to enabled.
		$all['events']       = array_merge( self::defaults()['events'], is_array( $all['events'] ) ? $all['events'] : array() );
		$all['admin_events'] = array_merge( self::defaults()['admin_events'], is_array( $all['admin_events'] ) ? $all['admin_events'] : array() );
		return $all;
	}

	public static function get( $key ) {
		$all = self::all();
		return isset( $all[ $key ] ) ? $all[ $key ] : null;
	}

	/**
	 * Validates and saves a partial settings array. Returns the full saved settings.
	 */
	public static function update( array $input ) {
		Dolly_Analytics::bump();
		$current = self::all();
		$new     = $current;

		if ( isset( $input['verification_methods'] ) && is_array( $input['verification_methods'] ) ) {
			$methods = array_values( array_intersect( array_keys( self::VERIFICATION_METHODS ), $input['verification_methods'] ) );
			if ( ! $methods ) {
				return new WP_Error( 'dolly_invalid', __( 'Choose at least one verification method.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'verification_methods' => __( 'Choose at least one verification method.', 'dolly-employee-management' ) ) ) );
			}
			$new['verification_methods'] = $methods;
		}
		if ( isset( $input['language'] ) && ( 'auto' === $input['language'] || Dolly_I18n::is_available( $input['language'] ) ) ) {
			$new['language'] = $input['language'];
		}
		if ( isset( $input['verification_require_gps'] ) ) {
			$new['verification_require_gps'] = (bool) $input['verification_require_gps'];
		}
		if ( $new['verification_require_gps'] && ! array_intersect( self::CODE_METHODS, $new['verification_methods'] ) ) {
			return new WP_Error( 'dolly_invalid', __( 'With GPS always required, QR/PIN or Bluetooth is also needed.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'verification_require_gps' => __( 'Also enable QR/PIN or Bluetooth, or turn off this option.', 'dolly-employee-management' ) ) ) );
		}
		if ( isset( $input['default_radius'] ) ) {
			$new['default_radius'] = max( 10, min( 5000, (int) $input['default_radius'] ) );
		}
		if ( isset( $input['certificate_mode'] ) && isset( self::CERTIFICATE_MODES[ $input['certificate_mode'] ] ) ) {
			$new['certificate_mode'] = $input['certificate_mode'];
		}
		if ( isset( $input['certificate_days'] ) ) {
			$new['certificate_days'] = max( 1, min( 365, (int) $input['certificate_days'] ) );
		}
		if ( isset( $input['late_tolerance'] ) ) {
			$new['late_tolerance'] = max( 0, min( 120, (int) $input['late_tolerance'] ) );
		}
		if ( isset( $input['rounding_step'] ) ) {
			$new['rounding_step'] = max( 1, min( 60, (int) $input['rounding_step'] ) );
		}
		if ( isset( $input['overtime_auto'] ) ) {
			$new['overtime_auto'] = max( 0, min( 1440, (int) $input['overtime_auto'] ) );
		}
		if ( isset( $input['absence_delay'] ) ) {
			$new['absence_delay'] = max( 0, min( 720, (int) $input['absence_delay'] ) );
		}
		if ( isset( $input['holiday_increase'] ) ) {
			$new['holiday_increase'] = max( 0, min( 300, (int) $input['holiday_increase'] ) );
		}
		if ( isset( $input['oncall_threshold'] ) ) {
			$new['oncall_threshold'] = max( 1, min( 1440, (int) $input['oncall_threshold'] ) );
		}
		foreach ( array( 'notify_portal', 'notify_email', 'admin_notify_portal', 'admin_notify_email', 'lunch_punch', 'exit_rounding', 'absence_check', 'oncall_auto', 'require_install', 'reminder_entry', 'reminder_exit', 'device_sessions', 'smart_auto', 'certificate_require_file', 'certificate_require_protocol' ) as $k ) {
			if ( isset( $input[ $k ] ) ) {
				$new[ $k ] = (bool) $input[ $k ];
			}
		}
		foreach ( array( 'events', 'admin_events' ) as $group ) {
			if ( isset( $input[ $group ] ) && is_array( $input[ $group ] ) ) {
				foreach ( self::EVENTS as $e => $label ) {
					if ( isset( $input[ $group ][ $e ] ) && is_array( $input[ $group ][ $e ] ) ) {
						foreach ( array( 'portal', 'email' ) as $ch ) {
							if ( isset( $input[ $group ][ $e ][ $ch ] ) ) {
								$new[ $group ][ $e ][ $ch ] = (bool) $input[ $group ][ $e ][ $ch ];
							}
						}
					}
				}
			}
		}
		foreach ( array( 'reminder_entry_minutes', 'reminder_exit_minutes' ) as $k ) {
			if ( isset( $input[ $k ] ) && is_array( $input[ $k ] ) ) {
				$new[ $k ] = self::clean_minutes( $input[ $k ] );
			}
		}
		if ( isset( $input['donation_certificate_mode'] ) && isset( self::CERTIFICATE_MODES[ $input['donation_certificate_mode'] ] ) ) {
			$new['donation_certificate_mode'] = $input['donation_certificate_mode'];
		}
		if ( isset( $input['donation_certificate_days'] ) ) {
			$new['donation_certificate_days'] = max( 1, min( 365, (int) $input['donation_certificate_days'] ) );
		}
		if ( isset( $input['admin_recipients'] ) && is_array( $input['admin_recipients'] ) ) {
			$new['admin_recipients'] = array_values( array_filter( array_map( 'absint', $input['admin_recipients'] ) ) );
		}
		if ( isset( $input['logo_id'] ) ) {
			$new['logo_id'] = absint( $input['logo_id'] );
		}
		if ( isset( $input['pin_max_attempts'] ) ) {
			$new['pin_max_attempts'] = max( 1, min( 50, (int) $input['pin_max_attempts'] ) );
		}
		if ( isset( $input['pin_lock_minutes'] ) ) {
			$new['pin_lock_minutes'] = max( 1, min( 1440, (int) $input['pin_lock_minutes'] ) );
		}
		if ( isset( $input['challenge_grace'] ) ) {
			$new['challenge_grace'] = max( 0, min( 10, (int) $input['challenge_grace'] ) );
		}

		update_option( self::OPTION, $new, false );
		Dolly_Reminders::flush();

		$changed = array();
		foreach ( $new as $k => $v ) {
			if ( 'cron_key' !== $k && $current[ $k ] !== $v ) {
				$changed[ $k ] = array(
					'before' => $current[ $k ],
					'after'  => $v,
				);
			}
		}
		if ( $changed ) {
			Dolly_Audit::log( 'settings_updated', 'settings', 0, 0, '', wp_list_pluck( $changed, 'before' ), wp_list_pluck( $changed, 'after' ) );
		}

		// Disabling certificates clears outstanding requirements with an audit entry.
		if ( 'disabled' === $new['certificate_mode'] && 'disabled' !== $current['certificate_mode'] ) {
			Dolly_Sickness::clear_outstanding_requirements();
		}
		if ( 'deadline' === $new['certificate_mode'] && ( 'deadline' !== $current['certificate_mode'] || $new['certificate_days'] !== $current['certificate_days'] ) ) {
			Dolly_Sickness::apply_deadlines();
		}

		// Same rules for the blood donation certificate.
		if ( 'disabled' === $new['donation_certificate_mode'] && 'disabled' !== $current['donation_certificate_mode'] ) {
			Dolly_Donations::clear_outstanding_requirements();
		}
		if ( 'deadline' === $new['donation_certificate_mode'] && ( 'deadline' !== $current['donation_certificate_mode'] || $new['donation_certificate_days'] !== $current['donation_certificate_days'] ) ) {
			Dolly_Donations::apply_deadlines();
		}

		return $new;
	}

	/** Allowed presence checks, as shown to the employee's app. */
	public static function verification() {
		$methods = (array) self::get( 'verification_methods' );
		return array(
			'methods'     => $methods,
			'require_gps' => (bool) self::get( 'verification_require_gps' ) && (bool) array_intersect( self::CODE_METHODS, $methods ),
		);
	}

	/** Reminder offsets: unique whole minutes between 1 and 240, sorted, at most 6. */
	public static function clean_minutes( $list ) {
		$out = array();
		foreach ( (array) $list as $m ) {
			$m = (int) $m;
			if ( $m >= 1 && $m <= 240 ) {
				$out[ $m ] = $m;
			}
		}
		sort( $out );
		return array_slice( array_values( $out ), 0, 6 );
	}

	public static function cron_key() {
		$all = self::all();
		if ( empty( $all['cron_key'] ) ) {
			$all['cron_key'] = wp_generate_password( 40, false, false );
			update_option( self::OPTION, $all, false );
		}
		return $all['cron_key'];
	}

	/** Returns the logo URL or empty string (text wordmark is used when empty). The logo is set in Appearance. */
	public static function logo_url() {
		return Dolly_Appearance::logo_url();
	}
}
