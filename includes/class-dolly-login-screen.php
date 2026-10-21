<?php
/**
 * WordPress sign-in screens (wp-login.php): the password reset reached from the recovery email and the
 * administrators' sign-in. Branded with the Appearance settings (colors, logo, brand name) with any theme.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Login_Screen {

	public static function init() {
		add_action( 'login_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_filter( 'login_headerurl', array( __CLASS__, 'header_url' ) );
		add_filter( 'login_headertext', array( __CLASS__, 'header_text' ) );
		add_action( 'after_password_reset', array( __CLASS__, 'after_reset' ) );
	}

	public static function assets() {
		wp_enqueue_style( 'dolly-login', DOLLY_URL . 'assets/css/dolly-login.css', array(), DOLLY_VERSION );
		$css  = Dolly_Appearance::css( null, 'admin' );
		$logo = Dolly_Appearance::logo_url();
		if ( $logo ) {
			// With a logo the link shows the image instead of the brand name.
			$css .= 'body.login h1 a{background-image:url("' . esc_url_raw( $logo ) . '");text-indent:-9999px;width:240px;height:72px;'
				. 'background-size:contain;background-repeat:no-repeat;background-position:center;}body.login h1 a::after{display:none;}';
		}
		wp_add_inline_style( 'dolly-login', $css );
	}

	/** The logo above the form leads to the employee sign-in page. */
	public static function header_url() {
		return Dolly_Frontend::url( 'login' );
	}

	public static function header_text() {
		return Dolly_Appearance::brand();
	}

	/** After resetting the password, portal users are sent back to the portal sign-in instead of wp-login.php. */
	public static function after_reset( $user ) {
		if ( Dolly_Auth::is_portal_user( $user ) ) {
			add_filter(
				'login_url',
				function () {
					return Dolly_Frontend::url( 'login' );
				}
			);
		}
	}
}
