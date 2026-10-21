<?php
/**
 * Audit history: actor, timestamp, reason and previous values.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Audit {

	const LABELS = array(
		'employee_created'       => 'Employee created',
		'employee_updated'       => 'Employee edited',
		'employee_deactivated'   => 'Employee deactivated',
		'employee_reactivated'   => 'Employee reactivated',
		'password_reset'         => 'Password reset',
		'profile_updated'        => 'Profile updated by the employee',
		'schedule_changed'       => 'Schedule changed',
		'assignments_changed'    => 'Assigned workplaces changed',
		'workplace_created'      => 'Workplace created',
		'workplace_updated'      => 'Workplace edited',
		'punch_corrected'        => 'Clock-in corrected',
		'punch_added'            => 'Clock-in added',
		'punch_removed'          => 'Clock-in canceled',
		'exception_created'      => 'Verification exception created',
		'exception_revoked'      => 'Verification exception revoked',
		'exception_used'         => 'Verification exception used',
		'request_approved'       => 'Request approved',
		'request_rejected'       => 'Request rejected',
		'request_created_admin'  => 'Request created by the administrator',
		'anomaly_resolved'       => 'Anomaly resolved',
		'sickness_reviewed'      => 'Sickness/injury conflict reviewed',
		'sickness_created_admin' => 'Sickness/injury recorded by the administrator',
		'bank_details_updated'   => 'Bank details changed',
		'closure_saved'          => 'Collective closure saved',
		'closure_removed'        => 'Collective closure removed',
		'broadcast_created'      => 'Broadcast created',
		'broadcast_cancelled'    => 'Broadcast canceled',
		'oncall_auto_approved'   => 'On-call shift approved automatically',
		'smart_auto_approved'    => 'Remote work approved automatically',
		'certificate_protocol'   => 'Certificate protocol number entered',
		'onboarding_completed'   => 'Guided setup completed',
		'certificates_disabled'  => 'Certificate requirements canceled',
		'certificate_downloaded' => 'Certificate downloaded',
		'settings_updated'       => 'Settings changed',
		'request_revoked'        => 'Request revoked by the employer',
		'device_registered'      => 'Device linked',
		'device_unlinked'        => 'Device unlinked',
		'device_limit_changed'   => 'Device limit changed',
		'donation_certificates_disabled' => 'Donation certificate requirements canceled',
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
