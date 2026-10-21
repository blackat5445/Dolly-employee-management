<?php
/**
 * Guided setup and administrators' tutorial.
 *
 * - After activation the administrator lands on the guided setup (Gestione Dipendenti › Configurazione guidata):
 *   the settings category by category, then the first workplace, the first employee, then the tutorial.
 *   Progress is saved, so the setup resumes where it stopped; it can be restarted from Impostazioni.
 * - The tutorial is a guided tour of every section of the panel. It is per administrator: once the setup
 *   is done, other administrators only get the tutorial.
 * - Notices when the companion theme (Dolly Portal) is missing or outdated.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Onboarding {

	const OPTION        = 'dolly_onboarding';
	const REDIRECT      = 'dolly_onboarding_redirect';
	const TOUR_META     = 'dolly_admin_tour';
	const NOTICE_META   = 'dolly_theme_notice_dismissed';
	const THEME_VERSION = '1.3.0';

	public static function init() {
		add_action( 'admin_init', array( __CLASS__, 'maybe_redirect' ) );
		add_action( 'admin_notices', array( __CLASS__, 'theme_notice' ) );
		add_action( 'wp_ajax_dolly_dismiss_theme_notice', array( __CLASS__, 'dismiss_theme_notice' ) );
	}

	/** Called on activation: the next admin page load opens the guided setup. */
	public static function on_activation() {
		set_transient( self::REDIRECT, get_current_user_id(), 5 * MINUTE_IN_SECONDS );
	}

	public static function state() {
		$s = get_option( self::OPTION, array() );
		return array_merge(
			array(
				'done'         => false,
				'step'         => '',
				'completed_by' => 0,
				'completed_at' => null,
			),
			is_array( $s ) ? $s : array()
		);
	}

	public static function is_done() {
		return (bool) self::state()['done'];
	}

	/** Remembers the step reached, so the setup resumes there. */
	public static function save_step( $step ) {
		$s         = self::state();
		$s['step'] = sanitize_key( $step );
		update_option( self::OPTION, $s, false );
		return $s;
	}

	public static function complete() {
		$s = self::state();
		if ( ! $s['done'] ) {
			Dolly_Audit::log( 'onboarding_completed', 'settings', 0 );
		}
		$s['done']         = true;
		$s['step']         = '';
		$s['completed_by'] = get_current_user_id();
		$s['completed_at'] = Dolly_Time::now_utc();
		update_option( self::OPTION, $s, false );
		return $s;
	}

	/** "done", "skipped" or '' (never seen) for the current administrator. */
	public static function tour_state( $user_id = 0 ) {
		return (string) get_user_meta( $user_id ? $user_id : get_current_user_id(), self::TOUR_META, true );
	}

	public static function set_tour_state( $state ) {
		if ( '' === $state ) {
			delete_user_meta( get_current_user_id(), self::TOUR_META );
		} else {
			update_user_meta( get_current_user_id(), self::TOUR_META, in_array( $state, array( 'done', 'skipped' ), true ) ? $state : 'done' );
		}
	}

	/** Everything the admin screens need to know. */
	public static function client_config() {
		$s = self::state();
		return array(
			'done' => (bool) $s['done'],
			'step' => $s['step'],
			'tour' => self::tour_state(),
			'url'  => admin_url( 'admin.php?page=dolly-onboarding' ),
		);
	}

	/** First page load after activation: open the guided setup (not on bulk activation). */
	public static function maybe_redirect() {
		$uid = get_transient( self::REDIRECT );
		if ( ! $uid || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return;
		}
		if ( (int) $uid !== get_current_user_id() || ! current_user_can( 'dolly_manage' ) ) {
			return;
		}
		delete_transient( self::REDIRECT );
		if ( is_network_admin() || isset( $_GET['activate-multi'] ) || self::is_done() ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}
		wp_safe_redirect( admin_url( 'admin.php?page=dolly-onboarding' ) );
		exit;
	}

	/* ---------- Companion theme ---------- */

	/** '' when the Dolly Portal theme is active and recent enough, otherwise 'missing' or 'outdated'. */
	public static function theme_status() {
		if ( ! defined( 'DOLLY_PORTAL_VERSION' ) ) {
			return 'missing';
		}
		return version_compare( DOLLY_PORTAL_VERSION, self::THEME_VERSION, '<' ) ? 'outdated' : '';
	}

	/**
	 * The plugin works with any theme; the Dolly Portal theme is recommended for a dedicated portal site.
	 * Shown on the plugin screens and the dashboard until dismissed (per administrator).
	 */
	public static function theme_notice() {
		$status = self::theme_status();
		if ( ! $status || ! current_user_can( 'dolly_manage' ) || get_user_meta( get_current_user_id(), self::NOTICE_META, true ) === $status ) {
			return;
		}
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( $screen && ! in_array( $screen->id, array( 'dashboard', 'plugins', 'themes' ), true ) && false === strpos( (string) $screen->id, 'dolly-' ) ) {
			return;
		}
		$text = 'outdated' === $status
			? __( 'Il tema Dolly Portal è di una versione precedente: installa l\'ultima versione del tema Dolly Portal.', 'dolly-employee-management' )
			: __( 'Per un sito dedicato al portale dipendenti installa l\'ultima versione del tema Dolly Portal. Il plugin funziona anche con altri temi.', 'dolly-employee-management' );
		printf(
			'<div class="notice notice-info is-dismissible" data-dolly-theme-notice="%1$s" data-nonce="%2$s"><p><strong>%3$s</strong> %4$s</p></div>',
			esc_attr( $status ),
			esc_attr( wp_create_nonce( 'dolly_theme_notice' ) ),
			esc_html( Dolly_Appearance::brand() . ':' ),
			esc_html( $text )
		);
		// Remember the dismissal (WordPress only hides the notice for this page view).
		echo "<script>document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-dolly-theme-notice] .notice-dismiss');if(!b){return;}var n=b.closest('[data-dolly-theme-notice]'),f=new FormData();f.append('action','dolly_dismiss_theme_notice');f.append('status',n.getAttribute('data-dolly-theme-notice'));f.append('_wpnonce',n.getAttribute('data-nonce'));fetch(ajaxurl,{method:'POST',body:f,credentials:'same-origin'});});</script>\n";
	}

	public static function dismiss_theme_notice() {
		check_ajax_referer( 'dolly_theme_notice' );
		if ( current_user_can( 'dolly_manage' ) ) {
			update_user_meta( get_current_user_id(), self::NOTICE_META, sanitize_key( wp_unslash( $_POST['status'] ?? '' ) ) );
		}
		wp_send_json_success();
	}
}
