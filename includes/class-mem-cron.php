<?php
/**
 * One-minute scheduler for anomaly checks and notification processing.
 *
 * Production must trigger it from the server's task scheduler (not only visitor traffic):
 *   * * * * * wp --path=/percorso/wordpress dolly tick
 * or
 *   * * * * * curl -s "https://example.com/wp-json/dolly/v1/cron?key=CHIAVE" >/dev/null
 * together with define( 'DISABLE_WP_CRON', true ) in wp-config.php.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class MEM_Cron {

	const HOOK = 'mem_minute_tick';

	public static function init() {
		add_filter( 'cron_schedules', array( __CLASS__, 'schedules' ) ); // phpcs:ignore
		add_action( self::HOOK, array( __CLASS__, 'tick' ) );
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			self::schedule();
		}
	}

	public static function schedules( $s ) {
		$s['mem_every_minute'] = array(
			'interval' => 60,
			'display'  => 'Ogni minuto (Dolly)',
		);
		return $s;
	}

	public static function schedule() {
		add_filter( 'cron_schedules', array( __CLASS__, 'schedules' ) ); // phpcs:ignore
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + 60, 'mem_every_minute', self::HOOK );
		}
	}

	public static function unschedule() {
		wp_clear_scheduled_hook( self::HOOK );
	}

	/**
	 * Runs the periodic jobs. A database lock prevents overlapping runs (duplicate prevention).
	 */
	public static function tick( $source = 'wp-cron' ) {
		global $wpdb;
		if ( ! $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 0)', $wpdb->prefix . 'mem_tick' ) ) ) {
			return array( 'skipped' => true );
		}
		$result = array();
		try {
			MEM_Anomalies::check_all();
			MEM_Anomalies::check_absences();
			MEM_Sickness::check_overdue();
			MEM_Donations::request_certificates();
			MEM_Donations::check_overdue();
			$result['reminders_sent'] = MEM_Reminders::run();
			MEM_Broadcasts::process_due();
			$result['emails_sent'] = MEM_Notifications::process_queue();
			$result['push_sent']   = MEM_Push::process_queue();
			$result['hours_synced'] = MEM_Hours::process();
			update_option(
				'mem_last_tick',
				array(
					'time'   => time(),
					'source' => is_string( $source ) ? $source : 'wp-cron',
				),
				false
			);
		} finally {
			$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $wpdb->prefix . 'mem_tick' ) );
		}
		return $result;
	}

	public static function cli_tick() {
		$r = self::tick( 'wp-cli' );
		if ( class_exists( 'WP_CLI' ) ) {
			WP_CLI::success( ! empty( $r['skipped'] ) ? 'Esecuzione già in corso: saltata.' : 'Controlli completati. Email inviate: ' . (int) ( $r['emails_sent'] ?? 0 ) );
		}
	}

	public static function status() {
		$last = get_option( 'mem_last_tick' );
		return array(
			'last_run'        => $last ? MEM_Time::iso( gmdate( 'Y-m-d H:i:s', (int) $last['time'] ) ) : null,
			'last_source'     => $last ? $last['source'] : null,
			'healthy'         => $last && ( time() - (int) $last['time'] ) < 180,
			'wp_cron_disabled'=> defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON,
			'cron_url'        => add_query_arg( 'key', MEM_Settings::cron_key(), rest_url( MEM_REST_NS . '/cron' ) ),
			'wp_cli'          => 'wp --path=' . untrailingslashit( ABSPATH ) . ' dolly tick',
			'email_queue'     => MEM_Notifications::queue_stats(),
		);
	}
}
