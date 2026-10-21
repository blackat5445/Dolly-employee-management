<?php
/**
 * Authenticated REST API under /dolly/v1.
 *
 * Browser mutations are protected by the WordPress REST nonce (X-WP-Nonce, cookie authentication).
 * Permissions, record ownership and validation are always enforced server-side.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_REST {

	/* ---------- Permission callbacks ---------- */

	public static function can_employee() {
		$uid = get_current_user_id();
		if ( ! $uid || ! current_user_can( 'dolly_employee' ) ) {
			return new WP_Error( 'dolly_forbidden', __( 'Accesso riservato ai dipendenti.', 'dolly-employee-management' ), array( 'status' => rest_authorization_required_code() ) );
		}
		if ( ! Dolly_Employees::is_active( $uid ) ) {
			return new WP_Error( 'dolly_inactive', __( 'Account disattivato.', 'dolly-employee-management' ), array( 'status' => 403 ) );
		}
		return true;
	}

	public static function can_workplace() {
		$uid = get_current_user_id();
		if ( ! $uid || ! current_user_can( 'dolly_workplace' ) || ! Dolly_Employees::is_active( $uid ) ) {
			return new WP_Error( 'dolly_forbidden', __( 'Accesso riservato agli account sede.', 'dolly-employee-management' ), array( 'status' => rest_authorization_required_code() ) );
		}
		return true;
	}

	public static function can_admin() {
		if ( ! current_user_can( 'dolly_manage' ) ) {
			return new WP_Error( 'dolly_forbidden', __( 'Accesso riservato agli amministratori.', 'dolly-employee-management' ), array( 'status' => rest_authorization_required_code() ) );
		}
		return true;
	}

	public static function can_download_certificate() {
		if ( current_user_can( 'dolly_manage' ) ) {
			return true;
		}
		return self::can_employee();
	}

	/* ---------- Registration ---------- */

	public static function register_routes() {
		$ns  = DOLLY_REST_NS;
		$emp = array( __CLASS__, 'can_employee' );
		$adm = array( __CLASS__, 'can_admin' );
		$c   = __CLASS__;

		$routes = array(
			// Employee: profile and attendance.
			array( '/me', 'GET', 'me', $emp ),
			array( '/me/profile', 'POST', 'update_profile', $emp ),
			array( '/me/password', 'POST', 'change_password', $emp ),
			array( '/me/language', 'POST', 'set_language', 'is_user_logged_in' ),
			array( '/me/push', 'POST', 'push_subscribe', $emp ),
			array( '/me/push', 'DELETE', 'push_unsubscribe', $emp ),
			array( '/me/push/test', 'POST', 'push_test', $emp ),
			array( '/me/tour', 'POST', 'tour_state', $emp ),
			array( '/notifications/(?P<id>\d+)', 'GET', 'notification_get', 'is_user_logged_in' ),
			array( '/admin/test-email', 'POST', 'admin_test_email', $adm ),
			array( '/attendance/state', 'GET', 'attendance_state', $emp ),
			array( '/attendance/verify', 'POST', 'attendance_verify', $emp ),
			array( '/attendance/punch', 'POST', 'attendance_punch', $emp ),
			array( '/attendance/month', 'GET', 'attendance_month', $emp ),
			array( '/calendar', 'GET', 'calendar', $emp ),
			// Employee: requests.
			array( '/requests', 'GET', 'requests_list', $emp ),
			array( '/requests', 'POST', 'requests_create', $emp ),
			array( '/requests/(?P<id>\d+)', 'PUT', 'requests_update', $emp ),
			array( '/requests/(?P<id>\d+)', 'DELETE', 'requests_cancel', $emp ),
			// Employee: sickness and certificates.
			array( '/sickness', 'GET', 'sickness_list', $emp ),
			array( '/sickness', 'POST', 'sickness_report', $emp ),
			array( '/sickness/(?P<id>\d+)/certificate', 'POST', 'certificate_upload', $emp ),
			array( '/requests/(?P<id>\d+)/certificate', 'POST', 'donation_certificate_upload', $emp ),
			array( '/certificates/(?P<id>\d+)/download', 'GET', 'certificate_download', array( $c, 'can_download_certificate' ) ),
			// Employee: documents (administrators can also open them).
			array( '/documents', 'GET', 'documents_list', $emp ),
			array( '/documents/(?P<id>\d+)/download', 'GET', 'document_download', array( $c, 'can_download_certificate' ) ),
			// Employee: anomalies and notifications.
			array( '/anomalies', 'GET', 'anomalies_list', $emp ),
			array( '/anomalies/(?P<id>\d+)/note', 'POST', 'anomaly_note', $emp ),
			array( '/notifications', 'GET', 'notifications_list', 'is_user_logged_in' ),
			array( '/notifications/(?P<id>\d+)/read', 'POST', 'notification_read', 'is_user_logged_in' ),
			array( '/notifications/read-all', 'POST', 'notifications_read_all', 'is_user_logged_in' ),
			// Workplace challenges.
			array( '/workplace/challenge', 'GET', 'workplace_challenge', array( $c, 'can_workplace' ) ),
			// Administration.
			array( '/admin/dashboard', 'GET', 'admin_dashboard', $adm ),
			array( '/admin/chart', 'GET', 'admin_chart', $adm ),
			array( '/admin/calendar', 'GET', 'admin_calendar', $adm ),
			array( '/admin/employees', 'GET', 'admin_employees', $adm ),
			array( '/admin/employees', 'POST', 'admin_employee_create', $adm ),
			array( '/admin/employees/(?P<id>\d+)', 'GET', 'admin_employee_get', $adm ),
			array( '/admin/employees/(?P<id>\d+)', 'PUT', 'admin_employee_update', $adm ),
			array( '/admin/employees/(?P<id>\d+)/status', 'POST', 'admin_employee_status', $adm ),
			array( '/admin/employees/(?P<id>\d+)/password', 'POST', 'admin_employee_password', $adm ),
			array( '/admin/employees/(?P<id>\d+)/exception', 'POST', 'admin_exception_create', $adm ),
			array( '/admin/exceptions/(?P<id>\d+)', 'DELETE', 'admin_exception_revoke', $adm ),
			array( '/admin/workplaces', 'GET', 'admin_workplaces', $adm ),
			array( '/admin/workplaces', 'POST', 'admin_workplace_create', $adm ),
			array( '/admin/workplaces/(?P<id>\d+)', 'PUT', 'admin_workplace_update', $adm ),
			array( '/admin/workplaces/(?P<id>\d+)/bluetooth', 'GET', 'admin_workplace_bluetooth', $adm ),
			array( '/admin/workplaces/(?P<id>\d+)/bluetooth', 'POST', 'admin_workplace_bluetooth_update', $adm ),
			array( '/admin/requests', 'GET', 'admin_requests', $adm ),
			array( '/admin/requests/(?P<id>\d+)/decision', 'POST', 'admin_request_decide', $adm ),
			array( '/admin/requests/(?P<id>\d+)/revoke', 'POST', 'admin_request_revoke', $adm ),
			array( '/admin/requests/(?P<id>\d+)/certificate', 'POST', 'admin_donation_certificate_upload', $adm ),
			array( '/admin/extra', 'POST', 'admin_extra_create', $adm ),
			array( '/admin/authorizations', 'POST', 'admin_authorization_create', $adm ),
			array( '/admin/sickness', 'GET', 'admin_sickness', $adm ),
			array( '/admin/sickness/(?P<id>\d+)/review', 'POST', 'admin_sickness_review', $adm ),
			array( '/admin/sickness/(?P<id>\d+)/certificate', 'POST', 'admin_certificate_upload', $adm ),
			array( '/admin/attendance', 'GET', 'admin_attendance', $adm ),
			array( '/admin/attendance/day', 'GET', 'admin_attendance_day', $adm ),
			array( '/admin/attendance/date', 'GET', 'admin_attendance_date', $adm ),
			array( '/admin/analytics', 'GET', 'admin_analytics', $adm ),
			array( '/admin/attendance/correct', 'POST', 'admin_attendance_correct', $adm ),
			array( '/admin/anomalies', 'GET', 'admin_anomalies', $adm ),
			array( '/admin/anomalies/(?P<id>\d+)/resolve', 'POST', 'admin_anomaly_resolve', $adm ),
			array( '/admin/audit', 'GET', 'admin_audit', $adm ),
			array( '/admin/closures', 'GET', 'admin_closure_get', $adm ),
			array( '/admin/closures', 'POST', 'admin_closure_save', $adm ),
			array( '/admin/broadcasts', 'GET', 'admin_broadcasts', $adm ),
			array( '/admin/broadcasts', 'POST', 'admin_broadcast_create', $adm ),
			array( '/admin/broadcasts/(?P<id>\d+)', 'DELETE', 'admin_broadcast_cancel', $adm ),
			array( '/admin/export/employees', 'GET', 'admin_export_employees', $adm ),
			array( '/admin/export/attendance', 'GET', 'admin_export_attendance', $adm ),
			array( '/admin/export/hours', 'GET', 'admin_export_hours', $adm ),
			array( '/admin/export/timesheet', 'GET', 'admin_export_timesheet', $adm ),
			array( '/admin/devices', 'GET', 'admin_devices', $adm ),
			array( '/admin/devices/(?P<id>\d+)', 'DELETE', 'admin_device_revoke', $adm ),
			array( '/admin/employees/(?P<id>\d+)/device-limit', 'POST', 'admin_device_limit', $adm ),
			array( '/admin/settings', 'GET', 'admin_settings_get', $adm ),
			array( '/admin/settings', 'POST', 'admin_settings_update', $adm ),
			array( '/admin/cron/run', 'POST', 'admin_cron_run', $adm ),
			array( '/admin/onboarding', 'POST', 'admin_onboarding', $adm ),
			array( '/admin/documents/people', 'GET', 'admin_documents_people', $adm ),
			array( '/admin/documents/categories', 'GET', 'admin_document_categories', $adm ),
			array( '/admin/documents/categories', 'POST', 'admin_document_categories_save', $adm ),
			array( '/admin/documents', 'GET', 'admin_documents', $adm ),
			array( '/admin/documents', 'POST', 'admin_document_send', $adm ),
			array( '/admin/documents/(?P<id>\d+)', 'DELETE', 'admin_document_delete', $adm ),
			array( '/admin/tour', 'POST', 'admin_tour', $adm ),
			array( '/admin/appearance', 'GET', 'admin_appearance_get', $adm ),
			array( '/admin/appearance', 'POST', 'admin_appearance_update', $adm ),
			array( '/admin/appearance/preview', 'POST', 'admin_appearance_preview', $adm ),
			array( '/admin/appearance/reset', 'POST', 'admin_appearance_reset', $adm ),
		);

		foreach ( $routes as $r ) {
			register_rest_route(
				$ns,
				$r[0],
				array(
					'methods'             => $r[1],
					'callback'            => array( $c, $r[2] ),
					'permission_callback' => $r[3],
				)
			);
		}

		// System task scheduler endpoint (secret key, no user session).
		register_rest_route(
			$ns,
			'/cron',
			array(
				'methods'             => array( 'GET', 'POST' ),
				'callback'            => array( $c, 'cron' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	private static function body( WP_REST_Request $req ) {
		$json = $req->get_json_params();
		return is_array( $json ) ? $json : $req->get_body_params();
	}

	/* ---------- Employee ---------- */

	public static function me() {
		$uid        = get_current_user_id();
		$e          = Dolly_Employees::format( $uid );
		$e['state'] = Dolly_Attendance::state( $uid );
		$e['unread']= Dolly_Notifications::unread_count( $uid );
		$e['open_anomalies'] = Dolly_Anomalies::count_open( array( $uid ) );
		$e['documents_unread'] = Dolly_Documents::unread_count( $uid );
		$e['popups']         = Dolly_Notifications::popups( $uid );
		$e['tour_done']      = (bool) get_user_meta( $uid, 'dolly_tour_done', true );
		$e['language']       = array(
			'choice'    => Dolly_I18n::user_choice( $uid ),
			'available' => Dolly_I18n::available(),
			'default'   => Dolly_I18n::available()[ Dolly_I18n::default_locale() ] ?? Dolly_I18n::default_locale(),
			'flags'     => array_combine( array_keys( Dolly_I18n::available() ), array_map( array( 'Dolly_I18n', 'flag' ), array_keys( Dolly_I18n::available() ) ) ),
		);
		$e['settings'] = array(
			'verification'       => Dolly_Settings::verification(),
			'bluetooth'          => Dolly_Bluetooth::client_config(),
			'certificate_mode'   => Dolly_Settings::get( 'certificate_mode' ),
			'certificate_days'   => (int) Dolly_Settings::get( 'certificate_days' ),
			'certificate_needs'  => Dolly_Sickness::requirements(),
			'lunch_punch'        => (bool) Dolly_Settings::get( 'lunch_punch' ),
			'overtime_auto'      => (int) Dolly_Settings::get( 'overtime_auto' ),
			'donation_certificate_mode' => Dolly_Settings::get( 'donation_certificate_mode' ),
			'donation_certificate_days' => (int) Dolly_Settings::get( 'donation_certificate_days' ),
		);
		$e['server_time'] = time();
		return $e;
	}

	public static function update_profile( WP_REST_Request $req ) {
		return Dolly_Employees::update_profile( get_current_user_id(), self::body( $req ) );
	}

	/** Own language: '' = plugin default. */
	public static function set_language( WP_REST_Request $req ) {
		$loc = (string) ( self::body( $req )['locale'] ?? '' );
		if ( ! Dolly_I18n::set_user_choice( get_current_user_id(), $loc ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Lingua non disponibile.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		return array( 'locale' => Dolly_I18n::user_choice( get_current_user_id() ) );
	}

	public static function change_password( WP_REST_Request $req ) {
		$b = self::body( $req );
		$r = Dolly_Employees::change_password( get_current_user_id(), $b['current_password'] ?? '', $b['new_password'] ?? '' );
		return is_wp_error( $r ) ? $r : array( 'ok' => true, 'message' => __( 'Password aggiornata.', 'dolly-employee-management' ) );
	}

	public static function push_subscribe( WP_REST_Request $req ) {
		return Dolly_Push::subscribe( get_current_user_id(), self::body( $req ) );
	}

	public static function push_unsubscribe( WP_REST_Request $req ) {
		$b = self::body( $req );
		return Dolly_Push::unsubscribe( get_current_user_id(), $b['endpoint'] ?? '' );
	}

	/** Guided tour of the portal: shown on the first entry until completed or skipped. */
	public static function tour_state( WP_REST_Request $req ) {
		$b    = self::body( $req );
		$done = ! empty( $b['done'] );
		update_user_meta( get_current_user_id(), 'dolly_tour_done', $done ? 1 : 0 );
		return array( 'tour_done' => $done );
	}

	public static function push_test() {
		return Dolly_Push::test( get_current_user_id() );
	}

	public static function notification_get( WP_REST_Request $req ) {
		return Dolly_Notifications::get_for( get_current_user_id(), (int) $req['id'] );
	}

	public static function admin_test_email() {
		return Dolly_Notifications::test_email( get_current_user_id() );
	}

	public static function attendance_state() {
		return Dolly_Attendance::state( get_current_user_id() );
	}

	public static function attendance_verify( WP_REST_Request $req ) {
		$b   = self::body( $req );
		$uid = get_current_user_id();
		$type = $b['type'] ?? '';
		if ( 'ble' === $type ) {
			$r = Dolly_Bluetooth::verify( $uid, $b['code'] ?? '' );
		} else {
			$r = 'pin' === $type ? Dolly_Verification::verify_pin( $uid, $b['code'] ?? '' ) : Dolly_Verification::verify_qr( $uid, $b['code'] ?? '' );
		}
		if ( is_wp_error( $r ) ) {
			return $r;
		}
		$w = Dolly_Workplaces::get( $r['workplace_id'] );
		return array(
			'ticket'     => Dolly_Verification::issue_ticket( $uid, $r ),
			'workplace'  => array( 'id' => (int) $w->id, 'name' => $w->name ),
			'method'     => $r['method'],
			'expires_in' => Dolly_Verification::TICKET_TTL,
		);
	}

	public static function attendance_punch( WP_REST_Request $req ) {
		return Dolly_Attendance::punch( get_current_user_id(), self::body( $req ) );
	}

	private static function year_month( WP_REST_Request $req ) {
		$now   = Dolly_Time::now_local();
		$year  = (int) ( $req->get_param( 'year' ) ? $req->get_param( 'year' ) : $now->format( 'Y' ) );
		$month = (int) ( $req->get_param( 'month' ) ? $req->get_param( 'month' ) : $now->format( 'n' ) );
		if ( $year < 2000 || $year > 2100 || $month < 1 || $month > 12 ) {
			return new WP_Error( 'dolly_invalid', __( 'Mese o anno non valido.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		return array( $year, $month );
	}

	public static function attendance_month( WP_REST_Request $req ) {
		$ym = self::year_month( $req );
		if ( is_wp_error( $ym ) ) {
			return $ym;
		}
		return Dolly_Reports::month_rows( get_current_user_id(), $ym[0], $ym[1] );
	}

	private static function range_params( WP_REST_Request $req ) {
		$from = substr( (string) $req->get_param( 'start' ), 0, 10 );
		$to   = substr( (string) $req->get_param( 'end' ), 0, 10 );
		if ( ! Dolly_Time::is_date( $from ) || ! Dolly_Time::is_date( $to ) || $to < $from || ( strtotime( $to ) - strtotime( $from ) ) > 62 * DAY_IN_SECONDS ) {
			return new WP_Error( 'dolly_invalid', __( 'Intervallo non valido.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		return array( $from, $to );
	}

	public static function calendar( WP_REST_Request $req ) {
		$r = self::range_params( $req );
		if ( is_wp_error( $r ) ) {
			return $r;
		}
		return Dolly_Reports::calendar_events( $r[0], $r[1], 0, get_current_user_id() );
	}

	public static function requests_list( WP_REST_Request $req ) {
		return Dolly_Requests::query(
			array(
				'user_id'  => get_current_user_id(),
				'status'   => $req->get_param( 'status' ),
				'type'     => $req->get_param( 'type' ),
				'page'     => $req->get_param( 'page' ),
				'per_page' => 10,
			)
		);
	}

	/**
	 * Employees do not request overtime: it is calculated automatically from the punches
	 * (beyond the automatic limit, or on rest days, it is authorised by the administrator).
	 */
	private static function overtime_managed_by_admin( $type ) {
		if ( 'straordinario' === $type ) {
			return new WP_Error( 'dolly_invalid_type', __( 'Gli straordinari non si richiedono: vengono calcolati automaticamente dalle timbrature e, oltre il limite o nei giorni di riposo, autorizzati dall\'amministratore.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		return null;
	}

	public static function requests_create( WP_REST_Request $req ) {
		$b   = self::body( $req );
		$err = self::overtime_managed_by_admin( $b['type'] ?? '' );
		return $err ? $err : Dolly_Requests::create( get_current_user_id(), $b );
	}

	public static function requests_update( WP_REST_Request $req ) {
		$r   = Dolly_Requests::get( (int) $req['id'] );
		$err = $r ? self::overtime_managed_by_admin( $r->type ) : null;
		return $err ? $err : Dolly_Requests::update( get_current_user_id(), (int) $req['id'], self::body( $req ) );
	}

	public static function requests_cancel( WP_REST_Request $req ) {
		$r   = Dolly_Requests::get( (int) $req['id'] );
		$err = $r ? self::overtime_managed_by_admin( $r->type ) : null;
		return $err ? $err : Dolly_Requests::cancel( get_current_user_id(), (int) $req['id'] );
	}

	public static function sickness_list( WP_REST_Request $req ) {
		return Dolly_Sickness::query( array( 'user_id' => get_current_user_id(), 'page' => $req->get_param( 'page' ), 'per_page' => 10 ) );
	}

	public static function sickness_report( WP_REST_Request $req ) {
		return Dolly_Sickness::report( get_current_user_id(), self::body( $req ) );
	}

	public static function certificate_upload( WP_REST_Request $req ) {
		$files = $req->get_file_params();
		return Dolly_Sickness::upload_certificate( (int) $req['id'], $files['file'] ?? null, false, (string) $req->get_param( 'protocol' ) );
	}

	public static function donation_certificate_upload( WP_REST_Request $req ) {
		$files = $req->get_file_params();
		return Dolly_Donations::upload_certificate( (int) $req['id'], $files['file'] ?? null, false );
	}

	public static function certificate_download( WP_REST_Request $req ) {
		return Dolly_Sickness::download( (int) $req['id'] );
	}

	public static function anomalies_list( WP_REST_Request $req ) {
		return Dolly_Anomalies::query( array( 'user_id' => get_current_user_id(), 'status' => $req->get_param( 'status' ), 'page' => $req->get_param( 'page' ), 'per_page' => 10 ) );
	}

	public static function anomaly_note( WP_REST_Request $req ) {
		$b = self::body( $req );
		return Dolly_Anomalies::add_note( get_current_user_id(), (int) $req['id'], $b['note'] ?? '' );
	}

	public static function notifications_list( WP_REST_Request $req ) {
		return Dolly_Notifications::query( get_current_user_id(), $req->get_param( 'page' ) ? $req->get_param( 'page' ) : 1, 10 );
	}

	public static function notification_read( WP_REST_Request $req ) {
		return array( 'unread' => Dolly_Notifications::mark_read( get_current_user_id(), (int) $req['id'] ) );
	}

	public static function notifications_read_all() {
		return array( 'unread' => Dolly_Notifications::mark_read( get_current_user_id() ) );
	}

	/* ---------- Workplace display ---------- */

	public static function workplace_challenge() {
		$w = Dolly_Workplaces::by_account( get_current_user_id() );
		if ( ! $w ) {
			return new WP_Error( 'dolly_no_workplace', __( 'Questo account non è collegato a una sede attiva.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$c = Dolly_Verification::challenge( (int) $w->id );
		$response = new WP_REST_Response(
			array(
				'workplace'   => array( 'id' => (int) $w->id, 'name' => $w->name, 'city' => $w->city ),
				'qr_payload'  => $c['qr_payload'],
				'pin'         => $c['pin'],
				'expires_at'  => $c['expires_at'],
				'server_time' => microtime( true ),
				'period'      => Dolly_Verification::WINDOW,
				'nonce'       => wp_create_nonce( 'wp_rest' ),
				// Code relayed to the Bluetooth device by this tablet (tablet mode), if the workplace uses one.
				'bluetooth'   => Dolly_Bluetooth::current_code( (int) $w->id ),
			)
		);
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}

	/* ---------- Administration ---------- */

	public static function admin_dashboard( WP_REST_Request $req ) {
		return Dolly_Reports::dashboard(
			(int) $req->get_param( 'workplace' ),
			array(
				'attendance' => $req->get_param( 'att_page' ),
				'requests'   => $req->get_param( 'req_page' ),
				'anomalies'  => $req->get_param( 'anom_page' ),
			)
		);
	}

	public static function admin_chart( WP_REST_Request $req ) {
		return Dolly_Reports::chart( (int) $req->get_param( 'range' ), (int) $req->get_param( 'workplace' ) );
	}

	public static function admin_calendar( WP_REST_Request $req ) {
		$r = self::range_params( $req );
		if ( is_wp_error( $r ) ) {
			return $r;
		}
		return Dolly_Reports::calendar_events( $r[0], $r[1], (int) $req->get_param( 'workplace' ) );
	}

	public static function admin_employees( WP_REST_Request $req ) {
		if ( $req->get_param( 'all' ) ) {
			return Dolly_Employees::options(); // "Surname Name", sorted by surname.
		}
		return Dolly_Employees::query(
			array(
				'search'    => $req->get_param( 'search' ),
				'status'    => $req->get_param( 'status' ),
				'workplace' => $req->get_param( 'workplace' ),
				'page'      => $req->get_param( 'page' ),
				'per_page'  => 10,
			)
		);
	}

	public static function admin_employee_create( WP_REST_Request $req ) {
		return Dolly_Employees::create( self::body( $req ) );
	}

	public static function admin_employee_get( WP_REST_Request $req ) {
		if ( ! Dolly_Employees::is_employee( (int) $req['id'] ) ) {
			return new WP_Error( 'dolly_not_found', __( 'Dipendente non trovato.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$e = Dolly_Employees::format( (int) $req['id'], true );
		$e['audit']          = Dolly_Audit::query( array( 'user_id' => (int) $req['id'], 'per_page' => 10 ) )['items'];
		$e['device_session'] = Dolly_Devices::for_user( (int) $req['id'] );
		return $e;
	}

	public static function admin_employee_update( WP_REST_Request $req ) {
		return Dolly_Employees::update( (int) $req['id'], self::body( $req ) );
	}

	public static function admin_employee_status( WP_REST_Request $req ) {
		$b = self::body( $req );
		return Dolly_Employees::set_active( (int) $req['id'], ! empty( $b['active'] ), $b['reason'] ?? '' );
	}

	public static function admin_employee_password( WP_REST_Request $req ) {
		$b = self::body( $req );
		$r = Dolly_Employees::admin_set_password( (int) $req['id'], $b['password'] ?? '' );
		return is_wp_error( $r ) ? $r : array( 'ok' => true, 'message' => __( 'Password aggiornata. Le sessioni attive del dipendente sono state chiuse.', 'dolly-employee-management' ) );
	}

	public static function admin_exception_create( WP_REST_Request $req ) {
		$b = self::body( $req );
		return Dolly_Verification::create_exception( (int) $req['id'], $b['reason'] ?? '', ! empty( $b['expires_at'] ) ? $b['expires_at'] : null );
	}

	public static function admin_exception_revoke( WP_REST_Request $req ) {
		$r = Dolly_Verification::revoke_exception( (int) $req['id'], (string) $req->get_param( 'reason' ) );
		return is_wp_error( $r ) ? $r : array( 'ok' => true );
	}

	public static function admin_workplaces() {
		return array_map( array( 'Dolly_Workplaces', 'format' ), Dolly_Workplaces::all() );
	}

	public static function admin_workplace_create( WP_REST_Request $req ) {
		return Dolly_Workplaces::create( self::body( $req ) );
	}

	public static function admin_workplace_update( WP_REST_Request $req ) {
		return Dolly_Workplaces::update( (int) $req['id'], self::body( $req ) );
	}

	public static function admin_requests( WP_REST_Request $req ) {
		return Dolly_Requests::query(
			array(
				'user_id'   => $req->get_param( 'user_id' ),
				'status'    => $req->get_param( 'status' ),
				'type'      => $req->get_param( 'type' ),
				'workplace' => $req->get_param( 'workplace' ),
				'page'      => $req->get_param( 'page' ),
				'per_page'  => 10,
				'order'     => 'name',
			)
		);
	}

	public static function admin_request_decide( WP_REST_Request $req ) {
		$b = self::body( $req );
		return Dolly_Requests::decide( (int) $req['id'], $b['decision'] ?? '', $b['note'] ?? '', (string) ( $b['hours_code'] ?? '' ) );
	}

	public static function admin_request_revoke( WP_REST_Request $req ) {
		$b = self::body( $req );
		return Dolly_Requests::revoke( (int) $req['id'], $b['note'] ?? '' );
	}

	public static function admin_donation_certificate_upload( WP_REST_Request $req ) {
		$files = $req->get_file_params();
		return Dolly_Donations::upload_certificate( (int) $req['id'], $files['file'] ?? null, true );
	}

	public static function admin_devices() {
		return Dolly_Devices::admin_list();
	}

	public static function admin_device_revoke( WP_REST_Request $req ) {
		return Dolly_Devices::revoke( (int) $req['id'] );
	}

	public static function admin_device_limit( WP_REST_Request $req ) {
		$b = self::body( $req );
		return Dolly_Devices::set_limit( (int) $req['id'], $b['limit'] ?? 0 );
	}

	public static function admin_extra_create( WP_REST_Request $req ) {
		$b         = self::body( $req );
		$b['type'] = 'straordinario';
		$uid       = (int) ( $b['user_id'] ?? 0 );
		if ( ! Dolly_Employees::is_employee( $uid ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Seleziona un dipendente.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'user_id' => __( 'Seleziona un dipendente.', 'dolly-employee-management' ) ) ) );
		}
		return Dolly_Requests::create( $uid, $b, true );
	}

	/**
	 * Administrator creates an authorisation already approved: vacation, hourly leave, extra work,
	 * or registers sickness / injury on behalf of the employee.
	 */
	public static function admin_authorization_create( WP_REST_Request $req ) {
		$b    = self::body( $req );
		$uid  = (int) ( $b['user_id'] ?? 0 );
		$type = (string) ( $b['type'] ?? '' );
		if ( ! Dolly_Employees::is_employee( $uid ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Seleziona un dipendente.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'user_id' => __( 'Seleziona un dipendente.', 'dolly-employee-management' ) ) ) );
		}
		if ( isset( Dolly_Sickness::KINDS[ $type ] ) ) {
			$b['kind'] = $type;
			$b['notes'] = $b['notes'] ?? ( $b['decision_note'] ?? '' );
			return Dolly_Sickness::report( $uid, $b, true );
		}
		if ( ! in_array( $type, array( 'ferie', 'permesso', 'straordinario', 'donazione' ), true ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Tipo di autorizzazione non valido.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'type' => __( 'Seleziona il tipo.', 'dolly-employee-management' ) ) ) );
		}
		return Dolly_Requests::create( $uid, $b, true );
	}

	public static function admin_sickness( WP_REST_Request $req ) {
		return Dolly_Sickness::query(
			array(
				'user_id'            => $req->get_param( 'user_id' ),
				'kind'               => $req->get_param( 'kind' ),
				'certificate_status' => $req->get_param( 'certificate_status' ),
				'workplace'          => $req->get_param( 'workplace' ),
				'page'               => $req->get_param( 'page' ),
				'per_page'           => 10,
				'order'              => 'name',
			)
		);
	}

	public static function admin_sickness_review( WP_REST_Request $req ) {
		$b = self::body( $req );
		return Dolly_Sickness::review( (int) $req['id'], $b['note'] ?? '' );
	}

	public static function admin_certificate_upload( WP_REST_Request $req ) {
		$files = $req->get_file_params();
		return Dolly_Sickness::upload_certificate( (int) $req['id'], $files['file'] ?? null, true, (string) $req->get_param( 'protocol' ) );
	}

	public static function admin_attendance( WP_REST_Request $req ) {
		$uid = (int) $req->get_param( 'user_id' );
		if ( ! Dolly_Employees::is_employee( $uid ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Seleziona un dipendente.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		$ym = self::year_month( $req );
		if ( is_wp_error( $ym ) ) {
			return $ym;
		}
		// The month is also written to the hours history (table "hours").
		$data             = Dolly_Hours::sync_month( $uid, $ym[0], $ym[1] );
		$data['employee'] = Dolly_Employees::format( $uid );
		return $data;
	}

	public static function admin_attendance_day( WP_REST_Request $req ) {
		$uid  = (int) $req->get_param( 'user_id' );
		$date = (string) $req->get_param( 'date' );
		if ( ! Dolly_Employees::is_employee( $uid ) || ! Dolly_Time::is_date( $date ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Parametri non validi.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		$d               = Dolly_Attendance::day_detail( $uid, $date );
		$d['workplaces'] = array_map( array( 'Dolly_Workplaces', 'format' ), Dolly_Workplaces::for_user( $uid, $date ) );
		return $d;
	}

	/** Presenze › Per giorno: every employee on one date. */
	public static function admin_attendance_date( WP_REST_Request $req ) {
		return Dolly_Analytics::day( (string) $req->get_param( 'date' ), (int) $req->get_param( 'workplace' ) );
	}

	public static function admin_analytics( WP_REST_Request $req ) {
		return Dolly_Analytics::range(
			(string) $req->get_param( 'from' ),
			(string) $req->get_param( 'to' ),
			(int) $req->get_param( 'workplace' ),
			(int) $req->get_param( 'user_id' ),
			(bool) $req->get_param( 'fresh' )
		);
	}

	public static function admin_attendance_correct( WP_REST_Request $req ) {
		$b = self::body( $req );
		return Dolly_Attendance::correct( (int) ( $b['user_id'] ?? 0 ), (string) ( $b['date'] ?? '' ), (string) ( $b['action'] ?? '' ), $b['time'] ?? null, $b['reason'] ?? '', (int) ( $b['workplace_id'] ?? 0 ) );
	}

	public static function admin_anomalies( WP_REST_Request $req ) {
		return Dolly_Anomalies::query(
			array(
				'user_id'   => $req->get_param( 'user_id' ),
				'status'    => $req->get_param( 'status' ),
				'type'      => $req->get_param( 'type' ),
				'workplace' => $req->get_param( 'workplace' ),
				'page'      => $req->get_param( 'page' ),
				'per_page'  => 10,
				'order'     => 'name',
			)
		);
	}

	public static function admin_closure_get( WP_REST_Request $req ) {
		$date = (string) $req->get_param( 'date' );
		if ( ! Dolly_Time::is_date( $date ) ) {
			return new WP_Error( 'dolly_invalid', __( 'Data non valida.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		return Dolly_Closures::day( $date );
	}

	public static function admin_closure_save( WP_REST_Request $req ) {
		return Dolly_Closures::save( self::body( $req ) );
	}

	public static function admin_broadcasts( WP_REST_Request $req ) {
		return Dolly_Broadcasts::query( array( 'page' => $req->get_param( 'page' ), 'per_page' => 10 ) );
	}

	public static function admin_broadcast_create( WP_REST_Request $req ) {
		return Dolly_Broadcasts::create( self::body( $req ) );
	}

	public static function admin_broadcast_cancel( WP_REST_Request $req ) {
		return Dolly_Broadcasts::cancel( (int) $req['id'] );
	}

	public static function admin_anomaly_resolve( WP_REST_Request $req ) {
		return Dolly_Anomalies::admin_resolve( (int) $req['id'], self::body( $req ) );
	}

	public static function admin_audit( WP_REST_Request $req ) {
		return Dolly_Audit::query( array( 'user_id' => $req->get_param( 'user_id' ), 'page' => $req->get_param( 'page' ), 'per_page' => 20 ) );
	}

	public static function admin_export_employees() {
		Dolly_Reports::send_download( Dolly_Reports::employees_csv(), __( 'Dipendenti_', 'dolly-employee-management' ) . sanitize_file_name( Dolly_Appearance::brand() ) . '_' . Dolly_Time::now_local()->format( 'd-m-Y' ) . '.csv', 'text/csv; charset=UTF-8' );
	}

	public static function admin_export_attendance( WP_REST_Request $req ) {
		$ym = self::year_month( $req );
		if ( is_wp_error( $ym ) ) {
			return $ym;
		}
		$users = $req->get_param( 'users' );
		$users = is_array( $users ) ? $users : array_filter( explode( ',', (string) $users ) );
		$path  = Dolly_Reports::attendance_zip( $users, $ym[0], $ym[1] );
		if ( is_wp_error( $path ) ) {
			return $path;
		}
		Dolly_Reports::send_download( $path, __( 'Presenze_', 'dolly-employee-management' ) . Dolly_I18n::t( Dolly_Time::MONTHS[ $ym[1] ] ) . '_' . $ym[0] . '.zip', 'application/zip', true );
	}

	/** Monthly attendance sheet (Excel): one file with all the employees of the company. */
	public static function admin_export_timesheet( WP_REST_Request $req ) {
		$ym = self::year_month( $req );
		if ( is_wp_error( $ym ) ) {
			return $ym;
		}
		$path = Dolly_Timesheet::build( $ym[0], $ym[1] );
		if ( is_wp_error( $path ) ) {
			return $path;
		}
		Dolly_Reports::send_download( $path, Dolly_Timesheet::filename( $ym[0], $ym[1] ), Dolly_Xlsx::MIME, true );
	}

	/** Monthly summary of the hours by justification code (one line per employee). */
	public static function admin_export_hours( WP_REST_Request $req ) {
		$ym = self::year_month( $req );
		if ( is_wp_error( $ym ) ) {
			return $ym;
		}
		$users = $req->get_param( 'users' );
		$users = is_array( $users ) ? $users : array_filter( explode( ',', (string) $users ) );
		if ( ! $users ) {
			$users = Dolly_Employees::active_ids();
		}
		Dolly_Reports::send_download( Dolly_Hours::summary_csv( $users, $ym[0], $ym[1] ), __( 'Riepilogo_ore_', 'dolly-employee-management' ) . Dolly_I18n::t( Dolly_Time::MONTHS[ $ym[1] ] ) . '_' . $ym[0] . '.csv', 'text/csv; charset=utf-8' );
	}

	public static function admin_settings_get() {
		$s = Dolly_Settings::all();
		unset( $s['cron_key'] );
		$admins = get_users( array( 'capability' => 'dolly_manage' ) );
		return array(
			'settings'          => $s,
			'verification_methods' => Dolly_I18n::labels( Dolly_Settings::VERIFICATION_METHODS ),
			'languages'         => Dolly_I18n::available(),
			'site_language'     => Dolly_I18n::available()[ Dolly_I18n::closest( get_locale() ) ] ?? get_locale(),
			'my_locale'         => Dolly_I18n::user_choice( get_current_user_id() ),
			'certificate_modes' => Dolly_I18n::labels( Dolly_Settings::CERTIFICATE_MODES ),
			'events'            => Dolly_I18n::labels( Dolly_Settings::EVENTS ),
			'employee_events'   => Dolly_I18n::labels( Dolly_Settings::EMPLOYEE_EVENTS ),
			'hours_codes'       => Dolly_I18n::labels( Dolly_Hours::CODES ),
			'admin_events'      => Dolly_I18n::labels( Dolly_Settings::ADMIN_EVENTS ),
			'admins'           => array_map( function ( $u ) {
				return array( 'id' => (int) $u->ID, 'name' => Dolly_Employees::display_name( $u->ID ), 'email' => $u->user_email );
			}, $admins ),
			'cron'              => Dolly_Cron::status(),
			'push'              => Dolly_Push::status(),
			'storage'           => array(
				'outside_webroot' => Dolly_Install::private_dir_is_outside_webroot(),
				'https'           => 0 === strpos( home_url(), 'https://' ),
				'zip'             => class_exists( 'ZipArchive' ),
			),
		);
	}

	public static function admin_settings_update( WP_REST_Request $req ) {
		$r = Dolly_Settings::update( self::body( $req ) );
		return is_wp_error( $r ) ? $r : self::admin_settings_get();
	}

	/* ---------- Bluetooth device of a workplace ---------- */

	public static function admin_workplace_bluetooth( WP_REST_Request $req ) {
		$id = (int) $req['id'];
		if ( ! Dolly_Workplaces::get( $id ) ) {
			return new WP_Error( 'dolly_not_found', __( 'Sede non trovata.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		return Dolly_Bluetooth::admin_info( $id );
	}

	public static function admin_workplace_bluetooth_update( WP_REST_Request $req ) {
		$id = (int) $req['id'];
		if ( ! Dolly_Workplaces::get( $id ) ) {
			return new WP_Error( 'dolly_not_found', __( 'Sede non trovata.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$b = self::body( $req );
		if ( ! empty( $b['regenerate'] ) ) {
			Dolly_Bluetooth::regenerate( $id );
		} elseif ( isset( $b['enabled'] ) ) {
			Dolly_Bluetooth::enable( $id, (bool) $b['enabled'] );
		}
		return Dolly_Bluetooth::admin_info( $id );
	}

	/* ---------- Documents ---------- */

	public static function documents_list() {
		return Dolly_Documents::grouped( get_current_user_id() );
	}

	public static function document_download( WP_REST_Request $req ) {
		return Dolly_Documents::download( (int) $req['id'], (bool) $req->get_param( 'inline' ) );
	}

	public static function admin_documents_people( WP_REST_Request $req ) {
		return Dolly_Documents::people(
			array(
				'search' => $req->get_param( 'search' ),
				'status' => $req->get_param( 'status' ),
				'page'   => $req->get_param( 'page' ),
			)
		);
	}

	public static function admin_document_categories() {
		return Dolly_Documents::categories_list();
	}

	public static function admin_document_categories_save( WP_REST_Request $req ) {
		$b = self::body( $req );
		return Dolly_Documents::save_categories( $b['categories'] ?? array() );
	}

	/** Documents of one employee, grouped by category. */
	public static function admin_documents( WP_REST_Request $req ) {
		$uid = (int) $req->get_param( 'user_id' );
		if ( ! Dolly_Employees::is_employee( $uid ) ) {
			return new WP_Error( 'dolly_not_found', __( 'Dipendente non trovato.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		return array_merge( array( 'employee' => Dolly_Employees::sort_name( $uid ) ), Dolly_Documents::grouped( $uid ) );
	}

	/** Multipart: user_id, category, title, description, file. */
	public static function admin_document_send( WP_REST_Request $req ) {
		$files = $req->get_file_params();
		return Dolly_Documents::send(
			array(
				'user_id'     => $req->get_param( 'user_id' ),
				'category'    => $req->get_param( 'category' ),
				'title'       => $req->get_param( 'title' ),
				'description' => $req->get_param( 'description' ),
			),
			$files['file'] ?? null
		);
	}

	public static function admin_document_delete( WP_REST_Request $req ) {
		return Dolly_Documents::delete( (int) $req['id'] );
	}

	/** Guided setup: { step } saves progress, { complete: true } ends it. */
	public static function admin_onboarding( WP_REST_Request $req ) {
		$b = self::body( $req );
		if ( ! empty( $b['complete'] ) ) {
			Dolly_Onboarding::complete();
		} elseif ( isset( $b['step'] ) ) {
			Dolly_Onboarding::save_step( (string) $b['step'] );
		}
		return Dolly_Onboarding::client_config();
	}

	/** Tutorial of the current administrator: { state: done | skipped | '' (restart) }. */
	public static function admin_tour( WP_REST_Request $req ) {
		Dolly_Onboarding::set_tour_state( (string) ( self::body( $req )['state'] ?? 'done' ) );
		return Dolly_Onboarding::client_config();
	}

	public static function admin_appearance_get() {
		$a      = Dolly_Appearance::all();
		$images = array();
		foreach ( array( 'logo_id', 'logo_header_id', 'app_icon_id', 'login_bg_id' ) as $k ) {
			$images[ $k ] = $a[ $k ] ? (string) wp_get_attachment_image_url( $a[ $k ], 'medium' ) : '';
		}
		return array(
			'appearance' => $a,
			'defaults'   => Dolly_Appearance::defaults(),
			'choices'    => Dolly_Appearance::choices(),
			'images'     => $images,
			'contrast'   => Dolly_Appearance::contrast_report( $a ),
			'css'        => Dolly_Appearance::css( $a, 'admin' ),
			'auto'       => array(
				'app_name'             => Dolly_Appearance::brand() . ' · ' . Dolly_Appearance::get( 'portal_subtitle' ),
				'email_subject_prefix' => '[' . Dolly_Appearance::brand() . ']',
				'email_signature'      => '— ' . Dolly_Appearance::app_name(),
			),
		);
	}

	public static function admin_appearance_update( WP_REST_Request $req ) {
		$r = Dolly_Appearance::update( self::body( $req ) );
		return is_wp_error( $r ) ? $r : self::admin_appearance_get();
	}

	/** CSS of unsaved settings for the live preview, scoped to the preview box. */
	public static function admin_appearance_preview( WP_REST_Request $req ) {
		list( $a ) = Dolly_Appearance::sanitize( self::body( $req ), Dolly_Appearance::all() );
		return array(
			'css'      => Dolly_Appearance::css( $a, 'preview', '.dolly-preview' ),
			'contrast' => Dolly_Appearance::contrast_report( $a ),
		);
	}

	public static function admin_appearance_reset() {
		Dolly_Appearance::reset();
		return self::admin_appearance_get();
	}

	public static function admin_cron_run() {
		$r = Dolly_Cron::tick( 'manuale' );
		return array( 'result' => $r, 'cron' => Dolly_Cron::status() );
	}

	public static function cron( WP_REST_Request $req ) {
		$key = (string) $req->get_param( 'key' );
		if ( '' === $key || ! hash_equals( Dolly_Settings::cron_key(), $key ) ) {
			return new WP_Error( 'dolly_forbidden', __( 'Chiave non valida.', 'dolly-employee-management' ), array( 'status' => 403 ) );
		}
		return Dolly_Cron::tick( 'system-cron' );
	}
}
