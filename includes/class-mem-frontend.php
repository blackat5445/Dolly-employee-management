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

class MEM_Frontend {

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
			add_rewrite_rule( '^' . $slug . '/?$', 'index.php?mem_view=' . $view, 'top' );
		}
	}

	public static function query_vars( $vars ) {
		$vars[] = 'mem_view';
		return $vars;
	}

	public static function current_view() {
		return (string) get_query_var( 'mem_view' );
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
			if ( ( is_front_page() || is_home() ) && apply_filters( 'mem_redirect_front_page', true ) ) {
				$target = MEM_Auth::home_for( $user );
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
				$target = $user->exists() && MEM_Employees::is_workplace_account( $user->ID ) ? self::url( 'login-sede' ) : self::url( 'login' );
				if ( $user->exists() && isset( $_GET['_wpnonce'] ) && wp_verify_nonce( sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ), 'mem_logout' ) ) {
					wp_logout();
				}
				wp_safe_redirect( add_query_arg( 'uscito', '1', $target ) );
				exit;

			case 'login':
			case 'login-sede':
				if ( $user->exists() && ! ( 'POST' === $_SERVER['REQUEST_METHOD'] ) ) { // phpcs:ignore
					wp_safe_redirect( MEM_Auth::home_for( $user ) );
					exit;
				}
				if ( 'POST' === $_SERVER['REQUEST_METHOD'] ) { // phpcs:ignore
					self::handle_login( 'login-sede' === $view ? 'workplace' : 'employee' );
				} elseif ( 'login' === $view ) {
					// The session on this device was closed because the account is linked to another device.
					$blocked = MEM_Devices::take_blocked_message();
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
				if ( ! current_user_can( 'mem_employee' ) || ! MEM_Employees::is_active( $user->ID ) ) {
					wp_safe_redirect( MEM_Auth::home_for( $user ) === self::url( 'portale' ) ? self::url( 'login' ) : MEM_Auth::home_for( $user ) );
					exit;
				}
				break;

			case 'sede':
				if ( ! $user->exists() ) {
					wp_safe_redirect( self::url( 'login-sede' ) );
					exit;
				}
				if ( ! current_user_can( 'mem_workplace' ) ) {
					wp_safe_redirect( MEM_Auth::home_for( $user ) );
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
		if ( ! isset( $_POST['mem_login_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['mem_login_nonce'] ) ), 'mem_login_' . $type ) ) {
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
			if ( 'mem_inactive' === $code ) {
				self::$messages[] = array( 'error', 'Account disattivato. Contatta l\'amministratore.' );
			} elseif ( 'mem_device' === $code ) {
				// Device sessions: the account is linked to another device (its name is in the message).
				self::$messages[] = array( 'error', $user->get_error_message() );
			} else {
				self::$messages[] = array( 'error', 'Nome utente o password non corretti.' );
			}
			return;
		}
		$is_workplace = MEM_Employees::is_workplace_account( $user->ID );
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
		$target    = apply_filters( 'login_redirect', MEM_Auth::home_for( $user ), $requested, $user );
		wp_safe_redirect( $target );
		exit;
	}

	private static function handle_lostpassword() {
		if ( ! isset( $_POST['mem_lost_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['mem_lost_nonce'] ) ), 'mem_lostpassword' ) ) {
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
		$key = 'mem_lost_' . md5( $ip );
		$n   = (int) get_transient( $key );
		if ( $n >= 5 ) {
			self::$messages[] = array( 'error', 'Troppe richieste. Riprova tra 15 minuti.' );
			return;
		}
		set_transient( $key, $n + 1, 15 * MINUTE_IN_SECONDS );
		$user = is_email( $login ) ? get_user_by( 'email', $login ) : get_user_by( 'login', $login );
		if ( $user && ! MEM_Employees::is_workplace_account( $user->ID ) && MEM_Employees::is_active( $user->ID ) ) {
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
		return MEM_DIR . 'templates/fallback.php';
	}

	/* ---------- Assets ---------- */

	public static function register_shared_assets() {
		$v = MEM_VERSION;
		wp_register_style( 'mem-ui', MEM_URL . 'assets/css/mem-ui.css', array(), $v );
		wp_register_script( 'mem-lucide', MEM_URL . 'assets/vendor/lucide/lucide.min.js', array(), '0.469.0', true );
		wp_register_script( 'mem-core', MEM_URL . 'assets/js/mem-core.js', array( 'mem-lucide' ), $v, true );
		wp_register_script( 'mem-fullcalendar', MEM_URL . 'assets/vendor/fullcalendar/index.global.min.js', array(), '6.1.15', true );
		wp_register_script( 'mem-fullcalendar-it', MEM_URL . 'assets/vendor/fullcalendar/it.global.min.js', array( 'mem-fullcalendar' ), '6.1.15', true );
		wp_register_script( 'mem-jsqr', MEM_URL . 'assets/vendor/jsqr/jsQR.js', array(), '1.4.0', true );
		wp_register_script( 'mem-qrcode', MEM_URL . 'assets/vendor/qrcode-generator/qrcode.js', array(), '1.4.4', true );
		wp_register_script( 'mem-chartjs', MEM_URL . 'assets/vendor/chartjs/chart.umd.js', array(), '4.4.4', true );
	}

	public static function js_config( $extra = array() ) {
		$user = wp_get_current_user();
		return array_merge(
			array(
				'root'       => esc_url_raw( rest_url( MEM_REST_NS . '/' ) ),
				'nonce'      => wp_create_nonce( 'wp_rest' ),
				'logoutUrl'  => add_query_arg( '_wpnonce', wp_create_nonce( 'mem_logout' ), self::url( 'esci' ) ),
				'portalUrl'  => self::url( 'portale' ),
				'logo'       => MEM_Settings::logo_url(),
				'userName'   => $user->exists() ? MEM_Employees::display_name( $user->ID ) : '',
				'timezone'   => MEM_Time::TZ,
				'serverTime' => time(),
			),
			$extra
		);
	}

	public static function assets() {
		$view = self::current_view();
		if ( ! $view ) {
			return;
		}
		self::register_shared_assets();
		wp_enqueue_style( 'mem-ui' );
		wp_enqueue_script( 'mem-core' );
		if ( 'portale' === $view ) {
			wp_enqueue_script( 'mem-employee', MEM_URL . 'assets/js/mem-employee.js', array( 'mem-core', 'mem-fullcalendar-it', 'mem-jsqr' ), MEM_VERSION, true );
			wp_localize_script( 'mem-core', 'MEM_CONFIG', self::js_config( array_merge( self::install_config(), array( 'view' => 'portale', 'push' => MEM_Push::client_config() ) ) ) );
		} elseif ( 'sede' === $view ) {
			wp_enqueue_script( 'mem-workplace', MEM_URL . 'assets/js/mem-workplace.js', array( 'mem-core', 'mem-qrcode' ), MEM_VERSION, true );
			wp_localize_script( 'mem-core', 'MEM_CONFIG', self::js_config( array( 'view' => 'sede' ) ) );
		} elseif ( 'login' === $view ) {
			wp_localize_script( 'mem-core', 'MEM_CONFIG', self::js_config( array_merge( self::install_config(), array( 'view' => $view ) ) ) );
		} else {
			wp_localize_script( 'mem-core', 'MEM_CONFIG', self::js_config( array( 'view' => $view ) ) );
		}
	}

	/**
	 * Install-first setting for phones: before signing in, employees add the portal to the home screen
	 * (the service worker is registered on the login page so the browser offers the installation).
	 */
	private static function install_config() {
		$path = wp_parse_url( home_url( '/' ), PHP_URL_PATH );
		return array(
			'requireInstall' => (bool) MEM_Settings::get( 'require_install' ),
			'sw'             => MEM_Push::url( 'sw' ),
			'swScope'        => $path ? $path : '/',
		);
	}

	public static function defer_vendor( $tag, $handle ) {
		return $tag;
	}

	/* ---------- Rendering (used by theme templates and plugin fallbacks) ---------- */

	/** Brand mark: configured logo or the text wordmark. */
	public static function brand( $subtitle = '' ) {
		$logo = MEM_Settings::logo_url();
		echo '<div class="mem-brand">';
		if ( $logo ) {
			echo '<img class="mem-brand__logo" src="' . esc_url( $logo ) . '" alt="Dolly">';
		} else {
			echo '<span class="mem-brand__wordmark">Dolly</span>';
		}
		if ( $subtitle ) {
			echo '<span class="mem-brand__sub">' . esc_html( $subtitle ) . '</span>';
		}
		echo '</div>';
	}

	private static function render_messages() {
		foreach ( self::messages() as $m ) {
			$icon = array( 'error' => 'circle-alert', 'success' => 'circle-check', 'warning' => 'triangle-alert' )[ $m[0] ] ?? 'info';
			printf(
				'<div class="mem-alert mem-alert--%1$s" role="%2$s"><i data-lucide="%3$s" aria-hidden="true"></i><span>%4$s</span></div>',
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
				echo '<div id="mem-employee-app" class="mem-app mem-portal" aria-live="polite"><div class="mem-loading"><span class="mem-spinner" aria-hidden="true"></span><span>Caricamento del portale…</span></div></div>';
				echo '<noscript><div class="mem-alert mem-alert--error">Per usare il portale è necessario JavaScript.</div></noscript>';
				break;
			case 'sede':
				echo '<div id="mem-workplace-app" class="mem-app mem-workplace"><div class="mem-loading"><span class="mem-spinner" aria-hidden="true"></span><span>Caricamento del codice…</span></div></div>';
				echo '<noscript><div class="mem-alert mem-alert--error">Per mostrare il codice è necessario JavaScript.</div></noscript>';
				break;
		}
	}

	private static function render_login( $type ) {
		$is_wp    = 'workplace' === $type;
		$redirect = isset( $_GET['redirect_to'] ) ? esc_url_raw( wp_unslash( $_GET['redirect_to'] ) ) : ''; // phpcs:ignore
		$posted   = isset( $_POST['log'] ) ? sanitize_user( wp_unslash( $_POST['log'] ) ) : ''; // phpcs:ignore
		?>
		<div class="mem-app mem-auth">
			<div class="mem-card mem-auth__card">
				<?php self::brand( $is_wp ? 'Schermo sede' : 'Portale dipendenti' ); ?>
				<h1 class="mem-auth__title"><?php echo $is_wp ? 'Accesso sede' : 'Accedi'; ?></h1>
				<p class="mem-muted"><?php echo $is_wp ? 'Accedi con l\'account dedicato della sede per mostrare QR e PIN.' : 'Accedi con le credenziali fornite dall\'amministratore.'; ?></p>
				<?php self::render_messages(); ?>
				<form method="post" class="mem-form" novalidate>
					<?php wp_nonce_field( 'mem_login_' . $type, 'mem_login_nonce' ); ?>
					<input type="hidden" name="redirect_to" value="<?php echo esc_attr( $redirect ); ?>">
					<div class="mem-field">
						<label class="mem-label" for="mem-log">Nome utente</label>
						<input class="mem-input" id="mem-log" name="log" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required value="<?php echo esc_attr( $posted ); ?>">
					</div>
					<div class="mem-field">
						<label class="mem-label" for="mem-pwd">Password</label>
						<div class="mem-password">
							<input class="mem-input" id="mem-pwd" name="pwd" type="password" autocomplete="current-password" required>
							<button type="button" class="mem-password__toggle" data-toggle-password="mem-pwd" aria-label="Mostra password" aria-pressed="false"><i data-lucide="eye" aria-hidden="true"></i></button>
						</div>
					</div>
					<?php if ( ! $is_wp ) : ?>
						<div class="mem-field mem-field--switch">
							<input type="hidden" name="rememberme" value="" data-switch-value="mem-remember">
							<button type="button" class="mem-switch" role="switch" aria-checked="false" id="mem-remember" data-switch-input="rememberme"><span class="mem-switch__track" aria-hidden="true"><span class="mem-switch__thumb"></span></span><span class="mem-switch__label">Resta connesso su questo dispositivo</span></button>
						</div>
					<?php endif; ?>
					<button type="submit" class="mem-btn mem-btn--primary mem-btn--block"><i data-lucide="log-in" aria-hidden="true"></i><span>Accedi</span></button>
				</form>
				<div class="mem-auth__links">
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
		<div class="mem-app mem-auth">
			<div class="mem-card mem-auth__card">
				<?php self::brand( 'Portale dipendenti' ); ?>
				<h1 class="mem-auth__title">Recupero password</h1>
				<p class="mem-muted">Inserisci il tuo nome utente o l'email: riceverai un link per impostare una nuova password.</p>
				<?php self::render_messages(); ?>
				<form method="post" class="mem-form" novalidate>
					<?php wp_nonce_field( 'mem_lostpassword', 'mem_lost_nonce' ); ?>
					<div class="mem-field">
						<label class="mem-label" for="mem-user-login">Nome utente o email</label>
						<input class="mem-input" id="mem-user-login" name="user_login" type="text" autocomplete="username" autocapitalize="none" required>
					</div>
					<button type="submit" class="mem-btn mem-btn--primary mem-btn--block"><i data-lucide="mail" aria-hidden="true"></i><span>Invia link</span></button>
				</form>
				<div class="mem-auth__links">
					<a href="<?php echo esc_url( self::url( 'login' ) ); ?>"><i data-lucide="arrow-left" aria-hidden="true"></i>Torna all'accesso</a>
				</div>
			</div>
		</div>
		<?php
	}
}
