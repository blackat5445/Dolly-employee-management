<?php
/**
 * Daytime schedules with history, and the effective plan for a given date.
 *
 * A schedule is either one fixed timetable for all selected weekdays, or a different timetable for
 * each weekday ("day_times", JSON keyed by ISO weekday). On-call contracts ("on_call") have no
 * working days or hours: the employee clocks whenever called and the hours are approved afterwards.
 *
 * Smart working: with one fixed timetable the whole schedule can be smart working (column "work_mode").
 * With a timetable per day each day is in presence, smart working, or mixed: one block in presence and
 * one in smart working that do not overlap (the gap between them, if any, is the break). Punches in
 * smart working need no presence verification (GPS, QR/PIN, Bluetooth) and the smart-working hours
 * are approved (automatically or by the administrator, setting "smart_auto").
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Schedules {

	const TYPES = array(
		'full_time' => 'Tempo pieno',
		'part_time' => 'Part-time',
		'on_call'   => 'Contratto a chiamata',
	);

	const SHORT_DAYS = array( 1 => 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom' );

	/** How a working day is worked. */
	const MODES = array(
		'office' => 'In presenza',
		'smart'  => 'Smart working',
		'mixed'  => 'Misto (presenza e smart working)',
	);

	public static function for_date( $user_id, $date ) {
		global $wpdb;
		$t = Dolly_Install::t( 'schedules' );
		return $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM $t WHERE user_id = %d AND valid_from <= %s AND (valid_to IS NULL OR valid_to >= %s) AND (valid_to IS NULL OR valid_to >= valid_from) ORDER BY valid_from DESC, id DESC LIMIT 1", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
				$user_id,
				$date,
				$date
			)
		);
	}

	public static function current( $user_id ) {
		$s = self::for_date( $user_id, Dolly_Time::today() );
		if ( ! $s ) {
			// A schedule may start in the future.
			global $wpdb;
			$t = Dolly_Install::t( 'schedules' );
			$s = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND valid_to IS NULL ORDER BY valid_from DESC, id DESC LIMIT 1", $user_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		}
		return $s;
	}

	public static function history( $user_id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'schedules' );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND (valid_to IS NULL OR valid_to >= valid_from) ORDER BY valid_from DESC, id DESC", $user_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
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
	 * Hours of one weekday: start, end, lunch_start, lunch_end as HH:MM (lunch null when none), mode
	 * (office | smart | mixed) and, for mixed days, office_start/office_end and smart_start/smart_end.
	 */
	public static function times_for( $s, $weekday ) {
		$map = self::day_map( $s );
		if ( $map && isset( $map[ $weekday ] ) ) {
			$d    = $map[ $weekday ];
			$mode = isset( $d['mode'] ) && isset( self::MODES[ $d['mode'] ] ) ? $d['mode'] : 'office';
			return array(
				'start'        => $d['start'],
				'end'          => $d['end'],
				'lunch_start'  => $d['lunch_start'] ?? null,
				'lunch_end'    => $d['lunch_end'] ?? null,
				'mode'         => $mode,
				'office_start' => 'mixed' === $mode ? $d['office_start'] : null,
				'office_end'   => 'mixed' === $mode ? $d['office_end'] : null,
				'smart_start'  => 'mixed' === $mode ? $d['smart_start'] : null,
				'smart_end'    => 'mixed' === $mode ? $d['smart_end'] : null,
			);
		}
		return array(
			'start'        => Dolly_Time::hm( $s->start_time ),
			'end'          => Dolly_Time::hm( $s->end_time ),
			'lunch_start'  => Dolly_Time::hm( $s->lunch_start ),
			'lunch_end'    => Dolly_Time::hm( $s->lunch_end ),
			'mode'         => self::uniform_mode( $s ),
			'office_start' => null,
			'office_end'   => null,
			'smart_start'  => null,
			'smart_end'    => null,
		);
	}

	/** Mode of a schedule with one fixed timetable: "office" or "smart". */
	private static function uniform_mode( $s ) {
		return isset( $s->work_mode ) && 'smart' === $s->work_mode ? 'smart' : 'office';
	}

	/** True when the schedule has at least one day (partly) in smart working. */
	public static function has_smart( $s ) {
		if ( ! $s || self::is_on_call( $s ) ) {
			return false;
		}
		foreach ( self::weekdays( $s ) as $d ) {
			if ( 'office' !== self::times_for( $s, $d )['mode'] ) {
				return true;
			}
		}
		return false;
	}

	private static function times_label( $t ) {
		if ( 'mixed' === $t['mode'] ) {
			return sprintf( /* translators: %1$s: on-site time range, %2$s: smart-working time range (HH:MM–HH:MM). */ __( 'presenza %1$s, smart working %2$s', 'dolly-employee-management' ), $t['office_start'] . '–' . $t['office_end'], $t['smart_start'] . '–' . $t['smart_end'] );
		}
		return $t['start'] . '–' . $t['end'] . ( $t['lunch_start'] ? __( ' (pausa ', 'dolly-employee-management' ) . $t['lunch_start'] . '–' . $t['lunch_end'] . ')' : '' )
			. ( 'smart' === $t['mode'] ? __( ' · smart working', 'dolly-employee-management' ) : '' );
	}

	/** One-line description: "Lun Mar Mer · 08:00–16:30 (pausa …)" or one entry per day. */
	public static function summary( $s ) {
		if ( ! $s ) {
			return '';
		}
		if ( self::is_on_call( $s ) ) {
			return __( 'Contratto a chiamata (nessun orario fisso)', 'dolly-employee-management' );
		}
		$days = self::weekdays( $s );
		if ( ! $days ) {
			return '';
		}
		if ( ! self::is_per_day( $s ) ) {
			$names = array();
			foreach ( $days as $d ) {
				$names[] = Dolly_I18n::t( self::SHORT_DAYS[ $d ] );
			}
			return implode( ' ', $names ) . ' · ' . self::times_label( self::times_for( $s, $days[0] ) );
		}
		$parts = array();
		foreach ( $days as $d ) {
			$parts[] = Dolly_I18n::t( self::SHORT_DAYS[ $d ] ) . ' ' . self::times_label( self::times_for( $s, $d ) );
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
			'work_mode'        => self::uniform_mode( $s ),
			'has_smart'        => self::has_smart( $s ),
			'days'             => (object) $times,
			'on_call'          => self::is_on_call( $s ),
			'employment_type'  => $s->employment_type,
			'employment_label' => Dolly_I18n::t( self::TYPES[ $s->employment_type ] ?? $s->employment_type ),
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
		if ( ! Dolly_Time::is_time( $start ) ) {
			$errors[ $prefix . 'start_time' ] = __( 'Orario di inizio non valido.', 'dolly-employee-management' );
		}
		if ( ! Dolly_Time::is_time( $end ) ) {
			$errors[ $prefix . 'end_time' ] = __( 'Orario di fine non valido.', 'dolly-employee-management' );
		}
		if ( count( $errors ) === $before && Dolly_Time::hm_to_min( $end ) <= Dolly_Time::hm_to_min( $start ) ) {
			$errors[ $prefix . 'end_time' ] = __( 'La fine deve essere successiva all\'inizio (turni notturni non previsti).', 'dolly-employee-management' );
		}
		$ls = null;
		$le = null;
		if ( ! empty( $d['has_lunch'] ) ) {
			$ls = (string) ( $d['lunch_start'] ?? '' );
			$le = (string) ( $d['lunch_end'] ?? '' );
			if ( ! Dolly_Time::is_time( $ls ) ) {
				$errors[ $prefix . 'lunch_start' ] = __( 'Inizio pausa non valido.', 'dolly-employee-management' );
			}
			if ( ! Dolly_Time::is_time( $le ) ) {
				$errors[ $prefix . 'lunch_end' ] = __( 'Fine pausa non valida.', 'dolly-employee-management' );
			}
			if ( count( $errors ) === $before ) {
				$s = Dolly_Time::hm_to_min( $start );
				$e = Dolly_Time::hm_to_min( $end );
				$a = Dolly_Time::hm_to_min( $ls );
				$b = Dolly_Time::hm_to_min( $le );
				if ( $b <= $a ) {
					$errors[ $prefix . 'lunch_end' ] = __( 'La fine pausa deve essere successiva all\'inizio pausa.', 'dolly-employee-management' );
				} elseif ( $a <= $s || $b >= $e ) {
					$errors[ $prefix . 'lunch_start' ] = __( 'La pausa deve essere compresa nell\'orario di lavoro.', 'dolly-employee-management' );
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
	 * Validates a mixed day: one block in presence (office_start–office_end) and one in smart working
	 * (smart_start–smart_end) that must not overlap. The day runs from the first start to the last end;
	 * the gap between the blocks, if any, is the break.
	 */
	private static function clean_mixed( $d, $prefix, &$errors ) {
		$before = count( $errors );
		$v      = array();
		foreach ( array( 'office_start', 'office_end', 'smart_start', 'smart_end' ) as $k ) {
			$v[ $k ] = (string) ( $d[ $k ] ?? '' );
			if ( ! Dolly_Time::is_time( $v[ $k ] ) ) {
				$errors[ $prefix . $k ] = __( 'Orario non valido.', 'dolly-employee-management' );
			}
		}
		if ( count( $errors ) !== $before ) {
			return null;
		}
		$os = Dolly_Time::hm_to_min( $v['office_start'] );
		$oe = Dolly_Time::hm_to_min( $v['office_end'] );
		$ss = Dolly_Time::hm_to_min( $v['smart_start'] );
		$se = Dolly_Time::hm_to_min( $v['smart_end'] );
		if ( $oe <= $os ) {
			$errors[ $prefix . 'office_end' ] = __( 'La fine deve essere successiva all\'inizio.', 'dolly-employee-management' );
		}
		if ( $se <= $ss ) {
			$errors[ $prefix . 'smart_end' ] = __( 'La fine deve essere successiva all\'inizio.', 'dolly-employee-management' );
		}
		if ( count( $errors ) === $before && $os < $se && $ss < $oe ) {
			$errors[ $prefix . 'smart_start' ] = __( 'Le ore in presenza e in smart working non devono sovrapporsi.', 'dolly-employee-management' );
		}
		if ( count( $errors ) !== $before ) {
			return null;
		}
		$office_first = $oe <= $ss;
		$gap_from     = $office_first ? $v['office_end'] : $v['smart_end'];
		$gap_to       = $office_first ? $v['smart_start'] : $v['office_start'];
		$has_gap      = $gap_from !== $gap_to;
		return array(
			'start'        => $office_first ? $v['office_start'] : $v['smart_start'],
			'end'          => $office_first ? $v['smart_end'] : $v['office_end'],
			'lunch_start'  => $has_gap ? $gap_from : null,
			'lunch_end'    => $has_gap ? $gap_to : null,
			'office_start' => $v['office_start'],
			'office_end'   => $v['office_end'],
			'smart_start'  => $v['smart_start'],
			'smart_end'    => $v['smart_end'],
		);
	}

	/**
	 * Validates schedule input. Returns clean array or WP_Error.
	 *
	 * Input: employment_type; on-call → nothing else. Otherwise either per_day + days[weekday] = {mode,
	 * start_time, end_time, has_lunch, lunch_start, lunch_end} (mixed days: office_start, office_end,
	 * smart_start, smart_end) for the working days only, or weekdays[] + one timetable + smart.
	 */
	public static function clean( $data ) {
		$data   = (array) $data;
		$errors = array();
		$type   = $data['employment_type'] ?? 'full_time';
		if ( ! isset( self::TYPES[ $type ] ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Controlla i campi dell\'orario.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'employment_type' => __( 'Tipo di contratto non valido.', 'dolly-employee-management' ) ) ) );
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
				'work_mode'       => 'office',
			);
		}

		if ( ! empty( $data['per_day'] ) ) {
			$days = array();
			foreach ( (array) ( $data['days'] ?? array() ) as $wd => $d ) {
				$wd = (int) $wd;
				if ( $wd < 1 || $wd > 7 || ! is_array( $d ) ) {
					continue;
				}
				$mode = isset( $d['mode'] ) && isset( self::MODES[ $d['mode'] ] ) ? $d['mode'] : 'office';
				$t    = 'mixed' === $mode ? self::clean_mixed( $d, 'day' . $wd . '_', $errors ) : self::clean_times( $d, 'day' . $wd . '_', $errors );
				if ( $t ) {
					$t['mode']   = $mode;
					$days[ $wd ] = $t;
				}
			}
			ksort( $days );
			if ( ! $days && ! $errors ) {
				$errors['weekdays'] = __( 'Attiva almeno un giorno lavorativo.', 'dolly-employee-management' );
			}
			if ( $errors ) {
				return new WP_Error( 'dolly_invalid', __( 'Controlla i campi dell\'orario.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => $errors ) );
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
				'work_mode'       => 'office',
			);
		}

		$weekdays = array_values( array_unique( array_filter( array_map( 'intval', (array) ( $data['weekdays'] ?? array() ) ), function ( $d ) {
			return $d >= 1 && $d <= 7;
		} ) ) );
		sort( $weekdays );
		if ( ! $weekdays ) {
			$errors['weekdays'] = __( 'Seleziona almeno un giorno lavorativo.', 'dolly-employee-management' );
		}
		$t = self::clean_times( $data, '', $errors );
		if ( $errors ) {
			return new WP_Error( 'dolly_invalid', __( 'Controlla i campi dell\'orario.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => $errors ) );
		}
		return array(
			'weekdays'        => implode( ',', $weekdays ),
			'start_time'      => $t['start'] . ':00',
			'end_time'        => $t['end'] . ':00',
			'lunch_start'     => $t['lunch_start'] ? $t['lunch_start'] . ':00' : null,
			'lunch_end'       => $t['lunch_end'] ? $t['lunch_end'] . ':00' : null,
			'day_times'       => null,
			'employment_type' => $type,
			'work_mode'       => ! empty( $data['smart'] ) ? 'smart' : 'office',
		);
	}

	/**
	 * Sets a new schedule effective from a date; the previous schedule is closed (history preserved).
	 * Returns true if changed, false if identical, WP_Error on validation failure.
	 */
	public static function set( $user_id, $data, $from = null ) {
		global $wpdb;
		Dolly_Analytics::bump( $user_id );
		$clean = self::clean( $data );
		if ( is_wp_error( $clean ) ) {
			return $clean;
		}
		$from = ( $from && Dolly_Time::is_date( $from ) ) ? $from : Dolly_Time::today();
		$t    = Dolly_Install::t( 'schedules' );
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
		$prev = Dolly_Time::add_days( $from, -1 );
		// Close schedules that are open on/after $from.
		$wpdb->query( $wpdb->prepare( "UPDATE $t SET valid_to = %s WHERE user_id = %d AND (valid_to IS NULL OR valid_to >= %s)", $prev, $user_id, $from ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		$wpdb->insert(
			$t,
			array_merge(
				$clean,
				array(
					'user_id'    => $user_id,
					'valid_from' => $from,
					'valid_to'   => null,
					'created_by' => get_current_user_id(),
					'created_at' => Dolly_Time::now_utc(),
				)
			)
		);
		Dolly_Audit::log( 'schedule_changed', 'user', $user_id, $user_id, '', self::format( $cur ), self::format( self::for_date( $user_id, $from ) ) );
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
		$closure = Dolly_Closures::applies_detail( $user_id, $date );
		$holiday = Dolly_Holidays::name( $date );
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
			// Smart working: office | smart | mixed (blocks of the mixed day in office_* / smart_*).
			'work_mode'      => 'office',
			'office_start'   => null,
			'office_end'     => null,
			'smart_start'    => null,
			'smart_end'      => null,
		);
		$wd = Dolly_Time::weekday( $date );
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
			$plan['work_mode']      = $t['mode'];
			if ( 'mixed' === $t['mode'] ) {
				foreach ( array( 'office_start', 'office_end', 'smart_start', 'smart_end' ) as $k ) {
					$plan[ $k ] = $t[ $k ];
				}
			}
		}
		if ( ! $on_call ) {
			foreach ( Dolly_Requests::approved_extra_for( $user_id, $date ) as $x ) {
				if ( 'rest_day' === $x->extra_kind ) {
					if ( ! $plan['scheduled'] ) {
						$plan['rest_day_extra'] = true;
						$plan['eligible']       = true;
						$plan['start']          = Dolly_Time::hm( $x->start_time );
						$plan['end']            = Dolly_Time::hm( $x->end_time );
						$plan['has_lunch']      = ! empty( $x->lunch_start );
						$plan['lunch_start']    = Dolly_Time::hm( $x->lunch_start );
						$plan['lunch_end']      = Dolly_Time::hm( $x->lunch_end );
						$plan['authorized_end'] = $plan['end'];
					}
				} elseif ( $plan['scheduled'] && $x->end_time ) {
					$ext = Dolly_Time::hm( $x->end_time );
					if ( Dolly_Time::hm_to_min( $ext ) > Dolly_Time::hm_to_min( $plan['authorized_end'] ) ) {
						$plan['authorized_end'] = $ext;
						$plan['extension_end']  = $ext;
					}
					if ( $x->start_time && Dolly_Time::hm_to_min( Dolly_Time::hm( $x->start_time ) ) < Dolly_Time::hm_to_min( $plan['start'] ) ) {
						$plan['early_start'] = Dolly_Time::hm( $x->start_time );
					}
				}
			}
		}
		$plan['lunch_auto'] = $plan['has_lunch'] && ! Dolly_Settings::get( 'lunch_punch' );
		return $plan;
	}

	/**
	 * Minute (from midnight) that separates the two blocks of a mixed day: the middle of the gap between
	 * them, or the shared boundary when they touch. Null when the day is not mixed.
	 */
	public static function mixed_split( array $plan ) {
		if ( 'mixed' !== ( $plan['work_mode'] ?? 'office' ) ) {
			return null;
		}
		$oe = Dolly_Time::hm_to_min( $plan['office_end'] );
		$ss = Dolly_Time::hm_to_min( $plan['smart_start'] );
		if ( $oe <= $ss ) {
			return array( 'smart_after' => true, 'at' => intdiv( $oe + $ss, 2 ) );
		}
		return array( 'smart_after' => false, 'at' => intdiv( Dolly_Time::hm_to_min( $plan['smart_end'] ) + Dolly_Time::hm_to_min( $plan['office_start'] ), 2 ) );
	}

	/**
	 * True when a punch at the given minute belongs to smart working, so no presence verification is
	 * needed. Mixed day: a punch that starts work (entry, end of break) belongs to the block it opens,
	 * one that stops work (exit, start of break) to the block it closes; the split is mixed_split().
	 */
	public static function is_smart_punch( array $plan, $action, $minute ) {
		$mode = $plan['work_mode'] ?? 'office';
		if ( ! empty( $plan['on_call'] ) || ! empty( $plan['rest_day_extra'] ) || 'office' === $mode ) {
			return false;
		}
		if ( 'smart' === $mode ) {
			return true;
		}
		$split = self::mixed_split( $plan );
		$opens = in_array( $action, array( 'entrata', 'fine_pausa' ), true );
		if ( $split['smart_after'] ) {
			return $opens ? $minute >= $split['at'] : $minute > $split['at'];
		}
		return $opens ? $minute < $split['at'] : $minute <= $split['at'];
	}
}
