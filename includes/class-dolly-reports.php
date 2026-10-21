<?php
/**
 * Monthly attendance, dashboard metrics, calendars, chart data and CSV/ZIP exports.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Reports {

	/* ---------- Batch helpers (avoid per-day queries for 100 employees × 90 days) ---------- */

	/** All schedules of the given users: [user_id] => rows sorted by valid_from DESC. */
	private static function schedules_by_user( array $user_ids ) {
		global $wpdb;
		$out = array();
		if ( ! $user_ids ) {
			return $out;
		}
		$t    = Dolly_Install::t( 'schedules' );
		$in   = implode( ',', array_map( 'intval', $user_ids ) );
		$rows = $wpdb->get_results( "SELECT * FROM $t WHERE user_id IN ($in) AND (valid_to IS NULL OR valid_to >= valid_from) ORDER BY valid_from DESC, id DESC" ); // phpcs:ignore
		foreach ( $rows as $r ) {
			$out[ (int) $r->user_id ][] = $r;
		}
		return $out;
	}

	private static function schedule_on( $rows, $date ) {
		foreach ( (array) $rows as $r ) {
			if ( $r->valid_from <= $date && ( null === $r->valid_to || $r->valid_to >= $date ) ) {
				return $r;
			}
		}
		return null;
	}

	/**
	 * Lightweight day info for many users: [uid][date] => [scheduled, rest_extra, start, leave, hourly, sick].
	 */
	private static function day_matrix( array $user_ids, $from, $to ) {
		$sched = self::schedules_by_user( $user_ids );
		$reqs  = Dolly_Requests::approved_range( $user_ids, $from, $to );
		$sick  = Dolly_Sickness::range( $user_ids, $from, $to );
		$hol   = Dolly_Holidays::between( $from, $to );
		$out   = array();
		$dates = array();
		for ( $d = $from; $d <= $to; $d = Dolly_Time::add_days( $d, 1 ) ) {
			$dates[] = $d;
		}
		$closures = Dolly_Closures::between( $from, $to );
		foreach ( $user_ids as $uid ) {
			foreach ( $dates as $d ) {
				$s  = self::schedule_on( $sched[ $uid ] ?? array(), $d );
				$wd = Dolly_Time::weekday( $d );
				$sc = $s && ! Dolly_Schedules::is_on_call( $s ) && in_array( $wd, Dolly_Schedules::weekdays( $s ), true );
				$out[ $uid ][ $d ] = array(
					'scheduled'  => $sc,
					'rest_extra' => false,
					'start'      => $sc ? Dolly_Schedules::times_for( $s, $wd )['start'] : null,
					// Closure type covering the employee ("collective" / "holiday"), or false.
					'closure'    => isset( $closures[ $d ] ) && Dolly_Closures::covers( Dolly_Workplaces::ids_for_user( $uid, $d ), $closures[ $d ]['workplaces'] ) ? $closures[ $d ]['type'] : false,
					'leave'      => false,
					'hourly'     => array(),
					'sick'       => false,
					'sick_kind'  => null,
					'holiday'    => $hol[ $d ] ?? null,
				);
			}
		}
		foreach ( $reqs as $r ) {
			$uid = (int) $r->user_id;
			foreach ( $dates as $d ) {
				if ( $d < $r->start_date || $d > $r->end_date || ! isset( $out[ $uid ][ $d ] ) ) {
					continue;
				}
				if ( in_array( $r->type, Dolly_Requests::FULL_DAY_TYPES, true ) ) {
					$out[ $uid ][ $d ]['leave'] = $r->type;
				} elseif ( 'permesso' === $r->type ) {
					$out[ $uid ][ $d ]['hourly'][] = $r;
				} elseif ( 'straordinario' === $r->type && 'rest_day' === $r->extra_kind && ! $out[ $uid ][ $d ]['scheduled'] ) {
					$out[ $uid ][ $d ]['rest_extra'] = true;
					$out[ $uid ][ $d ]['start']      = Dolly_Time::hm( $r->start_time );
				}
			}
		}
		foreach ( $sick as $s ) {
			$uid = (int) $s->user_id;
			foreach ( $dates as $d ) {
				if ( $d >= $s->start_date && $d <= $s->end_date && isset( $out[ $uid ][ $d ] ) ) {
					$out[ $uid ][ $d ]['sick']      = true;
					$out[ $uid ][ $d ]['sick_kind'] = Dolly_Sickness::kind_of( $s );
				}
			}
		}
		return $out;
	}

	/* ---------- Monthly attendance ---------- */

	public static function month_rows( $user_id, $year, $month ) {
		$dates = Dolly_Time::month_dates( $year, $month );
		$data  = self::range_rows( $user_id, $dates[0], end( $dates ) );
		return array(
			'year'        => (int) $year,
			'month'       => (int) $month,
			'month_label' => Dolly_Time::MONTHS[ (int) $month ] . ' ' . (int) $year,
		) + $data;
	}

	/**
	 * Attendance of an employee day by day for any period (a month, a single day for the "per
	 * giorno" view, a range for the analytics), with the period totals.
	 */
	public static function range_rows( $user_id, $from, $to ) {
		$dates = array();
		for ( $d = $from; $d <= $to; $d = Dolly_Time::add_days( $d, 1 ) ) {
			$dates[] = $d;
		}
		$today    = Dolly_Time::today();
		$punches  = Dolly_Attendance::punches_range( array( $user_id ), $from, $to );
		$punches  = $punches[ $user_id ] ?? array();
		$reqs     = Dolly_Requests::approved_range( array( $user_id ), $from, $to );
		$pending  = Dolly_Requests::query( array( 'user_id' => $user_id, 'status' => 'pending', 'per_page' => 100 ) )['items'];
		$sick     = Dolly_Sickness::range( array( $user_id ), $from, $to );
		$anoms    = Dolly_Anomalies::open_range( array( $user_id ), $from, $to );
		$anoms    = $anoms[ $user_id ] ?? array();
		$rows     = array();
		$tot_w    = 0;
		$tot_x    = 0;
		$tot_o    = 0;
		$tot_p    = 0;
		$tot_f    = 0;
		$increase = (int) Dolly_Settings::get( 'holiday_increase' );
		$prov_any = false;
		$oncall_rows = Dolly_Requests::oncall_range( $user_id, $from, $to );
		$since       = Dolly_Hours::absence_since( $user_id );
		$tot_codes   = array();
		$tot_planned = 0;

		foreach ( $dates as $d ) {
			$plan    = Dolly_Schedules::day_plan( $user_id, $d );
			$p       = $punches[ $d ] ?? array();
			$leave   = null;
			$hourly  = array();
			$extra   = null;
			foreach ( $reqs as $r ) {
				if ( $d < $r->start_date || $d > $r->end_date ) {
					continue;
				}
				if ( in_array( $r->type, Dolly_Requests::FULL_DAY_TYPES, true ) ) {
					$leave = $r;
				} elseif ( 'permesso' === $r->type ) {
					$hourly[] = $r;
				} elseif ( 'straordinario' === $r->type ) {
					$extra = $r;
				}
			}
			$sickness = null;
			foreach ( $sick as $s ) {
				if ( $d >= $s->start_date && $d <= $s->end_date ) {
					$sickness = $s;
				}
			}
			$calc        = Dolly_Attendance::compute( $d, $p, $plan, $hourly );
			$day_anoms   = $anoms[ $d ] ?? array();
			// On-call contract: the hours of a shift count once approved (automatically or by the administrator).
			$oncall      = ( $plan['on_call'] && isset( $p['uscita'] ) ) ? ( isset( $oncall_rows[ $d ] ) ? $oncall_rows[ $d ]->status : 'pending' ) : '';
			$provisional = ( isset( $p['entrata'] ) && ! isset( $p['uscita'] ) ) || ! empty( $day_anoms ) || 'pending' === $oncall;
			$tot_w      += ( '' === $oncall || 'approved' === $oncall ) ? $calc['worked'] : 0;
			$tot_p      += 'pending' === $oncall ? $calc['worked'] : 0;
			$tot_x      += $calc['extra'];
			$tot_o      += $calc['extra_over'];
			$tot_f      += ( '' === $oncall || 'approved' === $oncall ) ? $calc['festive'] : 0;
			$prov_any    = $prov_any || $provisional;
			// Hours of the day by justification code (work, vacation, leave, sickness...).
			$codes = Dolly_Hours::day_codes(
				$d,
				$plan,
				$calc,
				array(
					'today'       => $today,
					'leave'       => $leave,
					'hourly'      => $hourly,
					'sickness'    => $sickness,
					'has_punches' => ! empty( $p ),
					'oncall'      => $oncall,
					'since'       => $since,
				)
			);
			foreach ( $codes as $code => $min ) {
				$tot_codes[ $code ] = ( $tot_codes[ $code ] ?? 0 ) + $min;
			}
			$tot_planned += Dolly_Hours::planned_minutes( $plan );

			if ( $sickness ) {
				$status = Dolly_Sickness::kind_of( $sickness );
			} elseif ( $leave ) {
				$status = $leave->type;
			} elseif ( isset( $p['uscita'] ) ) {
				$status = 'completo';
			} elseif ( isset( $p['entrata'] ) ) {
				$status = $d === $today ? 'in_corso' : 'incompleto';
			} elseif ( $plan['closure'] ) {
				$status = 'holiday' === $plan['closure_type'] ? 'chiusura_festiva' : 'chiusura';
			} elseif ( $plan['holiday'] ) {
				$status = 'festivo';
			} elseif ( $plan['on_call'] ) {
				$status = 'nessun_turno';
			} elseif ( $d > $today ) {
				$status = $plan['eligible'] ? 'previsto' : 'riposo';
			} elseif ( $plan['eligible'] ) {
				$status = ( $d === $today && Dolly_Time::hm_to_min( Dolly_Time::now_hm() ) < Dolly_Time::hm_to_min( $plan['start'] ) ) ? 'previsto' : 'assente';
			} else {
				$status = 'riposo';
			}

			$sched_label = '';
			if ( $plan['on_call'] ) {
				$sched_label = 'A chiamata';
			} elseif ( $plan['eligible'] ) {
				$sched_label = $plan['start'] . '–' . $plan['end'];
				if ( $plan['has_lunch'] ) {
					$sched_label .= ' (pausa ' . $plan['lunch_start'] . '–' . $plan['lunch_end'] . ( $plan['lunch_auto'] ? ', automatica' : '' ) . ')';
				}
			}
			$pending_labels = array();
			$extra_pending  = false;
			foreach ( $pending as $q ) {
				if ( $d >= $q['start_date'] && $d <= $q['end_date'] ) {
					$pending_labels[] = $q['summary'];
					$extra_pending    = $extra_pending || 'straordinario' === $q['type'];
				}
			}

			// Recorded times are shown as counted (tolerance / rounding); the real punch is kept alongside.
			$real = function ( $a ) use ( $p ) {
				return isset( $p[ $a ] ) ? Dolly_Time::utc_to_local( $p[ $a ]->punched_at, 'H:i' ) : '';
			};
			$in_counted  = isset( $p['entrata'] ) ? Dolly_Time::ts_to_hm( $calc['entrata'] ) : '';
			$out_counted = isset( $p['uscita'] ) ? Dolly_Time::ts_to_hm( $calc['uscita'] ) : '';
			if ( $extra ) {
				$extra_label = 'rest_day' === $extra->extra_kind ? Dolly_Time::hm( $extra->start_time ) . '–' . Dolly_Time::hm( $extra->end_time ) : 'approvato fino alle ' . Dolly_Time::hm( $extra->end_time );
			} else {
				$extra_label = $calc['extra_auto'] ? 'automatico' : '';
			}
			$day_type = $plan['on_call'] ? 'A chiamata' : ( $plan['scheduled'] ? 'Lavorativo' : ( $plan['rest_day_extra'] ? 'Riposo con straordinario' : 'Riposo' ) );

			$rows[] = array(
				'date'        => $d,
				'date_label'  => Dolly_Time::fmt_date( $d ),
				'weekday'     => Dolly_Time::WEEKDAYS[ Dolly_Time::weekday( $d ) ],
				'day_type'    => $day_type . ( $plan['holiday'] ? ' · Festivo (' . $plan['holiday'] . ')' : '' ) . ( $plan['closure'] ? ' · ' . $plan['closure'] : '' ),
				'holiday'     => (string) $plan['holiday'],
				'closure'     => (string) $plan['closure'],
				'closure_type'=> (string) $plan['closure_type'],
				'closure_label' => $plan['closure_type'] ? Dolly_Closures::type_label( $plan['closure_type'] ) : '',
				// How the hours worked on the day count: ordinary (collective closure) or with holiday increase.
				'festive_min' => $calc['festive'],
				'festive'     => $calc['festive'] ? Dolly_Time::min_to_hm( $calc['festive'] ) : '',
				'holiday_increase' => $increase,
				'hours_note'  => $calc['worked'] ? ( $calc['festive'] ? 'Ore festive, maggiorazione ' . $increase . '%' : ( 'collective' === $plan['closure_type'] ? 'Ore ordinarie (chiusura collettiva)' : '' ) ) : '',
				'oncall_status' => $oncall,
				'schedule'    => $sched_label,
				'entrata'     => $in_counted,
				'entrata_real'=> $real( 'entrata' ) !== $in_counted ? $real( 'entrata' ) : '',
				'inizio_pausa'=> $real( 'inizio_pausa' ),
				'fine_pausa'  => $real( 'fine_pausa' ),
				'uscita'      => $out_counted,
				'uscita_real' => $real( 'uscita' ) !== $out_counted ? $real( 'uscita' ) : '',
				'late_min'    => $calc['late'],
				'lunch_auto'  => $calc['lunch_deducted'] > 0,
				'corrected'   => (bool) array_filter( $p, function ( $x ) {
					return 'admin' === $x->source;
				} ),
				'ferie'       => $leave && 'ferie' === $leave->type,
				'donazione'   => $leave && Dolly_Donations::TYPE === $leave->type,
				'permesso'    => implode( ', ', array_map( function ( $h ) {
					return Dolly_Time::hm( $h->start_time ) . '–' . Dolly_Time::hm( $h->end_time );
				}, $hourly ) ),
				'malattia'    => (bool) $sickness,
				'sick_label'  => $sickness ? Dolly_Sickness::kind_label( Dolly_Sickness::kind_of( $sickness ) ) : '',
				'certificate' => $sickness ? ( Dolly_Sickness::CERT_STATUSES[ $sickness->certificate_status ] ?? '' ) : '',
				'certificate_status' => $sickness ? $sickness->certificate_status : '',
				'worked_min'  => $calc['worked'],
				'worked'      => $calc['worked'] ? Dolly_Time::min_to_hm( $calc['worked'] ) : '',
				'extra_label' => $extra_label,
				'extra_min'   => $calc['extra'],
				'extra'       => $calc['extra'] ? Dolly_Time::min_to_hm( $calc['extra'] ) : '',
				'extra_over'  => $calc['extra_over'] ? Dolly_Time::min_to_hm( $calc['extra_over'] ) : '',
				'extra_over_min' => (int) $calc['extra_over'],
				'extra_over_status' => $calc['extra_over'] ? ( $extra_pending ? 'pending' : 'not_approved' ) : '',
				'anomalies'   => $day_anoms,
				'pending'     => $pending_labels,
				'provisional' => $provisional,
				'status'      => $status,
				'planned_min' => Dolly_Hours::planned_minutes( $plan ),
				'hours_codes' => $codes,
				'hours'       => Dolly_Hours::format_codes( $codes ),
			);
		}
		return array(
			'rows'        => $rows,
			'total'       => Dolly_Time::min_to_hm( $tot_w ),
			'total_extra' => Dolly_Time::min_to_hm( $tot_x ),
			'total_over'  => Dolly_Time::min_to_hm( $tot_o ),
			'total_oncall_pending' => $tot_p ? Dolly_Time::min_to_hm( $tot_p ) : '',
			'total_festive'        => $tot_f ? Dolly_Time::min_to_hm( $tot_f ) : '',
			'holiday_increase'     => $increase,
			'provisional' => $prov_any,
			'planned_total' => Dolly_Time::min_to_hm( $tot_planned ),
			'hours_totals'  => Dolly_Hours::format_codes( $tot_codes ),
		);
	}

	/* ---------- Administrator dashboard ---------- */

	public static function dashboard( $workplace_id, $pages ) {
		$today  = Dolly_Time::today();
		$now    = Dolly_Time::hm_to_min( Dolly_Time::now_hm() );
		$users  = Dolly_Employees::active_ids( $workplace_id, $today );
		$all    = $workplace_id ? Dolly_Employees::active_ids() : $users;
		$punch  = Dolly_Attendance::punches_range( $all, $today, $today );
		$matrix = self::day_matrix( $users, $today, $today );

		$present = array();
		foreach ( $all as $uid ) {
			$p = $punch[ $uid ][ $today ] ?? array();
			if ( ! isset( $p['entrata'] ) || isset( $p['uscita'] ) ) {
				continue;
			}
			if ( isset( $p['inizio_pausa'] ) && ! isset( $p['fine_pausa'] ) ) {
				continue; // On lunch: excluded from "present now".
			}
			if ( $workplace_id && (int) $p['entrata']->workplace_id !== (int) $workplace_id ) {
				continue;
			}
			$present[ $uid ] = true; // Keyed by user: deduplicated across workplaces.
		}

		$absent = array( 'total' => 0, 'ferie' => 0, 'malattia' => 0, 'permesso' => 0, 'ingiustificati' => 0 );
		$rows   = array();
		foreach ( $users as $uid ) {
			$m = $matrix[ $uid ][ $today ];
			$p = $punch[ $uid ][ $today ] ?? array();
			if ( ! $m['scheduled'] && ! $m['rest_extra'] && ! $p ) {
				continue; // Rest day: excluded from absence counts and from the table.
			}
			$started = $m['start'] && $now >= Dolly_Time::hm_to_min( $m['start'] );
			if ( isset( $p['uscita'] ) ) {
				$st = array( 'uscito', 'Uscito' );
			} elseif ( isset( $p['inizio_pausa'] ) && ! isset( $p['fine_pausa'] ) ) {
				$st = array( 'pausa', 'In pausa' );
			} elseif ( isset( $p['entrata'] ) ) {
				$st = array( 'presente', 'In servizio' );
			} elseif ( $m['sick'] ) {
				$st = array( $m['sick_kind'], Dolly_Sickness::kind_label( $m['sick_kind'] ) );
			} elseif ( $m['leave'] ) {
				$st = Dolly_Donations::TYPE === $m['leave'] ? array( 'donazione', 'Donazione sangue' ) : array( 'ferie', 'Ferie' );
			} elseif ( $m['closure'] ) {
				$st = array( 'holiday' === $m['closure'] ? 'chiusura_festiva' : 'chiusura', Dolly_Closures::type_label( $m['closure'] ) );
			} elseif ( $m['holiday'] ) {
				$st = array( 'festivo', 'Festivo' );
			} elseif ( ! $started ) {
				$st = array( 'atteso', 'Non ancora iniziato' );
			} else {
				$st = array( 'assente', 'Assente' );
			}
			if ( ! isset( $p['entrata'] ) && $started && ! $m['holiday'] && ! $m['closure'] && ( $m['scheduled'] || $m['rest_extra'] ) ) {
				$absent['total']++;
				if ( $m['sick'] ) {
					$absent['malattia']++;
				} elseif ( $m['leave'] ) {
					$absent['ferie']++;
				} elseif ( $m['hourly'] ) {
					$absent['permesso']++;
				} else {
					$absent['ingiustificati']++;
				}
			}
			$wps = Dolly_Workplaces::for_user( $uid );
			$rows[] = array(
				'user_id'      => $uid,
				'employee'     => Dolly_Employees::sort_name( $uid ),
				'workplace'    => isset( $p['entrata'] ) && $p['entrata']->workplace_id ? ( Dolly_Workplaces::get( (int) $p['entrata']->workplace_id )->name ?? '' ) : implode( ', ', wp_list_pluck( $wps, 'name' ) ),
				'start'        => $m['start'],
				'entrata'      => isset( $p['entrata'] ) ? Dolly_Time::utc_to_local( $p['entrata']->punched_at, 'H:i' ) : '',
				'inizio_pausa' => isset( $p['inizio_pausa'] ) ? Dolly_Time::utc_to_local( $p['inizio_pausa']->punched_at, 'H:i' ) : '',
				'fine_pausa'   => isset( $p['fine_pausa'] ) ? Dolly_Time::utc_to_local( $p['fine_pausa']->punched_at, 'H:i' ) : '',
				'uscita'       => isset( $p['uscita'] ) ? Dolly_Time::utc_to_local( $p['uscita']->punched_at, 'H:i' ) : '',
				'status'       => $st[0],
				'status_label' => $st[1],
			);
		}
		usort( $rows, function ( $a, $b ) {
			return strcasecmp( remove_accents( $a['employee'] ), remove_accents( $b['employee'] ) );
		} );
		$per      = 5;
		$att_page = max( 1, (int) ( $pages['attendance'] ?? 1 ) );
		$att_pgs  = max( 1, (int) ceil( count( $rows ) / $per ) );
		$att_page = min( $att_page, $att_pgs );

		$filter_users = $workplace_id ? $users : null;
		return array(
			'date'       => $today,
			'date_label' => Dolly_Time::WEEKDAYS[ Dolly_Time::weekday( $today ) ] . ' ' . Dolly_Time::fmt_date( $today ),
			'time'       => Dolly_Time::now_hm(),
			'kpi'        => array(
				'present'   => count( $present ),
				'absent'    => $absent,
				'pending'   => Dolly_Requests::count_pending( $filter_users ),
				'anomalies' => Dolly_Anomalies::count_open( $filter_users ),
			),
			'attendance' => array(
				'items' => array_slice( $rows, ( $att_page - 1 ) * $per, $per ),
				'total' => count( $rows ),
				'pages' => $att_pgs,
				'page'  => $att_page,
			),
			'requests'   => Dolly_Requests::query( array( 'workplace' => $workplace_id, 'page' => $pages['requests'] ?? 1, 'per_page' => 5 ) ),
			'anomalies'  => Dolly_Anomalies::query( array( 'workplace' => $workplace_id, 'status' => 'open', 'page' => $pages['anomalies'] ?? 1, 'per_page' => 5 ) ),
		);
	}

	/** Daily series for the attendance chart (7, 30 or 90 days). */
	public static function chart( $range, $workplace_id ) {
		$range = in_array( (int) $range, array( 7, 30, 90 ), true ) ? (int) $range : 7;
		$to    = Dolly_Time::today();
		$from  = Dolly_Time::add_days( $to, 1 - $range );
		$users = Dolly_Employees::active_ids( $workplace_id );
		$m     = self::day_matrix( $users, $from, $to );
		$p     = Dolly_Attendance::punches_range( $users, $from, $to );
		$out   = array( 'labels' => array(), 'present' => array(), 'absent' => array(), 'leave' => array(), 'sick' => array() );
		for ( $d = $from; $d <= $to; $d = Dolly_Time::add_days( $d, 1 ) ) {
			$pr = $ab = $lv = $sk = 0; // phpcs:ignore
			foreach ( $users as $uid ) {
				$x = $m[ $uid ][ $d ];
				$has = isset( $p[ $uid ][ $d ]['entrata'] );
				if ( $has ) {
					$pr++;
				} elseif ( ( $x['scheduled'] || $x['rest_extra'] ) && ! $x['holiday'] && ! $x['closure'] ) {
					if ( $x['sick'] ) {
						$sk++;
					} elseif ( $x['leave'] ) {
						$lv++;
					} elseif ( $d < $to || ( $x['start'] && Dolly_Time::hm_to_min( Dolly_Time::now_hm() ) >= Dolly_Time::hm_to_min( $x['start'] ) ) ) {
						$ab++;
					}
				}
			}
			$out['labels'][]  = substr( Dolly_Time::fmt_date( $d ), 0, 5 );
			$out['present'][] = $pr;
			$out['absent'][]  = $ab;
			$out['leave'][]   = $lv;
			$out['sick'][]    = $sk;
		}
		return $out;
	}

	/**
	 * Calendar events for FullCalendar.
	 *
	 * @param int|null $user_id Restrict to one employee (employee calendar); null for all/filtered.
	 */
	public static function calendar_events( $from, $to, $workplace_id = 0, $user_id = null ) {
		$users  = $user_id ? array( (int) $user_id ) : Dolly_Employees::active_ids( $workplace_id );
		$events = array();
		$own    = (bool) $user_id;
		foreach ( Dolly_Requests::approved_range( $users, $from, $to ) as $r ) {
			$who      = $own ? '' : Dolly_Employees::sort_name( (int) $r->user_id ) . ' · ';
			$events[] = array(
				'id'        => 'req-' . $r->id,
				'title'     => $who . ( 'ferie' === $r->type ? 'Ferie' : ( Dolly_Donations::TYPE === $r->type ? 'Donazione sangue' : ( 'permesso' === $r->type ? 'Permesso ' . Dolly_Time::hm( $r->start_time ) . '–' . Dolly_Time::hm( $r->end_time ) : 'Straordinario' ) ) ),
				'start'     => $r->start_date,
				'end'       => Dolly_Time::add_days( $r->end_date, 1 ),
				'allDay'    => true,
				'classNames'=> array( 'dolly-ev', 'dolly-ev--' . $r->type ),
				'extendedProps' => array( 'kind' => $r->type, 'status' => 'approved' ),
			);
		}
		foreach ( Dolly_Closures::between( $from, $to ) as $d => $c ) {
			if ( $own ? ! Dolly_Closures::covers( Dolly_Workplaces::ids_for_user( (int) $user_id, $d ), $c['workplaces'] ) : ( $workplace_id && ! in_array( (int) $workplace_id, $c['workplaces'], true ) ) ) {
				continue;
			}
			$names = array();
			foreach ( $c['workplaces'] as $wid ) {
				$w = Dolly_Workplaces::get( $wid );
				if ( $w ) {
					$names[] = $w->name;
				}
			}
			$events[] = array(
				'id'            => 'closure-' . $d,
				'title'         => $c['name'] . ( $own ? '' : ' · ' . implode( ', ', $names ) ),
				'start'         => $d,
				'allDay'        => true,
				'classNames'    => array( 'dolly-ev', 'holiday' === $c['type'] ? 'dolly-ev--chiusura-festiva' : 'dolly-ev--chiusura' ),
				'extendedProps' => array( 'kind' => 'closure', 'date' => $d, 'type' => $c['type'] ),
				'order'         => -2,
			);
		}
		foreach ( Dolly_Holidays::between( $from, $to ) as $d => $name ) {
			$events[] = array(
				'id'            => 'hol-' . $d,
				'title'         => $name,
				'start'         => $d,
				'allDay'        => true,
				'classNames'    => array( 'dolly-ev', 'dolly-ev--festivo' ),
				'extendedProps' => array( 'kind' => 'festivo' ),
				'order'         => -1,
			);
		}
		foreach ( Dolly_Sickness::range( $users, $from, $to ) as $s ) {
			$who      = $own ? '' : Dolly_Employees::sort_name( (int) $s->user_id ) . ' · ';
			$events[] = array(
				'id'        => 'sick-' . $s->id,
				'title'     => $who . Dolly_Sickness::kind_label( Dolly_Sickness::kind_of( $s ) ) . ( in_array( $s->certificate_status, array( 'missing', 'overdue' ), true ) ? ' · certificato mancante' : '' ),
				'start'     => $s->start_date,
				'end'       => Dolly_Time::add_days( $s->end_date, 1 ),
				'allDay'    => true,
				'classNames'=> array( 'dolly-ev', 'dolly-ev--malattia' ),
				'extendedProps' => array( 'kind' => 'malattia' ),
			);
		}
		if ( $own ) {
			foreach ( Dolly_Requests::query( array( 'user_id' => $user_id, 'status' => 'pending', 'per_page' => 100 ) )['items'] as $q ) {
				if ( $q['end_date'] < $from || $q['start_date'] > $to ) {
					continue;
				}
				$events[] = array(
					'id'        => 'pend-' . $q['id'],
					'title'     => 'In attesa · ' . $q['type_label'],
					'start'     => $q['start_date'],
					'end'       => Dolly_Time::add_days( $q['end_date'], 1 ),
					'allDay'    => true,
					'classNames'=> array( 'dolly-ev', 'dolly-ev--pending' ),
					'extendedProps' => array( 'kind' => 'pending', 'request_id' => $q['id'] ),
				);
			}
			$punches = Dolly_Attendance::punches_range( array( $user_id ), $from, $to );
			foreach ( $punches[ $user_id ] ?? array() as $d => $p ) {
				$in       = isset( $p['entrata'] ) ? Dolly_Time::utc_to_local( $p['entrata']->punched_at, 'H:i' ) : '—';
				$out      = isset( $p['uscita'] ) ? Dolly_Time::utc_to_local( $p['uscita']->punched_at, 'H:i' ) : '…';
				$events[] = array(
					'id'        => 'day-' . $d,
					'title'     => $in . '–' . $out,
					'start'     => $d,
					'allDay'    => true,
					'classNames'=> array( 'dolly-ev', isset( $p['uscita'] ) ? 'dolly-ev--worked' : 'dolly-ev--incomplete' ),
					'extendedProps' => array( 'kind' => 'worked' ),
				);
			}
		}
		return $events;
	}

	/* ---------- Exports ---------- */

	private static function csv_line( array $fields ) {
		$out = array();
		foreach ( $fields as $f ) {
			$f = (string) $f;
			// Neutralise spreadsheet formula injection.
			if ( '' !== $f && in_array( $f[0], array( '=', '+', '-', '@' ), true ) && ! preg_match( '/^-?\d/', $f ) ) {
				$f = "'" . $f;
			}
			$out[] = '"' . str_replace( '"', '""', $f ) . '"';
		}
		return implode( ';', $out ) . "\r\n";
	}

	public static function csv_string( array $header, array $rows ) {
		$s = "\xEF\xBB\xBF" . self::csv_line( $header );
		foreach ( $rows as $r ) {
			$s .= self::csv_line( $r );
		}
		return $s;
	}

	/** Employee information CSV (no passwords, certificates or medical notes). */
	public static function employees_csv() {
		$q    = new WP_User_Query( array( 'role' => Dolly_Install::ROLE_EMPLOYEE, 'number' => -1, 'meta_key' => 'last_name', 'orderby' => 'meta_value', 'order' => 'ASC' ) ); // phpcs:ignore
		$rows = array();
		foreach ( $q->get_results() as $u ) {
			$e = Dolly_Employees::format( $u );
			$s = $e['schedule'];
			$rows[] = array(
				$e['username'],
				$e['first_name'],
				$e['last_name'],
				$e['email'],
				$e['phone'],
				$e['active'] ? 'Attivo' : 'Disattivato',
				$s ? $s['employment_label'] : '',
				$s ? implode( ', ', array_map( function ( $d ) {
					return Dolly_Time::WEEKDAYS[ $d ];
				}, $s['weekdays'] ) ) : '',
				// Per-day hours or on-call: the full description; otherwise the single timetable.
				$s ? ( $s['per_day'] || $s['on_call'] ? $s['summary'] : $s['start_time'] . '–' . $s['end_time'] ) : '',
				$s && ! $s['per_day'] && $s['has_lunch'] ? $s['lunch_start'] . '–' . $s['lunch_end'] : ( $s && $s['per_day'] ? 'Vedi orario' : 'Nessuna' ),
				implode( ', ', wp_list_pluck( $e['workplaces'], 'name' ) ),
				Dolly_Time::utc_to_local( $u->user_registered, 'd/m/Y' ),
				$e['bank']['iban'],
				$e['bank']['bank_beneficiary'],
				$e['bank']['bank_name'],
				$e['bank']['bic'],
			);
		}
		return self::csv_string(
			array( 'Nome utente', 'Nome', 'Cognome', 'Email', 'Telefono', 'Stato', 'Tipo contratto', 'Giorni lavorativi', 'Orario', 'Pausa pranzo', 'Sedi', 'Data creazione', 'IBAN', 'Nome beneficiario', 'Banca', 'BIC' ),
			$rows
		);
	}

	public static function attendance_csv( $user_id, $year, $month ) {
		$data = Dolly_Hours::sync_month( $user_id, $year, $month ); // Also writes the month to the hours history.
		$rows = array();
		foreach ( $data['rows'] as $r ) {
			$rows[] = array(
				$r['date_label'],
				$r['weekday'],
				$r['day_type'],
				$r['schedule'],
				$r['entrata'],
				$r['inizio_pausa'],
				$r['fine_pausa'],
				$r['uscita'],
				$r['ferie'] ? 'Sì' : '',
				$r['permesso'],
				$r['sick_label'],
				$r['worked'],
				$r['extra_label'],
				$r['extra'],
				$r['extra_over'] ? $r['extra_over'] . ( 'pending' === $r['extra_over_status'] ? ' (da approvare)' : ' (non approvato)' ) : '',
				implode( ', ', $r['anomalies'] ),
				$r['provisional'] ? 'Provvisorio' : '',
				$r['entrata_real'],
				$r['uscita_real'],
				$r['late_min'] ? $r['late_min'] . ' min' : '',
				$r['festive'],
				$r['hours_note'],
				$r['donazione'] ? 'Sì' : '',
				Dolly_Hours::codes_text( $r['hours_codes'] ),
			);
		}
		$rows[] = array( 'TOTALE', '', '', '', '', '', '', '', '', '', '', $data['total'], '', $data['total_extra'], '0:00' !== $data['total_over'] ? $data['total_over'] : '', '', $data['provisional'] ? 'Provvisorio' : '', '', '', '', $data['total_festive'], $data['total_festive'] ? 'Maggiorazione festiva ' . $data['holiday_increase'] . '%' : '', '', implode( '; ', array_map( function ( $c ) {
			return $c['code'] . ' ' . $c['hm'];
		}, $data['hours_totals'] ) ) );
		foreach ( $data['hours_totals'] as $c ) {
			$rows[] = array( 'Giustificativo ' . $c['code'], $c['label'], $c['hm'] );
		}
		return self::csv_string(
			array( 'Data', 'Giorno', 'Tipo giorno', 'Orario previsto', 'Entrata', 'Inizio pausa', 'Fine pausa', 'Uscita', 'Ferie', 'Permesso orario', 'Malattia/Infortunio', 'Ore calcolate', 'Straordinario', 'Ore straordinario approvate', 'Straordinario oltre il limite', 'Anomalie non risolte', 'Stato totale', 'Entrata timbrata', 'Uscita timbrata', 'Ritardo', 'Ore festive', 'Note ore', 'Donazione sangue', 'Giustificativi (ore)' ),
			$rows
		);
	}

	private static function name_part( $s ) {
		$s = remove_accents( (string) $s );
		$s = preg_replace( '/[^A-Za-z0-9]+/', '_', $s );
		return trim( $s, '_' );
	}

	/** Builds unique filenames such as Mario_Rossi_Settembre_2026.csv, disambiguating duplicates. */
	public static function filenames( array $user_ids, $year, $month ) {
		$base = array();
		foreach ( $user_ids as $uid ) {
			$u            = get_userdata( $uid );
			$base[ $uid ] = self::name_part( $u->first_name ) . '_' . self::name_part( $u->last_name );
			if ( '_' === $base[ $uid ] || '' === trim( $base[ $uid ], '_' ) ) {
				$base[ $uid ] = self::name_part( $u->user_login );
			}
		}
		$counts = array_count_values( array_map( 'strtolower', $base ) );
		$suffix = '_' . Dolly_Time::MONTHS[ (int) $month ] . '_' . (int) $year . '.csv';
		$out    = array();
		$used   = array();
		foreach ( $base as $uid => $b ) {
			$name = $b;
			if ( $counts[ strtolower( $b ) ] > 1 ) {
				$name .= '_' . self::name_part( get_userdata( $uid )->user_login );
			}
			$candidate = $name;
			$i         = 2;
			while ( isset( $used[ strtolower( $candidate ) ] ) ) {
				$candidate = $name . '_' . $i++;
			}
			$used[ strtolower( $candidate ) ] = true;
			$out[ $uid ]                      = $candidate . $suffix;
		}
		return $out;
	}

	/**
	 * Creates the monthly ZIP (one CSV per selected employee) and returns the temp file path.
	 */
	public static function attendance_zip( array $user_ids, $year, $month ) {
		$user_ids = array_values( array_filter( array_map( 'intval', $user_ids ), array( 'Dolly_Employees', 'is_employee' ) ) );
		if ( ! $user_ids ) {
			return new WP_Error( 'dolly_invalid', 'Seleziona almeno un dipendente.', array( 'status' => 400 ) );
		}
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 300 ); // phpcs:ignore
		}
		require_once ABSPATH . 'wp-admin/includes/file.php';
		$names = self::filenames( $user_ids, $year, $month );
		$tmp   = wp_tempnam( 'dolly-presenze.zip' );
		if ( class_exists( 'ZipArchive' ) ) {
			$zip = new ZipArchive();
			if ( true !== $zip->open( $tmp, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
				return new WP_Error( 'dolly_zip', 'Impossibile creare il file ZIP.', array( 'status' => 500 ) );
			}
			foreach ( $user_ids as $uid ) {
				$zip->addFromString( $names[ $uid ], self::attendance_csv( $uid, $year, $month ) );
			}
			$zip->close();
		} else {
			require_once ABSPATH . 'wp-admin/includes/class-pclzip.php';
			$dir = trailingslashit( get_temp_dir() ) . 'dolly-' . wp_generate_password( 8, false, false );
			wp_mkdir_p( $dir );
			$files = array();
			foreach ( $user_ids as $uid ) {
				$f = $dir . '/' . $names[ $uid ];
				file_put_contents( $f, self::attendance_csv( $uid, $year, $month ) ); // phpcs:ignore
				$files[] = $f;
			}
			@unlink( $tmp ); // phpcs:ignore
			$zip = new PclZip( $tmp );
			if ( 0 === $zip->create( $files, PCLZIP_OPT_REMOVE_PATH, $dir ) ) {
				return new WP_Error( 'dolly_zip', 'Impossibile creare il file ZIP.', array( 'status' => 500 ) );
			}
			foreach ( $files as $f ) {
				@unlink( $f ); // phpcs:ignore
			}
			@rmdir( $dir ); // phpcs:ignore
		}
		return $tmp;
	}

	public static function send_download( $content_or_path, $filename, $mime, $is_path = false ) {
		nocache_headers();
		header( 'Content-Type: ' . $mime );
		header( 'Content-Disposition: attachment; filename="' . $filename . '"' );
		header( 'X-Content-Type-Options: nosniff' );
		if ( $is_path ) {
			header( 'Content-Length: ' . filesize( $content_or_path ) );
			readfile( $content_or_path ); // phpcs:ignore
			@unlink( $content_or_path ); // phpcs:ignore
		} else {
			header( 'Content-Length: ' . strlen( $content_or_path ) );
			echo $content_or_path; // phpcs:ignore
		}
		exit;
	}
}
