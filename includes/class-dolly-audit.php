<?php
/**
 * Audit history: actor, timestamp, reason and previous values.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Audit {

	const LABELS = array(
		'employee_created'       => 'Dipendente creato',
		'employee_updated'       => 'Dipendente modificato',
		'employee_deactivated'   => 'Dipendente disattivato',
		'employee_reactivated'   => 'Dipendente riattivato',
		'password_reset'         => 'Password reimpostata',
		'profile_updated'        => 'Profilo aggiornato dal dipendente',
		'schedule_changed'       => 'Orario modificato',
		'assignments_changed'    => 'Sedi assegnate modificate',
		'workplace_created'      => 'Sede creata',
		'workplace_updated'      => 'Sede modificata',
		'punch_corrected'        => 'Timbratura corretta',
		'punch_added'            => 'Timbratura inserita',
		'punch_removed'          => 'Timbratura annullata',
		'exception_created'      => 'Eccezione di verifica creata',
		'exception_revoked'      => 'Eccezione di verifica revocata',
		'exception_used'         => 'Eccezione di verifica utilizzata',
		'request_approved'       => 'Richiesta approvata',
		'request_rejected'       => 'Richiesta respinta',
		'request_created_admin'  => 'Richiesta creata dall\'amministratore',
		'anomaly_resolved'       => 'Anomalia risolta',
		'sickness_reviewed'      => 'Conflitto malattia/infortunio verificato',
		'sickness_created_admin' => 'Malattia/infortunio registrato dall\'amministratore',
		'bank_details_updated'   => 'Dati bancari modificati',
		'closure_saved'          => 'Chiusura collettiva salvata',
		'closure_removed'        => 'Chiusura collettiva rimossa',
		'broadcast_created'      => 'Broadcast creato',
		'broadcast_cancelled'    => 'Broadcast annullato',
		'oncall_auto_approved'   => 'Turno a chiamata approvato automaticamente',
		'smart_auto_approved'    => 'Smart working approvato automaticamente',
		'certificate_protocol'   => 'Protocollo del certificato inserito',
		'onboarding_completed'   => 'Configurazione guidata completata',
		'certificates_disabled'  => 'Requisiti certificato annullati',
		'certificate_downloaded' => 'Certificato scaricato',
		'settings_updated'       => 'Impostazioni modificate',
		'request_revoked'        => 'Richiesta revocata dal datore di lavoro',
		'device_registered'      => 'Dispositivo collegato',
		'device_unlinked'        => 'Dispositivo scollegato',
		'device_limit_changed'   => 'Limite dispositivi modificato',
		'donation_certificates_disabled' => 'Requisiti certificato di donazione annullati',
	);

	public static function log( $action, $object_type, $object_id, $subject_user_id = 0, $reason = '', $before = null, $after = null, $actor_id = null ) {
		global $wpdb;
		$wpdb->insert(
			Dolly_Install::t( 'audit' ),
			array(
				'actor_id'        => null === $actor_id ? get_current_user_id() : (int) $actor_id,
				'action'          => $action,
				'object_type'     => $object_type,
				'object_id'       => (int) $object_id,
				'subject_user_id' => (int) $subject_user_id,
				'reason'          => (string) $reason,
				'before_json'     => null === $before ? null : wp_json_encode( $before ),
				'after_json'      => null === $after ? null : wp_json_encode( $after ),
				'ip'              => self::ip(),
				'created_at'      => Dolly_Time::now_utc(),
			)
		);
		return (int) $wpdb->insert_id;
	}

	private static function ip() {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		return filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : null;
	}

	public static function query( $args ) {
		global $wpdb;
		$t      = Dolly_Install::t( 'audit' );
		$where  = array( '1=1' );
		$params = array();
		if ( ! empty( $args['user_id'] ) ) {
			$where[]  = 'subject_user_id = %d';
			$params[] = (int) $args['user_id'];
		}
		if ( ! empty( $args['object_type'] ) ) {
			$where[]  = 'object_type = %s';
			$params[] = $args['object_type'];
		}
		$per    = max( 1, min( 100, (int) ( $args['per_page'] ?? 20 ) ) );
		$page   = max( 1, (int) ( $args['page'] ?? 1 ) );
		$w      = implode( ' AND ', $where );
		$count  = (int) $wpdb->get_var( $params ? $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE $w", $params ) : "SELECT COUNT(*) FROM $t WHERE $w" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- plugin tables ($wpdb->prefix), values prepared or cast.
		$params[] = $per;
		$params[] = ( $page - 1 ) * $per;
		$rows   = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE $w ORDER BY id DESC LIMIT %d OFFSET %d", $params ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- plugin tables ($wpdb->prefix), values prepared or cast.
		$items  = array();
		foreach ( $rows as $r ) {
			$items[] = array(
				'id'         => (int) $r->id,
				'action'     => $r->action,
				'label'      => Dolly_I18n::t( self::LABELS[ $r->action ] ?? $r->action ),
				'actor'      => Dolly_Employees::display_name( (int) $r->actor_id ),
				'subject'    => $r->subject_user_id ? Dolly_Employees::display_name( (int) $r->subject_user_id ) : '',
				'reason'     => $r->reason,
				'before'     => $r->before_json ? json_decode( $r->before_json, true ) : null,
				'after'      => $r->after_json ? json_decode( $r->after_json, true ) : null,
				'created_at' => Dolly_Time::iso( $r->created_at ),
			);
		}
		return array(
			'items' => $items,
			'total' => $count,
			'pages' => (int) ceil( $count / $per ),
			'page'  => $page,
		);
	}
}
