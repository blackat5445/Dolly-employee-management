<?php
/**
 * Portal and email notifications. Emails are queued, deduplicated and retried by the scheduler.
 * Disabling notifications never hides request statuses or anomalies.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class MEM_Notifications {

	const MAX_ATTEMPTS = 6;

	/** Minutes to wait after each failed attempt. */
	const BACKOFF = array( 1, 5, 15, 60, 240, 720 );

	private static $last_mail_error = '';

	/** $audience: 'employee' (switches "Notifiche ai dipendenti") or 'admin' ("Notifiche agli amministratori"). */
	private static function channel_enabled( $event, $channel, $audience = 'employee' ) {
		$s      = MEM_Settings::all();
		$prefix = 'admin' === $audience ? 'admin_' : '';
		if ( empty( $s[ $prefix . 'notify_' . $channel ] ) ) {
			return false;
		}
		return ! empty( $s[ $prefix . 'events' ][ $event ][ $channel ] );
	}

	private static function link_for( $user_id, $section ) {
		if ( user_can( $user_id, 'mem_manage' ) && 0 === strpos( (string) $section, 'mem-' ) ) {
			return admin_url( 'admin.php?page=' . $section );
		}
		return home_url( '/portale/' ) . ( $section ? '#' . $section : '' );
	}

	public static function notify_user( $user_id, $event, $title, $body, $section = '', $dedupe = null, $audience = 'employee' ) {
		self::deliver( $user_id, $event, $title, $body, $section, self::channel_enabled( $event, 'portal', $audience ), self::channel_enabled( $event, 'email', $audience ), $dedupe );
	}

	/**
	 * Sends a notification on explicit channels. Portal notifications of users with a registered phone are
	 * also pushed to the phone. Pushes and emails leave at the end of the current request (MEM_Push::flush);
	 * the scheduler only retries. $popup: shown in a pop-up as soon as the employee opens the portal.
	 */
	public static function deliver( $user_id, $event, $title, $body, $section, $portal, $email, $dedupe = null, $popup = false ) {
		global $wpdb;
		if ( ! $user_id ) {
			return;
		}
		$link = self::link_for( $user_id, $section );
		if ( $portal || $popup ) {
			$push = MEM_Push::has_subscription( $user_id );
			$wpdb->insert(
				MEM_Install::t( 'notifications' ),
				array(
					'user_id'    => $user_id,
					'event'      => $event,
					'title'      => mb_substr( $title, 0, 250 ),
					'body'       => $body,
					'link'       => $link,
					'push_state' => $push ? MEM_Push::STATE_QUEUED : MEM_Push::STATE_NONE,
					'popup'      => $popup ? 1 : 0,
					'created_at' => MEM_Time::now_utc(),
				)
			);
			if ( $push ) {
				MEM_Push::request_flush();
			}
		}
		if ( $email ) {
			$u = get_userdata( $user_id );
			if ( $u && is_email( $u->user_email ) ) {
				self::queue_email( $user_id, $event, $u->user_email, $title, $body, $link, $dedupe ? $event . '|' . $user_id . '|' . $dedupe : null );
				MEM_Push::request_flush();
			}
		}
	}

	private static function format_row( $r ) {
		return array(
			'id'         => (int) $r->id,
			'event'      => $r->event,
			'title'      => $r->title,
			'body'       => (string) $r->body,
			'link'       => (string) $r->link,
			'read'       => (bool) $r->read_at,
			'popup'      => ! empty( $r->popup ),
			'created_at' => MEM_Time::iso( $r->created_at ),
		);
	}

	/** One notification of the user (for the pop-up opened from a push or from the list). */
	public static function get_for( $user_id, $id ) {
		global $wpdb;
		$t = MEM_Install::t( 'notifications' );
		$r = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d AND user_id = %d", $id, $user_id ) ); // phpcs:ignore
		return $r ? self::format_row( $r ) : new WP_Error( 'mem_not_found', 'Notifica non trovata.', array( 'status' => 404 ) );
	}

	/** Unread messages to show in a pop-up when the employee opens the portal (oldest first). */
	public static function popups( $user_id ) {
		global $wpdb;
		$t = MEM_Install::t( 'notifications' );
		return array_map( array( __CLASS__, 'format_row' ), $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND popup = 1 AND read_at IS NULL ORDER BY id ASC LIMIT 5", $user_id ) ) ); // phpcs:ignore
	}

	/** Administrator "send test email": sends immediately and reports the mail error, if any. */
	public static function test_email( $user_id ) {
		$u = get_userdata( $user_id );
		if ( ! $u || ! is_email( $u->user_email ) ) {
			return new WP_Error( 'mem_invalid', 'Il tuo account non ha un indirizzo email valido.', array( 'status' => 400 ) );
		}
		self::$last_mail_error = '';
		add_action( 'wp_mail_failed', array( __CLASS__, 'capture_error' ) );
		$ok = wp_mail( $u->user_email, '[Dolly] Email di prova', "Se ricevi questo messaggio, l'invio delle email del portale funziona.\n\n— Dolly · Portale dipendenti", array( 'Content-Type: text/plain; charset=UTF-8' ) );
		remove_action( 'wp_mail_failed', array( __CLASS__, 'capture_error' ) );
		return array(
			'ok'      => (bool) $ok,
			'to'      => $u->user_email,
			'message' => $ok ? 'Email inviata a ' . $u->user_email . '. Se non arriva, controlla lo spam e la configurazione SMTP.' : 'Invio non riuscito: ' . ( self::$last_mail_error ? self::$last_mail_error : 'wp_mail ha restituito false (server di posta non configurato?)' ),
		);
	}

	public static function admin_recipients() {
		$ids = (array) MEM_Settings::get( 'admin_recipients' );
		$ids = array_filter( array_map( 'intval', $ids ), function ( $id ) {
			return user_can( $id, 'mem_manage' );
		} );
		if ( ! $ids ) {
			$ids = get_users(
				array(
					'capability' => 'mem_manage',
					'fields'     => 'ID',
				)
			);
		}
		return array_map( 'intval', $ids );
	}

	public static function notify_admins( $event, $title, $body, $admin_page = 'mem-dashboard', $dedupe = null ) {
		foreach ( self::admin_recipients() as $id ) {
			self::notify_user( $id, $event, $title, $body, $admin_page, $dedupe, 'admin' );
		}
	}

	private static function queue_email( $user_id, $event, $to, $title, $body, $link, $dedupe ) {
		global $wpdb;
		$text  = $body . "\n\n" . 'Apri: ' . $link . "\n\n" . '— Dolly · Portale dipendenti';
		$now   = MEM_Time::now_utc();
		$sql   = $wpdb->prepare(
			'INSERT IGNORE INTO ' . MEM_Install::t( 'email_queue' ) . ' (user_id, event, dedupe_key, to_email, subject, body, status, attempts, next_attempt_at, created_at) VALUES (%d, %s, ' . ( $dedupe ? '%s' : 'NULL' ) . ", %s, %s, %s, 'pending', 0, %s, %s)", // phpcs:ignore
			array_merge(
				array( $user_id, $event ),
				$dedupe ? array( $dedupe ) : array(),
				array( $to, '[Dolly] ' . mb_substr( $title, 0, 200 ), $text, $now, $now )
			)
		);
		$wpdb->query( $sql ); // phpcs:ignore
	}

	/**
	 * Scheduled: sends due emails, claiming each row to avoid double sending by overlapping runs.
	 */
	public static function process_queue( $limit = 25 ) {
		global $wpdb;
		$t    = MEM_Install::t( 'email_queue' );
		$now  = MEM_Time::now_utc();
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT id FROM $t WHERE status = 'pending' AND next_attempt_at <= %s AND (locked_until IS NULL OR locked_until < %s) ORDER BY id ASC LIMIT %d", $now, $now, $limit ) ); // phpcs:ignore
		$sent = 0;
		add_action( 'wp_mail_failed', array( __CLASS__, 'capture_error' ) );
		foreach ( $rows as $r ) {
			$claimed = $wpdb->query( $wpdb->prepare( "UPDATE $t SET locked_until = %s WHERE id = %d AND status = 'pending' AND (locked_until IS NULL OR locked_until < %s)", gmdate( 'Y-m-d H:i:s', time() + 300 ), $r->id, $now ) ); // phpcs:ignore
			if ( ! $claimed ) {
				continue;
			}
			$m                     = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d", $r->id ) ); // phpcs:ignore
			self::$last_mail_error = '';
			$ok                    = wp_mail( $m->to_email, $m->subject, $m->body, array( 'Content-Type: text/plain; charset=UTF-8' ) );
			if ( $ok ) {
				$wpdb->update( $t, array( 'status' => 'sent', 'sent_at' => MEM_Time::now_utc(), 'locked_until' => null, 'attempts' => (int) $m->attempts + 1 ), array( 'id' => $m->id ) );
				$sent++;
			} else {
				$attempts = (int) $m->attempts + 1;
				$wait     = self::BACKOFF[ min( $attempts - 1, count( self::BACKOFF ) - 1 ) ];
				$wpdb->update(
					$t,
					array(
						'status'          => $attempts >= self::MAX_ATTEMPTS ? 'failed' : 'pending',
						'attempts'        => $attempts,
						'next_attempt_at' => gmdate( 'Y-m-d H:i:s', time() + $wait * 60 ),
						'locked_until'    => null,
						'last_error'      => self::$last_mail_error ? self::$last_mail_error : 'wp_mail ha restituito false',
					),
					array( 'id' => $m->id )
				);
			}
		}
		remove_action( 'wp_mail_failed', array( __CLASS__, 'capture_error' ) );
		return $sent;
	}

	public static function capture_error( $error ) {
		if ( is_wp_error( $error ) ) {
			self::$last_mail_error = $error->get_error_message();
		}
	}

	public static function queue_stats() {
		global $wpdb;
		$t    = MEM_Install::t( 'email_queue' );
		$rows = $wpdb->get_results( "SELECT status, COUNT(*) AS n FROM $t GROUP BY status" ); // phpcs:ignore
		$out  = array( 'pending' => 0, 'sent' => 0, 'failed' => 0 );
		foreach ( $rows as $r ) {
			$out[ $r->status ] = (int) $r->n;
		}
		$out['last_error'] = (string) $wpdb->get_var( "SELECT last_error FROM $t WHERE last_error IS NOT NULL ORDER BY id DESC LIMIT 1" ); // phpcs:ignore
		return $out;
	}

	public static function query( $user_id, $page = 1, $per = 10 ) {
		global $wpdb;
		$t     = MEM_Install::t( 'notifications' );
		$per   = max( 1, min( 50, (int) $per ) );
		$page  = max( 1, (int) $page );
		$count = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE user_id = %d", $user_id ) ); // phpcs:ignore
		$rows  = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d ORDER BY id DESC LIMIT %d OFFSET %d", $user_id, $per, ( $page - 1 ) * $per ) ); // phpcs:ignore
		$items = array_map( array( __CLASS__, 'format_row' ), $rows );
		return array(
			'items'  => $items,
			'total'  => $count,
			'pages'  => (int) ceil( $count / $per ),
			'page'   => $page,
			'unread' => self::unread_count( $user_id ),
		);
	}

	public static function unread_count( $user_id ) {
		global $wpdb;
		$t = MEM_Install::t( 'notifications' );
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE user_id = %d AND read_at IS NULL", $user_id ) ); // phpcs:ignore
	}

	public static function mark_read( $user_id, $id = 0 ) {
		global $wpdb;
		$t = MEM_Install::t( 'notifications' );
		if ( $id ) {
			$wpdb->query( $wpdb->prepare( "UPDATE $t SET read_at = %s WHERE id = %d AND user_id = %d AND read_at IS NULL", MEM_Time::now_utc(), $id, $user_id ) ); // phpcs:ignore
		} else {
			$wpdb->query( $wpdb->prepare( "UPDATE $t SET read_at = %s WHERE user_id = %d AND read_at IS NULL", MEM_Time::now_utc(), $user_id ) ); // phpcs:ignore
		}
		return self::unread_count( $user_id );
	}
}
