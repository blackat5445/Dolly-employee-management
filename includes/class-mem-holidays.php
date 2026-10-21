<?php
/**
 * Italian national public holidays, calculated for every year up to 2100 (Easter included),
 * so no yearly import is needed.
 *
 * Holidays are shown in the calendars and are never counted as unjustified absences.
 * Punches recorded on a holiday are kept and counted normally.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class MEM_Holidays {

	const MIN_YEAR = 2000;
	const MAX_YEAR = 2100;

	const FIXED = array(
		'01-01' => 'Capodanno',
		'01-06' => 'Epifania',
		'04-25' => 'Festa della Liberazione',
		'05-01' => 'Festa dei Lavoratori',
		'06-02' => 'Festa della Repubblica',
		'08-15' => 'Ferragosto',
		'11-01' => 'Ognissanti',
		'12-08' => 'Immacolata Concezione',
		'12-25' => 'Natale',
		'12-26' => 'Santo Stefano',
	);

	/** Easter Sunday (Gregorian calendar, anonymous algorithm) as Y-m-d. */
	public static function easter( $year ) {
		$a     = $year % 19;
		$b     = intdiv( $year, 100 );
		$c     = $year % 100;
		$d     = intdiv( $b, 4 );
		$e     = $b % 4;
		$f     = intdiv( $b + 8, 25 );
		$g     = intdiv( $b - $f + 1, 3 );
		$h     = ( 19 * $a + $b - $d - $g + 15 ) % 30;
		$i     = intdiv( $c, 4 );
		$k     = $c % 4;
		$l     = ( 32 + 2 * $e + 2 * $i - $h - $k ) % 7;
		$m     = intdiv( $a + 11 * $h + 22 * $l, 451 );
		$month = intdiv( $h + $l - 7 * $m + 114, 31 );
		$day   = ( ( $h + $l - 7 * $m + 114 ) % 31 ) + 1;
		return sprintf( '%04d-%02d-%02d', $year, $month, $day );
	}

	/** Holidays of one year: [Y-m-d => name]. Empty outside 2000–2100. */
	public static function for_year( $year ) {
		static $cache = array();
		$year = (int) $year;
		if ( $year < self::MIN_YEAR || $year > self::MAX_YEAR ) {
			return array();
		}
		if ( isset( $cache[ $year ] ) ) {
			return $cache[ $year ];
		}
		$out = array();
		foreach ( self::FIXED as $md => $name ) {
			$out[ $year . '-' . $md ] = $name;
		}
		// San Francesco d'Assisi, national holiday again from 2026.
		if ( $year >= 2026 ) {
			$out[ $year . '-10-04' ] = 'San Francesco d\'Assisi';
		}
		$easter = self::easter( $year );
		// Easter can coincide with a fixed holiday (e.g. 25/04/2038): both names are kept.
		foreach ( array( $easter => 'Pasqua', MEM_Time::add_days( $easter, 1 ) => 'Lunedì dell\'Angelo' ) as $d => $name ) {
			$out[ $d ] = isset( $out[ $d ] ) ? $out[ $d ] . ' · ' . $name : $name;
		}
		ksort( $out );
		$cache[ $year ] = $out;
		return $out;
	}

	/** Holidays between two dates (inclusive): [Y-m-d => name]. */
	public static function between( $from, $to ) {
		$out = array();
		for ( $y = (int) substr( $from, 0, 4 ); $y <= (int) substr( $to, 0, 4 ); $y++ ) {
			foreach ( self::for_year( $y ) as $d => $name ) {
				if ( $d >= $from && $d <= $to ) {
					$out[ $d ] = $name;
				}
			}
		}
		return $out;
	}

	/** Holiday name for a date, or null. */
	public static function name( $date ) {
		$list = self::for_year( (int) substr( $date, 0, 4 ) );
		return $list[ $date ] ?? null;
	}

	public static function is_holiday( $date ) {
		return null !== self::name( $date );
	}
}
