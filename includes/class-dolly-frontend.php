<?php
/**
 * Front-end routes: login pages, password recovery, employee portal and workplace display.
 *
 * The plugin owns the behaviour; the active theme may provide the layout through
 * templates in "dolly/{view}.php". Plugin fallbacks exist, so the application keeps
 * working with any theme.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Frontend {

	const VIEWS = array(
		'accesso'           => 'login',
		'accesso-sede'      => 'login-sede',
		'recupero-password' => 'recupero-password',
		'portale'           => 'portale',
		'sede'              => 'sede',
		'esci'              => 'esci',
	);

	private static $messages = array();

	public static function init() {
		add_action( 'init', array( __CLASS__, 'add_rewrites' ) );
		add_filter( 'query_vars', array( __CLASS__, 'query_vars' ) );
		add_action( 'template_redirect', array( __CLASS__, 'route' ), 1 );
		add_filter( 'template_include', array( __CLASS__, 'template' ), 99 );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_filter( 'document_title_parts', array( __CLASS__, 'title' ) );
		add_filter( 'script_loader_tag', array( __CLASS__, 'defer_vendor' ), 10, 2 );
	}

	public static function add_rewrites() {
		foreach ( self::VIEWS as $slug => $view ) {
			add_rewrite_rule( '^' . $slug . '/?$', 'index.php?dolly_view=' . $view, 'top' );
		}
	}

	public static function query_vars( $vars ) {
		$vars[] = 'dolly_view';
		return $vars;
	}

	public static function current_view() {
		return (string) get_query_var( 'dolly_view' );
	}

	public static function url( $view ) {
		$slug = array_search( $view, self::VIEWS, true );
		return home_url( '/' . $slug . '/' );
	}

	public static function title( $parts ) {
		$titles = array(
			'login'             => 'Accesso dipendenti',
			'login-sede'        => 'Accesso sede',
			'recupero-password' => 'Recupero password',
			'portale'           => 'Portale dipendenti',
			'sede'              => 'Codice presenze sede',
		);
		$v = self::current_view();
		if ( isset( $titles[ $v ] ) ) {
			$parts['title'] = $titles[ $v ];
		}
		return $parts;
	}

	/** Access control, form handling and role-based redirects. */
	public static function route() {
		$view = self::current_view();
		$user = wp_get_current_user();

		if ( ! $view ) {
			if ( ( is_front_page() || is_home() ) && apply_filters( 'dolly_redirect_front_page', true ) ) {
				$target = Dolly_Auth::home_for( $user );
				// Logged-in users without a portal role map to the home page itself: avoid a redirect loop.
				if ( untrailingslashit( $target ) !== untrailingslashit( home_url( '/' ) ) ) {
					wp_safe_redirect( $target );
					exit;
				}
			}
			return;
		}
		nocache_headers();
		header( 'X-Frame-Options: SAMEORIGIN' );
		header( 'Referrer-Policy: same-origin' );

		switch ( $view ) {
			case 'esci':
				$target = $user->exists() && Dolly_Employees::is_workplace_account( $user->ID ) ? self::url( 'login-sede' ) : self::url( 'login' );
				if ( $user->exists() && isset( $_GET['_wpnonce'] ) && wp_verify_nonce( sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ), 'dolly_logout' ) ) {
					wp_logout();
				}
				wp_safe_redirect( add_query_arg( 'uscito', '1', $target ) );
				exit;

			case 'login':
			case 'login-sede':
				if ( $user->exists() && ! ( 'POST' === $_SERVER['REQUEST_METHOD'] ) ) { // phpcs:ignore
					wp_safe_redirect( Dolly_Auth::home_for( $user ) );
					exit;
				}
				if ( 'POST' === $_SERVER['REQUEST_METHOD'] ) { // phpcs:ignore
					self::handle_login( 'login-sede' === $view ? 'workplace' : 'employee' );
				} elseif ( 'login' === $view ) {
					// The session on this device was closed because the account is linked to another device.
					$blocked = Dolly_Devices::take_blocked_message();
					if ( $blocked ) {
						self::$messages[] = array( 'error', $blocked );
					}
				}
				break;

			case 'recupero-password':
				if ( 'POST' === $_SERVER['REQUEST_METHOD'] ) { // phpcs:ignore
					self::handle_lostpassword();
				}
				break;

			case 'portale':
				if ( ! $user->exists() ) {
					wp_safe_redirect( add_query_arg( 'redirect_to', rawurlencode( self::current_url() ), self::url( 'login' ) ) );
					exit;
				}
				if ( ! current_user_can( 'dolly_employee' ) || ! Dolly_Employees::is_active( $user->ID ) ) {
					wp_safe_redirect( Dolly_Auth::home_for( $user ) === self::url( 'portale' ) ? self::url( 'login' ) : Dolly_Auth::home_for( $user ) );
					exit;
				}
				break;

			case 'sede':
				if ( ! $user->exists() ) {
					wp_safe_redirect( self::url( 'login-sede' ) );
					exit;
				}
				if ( ! current_user_can( 'dolly_workplace' ) ) {
					wp_safe_redirect( Dolly_Auth::home_for( $user ) );
					exit;
				}
				break;
		}
	}

	private static function current_url() {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '/';
		return home_url( $uri );
	}

	private static function handle_login( $type ) {
		if ( ! isset( $_POST['dolly_login_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['dolly_login_nonce'] ) ), 'dolly_login_' . $type ) ) {
			self::$messages[] = array( 'error', 'Sessione del modulo scaduta. Riprova.' );
			return;
		}
		$login    = isset( $_POST['log'] ) ? sanitize_user( wp_unslash( $_POST['log'] ) ) : '';
		$password = isset( $_POST['pwd'] ) ? (string) wp_unslash( $_POST['pwd'] ) : ''; // phpcs:ignore
		$remember = 'workplace' === $type || ! empty( $_POST['rememberme'] );
		if ( '' === $login || '' === $password ) {
			self::$messages[] = array( 'error', 'Inserisci nome utente e password.' );
			return;
		}
		// Credentials and account type are checked before any session is created.
		$user = wp_authenticate( $login, $password );
		if ( is_wp_error( $user ) ) {
			$code = $user->get_error_code();
			if ( 'dolly_inactive' === $code ) {
				self::$messages[] = array( 'error', 'Account disattivato. Contatta l\'amministratore.' );
			} elseif ( 'dolly_device' === $code ) {
				// Device sessions: the account is linked to another device (its name is in the message).
				self::$messages[] = array( 'error', $user->get_error_message() );
			} else {
				self::$messages[] = array( 'error', 'Nome utente o password non corretti.' );
			}
			return;
		}
		$is_workplace = Dolly_Employees::is_workplace_account( $user->ID );
		if ( 'workplace' === $type && ! $is_workplace ) {
			self::$messages[] = array( 'error', 'Questa pagina è riservata agli account sede. I dipendenti accedono dalla pagina Accesso dipendenti.' );
			return;
		}
		if ( 'employee' === $type && $is_workplace ) {
			self::$messages[] = array( 'error', 'Gli account sede accedono dalla pagina Accesso sede.' );
			return;
		}
		wp_set_auth_cookie( $user->ID, $remember, is_ssl() );
		do_action( 'wp_login', $user->user_login, $user ); // phpcs:ignore
		$requested = isset( $_POST['redirect_to'] ) ? esc_url_raw( wp_unslash( $_POST['redirect_to'] ) ) : '';
		$target    = apply_filters( 'login_redirect', Dolly_Auth::home_for( $user ), $requested, $user );
		wp_safe_redirect( $target );
		exit;
	}

	private static function handle_lostpassword() {
		if ( ! isset( $_POST['dolly_lost_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['dolly_lost_nonce'] ) ), 'dolly_lostpassword' ) ) {
			self::$messages[] = array( 'error', 'Sessione del modulo scaduta. Riprova.' );
			return;
		}
		$login = isset( $_POST['user_login'] ) ? sanitize_text_field( wp_unslash( $_POST['user_login'] ) ) : '';
		if ( '' === $login ) {
			self::$messages[] = array( 'error', 'Inserisci il nome utente o l\'email.' );
			return;
		}
		// Throttle per IP to limit abuse.
		$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$key = 'dolly_lost_' . md5( $ip );
		$n   = (int) get_transient( $key );
		if ( $n >= 5 ) {
			self::$messages[] = array( 'error', 'Troppe richieste. Riprova tra 15 minuti.' );
			return;
		}
		set_transient( $key, $n + 1, 15 * MINUTE_IN_SECONDS );
		$user = is_email( $login ) ? get_user_by( 'email', $login ) : get_user_by( 'login', $login );
		if ( $user && ! Dolly_Employees::is_workplace_account( $user->ID ) && Dolly_Employees::is_active( $user->ID ) ) {
			retrieve_password( $user->user_login );
		}
		// Same message in every case: account existence is not disclosed.
		self::$messages[] = array( 'success', 'Se i dati corrispondono a un account attivo, riceverai un\'email con il link per impostare una nuova password.' );
	}

	public static function messages() {
		$out = self::$messages;
		if ( isset( $_GET['uscito'] ) ) { // phpcs:ignore
			$out[] = array( 'success', 'Sei uscito dal portale.' );
		}
		if ( ! is_ssl() && ! in_array( wp_get_environment_type(), array( 'local', 'development' ), true ) ) {
			$out[] = array( 'warning', 'Connessione non sicura: il portale richiede HTTPS per la posizione e la fotocamera.' );
		}
		return $out;
	}

	public static function template( $template ) {
		$view = self::current_view();
		if ( ! $view || 'esci' === $view ) {
			return $template;
		}
		$theme = locate_template( array( 'dolly/' . $view . '.php' ) );
		if ( $theme ) {
			return $theme;
		}
		return DOLLY_DIR . 'templates/fallback.php';
	}

	/* ---------- Assets ---------- */

	public static function register_shared_assets() {
		$v = DOLLY_VERSION;
		wp_register_style( 'dolly-ui', DOLLY_URL . 'assets/css/dolly-ui.css', array(), $v );
		wp_register_script( 'dolly-lucide', DOLLY_URL . 'assets/vendor/lucide/lucide.min.js', array(), '0.469.0', true );
		wp_register_script( 'dolly-core', DOLLY_URL . 'assets/js/dolly-core.js', array( 'dolly-lucide' ), $v, true );
		wp_register_script( 'dolly-fullcalendar', DOLLY_URL . 'assets/vendor/fullcalendar/index.global.min.js', array(), '6.1.15', true );
		wp_register_script( 'dolly-fullcalendar-it', DOLLY_URL . 'assets/vendor/fullcalendar/it.global.min.js', array( 'dolly-fullcalendar' ), '6.1.15', true );
		wp_register_script( 'dolly-jsqr', DOLLY_URL . 'assets/vendor/jsqr/jsQR.js', array(), '1.4.0', true );
		wp_register_script( 'dolly-qrcode', DOLLY_URL . 'assets/vendor/qrcode-generator/qrcode.js', array(), '1.4.4', true );
		wp_register_script( 'dolly-chartjs', DOLLY_URL . 'assets/vendor/chartjs/chart.umd.js', array(), '4.4.4', true );
	}

	public static function js_config( $extra = array() ) {
		$user = wp_get_current_user();
		return array_merge(
			array(
				'root'       => esc_url_raw( rest_url( DOLLY_REST_NS . '/' ) ),
				'nonce'      => wp_create_nonce( 'wp_rest' ),
				'logoutUrl'  => add_query_arg( '_wpnonce', wp_create_nonce( 'dolly_logout' ), self::url( 'esci' ) ),
				'portalUrl'  => self::url( 'portale' ),
				'userName'   => $user->exists() ? Dolly_Employees::display_name( $user->ID ) : '',
				'timezone'   => Dolly_Time::TZ,
				'serverTime' => time(),
				'displaySub' => Dolly_Appearance::get( 'display_subtitle' ),
			),
			Dolly_Appearance::js_config(),
			$extra
		);
	}

	/** Stylesheet of the custom font chosen in Appearance, if any. */
	public static function enqueue_font() {
		$url = Dolly_Appearance::font_url();
		if ( $url ) {
			wp_enqueue_style( 'dolly-font', $url, array(), null ); // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion
		}
	}

	public static function assets() {
		$view = self::current_view();
		if ( ! $view ) {
			return;
		}
		self::register_shared_assets();
		wp_enqueue_style( 'dolly-ui' );
		wp_add_inline_style( 'dolly-ui', Dolly_Appearance::css( null, 'front' ) . Dolly_Appearance::custom_css() );
		self::enqueue_font();
		wp_enqueue_script( 'dolly-core' );
		if ( 'portale' === $view ) {
			wp_enqueue_script( 'dolly-employee', DOLLY_URL . 'assets/js/dolly-employee.js', array( 'dolly-core', 'dolly-fullcalendar-it', 'dolly-jsqr' ), DOLLY_VERSION, true );
			wp_localize_script( 'dolly-core', 'DOLLY_CONFIG', self::js_config( array_merge( self::install_config(), array( 'view' => 'portale', 'push' => Dolly_Push::client_config() ) ) ) );
		} elseif ( 'sede' === $view ) {
			wp_enqueue_script( 'dolly-workplace', DOLLY_URL . 'assets/js/dolly-workplace.js', array( 'dolly-core', 'dolly-qrcode' ), DOLLY_VERSION, true );
			wp_localize_script( 'dolly-core', 'DOLLY_CONFIG', self::js_config( array( 'view' => 'sede', 'bluetooth' => Dolly_Bluetooth::client_config() ) ) );
		} elseif ( 'login' === $view ) {
			wp_localize_script( 'dolly-core', 'DOLLY_CONFIG', self::js_config( array_merge( self::install_config(), array( 'view' => $view ) ) ) );
		} else {
			wp_localize_script( 'dolly-core', 'DOLLY_CONFIG', self::js_config( array( 'view' => $view ) ) );
		}
	}

	/**
	 * Install-first setting for phones: before signing in, employees add the portal to the home screen
	 * (the service worker is registered on the login page so the browser offers the installation).
	 */
	private static function install_config() {
		$path = wp_parse_url( home_url( '/' ), PHP_URL_PATH );
		return array(
			'requireInstall' => (bool) Dolly_Settings::get( 'require_install' ),
			'sw'             => Dolly_Push::url( 'sw' ),
			'swScope'        => $path ? $path : '/',
		);
	}

	public static function defer_vendor( $tag, $handle ) {
		return $tag;
	}

	/* ---------- Rendering (used by theme templates and plugin fallbacks) ---------- */

	/**
	 * Brand mark: configured logo or the text wordmark.
	 *
	 * @param string $subtitle  Text next to the brand.
	 * @param bool   $on_header True on the colored header, which may use its own logo.
	 */
	public static function brand( $subtitle = '', $on_header = false ) {
		$logo = $on_header ? Dolly_Appearance::header_logo_url() : Dolly_Appearance::logo_url();
		$name = Dolly_Appearance::brand();
		echo '<div class="dolly-brand">';
		if ( $logo ) {
			echo '<img class="dolly-brand__logo" src="' . esc_url( $logo ) . '" alt="' . esc_attr( $name ) . '">';
		} else {
			echo '<span class="dolly-brand__wordmark">' . esc_html( $name ) . '</span>';
		}
		if ( $subtitle ) {
			echo '<span class="dolly-brand__sub">' . esc_html( $subtitle ) . '</span>';
		}
		echo '</div>';
	}

	private static function render_messages() {
		foreach ( self::messages() as $m ) {
			$icon = array( 'error' => 'circle-alert', 'success' => 'circle-check', 'warning' => 'triangle-alert' )[ $m[0] ] ?? 'info';
			printf(
				'<div class="dolly-alert dolly-alert--%1$s" role="%2$s"><i data-lucide="%3$s" aria-hidden="true"></i><span>%4$s</span></div>',
				esc_attr( $m[0] ),
				'error' === $m[0] ? 'alert' : 'status',
				esc_attr( $icon ),
				esc_html( $m[1] )
			);
		}
	}

	public static function render_view( $view = null ) {
		$view = $view ? $view : self::current_view();
		switch ( $view ) {
			case 'login':
			case 'login-sede':
				self::render_login( 'login-sede' === $view ? 'workplace' : 'employee' );
				break;
			case 'recupero-password':
				self::render_lostpassword();
				break;
			case 'portale':
				echo '<div id="dolly-employee-app" class="dolly-app dolly-portal" aria-live="polite"><div class="dolly-loading"><span class="dolly-spinner" aria-hidden="true"></span><span>Caricamento del portale…</span></div></div>';
				echo '<noscript><div class="dolly-alert dolly-alert--error">Per usare il portale è necessario JavaScript.</div></noscript>';
				break;
			case 'sede':
				echo '<div id="dolly-workplace-app" class="dolly-app dolly-workplace"><div class="dolly-loading"><span class="dolly-spinner" aria-hidden="true"></span><span>Caricamento del codice…</span></div></div>';
				echo '<noscript><div class="dolly-alert dolly-alert--error">Per mostrare il codice è necessario JavaScript.</div></noscript>';
				break;
		}
	}

	private static function render_login( $type ) {
		$is_wp    = 'workplace' === $type;
		$redirect = isset( $_GET['redirect_to'] ) ? esc_url_raw( wp_unslash( $_GET['redirect_to'] ) ) : ''; // phpcs:ignore
		$posted   = isset( $_POST['log'] ) ? sanitize_user( wp_unslash( $_POST['log'] ) ) : ''; // phpcs:ignore
		?>
		<div class="dolly-app dolly-auth">
			<div class="dolly-card dolly-auth__card">
				<?php self::brand( $is_wp ? 'Schermo sede' : Dolly_Appearance::get( 'portal_subtitle' ) ); ?>
				<h1 class="dolly-auth__title"><?php echo esc_html( $is_wp ? 'Accesso sede' : Dolly_Appearance::get( 'login_title' ) ); ?></h1>
				<?php $intro = $is_wp ? 'Accedi con l\'account dedicato della sede per mostrare QR e PIN.' : Dolly_Appearance::get( 'login_text' ); ?>
				<?php if ( '' !== $intro ) : ?>
					<p class="dolly-muted"><?php echo nl2br( esc_html( $intro ) ); ?></p>
				<?php endif; ?>
				<?php self::render_messages(); ?>
				<form method="post" class="dolly-form" novalidate>
					<?php wp_nonce_field( 'dolly_login_' . $type, 'dolly_login_nonce' ); ?>
					<input type="hidden" name="redirect_to" value="<?php echo esc_attr( $redirect ); ?>">
					<div class="dolly-field">
						<label class="dolly-label" for="dolly-log">Nome utente</label>
						<input class="dolly-input" id="dolly-log" name="log" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required value="<?php echo esc_attr( $posted ); ?>">
					</div>
					<div class="dolly-field">
						<label class="dolly-label" for="dolly-pwd">Password</label>
						<div class="dolly-password">
							<input class="dolly-input" id="dolly-pwd" name="pwd" type="password" autocomplete="current-password" required>
							<button type="button" class="dolly-password__toggle" data-toggle-password="dolly-pwd" aria-label="Mostra password" aria-pressed="false"><i data-lucide="eye" aria-hidden="true"></i></button>
						</div>
					</div>
					<?php if ( ! $is_wp ) : ?>
						<div class="dolly-field dolly-field--switch">
							<input type="hidden" name="rememberme" value="" data-switch-value="dolly-remember">
							<button type="button" class="dolly-switch" role="switch" aria-checked="false" id="dolly-remember" data-switch-input="rememberme"><span class="dolly-switch__track" aria-hidden="true"><span class="dolly-switch__thumb"></span></span><span class="dolly-switch__label">Resta connesso su questo dispositivo</span></button>
						</div>
					<?php endif; ?>
					<button type="submit" class="dolly-btn dolly-btn--primary dolly-btn--block"><i data-lucide="log-in" aria-hidden="true"></i><span>Accedi</span></button>
				</form>
				<div class="dolly-auth__links">
					<?php if ( ! $is_wp ) : ?>
						<a href="<?php echo esc_url( self::url( 'recupero-password' ) ); ?>"><i data-lucide="key-round" aria-hidden="true"></i>Password dimenticata?</a>
						<a href="<?php echo esc_url( self::url( 'login-sede' ) ); ?>"><i data-lucide="monitor" aria-hidden="true"></i>Accesso sede</a>
					<?php else : ?>
						<a href="<?php echo esc_url( self::url( 'login' ) ); ?>"><i data-lucide="user" aria-hidden="true"></i>Accesso dipendenti</a>
					<?php endif; ?>
				</div>
			</div>
		</div>
		<?php
	}

	private static function render_lostpassword() {
		?>
		<div class="dolly-app dolly-auth">
			<div class="dolly-card dolly-auth__card">
				<?php self::brand( Dolly_Appearance::get( 'portal_subtitle' ) ); ?>
				<h1 class="dolly-auth__title">Recupero password</h1>
				<p class="dolly-muted">Inserisci il tuo nome utente o l'email: riceverai un link per impostare una nuova password.</p>
				<?php self::render_messages(); ?>
				<form method="post" class="dolly-form" novalidate>
					<?php wp_nonce_field( 'dolly_lostpassword', 'dolly_lost_nonce' ); ?>
					<div class="dolly-field">
						<label class="dolly-label" for="dolly-user-login">Nome utente o email</label>
						<input class="dolly-input" id="dolly-user-login" name="user_login" type="text" autocomplete="username" autocapitalize="none" required>
					</div>
					<button type="submit" class="dolly-btn dolly-btn--primary dolly-btn--block"><i data-lucide="mail" aria-hidden="true"></i><span>Invia link</span></button>
				</form>
				<div class="dolly-auth__links">
					<a href="<?php echo esc_url( self::url( 'login' ) ); ?>"><i data-lucide="arrow-left" aria-hidden="true"></i>Torna all'accesso</a>
				</div>
			</div>
		</div>
		<?php
	}
}
