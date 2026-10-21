<?php
/**
 * Languages: the plugin is written in English and translated with standard gettext files in /languages
 * (dolly-employee-management-<locale>.mo for PHP, .js for the browser). Italian is included.
 *
 * Language of a request: the user's own choice (portal profile or admin settings), otherwise the
 * plugin default (Impostazioni › Lingua), which can follow the site language. Visitors of the login
 * pages can pick a language too (cookie). Notifications and emails switch to the recipient's language.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_I18n {

	const DOMAIN    = 'dolly-employee-management';
	const SOURCE    = 'en_US';
	const USER_META = 'dolly_locale';
	const COOKIE    = 'dolly_lang';

	/** Names of the languages, in their own language. */
	const NAMES = array(
		'it_IT' => 'Italiano',
		'en_US' => 'English',
		'en_GB' => 'English (UK)',
		'de_DE' => 'Deutsch',
		'fr_FR' => 'Français',
		'es_ES' => 'Español',
		'pt_PT' => 'Português',
		'ro_RO' => 'Română',
	);

	private static $locale = null;
	private static $stack  = array();

	public static function init() {
		// Early on init: before any screen, REST response or email is built.
		add_action( 'init', array( __CLASS__, 'handle_switch' ), 0 );
		add_action( 'init', array( __CLASS__, 'load_for_request' ), 1 );
		add_action( 'wp_login', array( __CLASS__, 'adopt_cookie' ), 10, 2 );
	}

	/** Available languages: English plus every translation shipped in /languages. */
	public static function available() {
		$out = array( self::SOURCE => self::NAMES[ self::SOURCE ] );
		foreach ( (array) glob( DOLLY_DIR . 'languages/' . self::DOMAIN . '-*.mo' ) as $file ) {
			$loc         = substr( basename( $file, '.mo' ), strlen( self::DOMAIN ) + 1 );
			$out[ $loc ] = self::NAMES[ $loc ] ?? $loc;
		}
		return $out;
	}

	public static function is_available( $locale ) {
		return is_string( $locale ) && isset( self::available()[ $locale ] );
	}

	/** Plugin default: the setting, or the site language when it is "auto". */
	public static function default_locale() {
		$setting = Dolly_Settings::get( 'language' );
		if ( $setting && 'auto' !== $setting && self::is_available( $setting ) ) {
			return $setting;
		}
		return self::closest( get_locale() );
	}

	/** Best available match for any WordPress locale (de_AT → de_DE, en_AU → en_US…), else the default. */
	public static function closest( $locale ) {
		if ( self::is_available( $locale ) ) {
			return $locale;
		}
		$lang = strtolower( substr( (string) $locale, 0, 2 ) );
		foreach ( array_keys( self::available() ) as $loc ) {
			if ( strtolower( substr( $loc, 0, 2 ) ) === $lang ) {
				return $loc;
			}
		}
		// No translation for the site language: English.
		return self::SOURCE;
	}

	/** The user's own choice, or '' to follow the plugin default. */
	public static function user_choice( $user_id ) {
		$v = $user_id ? get_user_meta( $user_id, self::USER_META, true ) : '';
		return self::is_available( $v ) ? $v : '';
	}

	public static function set_user_choice( $user_id, $locale ) {
		if ( '' === $locale || null === $locale ) {
			delete_user_meta( $user_id, self::USER_META );
			return true;
		}
		if ( ! self::is_available( $locale ) ) {
			return false;
		}
		update_user_meta( $user_id, self::USER_META, $locale );
		return true;
	}

	public static function for_user( $user_id ) {
		$choice = self::user_choice( $user_id );
		return $choice ? $choice : self::default_locale();
	}

	private static function request_locale() {
		$uid = get_current_user_id();
		if ( $uid ) {
			return self::for_user( $uid );
		}
		$cookie = isset( $_COOKIE[ self::COOKIE ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::COOKIE ] ) ) : '';
		return self::is_available( $cookie ) ? $cookie : self::default_locale();
	}

	/** Language links of the login pages: ?dolly_lang=en_US stores the choice in a cookie. */
	public static function handle_switch() {
		if ( empty( $_GET['dolly_lang'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}
		$loc = sanitize_text_field( wp_unslash( $_GET['dolly_lang'] ) ); // phpcs:ignore WordPress.Security.NonceVerification
		if ( ! self::is_available( $loc ) ) {
			return;
		}
		setcookie( self::COOKIE, $loc, time() + YEAR_IN_SECONDS, COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN, is_ssl(), true );
		$_COOKIE[ self::COOKIE ] = $loc;
		if ( get_current_user_id() ) {
			self::set_user_choice( get_current_user_id(), $loc );
		}
	}

	/** A language picked on the login page becomes the user's choice if they have none yet. */
	public static function adopt_cookie( $login, $user ) {
		$cookie = isset( $_COOKIE[ self::COOKIE ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::COOKIE ] ) ) : '';
		if ( $user instanceof WP_User && self::is_available( $cookie ) && ! self::user_choice( $user->ID ) && $cookie !== self::default_locale() ) {
			self::set_user_choice( $user->ID, $cookie );
		}
	}

	public static function load_for_request() {
		self::load( self::request_locale() );
	}

	/** Loads the translation of the given language (English needs none). */
	public static function load( $locale ) {
		if ( $locale === self::$locale ) {
			return;
		}
		unload_textdomain( self::DOMAIN );
		if ( self::SOURCE !== $locale ) {
			// A translation in wp-content/languages/plugins takes priority over the bundled one.
			$custom = WP_LANG_DIR . '/plugins/' . self::DOMAIN . '-' . $locale . '.mo';
			if ( is_readable( $custom ) ) {
				load_textdomain( self::DOMAIN, $custom, $locale );
			}
			load_textdomain( self::DOMAIN, DOLLY_DIR . 'languages/' . self::DOMAIN . '-' . $locale . '.mo', $locale );
		}
		self::$locale = $locale;
	}

	public static function locale() {
		return null === self::$locale ? self::SOURCE : self::$locale;
	}

	/** "it", "en"… for <html lang>, the calendar and number formats. */
	public static function lang() {
		return substr( self::locale(), 0, 2 );
	}

	/** Runs $callback in the language of a user (notifications, emails), then restores the current one. */
	public static function as_user( $user_id, callable $callback ) {
		self::$stack[] = self::locale();
		self::load( self::for_user( $user_id ) );
		try {
			return $callback();
		} finally {
			self::load( array_pop( self::$stack ) );
		}
	}

	/**
	 * Translates a label stored in a constant (constants cannot call __() themselves), with an optional
	 * gettext context (see CONST_CONTEXT in tools/i18n/i18n.py).
	 */
	public static function t( $text, $context = '' ) {
		if ( ! is_string( $text ) || '' === $text ) {
			return $text;
		}
		// phpcs:ignore WordPress.WP.I18n.LowLevelTranslationFunction, WordPress.WP.I18n.NonSingularStringLiteralText, WordPress.WP.I18n.NonSingularStringLiteralContext, WordPress.WP.I18n.NonSingularStringLiteralDomain -- Labels stored in constants.
		return $context ? translate_with_gettext_context( $text, $context, self::DOMAIN ) : translate( $text, self::DOMAIN );
	}

	/** Translates every label of a [key => label] map. */
	public static function labels( array $map ) {
		return array_map( array( __CLASS__, 't' ), $map );
	}

	/** URL of the browser dictionary for the current language, or '' for English. */
	public static function js_url() {
		$file = 'languages/' . self::DOMAIN . '-' . self::locale() . '.js';
		return self::SOURCE !== self::locale() && is_readable( DOLLY_DIR . $file ) ? DOLLY_URL . $file : '';
	}

	/**
	 * Round flag of a language (inline SVG, decorative: the language name is always written next to it).
	 * Italian: tricolore; English: Union Jack. Other languages: a neutral circle with the language code.
	 */
	public static function flag( $locale ) {
		static $n = 0;
		$n++;
		$lang = strtolower( substr( (string) $locale, 0, 2 ) );
		$open = '<svg class="dolly-flag" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">'
			. '<defs><clipPath id="dolly-flag-c' . $n . '"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#dolly-flag-c' . $n . ')">';
		$close = '</g><circle cx="12" cy="12" r="11.5" fill="none" stroke="rgba(15,23,42,.18)"/></svg>';
		if ( 'it' === $lang ) {
			return $open . '<rect width="8" height="24" fill="#009246"/><rect x="8" width="8" height="24" fill="#FFFFFF"/><rect x="16" width="8" height="24" fill="#CE2B37"/>' . $close;
		}
		if ( 'en' === $lang ) {
			// Union Jack, centre square of the 2:1 flag scaled to the circle.
			return $open . '<svg x="0" y="0" width="24" height="24" viewBox="15 0 30 30" preserveAspectRatio="xMidYMid slice">'
				. '<defs><clipPath id="dolly-flag-t' . $n . '"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath></defs>'
				. '<rect width="60" height="30" fill="#012169"/>'
				. '<path d="M0,0 L60,30 M60,0 L0,30" stroke="#FFFFFF" stroke-width="6"/>'
				. '<path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#dolly-flag-t' . $n . ')" stroke="#C8102E" stroke-width="4"/>'
				. '<path d="M30,0 v30 M0,15 h60" stroke="#FFFFFF" stroke-width="10"/>'
				. '<path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/></svg>' . $close;
		}
		return $open . '<rect width="24" height="24" fill="#E2E8F0"/><text x="12" y="15.5" font-size="9" font-weight="700" text-anchor="middle" fill="#0F172A" font-family="sans-serif">'
			. esc_html( strtoupper( $lang ) ) . '</text>' . $close;
	}

	/** Languages for the selectors: '' = default of the plugin. */
	public static function choices( $default_label ) {
		return array_merge( array( '' => $default_label ), self::available() );
	}
}
