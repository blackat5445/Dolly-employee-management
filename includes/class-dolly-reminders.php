<?php
/**
 * Reminder mode: push reminders to clock in and to clock out.
 *
 * - Entry: N minutes BEFORE the shift start, to the employees expected at work today who have not
 *   clocked in yet.
 * - Exit: N minutes AFTER the shift end, to the employees who clocked in but not out.
 * The administrator configures one or more offsets for each reminder (settings "reminder_*").
 * No reminder on rest days, national holidays, closures, vacation, blood donation, sickness or injury,
 * nor when an approved hourly leave covers the shift start (entry) or the shift end (exit).
 * Each reminder is sent once per employee, day and offset (table "reminders").
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Reminders {

	/** A reminder is still sent when the scheduler is late, but not later than this many minutes. */
	const WINDOW_MIN = 10;

	const PLAN_TRANSIENT = 'dolly_reminder_plan';

	/**
	 * Shifts of today: [user_id => [start, end]] ("H:i"), for the employees expected at work on a regular
	 * working day. Cached for a few minutes: the scheduler runs every minute.
	 */
	private static function shifts( $today ) {
		$cached = get_transient( self::PLAN_TRANSIENT );
		if ( is_array( $cached ) && ( $cached['date'] ?? '' ) === $today ) {
			return $cached['shifts'];
		}
		$shifts = array();
		foreach ( Dolly_Employees::active_ids() as $uid ) {
			$plan = Dolly_Schedules::day_plan( $uid, $today );
			// Regular working day, or a rest day on which extra work was authorised.
			if ( ! $plan['eligible'] || $plan['on_call'] || ! $plan['start'] || ! $plan['end'] ) {
				continue;
			}
			if ( ( $plan['holiday'] || $plan['closure'] ) && ! $plan['rest_day_extra'] ) {
				continue;
			}
			$shifts[ $uid ] = array( $plan['start'], $plan['authorized_end'] ? $plan['authorized_end'] : $plan['end'] );
		}
		set_transient(
			self::PLAN_TRANSIENT,
			array(
				'date'   => $today,
				'shifts' => $shifts,
			),
			5 * MINUTE_IN_SECONDS
		);
		return $shifts;
	}

	/** Forget the cached shifts (settings or schedules changed). */
	public static function flush() {
		delete_transient( self::PLAN_TRANSIENT );
	}

	/** True when the offset must be sent now: target time reached, not older than the window. */
	private static function due( $target_ts, $now ) {
		return $now >= $target_ts && $now < $target_ts + self::WINDOW_MIN * MINUTE_IN_SECONDS;
	}

	/** Atomically records the reminder; false when it was already sent. */
	private static function claim( $user_id, $date, $kind, $offset ) {
		global $wpdb;
		$t = Dolly_Install::t( 'reminders' );
		return (bool) $wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO $t (user_id, work_date, kind, offset_min, sent_at) VALUES (%d, %s, %s, %d, %s)", $user_id, $date, $kind, $offset, Dolly_Time::now_utc() ) ); // phpcs:ignore
	}

	/** Absent for the whole day: vacation, blood donation, sickness or injury. */
	private static function absent_all_day( $user_id, $date ) {
		return Dolly_Sickness::covers( $user_id, $date ) || Dolly_Requests::full_day_leave( $user_id, $date );
	}

	/** An approved hourly leave covers the given time ("H:i"; the end of the leave is excluded for the start, included for the end). */
	private static function leave_covers( array $leaves, $hm, $is_end ) {
		foreach ( $leaves as $l ) {
			$s = Dolly_Time::hm( $l->start_time );
			$e = Dolly_Time::hm( $l->end_time );
			if ( $is_end ? ( $s < $hm && $e >= $hm ) : ( $s <= $hm && $e > $hm ) ) {
				return true;
			}
		}
		return false;
	}

	/** Scheduled every minute. Returns the number of reminders sent. */
	public static function run() {
		$entry_on = Dolly_Settings::get( 'reminder_entry' );
		$exit_on  = Dolly_Settings::get( 'reminder_exit' );
		$entry    = $entry_on ? Dolly_Settings::clean_minutes( Dolly_Settings::get( 'reminder_entry_minutes' ) ) : array();
		$exit     = $exit_on ? Dolly_Settings::clean_minutes( Dolly_Settings::get( 'reminder_exit_minutes' ) ) : array();
		if ( ! $entry && ! $exit ) {
			return 0;
		}
		$today  = Dolly_Time::today();
		$now    = time();
		$sent   = 0;
		$shifts = self::shifts( $today );
		foreach ( $shifts as $uid => $shift ) {
			$start_ts = Dolly_Time::local_ts( $today, $shift[0] );
			$end_ts   = Dolly_Time::local_ts( $today, $shift[1] );
			$todo     = array();
			foreach ( $entry as $m ) {
				if ( self::due( $start_ts - $m * MINUTE_IN_SECONDS, $now ) ) {
					$todo[] = array( 'entry', $m );
				}
			}
			foreach ( $exit as $m ) {
				if ( self::due( $end_ts + $m * MINUTE_IN_SECONDS, $now ) ) {
					$todo[] = array( 'exit', $m );
				}
			}
			if ( ! $todo ) {
				continue; // Nothing due for this employee right now: no further queries.
			}
			if ( self::absent_all_day( $uid, $today ) || ! Dolly_Workplaces::ids_for_user( $uid, $today ) ) {
				continue;
			}
			$punches = Dolly_Attendance::punches_for( $uid, $today );
			$leaves  = Dolly_Requests::hourly_leaves( $uid, $today );
			foreach ( $todo as $r ) {
				list( $kind, $m ) = $r;
				if ( 'entry' === $kind ) {
					if ( isset( $punches['entrata'] ) || self::leave_covers( $leaves, $shift[0], false ) ) {
						continue;
					}
					$title = 'Promemoria: timbra l\'entrata';
					$body  = $now < $start_ts
						? sprintf( 'Il tuo turno inizia alle %s. Ricordati di timbrare l\'entrata.', $shift[0] )
						: sprintf( 'Il tuo turno è iniziato alle %s. Ricordati di timbrare l\'entrata.', $shift[0] );
				} else {
					if ( ! isset( $punches['entrata'] ) || isset( $punches['uscita'] ) || self::leave_covers( $leaves, $shift[1], true ) ) {
						continue;
					}
					$title = 'Promemoria: timbra l\'uscita';
					$body  = sprintf( 'Il tuo turno è terminato alle %s e non risulta ancora l\'uscita. Ricordati di timbrarla.', $shift[1] );
				}
				if ( ! self::claim( $uid, $today, $kind, $m ) ) {
					continue;
				}
				// In-app notification that is pushed to the phone; never by email.
				Dolly_Notifications::deliver( $uid, 'reminder', $title, $body, 'dashboard', true, false );
				$sent++;
			}
		}
		self::cleanup( $today );
		return $sent;
	}

	/** The log only prevents duplicates within the day: old rows are removed once a day. */
	private static function cleanup( $today ) {
		global $wpdb;
		if ( get_option( 'dolly_reminders_cleaned' ) === $today ) {
			return;
		}
		$t = Dolly_Install::t( 'reminders' );
		$wpdb->query( $wpdb->prepare( "DELETE FROM $t WHERE work_date < %s", Dolly_Time::add_days( $today, -7 ) ) ); // phpcs:ignore
		update_option( 'dolly_reminders_cleaned', $today, false );
	}
}
