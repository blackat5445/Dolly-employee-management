<?php
/**
 * Requests: vacation (ferie), hourly leave (permesso), extra work (straordinario), corrections (correzione).
 *
 * Changes or cancellations of approved requests are stored as amendment rows (parent_id) that need
 * administrator approval; the original approval stays effective until the amendment is approved.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Requests {

	const TYPES = array(
		'ferie'         => 'Ferie',
		'permesso'      => 'Permesso orario',
		'straordinario' => 'Straordinario',
		'correzione'    => 'Correzione timbratura',
		'turno'         => 'Turno a chiamata',
		'donazione'     => 'Donazione sangue',
	);

	/** Full-day absences that need approval (the day counts as justified). */
	const FULL_DAY_TYPES = array( 'ferie', 'donazione' );

	/** Kinds of hourly leave chosen by the employee. */
	const LEAVE_KINDS = array(
		'retribuito'     => 'Permesso ordinario retribuito',
		'non_retribuito' => 'Permesso ordinario non retribuito',
		'evento'         => 'Congedi e permessi per eventi specifici',
	);

	/** Justification codes (hours history) allowed for each kind of hourly leave; the first is the default. */
	const LEAVE_CODES = array(
		'retribuito'     => array( 'P', 'ROL', 'EO' ),
		'non_retribuito' => array( 'Pn' ),
		'evento'         => array( 'P', 'PL' ),
	);

	/** Kind of an hourly leave row ("retribuito" for rows created before the kinds existed). */
	public static function leave_kind_of( $r ) {
		return isset( $r->leave_kind ) && isset( self::LEAVE_KINDS[ $r->leave_kind ] ) ? $r->leave_kind : 'retribuito';
	}

	/** Justification code of an hourly leave row. */
	public static function leave_code_of( $r ) {
		$kind = self::leave_kind_of( $r );
		return isset( $r->hours_code ) && in_array( $r->hours_code, self::LEAVE_CODES[ $kind ], true ) ? $r->hours_code : self::LEAVE_CODES[ $kind ][0];
	}

	const STATUSES = array(
		'pending'    => 'In attesa',
		'approved'   => 'Approvata',
		'rejected'   => 'Respinta',
		'cancelled'  => 'Annullata',
		'superseded' => 'Sostituita da modifica',
	);

	/** SQL fragment: rows that represent an absence/authorisation (not cancellation amendments). */
	const EFFECTIVE_ROW = "(amend_action IS NULL OR amend_action = 'modify')";

	public static function get( $id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'requests' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d", $id ) ); // phpcs:ignore
	}

	public static function format( $r ) {
		if ( ! $r ) {
			return null;
		}
		$label = Dolly_I18n::t( self::TYPES[ $r->type ] ?? $r->type );
		if ( 'straordinario' === $r->type ) {
			$label .= 'rest_day' === $r->extra_kind ? __( ' (giorno di riposo)', 'dolly-employee-management' ) : __( ' (giorno lavorativo)', 'dolly-employee-management' );
		}
		$pending_amendment = null;
		if ( 'approved' === $r->status ) {
			$pending_amendment = self::pending_amendment( (int) $r->id );
		}
		$extra = array();
		if ( 'permesso' === $r->type ) {
			$kind  = self::leave_kind_of( $r );
			$code  = self::leave_code_of( $r );
			$extra = array(
				'leave_kind'       => $kind,
				'leave_kind_label' => Dolly_I18n::t( self::LEAVE_KINDS[ $kind ] ),
				'hours_code'       => $code,
				'hours_code_label' => Dolly_I18n::t( Dolly_Hours::CODES[ $code ] ?? $code ),
				'law104'           => 'PL' === $code,
			);
		} elseif ( Dolly_Donations::TYPE === $r->type ) {
			$extra = Dolly_Donations::format_certificate( $r );
		}
		return $extra + array(
			'id'                => (int) $r->id,
			'user_id'           => (int) $r->user_id,
			'employee'          => Dolly_Employees::sort_name( (int) $r->user_id ),
			'type'              => $r->type,
			'type_label'        => $label,
			'status'            => $r->status,
			'status_label'      => Dolly_I18n::t( self::STATUSES[ $r->status ] ?? $r->status ),
			'start_date'        => $r->start_date,
			'end_date'          => $r->end_date,
			'start_time'        => Dolly_Time::hm( $r->start_time ),
			'end_time'          => Dolly_Time::hm( $r->end_time ),
			'lunch_start'       => Dolly_Time::hm( $r->lunch_start ),
			'lunch_end'         => Dolly_Time::hm( $r->lunch_end ),
			'extra_kind'        => $r->extra_kind,
			'correction_action' => $r->correction_action,
			'correction_label'  => $r->correction_action ? ( Dolly_I18n::t( Dolly_Attendance::ACTIONS[ $r->correction_action ] ?? '' ) ) : '',
			'notes'             => (string) $r->notes,
			'parent_id'         => $r->parent_id ? (int) $r->parent_id : null,
			'amend_action'      => $r->amend_action,
			'source'            => isset( $r->source ) ? (string) $r->source : '',
			'decided_by'        => $r->decided_by ? Dolly_Employees::display_name( (int) $r->decided_by ) : '',
			'decided_at'        => Dolly_Time::iso( $r->decided_at ),
			'decision_note'     => (string) $r->decision_note,
			'created_at'        => Dolly_Time::iso( $r->created_at ),
			'pending_amendment' => $pending_amendment ? array( 'id' => (int) $pending_amendment->id, 'amend_action' => $pending_amendment->amend_action ) : null,
			'summary'           => self::summary( $r ),
		);
	}

	/** Human readable one-line description. */
	public static function summary( $r ) {
		$d1 = Dolly_Time::fmt_date( $r->start_date );
		$d2 = Dolly_Time::fmt_date( $r->end_date );
		$range = $d1 === $d2 ? $d1 : $d1 . ' – ' . $d2;
		switch ( $r->type ) {
			case 'ferie':
				$s = __( 'Ferie ', 'dolly-employee-management' ) . $range;
				break;
			case 'permesso':
				$s = __( 'Permesso ', 'dolly-employee-management' ) . $range . ', ' . Dolly_Time::hm( $r->start_time ) . '–' . Dolly_Time::hm( $r->end_time ) . ' (' . self::leave_code_of( $r ) . ' · ' . Dolly_I18n::t( self::LEAVE_KINDS[ self::leave_kind_of( $r ) ] ) . ')';
				break;
			case 'donazione':
				$s = __( 'Donazione sangue ', 'dolly-employee-management' ) . $d1;
				break;
			case 'straordinario':
				if ( 'rest_day' === $r->extra_kind ) {
					$s = __( 'Straordinario in giorno di riposo ', 'dolly-employee-management' ) . $d1 . ', ' . Dolly_Time::hm( $r->start_time ) . '–' . Dolly_Time::hm( $r->end_time );
					if ( $r->lunch_start ) {
						$s .= __( ' (pausa ', 'dolly-employee-management' ) . Dolly_Time::hm( $r->lunch_start ) . '–' . Dolly_Time::hm( $r->lunch_end ) . ')';
					}
				} else {
					$s = __( 'Straordinario ', 'dolly-employee-management' ) . $d1 . __( ', uscita prolungata fino alle ', 'dolly-employee-management' ) . Dolly_Time::hm( $r->end_time );
				}
				break;
			case 'correzione':
				$s = __( 'Correzione ', 'dolly-employee-management' ) . $d1 . ': ' . ( Dolly_I18n::t( Dolly_Attendance::ACTIONS[ $r->correction_action ] ?? '' ) ) . ' ' . ( $r->start_time ? __( 'alle ', 'dolly-employee-management' ) . Dolly_Time::hm( $r->start_time ) : __( '(da annullare)', 'dolly-employee-management' ) );
				break;
			case 'turno':
				$s = __( 'Turno a chiamata ', 'dolly-employee-management' ) . $d1 . ', ' . Dolly_Time::hm( $r->start_time ) . '–' . Dolly_Time::hm( $r->end_time );
				break;
			default:
				$s = $range;
		}
		if ( 'cancel' === $r->amend_action ) {
			$s = __( 'Annullamento: ', 'dolly-employee-management' ) . $s;
		} elseif ( 'modify' === $r->amend_action ) {
			$s = __( 'Modifica: ', 'dolly-employee-management' ) . $s;
		}
		return $s;
	}

	public static function pending_amendment( $parent_id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'requests' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE parent_id = %d AND status = 'pending' LIMIT 1", $parent_id ) ); // phpcs:ignore
	}

	/**
	 * Validates request input for a user. Returns clean row data or WP_Error.
	 */
	private static function clean( $user_id, $data, $by_admin = false ) {
		$type   = $data['type'] ?? '';
		$errors = array();
		if ( ! isset( self::TYPES[ $type ] ) || 'turno' === $type ) {
			// On-call shifts are created from the punches (sync_oncall_shift), never by hand.
			return new WP_Error( 'dolly_invalid', __( 'Tipo di richiesta non valido.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'type' => __( 'Seleziona il tipo.', 'dolly-employee-management' ) ) ) );
		}
		$out = array(
			'type'              => $type,
			'start_date'        => $data['start_date'] ?? '',
			'end_date'          => $data['end_date'] ?? ( $data['start_date'] ?? '' ),
			'start_time'        => null,
			'end_time'          => null,
			'lunch_start'       => null,
			'lunch_end'         => null,
			'extra_kind'        => null,
			'correction_action' => null,
			'leave_kind'        => null,
			'hours_code'        => null,
			'notes'             => sanitize_textarea_field( $data['notes'] ?? '' ),
		);
		if ( ! Dolly_Time::is_date( $out['start_date'] ) ) {
			$errors['start_date'] = __( 'Data non valida.', 'dolly-employee-management' );
		}
		if ( in_array( $type, array( 'straordinario', 'correzione', 'donazione' ), true ) ) {
			$out['end_date'] = $out['start_date'];
		} elseif ( ! Dolly_Time::is_date( $out['end_date'] ) ) {
			$errors['end_date'] = __( 'Data non valida.', 'dolly-employee-management' );
		} elseif ( empty( $errors['start_date'] ) && $out['end_date'] < $out['start_date'] ) {
			$errors['end_date'] = __( 'La data di fine deve essere uguale o successiva all\'inizio.', 'dolly-employee-management' );
		}
		if ( empty( $errors ) && ( strtotime( $out['end_date'] ) - strtotime( $out['start_date'] ) ) > 366 * DAY_IN_SECONDS ) {
			$errors['end_date'] = __( 'Intervallo troppo lungo.', 'dolly-employee-management' );
		}

		$time = function ( $key, $label ) use ( &$errors, $data ) {
			$v = $data[ $key ] ?? '';
			if ( ! Dolly_Time::is_time( $v ) ) {
				$errors[ $key ] = $label . __( ' non valido.', 'dolly-employee-management' );
				return null;
			}
			return $v . ':00';
		};

		switch ( $type ) {
			case 'permesso':
				$out['start_time'] = $time( 'start_time', __( 'Orario di inizio', 'dolly-employee-management' ) );
				$out['end_time']   = $time( 'end_time', __( 'Orario di fine', 'dolly-employee-management' ) );
				if ( $out['start_time'] && $out['end_time'] && $out['end_time'] <= $out['start_time'] ) {
					$errors['end_time'] = __( 'L\'orario di fine deve essere successivo all\'inizio.', 'dolly-employee-management' );
				}
				$kind = (string) ( $data['leave_kind'] ?? '' );
				if ( ! isset( self::LEAVE_KINDS[ $kind ] ) ) {
					$errors['leave_kind'] = __( 'Scegli il tipo di permesso.', 'dolly-employee-management' );
					break;
				}
				$out['leave_kind'] = $kind;
				// The employee only declares a Law 104 leave; the other codes (ROL, ex festività) are set by the administrator.
				$code = 'evento' === $kind && ! empty( $data['law104'] ) ? 'PL' : self::LEAVE_CODES[ $kind ][0];
				if ( $by_admin && isset( $data['hours_code'] ) && in_array( $data['hours_code'], self::LEAVE_CODES[ $kind ], true ) ) {
					$code = $data['hours_code'];
				}
				$out['hours_code'] = $code;
				if ( 'evento' === $kind && '' === $out['notes'] ) {
					$errors['notes'] = __( 'Indica l\'evento per cui chiedi il permesso.', 'dolly-employee-management' );
				}
				break;

			case 'donazione':
				$out['hours_code'] = 'Av';
				break;

			case 'straordinario':
				$kind              = ( $data['extra_kind'] ?? 'working_day' ) === 'rest_day' ? 'rest_day' : 'working_day';
				$out['extra_kind'] = $kind;
				if ( empty( $errors['start_date'] ) ) {
					$plan = Dolly_Schedules::for_date( $user_id, $out['start_date'] );
					$wd   = Dolly_Time::weekday( $out['start_date'] );
					$is_working = $plan && ! Dolly_Schedules::is_on_call( $plan ) && in_array( $wd, Dolly_Schedules::weekdays( $plan ), true );
					$day_end    = $is_working ? Dolly_Schedules::times_for( $plan, $wd )['end'] : null;
					if ( 'working_day' === $kind ) {
						if ( ! $is_working ) {
							$errors['extra_kind'] = __( 'La data non è un giorno lavorativo: scegli "Giorno di riposo".', 'dolly-employee-management' );
						}
						$out['end_time'] = $time( 'end_time', __( 'Orario di fine prolungato', 'dolly-employee-management' ) );
						if ( $is_working && $out['end_time'] && $out['end_time'] <= $day_end . ':00' ) {
							$errors['end_time'] = __( 'L\'orario deve essere successivo alla fine turno (', 'dolly-employee-management' ) . $day_end . ').';
						}
					} else {
						if ( $is_working ) {
							$errors['extra_kind'] = __( 'La data è un giorno lavorativo: scegli "Giorno lavorativo".', 'dolly-employee-management' );
						}
						$out['start_time'] = $time( 'start_time', __( 'Orario di inizio', 'dolly-employee-management' ) );
						$out['end_time']   = $time( 'end_time', __( 'Orario di fine', 'dolly-employee-management' ) );
						if ( $out['start_time'] && $out['end_time'] && $out['end_time'] <= $out['start_time'] ) {
							$errors['end_time'] = __( 'L\'orario di fine deve essere successivo all\'inizio.', 'dolly-employee-management' );
						}
						if ( ! empty( $data['has_lunch'] ) ) {
							$out['lunch_start'] = $time( 'lunch_start', __( 'Inizio pausa', 'dolly-employee-management' ) );
							$out['lunch_end']   = $time( 'lunch_end', __( 'Fine pausa', 'dolly-employee-management' ) );
							if ( $out['lunch_start'] && $out['lunch_end'] && $out['start_time'] && $out['end_time'] ) {
								if ( $out['lunch_end'] <= $out['lunch_start'] ) {
									$errors['lunch_end'] = __( 'La fine pausa deve essere successiva all\'inizio pausa.', 'dolly-employee-management' );
								} elseif ( $out['lunch_start'] <= $out['start_time'] || $out['lunch_end'] >= $out['end_time'] ) {
									$errors['lunch_start'] = __( 'La pausa deve essere compresa nell\'orario.', 'dolly-employee-management' );
								}
							}
						}
					}
				}
				break;

			case 'correzione':
				$action = $data['correction_action'] ?? '';
				if ( ! isset( Dolly_Attendance::ACTIONS[ $action ] ) ) {
					$errors['correction_action'] = __( 'Seleziona la timbratura da correggere.', 'dolly-employee-management' );
				}
				$out['correction_action'] = $action;
				$out['start_time']        = $time( 'start_time', __( 'Orario corretto', 'dolly-employee-management' ) );
				if ( empty( $errors['start_date'] ) && $out['start_date'] > Dolly_Time::today() ) {
					$errors['start_date'] = __( 'Non puoi correggere una data futura.', 'dolly-employee-management' );
				}
				if ( '' === $out['notes'] ) {
					$errors['notes'] = __( 'Spiega il motivo della correzione.', 'dolly-employee-management' );
				}
				break;
		}

		if ( $errors ) {
			return new WP_Error( 'dolly_invalid', __( 'Controlla i campi evidenziati.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => $errors ) );
		}
		return $out;
	}

	/**
	 * Conflicting pending/approved absences (vacation, hourly leave, sickness) for the interval.
	 */
	public static function find_conflict( $user_id, $clean, array $exclude_ids = array() ) {
		global $wpdb;
		if ( ! in_array( $clean['type'], array( 'ferie', 'permesso', 'donazione' ), true ) ) {
			return null;
		}
		$t       = Dolly_Install::t( 'requests' );
		$exclude = $exclude_ids ? ' AND id NOT IN (' . implode( ',', array_map( 'intval', $exclude_ids ) ) . ')' : '';
		$rows    = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM $t WHERE user_id = %d AND type IN ('ferie','permesso','donazione') AND status IN ('pending','approved') AND " . self::EFFECTIVE_ROW . " AND start_date <= %s AND end_date >= %s $exclude", // phpcs:ignore
				$user_id,
				$clean['end_date'],
				$clean['start_date']
			)
		);
		foreach ( $rows as $r ) {
			// Two hourly leaves only conflict when their times overlap.
			if ( 'permesso' === $r->type && 'permesso' === $clean['type'] && ( $clean['end_time'] <= $r->start_time || $clean['start_time'] >= $r->end_time ) ) {
				continue;
			}
			// A pending amendment's parent is being replaced, but stays in force until approved: still a conflict source
			// only if it isn't the parent of this request (handled via $exclude_ids).
			return sprintf( __( 'Esiste già una richiesta %s: %s.', 'dolly-employee-management' ), 'pending' === $r->status ? __( 'in attesa', 'dolly-employee-management' ) : 'approvata', self::summary( $r ) );
		}
		$s   = Dolly_Install::t( 'sickness' );
		$sick = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $s WHERE user_id = %d AND status = 'active' AND start_date <= %s AND end_date >= %s LIMIT 1", $user_id, $clean['end_date'], $clean['start_date'] ) ); // phpcs:ignore
		if ( $sick ) {
			return sprintf( __( 'Nel periodo risulta %s (%s – %s).', 'dolly-employee-management' ), 'infortunio' === Dolly_Sickness::kind_of( $sick ) ? __( 'un infortunio', 'dolly-employee-management' ) : __( 'una malattia', 'dolly-employee-management' ), Dolly_Time::fmt_date( $sick->start_date ), Dolly_Time::fmt_date( $sick->end_date ) );
		}
		return null;
	}

	private static function lock( $user_id ) {
		global $wpdb;
		return (bool) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 5)', $wpdb->prefix . 'dolly_req_' . (int) $user_id ) );
	}

	private static function unlock( $user_id ) {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $wpdb->prefix . 'dolly_req_' . (int) $user_id ) );
	}

	/**
	 * Creates a request. Administrators may create extra-work authorisations already approved.
	 */
	public static function create( $user_id, $data, $admin_approved = false ) {
		global $wpdb;
		$clean = self::clean( $user_id, $data, $admin_approved );
		if ( is_wp_error( $clean ) ) {
			return $clean;
		}
		if ( ! self::lock( $user_id ) ) {
			return new WP_Error( 'dolly_busy', __( 'Un\'altra richiesta è in corso di invio. Riprova.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		try {
			$conflict = self::find_conflict( $user_id, $clean );
			if ( $conflict ) {
				return new WP_Error( 'dolly_conflict', $conflict, array( 'status' => 409 ) );
			}
			if ( 'straordinario' === $clean['type'] ) {
				$dup = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . Dolly_Install::t( 'requests' ) . " WHERE user_id = %d AND type = 'straordinario' AND status IN ('pending','approved') AND " . self::EFFECTIVE_ROW . ' AND start_date = %s LIMIT 1', $user_id, $clean['start_date'] ) ); // phpcs:ignore
				if ( $dup ) {
					return new WP_Error( 'dolly_conflict', __( 'Esiste già una richiesta di straordinario per questa data. Modificala invece di crearne una nuova.', 'dolly-employee-management' ), array( 'status' => 409 ) );
				}
			}
			$now = Dolly_Time::now_utc();
			$row = array_merge(
				$clean,
				array(
					'user_id'    => $user_id,
					'status'     => $admin_approved ? 'approved' : 'pending',
					'created_by' => get_current_user_id(),
					'created_at' => $now,
					'updated_at' => $now,
				)
			);
			if ( $admin_approved ) {
				$row['decided_by']    = get_current_user_id();
				$row['decided_at']    = $now;
				$row['decision_note'] = sanitize_textarea_field( $data['decision_note'] ?? '' );
			}
			$wpdb->insert( Dolly_Install::t( 'requests' ), $row );
			$id = (int) $wpdb->insert_id;
		} finally {
			self::unlock( $user_id );
		}
		$r = self::get( $id );
		if ( $admin_approved ) {
			$titles = array(
				'ferie'         => __( 'Ferie autorizzate dall\'amministratore', 'dolly-employee-management' ),
				'permesso'      => __( 'Permesso autorizzato dall\'amministratore', 'dolly-employee-management' ),
				'straordinario' => __( 'Straordinario autorizzato', 'dolly-employee-management' ),
				'donazione'     => __( 'Donazione sangue autorizzata dall\'amministratore', 'dolly-employee-management' ),
				'correzione'    => __( 'Correzione registrata dall\'amministratore', 'dolly-employee-management' ),
			);
			Dolly_Audit::log( 'request_created_admin', 'request', $id, $user_id, $row['decision_note'], null, self::format( $r ) );
			self::after_approval( $r );
			Dolly_Notifications::notify_user( $user_id, 'request_decided', fn () => array( $titles[ $r->type ] ?? __( 'Richiesta autorizzata', 'dolly-employee-management' ), self::summary( $r ) . ( $row['decision_note'] ? __( "\nNota: ", 'dolly-employee-management' ) . $row['decision_note'] : '' ) ), null, 'richieste' );
		} else {
			Dolly_Notifications::notify_admins( 'request_submitted', fn () => array( __( 'Nuova richiesta da ', 'dolly-employee-management' ) . Dolly_Employees::display_name( $user_id ), self::summary( $r ) ), null, 'dolly-requests', 'request-' . $id );
		}
		return self::format( $r );
	}

	/**
	 * Employee edit: pending requests are edited in place; approved ones generate a modification amendment.
	 */
	public static function update( $user_id, $id, $data ) {
		global $wpdb;
		$r = self::get( $id );
		if ( ! $r || (int) $r->user_id !== (int) $user_id ) {
			return new WP_Error( 'dolly_not_found', __( 'Richiesta non trovata.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$data['type'] = $r->type;
		$clean        = self::clean( $user_id, $data );
		if ( is_wp_error( $clean ) ) {
			return $clean;
		}
		// A paid leave keeps the justification code chosen by the administrator (ROL, ex festività) when the
		// employee edits dates or times without changing the kind of leave.
		if ( 'permesso' === $r->type && 'retribuito' === $clean['leave_kind'] && 'retribuito' === self::leave_kind_of( $r ) ) {
			$clean['hours_code'] = self::leave_code_of( $r );
		}
		if ( ! self::lock( $user_id ) ) {
			return new WP_Error( 'dolly_busy', __( 'Operazione in corso. Riprova.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		try {
			if ( 'pending' === $r->status && 'cancel' === $r->amend_action ) {
				return new WP_Error( 'dolly_invalid_state', __( 'Una richiesta di annullamento non si modifica: eliminala e, se serve, inviane una nuova.', 'dolly-employee-management' ), array( 'status' => 409 ) );
			}
			if ( 'pending' === $r->status ) {
				$exclude = array( (int) $r->id );
				if ( $r->parent_id ) {
					$exclude[] = (int) $r->parent_id;
				}
				$conflict = self::find_conflict( $user_id, $clean, $exclude );
				if ( $conflict ) {
					return new WP_Error( 'dolly_conflict', $conflict, array( 'status' => 409 ) );
				}
				$clean['updated_at'] = Dolly_Time::now_utc();
				$wpdb->update( Dolly_Install::t( 'requests' ), $clean, array( 'id' => $id ) );
				return self::format( self::get( $id ) );
			}
			if ( 'approved' !== $r->status || 'cancel' === $r->amend_action || 'correzione' === $r->type ) {
				return new WP_Error( 'dolly_invalid_state', __( 'Solo le richieste in attesa o approvate possono essere modificate.', 'dolly-employee-management' ), array( 'status' => 409 ) );
			}
			if ( self::pending_amendment( (int) $r->id ) ) {
				return new WP_Error( 'dolly_conflict', __( 'Esiste già una modifica o un annullamento in attesa per questa richiesta.', 'dolly-employee-management' ), array( 'status' => 409 ) );
			}
			$conflict = self::find_conflict( $user_id, $clean, array( (int) $r->id ) );
			if ( $conflict ) {
				return new WP_Error( 'dolly_conflict', $conflict, array( 'status' => 409 ) );
			}
			$now = Dolly_Time::now_utc();
			$wpdb->insert(
				Dolly_Install::t( 'requests' ),
				array_merge(
					$clean,
					array(
						'user_id'      => $user_id,
						'status'       => 'pending',
						'parent_id'    => (int) $r->id,
						'amend_action' => 'modify',
						'created_by'   => get_current_user_id(),
						'created_at'   => $now,
						'updated_at'   => $now,
					)
				)
			);
			$new_id = (int) $wpdb->insert_id;
		} finally {
			self::unlock( $user_id );
		}
		$n = self::get( $new_id );
		Dolly_Notifications::notify_admins( 'request_submitted', fn () => array( __( 'Richiesta di modifica da ', 'dolly-employee-management' ) . Dolly_Employees::display_name( $user_id ), self::summary( $n ) ), null, 'dolly-requests', 'request-' . $new_id );
		return self::format( $n );
	}

	/**
	 * Employee delete: pending requests become cancelled (kept in history);
	 * approved ones generate a cancellation amendment requiring approval.
	 */
	public static function cancel( $user_id, $id ) {
		global $wpdb;
		$r = self::get( $id );
		if ( ! $r || (int) $r->user_id !== (int) $user_id ) {
			return new WP_Error( 'dolly_not_found', __( 'Richiesta non trovata.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$t = Dolly_Install::t( 'requests' );
		if ( 'turno' === $r->type ) {
			return new WP_Error( 'dolly_invalid_state', __( 'I turni a chiamata vengono approvati dall\'amministratore: per correggerli invia una richiesta di correzione timbratura.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		if ( 'pending' === $r->status ) {
			$wpdb->update( $t, array( 'status' => 'cancelled', 'updated_at' => Dolly_Time::now_utc() ), array( 'id' => $id, 'status' => 'pending' ) );
			return self::format( self::get( $id ) );
		}
		if ( 'approved' !== $r->status || 'cancel' === $r->amend_action || 'correzione' === $r->type ) {
			return new WP_Error( 'dolly_invalid_state', __( 'Questa richiesta non può essere annullata.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		if ( ! self::lock( $user_id ) ) {
			return new WP_Error( 'dolly_busy', __( 'Operazione in corso. Riprova.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		try {
			if ( self::pending_amendment( (int) $r->id ) ) {
				return new WP_Error( 'dolly_conflict', __( 'Esiste già una modifica o un annullamento in attesa per questa richiesta.', 'dolly-employee-management' ), array( 'status' => 409 ) );
			}
			$now = Dolly_Time::now_utc();
			$wpdb->insert(
				$t,
				array(
					'user_id'           => $user_id,
					'type'              => $r->type,
					'status'            => 'pending',
					'start_date'        => $r->start_date,
					'end_date'          => $r->end_date,
					'start_time'        => $r->start_time,
					'end_time'          => $r->end_time,
					'lunch_start'       => $r->lunch_start,
					'lunch_end'         => $r->lunch_end,
					'extra_kind'        => $r->extra_kind,
					'correction_action' => $r->correction_action,
					'leave_kind'        => $r->leave_kind,
					'hours_code'        => $r->hours_code,
					'notes'             => $r->notes,
					'parent_id'         => (int) $r->id,
					'amend_action'      => 'cancel',
					'created_by'        => get_current_user_id(),
					'created_at'        => $now,
					'updated_at'        => $now,
				)
			);
			$new_id = (int) $wpdb->insert_id;
		} finally {
			self::unlock( $user_id );
		}
		$n = self::get( $new_id );
		Dolly_Notifications::notify_admins( 'request_submitted', fn () => array( __( 'Richiesta di annullamento da ', 'dolly-employee-management' ) . Dolly_Employees::display_name( $user_id ), self::summary( $n ) ), null, 'dolly-requests', 'request-' . $new_id );
		return self::format( $n );
	}

	/**
	 * Administrator decision.
	 */
	public static function decide( $id, $decision, $note = '', $hours_code = '' ) {
		global $wpdb;
		$r = self::get( $id );
		if ( ! $r ) {
			return new WP_Error( 'dolly_not_found', __( 'Richiesta non trovata.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		if ( 'pending' !== $r->status ) {
			return new WP_Error( 'dolly_invalid_state', __( 'La richiesta è già stata gestita.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		if ( ! in_array( $decision, array( 'approve', 'reject' ), true ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Decisione non valida.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		$note = sanitize_textarea_field( $note );
		$t    = Dolly_Install::t( 'requests' );
		$uid  = (int) $r->user_id;
		if ( ! self::lock( $uid ) ) {
			return new WP_Error( 'dolly_busy', __( 'Operazione in corso. Riprova.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		try {
			$now = Dolly_Time::now_utc();
			if ( 'approve' === $decision ) {
				if ( 'cancel' !== $r->amend_action ) {
					$exclude = array( (int) $r->id );
					if ( $r->parent_id ) {
						$exclude[] = (int) $r->parent_id;
					}
					$conflict = self::find_conflict( $uid, (array) $r, $exclude );
					if ( $conflict ) {
						return new WP_Error( 'dolly_conflict', __( 'Impossibile approvare: ', 'dolly-employee-management' ) . $conflict, array( 'status' => 409 ) );
					}
				}
				if ( 'correzione' === $r->type && ! $r->amend_action ) {
					$applied = Dolly_Attendance::correct( $uid, $r->start_date, $r->correction_action, Dolly_Time::hm( $r->start_time ), __( 'Richiesta di correzione del dipendente: ', 'dolly-employee-management' ) . $r->notes . ( $note ? ' — ' . $note : '' ), 0, (int) $r->id );
					if ( is_wp_error( $applied ) ) {
						return $applied;
					}
				}
				$approved = array( 'status' => 'approved', 'decided_by' => get_current_user_id(), 'decided_at' => $now, 'decision_note' => $note, 'updated_at' => $now );
				// Hourly leave: the administrator may choose the justification code (e.g. ROL or ex festività instead of P).
				if ( 'permesso' === $r->type ) {
					$approved['leave_kind'] = self::leave_kind_of( $r );
					$approved['hours_code'] = in_array( $hours_code, self::LEAVE_CODES[ $approved['leave_kind'] ], true ) ? $hours_code : self::leave_code_of( $r );
				}
				$wpdb->update( $t, $approved, array( 'id' => $id ) );
				if ( $r->parent_id ) {
					$wpdb->update(
						$t,
						array(
							'status'     => 'cancel' === $r->amend_action ? 'cancelled' : 'superseded',
							'updated_at' => $now,
						),
						array( 'id' => (int) $r->parent_id )
					);
				}
			} else {
				$wpdb->update( $t, array( 'status' => 'rejected', 'decided_by' => get_current_user_id(), 'decided_at' => $now, 'decision_note' => $note, 'updated_at' => $now ), array( 'id' => $id ) );
			}
		} finally {
			self::unlock( $uid );
		}
		$after = self::get( $id );
		Dolly_Audit::log( 'approve' === $decision ? 'request_approved' : 'request_rejected', 'request', $id, $uid, $note, array( 'status' => 'pending' ), array( 'status' => $after->status, 'summary' => self::summary( $after ) ) );
		if ( 'approve' === $decision ) {
			self::after_approval( $after );
		}
		Dolly_Notifications::notify_user(
			$uid,
			'request_decided', fn () => array( 'approve' === $decision ? __( 'Richiesta approvata', 'dolly-employee-management' ) : __( 'Richiesta respinta', 'dolly-employee-management' ), self::summary( $after ) . ( $note ? __( "\nNota: ", 'dolly-employee-management' ) . $note : '' ) ), null,
			'richieste'
		);
		return self::format( $after );
	}

	/** Side effects when an authorisation becomes effective. */
	private static function after_approval( $r ) {
		if ( 'straordinario' === $r->type ) {
			// The approved overtime limit moved (also when an authorisation is cancelled): re-evaluate the day.
			Dolly_Anomalies::evaluate_exit( (int) $r->user_id, $r->start_date, 'cancel' !== $r->amend_action );
		} elseif ( 'cancel' !== $r->amend_action && in_array( $r->type, array( 'ferie', 'permesso', 'donazione' ), true ) ) {
			Dolly_Anomalies::resolve_absence( (int) $r->user_id, $r->start_date, $r->end_date, 'justified', __( 'Giustificata: ', 'dolly-employee-management' ) . self::summary( $r ) . '.' );
		}
		if ( Dolly_Donations::TYPE === $r->type ) {
			if ( 'cancel' === $r->amend_action ) {
				Dolly_Donations::on_cancelled( (int) $r->parent_id );
			} else {
				Dolly_Donations::on_approved( $r );
			}
		}
		Dolly_Hours::touch( (int) $r->user_id, $r->start_date, $r->end_date );
		if ( $r->parent_id ) {
			$parent = self::get( (int) $r->parent_id );
			if ( $parent ) {
				Dolly_Hours::touch( (int) $parent->user_id, $parent->start_date, $parent->end_date );
			}
		}
	}

	/**
	 * The employer revokes an approved vacation, hourly leave or blood donation (every request stays
	 * subject to verification, also after the approval). The row is kept as "Annullata" with the reason.
	 */
	public static function revoke( $id, $note ) {
		global $wpdb;
		$r = self::get( $id );
		if ( ! $r ) {
			return new WP_Error( 'dolly_not_found', __( 'Richiesta non trovata.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		if ( 'approved' !== $r->status || ( $r->amend_action && 'modify' !== $r->amend_action ) || ! in_array( $r->type, array( 'ferie', 'permesso', 'donazione' ), true ) ) {
			return new WP_Error( 'dolly_invalid_state', __( 'Si possono revocare solo ferie, permessi e donazioni approvati.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		$note = sanitize_textarea_field( $note );
		if ( '' === $note ) {
			return new WP_Error( 'dolly_invalid', __( 'Indica il motivo della revoca.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'note' => __( 'Indica il motivo della revoca.', 'dolly-employee-management' ) ) ) );
		}
		$t   = Dolly_Install::t( 'requests' );
		$uid = (int) $r->user_id;
		$now = Dolly_Time::now_utc();
		$ok  = $wpdb->update( $t, array( 'status' => 'cancelled', 'decided_by' => get_current_user_id(), 'decided_at' => $now, 'decision_note' => __( 'Revocata dal datore di lavoro: ', 'dolly-employee-management' ) . $note, 'updated_at' => $now ), array( 'id' => $id, 'status' => 'approved' ) );
		if ( ! $ok ) {
			return new WP_Error( 'dolly_invalid_state', __( 'La richiesta è già stata gestita.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		// A modification or cancellation still waiting for a decision has nothing left to change.
		$wpdb->query( $wpdb->prepare( "UPDATE $t SET status = 'cancelled', updated_at = %s WHERE parent_id = %d AND status = 'pending'", $now, $id ) ); // phpcs:ignore
		if ( Dolly_Donations::TYPE === $r->type ) {
			Dolly_Donations::on_cancelled( $id );
		}
		Dolly_Hours::touch( $uid, $r->start_date, $r->end_date );
		$after = self::get( $id );
		Dolly_Audit::log( 'request_revoked', 'request', $id, $uid, $note, array( 'status' => 'approved' ), array( 'status' => 'cancelled', 'summary' => self::summary( $after ) ) );
		Dolly_Notifications::notify_user( $uid, 'request_decided', fn () => array( __( 'Richiesta revocata', 'dolly-employee-management' ), self::summary( $after ) . __( "\nMotivo: ", 'dolly-employee-management' ) . $note ), null, 'richieste' );
		return self::format( $after );
	}

	/** On-call shift approvals of a user over a range: [Y-m-d => row] (latest row per day). */
	public static function oncall_range( $user_id, $from, $to ) {
		global $wpdb;
		$t    = Dolly_Install::t( 'requests' );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND type = 'turno' AND status IN ('pending','approved','rejected') AND start_date BETWEEN %s AND %s ORDER BY id ASC", $user_id, $from, $to ) ); // phpcs:ignore
		$out  = array();
		foreach ( $rows as $r ) {
			$out[ $r->start_date ] = $r;
		}
		return $out;
	}

	/**
	 * On-call contracts: every completed shift (entry + exit) needs an approval, created here from the
	 * punches. Shifts up to the configured length are approved automatically when the option is on;
	 * the others wait for the administrator. Corrections of the punches update the times, and a pending
	 * approval is withdrawn if the shift is no longer complete.
	 */
	public static function sync_oncall_shift( $user_id, $date ) {
		global $wpdb;
		$plan = Dolly_Schedules::day_plan( $user_id, $date );
		if ( empty( $plan['on_call'] ) ) {
			return;
		}
		$t   = Dolly_Install::t( 'requests' );
		$p   = Dolly_Attendance::punches_for( $user_id, $date );
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND type = 'turno' AND start_date = %s AND status IN ('pending','approved','rejected') ORDER BY id DESC LIMIT 1", $user_id, $date ) ); // phpcs:ignore
		$now = Dolly_Time::now_utc();
		if ( ! isset( $p['entrata'], $p['uscita'] ) ) {
			if ( $row && 'pending' === $row->status ) {
				$wpdb->update( $t, array( 'status' => 'cancelled', 'decision_note' => __( 'Turno non più completo (timbrature modificate).', 'dolly-employee-management' ), 'updated_at' => $now ), array( 'id' => (int) $row->id ) );
			}
			return;
		}
		$in        = Dolly_Time::utc_to_local( $p['entrata']->punched_at, 'H:i' );
		$out       = Dolly_Time::utc_to_local( $p['uscita']->punched_at, 'H:i' );
		$worked    = Dolly_Attendance::compute( $date, $p, $plan )['worked'];
		$threshold = (int) Dolly_Settings::get( 'oncall_threshold' );
		$auto      = Dolly_Settings::get( 'oncall_auto' ) && $worked <= $threshold;
		$notes     = sprintf( __( 'Turno a chiamata %s–%s: %s ore lavorate.', 'dolly-employee-management' ), $in, $out, Dolly_Time::min_to_hm( $worked ) );
		$auto_note = sprintf( __( 'Approvato automaticamente: turno entro %s ore.', 'dolly-employee-management' ), Dolly_Time::min_to_hm( $threshold ) );

		if ( $row ) {
			if ( Dolly_Time::hm( $row->start_time ) === $in && Dolly_Time::hm( $row->end_time ) === $out ) {
				return;
			}
			$upd = array( 'start_time' => $in . ':00', 'end_time' => $out . ':00', 'notes' => $notes, 'updated_at' => $now );
			if ( 'pending' === $row->status && $auto ) {
				$upd = array_merge( $upd, array( 'status' => 'approved', 'decided_by' => 0, 'decided_at' => $now, 'decision_note' => $auto_note ) );
			}
			$wpdb->update( $t, $upd, array( 'id' => (int) $row->id ) );
			return;
		}

		$data = array(
			'user_id'    => $user_id,
			'type'       => 'turno',
			'status'     => $auto ? 'approved' : 'pending',
			'start_date' => $date,
			'end_date'   => $date,
			'start_time' => $in . ':00',
			'end_time'   => $out . ':00',
			'source'     => 'auto',
			'notes'      => $notes,
			'created_by' => 0,
			'created_at' => $now,
			'updated_at' => $now,
		);
		if ( $auto ) {
			$data['decided_by']    = 0;
			$data['decided_at']    = $now;
			$data['decision_note'] = $auto_note;
		}
		$wpdb->insert( $t, $data );
		$id = (int) $wpdb->insert_id;
		if ( $auto ) {
			Dolly_Audit::log( 'oncall_auto_approved', 'request', $id, $user_id, $auto_note, null, array( 'shift' => $in . '–' . $out, 'worked' => Dolly_Time::min_to_hm( $worked ) ), 0 );
		} else {
			Dolly_Notifications::notify_admins( 'oncall_pending', fn () => array( __( 'Turno a chiamata da approvare: ', 'dolly-employee-management' ) . Dolly_Employees::display_name( $user_id ), Dolly_Time::fmt_date( $date ) . ': ' . $notes ), null, 'dolly-requests', 'oncall-' . $id );
		}
	}

	/**
	 * Overtime beyond the automatic daily limit (setting "overtime_auto") must be approved by the
	 * administrator afterwards: keeps one pending extra-work request (source "auto") in line with the
	 * counted exit of the day. It is created when the exit goes beyond the approved limit, updated when
	 * the exit is corrected, and withdrawn when it is no longer needed. Never modifies punches.
	 */
	public static function sync_auto_overtime( $user_id, $date ) {
		global $wpdb;
		$t    = Dolly_Install::t( 'requests' );
		$auto = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND type = 'straordinario' AND status = 'pending' AND source = 'auto' AND start_date = %s LIMIT 1", $user_id, $date ) ); // phpcs:ignore

		$punches = Dolly_Attendance::punches_for( $user_id, $date );
		$plan    = Dolly_Schedules::day_plan( $user_id, $date );
		$exit_hm = '';
		$over    = 0;
		$cap     = max( 0, (int) Dolly_Settings::get( 'overtime_auto' ) );
		if ( isset( $punches['entrata'], $punches['uscita'] ) && $plan['scheduled'] && $plan['end'] ) {
			$eff   = Dolly_Attendance::effective_times( $date, $punches, $plan );
			$end   = Dolly_Time::local_ts( $date, $plan['end'] );
			$limit = $end + $cap * 60;
			if ( $plan['extension_end'] ) {
				$limit = max( $limit, Dolly_Time::local_ts( $date, $plan['extension_end'] ) );
			}
			if ( $eff['uscita'] > $limit ) {
				$exit_hm = Dolly_Time::ts_to_hm( $eff['uscita'] );
				$over    = intdiv( $eff['uscita'] - $end, 60 );
			}
		}

		$now = Dolly_Time::now_utc();
		if ( '' === $exit_hm ) {
			if ( $auto ) {
				$wpdb->update( $t, array( 'status' => 'cancelled', 'decision_note' => __( 'Non più necessaria: uscita entro il limite dello straordinario approvato.', 'dolly-employee-management' ), 'updated_at' => $now ), array( 'id' => (int) $auto->id, 'status' => 'pending' ) );
			}
			return;
		}
		if ( $auto ) {
			if ( Dolly_Time::hm( $auto->end_time ) !== $exit_hm ) {
				$wpdb->update( $t, array( 'end_time' => $exit_hm . ':00', 'updated_at' => $now ), array( 'id' => (int) $auto->id ) );
			}
			return;
		}
		// A pending request of the employee for the same day is decided as it is; an automatic request
		// the administrator already rejected (or the employee withdrew) for this exit is not recreated.
		$pending = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $t WHERE user_id = %d AND type = 'straordinario' AND status = 'pending' AND start_date = %s LIMIT 1", $user_id, $date ) ); // phpcs:ignore
		$decided = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $t WHERE user_id = %d AND type = 'straordinario' AND source = 'auto' AND status IN ('rejected','cancelled') AND start_date = %s AND end_time = %s LIMIT 1", $user_id, $date, $exit_hm . ':00' ) ); // phpcs:ignore
		if ( $pending || $decided ) {
			return;
		}
		if ( ! self::lock( $user_id ) ) {
			return; // Evaluated again at the next punch or correction.
		}
		try {
			$approved = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND type = 'straordinario' AND status = 'approved' AND " . self::EFFECTIVE_ROW . ' AND start_date = %s LIMIT 1', $user_id, $date ) ); // phpcs:ignore
			if ( $approved && self::pending_amendment( (int) $approved->id ) ) {
				return;
			}
			$row = array(
				'user_id'      => $user_id,
				'type'         => 'straordinario',
				'status'       => 'pending',
				'start_date'   => $date,
				'end_date'     => $date,
				'end_time'     => $exit_hm . ':00',
				'extra_kind'   => 'working_day',
				'source'       => 'auto',
				'notes'        => sprintf( 'Rilevato automaticamente: uscita alle %s, %s oltre la fine turno delle %s. Lo straordinario è approvato automaticamente fino a %s al giorno.', $exit_hm, Dolly_Time::min_to_hm( $over ), $plan['end'], Dolly_Time::min_to_hm( $cap ) ),
				'created_by'   => 0,
				'created_at'   => $now,
				'updated_at'   => $now,
			);
			if ( $approved ) {
				$row['parent_id']    = (int) $approved->id;
				$row['amend_action'] = 'modify';
			}
			$wpdb->insert( $t, $row );
			$id = (int) $wpdb->insert_id;
		} finally {
			self::unlock( $user_id );
		}
		if ( ! $id ) {
			return;
		}
		$name = Dolly_Employees::display_name( $user_id );
		$body = sprintf( '%s: uscita alle %s, %s di straordinario (oltre il limite automatico di %s).', Dolly_Time::fmt_date( $date ), $exit_hm, Dolly_Time::min_to_hm( $over ), Dolly_Time::min_to_hm( $cap ) );
		Dolly_Notifications::notify_admins( 'overtime_pending', fn () => array( __( 'Straordinario da approvare: ', 'dolly-employee-management' ) . $name, $body ), null, 'dolly-requests', 'overtime-' . $id );
		Dolly_Notifications::notify_user( $user_id, 'overtime_pending', fn () => array( __( 'Straordinario in attesa di approvazione', 'dolly-employee-management' ), $body . __( "\nLa parte oltre il limite sarà conteggiata dopo l'approvazione dell'amministratore.", 'dolly-employee-management' ) ), null, 'richieste', 'overtime-' . $id );
	}

	/* ---------- Effective data used by attendance, calendars and reports ---------- */

	public static function approved_extra_for( $user_id, $date ) {
		global $wpdb;
		$t = Dolly_Install::t( 'requests' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND type = 'straordinario' AND status = 'approved' AND " . self::EFFECTIVE_ROW . ' AND start_date = %s', $user_id, $date ) ); // phpcs:ignore
	}

	public static function full_day_leave( $user_id, $date ) {
		global $wpdb;
		$t = Dolly_Install::t( 'requests' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND type IN ('ferie','donazione') AND status = 'approved' AND " . self::EFFECTIVE_ROW . ' AND start_date <= %s AND end_date >= %s LIMIT 1', $user_id, $date, $date ) ); // phpcs:ignore
	}

	public static function hourly_leaves( $user_id, $date ) {
		global $wpdb;
		$t = Dolly_Install::t( 'requests' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND type = 'permesso' AND status = 'approved' AND " . self::EFFECTIVE_ROW . ' AND start_date <= %s AND end_date >= %s', $user_id, $date, $date ) ); // phpcs:ignore
	}

	/** Approved effective requests of given types for many users overlapping a range. */
	public static function approved_range( array $user_ids, $from, $to, array $types = array( 'ferie', 'permesso', 'straordinario', 'donazione' ) ) {
		global $wpdb;
		if ( ! $user_ids ) {
			return array();
		}
		$t     = Dolly_Install::t( 'requests' );
		$in    = implode( ',', array_map( 'intval', $user_ids ) );
		$types = "'" . implode( "','", array_map( 'esc_sql', $types ) ) . "'";
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id IN ($in) AND type IN ($types) AND status = 'approved' AND " . self::EFFECTIVE_ROW . ' AND start_date <= %s AND end_date >= %s ORDER BY start_date', $to, $from ) ); // phpcs:ignore
	}

	/**
	 * Paginated list.
	 *
	 * @param array $args user_id, status, type, workplace, page, per_page,
	 *                    order: '' (newest first) | 'pending_first' | 'name' (surname, then pending first, newest)
	 */
	public static function query( $args ) {
		global $wpdb;
		$t      = Dolly_Install::t( 'requests' );
		$where  = array( '1=1' );
		$params = array();
		if ( ! empty( $args['user_id'] ) ) {
			$where[]  = 'r.user_id = %d';
			$params[] = (int) $args['user_id'];
		}
		if ( ! empty( $args['status'] ) && isset( self::STATUSES[ $args['status'] ] ) ) {
			$where[]  = 'r.status = %s';
			$params[] = $args['status'];
		}
		if ( ! empty( $args['type'] ) && isset( self::TYPES[ $args['type'] ] ) ) {
			$where[]  = 'r.type = %s';
			$params[] = $args['type'];
		}
		if ( ! empty( $args['workplace'] ) ) {
			$ids     = Dolly_Workplaces::user_ids_for_workplace( (int) $args['workplace'] );
			$where[] = $ids ? 'r.user_id IN (' . implode( ',', $ids ) . ')' : '1=0';
		}
		$w     = implode( ' AND ', $where );
		$per   = max( 1, min( 100, (int) ( $args['per_page'] ?? 10 ) ) );
		$page  = max( 1, (int) ( $args['page'] ?? 1 ) );
		$count = (int) ( $params ? $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t r WHERE $w", $params ) ) : $wpdb->get_var( "SELECT COUNT(*) FROM $t r WHERE $w" ) ); // phpcs:ignore
		$params[] = $per;
		$params[] = ( $page - 1 ) * $per;
		$join     = '';
		$mode     = $args['order'] ?? '';
		if ( 'name' === $mode ) {
			list( $join, $by ) = Dolly_Employees::name_order_sql( 'r.user_id' );
			$order             = $by . ", FIELD(r.status,'pending') DESC, r.created_at DESC";
		} elseif ( 'pending_first' === $mode ) {
			$order = "FIELD(r.status,'pending') DESC, r.created_at DESC";
		} else {
			$order = 'r.created_at DESC';
		}
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT r.* FROM $t r $join WHERE $w ORDER BY $order, r.id DESC LIMIT %d OFFSET %d", $params ) ); // phpcs:ignore
		return array(
			'items' => array_map( array( __CLASS__, 'format' ), $rows ),
			'total' => $count,
			'pages' => (int) ceil( $count / $per ),
			'page'  => $page,
		);
	}

	public static function count_pending( array $user_ids = null ) {
		global $wpdb;
		$t = Dolly_Install::t( 'requests' );
		if ( is_array( $user_ids ) ) {
			if ( ! $user_ids ) {
				return 0;
			}
			return (int) $wpdb->get_var( "SELECT COUNT(*) FROM $t WHERE status = 'pending' AND user_id IN (" . implode( ',', array_map( 'intval', $user_ids ) ) . ')' ); // phpcs:ignore
		}
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM $t WHERE status = 'pending'" ); // phpcs:ignore
	}
}
