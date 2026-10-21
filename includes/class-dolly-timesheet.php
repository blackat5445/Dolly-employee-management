<?php
/**
 * Monthly attendance sheet in Excel format ("Foglio presenze"): one file, one worksheet, all the
 * employees of the company. The workplace is not relevant and is never shown.
 *
 * Layout of the company's model:
 *   row 1-2   Anno · Mese
 *   row 4     days of the month, row 5 the day of the week (L M M G V S D)
 *   row 6     "n°" and "Dipendente"
 *   from 7    three rows per employee: "ore lavoro effettive", "giustificativi", "ore per giustificativi"
 *   bottom    legend of the labels and a box for the notes
 * Saturdays, Sundays and the public holidays of the month are coloured.
 * The hours come from the hours history (Dolly_Hours), which is recalculated for the month.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Timesheet {

	/** Monday … Sunday. */

	const FILL_WEEKEND = 'D9D9D9';
	const FILL_HOLIDAY = 'F8CBAD';
	const FILL_HEAD    = 'F2F2F2';

	const COL_NUM   = 1; // A: progressive number.
	const COL_NAME  = 2; // B:C merged: employee.
	const COL_DAY1  = 4; // D: first day of the month.

	/** Minutes → decimal hours (7:30 → 7.5), as a number for Excel. */
	private static function hours( $minutes ) {
		$h = round( (int) $minutes / 60, 2 );
		return (float) (int) $h === (float) $h ? (int) $h : $h;
	}

	/** Decimal hours as text with the Italian comma, for the cells that list several values. */
	private static function hours_text( $minutes ) {
		return str_replace( '.', ',', (string) self::hours( $minutes ) );
	}

	/** "Tempo pieno - 40 ore settimanali", "Part-time - 20 ore settimanali", "Contratto a chiamata". */
	public static function contract_label( $user_id, $date ) {
		$s = Dolly_Schedules::for_date( $user_id, $date );
		if ( ! $s ) {
			$s = Dolly_Schedules::current( $user_id );
		}
		if ( ! $s ) {
			return '';
		}
		$label = Dolly_I18n::t( Dolly_Schedules::TYPES[ $s->employment_type ] ?? (string) $s->employment_type );
		if ( Dolly_Schedules::is_on_call( $s ) ) {
			return $label;
		}
		$week = 0;
		foreach ( Dolly_Schedules::weekdays( $s ) as $wd ) {
			$t = Dolly_Schedules::times_for( $s, $wd );
			if ( ! $t['start'] || ! $t['end'] ) {
				continue;
			}
			$week += Dolly_Time::hm_to_min( $t['end'] ) - Dolly_Time::hm_to_min( $t['start'] );
			if ( ! empty( $t['lunch_start'] ) && ! empty( $t['lunch_end'] ) ) {
				$week -= Dolly_Time::hm_to_min( $t['lunch_end'] ) - Dolly_Time::hm_to_min( $t['lunch_start'] );
			}
		}
		return $week > 0 ? $label . ' - ' . self::hours_text( $week ) . __( ' hours per week', 'dolly-employee-management' ) : $label;
	}

	/**
	 * Employees of the month, by surname: every employee of the company, whatever the workplace.
	 * Left out: who was deactivated before the month (assignments and schedules stay open, so they
	 * would appear as absent forever) and who was registered after it.
	 */
	public static function employees( $from, $to ) {
		$ids   = get_users(
			array(
				'role'   => Dolly_Install::ROLE_EMPLOYEE,
				'fields' => 'ID',
				'number' => -1,
			)
		);
		$names = array();
		foreach ( $ids as $id ) {
			$id = (int) $id;
			$u  = get_userdata( $id );
			if ( ! $u || Dolly_Time::utc_to_local( $u->user_registered, 'Y-m-d' ) > $to ) {
				continue;
			}
			if ( ! Dolly_Employees::is_active( $id ) ) {
				$off = (string) get_user_meta( $id, 'dolly_deactivated_at', true ); // UTC datetime.
				if ( '' === $off || Dolly_Time::utc_to_local( $off, 'Y-m-d' ) < $from ) {
					continue;
				}
			}
			$names[ $id ] = remove_accents( Dolly_Employees::sort_name( $id ) );
		}
		uasort( $names, 'strcasecmp' );
		return array_keys( $names );
	}

	/**
	 * Builds the workbook of a month — one worksheet with all the employees, without any reference to
	 * the workplaces — and returns the temporary file path, or WP_Error.
	 */
	public static function build( $year, $month ) {
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 300 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- failure handled by the caller.
		}
		$dates = Dolly_Time::month_dates( $year, $month );
		$from  = $dates[0];
		$to    = end( $dates );
		$ids   = self::employees( $from, $to );
		if ( ! $ids ) {
			return new WP_Error( 'dolly_empty', __( 'No employees in the selected month.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}

		// Coloured as public holidays: the national ones, plus the closures for a holiday of the whole company.
		$festive = Dolly_Holidays::between( $from, $to );
		$all     = array_map( 'intval', wp_list_pluck( Dolly_Workplaces::all( true ), 'id' ) );
		foreach ( Dolly_Closures::between( $from, $to ) as $d => $c ) {
			if ( 'holiday' === $c['type'] && $all && ! array_diff( $all, $c['workplaces'] ) && ! isset( $festive[ $d ] ) ) {
				$festive[ $d ] = $c['name'];
			}
		}
		ksort( $festive );

		$xlsx = new Dolly_Xlsx();
		self::sheet( $xlsx, Dolly_I18n::t( Dolly_Time::MONTHS[ (int) $month ] ) . ' ' . (int) $year, (int) $year, (int) $month, $dates, $festive, $ids );
		return $xlsx->save();
	}

	/** Suggested file name: Foglio_presenze_Ottobre_2026.xlsx */
	public static function filename( $year, $month ) {
		return __( 'Timesheet_', 'dolly-employee-management' ) . Dolly_I18n::t( Dolly_Time::MONTHS[ (int) $month ] ) . '_' . (int) $year . '.xlsx';
	}

	private static function sheet( Dolly_Xlsx $x, $title, $year, $month, array $dates, array $festive, array $user_ids ) {
		$s     = $x->add_sheet( $title );
		$n     = count( $dates );
		$first = self::COL_DAY1;
		$last  = $first + $n - 1;
		$label = $last + 1; // "ore lavoro effettive" / "giustificativi" / "ore per giustificativi".
		$total = $last + 2; // Month totals.

		// Column fill of each day: public holiday, otherwise Saturday / Sunday.
		$fill = array();
		foreach ( $dates as $i => $d ) {
			$wd            = Dolly_Time::weekday( $d );
			$fill[ $i ]    = isset( $festive[ $d ] ) ? self::FILL_HOLIDAY : ( $wd >= 6 ? self::FILL_WEEKEND : '' );
		}

		$x->width( $s, self::COL_NUM, 4 );
		$x->width( $s, 2, 12 );
		$x->width( $s, 3, 20 );
		for ( $c = $first; $c <= $last; $c++ ) {
			$x->width( $s, $c, 4.4 );
		}
		$x->width( $s, $label, 19 );
		$x->width( $s, $total, 30 );

		// Rows 1-2: year and month.
		$cap  = array( 'bold' => true, 'align' => 'center' );
		$big  = array( 'bold' => true, 'size' => 18, 'align' => 'center', 'valign' => 'center', 'border' => true );
		$x->set( $s, 1, 2, __( 'Year', 'dolly-employee-management' ), $cap );
		$x->set( $s, 2, 2, (int) $year, $big );
		$x->merge( $s, 1, 8, 1, 20 );
		$x->set( $s, 1, 8, __( 'Month', 'dolly-employee-management' ), $cap );
		$x->style_range( $s, 2, 8, 2, 20, $big );
		$x->merge( $s, 2, 8, 2, 20 );
		$x->set( $s, 2, 8, strtolower( Dolly_I18n::t( Dolly_Time::MONTHS[ $month ] ) ), $big );
		$x->height( $s, 2, 25.5 );

		// Row 4: days; row 5: day of the week.
		foreach ( $dates as $i => $d ) {
			$col = $first + $i;
			$st  = array( 'border' => true, 'align' => 'center', 'bold' => true, 'size' => 9, 'fill' => $fill[ $i ] ? $fill[ $i ] : self::FILL_HEAD );
			$x->set( $s, 4, $col, (int) substr( $d, 8, 2 ), $st );
			// Initial of the weekday in the current language (L M M G V S D, or M T W T F S S).
			$x->set( $s, 5, $col, mb_strtoupper( mb_substr( Dolly_I18n::t( Dolly_Time::WEEKDAYS[ Dolly_Time::weekday( $d ) ] ), 0, 1 ) ), $st );
		}
		$x->set( $s, 4, $total, __( 'Total for the month', 'dolly-employee-management' ), array( 'border' => true, 'align' => 'center', 'bold' => true, 'size' => 9, 'fill' => self::FILL_HEAD ) );
		$x->set( $s, 5, $total, __( 'hours', 'dolly-employee-management' ), array( 'border' => true, 'align' => 'center', 'bold' => true, 'size' => 9, 'fill' => self::FILL_HEAD ) );

		// Row 6: headings of the employee columns.
		$x->set( $s, 6, self::COL_NUM, 'n°', array( 'bold' => true, 'align' => 'center' ) );
		$x->set( $s, 6, self::COL_NAME, __( 'Employee', 'dolly-employee-management' ), array( 'bold' => true ) );

		$row   = 7;
		$codes = array_keys( Dolly_Hours::CODES );
		foreach ( array_values( $user_ids ) as $idx => $uid ) {
			$data = Dolly_Hours::sync_month( $uid, $year, $month );
			$by   = array();
			foreach ( $data['rows'] as $r ) {
				$by[ $r['date'] ] = $r['hours_codes'];
			}
			$contract = self::contract_label( $uid, end( $dates ) );
			$name     = Dolly_Employees::display_name( $uid );
			$name     = function_exists( 'mb_strtoupper' ) ? mb_strtoupper( $name, 'UTF-8' ) : strtoupper( $name );

			$x->set( $s, $row, self::COL_NUM, $idx + 1, array( 'align' => 'center', 'valign' => 'center', 'border' => true ) );
			$x->style_range( $s, $row, self::COL_NUM, $row + 2, self::COL_NUM, array( 'align' => 'center', 'valign' => 'center', 'border' => true ) );
			$x->merge( $s, $row, self::COL_NUM, $row + 2, self::COL_NUM );
			$x->set( $s, $row, self::COL_NUM, $idx + 1, array( 'align' => 'center', 'valign' => 'center', 'border' => true ) );
			$name_style = array( 'border' => true, 'valign' => 'center', 'wrap' => true, 'bold' => true, 'size' => 9 );
			$x->style_range( $s, $row, self::COL_NAME, $row + 2, self::COL_NAME + 1, $name_style );
			$x->merge( $s, $row, self::COL_NAME, $row + 2, self::COL_NAME + 1 );
			$x->set( $s, $row, self::COL_NAME, $name . ( $contract ? ' (' . $contract . ')' : '' ), $name_style );

			$tot_work  = 0;
			$tot_codes = array();
			$lines     = 1;
			foreach ( $dates as $i => $d ) {
				$col  = $first + $i;
				$day  = $by[ $d ] ?? array();
				$work = 0;
				$just = array();
				foreach ( $codes as $code ) {
					if ( empty( $day[ $code ] ) ) {
						continue;
					}
					if ( in_array( $code, Dolly_Hours::WORK_CODES, true ) ) {
						$work += $day[ $code ];
					}
					if ( 'O' !== $code ) {
						$just[ $code ]      = $day[ $code ];
						$tot_codes[ $code ] = ( $tot_codes[ $code ] ?? 0 ) + $day[ $code ];
					}
				}
				$tot_work += $work;
				$cell      = array( 'border' => true, 'align' => 'center', 'valign' => 'center', 'size' => 9, 'fill' => $fill[ $i ] );
				$small     = array( 'border' => true, 'align' => 'center', 'valign' => 'center', 'size' => 8, 'wrap' => true, 'fill' => $fill[ $i ] );
				$x->set( $s, $row, $col, $work ? self::hours( $work ) : null, $cell );
				if ( 1 === count( $just ) ) {
					$x->set( $s, $row + 1, $col, (string) key( $just ), $small );
					$x->set( $s, $row + 2, $col, self::hours( current( $just ) ), $small );
				} else {
					// Several justifications in the same day: one per line.
					$x->set( $s, $row + 1, $col, $just ? implode( "\n", array_keys( $just ) ) : null, $small );
					$x->set( $s, $row + 2, $col, $just ? implode( "\n", array_map( array( __CLASS__, 'hours_text' ), $just ) ) : null, $small );
					$lines = max( $lines, count( $just ) );
				}
			}
			$lab = array( 'border' => true, 'valign' => 'center', 'size' => 9 );
			$x->set( $s, $row, $label, __( 'actual working hours', 'dolly-employee-management' ), $lab );
			$x->set( $s, $row + 1, $label, 'giustificativi', $lab );
			$x->set( $s, $row + 2, $label, __( 'hours for absence codes', 'dolly-employee-management' ), $lab );

			$x->set( $s, $row, $total, $tot_work ? self::hours( $tot_work ) : null, array( 'border' => true, 'align' => 'center', 'valign' => 'center', 'bold' => true, 'size' => 9 ) );
			$sum = array();
			foreach ( $codes as $code ) {
				if ( ! empty( $tot_codes[ $code ] ) ) {
					$sum[] = $code . ' ' . self::hours_text( $tot_codes[ $code ] );
				}
			}
			$sum_style = array( 'border' => true, 'align' => 'center', 'valign' => 'center', 'wrap' => true, 'size' => 9 );
			$x->style_range( $s, $row + 1, $total, $row + 2, $total, $sum_style );
			$x->merge( $s, $row + 1, $total, $row + 2, $total );
			$x->set( $s, $row + 1, $total, $sum ? implode( ' · ', $sum ) : null, $sum_style );

			$x->height( $s, $row, 24 );
			$x->height( $s, $row + 1, max( 14, 11.5 * $lines + 2 ) );
			$x->height( $s, $row + 2, max( 14, 11.5 * $lines + 2 ) );
			$row += 3;
		}

		// Legend and notes.
		$row += 2;
		$legend = array(
			array( __( 'FS = Holiday', 'dolly-employee-management' ), __( 'EO = Former public holidays', 'dolly-employee-management' ) ),
			array( __( 'FER = Saturday', 'dolly-employee-management' ), __( 'Pn = Unpaid leave', 'dolly-employee-management' ) ),
			array( __( 'O = Regular', 'dolly-employee-management' ), __( 'PL = Law 104 leave', 'dolly-employee-management' ) ),
			array( __( 'S = Overtime', 'dolly-employee-management' ), __( 'M = Sickness', 'dolly-employee-management' ) ),
			array( __( 'FE = Vacation', 'dolly-employee-management' ), __( 'I = Injury', 'dolly-employee-management' ) ),
			array( __( 'P = Leave', 'dolly-employee-management' ), __( 'Av = Blood donation', 'dolly-employee-management' ) ),
			array( __( 'ROL = Paid leave for reduced working hours', 'dolly-employee-management' ), __( 'A = Unpaid absence', 'dolly-employee-management' ) ),
		);
		foreach ( $legend as $i => $pair ) {
			$x->set( $s, $row + $i, 2, $pair[0], array( 'size' => 9 ) );
			$x->set( $s, $row + $i, 9, $pair[1], array( 'size' => 9 ) );
		}
		$after = $row + count( $legend ) + 1;
		$x->set( $s, $after, 2, '', array( 'fill' => self::FILL_WEEKEND, 'border' => true ) );
		$x->set( $s, $after, 3, __( 'Saturday and Sunday', 'dolly-employee-management' ), array( 'size' => 9 ) );
		$x->set( $s, $after + 1, 2, '', array( 'fill' => self::FILL_HOLIDAY, 'border' => true ) );
		$x->set( $s, $after + 1, 3, __( 'Public holiday', 'dolly-employee-management' ) . ( $festive ? ': ' . implode( ', ', array_map( function ( $d, $name ) {
			return (int) substr( $d, 8, 2 ) . ' ' . $name;
		}, array_keys( $festive ), $festive ) ) : __( ' (none this month)', 'dolly-employee-management' ) ), array( 'size' => 9 ) );
		// "Note" box next to the legend, as in the model.
		$note_c1 = min( 20, $last );
		$note    = array( 'border' => true, 'valign' => 'top', 'size' => 12, 'wrap' => true );
		$x->style_range( $s, $row + 1, $note_c1, $row + 4, $last, $note );
		$x->merge( $s, $row + 1, $note_c1, $row + 4, $last );
		$x->set( $s, $row + 1, $note_c1, __( 'Notes :', 'dolly-employee-management' ), $note );

		$x->freeze( $s, 3, 6 );
	}
}
