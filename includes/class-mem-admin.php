<?php
/**
 * "Gestione Dipendenti" administration menu. Screens are rendered by assets/js/mem-admin.js
 * on top of the REST API; styles are scoped to .mem-app so other WordPress screens are unaffected.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class MEM_Admin {

	const PAGES = array(
		'mem-dashboard'    => array( 'Dashboard', 'dashboard' ),
		'mem-employees'    => array( 'Dipendenti', 'employees' ),
		'mem-employee-new' => array( 'Nuovo dipendente', 'employee-new' ),
		'mem-workplaces'   => array( 'Sedi', 'workplaces' ),
		'mem-requests'     => array( 'Richieste', 'requests' ),
		'mem-attendance'   => array( 'Presenze', 'attendance' ),
		'mem-analytics'    => array( 'Analytics', 'analytics' ),
		'mem-anomalies'    => array( 'Anomalie', 'anomalies' ),
		'mem-broadcast'    => array( 'Broadcast', 'broadcast' ),
		'mem-exports'      => array( 'Esportazioni', 'exports' ),
		'mem-settings'     => array( 'Impostazioni', 'settings' ),
	);

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
		echo "<script>try{if(window.localStorage.getItem('mem_wpmenu_hidden')==='1'){document.documentElement.classList.add('mem-wpmenu-hidden');}}catch(e){}</script>\n";
	}

	public static function menu() {
		$pending = MEM_Requests::count_pending() + MEM_Anomalies::count_open();
		$badge   = $pending ? ' <span class="awaiting-mod count-' . (int) $pending . '"><span class="pending-count">' . (int) $pending . '</span></span>' : '';
		self::$hooks[] = add_menu_page( 'Gestione Dipendenti', 'Gestione Dipendenti' . $badge, 'mem_manage', 'mem-dashboard', array( __CLASS__, 'render' ), 'dashicons-groups', 3 );
		foreach ( self::PAGES as $slug => $p ) {
			self::$hooks[] = add_submenu_page( 'mem-dashboard', $p[0] . ' · Gestione Dipendenti', $p[0], 'mem_manage', $slug, array( __CLASS__, 'render' ) );
		}
	}

	private static function current_page() {
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : ''; // phpcs:ignore
		return isset( self::PAGES[ $page ] ) ? $page : '';
	}

	public static function body_class( $classes ) {
		return self::current_page() ? $classes . ' mem-admin-screen' : $classes;
	}

	public static function assets( $hook ) {
		$page = self::current_page();
		if ( ! $page || ! current_user_can( 'mem_manage' ) ) {
			return;
		}
		MEM_Frontend::register_shared_assets();
		wp_enqueue_style( 'mem-ui' );
		wp_enqueue_style( 'mem-admin', MEM_URL . 'assets/css/mem-admin.css', array( 'mem-ui' ), MEM_VERSION );
		$deps = array( 'mem-core' );
		if ( 'mem-dashboard' === $page ) {
			$deps[] = 'mem-fullcalendar-it';
			$deps[] = 'mem-chartjs';
		}
		if ( 'mem-analytics' === $page ) {
			$deps[] = 'mem-chartjs';
		}
		if ( 'mem-settings' === $page ) {
			wp_enqueue_media();
		}
		wp_enqueue_script( 'mem-admin', MEM_URL . 'assets/js/mem-admin.js', $deps, MEM_VERSION, true );
		$pages = array();
		foreach ( self::PAGES as $slug => $p ) {
			$pages[ $p[1] ] = admin_url( 'admin.php?page=' . $slug );
		}
		wp_localize_script(
			'mem-core',
			'MEM_CONFIG',
			MEM_Frontend::js_config(
				array(
					'view'       => 'admin',
					'page'       => self::PAGES[ $page ][1],
					'pages'      => $pages,
					'workplaces' => array_map( array( 'MEM_Workplaces', 'format' ), MEM_Workplaces::all() ),
					'today'      => MEM_Time::today(),
					'months'     => array_values( MEM_Time::MONTHS ),
					'weekdays'   => array_values( MEM_Time::WEEKDAYS ),
					'defaultRadius' => (int) MEM_Settings::get( 'default_radius' ),
					'lateTolerance' => (int) MEM_Settings::get( 'late_tolerance' ),
					'holidayIncrease' => (int) MEM_Settings::get( 'holiday_increase' ),
				)
			)
		);
	}

	public static function render() {
		$page = self::current_page();
		if ( ! current_user_can( 'mem_manage' ) || ! $page ) {
			wp_die( esc_html__( 'Non autorizzato.', 'dolly-employee-management' ) );
		}
		$title = self::PAGES[ $page ][0];
		?>
		<div class="wrap mem-wrap">
			<div class="mem-app mem-admin" id="mem-admin-app" data-page="<?php echo esc_attr( self::PAGES[ $page ][1] ); ?>">
				<header class="mem-admin__header">
					<button type="button" class="mem-btn mem-btn--ghost mem-btn--icon mem-admin__menu-toggle" id="mem-menu-toggle" aria-controls="adminmenumain" aria-pressed="false" aria-label="Nascondi il menu laterale" title="Nascondi il menu laterale"><i data-lucide="panel-left-close" aria-hidden="true"></i></button>
					<div class="mem-admin__brand"><?php MEM_Frontend::brand( 'Gestione Dipendenti' ); ?></div>
					<h1 class="mem-admin__title"><?php echo esc_html( $title ); ?></h1>
				</header>
				<nav class="mem-admin__nav" aria-label="Sezioni Gestione Dipendenti">
					<?php
					$icons = array(
						'mem-dashboard'    => 'layout-dashboard',
						'mem-employees'    => 'users',
						'mem-employee-new' => 'user-plus',
						'mem-workplaces'   => 'map-pin',
						'mem-requests'     => 'inbox',
						'mem-attendance'   => 'calendar-days',
						'mem-analytics'    => 'chart-line',
						'mem-anomalies'    => 'triangle-alert',
						'mem-broadcast'    => 'megaphone',
						'mem-exports'      => 'download',
						'mem-settings'     => 'settings',
					);
					foreach ( self::PAGES as $slug => $p ) {
						printf(
							'<a class="mem-admin__navlink%1$s" href="%2$s"%3$s><i data-lucide="%4$s" aria-hidden="true"></i><span>%5$s</span></a>',
							$slug === $page ? ' is-active' : '',
							esc_url( admin_url( 'admin.php?page=' . $slug ) ),
							$slug === $page ? ' aria-current="page"' : '',
							esc_attr( $icons[ $slug ] ),
							esc_html( $p[0] )
						);
					}
					?>
				</nav>
				<main class="mem-admin__main" id="mem-admin-main" tabindex="-1">
					<div class="mem-loading"><span class="mem-spinner" aria-hidden="true"></span><span>Caricamento…</span></div>
				</main>
				<noscript><div class="mem-alert mem-alert--error">Per usare la Gestione Dipendenti è necessario JavaScript.</div></noscript>
			</div>
		</div>
		<?php
	}
}
