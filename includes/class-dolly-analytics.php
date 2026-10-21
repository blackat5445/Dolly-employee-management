<?php
/**
 * Attendance of all the employees on one date (Presenze › "Per giorno") and the analytics of a
 * period (Analytics page): hours, overtime, presence, absences, lateness, anomalies, requests.
 *
 * Every figure comes from the same day-by-day calculation as the monthly attendance
 * (Dolly_Reports::range_rows), so the numbers always match the Presenze page. The days of past months
 * are cached per employee and month; the cache is dropped when the data of the employee changes
 * (Dolly_Analytics::bump) and can be bypassed with "Ricalcola".
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Analytics {

	/** Longest period of the analytics, in days. */
	const MAX_DAYS = 366;

	const CACHE_TTL = 12 * HOUR_IN_SECONDS;

	/** Hours codes of the leaves taken by the hour. */
	const LEAVE_CODES = array( 'P', 'ROL', 'EO', 'Pn', 'PL' );

	/** Absence groups of the "Ripartizione delle assenze" chart: label => hours codes. */
	const ABSENCE_GROUPS = array(
		'Ferie'                  => array( 'FE' ),
		'Permessi'               => array( 'P', 'ROL', 'EO', 'Pn', 'PL' ),
		'Malattia'               => array( 'M' ),
		'Infortunio'             => array( 'I' ),
		'Donazione sangue'       => array( 'Av' ),
		'Assenze non giustificate' => array( 'A' ),
	);

	/** Day statuses that justify the whole day (the day does not count as an expected presence). */
	const FULL_DAY_OFF = array( 'ferie', 'donazione', 'malattia', 'infortunio', 'festivo', 'chiusura', 'chiusura_festiva' );

	const SHORT_MONTHS = array( 1 => 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic' );

	const SHORT_WEEKDAYS = array( 1 => 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom' );

	/* ---------- Cache ---------- */

	/**
	 * Drops the cached analytics: of one employee (schedule, punches, requests, sickness changed) or
	 * of everybody (settings, closures).
	 */
	public static function bump( $user_id = 0 ) {
		if ( $user_id ) {
			update_user_meta( (int) $user_id, 'dolly_data_rev', (string) microtime( true ) );
		} else {
			update_option( 'dolly_data_rev', (string) microtime( true ), false );
		}
	}

	private static function cache_key( $user_id, $ym ) {
		$rev = (string) get_user_meta( $user_id, 'dolly_data_rev', true ) . '|' . (string) get_option( 'dolly_data_rev', '' ) . '|' . DOLLY_VERSION;
		return 'dolly_an_' . (int) $user_id . '_' . str_replace( '-', '', $ym ) . '_' . substr( md5( $rev ), 0, 10 );
	}

	/** Compact data of a day, enough for every aggregate. */
	private static function compact( array $r ) {
		return array(
			'd'  => $r['date'],
			's'  => $r['status'],
			'in' => '' !== $r['entrata'],
			'pl' => (int) $r['planned_min'],
			'c'  => $r['hours_codes'],
			'lt' => (int) $r['late_min'],
			'op' => 'pending' === $r['extra_over_status'] ? (int) $r['extra_over_min'] : 0,
			'pv' => (bool) $r['provisional'],
		);
	}

	/**
	 * Days of an employee in the period. Whole past months are cached; the current month is always
	 * recalculated.
	 */
	private static function user_days( $user_id, $from, $to, $fresh ) {
		$out       = array();
		$cur_month = substr( Dolly_Time::today(), 0, 7 );
		$ym        = substr( $from, 0, 7 );
		while ( $ym <= substr( $to, 0, 7 ) ) {
			$first = $ym . '-01';
			$last  = $ym . '-' . sprintf( '%02d', Dolly_Time::days_in_month( (int) substr( $ym, 0, 4 ), (int) substr( $ym, 5, 2 ) ) );
			if ( $ym < $cur_month ) {
				$key  = self::cache_key( $user_id, $ym );
				$days = $fresh ? false : get_transient( $key );
				if ( ! is_array( $days ) ) {
					$days = array_map( array( __CLASS__, 'compact' ), Dolly_Reports::range_rows( $user_id, $first, $last )['rows'] );
					set_transient( $key, $days, self::CACHE_TTL );
				}
			} else {
				$days = array_map( array( __CLASS__, 'compact' ), Dolly_Reports::range_rows( $user_id, max( $from, $first ), min( $to, $last ) )['rows'] );
			}
			foreach ( $days as $day ) {
				if ( $day['d'] >= $from && $day['d'] <= $to ) {
					$out[] = $day;
				}
			}
			$ym = substr( Dolly_Time::add_days( $last, 1 ), 0, 7 );
		}
		return $out;
	}

	/* ---------- Employees ---------- */

	/** Employees of a period (as in the monthly timesheet), optionally only of one workplace. */
	public static function employees( $from, $to, $workplace_id = 0 ) {
		$ids = Dolly_Timesheet::employees( $from, $to );
		if ( $workplace_id ) {
			$ids = array_values( array_intersect( $ids, Dolly_Workplaces::user_ids_in_range( $workplace_id, $from, $to ) ) );
		}
		return $ids;
	}

	/* ---------- Presenze › Per giorno ---------- */

	/** Attendance row of every employee on a date (same columns as the monthly attendance). */
	public static function day( $date, $workplace_id = 0 ) {
		if ( ! Dolly_Time::is_date( $date ) || $date > Dolly_Time::today() ) {
			return new WP_Error( 'dolly_invalid', __( 'Scegli una data fino a oggi.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 120 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- failure handled by the caller.
		}
		$rows    = array();
		$summary = array();
		$worked  = 0;
		$extra   = 0;
		foreach ( self::employees( $date, $date, $workplace_id ) as $uid ) {
			$data = Dolly_Reports::range_rows( $uid, $date, $date );
			$r    = $data['rows'][0];
			$r['user_id']    = $uid;
			$r['employee']   = Dolly_Employees::display_name( $uid );
			$r['active']     = Dolly_Employees::is_active( $uid );
			$r['contract']   = Dolly_Timesheet::contract_label( $uid, $date );
			$r['workplaces'] = implode( ', ', wp_list_pluck( Dolly_Workplaces::for_user( $uid, $date ), 'name' ) );
			$summary[ $r['status'] ] = ( $summary[ $r['status'] ] ?? 0 ) + 1;
			$worked += (int) $r['worked_min'];
			$extra  += (int) $r['extra_min'];
			$rows[]  = $r;
		}
		return array(
			'date'         => $date,
			'date_label'   => Dolly_Time::fmt_date( $date ),
			'weekday'      => Dolly_I18n::t( Dolly_Time::WEEKDAYS[ Dolly_Time::weekday( $date ) ] ),
			'holiday'      => (string) Dolly_Holidays::name( $date ),
			'is_today'     => Dolly_Time::today() === $date,
			'rows'         => $rows,
			'summary'      => $summary,
			'total_worked' => Dolly_Time::min_to_hm( $worked ),
			'total_extra'  => Dolly_Time::min_to_hm( $extra ),
		);
	}

	/* ---------- Analytics ---------- */

	/** Groups of the time charts: by day up to two months, by week up to six months, then by month. */
	private static function buckets( $from, $days ) {
		$unit   = $days <= 62 ? 'day' : ( $days <= 190 ? 'week' : 'month' );
		$map    = array();
		$labels = array();
		$d      = $from;
		for ( $i = 0; $i < $days; $i++ ) {
			if ( 'day' === $unit ) {
				$key   = $d;
				$label = Dolly_I18n::t( self::SHORT_WEEKDAYS[ Dolly_Time::weekday( $d ) ] ) . ' ' . substr( $d, 8, 2 ) . '/' . substr( $d, 5, 2 );
			} elseif ( 'week' === $unit ) {
				$key   = Dolly_Time::add_days( $d, 1 - Dolly_Time::weekday( $d ) );
				$label = __( 'Sett. ', 'dolly-employee-management' ) . substr( $key, 8, 2 ) . '/' . substr( $key, 5, 2 );
			} else {
				$key   = substr( $d, 0, 7 );
				$label = Dolly_I18n::t( self::SHORT_MONTHS[ (int) substr( $d, 5, 2 ) ] ) . ' ' . substr( $d, 0, 4 );
			}
			$map[ $d ]      = $key;
			$labels[ $key ] = $label;
			$d              = Dolly_Time::add_days( $d, 1 );
		}
		return array( $unit, $map, $labels );
	}

	private static function sum_codes( array $codes, array $which ) {
		$min = 0;
		foreach ( $which as $c ) {
			$min += (int) ( $codes[ $c ] ?? 0 );
		}
		return $min;
	}

	private static function pct( $num, $den ) {
		return $den > 0 ? round( 100 * $num / $den, 1 ) : null;
	}

	/**
	 * Analytics of a period. $user_id limits them to one employee, $workplace_id to the employees
	 * assigned to a workplace in the period.
	 */
	public static function range( $from, $to, $workplace_id = 0, $user_id = 0, $fresh = false ) {
		$today = Dolly_Time::today();
		if ( ! Dolly_Time::is_date( $from ) || ! Dolly_Time::is_date( $to ) || $from > $to ) {
			return new WP_Error( 'dolly_invalid', __( 'Periodo non valido.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		if ( $to > $today ) {
			return new WP_Error( 'dolly_invalid', __( 'La data finale non può essere successiva a oggi.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		$days = (int) round( ( strtotime( $to . ' 12:00:00 UTC' ) - strtotime( $from . ' 12:00:00 UTC' ) ) / DAY_IN_SECONDS ) + 1;
		if ( $days > self::MAX_DAYS ) {
			return new WP_Error( 'dolly_invalid', __( 'Il periodo può durare al massimo ', 'dolly-employee-management' ) . self::MAX_DAYS . __( ' giorni.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		if ( $user_id && ! Dolly_Employees::is_employee( $user_id ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Dipendente non valido.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 300 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- failure handled by the caller.
		}

		$ids = $user_id ? array( (int) $user_id ) : self::employees( $from, $to, $workplace_id );
		list( $unit, $bucket_of, $labels ) = self::buckets( $from, $days );
		$zero   = array_fill_keys( array_keys( $labels ), 0 );
		$series = array(
			'ordinary' => $zero,
			'extra'    => $zero,
			'planned'  => $zero,
			'present'  => $zero,
			'leave'    => $zero,
			'sick'     => $zero,
			'absent'   => $zero,
		);
		$wd_zero = array_fill_keys( array_keys( self::SHORT_WEEKDAYS ), 0 );
		$weekday = array(
			'entries'  => $wd_zero,
			'late'     => $wd_zero,
			'late_min' => $wd_zero,
		);
		$late_dist = array( '1–5 min' => 0, '6–15 min' => 0, '16–30 min' => 0, 'Oltre 30 min' => 0 );
		$codes_tot = array();
		$people    = array();
		$k         = array_fill_keys( array( 'worked', 'ordinary', 'extra', 'extra_pending', 'planned', 'present_days', 'expected_days', 'present_expected', 'entries_sched', 'late', 'late_min', 'absent_days', 'leave_days', 'sick_days', 'leave_min', 'absence_min', 'provisional_days' ), 0 );

		foreach ( $ids as $uid ) {
			$p = array_fill_keys( array( 'worked', 'extra', 'extra_pending', 'planned', 'present_days', 'expected_days', 'present_expected', 'late', 'late_min', 'absent_days', 'leave_days', 'sick_days', 'leave_min' ), 0 );
			foreach ( self::user_days( $uid, $from, $to, $fresh ) as $day ) {
				$b        = $bucket_of[ $day['d'] ];
				$wd       = Dolly_Time::weekday( $day['d'] );
				$ordinary = self::sum_codes( $day['c'], Dolly_Hours::WORK_CODES );
				$extra    = (int) ( $day['c']['S'] ?? 0 );
				$expected = $day['pl'] > 0 && ! in_array( $day['s'], self::FULL_DAY_OFF, true );
				foreach ( $day['c'] as $code => $min ) {
					$codes_tot[ $code ] = ( $codes_tot[ $code ] ?? 0 ) + (int) $min;
				}
				$series['ordinary'][ $b ] += $ordinary;
				$series['extra'][ $b ]    += $extra;
				$series['planned'][ $b ]  += $day['pl'];
				$p['worked']        += $ordinary + $extra;
				$p['extra']         += $extra;
				$p['extra_pending'] += $day['op'];
				$p['planned']       += $day['pl'];
				$p['leave_min']     += self::sum_codes( $day['c'], self::LEAVE_CODES );
				$k['absence_min']   += self::sum_codes( $day['c'], array( 'M', 'I', 'A' ) );
				$k['provisional_days'] += $day['pv'] ? 1 : 0;
				if ( $day['in'] ) {
					$series['present'][ $b ]++;
					$p['present_days']++;
				} elseif ( in_array( $day['s'], array( 'ferie', 'donazione' ), true ) ) {
					$series['leave'][ $b ]++;
					$p['leave_days']++;
				} elseif ( in_array( $day['s'], array( 'malattia', 'infortunio' ), true ) ) {
					$series['sick'][ $b ]++;
					$p['sick_days']++;
				} elseif ( 'assente' === $day['s'] ) {
					$series['absent'][ $b ]++;
					$p['absent_days']++;
				}
				if ( $expected ) {
					$p['expected_days']++;
					$p['present_expected'] += $day['in'] ? 1 : 0;
				}
				// Punctuality: entries of the scheduled days (rest days and on-call shifts have no start time).
				if ( $day['in'] && $day['pl'] > 0 ) {
					$k['entries_sched']++;
					$weekday['entries'][ $wd ]++;
					if ( $day['lt'] > 0 ) {
						$p['late']++;
						$p['late_min']               += $day['lt'];
						$weekday['late'][ $wd ]++;
						$weekday['late_min'][ $wd ] += $day['lt'];
						$slot = $day['lt'] <= 5 ? '1–5 min' : ( $day['lt'] <= 15 ? '6–15 min' : ( $day['lt'] <= 30 ? '16–30 min' : 'Oltre 30 min' ) );
						$late_dist[ $slot ]++;
					}
				}
			}
			foreach ( $p as $key => $v ) {
				if ( isset( $k[ $key ] ) ) {
					$k[ $key ] += $v;
				}
			}
			$k['ordinary'] += $p['worked'] - $p['extra'];
			$people[]       = array(
				'user_id'        => $uid,
				'name'           => Dolly_Employees::display_name( $uid ),
				'sort'           => remove_accents( Dolly_Employees::sort_name( $uid ) ),
				'active'         => Dolly_Employees::is_active( $uid ),
				'contract'       => Dolly_Timesheet::contract_label( $uid, $to ),
				'worked_min'     => $p['worked'],
				'planned_min'    => $p['planned'],
				'balance_min'    => $p['worked'] - $p['planned'],
				'extra_min'      => $p['extra'],
				'extra_pending_min' => $p['extra_pending'],
				'present_days'   => $p['present_days'],
				'expected_days'  => $p['expected_days'],
				'presence_pct'   => self::pct( $p['present_expected'], $p['expected_days'] ),
				'late'           => $p['late'],
				'late_min'       => $p['late_min'],
				'absent_days'    => $p['absent_days'],
				'leave_days'     => $p['leave_days'],
				'leave_min'      => $p['leave_min'],
				'sick_days'      => $p['sick_days'],
				'anomalies'      => 0,
			);
		}

		$anomalies = self::anomalies( $ids, $from, $to );
		foreach ( $people as &$row ) {
			$row['anomalies'] = $anomalies['by_user'][ $row['user_id'] ] ?? 0;
		}
		unset( $row );
		usort( $people, function ( $a, $b ) {
			return strcasecmp( $a['sort'], $b['sort'] );
		} );

		$absences = array();
		foreach ( self::ABSENCE_GROUPS as $label => $codes ) {
			$absences[] = array( 'label' => Dolly_I18n::t( $label ), 'codes' => implode( ', ', $codes ), 'min' => self::sum_codes( $codes_tot, $codes ) );
		}
		$wd_rows = array();
		foreach ( self::SHORT_WEEKDAYS as $n => $short ) {
			$wd_rows[] = array(
				'label'    => Dolly_I18n::t( Dolly_Time::WEEKDAYS[ $n ] ),
				'short'    => Dolly_I18n::t( $short ),
				'entries'  => $weekday['entries'][ $n ],
				'late'     => $weekday['late'][ $n ],
				'late_pct' => self::pct( $weekday['late'][ $n ], $weekday['entries'][ $n ] ),
				'late_avg' => $weekday['late'][ $n ] ? (int) round( $weekday['late_min'][ $n ] / $weekday['late'][ $n ] ) : 0,
			);
		}
		$requests = self::requests( $ids, $from, $to );

		return array(
			'from'       => $from,
			'to'         => $to,
			'from_label' => Dolly_Time::fmt_date( $from ),
			'to_label'   => Dolly_Time::fmt_date( $to ),
			'days'       => $days,
			'unit'       => $unit,
			'employees_count' => count( $ids ),
			'kpi'        => array(
				'worked_min'        => $k['worked'],
				'ordinary_min'      => $k['ordinary'],
				'planned_min'       => $k['planned'],
				'worked_pct'        => self::pct( $k['worked'], $k['planned'] ),
				'extra_min'         => $k['extra'],
				'extra_pending_min' => $k['extra_pending'],
				'present_days'      => $k['present_days'],
				'expected_days'     => $k['expected_days'],
				'presence_pct'      => self::pct( $k['present_expected'], $k['expected_days'] ),
				'absenteeism_pct'   => self::pct( $k['absence_min'], $k['planned'] ),
				'absence_min'       => $k['absence_min'],
				'entries'           => $k['entries_sched'],
				'late'              => $k['late'],
				'late_min'          => $k['late_min'],
				'late_avg'          => $k['late'] ? (int) round( $k['late_min'] / $k['late'] ) : 0,
				'punctuality_pct'   => self::pct( $k['entries_sched'] - $k['late'], $k['entries_sched'] ),
				'absent_days'       => $k['absent_days'],
				'leave_days'        => $k['leave_days'],
				'leave_min'         => $k['leave_min'],
				'sick_days'         => $k['sick_days'],
				'anomalies'         => $anomalies['total'],
				'anomalies_open'    => $anomalies['open'],
				'requests'          => $requests['total'],
				'requests_pending'  => $requests['pending'],
				'response_hours'    => $requests['response_hours'],
				'provisional_days'  => $k['provisional_days'],
			),
			'series'     => array( 'labels' => array_values( $labels ) ) + array_map( 'array_values', $series ),
			'weekday'    => $wd_rows,
			'late_dist'  => array( 'labels' => array_map( array( 'Dolly_I18n', 't' ), array_keys( $late_dist ) ), 'values' => array_values( $late_dist ) ),
			'absences'   => $absences,
			'codes'      => Dolly_Hours::format_codes( $codes_tot ),
			'anomalies'  => $anomalies['by_type'],
			'requests'   => $requests['by_type'],
			'employees'  => $people,
			'generated'  => Dolly_Time::now_local()->format( 'd/m/Y H:i' ),
		);
	}

	/** Anomalies of the days of the period: totals, by type and by employee. */
	private static function anomalies( array $ids, $from, $to ) {
		global $wpdb;
		$out = array( 'total' => 0, 'open' => 0, 'by_type' => array(), 'by_user' => array() );
		if ( ! $ids ) {
			return $out;
		}
		$t    = Dolly_Install::t( 'anomalies' );
		$in   = implode( ',', array_map( 'intval', $ids ) );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT user_id, type, status, COUNT(*) AS n FROM $t WHERE user_id IN ($in) AND work_date BETWEEN %s AND %s GROUP BY user_id, type, status", $from, $to ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		$types = array();
		foreach ( $rows as $r ) {
			$n = (int) $r->n;
			$out['total'] += $n;
			$out['by_user'][ (int) $r->user_id ] = ( $out['by_user'][ (int) $r->user_id ] ?? 0 ) + $n;
			if ( ! isset( $types[ $r->type ] ) ) {
				$types[ $r->type ] = array( 'type' => $r->type, 'label' => Dolly_I18n::t( Dolly_Anomalies::TYPES[ $r->type ] ?? $r->type ), 'open' => 0, 'resolved' => 0 );
			}
			if ( 'open' === $r->status ) {
				$types[ $r->type ]['open'] += $n;
				$out['open']               += $n;
			} else {
				$types[ $r->type ]['resolved'] += $n;
			}
		}
		$out['by_type'] = array_values( $types );
		return $out;
	}

	/** Requests covering the period, by type and status, and the average response time. */
	private static function requests( array $ids, $from, $to ) {
		global $wpdb;
		$out = array( 'total' => 0, 'pending' => 0, 'response_hours' => null, 'by_type' => array() );
		if ( ! $ids ) {
			return $out;
		}
		$t    = Dolly_Install::t( 'requests' );
		$in   = implode( ',', array_map( 'intval', $ids ) );
		$eff  = Dolly_Requests::EFFECTIVE_ROW;
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT type, status, COUNT(*) AS n FROM $t WHERE user_id IN ($in) AND $eff AND status <> 'superseded' AND start_date <= %s AND end_date >= %s GROUP BY type, status", $to, $from ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		$types = array();
		foreach ( $rows as $r ) {
			$n = (int) $r->n;
			if ( ! isset( $types[ $r->type ] ) ) {
				$types[ $r->type ] = array( 'type' => $r->type, 'label' => Dolly_I18n::t( Dolly_Requests::TYPES[ $r->type ] ?? $r->type ), 'pending' => 0, 'approved' => 0, 'rejected' => 0, 'cancelled' => 0 );
			}
			if ( isset( $types[ $r->type ][ $r->status ] ) ) {
				$types[ $r->type ][ $r->status ] += $n;
			}
			$out['total']   += $n;
			$out['pending'] += 'pending' === $r->status ? $n : 0;
		}
		$out['by_type'] = array_values( $types );
		$avg            = $wpdb->get_var( $wpdb->prepare( "SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, decided_at)) FROM $t WHERE user_id IN ($in) AND $eff AND decided_at IS NOT NULL AND decided_by IS NOT NULL AND decided_by > 0 AND start_date <= %s AND end_date >= %s", $to, $from ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		$out['response_hours'] = null === $avg ? null : round( (float) $avg / 60, 1 );
		return $out;
	}
}
