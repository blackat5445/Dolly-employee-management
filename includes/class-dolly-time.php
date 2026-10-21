<?php
/**
 * Time helpers: timestamps are stored in UTC, working dates are interpreted in Europe/Rome.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Time {

	const TZ = 'Europe/Rome';

	const MONTHS = array( 1 => 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre' );

	const WEEKDAYS = array( 1 => 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica' );

	public static function tz() {
		static $tz = null;
		if ( null === $tz ) {
			$tz = new DateTimeZone( self::TZ );
		}
		return $tz;
	}

	public static function utc() {
		static $utc = null;
		if ( null === $utc ) {
			$utc = new DateTimeZone( 'UTC' );
		}
		return $utc;
	}

	/** Current UTC timestamp as MySQL datetime. */
	public static function now_utc() {
		return gmdate( 'Y-m-d H:i:s' );
	}

	/** Current Rome DateTimeImmutable. */
	public static function now_local() {
		return new DateTimeImmutable( 'now', self::tz() );
	}

	/** Today's working date (Rome). */
	public static function today() {
		return self::now_local()->format( 'Y-m-d' );
	}

	/** Current Rome time HH:MM. */
	public static function now_hm() {
		return self::now_local()->format( 'H:i' );
	}

	/** Converts a Rome date + HH:MM(:SS) to a UTC MySQL datetime. */
	public static function local_to_utc( $date, $time ) {
		$time = strlen( $time ) === 5 ? $time . ':00' : $time;
		$dt   = new DateTimeImmutable( $date . ' ' . $time, self::tz() );
		return $dt->setTimezone( self::utc() )->format( 'Y-m-d H:i:s' );
	}

	/** Converts a UTC MySQL datetime to a Rome formatted string. */
	public static function utc_to_local( $utc, $format = 'Y-m-d H:i:s' ) {
		if ( empty( $utc ) ) {
			return '';
		}
		$dt = new DateTimeImmutable( $utc, self::utc() );
		return $dt->setTimezone( self::tz() )->format( $format );
	}

	/** UTC MySQL datetime -> unix timestamp. */
	public static function utc_ts( $utc ) {
		$dt = new DateTimeImmutable( $utc, self::utc() );
		return $dt->getTimestamp();
	}

	/** Rome date + HH:MM -> unix timestamp. */
	public static function local_ts( $date, $time ) {
		$time = strlen( $time ) === 5 ? $time . ':00' : $time;
		$dt   = new DateTimeImmutable( $date . ' ' . $time, self::tz() );
		return $dt->getTimestamp();
	}

	/** Unix timestamp -> Rome "HH:MM" (empty for null). */
	public static function ts_to_hm( $ts ) {
		if ( null === $ts ) {
			return '';
		}
		return ( new DateTimeImmutable( '@' . (int) $ts ) )->setTimezone( self::tz() )->format( 'H:i' );
	}

	/** ISO 8601 with offset for API output. */
	public static function iso( $utc ) {
		if ( empty( $utc ) ) {
			return null;
		}
		$dt = new DateTimeImmutable( $utc, self::utc() );
		return $dt->setTimezone( self::tz() )->format( DATE_ATOM );
	}

	/** Y-m-d -> DD/MM/YYYY. */
	public static function fmt_date( $ymd ) {
		if ( empty( $ymd ) ) {
			return '';
		}
		$p = explode( '-', substr( $ymd, 0, 10 ) );
		return count( $p ) === 3 ? $p[2] . '/' . $p[1] . '/' . $p[0] : $ymd;
	}

	/** ISO weekday 1 (Monday) .. 7 (Sunday) for a Y-m-d. */
	public static function weekday( $ymd ) {
		$dt = new DateTimeImmutable( $ymd, self::tz() );
		return (int) $dt->format( 'N' );
	}

	public static function add_days( $ymd, $days ) {
		$dt = new DateTimeImmutable( $ymd, self::tz() );
		return $dt->modify( ( $days >= 0 ? '+' : '' ) . (int) $days . ' days' )->format( 'Y-m-d' );
	}

	public static function days_in_month( $year, $month ) {
		return (int) ( new DateTimeImmutable( sprintf( '%04d-%02d-01', $year, $month ), self::tz() ) )->format( 't' );
	}

	/** Every date of a month as Y-m-d strings. */
	public static function month_dates( $year, $month ) {
		$out = array();
		$n   = self::days_in_month( $year, $month );
		for ( $d = 1; $d <= $n; $d++ ) {
			$out[] = sprintf( '%04d-%02d-%02d', $year, $month, $d );
		}
		return $out;
	}

	public static function is_date( $s ) {
		if ( ! is_string( $s ) || ! preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m ) ) {
			return false;
		}
		return checkdate( (int) $m[2], (int) $m[3], (int) $m[1] );
	}

	public static function is_time( $s ) {
		return is_string( $s ) && (bool) preg_match( '/^([01]\d|2[0-3]):[0-5]\d$/', $s );
	}

	/** HH:MM -> minutes since midnight. */
	public static function hm_to_min( $hm ) {
		if ( ! $hm ) {
			return null;
		}
		$p = explode( ':', $hm );
		return (int) $p[0] * 60 + (int) $p[1];
	}

	/** Minutes -> "H:MM". */
	public static function min_to_hm( $min ) {
		$min = max( 0, (int) round( $min ) );
		return sprintf( '%d:%02d', intdiv( $min, 60 ), $min % 60 );
	}

	/** Normalises "HH:MM:SS" to "HH:MM". */
	public static function hm( $t ) {
		return $t ? substr( $t, 0, 5 ) : null;
	}

	/** End of today (23:59:59 Rome) as UTC. */
	public static function end_of_today_utc() {
		return self::local_to_utc( self::today(), '23:59:59' );
	}
}
