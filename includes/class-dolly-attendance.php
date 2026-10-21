<?php
/**
 * Attendance: punch sequence, duplicate prevention, audited corrections, and hour calculation.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Attendance {

	const ACTIONS = array(
		'entrata'      => 'Clock-in',
		'inizio_pausa' => 'Break start',
		'fine_pausa'   => 'Break end',
		'uscita'       => 'Clock-out',
	);

	const METHODS = array(
		'gps'        => 'GPS',
		'qr'         => 'QR',
		'pin'        => 'PIN',
		'ble'        => 'Bluetooth',
		'gps_qr'     => 'GPS + QR',
		'gps_pin'    => 'GPS + PIN',
		'gps_ble'    => 'GPS + Bluetooth',
		'exception'  => 'Administrator exception',
		'correction' => 'Administrator correction',
		'smart'      => 'Remote work',
	);

	/** Active punches for a user/date keyed by action. */
	public static function punches_for( $user_id, $date ) {
		global $wpdb;
		$t    = Dolly_Install::t( 'punches' );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND work_date = %s AND is_active = 1 ORDER BY punched_at ASC", $user_id, $date ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		$out  = array();
		foreach ( $rows as $r ) {
			$out[ $r->action ] = $r;
		}
		return $out;
	}

	/** Active punches for many users over a date range: [user_id][date][action] => row. */
	public static function punches_range( array $user_ids, $from, $to ) {
		global $wpdb;
		$out = array();
		if ( ! $user_ids ) {
			return $out;
		}
		$t   = Dolly_Install::t( 'punches' );
		$in  = implode( ',', array_map( 'intval', $user_ids ) );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id IN ($in) AND work_date BETWEEN %s AND %s AND is_active = 1", $from, $to ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		foreach ( $rows as $r ) {
			$out[ (int) $r->user_id ][ $r->work_date ][ $r->action ] = $r;
		}
		return $out;
	}

	public static function format_punch( $p ) {
		if ( ! $p ) {
			return null;
		}
		$w = $p->workplace_id ? Dolly_Workplaces::get( (int) $p->workplace_id ) : null;
		return array(
			'id'           => (int) $p->id,
			'action'       => $p->action,
			'label'        => Dolly_I18n::t( self::ACTIONS[ $p->action ] ?? $p->action ),
			'time'         => Dolly_Time::utc_to_local( $p->punched_at, 'H:i' ),
			'at'           => Dolly_Time::iso( $p->punched_at ),
			'workplace_id' => $p->workplace_id ? (int) $p->workplace_id : null,
			'workplace'    => 'smart' === $p->method ? __( 'Remote work', 'dolly-employee-management' ) : ( $w ? $w->name : '' ),
			'smart'        => 'smart' === $p->method,
			'method'       => $p->method,
			'method_label' => Dolly_I18n::t( self::METHODS[ $p->method ] ?? $p->method ),
			'source'       => $p->source,
		);
	}

	/**
	 * Next permitted actions given the recorded punches and the day plan.
	 *
	 * @return array{primary: ?string, secondary: ?string, completed: bool}
	 */
	public static function next_actions( array $punches, array $plan ) {
		$has = function ( $a ) use ( $punches ) {
			return isset( $punches[ $a ] );
		};
		if ( $has( 'uscita' ) ) {
			return array( 'primary' => null, 'secondary' => null, 'completed' => true );
		}
		if ( ! $has( 'entrata' ) ) {
			return array( 'primary' => 'entrata', 'secondary' => null, 'completed' => false );
		}
		if ( $has( 'inizio_pausa' ) && ! $has( 'fine_pausa' ) ) {
			return array( 'primary' => 'fine_pausa', 'secondary' => 'uscita', 'completed' => false );
		}
		// With automatic lunch (setting "lunch_punch" off) the lunch break is not clocked.
		if ( $plan['has_lunch'] && empty( $plan['lunch_auto'] ) && ! $has( 'inizio_pausa' ) ) {
			return array( 'primary' => 'inizio_pausa', 'secondary' => 'uscita', 'completed' => false );
		}
		return array( 'primary' => 'uscita', 'secondary' => null, 'completed' => false );
	}

	/**
	 * Reason why the user cannot clock today, or null.
	 */
	public static function blocked_reason( $user_id, $date, array $plan ) {
		if ( ! Dolly_Employees::is_active( $user_id ) ) {
			return __( 'Account deactivated.', 'dolly-employee-management' );
		}
		if ( ! Dolly_Workplaces::ids_for_user( $user_id, $date ) ) {
			return __( 'No workplace assigned. Contact the administrator.', 'dolly-employee-management' );
		}
		if ( ! $plan['eligible'] ) {
			return __( 'Today is a day off. To work, you need overtime authorization from the administrator.', 'dolly-employee-management' );
		}
		$sick = Dolly_Sickness::covers( $user_id, $date );
		if ( $sick ) {
			return 'infortunio' === ( $sick->kind ?? '' ) ? __( 'You are on injury leave today.', 'dolly-employee-management' ) : __( 'You are on sick leave today.', 'dolly-employee-management' );
		}
		$leave = Dolly_Requests::full_day_leave( $user_id, $date );
		if ( $leave ) {
			return Dolly_Donations::TYPE === $leave->type ? __( 'Today you are recorded as absent for blood donation.', 'dolly-employee-management' ) : __( 'You are on vacation today.', 'dolly-employee-management' );
		}
		return null;
	}

	/** Dates (before $date, last 31 days) with an entry but no final exit. */
	public static function previous_incomplete( $user_id, $date ) {
		global $wpdb;
		$t    = Dolly_Install::t( 'punches' );
		$from = Dolly_Time::add_days( $date, -31 );
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery -- Plugin tables (\$wpdb->prefix); values are prepared.
		return $wpdb->get_col(
			$wpdb->prepare(
				"SELECT e.work_date FROM $t e
				LEFT JOIN $t u ON u.user_id = e.user_id AND u.work_date = e.work_date AND u.action = 'uscita' AND u.is_active = 1
				WHERE e.user_id = %d AND e.action = 'entrata' AND e.is_active = 1 AND e.work_date >= %s AND e.work_date < %s AND u.id IS NULL
				ORDER BY e.work_date DESC",
				$user_id,
				$from,
				$date
			)
		);
		// phpcs:enable
	}

	/** Full state for the employee dashboard. */
	public static function state( $user_id, $date = null ) {
		$date    = $date ? $date : Dolly_Time::today();
		$plan    = Dolly_Schedules::day_plan( $user_id, $date );
		$punches = self::punches_for( $user_id, $date );
		$next    = self::next_actions( $punches, $plan );
		$blocked = empty( $punches ) ? self::blocked_reason( $user_id, $date, $plan ) : null;
		$last    = null;
		foreach ( $punches as $p ) {
			if ( ! $last || $p->punched_at >= $last->punched_at ) {
				$last = $p;
			}
		}
		$exception = Dolly_Verification::active_exception( $user_id );
		$formatted = array();
		foreach ( $punches as $a => $p ) {
			$formatted[ $a ] = self::format_punch( $p );
		}
		return array(
			'date'                => $date,
			'plan'                => $plan,
			'punches'             => (object) $formatted,
			'primary'             => $blocked ? null : $next['primary'],
			'secondary'           => $blocked ? null : $next['secondary'],
			'completed'           => $next['completed'],
			'blocked'             => $blocked,
			'last'                => $last ? self::format_punch( $last ) : null,
			'previous_incomplete' => array_map( array( 'Dolly_Time', 'fmt_date' ), self::previous_incomplete( $user_id, $date ) ),
			'exception'           => Dolly_Verification::format_exception( $exception ),
			'verification'        => Dolly_Settings::verification(),
			// Smart working: these punches, if made now, need no presence verification.
			'smart'               => array(
				'primary'   => ! $blocked && $next['primary'] ? self::smart_now( $plan, $next['primary'] ) : false,
				'secondary' => ! $blocked && $next['secondary'] ? self::smart_now( $plan, $next['secondary'] ) : false,
			),
		);
	}

	/** True when the action, punched now, falls in smart working (see Dolly_Schedules::is_smart_punch()). */
	public static function smart_now( array $plan, $action ) {
		return Dolly_Schedules::is_smart_punch( $plan, $action, Dolly_Time::hm_to_min( Dolly_Time::now_hm() ) );
	}

	/**
	 * Records an employee punch with server time.
	 *
	 * @param array $input { action, request_key, gps?: {lat,lng,accuracy}, ticket?: string }
	 */
	public static function punch( $user_id, array $input ) {
		global $wpdb;
		$action = (string) ( $input['action'] ?? '' );
		$key    = (string) ( $input['request_key'] ?? '' );
		if ( ! isset( self::ACTIONS[ $action ] ) ) {
			return new WP_Error( 'dolly_invalid_action', __( 'Invalid action.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		if ( ! preg_match( '/^[A-Za-z0-9-]{8,64}$/', $key ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Invalid request. Refresh the page.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		$t = Dolly_Install::t( 'punches' );

		// Idempotency: network retries or repeated taps with the same key return the original result.
		$existing = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE request_key = %s", $key ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		if ( $existing ) {
			if ( (int) $existing->user_id !== (int) $user_id ) {
				return new WP_Error( 'dolly_invalid', __( 'Invalid request.', 'dolly-employee-management' ), array( 'status' => 400 ) );
			}
			return array(
				'duplicate' => true,
				'message'   => sprintf( /* translators: %1$s: punch type (e.g. Entry), %2$s: time (HH:MM). */ __( '%1$s already recorded at %2$s.', 'dolly-employee-management' ), Dolly_I18n::t( self::ACTIONS[ $existing->action ] ), Dolly_Time::utc_to_local( $existing->punched_at, 'H:i' ) ),
				'state'     => self::state( $user_id ),
			);
		}

		$lock = $wpdb->prefix . 'dolly_punch_' . (int) $user_id;
		if ( ! $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 5)', $lock ) ) ) {
			return new WP_Error( 'dolly_busy', __( 'Another clock-in is in progress. Wait a few seconds.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		try {
			$date    = Dolly_Time::today();
			$plan    = Dolly_Schedules::day_plan( $user_id, $date );
			$punches = self::punches_for( $user_id, $date );
			if ( empty( $punches ) ) {
				$blocked = self::blocked_reason( $user_id, $date, $plan );
				if ( $blocked ) {
					return new WP_Error( 'dolly_not_eligible', $blocked, array( 'status' => 403 ) );
				}
			}
			$next = self::next_actions( $punches, $plan );
			if ( $action !== $next['primary'] && $action !== $next['secondary'] ) {
				if ( isset( $punches[ $action ] ) ) {
					$msg = sprintf( /* translators: %1$s: punch type (e.g. Entry), %2$s: time (HH:MM). */ __( '%1$s already recorded at %2$s.', 'dolly-employee-management' ), Dolly_I18n::t( self::ACTIONS[ $action ] ), Dolly_Time::utc_to_local( $punches[ $action ]->punched_at, 'H:i' ) );
				} elseif ( $next['completed'] ) {
					$msg = __( 'The day is already closed with a clock-out.', 'dolly-employee-management' );
				} else {
					$msg = sprintf( /* translators: %s: expected punch type. */ __( 'Operation not allowed: the next action is "%s".', 'dolly-employee-management' ), Dolly_I18n::t( self::ACTIONS[ $next['primary'] ] ) );
				}
				return new WP_Error( 'dolly_invalid_transition', $msg, array( 'status' => 409, 'state' => self::state( $user_id ) ) );
			}

			$verified = self::smart_now( $plan, $action ) ? self::smart_verified( $user_id, $punches ) : self::verify( $user_id, $input, $punches );
			if ( is_wp_error( $verified ) ) {
				return $verified;
			}

			$row = array(
				'user_id'       => $user_id,
				'work_date'     => $date,
				'action'        => $action,
				'punched_at'    => Dolly_Time::now_utc(),
				'workplace_id'  => $verified['workplace_id'],
				'method'        => $verified['method'],
				'lat'           => $verified['lat'] ?? null,
				'lng'           => $verified['lng'] ?? null,
				'accuracy_m'    => $verified['accuracy'] ?? null,
				'distance_m'    => $verified['distance'] ?? null,
				'challenge_ref' => $verified['ref'] ?? null,
				'exception_id'  => isset( $verified['exception'] ) ? (int) $verified['exception']->id : null,
				'source'        => 'employee',
				'request_key'   => $key,
				'is_active'     => 1,
				'created_by'    => $user_id,
				'created_at'    => Dolly_Time::now_utc(),
			);
			$suppress = $wpdb->suppress_errors( true );
			$ok       = $wpdb->insert( $t, $row );
			$wpdb->suppress_errors( $suppress );
			if ( ! $ok ) {
				// Unique constraints caught a concurrent duplicate.
				return new WP_Error( 'dolly_duplicate', sprintf( /* translators: %s: punch type (e.g. Entry). */ __( '%s already recorded.', 'dolly-employee-management' ), Dolly_I18n::t( self::ACTIONS[ $action ] ) ), array( 'status' => 409, 'state' => self::state( $user_id ) ) );
			}
			$punch_id = (int) $wpdb->insert_id;
			if ( isset( $verified['exception'] ) ) {
				Dolly_Verification::mark_exception_used( $verified['exception'], $punch_id, $action );
			}
		} finally {
			$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock ) );
		}

		if ( 'entrata' === $action ) {
			Dolly_Anomalies::resolve_absence( $user_id, $date, $date, 'entry_recorded', __( 'Clock-in recorded at ', 'dolly-employee-management' ) . Dolly_Time::utc_to_local( $row['punched_at'], 'H:i' ) . '.' );
		}
		if ( 'uscita' === $action ) {
			Dolly_Anomalies::evaluate_exit( $user_id, $date );
		}
		if ( 'uscita' === $action ) {
			Dolly_Hours::touch( $user_id, $date ); // The day is complete: its hours enter the history.
		}
		$w = 'smart' === $verified['method'] ? null : Dolly_Workplaces::get( (int) $verified['workplace_id'] );
		return array(
			'duplicate' => false,
			'message'   => sprintf( /* translators: %1$s: punch type, %2$s: time (HH:MM), %3$s: " at <workplace>" or " remotely" (may be empty). */ __( '%1$s recorded at %2$s%3$s.', 'dolly-employee-management' ), Dolly_I18n::t( self::ACTIONS[ $action ] ), Dolly_Time::utc_to_local( $row['punched_at'], 'H:i' ), $w ? __( ' at ', 'dolly-employee-management' ) . $w->name : ( 'smart' === $verified['method'] ? __( ' remotely', 'dolly-employee-management' ) : '' ) ),
			'state'     => self::state( $user_id ),
		);
	}

	/**
	 * Smart working: no presence verification. The punch keeps the employee's workplace (the one of the
	 * day's entry, otherwise the first assigned) so the workplace views still list the employee.
	 */
	private static function smart_verified( $user_id, $punches ) {
		$wid = isset( $punches['entrata'] ) && $punches['entrata']->workplace_id ? (int) $punches['entrata']->workplace_id : 0;
		if ( ! $wid ) {
			$ids = Dolly_Workplaces::ids_for_user( $user_id );
			$wid = $ids ? $ids[0] : 0;
		}
		return array(
			'workplace_id' => $wid ? $wid : null,
			'method'       => 'smart',
		);
	}

	/**
	 * Applies the plugin-wide verification mode. Exceptions bypass both GPS and QR/PIN.
	 */
	private static function verify( $user_id, $input, $punches ) {
		$exception = Dolly_Verification::active_exception( $user_id );
		if ( $exception ) {
			$wid = isset( $punches['entrata'] ) && $punches['entrata']->workplace_id ? (int) $punches['entrata']->workplace_id : 0;
			if ( ! $wid ) {
				$ids = Dolly_Workplaces::ids_for_user( $user_id );
				$wid = $ids ? $ids[0] : 0;
				if ( ! empty( $input['workplace_id'] ) && in_array( (int) $input['workplace_id'], $ids, true ) ) {
					$wid = (int) $input['workplace_id'];
				}
			}
			return array(
				'workplace_id' => $wid,
				'method'       => 'exception',
				'exception'    => $exception,
			);
		}

		$v          = Dolly_Settings::verification();
		$methods    = $v['methods'];
		$has_ticket = ! empty( $input['ticket'] );
		$has_gps    = ! empty( $input['gps'] );

		if ( $has_ticket ) {
			$t = Dolly_Verification::read_ticket( $user_id, $input['ticket'] );
			if ( is_wp_error( $t ) ) {
				return $t;
			}
			$kind = 'ble' === $t['method'] ? 'ble' : 'qrpin';
			if ( ! in_array( $kind, $methods, true ) ) {
				return new WP_Error( 'dolly_method_not_allowed', __( 'This verification method is not enabled. Use one of the methods shown in the app.', 'dolly-employee-management' ), array( 'status' => 400 ) );
			}
			if ( ! $v['require_gps'] ) {
				return $t;
			}
			// GPS as well: the position must be within the radius of the workplace of the code.
			$g = Dolly_Verification::verify_gps( $user_id, $input['gps'] ?? null );
			if ( is_wp_error( $g ) ) {
				return $g;
			}
			$w = Dolly_Workplaces::get( $t['workplace_id'] );
			if ( null === $w->lat || null === $w->lng ) {
				return new WP_Error( 'dolly_gps_no_workplace', __( 'The workplace has no coordinates configured.', 'dolly-employee-management' ), array( 'status' => 400 ) );
			}
			$d = Dolly_Workplaces::distance( $g['lat'], $g['lng'], (float) $w->lat, (float) $w->lng );
			if ( $d > (int) $w->radius_m ) {
				return new WP_Error( 'dolly_gps_out_of_range', sprintf( /* translators: %1$s: workplace name, %2$d: distance in meters. */ __( 'Your location does not match the workplace %1$s (about %2$d m).', 'dolly-employee-management' ), $w->name, (int) round( $d ) ), array( 'status' => 403 ) );
			}
			return array_merge(
				$g,
				array(
					'workplace_id' => $t['workplace_id'],
					'method'       => 'gps_' . $t['method'],
					'ref'          => $t['ref'],
					'distance'     => (int) round( $d ),
				)
			);
		}
		if ( $v['require_gps'] ) {
			return new WP_Error( 'dolly_need_qrpin', __( 'GPS location and a workplace code are required (', 'dolly-employee-management' ) . self::code_methods_label( $methods ) . ').', array( 'status' => 400 ) );
		}
		if ( $has_gps && in_array( 'gps', $methods, true ) ) {
			return Dolly_Verification::verify_gps( $user_id, $input['gps'] );
		}
		if ( ! in_array( 'gps', $methods, true ) ) {
			return new WP_Error( 'dolly_need_qrpin', __( 'Verify your attendance with ', 'dolly-employee-management' ) . self::code_methods_label( $methods ) . '.', array( 'status' => 400 ) );
		}
		return new WP_Error( 'dolly_need_verification', __( 'Verify your attendance: ', 'dolly-employee-management' ) . implode( ', ', Dolly_I18n::labels( array_intersect_key( Dolly_Settings::VERIFICATION_METHODS, array_flip( $methods ) ) ) ) . '.', array( 'status' => 400 ) );
	}

	/** "QR o PIN", "Bluetooth" or "QR, PIN o Bluetooth" for the allowed code methods. */
	private static function code_methods_label( $methods ) {
		$qr  = in_array( 'qrpin', $methods, true );
		$ble = in_array( 'ble', $methods, true );
		return $qr && $ble ? __( 'QR, PIN or Bluetooth', 'dolly-employee-management' ) : ( $ble ? 'Bluetooth' : __( 'QR or PIN', 'dolly-employee-management' ) );
	}

	/**
	 * Administrator correction: adds, changes, or removes one punch. Previous values stay in history.
	 *
	 * @param string|null $time HH:MM (Rome) or null/'' to remove the punch.
	 */
	public static function correct( $user_id, $date, $action, $time, $reason, $workplace_id = 0, $request_id = 0 ) {
		global $wpdb;
		if ( ! Dolly_Employees::is_employee( $user_id ) ) {
			return new WP_Error( 'dolly_not_found', __( 'Employee not found.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		if ( ! Dolly_Time::is_date( $date ) || $date > Dolly_Time::today() ) {
			return new WP_Error( 'dolly_invalid', __( 'Invalid date (future dates are not allowed).', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'date' => __( 'Invalid date.', 'dolly-employee-management' ) ) ) );
		}
		if ( ! isset( self::ACTIONS[ $action ] ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Invalid action.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'action' => __( 'Invalid action.', 'dolly-employee-management' ) ) ) );
		}
		$reason = sanitize_textarea_field( $reason );
		if ( '' === $reason ) {
			return new WP_Error( 'dolly_invalid', __( 'Enter the reason for the correction.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'reason' => __( 'Enter the reason.', 'dolly-employee-management' ) ) ) );
		}
		$remove = ( null === $time || '' === $time );
		if ( ! $remove && ! Dolly_Time::is_time( $time ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Invalid time.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'time' => __( 'Invalid time.', 'dolly-employee-management' ) ) ) );
		}
		if ( ! $remove && $date === Dolly_Time::today() && Dolly_Time::hm_to_min( $time ) > Dolly_Time::hm_to_min( Dolly_Time::now_hm() ) ) {
			return new WP_Error( 'dolly_invalid', __( 'You cannot enter a future time.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'time' => __( 'Future time.', 'dolly-employee-management' ) ) ) );
		}

		$t    = Dolly_Install::t( 'punches' );
		$lock = $wpdb->prefix . 'dolly_punch_' . (int) $user_id;
		if ( ! $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 5)', $lock ) ) ) {
			return new WP_Error( 'dolly_busy', __( 'Operation in progress, try again.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		try {
			$punches = self::punches_for( $user_id, $date );
			$old     = $punches[ $action ] ?? null;
			if ( $remove && ! $old ) {
				return new WP_Error( 'dolly_invalid', __( 'There is no clock-in to cancel.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'action' => __( 'No clock-in.', 'dolly-employee-management' ) ) ) );
			}
			// Removing a punch must not leave later punches without their predecessor.
			if ( $remove ) {
				$dependents = array(
					'entrata'      => array( 'inizio_pausa', 'fine_pausa', 'uscita' ),
					'inizio_pausa' => array( 'fine_pausa' ),
				);
				foreach ( $dependents[ $action ] ?? array() as $later ) {
					if ( isset( $punches[ $later ] ) ) {
						return new WP_Error( 'dolly_invalid', sprintf( /* translators: %s: punch type. */ __( 'First cancel the clock-in "%s", which depends on this one.', 'dolly-employee-management' ), Dolly_I18n::t( self::ACTIONS[ $later ] ) ), array( 'status' => 400, 'fields' => array( 'action' => __( 'Later clock-ins exist.', 'dolly-employee-management' ) ) ) );
					}
				}
			}

			// Chronological consistency with the other punches of the day.
			if ( ! $remove ) {
				$times            = array();
				foreach ( $punches as $a => $p ) {
					$times[ $a ] = Dolly_Time::hm_to_min( Dolly_Time::utc_to_local( $p->punched_at, 'H:i' ) );
				}
				$times[ $action ] = Dolly_Time::hm_to_min( $time );
				$order            = array_keys( self::ACTIONS );
				$prev             = -1;
				foreach ( $order as $a ) {
					if ( isset( $times[ $a ] ) ) {
						if ( $times[ $a ] < $prev ) {
							return new WP_Error( 'dolly_invalid', __( 'Times must follow the order Clock-in → Break start → Break end → Clock-out.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'time' => __( 'Time out of sequence.', 'dolly-employee-management' ) ) ) );
						}
						$prev = $times[ $a ];
					}
				}
				if ( 'entrata' !== $action && ! isset( $times['entrata'] ) ) {
					return new WP_Error( 'dolly_invalid', __( 'Enter the clock-in first.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'action' => __( 'Clock-in is missing.', 'dolly-employee-management' ) ) ) );
				}
				if ( 'fine_pausa' === $action && ! isset( $times['inizio_pausa'] ) ) {
					return new WP_Error( 'dolly_invalid', __( 'Enter the break start first.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'action' => __( 'Break start is missing.', 'dolly-employee-management' ) ) ) );
				}
			}

			$now = Dolly_Time::now_utc();
			if ( $old ) {
				$wpdb->update(
					$t,
					array(
						'is_active' => null,
						'voided_at' => $now,
						'voided_by' => get_current_user_id(),
					),
					array( 'id' => $old->id )
				);
			}
			$new_id = 0;
			if ( ! $remove ) {
				$wid = (int) $workplace_id;
				if ( ! $wid ) {
					$wid = $old && $old->workplace_id ? (int) $old->workplace_id : ( isset( $punches['entrata'] ) ? (int) $punches['entrata']->workplace_id : 0 );
				}
				if ( ! $wid ) {
					$ids = Dolly_Workplaces::ids_for_user( $user_id, $date );
					$wid = $ids ? $ids[0] : null;
				}
				$wpdb->insert(
					$t,
					array(
						'user_id'      => $user_id,
						'work_date'    => $date,
						'action'       => $action,
						'punched_at'   => Dolly_Time::local_to_utc( $date, $time ),
						'workplace_id' => $wid,
						'method'       => 'correction',
						'source'       => 'admin',
						'is_active'    => 1,
						'created_by'   => get_current_user_id(),
						'created_at'   => $now,
					)
				);
				$new_id = (int) $wpdb->insert_id;
			}
		} finally {
			$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock ) );
		}

		$before = $old ? array( 'action' => $action, 'time' => Dolly_Time::utc_to_local( $old->punched_at, 'H:i' ), 'method' => $old->method ) : null;
		$after  = $remove ? null : array( 'action' => $action, 'time' => $time, 'method' => 'correction' );
		$verb   = $remove ? 'punch_removed' : ( $old ? 'punch_corrected' : 'punch_added' );
		$reason_full = $request_id ? $reason . __( ' (request #', 'dolly-employee-management' ) . (int) $request_id . ')' : $reason;
		Dolly_Audit::log( $verb, 'punch', $new_id ? $new_id : ( $old ? (int) $old->id : 0 ), $user_id, $reason_full, array_merge( array( 'date' => Dolly_Time::fmt_date( $date ) ), (array) $before ), $after ? array_merge( array( 'date' => Dolly_Time::fmt_date( $date ) ), $after ) : null );

		if ( 'uscita' === $action && ! $remove ) {
			Dolly_Anomalies::resolve_exit_anomalies( $user_id, $date, 'corrected', $reason_full );
		}
		if ( 'entrata' === $action && ! $remove ) {
			Dolly_Anomalies::resolve_absence( $user_id, $date, $date, 'corrected', $reason_full, null );
		}
		Dolly_Anomalies::evaluate_exit( $user_id, $date );
		Dolly_Hours::touch( $user_id, $date );
		return self::day_detail( $user_id, $date );
	}

	/** Detail used by admin correction dialogs. */
	public static function day_detail( $user_id, $date ) {
		$punches = self::punches_for( $user_id, $date );
		$out     = array();
		foreach ( self::ACTIONS as $a => $label ) {
			$out[ $a ] = isset( $punches[ $a ] ) ? self::format_punch( $punches[ $a ] ) : null;
		}
		return array(
			'date'    => $date,
			'plan'    => Dolly_Schedules::day_plan( $user_id, $date ),
			'punches' => $out,
		);
	}

	/**
	 * Counted entry and exit of a day (unix timestamps) derived from the recorded punches, which stay unchanged:
	 * - an entry within the late tolerance of the scheduled start (workplace value or plugin default)
	 *   counts as the scheduled start; later entries count as recorded and report the minutes of delay;
	 * - with rounding enabled, an exit after the shift end is rounded to the nearest step
	 *   (end 16:30, step 15: 16:37 → 16:30, 16:38–16:52 → 16:45).
	 *
	 * @return array{entrata: ?int, uscita: ?int, late: int}
	 */
	public static function effective_times( $date, array $punches, array $plan ) {
		$out = array( 'entrata' => null, 'uscita' => null, 'late' => 0 );
		if ( isset( $punches['entrata'] ) ) {
			$in             = Dolly_Time::utc_ts( $punches['entrata']->punched_at );
			$out['entrata'] = $in;
			if ( $plan['start'] ) {
				$start = Dolly_Time::local_ts( $date, $plan['start'] );
				if ( $in > $start ) {
					$late = intdiv( $in - $start, 60 );
					if ( $late <= Dolly_Workplaces::late_tolerance( (int) $punches['entrata']->workplace_id ) ) {
						$out['entrata'] = $start;
					} else {
						$out['late'] = $late;
					}
				}
			}
		}
		if ( isset( $punches['uscita'] ) ) {
			$exit          = Dolly_Time::utc_ts( $punches['uscita']->punched_at );
			$out['uscita'] = $exit;
			if ( $plan['end'] && Dolly_Settings::get( 'exit_rounding' ) ) {
				$end = Dolly_Time::local_ts( $date, $plan['end'] );
				if ( $exit > $end ) {
					$step          = max( 1, (int) Dolly_Settings::get( 'rounding_step' ) );
					$after         = intdiv( $exit - $end, 60 );
					$out['uscita'] = $end + (int) round( $after / $step ) * $step * 60;
				}
			}
		}
		return $out;
	}

	/** Removes the window [$from, $to] from a list of intervals; returns the removed seconds in $removed. */
	private static function subtract_window( array $intervals, $from, $to, &$removed ) {
		$out     = array();
		$removed = 0;
		foreach ( $intervals as $iv ) {
			$overlap = max( 0, min( $iv[1], $to ) - max( $iv[0], $from ) );
			if ( ! $overlap ) {
				$out[] = $iv;
				continue;
			}
			$removed += $overlap;
			if ( $iv[0] < $from ) {
				$out[] = array( $iv[0], $from );
			}
			if ( $iv[1] > $to ) {
				$out[] = array( $to, $iv[1] );
			}
		}
		return $out;
	}

	/** Seconds of the intervals that fall in smart working (see Dolly_Schedules::mixed_split()). */
	private static function smart_seconds( $date, array $intervals, array $plan ) {
		$mode = $plan['work_mode'] ?? 'office';
		if ( ! empty( $plan['on_call'] ) || ! empty( $plan['rest_day_extra'] ) || 'office' === $mode ) {
			return 0;
		}
		$from = PHP_INT_MIN;
		$to   = PHP_INT_MAX;
		if ( 'mixed' === $mode ) {
			$split = Dolly_Schedules::mixed_split( $plan );
			$at    = Dolly_Time::local_ts( $date, sprintf( '%02d:%02d', intdiv( $split['at'], 60 ), $split['at'] % 60 ) );
			if ( $split['smart_after'] ) {
				$from = $at;
			} else {
				$to = $at;
			}
		}
		$sec = 0;
		foreach ( $intervals as $iv ) {
			$sec += max( 0, min( $iv[1], $to ) - max( $iv[0], $from ) );
		}
		return $sec;
	}

	/**
	 * Calculates worked minutes for a day from the counted entry/exit (see effective_times()).
	 * - Automatic lunch: when lunch is not clocked, the scheduled lunch window is deducted.
	 * - Approved hourly leave is subtracted only where it overlaps the working intervals.
	 * - Time after the shift end is overtime: approved automatically up to the daily limit
	 *   (setting "overtime_auto"), beyond it only up to an approved extension; the rest is "extra_over".
	 *
	 * @param array $punches  [action => row]
	 * @param array $plan     Dolly_Schedules::day_plan()
	 * @param array $leaves   hourly leave rows (start_time/end_time)
	 * @return array{worked:int, extra:int, extra_auto:int, extra_over:int, leave_deducted:int, lunch_deducted:int, festive:int, smart:int, complete:bool, entrata:?int, uscita:?int, late:int}
	 */
	public static function compute( $date, array $punches, array $plan, array $leaves = array() ) {
		$ts = array();
		foreach ( $punches as $a => $p ) {
			$ts[ $a ] = Dolly_Time::utc_ts( $p->punched_at );
		}
		$eff = self::effective_times( $date, $punches, $plan );
		if ( isset( $ts['entrata'] ) ) {
			$ts['entrata'] = $eff['entrata'];
		}
		if ( isset( $ts['uscita'] ) ) {
			$ts['uscita'] = $eff['uscita'];
		}
		$intervals = array();
		$complete  = isset( $ts['entrata'], $ts['uscita'] );
		if ( isset( $ts['entrata'] ) ) {
			if ( isset( $ts['inizio_pausa'] ) ) {
				$intervals[] = array( $ts['entrata'], $ts['inizio_pausa'] );
				if ( isset( $ts['fine_pausa'], $ts['uscita'] ) ) {
					$intervals[] = array( $ts['fine_pausa'], $ts['uscita'] );
				}
			} elseif ( isset( $ts['uscita'] ) ) {
				$intervals[] = array( $ts['entrata'], $ts['uscita'] );
			}
		}

		$lunch = 0;
		if ( ! isset( $ts['inizio_pausa'] ) && ! empty( $plan['lunch_auto'] ) && $plan['lunch_start'] && $plan['lunch_end'] ) {
			$intervals = self::subtract_window( $intervals, Dolly_Time::local_ts( $date, $plan['lunch_start'] ), Dolly_Time::local_ts( $date, $plan['lunch_end'] ), $lunch );
		}

		$worked = 0;
		foreach ( $intervals as $iv ) {
			$worked += max( 0, $iv[1] - $iv[0] );
		}
		$smart = self::smart_seconds( $date, $intervals, $plan );

		$deducted = 0;
		foreach ( $leaves as $l ) {
			if ( ! $l->start_time || ! $l->end_time ) {
				continue;
			}
			$ls = Dolly_Time::local_ts( $date, Dolly_Time::hm( $l->start_time ) );
			$le = Dolly_Time::local_ts( $date, Dolly_Time::hm( $l->end_time ) );
			foreach ( $intervals as $iv ) {
				$deducted += max( 0, min( $iv[1], $le ) - max( $iv[0], $ls ) );
			}
		}
		$worked = max( 0, $worked - $deducted );
		$smart  = min( $smart, $worked );

		$extra = 0;
		$auto  = 0;
		$over  = 0;
		if ( $plan['rest_day_extra'] ) {
			// Rest day with authorised extra work: all overtime.
			$extra = $worked;
		} elseif ( $plan['scheduled'] && $plan['end'] ) {
			$bs    = Dolly_Time::local_ts( $date, $plan['end'] );
			$limit = $bs + max( 0, (int) Dolly_Settings::get( 'overtime_auto' ) ) * 60;
			$be    = $limit;
			if ( $plan['extension_end'] ) {
				$be = max( $be, Dolly_Time::local_ts( $date, $plan['extension_end'] ) );
			}
			foreach ( $intervals as $iv ) {
				$extra += max( 0, min( $iv[1], $be ) - max( $iv[0], $bs ) );
				$auto  += max( 0, min( $iv[1], $limit ) - max( $iv[0], $bs ) );
				$over  += max( 0, $iv[1] - max( $iv[0], $be ) );
			}
		}

		return array(
			'worked'         => (int) round( $worked / 60 ),
			'extra'          => (int) round( $extra / 60 ),
			'extra_auto'     => (int) round( $auto / 60 ),
			'extra_over'     => (int) round( $over / 60 ),
			'leave_deducted' => (int) round( $deducted / 60 ),
			'lunch_deducted' => (int) round( $lunch / 60 ),
			// Holiday closure or national holiday: all the hours worked get the holiday increase.
			'festive'        => ! empty( $plan['festive'] ) ? (int) round( $worked / 60 ) : 0,
			// Minutes worked in smart working (whole day, or the smart block of a mixed day).
			'smart'          => (int) round( $smart / 60 ),
			'complete'       => $complete,
			'entrata'        => $eff['entrata'],
			'uscita'         => $eff['uscita'],
			'late'           => $eff['late'],
		);
	}
}
