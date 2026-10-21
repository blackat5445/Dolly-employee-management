<?php
/**
 * Daytime schedules with history, and the effective plan for a given date.
 *
 * A schedule is either one fixed timetable for all selected weekdays, or a different timetable for
 * each weekday ("day_times", JSON keyed by ISO weekday). On-call contracts ("on_call") have no
 * working days or hours: the employee clocks whenever called and the hours are approved afterwards.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class MEM_Schedules {

	const TYPES = array(
		'full_time' => 'Tempo pieno',
		'part_time' => 'Part-time',
		'on_call'   => 'Contratto a chiamata',
	);

	const SHORT_DAYS = array( 1 => 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom' );

	public static function for_date( $user_id, $date ) {
		global $wpdb;
		$t = MEM_Install::t( 'schedules' );
		return $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM $t WHERE user_id = %d AND valid_from <= %s AND (valid_to IS NULL OR valid_to >= %s) AND (valid_to IS NULL OR valid_to >= valid_from) ORDER BY valid_from DESC, id DESC LIMIT 1", // phpcs:ignore
				$user_id,
				$date,
				$date
			)
		);
	}

	public static function current( $user_id ) {
		$s = self::for_date( $user_id, MEM_Time::today() );
		if ( ! $s ) {
			// A schedule may start in the future.
			global $wpdb;
			$t = MEM_Install::t( 'schedules' );
			$s = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND valid_to IS NULL ORDER BY valid_from DESC, id DESC LIMIT 1", $user_id ) ); // phpcs:ignore
		}
		return $s;
	}

	public static function history( $user_id ) {
		global $wpdb;
		$t = MEM_Install::t( 'schedules' );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND (valid_to IS NULL OR valid_to >= valid_from) ORDER BY valid_from DESC, id DESC", $user_id ) ); // phpcs:ignore
		return array_map( array( __CLASS__, 'format' ), $rows );
	}

	public static function is_on_call( $s ) {
		return $s && 'on_call' === $s->employment_type;
	}

	/** Weekdays (1 = Monday … 7 = Sunday) of a schedule row. */
	public static function weekdays( $s ) {
		return $s ? array_values( array_map( 'intval', array_filter( explode( ',', (string) $s->weekdays ) ) ) ) : array();
	}

	/** Per-day timetable, or null when the same hours apply to every working day. */
	private static function day_map( $s ) {
		if ( ! $s || empty( $s->day_times ) ) {
			return null;
		}
		$map = json_decode( $s->day_times, true );
		return is_array( $map ) && $map ? $map : null;
	}

	public static function is_per_day( $s ) {
		return (bool) self::day_map( $s );
	}

	/**
	 * Hours of one weekday: array( start, end, lunch_start, lunch_end ) as HH:MM (lunch null when none).
	 */
	public static function times_for( $s, $weekday ) {
		$map = self::day_map( $s );
		if ( $map && isset( $map[ $weekday ] ) ) {
			$d = $map[ $weekday ];
			return array(
				'start'       => $d['start'],
				'end'         => $d['end'],
				'lunch_start' => $d['lunch_start'] ?? null,
				'lunch_end'   => $d['lunch_end'] ?? null,
			);
		}
		return array(
			'start'       => MEM_Time::hm( $s->start_time ),
			'end'         => MEM_Time::hm( $s->end_time ),
			'lunch_start' => MEM_Time::hm( $s->lunch_start ),
			'lunch_end'   => MEM_Time::hm( $s->lunch_end ),
		);
	}

	private static function times_label( $t ) {
		return $t['start'] . '–' . $t['end'] . ( $t['lunch_start'] ? ' (pausa ' . $t['lunch_start'] . '–' . $t['lunch_end'] . ')' : '' );
	}

	/** One-line description: "Lun Mar Mer · 08:00–16:30 (pausa …)" or one entry per day. */
	public static function summary( $s ) {
		if ( ! $s ) {
			return '';
		}
		if ( self::is_on_call( $s ) ) {
			return 'Contratto a chiamata (nessun orario fisso)';
		}
		$days = self::weekdays( $s );
		if ( ! $days ) {
			return '';
		}
		if ( ! self::is_per_day( $s ) ) {
			$names = array();
			foreach ( $days as $d ) {
				$names[] = self::SHORT_DAYS[ $d ];
			}
			return implode( ' ', $names ) . ' · ' . self::times_label( self::times_for( $s, $days[0] ) );
		}
		$parts = array();
		foreach ( $days as $d ) {
			$parts[] = self::SHORT_DAYS[ $d ] . ' ' . self::times_label( self::times_for( $s, $d ) );
		}
		return implode( ' · ', $parts );
	}

	public static function format( $s ) {
		if ( ! $s ) {
			return null;
		}
		$days  = self::weekdays( $s );
		$times = array();
		foreach ( $days as $d ) {
			$times[ $d ] = self::times_for( $s, $d );
		}
		$first = $days ? $times[ $days[0] ] : array( 'start' => null, 'end' => null, 'lunch_start' => null, 'lunch_end' => null );
		return array(
			'id'               => (int) $s->id,
			'valid_from'       => $s->valid_from,
			'valid_to'         => $s->valid_to,
			'weekdays'         => $days,
			'start_time'       => $first['start'],
			'end_time'         => $first['end'],
			'has_lunch'        => ! empty( $first['lunch_start'] ),
			'lunch_start'      => $first['lunch_start'],
			'lunch_end'        => $first['lunch_end'],
			'per_day'          => self::is_per_day( $s ),
			'days'             => (object) $times,
			'on_call'          => self::is_on_call( $s ),
			'employment_type'  => $s->employment_type,
			'employment_label' => self::TYPES[ $s->employment_type ] ?? $s->employment_type,
			'summary'          => self::summary( $s ),
		);
	}

	/**
	 * Validates one timetable (start, end, optional lunch). Field errors use the given name prefix.
	 * Returns array( start, end, lunch_start, lunch_end ) as HH:MM, or null when invalid.
	 */
	private static function clean_times( $d, $prefix, &$errors ) {
		$before = count( $errors );
		$start  = (string) ( $d['start_time'] ?? '' );
		$end    = (string) ( $d['end_time'] ?? '' );
		if ( ! MEM_Time::is_time( $start ) ) {
			$errors[ $prefix . 'start_time' ] = 'Orario di inizio non valido.';
		}
		if ( ! MEM_Time::is_time( $end ) ) {
			$errors[ $prefix . 'end_time' ] = 'Orario di fine non valido.';
		}
		if ( count( $errors ) === $before && MEM_Time::hm_to_min( $end ) <= MEM_Time::hm_to_min( $start ) ) {
			$errors[ $prefix . 'end_time' ] = 'La fine deve essere successiva all\'inizio (turni notturni non previsti).';
		}
		$ls = null;
		$le = null;
		if ( ! empty( $d['has_lunch'] ) ) {
			$ls = (string) ( $d['lunch_start'] ?? '' );
			$le = (string) ( $d['lunch_end'] ?? '' );
			if ( ! MEM_Time::is_time( $ls ) ) {
				$errors[ $prefix . 'lunch_start' ] = 'Inizio pausa non valido.';
			}
			if ( ! MEM_Time::is_time( $le ) ) {
				$errors[ $prefix . 'lunch_end' ] = 'Fine pausa non valida.';
			}
			if ( count( $errors ) === $before ) {
				$s = MEM_Time::hm_to_min( $start );
				$e = MEM_Time::hm_to_min( $end );
				$a = MEM_Time::hm_to_min( $ls );
				$b = MEM_Time::hm_to_min( $le );
				if ( $b <= $a ) {
					$errors[ $prefix . 'lunch_end' ] = 'La fine pausa deve essere successiva all\'inizio pausa.';
				} elseif ( $a <= $s || $b >= $e ) {
					$errors[ $prefix . 'lunch_start' ] = 'La pausa deve essere compresa nell\'orario di lavoro.';
				}
			}
		}
		if ( count( $errors ) !== $before ) {
			return null;
		}
		return array(
			'start'       => $start,
			'end'         => $end,
			'lunch_start' => $ls,
			'lunch_end'   => $le,
		);
	}

	/**
	 * Validates schedule input. Returns clean array or WP_Error.
	 *
	 * Input: employment_type; on-call → nothing else. Otherwise either per_day + days[weekday] = {start_time,
	 * end_time, has_lunch, lunch_start, lunch_end} for the working days only, or weekdays[] + one timetable.
	 */
	public static function clean( $data ) {
		$data   = (array) $data;
		$errors = array();
		$type   = $data['employment_type'] ?? 'full_time';
		if ( ! isset( self::TYPES[ $type ] ) ) {
			return new WP_Error( 'mem_invalid', 'Controlla i campi dell\'orario.', array( 'status' => 400, 'fields' => array( 'employment_type' => 'Tipo di contratto non valido.' ) ) );
		}
		if ( 'on_call' === $type ) {
			return array(
				'weekdays'        => '',
				'start_time'      => '00:00:00',
				'end_time'        => '00:00:00',
				'lunch_start'     => null,
				'lunch_end'       => null,
				'day_times'       => null,
				'employment_type' => 'on_call',
			);
		}

		if ( ! empty( $data['per_day'] ) ) {
			$days = array();
			foreach ( (array) ( $data['days'] ?? array() ) as $wd => $d ) {
				$wd = (int) $wd;
				if ( $wd < 1 || $wd > 7 || ! is_array( $d ) ) {
					continue;
				}
				$t = self::clean_times( $d, 'day' . $wd . '_', $errors );
				if ( $t ) {
					$days[ $wd ] = $t;
				}
			}
			ksort( $days );
			if ( ! $days && ! $errors ) {
				$errors['weekdays'] = 'Attiva almeno un giorno lavorativo.';
			}
			if ( $errors ) {
				return new WP_Error( 'mem_invalid', 'Controlla i campi dell\'orario.', array( 'status' => 400, 'fields' => $errors ) );
			}
			$first = reset( $days );
			return array(
				'weekdays'        => implode( ',', array_keys( $days ) ),
				'start_time'      => $first['start'] . ':00',
				'end_time'        => $first['end'] . ':00',
				'lunch_start'     => $first['lunch_start'] ? $first['lunch_start'] . ':00' : null,
				'lunch_end'       => $first['lunch_end'] ? $first['lunch_end'] . ':00' : null,
				'day_times'       => wp_json_encode( $days ),
				'employment_type' => $type,
			);
		}

		$weekdays = array_values( array_unique( array_filter( array_map( 'intval', (array) ( $data['weekdays'] ?? array() ) ), function ( $d ) {
			return $d >= 1 && $d <= 7;
		} ) ) );
		sort( $weekdays );
		if ( ! $weekdays ) {
			$errors['weekdays'] = 'Seleziona almeno un giorno lavorativo.';
		}
		$t = self::clean_times( $data, '', $errors );
		if ( $errors ) {
			return new WP_Error( 'mem_invalid', 'Controlla i campi dell\'orario.', array( 'status' => 400, 'fields' => $errors ) );
		}
		return array(
			'weekdays'        => implode( ',', $weekdays ),
			'start_time'      => $t['start'] . ':00',
			'end_time'        => $t['end'] . ':00',
			'lunch_start'     => $t['lunch_start'] ? $t['lunch_start'] . ':00' : null,
			'lunch_end'       => $t['lunch_end'] ? $t['lunch_end'] . ':00' : null,
			'day_times'       => null,
			'employment_type' => $type,
		);
	}

	/**
	 * Sets a new schedule effective from a date; the previous schedule is closed (history preserved).
	 * Returns true if changed, false if identical, WP_Error on validation failure.
	 */
	public static function set( $user_id, $data, $from = null ) {
		global $wpdb;
		MEM_Analytics::bump( $user_id );
		$clean = self::clean( $data );
		if ( is_wp_error( $clean ) ) {
			return $clean;
		}
		$from = ( $from && MEM_Time::is_date( $from ) ) ? $from : MEM_Time::today();
		$t    = MEM_Install::t( 'schedules' );
		$cur  = self::for_date( $user_id, $from );
		if ( $cur ) {
			$same = true;
			foreach ( $clean as $k => $v ) {
				if ( (string) ( $cur->$k ?? '' ) !== (string) $v ) {
					$same = false;
					break;
				}
			}
			if ( $same ) {
				return false;
			}
		}
		$prev = MEM_Time::add_days( $from, -1 );
		// Close schedules that are open on/after $from.
		$wpdb->query( $wpdb->prepare( "UPDATE $t SET valid_to = %s WHERE user_id = %d AND (valid_to IS NULL OR valid_to >= %s)", $prev, $user_id, $from ) ); // phpcs:ignore
		$wpdb->insert(
			$t,
			array_merge(
				$clean,
				array(
					'user_id'    => $user_id,
					'valid_from' => $from,
					'valid_to'   => null,
					'created_by' => get_current_user_id(),
					'created_at' => MEM_Time::now_utc(),
				)
			)
		);
		MEM_Audit::log( 'schedule_changed', 'user', $user_id, $user_id, '', self::format( $cur ), self::format( self::for_date( $user_id, $from ) ) );
		return true;
	}

	/**
	 * Effective plan for a user and date, combining schedule, approved extra work and closures.
	 *
	 * @return array{
	 *   scheduled: bool, rest_day_extra: bool, eligible: bool, on_call: bool, start: ?string, end: ?string,
	 *   has_lunch: bool, lunch_auto: bool, lunch_start: ?string, lunch_end: ?string, authorized_end: ?string,
	 *   extension_end: ?string, holiday: ?string, closure: ?string
	 * }
	 * lunch_auto: the lunch break is not clocked and is deducted automatically (setting "lunch_punch" off).
	 * on_call: no fixed hours; the employee may clock any day and the hours are approved afterwards.
	 * closure / closure_type: closure covering the employee's workplaces ("collective": ordinary hours if
	 * they work anyway; "holiday": hours with the holiday increase).
	 * festive: hours worked get the holiday increase (holiday closure or national holiday).
	 */
	public static function day_plan( $user_id, $date ) {
		$s       = self::for_date( $user_id, $date );
		$on_call = self::is_on_call( $s );
		$closure = MEM_Closures::applies_detail( $user_id, $date );
		$holiday = MEM_Holidays::name( $date );
		$plan    = array(
			'scheduled'      => false,
			'rest_day_extra' => false,
			'eligible'       => $on_call,
			'on_call'        => $on_call,
			'start'          => null,
			'end'            => null,
			'has_lunch'      => false,
			'lunch_auto'     => false,
			'lunch_start'    => null,
			'lunch_end'      => null,
			'authorized_end' => null,
			'extension_end'  => null,
			'employment'     => $s ? $s->employment_type : null,
			'holiday'        => $holiday,
			'closure'        => $closure ? $closure['name'] : null,
			'closure_type'   => $closure ? $closure['type'] : null,
			// Hours worked today get the holiday increase: closure for a holiday, or national holiday.
			'festive'        => ( $closure && 'holiday' === $closure['type'] ) || null !== $holiday,
		);
		$wd = MEM_Time::weekday( $date );
		if ( ! $on_call && $s && in_array( $wd, self::weekdays( $s ), true ) ) {
			$t                      = self::times_for( $s, $wd );
			$plan['scheduled']      = true;
			$plan['eligible']       = true;
			$plan['start']          = $t['start'];
			$plan['end']            = $t['end'];
			$plan['has_lunch']      = ! empty( $t['lunch_start'] );
			$plan['lunch_start']    = $t['lunch_start'];
			$plan['lunch_end']      = $t['lunch_end'];
			$plan['authorized_end'] = $plan['end'];
		}
		if ( ! $on_call ) {
			foreach ( MEM_Requests::approved_extra_for( $user_id, $date ) as $x ) {
				if ( 'rest_day' === $x->extra_kind ) {
					if ( ! $plan['scheduled'] ) {
						$plan['rest_day_extra'] = true;
						$plan['eligible']       = true;
						$plan['start']          = MEM_Time::hm( $x->start_time );
						$plan['end']            = MEM_Time::hm( $x->end_time );
						$plan['has_lunch']      = ! empty( $x->lunch_start );
						$plan['lunch_start']    = MEM_Time::hm( $x->lunch_start );
						$plan['lunch_end']      = MEM_Time::hm( $x->lunch_end );
						$plan['authorized_end'] = $plan['end'];
					}
				} elseif ( $plan['scheduled'] && $x->end_time ) {
					$ext = MEM_Time::hm( $x->end_time );
					if ( MEM_Time::hm_to_min( $ext ) > MEM_Time::hm_to_min( $plan['authorized_end'] ) ) {
						$plan['authorized_end'] = $ext;
						$plan['extension_end']  = $ext;
					}
					if ( $x->start_time && MEM_Time::hm_to_min( MEM_Time::hm( $x->start_time ) ) < MEM_Time::hm_to_min( $plan['start'] ) ) {
						$plan['early_start'] = MEM_Time::hm( $x->start_time );
					}
				}
			}
		}
		$plan['lunch_auto'] = $plan['has_lunch'] && ! MEM_Settings::get( 'lunch_punch' );
		return $plan;
	}
}
