<?php
/**
 * "Gestione Dipendenti" administration menu. Screens are rendered by assets/js/dolly-admin.js
 * on top of the REST API; styles are scoped to .dolly-app so other WordPress screens are unaffected.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Admin {

	const PAGES = array(
		'dolly-dashboard'    => array( 'Dashboard', 'dashboard' ),
		'dolly-employees'    => array( 'Dipendenti', 'employees' ),
		'dolly-employee-new' => array( 'Nuovo dipendente', 'employee-new' ),
		'dolly-workplaces'   => array( 'Sedi', 'workplaces' ),
		'dolly-requests'     => array( 'Richieste', 'requests' ),
		'dolly-attendance'   => array( 'Presenze', 'attendance' ),
		'dolly-documents'    => array( 'Documenti', 'documents' ),
		'dolly-analytics'    => array( 'Analytics', 'analytics' ),
		'dolly-anomalies'    => array( 'Anomalie', 'anomalies' ),
		'dolly-broadcast'    => array( 'Broadcast', 'broadcast' ),
		'dolly-exports'      => array( 'Esportazioni', 'exports' ),
		'dolly-appearance'   => array( 'Aspetto', 'appearance' ),
		'dolly-settings'     => array( 'Impostazioni', 'settings' ),
	);

	/** Pages outside the menus: the guided setup is opened after activation and from Impostazioni. */
	const HIDDEN = array(
		'dolly-onboarding' => array( 'Configurazione guidata', 'onboarding' ),
	);

	private static function page_info( $page ) {
		return self::PAGES[ $page ] ?? self::HIDDEN[ $page ] ?? null;
	}

	private static $hooks = array();

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_filter( 'admin_body_class', array( __CLASS__, 'body_class' ) );
		add_action( 'admin_head', array( __CLASS__, 'restore_menu_state' ) );
	}

	/**
	 * Applies the "WordPress side menu hidden" preference before the first paint (no flicker).
	 * The preference is kept in this browser only.
	 */
	public static function restore_menu_state() {
		if ( ! self::current_page() ) {
			return;
		}
		echo "<script>try{if(window.localStorage.getItem('dolly_wpmenu_hidden')==='1'){document.documentElement.classList.add('dolly-wpmenu-hidden');}}catch(e){}</script>\n";
	}

	public static function menu() {
		$pending = Dolly_Requests::count_pending() + Dolly_Anomalies::count_open();
		$badge   = $pending ? ' <span class="awaiting-mod count-' . (int) $pending . '"><span class="pending-count">' . (int) $pending . '</span></span>' : '';
		$title         = Dolly_Appearance::get( 'admin_title' );
		self::$hooks[] = add_menu_page( $title, esc_html( $title ) . $badge, 'dolly_manage', 'dolly-dashboard', array( __CLASS__, 'render' ), 'dashicons-groups', 3 );
		foreach ( self::PAGES as $slug => $p ) {
			self::$hooks[] = add_submenu_page( 'dolly-dashboard', Dolly_I18n::t( $p[0] ) . ' · ' . $title, Dolly_I18n::t( $p[0] ), 'dolly_manage', $slug, array( __CLASS__, 'render' ) );
		}
		foreach ( self::HIDDEN as $slug => $p ) {
			self::$hooks[] = add_submenu_page( '', Dolly_I18n::t( $p[0] ) . ' · ' . $title, Dolly_I18n::t( $p[0] ), 'dolly_manage', $slug, array( __CLASS__, 'render' ) );
		}
	}

	private static function current_page() {
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : ''; // phpcs:ignore
		return self::page_info( $page ) ? $page : '';
	}

	public static function body_class( $classes ) {
		return self::current_page() ? $classes . ' dolly-admin-screen' : $classes;
	}

	public static function assets( $hook ) {
		$page = self::current_page();
		if ( ! $page || ! current_user_can( 'dolly_manage' ) ) {
			return;
		}
		Dolly_Frontend::register_shared_assets();
		wp_enqueue_style( 'dolly-ui' );
		wp_enqueue_style( 'dolly-admin', DOLLY_URL . 'assets/css/dolly-admin.css', array( 'dolly-ui' ), DOLLY_VERSION );
		// Administration screens always use the light palette; dark mode is for the portal.
		wp_add_inline_style( 'dolly-admin', Dolly_Appearance::css( null, 'admin' ) );
		Dolly_Frontend::enqueue_font();
		$deps = array( 'dolly-core' );
		if ( 'dolly-dashboard' === $page ) {
			$deps[] = 'dolly-fullcalendar-it';
			$deps[] = 'dolly-chartjs';
		}
		if ( 'dolly-analytics' === $page ) {
			$deps[] = 'dolly-chartjs';
		}
		if ( 'dolly-appearance' === $page || 'dolly-onboarding' === $page ) {
			wp_enqueue_media();
		}
		if ( 'dolly-workplaces' === $page || 'dolly-onboarding' === $page ) {
			// Map for the position of the workplaces.
			wp_enqueue_style( 'dolly-leaflet', DOLLY_URL . 'assets/vendor/leaflet/leaflet.css', array(), '1.9.4' );
			wp_enqueue_script( 'dolly-leaflet', DOLLY_URL . 'assets/vendor/leaflet/leaflet.js', array(), '1.9.4', true );
			$deps[] = 'dolly-leaflet';
		}
		wp_enqueue_script( 'dolly-admin', DOLLY_URL . 'assets/js/dolly-admin.js', $deps, DOLLY_VERSION, true );
		$pages = array();
		foreach ( array_merge( self::PAGES, self::HIDDEN ) as $slug => $p ) {
			$pages[ $p[1] ] = admin_url( 'admin.php?page=' . $slug );
		}
		wp_localize_script(
			'dolly-core',
			'DOLLY_CONFIG',
			Dolly_Frontend::js_config(
				array(
					'view'       => 'admin',
					'page'       => self::page_info( $page )[1],
					'onboarding' => Dolly_Onboarding::client_config(),
					'pages'      => $pages,
					'workplaces' => array_map( array( 'Dolly_Workplaces', 'format' ), Dolly_Workplaces::all() ),
					'today'      => Dolly_Time::today(),
					'months'     => array_values( Dolly_I18n::labels( Dolly_Time::MONTHS ) ),
					'weekdays'   => array_values( Dolly_I18n::labels( Dolly_Time::WEEKDAYS ) ),
					'defaultRadius' => (int) Dolly_Settings::get( 'default_radius' ),
					'lateTolerance' => (int) Dolly_Settings::get( 'late_tolerance' ),
					'holidayIncrease' => (int) Dolly_Settings::get( 'holiday_increase' ),
					'firmwareUrl'     => 'https://github.com/blackat5445/Dolly-employee-management/tree/main/firmware',
					'map'             => self::map_config(),
				)
			)
		);
	}

	/**
	 * Map tiles and address search used to place the workplaces (OpenStreetMap by default).
	 * Filter dolly_map: array( 'tiles' => URL template, 'attribution' => HTML, 'geocoder' => Nominatim-compatible URL ).
	 */
	private static function map_config() {
		return apply_filters(
			'dolly_map',
			array(
				'tiles'       => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
				'attribution' => '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
				'geocoder'    => 'https://nominatim.openstreetmap.org/search',
			)
		);
	}

	public static function render() {
		$page = self::current_page();
		if ( ! current_user_can( 'dolly_manage' ) || ! $page ) {
			wp_die( esc_html__( 'Non autorizzato.', 'dolly-employee-management' ) );
		}
		$title = Dolly_I18n::t( self::page_info( $page )[0] );
		?>
		<div class="wrap dolly-wrap">
			<div class="dolly-app dolly-admin" id="dolly-admin-app" data-page="<?php echo esc_attr( self::page_info( $page )[1] ); ?>">
				<header class="dolly-admin__header">
					<button type="button" class="dolly-btn dolly-btn--ghost dolly-btn--icon dolly-admin__menu-toggle" id="dolly-menu-toggle" aria-controls="adminmenumain" aria-pressed="false" aria-label="<?php esc_attr_e( 'Nascondi il menu laterale', 'dolly-employee-management' ); ?>" title="<?php esc_attr_e( 'Nascondi il menu laterale', 'dolly-employee-management' ); ?>"><i data-lucide="panel-left-close" aria-hidden="true"></i></button>
					<div class="dolly-admin__brand"><?php Dolly_Frontend::brand( Dolly_Appearance::get( 'admin_title' ), true ); ?></div>
					<h1 class="dolly-admin__title"><?php echo esc_html( $title ); ?></h1>
				</header>
				<nav class="dolly-admin__nav"<?php echo isset( self::HIDDEN[ $page ] ) ? ' hidden' : ''; ?> aria-label="<?php echo esc_attr( __( 'Sezioni ', 'dolly-employee-management' ) . Dolly_Appearance::get( 'admin_title' ) ); ?>">
					<?php
					$icons = array(
						'dolly-dashboard'    => 'layout-dashboard',
						'dolly-employees'    => 'users',
						'dolly-employee-new' => 'user-plus',
						'dolly-workplaces'   => 'map-pin',
						'dolly-requests'     => 'inbox',
						'dolly-attendance'   => 'calendar-days',
					'dolly-documents'    => 'folder-open',
						'dolly-analytics'    => 'chart-line',
						'dolly-anomalies'    => 'triangle-alert',
						'dolly-broadcast'    => 'megaphone',
						'dolly-exports'      => 'download',
						'dolly-appearance'   => 'palette',
						'dolly-settings'     => 'settings',
					);
					foreach ( self::PAGES as $slug => $p ) {
						printf(
							'<a class="dolly-admin__navlink%1$s" href="%2$s"%3$s><i data-lucide="%4$s" aria-hidden="true"></i><span>%5$s</span></a>',
							$slug === $page ? ' is-active' : '',
							esc_url( admin_url( 'admin.php?page=' . $slug ) ),
							$slug === $page ? ' aria-current="page"' : '',
							esc_attr( $icons[ $slug ] ),
							esc_html( Dolly_I18n::t( $p[0] ) )
						);
					}
					?>
				</nav>
				<main class="dolly-admin__main" id="dolly-admin-main" tabindex="-1">
					<div class="dolly-loading"><span class="dolly-spinner" aria-hidden="true"></span><span><?php esc_html_e( 'Caricamento…', 'dolly-employee-management' ); ?></span></div>
				</main>
				<noscript><div class="dolly-alert dolly-alert--error"><?php esc_html_e( 'Per usare il pannello è necessario JavaScript.', 'dolly-employee-management' ); ?></div></noscript>
			</div>
		</div>
		<?php
	}
}
