<?php
/**
 * Authentication rules: deactivated accounts, role-based redirects, wp-admin restrictions.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Auth {

	public static function init() {
		add_filter( 'authenticate', array( __CLASS__, 'block_inactive' ), 99 );
		add_action( 'init', array( __CLASS__, 'logout_inactive' ), 1 );
		add_action( 'admin_init', array( __CLASS__, 'restrict_admin' ) );
		add_filter( 'show_admin_bar', array( __CLASS__, 'admin_bar' ) );
		add_filter( 'login_redirect', array( __CLASS__, 'login_redirect' ), 10, 3 );
		add_filter( 'lostpassword_url', array( __CLASS__, 'lostpassword_url' ), 10, 2 );
		add_filter( 'auth_cookie_expiration', array( __CLASS__, 'cookie_expiration' ), 10, 3 );
	}

	public static function is_portal_user( $user ) {
		return $user instanceof WP_User && array_intersect( array( Dolly_Install::ROLE_EMPLOYEE, Dolly_Install::ROLE_WORKPLACE ), (array) $user->roles ) && ! user_can( $user, 'dolly_manage' );
	}

	/** Deactivated accounts cannot sign in. */
	public static function block_inactive( $user ) {
		if ( $user instanceof WP_User && self::is_portal_user( $user ) && ! Dolly_Employees::is_active( $user->ID ) ) {
			return new WP_Error( 'dolly_inactive', __( 'Account deactivated. Contact your administrator.', 'dolly-employee-management' ) );
		}
		return $user;
	}

	/** Safety net: sessions of deactivated accounts are closed on the next request. */
	public static function logout_inactive() {
		$uid = get_current_user_id();
		if ( $uid && self::is_portal_user( wp_get_current_user() ) && ! Dolly_Employees::is_active( $uid ) ) {
			WP_Session_Tokens::get_instance( $uid )->destroy_all();
			wp_clear_auth_cookie();
			wp_set_current_user( 0 );
		}
	}

	/** Employees and workplace accounts never use wp-admin. */
	public static function restrict_admin() {
		if ( wp_doing_ajax() || ( defined( 'DOING_CRON' ) && DOING_CRON ) ) {
			return;
		}
		$user = wp_get_current_user();
		if ( self::is_portal_user( $user ) ) {
			wp_safe_redirect( self::home_for( $user ) );
			exit;
		}
	}

	public static function admin_bar( $show ) {
		return self::is_portal_user( wp_get_current_user() ) ? false : $show;
	}

	public static function home_for( $user ) {
		if ( ! $user instanceof WP_User || ! $user->exists() ) {
			return home_url( '/accesso/' );
		}
		if ( user_can( $user, 'dolly_manage' ) ) {
			return admin_url( 'admin.php?page=dolly-dashboard' );
		}
		if ( in_array( Dolly_Install::ROLE_WORKPLACE, (array) $user->roles, true ) ) {
			return home_url( '/sede/' );
		}
		if ( in_array( Dolly_Install::ROLE_EMPLOYEE, (array) $user->roles, true ) ) {
			return home_url( '/portale/' );
		}
		return home_url( '/' );
	}

	public static function login_redirect( $redirect_to, $requested, $user ) {
		if ( ! $user instanceof WP_User ) {
			return $redirect_to;
		}
		if ( self::is_portal_user( $user ) ) {
			// Keep a portal deep link (e.g. /portale/?mc=...) but never send portal users to wp-admin.
			if ( $requested && false === strpos( $requested, 'wp-admin' ) && 0 === strpos( $requested, home_url() ) ) {
				return $requested;
			}
			return self::home_for( $user );
		}
		return $redirect_to;
	}

	public static function lostpassword_url( $url, $redirect ) {
		return home_url( '/recupero-password/' );
	}

	/** Workplace displays stay signed in for 30 days; employees get the WordPress defaults. */
	public static function cookie_expiration( $length, $user_id, $remember ) {
		if ( Dolly_Employees::is_workplace_account( $user_id ) ) {
			return 30 * DAY_IN_SECONDS;
		}
		return $length;
	}
}
