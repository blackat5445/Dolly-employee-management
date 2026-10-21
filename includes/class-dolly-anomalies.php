<?php
/**
 * Anomalies: missing final exit, unjustified absence, missing certificates, sickness conflicts.
 *
 * Exit rule: an anomaly is created when the final clock-out is still missing after 23:59 of the
 * working day. Time worked after the shift end is overtime (see Dolly_Attendance::compute()), so a late
 * exit is no longer an anomaly ("late_exit" rows from earlier versions stay readable and resolvable).
 * Absence rule: an anomaly is created when an employee expected at work has no entry a configurable
 * number of minutes after the scheduled start.
 * Resolved anomalies and their resolution history are preserved.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Anomalies {

	const TYPES = array(
		'unjustified_absence' => 'Absent without justification',
		'missing_exit'        => 'Missing clock-out',
		'late_exit'           => 'Clock-out after authorized time',
		'missing_certificate' => 'Missing certificate',
		'sickness_conflict'   => 'Conflicting sickness/injury',
	);

	const RESOLUTIONS = array(
		'approved_extra'        => 'Overtime approved',
		'corrected'             => 'Corrected time',
		'entry_recorded'        => 'Clock-in recorded',
		'justified'             => 'Justified absence',
		'dismissed'             => 'Closed by the administrator',
		'certificate_uploaded'  => 'Certificate uploaded',
		'certificates_disabled' => 'Requirement disabled',
		'reviewed'              => 'Verified',
	);

	public static function get( $id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'anomalies' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d", $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	public static function format( $a ) {
		return array(
			'id'               => (int) $a->id,
			'user_id'          => (int) $a->user_id,
			'employee'         => Dolly_Employees::sort_name( (int) $a->user_id ),
			'work_date'        => $a->work_date,
			'type'             => $a->type,
			'type_label'       => ( Dolly_I18n::t( self::TYPES[ $a->type ] ?? $a->type ) ) . ( $a->overdue ? __( ' (overdue)', 'dolly-employee-management' ) : '' ),
			'status'           => $a->status,
			'overdue'          => (bool) $a->overdue,
			'related_type'     => $a->related_type,
			'related_id'       => $a->related_id ? (int) $a->related_id : null,
			'details'          => (string) $a->details,
			'employee_note'    => (string) $a->employee_note,
			'resolution'       => $a->resolution,
			'resolution_label' => $a->resolution ? ( Dolly_I18n::t( self::RESOLUTIONS[ $a->resolution ] ?? $a->resolution ) ) : '',
			'resolution_note'  => (string) $a->resolution_note,
			'resolved_by'      => $a->resolved_by ? Dolly_Employees::display_name( (int) $a->resolved_by ) : '',
			'resolved_at'      => Dolly_Time::iso( $a->resolved_at ),
			'created_at'       => Dolly_Time::iso( $a->created_at ),
		);
	}

	/**
	 * Opens an anomaly once per unique key (duplicate-safe under concurrency).
	 */
	public static function open( $user_id, $type, $key, $date, $rel_type, $rel_id, $details ) {
		global $wpdb;
		$t   = Dolly_Install::t( 'anomalies' );
		$now = Dolly_Time::now_utc();
		$ok  = $wpdb->query(
			$wpdb->prepare(
				"INSERT IGNORE INTO $t (user_id, work_date, type, status, overdue, uniq_key, related_type, related_id, details, created_at, updated_at) VALUES (%d, %s, %s, 'open', 0, %s, %s, %d, %s, %s, %s)", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
				$user_id,
				$date,
				$type,
				$key,
				(string) $rel_type,
				(int) $rel_id,
				$details,
				$now,
				$now
			)
		);
		if ( ! $ok ) {
			return 0;
		}
		$id    = (int) $wpdb->insert_id;
		// Built in each recipient's language.
		$label = fn () => Dolly_I18n::t( self::TYPES[ $type ] );
		$when  = fn () => $date ? __( ' on ', 'dolly-employee-management' ) . Dolly_Time::fmt_date( $date ) : '';
		if ( 'missing_certificate' !== $type ) { // Certificate notifications are sent by the dedicated events.
			Dolly_Notifications::notify_user( $user_id, 'anomaly_created', fn () => array( $label() . $when(), $details ), null, 'dashboard', 'anom-' . $id );
			Dolly_Notifications::notify_admins( 'anomaly_created', fn () => array( $label() . ': ' . Dolly_Employees::display_name( $user_id ) . $when(), $details ), null, 'dolly-anomalies', 'anom-' . $id );
		}
		return $id;
	}

	private static function close( $a, $resolution, $note, $actor = null ) {
		global $wpdb;
		$now = Dolly_Time::now_utc();
		$wpdb->update(
			Dolly_Install::t( 'anomalies' ),
			array(
				'status'          => 'resolved',
				'resolution'      => $resolution,
				'resolution_note' => $note,
				'resolved_by'     => null === $actor ? get_current_user_id() : (int) $actor,
				'resolved_at'     => $now,
				'updated_at'      => $now,
			),
			array( 'id' => $a->id, 'status' => 'open' )
		);
		Dolly_Audit::log( 'anomaly_resolved', 'anomaly', (int) $a->id, (int) $a->user_id, $note, array( 'status' => 'open', 'type' => $a->type ), array( 'status' => 'resolved', 'resolution' => $resolution ) );
		if ( in_array( $a->type, array( 'missing_exit', 'late_exit', 'sickness_conflict', 'unjustified_absence' ), true ) ) {
			Dolly_Notifications::notify_user( (int) $a->user_id, 'anomaly_resolved', fn () => array( __( 'Anomaly resolved: ', 'dolly-employee-management' ) . ( Dolly_I18n::t( self::TYPES[ $a->type ] ?? '' ) ), ( Dolly_I18n::t( self::RESOLUTIONS[ $resolution ] ?? '' ) ) . ( $note ? ' — ' . $note : '' ) ), null, 'dashboard', 'anomres-' . $a->id );
		}
	}

	public static function resolve_by_key( $key, $resolution, $note ) {
		global $wpdb;
		$t = Dolly_Install::t( 'anomalies' );
		$a = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE uniq_key = %s AND status = 'open'", $key ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		if ( $a ) {
			self::close( $a, $resolution, $note );
		}
	}

	public static function mark_overdue( $key ) {
		global $wpdb;
		$t = Dolly_Install::t( 'anomalies' );
		$wpdb->query( $wpdb->prepare( "UPDATE $t SET overdue = 1, updated_at = %s WHERE uniq_key = %s AND status = 'open'", Dolly_Time::now_utc(), $key ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	/** Open exit anomalies for a user/date. */
	private static function open_exit_anomalies( $user_id, $date ) {
		global $wpdb;
		$t = Dolly_Install::t( 'anomalies' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND work_date = %s AND type IN ('missing_exit','late_exit') AND status = 'open'", $user_id, $date ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	public static function resolve_exit_anomalies( $user_id, $date, $resolution, $note ) {
		foreach ( self::open_exit_anomalies( $user_id, $date ) as $a ) {
			self::close( $a, $resolution, $note );
		}
	}

	/**
	 * Evaluates the exit rule for one user/date. Never creates or modifies punches.
	 * - Exit recorded: keeps the automatic overtime approval request in line with it.
	 * - Exit still missing after 23:59 of the working day: opens a "missing exit" anomaly.
	 *
	 * @param bool $after_extra_approval True when an extra-work authorisation was just approved.
	 */
	public static function evaluate_exit( $user_id, $date, $after_extra_approval = false ) {
		Dolly_Requests::sync_oncall_shift( $user_id, $date );
		Dolly_Requests::sync_smart_day( $user_id, $date );
		$punches = Dolly_Attendance::punches_for( $user_id, $date );
		if ( ! isset( $punches['entrata'] ) ) {
			return;
		}
		if ( isset( $punches['uscita'] ) ) {
			if ( $after_extra_approval ) {
				foreach ( self::open_exit_anomalies( $user_id, $date ) as $a ) {
					if ( 'late_exit' === $a->type ) {
						self::close( $a, 'approved_extra', __( 'Overtime approved.', 'dolly-employee-management' ) );
					}
				}
			}
			Dolly_Requests::sync_auto_overtime( $user_id, $date );
			return;
		}
		if ( time() <= Dolly_Time::local_ts( $date, '23:59:59' ) ) {
			return;
		}
		$details = sprintf( /* translators: %1$s: date, %2$s: clock-in time (HH:MM). */ __( 'Clock-out not recorded by 23:59 on %1$s (clock-in at %2$s).', 'dolly-employee-management' ), Dolly_Time::fmt_date( $date ), Dolly_Time::utc_to_local( $punches['entrata']->punched_at, 'H:i' ) );
		self::open( $user_id, 'missing_exit', 'exit-' . $user_id . '-' . $date, $date, 'day', 0, $details );
	}

	/**
	 * Scheduled: opens "unjustified absence" when an employee expected at work has no entry
	 * the configured number of minutes after the scheduled start (or after the end of an approved
	 * hourly leave covering the start). Rest days, holidays, sickness/injury, vacation and
	 * employees without a workplace are never flagged. Checks today and yesterday, so a
	 * scheduler pause does not lose days; days before the feature was installed are skipped.
	 */
	public static function check_absences() {
		global $wpdb;
		if ( ! Dolly_Settings::get( 'absence_check' ) ) {
			return;
		}
		$users = Dolly_Employees::active_ids();
		if ( ! $users ) {
			return;
		}
		$delay = (int) Dolly_Settings::get( 'absence_delay' );
		$since = (string) get_option( 'dolly_absence_since', '' );
		$today = Dolly_Time::today();
		$t     = Dolly_Install::t( 'anomalies' );
		foreach ( array( Dolly_Time::add_days( $today, -1 ), $today ) as $date ) {
			if ( ( $since && $date < $since ) || Dolly_Holidays::is_holiday( $date ) ) {
				continue;
			}
			$flagged = array_map( 'intval', $wpdb->get_col( $wpdb->prepare( "SELECT user_id FROM $t WHERE type = 'unjustified_absence' AND work_date = %s", $date ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
			$punches = Dolly_Attendance::punches_range( $users, $date, $date );
			foreach ( $users as $uid ) {
				if ( in_array( $uid, $flagged, true ) || ! empty( $punches[ $uid ][ $date ] ) ) {
					continue;
				}
				$plan = Dolly_Schedules::day_plan( $uid, $date );
				// On-call employees have no start time; closures justify the absence.
				if ( ! $plan['eligible'] || ! $plan['start'] || $plan['closure'] ) {
					continue;
				}
				$expected = $plan['start'];
				foreach ( Dolly_Requests::hourly_leaves( $uid, $date ) as $l ) {
					if ( Dolly_Time::hm( $l->start_time ) <= $expected && Dolly_Time::hm( $l->end_time ) > $expected ) {
						$expected = Dolly_Time::hm( $l->end_time );
					}
				}
				$deadline = Dolly_Time::local_ts( $date, $expected ) + $delay * 60;
				if ( time() < $deadline ) {
					continue;
				}
				if ( Dolly_Sickness::covers( $uid, $date ) || Dolly_Requests::full_day_leave( $uid, $date ) || ! Dolly_Workplaces::ids_for_user( $uid, $date ) ) {
					continue;
				}
				$details = sprintf(
					/* translators: %1$s: time limit (HH:MM), %2$s: scheduled start (HH:MM), %3$s: optional workplace tolerance note. */ __( 'No clock-in recorded by %1$s (scheduled start %2$s%3$s). If you were present, send a clock-in correction request.', 'dolly-employee-management' ),
					Dolly_Time::ts_to_hm( $deadline ),
					$expected,
					$delay ? ' + ' . $delay . __( ' minutes', 'dolly-employee-management' ) : ''
				);
				self::open( $uid, 'unjustified_absence', 'abs-' . $uid . '-' . $date, $date, 'day', 0, $details );
			}
		}
	}

	/**
	 * Closes open unjustified-absence anomalies of a user between two dates (entry recorded,
	 * sickness reported, leave approved...). $actor 0 = system, null = current user.
	 */
	public static function resolve_absence( $user_id, $from, $to, $resolution, $note, $actor = 0 ) {
		global $wpdb;
		$t    = Dolly_Install::t( 'anomalies' );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND type = 'unjustified_absence' AND status = 'open' AND work_date BETWEEN %s AND %s", $user_id, $from, $to ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		foreach ( $rows as $a ) {
			self::close( $a, $resolution, $note, $actor );
		}
	}

	/**
	 * Scheduled: evaluates days with an entry but no exit (today and the previous 7 days).
	 */
	public static function check_all() {
		global $wpdb;
		$p     = Dolly_Install::t( 'punches' );
		$today = Dolly_Time::today();
		$from  = Dolly_Time::add_days( $today, -7 );
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery -- Plugin tables (\$wpdb->prefix); values are prepared.
		$rows  = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT e.user_id, e.work_date FROM $p e
				LEFT JOIN $p u ON u.user_id = e.user_id AND u.work_date = e.work_date AND u.action = 'uscita' AND u.is_active = 1
				WHERE e.action = 'entrata' AND e.is_active = 1 AND e.work_date BETWEEN %s AND %s AND u.id IS NULL",
				$from,
				$today
			)
		);
		// phpcs:enable
		foreach ( $rows as $r ) {
			self::evaluate_exit( (int) $r->user_id, $r->work_date );
		}
	}

	/** Employee adds an optional note to their own anomaly. */
	public static function add_note( $user_id, $id, $note ) {
		global $wpdb;
		$a = self::get( $id );
		if ( ! $a || (int) $a->user_id !== (int) $user_id ) {
			return new WP_Error( 'dolly_not_found', __( 'Anomaly not found.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$note = sanitize_textarea_field( $note );
		$wpdb->update( Dolly_Install::t( 'anomalies' ), array( 'employee_note' => $note, 'employee_note_at' => Dolly_Time::now_utc(), 'updated_at' => Dolly_Time::now_utc() ), array( 'id' => $id ) );
		return self::format( self::get( $id ) );
	}

	/**
	 * Administrator resolution.
	 *
	 * @param array $data { action: approve_extra|correct_exit|correct_entry|dismiss|review, end_time?, time?, exit_time?, note }
	 */
	public static function admin_resolve( $id, $data ) {
		$a = self::get( $id );
		if ( ! $a ) {
			return new WP_Error( 'dolly_not_found', __( 'Anomaly not found.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		if ( 'open' !== $a->status ) {
			return new WP_Error( 'dolly_invalid_state', __( 'The anomaly is already resolved.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		$action = $data['action'] ?? '';
		$note   = sanitize_textarea_field( $data['note'] ?? '' );
		$uid    = (int) $a->user_id;
		$exit   = in_array( $a->type, array( 'missing_exit', 'late_exit' ), true );

		switch ( $action ) {
			case 'approve_extra':
				if ( ! $exit ) {
					break;
				}
				$punches = Dolly_Attendance::punches_for( $uid, $a->work_date );
				if ( ! isset( $punches['uscita'] ) ) {
					return new WP_Error( 'dolly_invalid', __( 'Clock-out is missing: first enter the correct clock-out time (approval does not create clock-ins).', 'dolly-employee-management' ), array( 'status' => 400 ) );
				}
				$plan = Dolly_Schedules::day_plan( $uid, $a->work_date );
				if ( ! $plan['scheduled'] ) {
					return new WP_Error( 'dolly_invalid', __( 'For days off, edit the overtime request or correct the clock-out.', 'dolly-employee-management' ), array( 'status' => 400 ) );
				}
				$end = $data['end_time'] ?? Dolly_Time::utc_to_local( $punches['uscita']->punched_at, 'H:i' );
				if ( ! Dolly_Time::is_time( $end ) ) {
					return new WP_Error( 'dolly_invalid', __( 'Invalid time.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'end_time' => __( 'Invalid time.', 'dolly-employee-management' ) ) ) );
				}
				$existing = Dolly_Requests::approved_extra_for( $uid, $a->work_date );
				if ( $existing ) {
					return new WP_Error( 'dolly_conflict', __( 'Approved overtime already exists for this date: edit it from the Requests section.', 'dolly-employee-management' ), array( 'status' => 409 ) );
				}
				$req = Dolly_Requests::create(
					$uid,
					array(
						'type'          => 'straordinario',
						'extra_kind'    => 'working_day',
						'start_date'    => $a->work_date,
						'end_time'      => $end,
						'notes'         => __( 'Approved from anomaly management.', 'dolly-employee-management' ),
						'decision_note' => $note,
					),
					true
				);
				if ( is_wp_error( $req ) ) {
					return $req;
				}
				$a = self::get( $id );
				if ( 'open' === $a->status ) {
					self::close( $a, 'approved_extra', $note ? $note : __( 'Overtime approved until ', 'dolly-employee-management' ) . $end . '.' );
				}
				return self::format( self::get( $id ) );

			case 'correct_exit':
				if ( ! $exit ) {
					break;
				}
				$time = (string) ( $data['time'] ?? '' );
				if ( ! Dolly_Time::is_time( $time ) ) {
					// An empty time would void the exit punch instead of correcting it.
					return new WP_Error( 'dolly_invalid', __( 'Invalid time.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'time' => __( 'Invalid time.', 'dolly-employee-management' ) ) ) );
				}
				$reason = $note ? $note : __( 'Clock-out correction from anomaly management.', 'dolly-employee-management' );
				$r      = Dolly_Attendance::correct( $uid, $a->work_date, 'uscita', $time, $reason );
				if ( is_wp_error( $r ) ) {
					return $r;
				}
				$a = self::get( $id );
				if ( 'open' === $a->status ) {
					self::close( $a, 'corrected', $reason );
				}
				return self::format( self::get( $id ) );

			case 'correct_entry':
				// Unjustified absence: the administrator enters the real entry (and optionally the exit).
				if ( 'unjustified_absence' !== $a->type ) {
					break;
				}
				$time = (string) ( $data['time'] ?? '' );
				$out  = (string) ( $data['exit_time'] ?? '' );
				if ( ! Dolly_Time::is_time( $time ) ) {
					return new WP_Error( 'dolly_invalid', __( 'Invalid clock-in time.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'time' => __( 'Invalid time.', 'dolly-employee-management' ) ) ) );
				}
				if ( '' !== $out && ! Dolly_Time::is_time( $out ) ) {
					return new WP_Error( 'dolly_invalid', __( 'Invalid clock-out time.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'exit_time' => __( 'Invalid time.', 'dolly-employee-management' ) ) ) );
				}
				$reason = $note ? $note : __( 'Clock-in entered from anomaly management.', 'dolly-employee-management' );
				$r      = Dolly_Attendance::correct( $uid, $a->work_date, 'entrata', $time, $reason );
				if ( is_wp_error( $r ) ) {
					return $r;
				}
				if ( '' !== $out ) {
					$r = Dolly_Attendance::correct( $uid, $a->work_date, 'uscita', $out, $reason );
					if ( is_wp_error( $r ) ) {
						return $r;
					}
				}
				$a = self::get( $id );
				if ( 'open' === $a->status ) {
					self::close( $a, 'corrected', $reason );
				}
				return self::format( self::get( $id ) );

			case 'review':
				if ( 'sickness_conflict' !== $a->type ) {
					break;
				}
				$r = Dolly_Sickness::review( (int) $a->related_id, $note );
				if ( is_wp_error( $r ) ) {
					return $r;
				}
				return self::format( self::get( $id ) );

			case 'dismiss':
				if ( 'missing_certificate' === $a->type ) {
					return new WP_Error( 'dolly_invalid', __( 'A missing certificate is resolved only by uploading the certificate or by turning off the requirement in the settings.', 'dolly-employee-management' ), array( 'status' => 400 ) );
				}
				if ( '' === $note ) {
					return new WP_Error( 'dolly_invalid', __( 'Enter the reason for closing it.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'note' => __( 'Enter the reason.', 'dolly-employee-management' ) ) ) );
				}
				self::close( $a, 'dismissed', $note );
				return self::format( self::get( $id ) );
		}
		return new WP_Error( 'dolly_invalid', __( 'Invalid action for this type of anomaly.', 'dolly-employee-management' ), array( 'status' => 400 ) );
	}

	public static function query( $args ) {
		global $wpdb;
		$t      = Dolly_Install::t( 'anomalies' );
		$where  = array( '1=1' );
		$params = array();
		if ( ! empty( $args['user_id'] ) ) {
			$where[]  = 'a.user_id = %d';
			$params[] = (int) $args['user_id'];
		}
		if ( ! empty( $args['status'] ) && in_array( $args['status'], array( 'open', 'resolved' ), true ) ) {
			$where[]  = 'a.status = %s';
			$params[] = $args['status'];
		}
		if ( ! empty( $args['type'] ) && isset( self::TYPES[ $args['type'] ] ) ) {
			$where[]  = 'a.type = %s';
			$params[] = $args['type'];
		}
		if ( ! empty( $args['workplace'] ) ) {
			$ids     = Dolly_Workplaces::user_ids_for_workplace( (int) $args['workplace'] );
			$where[] = $ids ? 'a.user_id IN (' . implode( ',', $ids ) . ')' : '1=0';
		}
		$w     = implode( ' AND ', $where );
		$per   = max( 1, min( 100, (int) ( $args['per_page'] ?? 10 ) ) );
		$page  = max( 1, (int) ( $args['page'] ?? 1 ) );
		$count = (int) ( $params ? $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t a WHERE $w", $params ) ) : $wpdb->get_var( "SELECT COUNT(*) FROM $t a WHERE $w" ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- plugin tables ($wpdb->prefix), values prepared or cast.
		$params[] = $per;
		$params[] = ( $page - 1 ) * $per;
		$join     = '';
		$order    = "FIELD(a.status,'open') DESC, a.created_at DESC";
		if ( 'name' === ( $args['order'] ?? '' ) ) {
			// Administrator list: alphabetical by surname, then open first, newest first.
			list( $join, $by ) = Dolly_Employees::name_order_sql( 'a.user_id' );
			$order             = $by . ", FIELD(a.status,'open') DESC, a.work_date DESC";
		}
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT a.* FROM $t a $join WHERE $w ORDER BY $order, a.id DESC LIMIT %d OFFSET %d", $params ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- plugin tables ($wpdb->prefix), values prepared or cast.
		return array(
			'items' => array_map( array( __CLASS__, 'format' ), $rows ),
			'total' => $count,
			'pages' => (int) ceil( $count / $per ),
			'page'  => $page,
		);
	}

	public static function count_open( array $user_ids = null ) {
		global $wpdb;
		$t = Dolly_Install::t( 'anomalies' );
		if ( is_array( $user_ids ) ) {
			if ( ! $user_ids ) {
				return 0;
			}
			return (int) $wpdb->get_var( "SELECT COUNT(*) FROM $t WHERE status = 'open' AND user_id IN (" . implode( ',', array_map( 'intval', $user_ids ) ) . ')' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		}
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM $t WHERE status = 'open'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	/** Open anomalies for users over a date range: [user_id][date] => [labels]. */
	public static function open_range( array $user_ids, $from, $to ) {
		global $wpdb;
		$out = array();
		if ( ! $user_ids ) {
			return $out;
		}
		$t    = Dolly_Install::t( 'anomalies' );
		$in   = implode( ',', array_map( 'intval', $user_ids ) );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT user_id, work_date, type, overdue FROM $t WHERE status = 'open' AND user_id IN ($in) AND work_date BETWEEN %s AND %s", $from, $to ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		foreach ( $rows as $r ) {
			$out[ (int) $r->user_id ][ $r->work_date ][] = ( Dolly_I18n::t( self::TYPES[ $r->type ] ?? $r->type ) ) . ( $r->overdue ? __( ' (overdue)', 'dolly-employee-management' ) : '' );
		}
		return $out;
	}
}
