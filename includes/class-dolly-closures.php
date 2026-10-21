<?php
/**
 * Closures of chosen workplaces on one day or a range of days, of two types:
 * - "collective" (chiusura collettiva / ferie collettive): whoever works anyway records ordinary hours;
 * - "holiday" (chiusura per festività): hours worked get the holiday increase (setting "holiday_increase").
 *
 * An employee is covered when every workplace assigned to them on that date is closed. On those days a
 * missing entry is never an anomaly or an absence; the employee may still clock in.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Closures {

	const TYPES = array(
		'collective' => 'Chiusura collettiva',
		'holiday'    => 'Chiusura per festività',
	);

	/** Longest range created at once. */
	const MAX_DAYS = 92;

	private static $cache = array();

	public static function type_label( $type ) {
		return self::TYPES[ $type ] ?? self::TYPES['collective'];
	}

	/** Closure of one date: array( name, type, workplaces[] ) or null. */
	public static function for_date( $date ) {
		if ( ! array_key_exists( $date, self::$cache ) ) {
			$list                 = self::between( $date, $date );
			self::$cache[ $date ] = $list[ $date ] ?? null;
		}
		return self::$cache[ $date ];
	}

	/** Closures between two dates: [Y-m-d => array( name, type, workplaces => int[] )]. */
	public static function between( $from, $to ) {
		global $wpdb;
		$t    = Dolly_Install::t( 'closures' );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE closure_date BETWEEN %s AND %s ORDER BY closure_date, workplace_id", $from, $to ) ); // phpcs:ignore
		$out  = array();
		foreach ( $rows as $r ) {
			if ( ! isset( $out[ $r->closure_date ] ) ) {
				$type                    = isset( $r->type, self::TYPES[ $r->type ] ) ? $r->type : 'collective';
				$out[ $r->closure_date ] = array(
					'name'       => '' !== $r->name ? $r->name : self::type_label( $type ),
					'type'       => $type,
					'workplaces' => array(),
				);
			}
			$out[ $r->closure_date ]['workplaces'][] = (int) $r->workplace_id;
		}
		return $out;
	}

	/** True when all the given workplace ids are among the closed ones. */
	public static function covers( array $assigned, array $closed ) {
		return $assigned && ! array_diff( $assigned, $closed );
	}

	/** Closure covering the employee on the date: array( name, type ) or null. */
	public static function applies_detail( $user_id, $date ) {
		$c = self::for_date( $date );
		if ( ! $c || ! self::covers( Dolly_Workplaces::ids_for_user( $user_id, $date ), $c['workplaces'] ) ) {
			return null;
		}
		return array( 'name' => $c['name'], 'type' => $c['type'] );
	}

	/** Closure name when the employee's workplaces are all closed on the date, otherwise null. */
	public static function applies( $user_id, $date ) {
		$c = self::applies_detail( $user_id, $date );
		return $c ? $c['name'] : null;
	}

	/** Active employees covered by a closure on a date. */
	public static function affected_users( $date, array $closed ) {
		$out = array();
		foreach ( Dolly_Employees::active_ids() as $uid ) {
			if ( self::covers( Dolly_Workplaces::ids_for_user( $uid, $date ), $closed ) ) {
				$out[] = $uid;
			}
		}
		return $out;
	}

	/** Workplace assignments of the active employees overlapping a range: [user_id => rows]. One query. */
	private static function assignments( $from, $to ) {
		global $wpdb;
		$users = Dolly_Employees::active_ids();
		if ( ! $users ) {
			return array();
		}
		$a    = Dolly_Install::t( 'assignments' );
		$w    = Dolly_Install::t( 'workplaces' );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT a.user_id, a.workplace_id, a.valid_from, a.valid_to FROM $a a INNER JOIN $w w ON w.id = a.workplace_id WHERE w.active = 1 AND a.user_id IN (" . implode( ',', array_map( 'intval', $users ) ) . ') AND a.valid_from <= %s AND (a.valid_to IS NULL OR a.valid_to >= %s)', $to, $from ) ); // phpcs:ignore
		$out  = array();
		foreach ( $rows as $r ) {
			$out[ (int) $r->user_id ][] = $r;
		}
		return $out;
	}

	private static function ids_on( array $rows, $date ) {
		$ids = array();
		foreach ( $rows as $r ) {
			if ( $r->valid_from <= $date && ( null === $r->valid_to || $r->valid_to >= $date ) ) {
				$ids[] = (int) $r->workplace_id;
			}
		}
		return array_values( array_unique( $ids ) );
	}

	/** Detail for the administrator dialog (one day). */
	public static function day( $date ) {
		$c = self::for_date( $date );
		return array(
			'date'       => $date,
			'date_label' => Dolly_Time::WEEKDAYS[ Dolly_Time::weekday( $date ) ] . ' ' . Dolly_Time::fmt_date( $date ),
			'name'       => $c ? $c['name'] : '',
			'type'       => $c ? $c['type'] : 'collective',
			'workplaces' => $c ? $c['workplaces'] : array(),
			'holiday'    => Dolly_Holidays::name( $date ),
		);
	}

	/**
	 * Saves the closed workplaces for every day of a range (an empty list removes the closures of the
	 * range) and optionally sends one broadcast to the employees involved.
	 *
	 * @param array $data { from, to (or date), type, name, workplaces: int[],
	 *                      broadcast?: { enabled, message, email, portal, popup } }
	 */
	public static function save( $data ) {
		global $wpdb;
		Dolly_Analytics::bump();
		$from = (string) ( $data['from'] ?? ( $data['date'] ?? '' ) );
		$to   = (string) ( $data['to'] ?? $from );
		if ( ! Dolly_Time::is_date( $from ) || ! Dolly_Time::is_date( $to ) ) {
			return new WP_Error( 'dolly_invalid', 'Date non valide.', array( 'status' => 400, 'fields' => array( 'from' => 'Data non valida.' ) ) );
		}
		if ( $to < $from ) {
			return new WP_Error( 'dolly_invalid', 'La data di fine deve essere uguale o successiva all\'inizio.', array( 'status' => 400, 'fields' => array( 'to' => 'Data non valida.' ) ) );
		}
		$dates = array();
		for ( $d = $from; $d <= $to; $d = Dolly_Time::add_days( $d, 1 ) ) {
			$dates[] = $d;
			if ( count( $dates ) > self::MAX_DAYS ) {
				return new WP_Error( 'dolly_invalid', 'Il periodo può durare al massimo ' . self::MAX_DAYS . ' giorni.', array( 'status' => 400, 'fields' => array( 'to' => 'Periodo troppo lungo.' ) ) );
			}
		}
		$type = isset( self::TYPES[ $data['type'] ?? '' ] ) ? $data['type'] : 'collective';
		$name = sanitize_text_field( $data['name'] ?? '' );
		$name = '' !== $name ? mb_substr( $name, 0, 190 ) : self::type_label( $type );
		$wids = array();
		foreach ( (array) ( $data['workplaces'] ?? array() ) as $id ) {
			if ( Dolly_Workplaces::get( (int) $id ) ) {
				$wids[] = (int) $id;
			}
		}
		$wids = array_values( array_unique( $wids ) );
		sort( $wids );

		$bc = (array) ( $data['broadcast'] ?? array() );
		if ( ! empty( $bc['enabled'] ) ) {
			if ( ! $wids ) {
				return new WP_Error( 'dolly_invalid', 'Seleziona almeno una sede chiusa per inviare il messaggio.', array( 'status' => 400 ) );
			}
			if ( '' === trim( (string) ( $bc['message'] ?? '' ) ) ) {
				return new WP_Error( 'dolly_invalid', 'Scrivi il messaggio da inviare.', array( 'status' => 400, 'fields' => array( 'message' => 'Scrivi il messaggio.' ) ) );
			}
			if ( empty( $bc['email'] ) && empty( $bc['portal'] ) && empty( $bc['popup'] ) ) {
				return new WP_Error( 'dolly_invalid', 'Scegli almeno un canale di invio.', array( 'status' => 400, 'fields' => array( 'channels' => 'Scegli email e/o notifica nell\'app.' ) ) );
			}
		}

		$t        = Dolly_Install::t( 'closures' );
		$period   = Dolly_Time::fmt_date( $from ) . ( $from !== $to ? ' – ' . Dolly_Time::fmt_date( $to ) : '' );
		$affected = array();
		$involved = array();
		$assign   = self::assignments( $from, $to );
		// Unjustified absences already flagged in the range: closed below when the closure covers them.
		$a_t      = Dolly_Install::t( 'anomalies' );
		$absences = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( "SELECT user_id, work_date FROM $a_t WHERE type = 'unjustified_absence' AND status = 'open' AND work_date BETWEEN %s AND %s", $from, $to ) ) as $r ) { // phpcs:ignore
			$absences[ (int) $r->user_id . '|' . $r->work_date ] = true;
		}
		foreach ( $dates as $date ) {
			$wpdb->delete( $t, array( 'closure_date' => $date ) );
			foreach ( $wids as $wid ) {
				$wpdb->insert(
					$t,
					array(
						'closure_date' => $date,
						'workplace_id' => $wid,
						'name'         => $name,
						'type'         => $type,
						'created_by'   => get_current_user_id(),
						'created_at'   => Dolly_Time::now_utc(),
					)
				);
			}
			unset( self::$cache[ $date ] );
			if ( ! $wids ) {
				continue;
			}
			foreach ( $assign as $uid => $rows ) {
				$ids = self::ids_on( $rows, $date );
				if ( self::covers( $ids, $wids ) ) {
					$affected[ $uid ] = true;
					if ( isset( $absences[ $uid . '|' . $date ] ) ) {
						Dolly_Anomalies::resolve_absence( $uid, $date, $date, 'justified', 'Giustificata: ' . $name . '.' );
					}
				}
				// Everyone assigned to at least one closed workplace is informed.
				if ( array_intersect( $ids, $wids ) ) {
					$involved[ $uid ] = true;
				}
			}
		}
		Dolly_Audit::log(
			$wids ? 'closure_saved' : 'closure_removed',
			'closure',
			0,
			0,
			$name . ' ' . $period,
			null,
			array( 'periodo' => $period, 'tipo' => self::type_label( $type ), 'sedi' => $wids )
		);

		$sent = null;
		if ( ! empty( $bc['enabled'] ) ) {
			if ( ! $involved ) {
				$sent = array( 'skipped' => true );
			} else {
				$sent = Dolly_Broadcasts::create(
					array(
						'title'      => $name . ' · ' . $period,
						'message'    => (string) $bc['message'],
						'recipients' => array_keys( $involved ),
						'email'      => ! empty( $bc['email'] ),
						'portal'     => ! empty( $bc['portal'] ),
						'popup'      => ! empty( $bc['popup'] ),
						'send_now'   => true,
					),
					'closure'
				);
				if ( is_wp_error( $sent ) ) {
					return $sent;
				}
			}
		}
		$out              = self::day( $from );
		$out['days']      = count( $dates );
		$out['affected']  = count( $affected );
		$out['broadcast'] = $sent;
		return $out;
	}
}
