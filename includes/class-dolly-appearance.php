<?php
/**
 * Appearance and white-label options: brand name, logos, colors, dark mode, typography,
 * shapes, login page, email texts and custom CSS.
 *
 * Stored in a single option. Every visual setting is turned into CSS custom properties
 * (the --dolly-* tokens used by assets/css/dolly-ui.css), so the stylesheet never changes.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Appearance {

	const OPTION = 'dolly_appearance';

	const SCHEMES = array(
		'light' => 'Light',
		'dark'  => 'Dark',
		'auto'  => 'Automatic (same as device)',
	);

	const FONTS = array(
		'system'  => array( 'System (default)', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif' ),
		'sans'    => array( 'Classic sans-serif', '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif' ),
		'rounded' => array( 'Rounded', 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", -apple-system, "Segoe UI", sans-serif' ),
		'serif'   => array( 'Serif', 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif' ),
		'custom'  => array( 'Custom', '' ),
	);

	const TEXT_SIZES = array(
		'small'  => array( 'Small', 93.75 ),
		'normal' => array( 'Normal (default)', 100 ),
		'large'  => array( 'Large', 106.25 ),
		'xlarge' => array( 'Very large', 112.5 ),
	);

	const HEADING_WEIGHTS = array( 600, 700, 800 );

	const BUTTON_SHAPES = array(
		'rounded' => 'Rounded (default)',
		'pill'    => 'Pill',
		'square'  => 'Square',
	);

	const SHADOWS = array(
		'none'   => 'None',
		'subtle' => 'Light (default)',
		'medium' => 'Strong',
	);

	const DENSITIES = array(
		'comfortable' => 'Comfortable (default)',
		'compact'     => 'Compact',
	);

	/** Color keys, in the order shown in the settings screen. */
	const COLORS = array( 'primary', 'accent', 'header_bg', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger', 'info' );
	const DARK_COLORS = array( 'dark_background', 'dark_surface', 'dark_text', 'dark_muted', 'dark_border' );

	/** Fixed hues of the calendar categories (leave, closures…), adapted to light and dark surfaces. */
	const CATEGORY_HUES = array(
		'permesso'         => '#6D28D9',
		'festivo'          => '#A21CAF',
		'chiusura-festiva' => '#C2410C',
		'donazione'        => '#0F766E',
	);

	public static function defaults() {
		return array(
			// Brand.
			'brand_name'          => 'Dolly',
			'app_name'            => '',
			'admin_title'         => 'Employee Management',
			'portal_subtitle'     => 'Employee portal',
			'display_subtitle'    => 'Attendance code',
			'wordmark_mark'       => false,
			// Logos and icons.
			'logo_id'             => 0,
			'logo_header_id'      => 0,
			'logo_height'         => 40,
			'app_icon_id'         => 0,
			// Colors.
			'primary'             => '#2563EB',
			'accent'              => '#2563EB',
			'header_bg'           => '#2563EB',
			'background'          => '#F8FAFC',
			'surface'             => '#FFFFFF',
			'text'                => '#0F172A',
			'muted'               => '#475569',
			'border'              => '#E2E8F0',
			'success'             => '#15803D',
			'warning'             => '#B45309',
			'danger'              => '#B91C1C',
			'info'                => '#0369A1',
			// Dark mode.
			'color_scheme'        => 'light',
			'dark_background'     => '#0B1120',
			'dark_surface'        => '#111827',
			'dark_text'           => '#E2E8F0',
			'dark_muted'          => '#94A3B8',
			'dark_border'         => '#1F2937',
			// Typography.
			'font_family'         => 'system',
			'font_custom'         => '',
			'font_url'            => '',
			'text_size'           => 'normal',
			'heading_weight'      => 700,
			// Shapes and spacing.
			'radius'              => 12,
			'button_shape'        => 'rounded',
			'shadow'              => 'subtle',
			'density'             => 'comfortable',
			// Login page.
			'login_title'         => 'Sign in',
			'login_text'          => 'Sign in with the credentials provided by your administrator.',
			'login_bg_id'         => 0,
			// Emails.
			'email_subject_prefix' => '',
			'email_signature'     => '',
			'email_from_name'     => '',
			'email_from_email'    => '',
			// Advanced.
			'custom_css'          => '',
		);
	}

	public static function all() {
		$saved = get_option( self::OPTION, array() );
		$saved = is_array( $saved ) ? $saved : array();
		return array_merge( self::defaults(), array_intersect_key( $saved, self::defaults() ) );
	}

	/** Texts that are translated while they still have their default (Italian) value. */
	const DEFAULT_TEXTS = array( 'admin_title', 'portal_subtitle', 'display_subtitle', 'login_title', 'login_text' );

	/** Default texts of the versions written in Italian (before 1.14): still treated as defaults. */
	const LEGACY_DEFAULTS = array(
		'admin_title'      => 'Gestione Dipendenti',
		'portal_subtitle'  => 'Portale dipendenti',
		'display_subtitle' => 'Codice presenze',
		'login_title'      => 'Accedi',
		'login_text'       => 'Accedi con le credenziali fornite dall\'amministratore.',
	);

	/** Value for display: default texts are shown in the user's language. */
	public static function get( $key ) {
		$all = self::all();
		if ( ! isset( $all[ $key ] ) ) {
			return null;
		}
		if ( in_array( $key, self::DEFAULT_TEXTS, true ) && ( self::defaults()[ $key ] === $all[ $key ] || ( self::LEGACY_DEFAULTS[ $key ] ?? null ) === $all[ $key ] ) ) {
			return Dolly_I18n::t( self::defaults()[ $key ] );
		}
		return $all[ $key ];
	}

	/**
	 * Validates a partial input. Returns array( clean values, field errors ).
	 * Unknown keys are ignored; invalid values are reported and not applied.
	 */
	public static function sanitize( array $input, array $base ) {
		$new    = $base;
		$errors = array();

		$texts = array(
			'brand_name'           => array( 40, true ),
			'app_name'             => array( 60, false ),
			'admin_title'          => array( 40, true ),
			'portal_subtitle'      => array( 60, false ),
			'display_subtitle'     => array( 60, false ),
			'login_title'          => array( 60, true ),
			'email_subject_prefix' => array( 40, false ),
			'email_from_name'      => array( 60, false ),
		);
		foreach ( $texts as $k => $rule ) {
			if ( ! isset( $input[ $k ] ) ) {
				continue;
			}
			$v = trim( sanitize_text_field( (string) $input[ $k ] ) );
			if ( $rule[1] && '' === $v ) {
				$errors[ $k ] = __( 'Required field.', 'dolly-employee-management' );
				continue;
			}
			$new[ $k ] = mb_substr( $v, 0, $rule[0] );
		}
		foreach ( array( 'login_text' => 300, 'email_signature' => 300 ) as $k => $max ) {
			if ( isset( $input[ $k ] ) ) {
				$new[ $k ] = mb_substr( trim( sanitize_textarea_field( (string) $input[ $k ] ) ), 0, $max );
			}
		}
		if ( isset( $input['email_from_email'] ) ) {
			$v = trim( (string) $input['email_from_email'] );
			if ( '' !== $v && ! is_email( $v ) ) {
				$errors['email_from_email'] = __( 'Invalid email address.', 'dolly-employee-management' );
			} else {
				$new['email_from_email'] = '' === $v ? '' : sanitize_email( $v );
			}
		}

		foreach ( array_merge( self::COLORS, self::DARK_COLORS ) as $k ) {
			if ( ! isset( $input[ $k ] ) ) {
				continue;
			}
			$hex = self::hex( $input[ $k ] );
			if ( ! $hex ) {
				$errors[ $k ] = __( 'Invalid color: use the #RRGGBB format.', 'dolly-employee-management' );
				continue;
			}
			$new[ $k ] = $hex;
		}

		$choices = array(
			'color_scheme' => self::SCHEMES,
			'font_family'  => self::FONTS,
			'text_size'    => self::TEXT_SIZES,
			'button_shape' => self::BUTTON_SHAPES,
			'shadow'       => self::SHADOWS,
			'density'      => self::DENSITIES,
		);
		foreach ( $choices as $k => $list ) {
			if ( isset( $input[ $k ] ) && isset( $list[ $input[ $k ] ] ) ) {
				$new[ $k ] = $input[ $k ];
			}
		}
		if ( isset( $input['heading_weight'] ) && in_array( (int) $input['heading_weight'], self::HEADING_WEIGHTS, true ) ) {
			$new['heading_weight'] = (int) $input['heading_weight'];
		}
		if ( isset( $input['radius'] ) ) {
			$new['radius'] = max( 0, min( 24, (int) $input['radius'] ) );
		}
		if ( isset( $input['logo_height'] ) ) {
			$new['logo_height'] = max( 24, min( 96, (int) $input['logo_height'] ) );
		}
		if ( isset( $input['wordmark_mark'] ) ) {
			$new['wordmark_mark'] = (bool) $input['wordmark_mark'];
		}
		foreach ( array( 'logo_id', 'logo_header_id', 'app_icon_id', 'login_bg_id' ) as $k ) {
			if ( ! isset( $input[ $k ] ) ) {
				continue;
			}
			$id = absint( $input[ $k ] );
			if ( $id && ! wp_attachment_is_image( $id ) ) {
				$errors[ $k ] = __( 'Choose an image from the media library.', 'dolly-employee-management' );
				continue;
			}
			$new[ $k ] = $id;
		}

		if ( isset( $input['font_custom'] ) ) {
			// A CSS font-family list: names, quotes, commas, spaces and hyphens only.
			$new['font_custom'] = mb_substr( trim( preg_replace( '/[^A-Za-z0-9 ,"\'\-]/', '', (string) $input['font_custom'] ) ), 0, 200 );
		}
		if ( isset( $input['font_url'] ) ) {
			$v = trim( (string) $input['font_url'] );
			if ( '' !== $v && ( 0 !== strpos( $v, 'https://' ) || ! wp_http_validate_url( $v ) ) ) {
				$errors['font_url'] = __( 'Invalid address: it must start with https://.', 'dolly-employee-management' );
			} else {
				$new['font_url'] = esc_url_raw( $v );
			}
		}
		if ( 'custom' === $new['font_family'] && '' === $new['font_custom'] && ! isset( $errors['font_custom'] ) && isset( $input['font_family'] ) ) {
			$errors['font_custom'] = __( 'Enter the font name (e.g. "Inter", sans-serif).', 'dolly-employee-management' );
		}
		if ( isset( $input['custom_css'] ) ) {
			$new['custom_css'] = self::clean_css( (string) $input['custom_css'] );
		}
		return array( $new, $errors );
	}

	/** Saves a partial input. Returns the full settings or a WP_Error with field errors. */
	public static function update( array $input ) {
		$current          = self::all();
		list( $new, $err ) = self::sanitize( $input, $current );
		if ( $err ) {
			return new WP_Error( 'dolly_invalid', __( 'Check the highlighted fields.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => $err ) );
		}
		update_option( self::OPTION, $new, false );
		self::audit( $current, $new );
		return $new;
	}

	public static function reset() {
		$current = self::all();
		delete_option( self::OPTION );
		self::audit( $current, self::defaults() );
		return self::all();
	}

	private static function audit( $before, $after ) {
		$changed = array();
		foreach ( $after as $k => $v ) {
			if ( $before[ $k ] !== $v ) {
				$changed[ $k ] = array( $before[ $k ], $v );
			}
		}
		if ( $changed ) {
			Dolly_Audit::log( 'appearance_updated', 'settings', 0, 0, '', wp_list_pluck( $changed, 0 ), wp_list_pluck( $changed, 1 ) );
		}
	}

	/* ---------- Texts used across the plugin ---------- */

	public static function brand() {
		return (string) self::get( 'brand_name' );
	}

	/** Full application name (home screen, browser title): defaults to "<brand> · <portal subtitle>". */
	public static function app_name() {
		$name = (string) self::get( 'app_name' );
		if ( '' !== $name ) {
			return $name;
		}
		$sub = (string) self::get( 'portal_subtitle' );
		return self::brand() . ( '' !== $sub ? ' · ' . $sub : '' );
	}

	public static function email_subject( $title ) {
		$prefix = (string) self::get( 'email_subject_prefix' );
		$prefix = '' !== $prefix ? $prefix : '[' . self::brand() . ']';
		return $prefix . ' ' . $title;
	}

	public static function email_signature() {
		$sig = (string) self::get( 'email_signature' );
		return '' !== $sig ? $sig : '— ' . self::app_name();
	}

	/** Extra wp_mail() headers for the sender configured in Appearance › Email. */
	public static function email_headers() {
		$name  = (string) self::get( 'email_from_name' );
		$email = (string) self::get( 'email_from_email' );
		if ( '' === $email ) {
			return array();
		}
		$name = str_replace( array( '"', "\r", "\n" ), '', $name );
		return array( 'From: ' . ( '' !== $name ? '"' . $name . '" <' . $email . '>' : $email ) );
	}

	/** Sender name only (no address configured): applied through the wp_mail_from_name filter while sending. */
	public static function from_name_filter( $name ) {
		$custom = (string) self::get( 'email_from_name' );
		return '' !== $custom ? $custom : $name;
	}

	/* ---------- Images ---------- */

	private static function image_url( $key, $size = 'medium' ) {
		$id = (int) self::get( $key );
		if ( ! $id ) {
			return '';
		}
		$url = wp_get_attachment_image_url( $id, $size );
		return $url ? $url : '';
	}

	/** Logo on light surfaces (login card). Empty: the text wordmark is used. */
	public static function logo_url() {
		$url = self::image_url( 'logo_id' );
		if ( ! $url && ! get_option( self::OPTION ) ) {
			// Before version 1.9 the logo was stored with the other settings.
			$legacy = (int) Dolly_Settings::get( 'logo_id' );
			$url    = $legacy ? (string) wp_get_attachment_image_url( $legacy, 'medium' ) : '';
		}
		return $url;
	}

	/** Logo on the colored header (top bar, admin header, workplace display). Falls back to the main logo. */
	public static function header_logo_url() {
		$url = self::image_url( 'logo_header_id' );
		return $url ? $url : self::logo_url();
	}

	/** Home screen / notification icon of the given size, or '' to use the site icon or the bundled one. */
	public static function app_icon_url( $size ) {
		$id = (int) self::get( 'app_icon_id' );
		if ( ! $id ) {
			return '';
		}
		$url = wp_get_attachment_image_url( $id, array( $size, $size ) );
		return $url ? $url : '';
	}

	public static function login_bg_url() {
		return self::image_url( 'login_bg_id', 'full' );
	}

	/** Everything the browser code needs to draw the brand. */
	public static function js_config() {
		return array(
			'brand'        => self::brand(),
			'appName'      => self::app_name(),
			'logo'         => self::logo_url(),
			'logoHeader'   => self::header_logo_url(),
			'wordmarkMark' => (bool) self::get( 'wordmark_mark' ),
		);
	}

	/* ---------- CSS ---------- */

	/** Stylesheet URL of the custom font, if any. */
	public static function font_url() {
		$a = self::all();
		return 'custom' === $a['font_family'] ? (string) $a['font_url'] : '';
	}

	/**
	 * CSS for the given settings.
	 *
	 * @param array  $a        Settings.
	 * @param string $context  "front" (portal, login, workplace display), "admin" or "preview".
	 * @param string $scope    Selector receiving the tokens (":root", or the preview container).
	 */
	public static function css( array $a = null, $context = 'front', $scope = ':root' ) {
		$a     = $a ? $a : self::all();
		$light = self::palette( $a, false );
		$dark  = self::palette( $a, true );
		$base  = self::base_tokens( $a );

		$css = $scope . '{' . self::declarations( array_merge( $base, $light ) ) . 'color-scheme:light;}';
		if ( 'preview' === $context ) {
			$css .= $scope . '.is-dark{' . self::declarations( $dark ) . 'color-scheme:dark;}';
			return $css;
		}
		if ( 'front' === $context ) {
			$size = self::TEXT_SIZES[ $a['text_size'] ][1];
			if ( 100.0 !== (float) $size ) {
				$css .= 'html{font-size:' . $size . '%;}';
			}
			$dark_css = $scope . '{' . self::declarations( $dark ) . 'color-scheme:dark;}';
			if ( 'dark' === $a['color_scheme'] ) {
				$css .= $dark_css;
			} elseif ( 'auto' === $a['color_scheme'] ) {
				$css .= '@media (prefers-color-scheme: dark){' . $dark_css . '}';
			}
			$bg = self::login_bg_url();
			if ( $bg ) {
				$css .= '.dolly-app.dolly-auth{background-image:url("' . esc_url_raw( $bg ) . '");background-size:cover;background-position:center;}';
			}
		}
		return $css;
	}

	/** Custom CSS typed by the administrator (front-end pages only). */
	public static function custom_css() {
		return (string) self::get( 'custom_css' );
	}

	private static function declarations( array $tokens ) {
		$out = '';
		foreach ( $tokens as $k => $v ) {
			$out .= '--dolly-' . $k . ':' . $v . ';';
		}
		return $out;
	}

	/** Tokens that do not depend on light or dark mode. */
	private static function base_tokens( array $a ) {
		$font = 'custom' === $a['font_family'] && '' !== $a['font_custom'] ? $a['font_custom'] . ', ' . self::FONTS['system'][1] : self::FONTS[ isset( self::FONTS[ $a['font_family'] ] ) && 'custom' !== $a['font_family'] ? $a['font_family'] : 'system' ][1];
		$r     = (int) $a['radius'];
		$space = 'compact' === $a['density'] ? array( 6, 12, 16, 24, 32 ) : array( 8, 16, 24, 32, 40 );
		$btn   = array(
			'rounded' => max( 0, (int) round( $r * 2 / 3 ) ) . 'px',
			'pill'    => '999px',
			'square'  => '0px',
		);
		$shadows = array(
			'none'   => 'none',
			'subtle' => '0 1px 2px rgba(15,23,42,.06), 0 4px 16px rgba(15,23,42,.06)',
			'medium' => '0 1px 3px rgba(15,23,42,.10), 0 10px 30px rgba(15,23,42,.12)',
		);
		$t = array(
			'font'           => $font,
			'heading-weight' => (int) $a['heading_weight'],
			'radius'         => $r . 'px',
			'radius-sm'      => (int) round( $r * 2 / 3 ) . 'px',
			'radius-lg'      => ( $r + 4 ) . 'px',
			'btn-radius'     => $btn[ $a['button_shape'] ],
			'shadow'         => $shadows[ $a['shadow'] ],
			'logo-height'    => (int) $a['logo_height'] . 'px',
			'touch'          => 'compact' === $a['density'] ? '40px' : '44px',
			'wordmark-mark'  => $a['wordmark_mark'] ? 'inline-block' : 'none',
		);
		foreach ( $space as $i => $px ) {
			$t[ 's' . ( $i + 1 ) ] = $px . 'px';
		}
		return $t;
	}

	/**
	 * Color tokens for light or dark mode. The stylesheet only uses these names;
	 * the "green/amber/red/blue" names are the success/warning/danger/info colors.
	 */
	public static function palette( array $a, $dark ) {
		$bg      = $dark ? $a['dark_background'] : $a['background'];
		$surface = $dark ? $a['dark_surface'] : $a['surface'];
		$text    = $dark ? $a['dark_text'] : $a['text'];
		$muted   = $dark ? $a['dark_muted'] : $a['muted'];
		$border  = $dark ? $a['dark_border'] : $a['border'];

		// On dark surfaces the brand colors are lightened so links and active states stay readable.
		$primary = $dark ? self::mix( '#FFFFFF', $a['primary'], .25 ) : $a['primary'];
		$accent  = $dark ? self::mix( '#FFFFFF', $a['accent'], .25 ) : $a['accent'];
		$header  = $dark ? self::mix( '#000000', $a['header_bg'], .35 ) : $a['header_bg'];
		$htext   = self::on( $header );

		$t = array(
			'primary'       => $primary,
			'primary-hover' => self::mix( $dark ? '#FFFFFF' : '#000000', $primary, .15 ),
			'primary-soft'  => self::mix( $primary, $surface, $dark ? .20 : .10 ),
			'on-primary'    => self::on( $primary ),
			'accent'        => $accent,
			'accent-hover'  => self::mix( $dark ? '#FFFFFF' : '#000000', $accent, .12 ),
			'accent-soft'   => self::mix( $accent, $surface, $dark ? .22 : .12 ),
			'on-accent'     => self::on( $accent ),
			'header-bg'     => $header,
			'header-text'   => $htext,
			'header-muted'  => self::mix( $htext, $header, .78 ),
			'header-hover'  => self::mix( $htext, $header, .14 ),
			'header-line'   => self::mix( $htext, $header, .45 ),
			'bg'            => $bg,
			'surface'       => $surface,
			'surface-2'     => self::mix( $text, $surface, .04 ),
			'surface-3'     => self::mix( $text, $surface, .08 ),
			'text'          => $text,
			'heading'       => $text,
			'muted'         => $muted,
			'border'        => $border,
			'border-strong' => self::mix( $text, $border, .18 ),
			'track'         => self::mix( $text, $surface, .32 ),
			'focus'         => $primary,
			'focus-ring'    => self::mix( $accent, $surface, .35 ),
		);
		$status = array(
			'green' => $a['success'],
			'amber' => $a['warning'],
			'red'   => $a['danger'],
			'blue'  => $a['info'],
		);
		foreach ( $status as $name => $c ) {
			$t[ $name ]               = $dark ? self::mix( '#FFFFFF', $c, .55 ) : $c;
			$t[ $name . '-bg' ]       = self::mix( $c, $surface, $dark ? .20 : .10 );
			$t[ $name . '-border' ]   = self::mix( $c, $surface, $dark ? .45 : .28 );
			$t[ $name . '-solid' ]    = $c;
			$t[ 'on-' . $name ]       = self::on( $c );
		}
		foreach ( self::CATEGORY_HUES as $name => $c ) {
			$t[ 'cat-' . $name ]        = $dark ? self::mix( '#FFFFFF', $c, .55 ) : $c;
			$t[ 'cat-' . $name . '-bg' ] = self::mix( $c, $surface, $dark ? .22 : .11 );
		}
		return $t;
	}

	/* ---------- Color helpers ---------- */

	/** Normalizes "#abc" / "abc" / "#AABBCC" to "#AABBCC"; returns '' when invalid. */
	public static function hex( $value ) {
		$v = ltrim( trim( (string) $value ), '#' );
		if ( preg_match( '/^[0-9a-fA-F]{3}$/', $v ) ) {
			$v = $v[0] . $v[0] . $v[1] . $v[1] . $v[2] . $v[2];
		}
		return preg_match( '/^[0-9a-fA-F]{6}$/', $v ) ? '#' . strtoupper( $v ) : '';
	}

	private static function rgb( $hex ) {
		$hex = ltrim( $hex, '#' );
		return array( hexdec( substr( $hex, 0, 2 ) ), hexdec( substr( $hex, 2, 2 ) ), hexdec( substr( $hex, 4, 2 ) ) );
	}

	/** Mixes $weight of color $a into color $b (0 = $b, 1 = $a). */
	public static function mix( $a, $b, $weight ) {
		$x   = self::rgb( $a );
		$y   = self::rgb( $b );
		$out = '#';
		for ( $i = 0; $i < 3; $i++ ) {
			$out .= sprintf( '%02X', (int) round( $x[ $i ] * $weight + $y[ $i ] * ( 1 - $weight ) ) );
		}
		return $out;
	}

	/** WCAG relative luminance. */
	public static function luminance( $hex ) {
		$l = array();
		foreach ( self::rgb( $hex ) as $c ) {
			$c   = $c / 255;
			$l[] = $c <= 0.03928 ? $c / 12.92 : pow( ( $c + 0.055 ) / 1.055, 2.4 );
		}
		return 0.2126 * $l[0] + 0.7152 * $l[1] + 0.0722 * $l[2];
	}

	public static function contrast( $a, $b ) {
		$la = self::luminance( $a );
		$lb = self::luminance( $b );
		return ( max( $la, $lb ) + 0.05 ) / ( min( $la, $lb ) + 0.05 );
	}

	/**
	 * Text color on the given background: white whenever it reaches 3:1 (bold button and header text),
	 * as on most brand colors; near black on light colors. contrast_report() flags values under 4.5:1.
	 */
	public static function on( $bg ) {
		return self::contrast( '#FFFFFF', $bg ) >= 3 ? '#FFFFFF' : '#0F172A';
	}

	/** Contrast checks shown next to the color pickers. */
	public static function contrast_report( array $a ) {
		$p = self::palette( $a, false );
		return array(
			'primary'    => round( self::contrast( $p['primary'], $p['surface'] ), 2 ),
			'on_primary' => round( self::contrast( $p['on-primary'], $p['primary'] ), 2 ),
			'header'     => round( self::contrast( $p['header-text'], $p['header-bg'] ), 2 ),
			'text'       => round( self::contrast( $p['text'], $p['bg'] ), 2 ),
			'muted'      => round( self::contrast( $p['muted'], $p['surface'] ), 2 ),
		);
	}

	/**
	 * Custom CSS cannot close the <style> element it is printed in.
	 */
	private static function clean_css( $css ) {
		$css = wp_strip_all_tags( $css );
		$css = str_ireplace( array( '</style', '<style' ), '', $css );
		return mb_substr( $css, 0, 20000 );
	}

	/* ---------- Choices for the settings screen ---------- */

	public static function choices() {
		$labels = function ( $list ) {
			$out = array();
			foreach ( $list as $k => $v ) {
				$out[ $k ] = Dolly_I18n::t( is_array( $v ) ? $v[0] : $v );
			}
			return $out;
		};
		return array(
			'schemes'         => $labels( self::SCHEMES ),
			'fonts'           => $labels( self::FONTS ),
			'text_sizes'      => $labels( self::TEXT_SIZES ),
			'heading_weights' => self::HEADING_WEIGHTS,
			'button_shapes'   => $labels( self::BUTTON_SHAPES ),
			'shadows'         => $labels( self::SHADOWS ),
			'densities'       => $labels( self::DENSITIES ),
		);
	}
}
