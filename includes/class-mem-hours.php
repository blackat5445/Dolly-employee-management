<?php
/**
 * Hours history: for every employee and day, the minutes of work and of absence with their
 * justification code, stored in the table "hours" (one row per employee, day and code).
 *
 * Example: 8-hour day with 2 hours of approved leave → O 6:00 + P 2:00.
 * Labels of the worked hours: O = ordinary, FER = ordinary hours worked on a Saturday, S = overtime;
 * FS = public holiday (the planned hours of a holiday that is not worked).
 *
 * The rows are derived from schedule, punches, approved requests, sickness, holidays and closures
 * (MEM_Reports::month_rows) and are rewritten whenever one of them changes: immediately when the
 * administrator opens or exports a month, otherwise by the scheduler (changed months first, then
 * all employees in rotation).
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class MEM_Hours {

	const CODES = array(
		'O'   => 'Ordinario',
		'FER' => 'Sabato',
		'S'   => 'Straordinario',
		'FS'  => 'Festivo',
		'FE'  => 'Ferie',
		'P'   => 'Permesso',
		'ROL' => 'Permesso retribuito per riduzione dell\'orario di lavoro',
		'EO'  => 'Ex festività',
		'Pn'  => 'Permesso non retribuito',
		'PL'  => 'Permesso Legge 104',
		'M'   => 'Malattia',
		'I'   => 'Infortunio',
		'Av'  => 'Donazione sangue',
		'A'   => 'Assenza non retribuita',
	);

	/** Codes used until version 1.6 and their current names (stored rows are renamed on upgrade). */
	const RENAMED = array(
		'L'  => 'O',
		'ST' => 'S',
		'Fs' => 'FS',
	);

	/** Codes of the worked hours counted as "ore lavoro effettive" in the attendance sheet. */
	const WORK_CODES = array( 'O', 'FER' );

	const DIRTY_OPTION  = 'mem_hours_dirty';
	const CURSOR_OPTION = 'mem_hours_cursor';

	/** Working intervals of a regular scheduled day, in minutes from midnight. */
	private static function planned_intervals( array $plan ) {
		if ( empty( $plan['scheduled'] ) || ! $plan['start'] || ! $plan['end'] ) {
			return array();
		}
		$s = MEM_Time::hm_to_min( $plan['start'] );
		$e = MEM_Time::hm_to_min( $plan['end'] );
		if ( ! empty( $plan['has_lunch'] ) && $plan['lunch_start'] && $plan['lunch_end'] ) {
			return array(
				array( $s, MEM_Time::hm_to_min( $plan['lunch_start'] ) ),
				array( MEM_Time::hm_to_min( $plan['lunch_end'] ), $e ),
			);
		}
		return array( array( $s, $e ) );
	}

	/** Minutes the employee is expected to work on the day (0 on rest days and for on-call contracts). */
	public static function planned_minutes( array $plan ) {
		$min = 0;
		foreach ( self::planned_intervals( $plan ) as $iv ) {
			$min += max( 0, $iv[1] - $iv[0] );
		}
		return $min;
	}

	/**
	 * Minutes of one day by justification code.
	 *
	 * @param array $plan MEM_Schedules::day_plan()
	 * @param array $calc MEM_Attendance::compute()
	 * @param array $ctx  { today, leave: approved full-day request|null, hourly: approved hourly leaves,
	 *                      sickness: row|null, has_punches: bool, oncall: ''|pending|approved|rejected, since: Y-m-d }
	 * @return array<string,int> code => minutes
	 */
	public static function day_codes( $date, array $plan, array $calc, array $ctx ) {
		$out     = array();
		$planned = self::planned_minutes( $plan );
		// On-call shifts count once approved.
		$counted  = '' === $ctx['oncall'] || 'approved' === $ctx['oncall'];
		$worked   = $counted ? (int) $calc['worked'] : 0;
		// Overtime beyond the approved limit is not counted until the administrator approves it.
		$over     = min( $worked, (int) ( $calc['extra_over'] ?? 0 ) );
		$extra    = min( $worked - $over, (int) $calc['extra'] );
		$ordinary = $worked - $over - $extra;
		if ( $ordinary > 0 ) {
			// Ordinary hours worked on a Saturday have their own label.
			$out[ 6 === MEM_Time::weekday( $date ) ? 'FER' : 'O' ] = $ordinary;
		}
		if ( $extra > 0 ) {
			$out['S'] = $extra;
		}
		$rem = max( 0, $planned - $ordinary );
		if ( ! $rem ) {
			return $out;
		}
		// Whole remaining day justified by one reason, in order of precedence.
		if ( ! empty( $ctx['sickness'] ) ) {
			$out[ 'infortunio' === MEM_Sickness::kind_of( $ctx['sickness'] ) ? 'I' : 'M' ] = $rem;
			return $out;
		}
		if ( ! empty( $plan['holiday'] ) || 'holiday' === $plan['closure_type'] ) {
			$out['FS'] = $rem;
			return $out;
		}
		if ( ! empty( $ctx['leave'] ) ) {
			$out[ MEM_Donations::TYPE === $ctx['leave']->type ? 'Av' : 'FE' ] = $rem;
			return $out;
		}
		if ( 'collective' === $plan['closure_type'] ) {
			$out['FE'] = $rem; // Collective closure: collective vacation for who does not work.
			return $out;
		}
		// Hourly leaves: the part overlapping the working hours, each with its own code.
		$intervals = self::planned_intervals( $plan );
		foreach ( (array) $ctx['hourly'] as $l ) {
			if ( ! $l->start_time || ! $l->end_time || $rem <= 0 ) {
				continue;
			}
			$ls  = MEM_Time::hm_to_min( MEM_Time::hm( $l->start_time ) );
			$le  = MEM_Time::hm_to_min( MEM_Time::hm( $l->end_time ) );
			$min = 0;
			foreach ( $intervals as $iv ) {
				$min += max( 0, min( $iv[1], $le ) - max( $iv[0], $ls ) );
			}
			$min = min( $min, $rem );
			if ( $min > 0 ) {
				$code         = MEM_Requests::leave_code_of( $l );
				$out[ $code ] = ( $out[ $code ] ?? 0 ) + $min;
				$rem         -= $min;
			}
		}
		// A past working day without any punch and without justification: unpaid absence.
		if ( $rem > 0 && empty( $ctx['has_punches'] ) && $date < $ctx['today'] && ( empty( $ctx['since'] ) || $date >= $ctx['since'] ) ) {
			$out['A'] = $rem;
		}
		return $out;
	}

	/** First day from which unjustified absences are recorded for a user. */
	public static function absence_since( $user_id ) {
		$since = (string) get_option( 'mem_absence_since', '' );
		$u     = get_userdata( $user_id );
		if ( $u ) {
			$reg   = MEM_Time::utc_to_local( $u->user_registered, 'Y-m-d' );
			$since = $since > $reg ? $since : $reg;
		}
		return $since;
	}

	/** [code => minutes] → list for the REST output, in the order of CODES. */
	public static function format_codes( array $codes ) {
		$out = array();
		foreach ( self::CODES as $code => $label ) {
			if ( ! empty( $codes[ $code ] ) ) {
				$out[] = array(
					'code'    => $code,
					'label'   => $label,
					'minutes' => (int) $codes[ $code ],
					'hm'      => MEM_Time::min_to_hm( (int) $codes[ $code ] ),
				);
			}
		}
		return $out;
	}

	/** Compact text for CSV cells: "O 6:00; P 2:00". */
	public static function codes_text( array $codes ) {
		return implode( '; ', array_map( function ( $c ) {
			return $c['code'] . ' ' . $c['hm'];
		}, self::format_codes( $codes ) ) );
	}

	/* ---------- Storage ---------- */

	/**
	 * Upgrade from 1.6: stored rows take the current labels. The Saturday label (FER) is applied when a
	 * month is recalculated (opening or exporting it, or by the scheduler for the current month).
	 */
	public static function rename_old_codes() {
		global $wpdb;
		$t = MEM_Install::t( 'hours' );
		foreach ( self::RENAMED as $old => $new ) {
			// BINARY: the comparison must be case-sensitive ("Fs" and "FS" are equal for the default collation).
			// IGNORE: a day that already has the new code keeps it; the old row is then removed.
			$wpdb->query( $wpdb->prepare( "UPDATE IGNORE $t SET code = %s WHERE BINARY code = %s", $new, $old ) ); // phpcs:ignore
			$wpdb->query( $wpdb->prepare( "DELETE FROM $t WHERE BINARY code = %s", $old ) ); // phpcs:ignore
		}
	}

	/**
	 * Recalculates one month of an employee, writes it to the hours table and returns the month data
	 * (MEM_Reports::month_rows).
	 */
	public static function sync_month( $user_id, $year, $month ) {
		global $wpdb;
		$data  = MEM_Reports::month_rows( $user_id, $year, $month );
		$t     = MEM_Install::t( 'hours' );
		$dates = MEM_Time::month_dates( $year, $month );
		$now   = MEM_Time::now_utc();
		$vals  = array();
		$args  = array();
		foreach ( $data['rows'] as $r ) {
			foreach ( $r['hours_codes'] as $code => $min ) {
				$vals[] = '(%d, %s, %s, %d, %d, %d, %s)';
				array_push( $args, (int) $user_id, $r['date'], $code, (int) $min, (int) $r['planned_min'], $r['provisional'] ? 1 : 0, $now );
			}
		}
		// One transaction: a reader (export) never sees the month half-written.
		$wpdb->query( 'START TRANSACTION' );
		$wpdb->query( $wpdb->prepare( "DELETE FROM $t WHERE user_id = %d AND work_date BETWEEN %s AND %s", $user_id, $dates[0], end( $dates ) ) ); // phpcs:ignore
		if ( $vals ) {
			$wpdb->query( $wpdb->prepare( "INSERT INTO $t (user_id, work_date, code, minutes, planned_minutes, provisional, updated_at) VALUES " . implode( ',', $vals ) . ' ON DUPLICATE KEY UPDATE minutes = VALUES(minutes), planned_minutes = VALUES(planned_minutes), provisional = VALUES(provisional), updated_at = VALUES(updated_at)', $args ) ); // phpcs:ignore
		}
		$wpdb->query( 'COMMIT' );
		return $data;
	}

	/** Marks the months of a date range as changed: the scheduler rewrites them within a minute. */
	public static function touch( $user_id, $from, $to = null ) {
		if ( ! $user_id || ! MEM_Time::is_date( $from ) ) {
			return;
		}
		$to    = $to && MEM_Time::is_date( $to ) && $to >= $from ? $to : $from;
		MEM_Analytics::bump( $user_id );
		$dirty = get_option( self::DIRTY_OPTION, array() );
		$dirty = is_array( $dirty ) ? $dirty : array();
		$ym    = substr( $from, 0, 7 );
		$last  = substr( $to, 0, 7 );
		for ( $i = 0; $i < 13 && $ym <= $last; $i++ ) {
			$dirty[ (int) $user_id . '|' . $ym ] = 1;
			$ym                                  = substr( MEM_Time::add_days( $ym . '-28', 5 ), 0, 7 );
		}
		update_option( self::DIRTY_OPTION, $dirty, false );
	}

	/**
	 * Scheduled: rewrites the changed months first, then the current month of a few employees in
	 * rotation (and the previous month during the first week), so the history stays complete.
	 */
	public static function process( $limit = 4 ) {
		$dirty = get_option( self::DIRTY_OPTION, array() );
		$dirty = is_array( $dirty ) ? $dirty : array();
		$done  = 0;
		$keys  = array_slice( array_keys( $dirty ), 0, $limit );
		foreach ( $keys as $key ) {
			list( $uid, $ym ) = array_pad( explode( '|', $key ), 2, '' );
			if ( (int) $uid && preg_match( '/^\d{4}-\d{2}$/', $ym ) && MEM_Employees::is_employee( (int) $uid ) ) {
				self::sync_month( (int) $uid, (int) substr( $ym, 0, 4 ), (int) substr( $ym, 5, 2 ) );
				$done++;
			}
		}
		if ( $keys ) {
			// Re-read: entries added while this run was working are kept.
			$fresh = get_option( self::DIRTY_OPTION, array() );
			$fresh = is_array( $fresh ) ? $fresh : array();
			update_option( self::DIRTY_OPTION, array_diff_key( $fresh, array_flip( $keys ) ), false );
		}

		$users = MEM_Employees::active_ids();
		if ( ! $users ) {
			return $done;
		}
		sort( $users );
		$cursor = (int) get_option( self::CURSOR_OPTION, 0 );
		$next   = array_values( array_filter( $users, function ( $id ) use ( $cursor ) {
			return $id > $cursor;
		} ) );
		if ( ! $next ) {
			$next = $users;
		}
		$today = MEM_Time::today();
		$y     = (int) substr( $today, 0, 4 );
		$m     = (int) substr( $today, 5, 2 );
		foreach ( array_slice( $next, 0, 2 ) as $uid ) {
			self::sync_month( $uid, $y, $m );
			if ( (int) substr( $today, 8, 2 ) <= 7 ) {
				$prev = MEM_Time::add_days( substr( $today, 0, 8 ) . '01', -1 );
				self::sync_month( $uid, (int) substr( $prev, 0, 4 ), (int) substr( $prev, 5, 2 ) );
			}
			update_option( self::CURSOR_OPTION, $uid, false );
			$done++;
		}
		return $done;
	}

	/* ---------- Reading ---------- */

	/** Stored totals of a period: [user_id => [code => minutes]]. */
	public static function totals( array $user_ids, $from, $to ) {
		global $wpdb;
		$out = array();
		if ( ! $user_ids ) {
			return $out;
		}
		$t    = MEM_Install::t( 'hours' );
		$in   = implode( ',', array_map( 'intval', $user_ids ) );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT user_id, code, SUM(minutes) AS minutes FROM $t WHERE user_id IN ($in) AND work_date BETWEEN %s AND %s GROUP BY user_id, code", $from, $to ) ); // phpcs:ignore
		foreach ( $rows as $r ) {
			$out[ (int) $r->user_id ][ $r->code ] = (int) $r->minutes;
		}
		return $out;
	}

	/**
	 * Monthly summary for payroll: one line per employee with the hours of every code.
	 * The month is recalculated for each employee before reading it from the hours table.
	 */
	public static function summary_csv( array $user_ids, $year, $month ) {
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 300 ); // phpcs:ignore
		}
		$user_ids = array_values( array_filter( array_map( 'intval', $user_ids ), array( 'MEM_Employees', 'is_employee' ) ) );
		$planned  = array();
		foreach ( $user_ids as $uid ) {
			$data            = self::sync_month( $uid, $year, $month );
			$planned[ $uid ] = array_sum( wp_list_pluck( $data['rows'], 'planned_min' ) );
		}
		$dates  = MEM_Time::month_dates( $year, $month );
		$totals = self::totals( $user_ids, $dates[0], end( $dates ) );
		$names  = array();
		foreach ( $user_ids as $uid ) {
			$names[ $uid ] = MEM_Employees::sort_name( $uid );
		}
		asort( $names, SORT_FLAG_CASE | SORT_STRING );
		$head = array( 'Dipendente', 'Mese', 'Ore previste' );
		foreach ( self::CODES as $code => $label ) {
			$head[] = $code . ' - ' . $label;
		}
		$rows = array();
		foreach ( $names as $uid => $name ) {
			$row = array( $name, MEM_Time::MONTHS[ (int) $month ] . ' ' . (int) $year, MEM_Time::min_to_hm( $planned[ $uid ] ) );
			foreach ( self::CODES as $code => $label ) {
				$min   = $totals[ $uid ][ $code ] ?? 0;
				$row[] = $min ? MEM_Time::min_to_hm( $min ) : '';
			}
			$rows[] = $row;
		}
		return MEM_Reports::csv_string( $head, $rows );
	}
}
