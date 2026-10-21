<?php
/**
 * Blood donation leave ("donazione"): a full-day request that, once approved, asks the employee for the
 * donation certificate from the day after the donation. It follows the rules of the medical certificate
 * (settings "donation_certificate_mode" / "donation_certificate_days"); files are stored like medical ones.
 *
 * Certificate state on the request row (column certificate_status):
 *   waiting → the donation day is not over yet · missing → to upload · overdue → deadline passed
 *   uploaded · not_required · cleared (requirement disabled from the settings)
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Donations {

	const TYPE = 'donazione';

	const CERT_STATUSES = array(
		'waiting'      => 'Certificato da caricare dopo la donazione',
		'not_required' => 'Non richiesto',
		'missing'      => 'Certificato mancante',
		'overdue'      => 'Certificato scaduto',
		'uploaded'     => 'Certificato caricato',
		'cleared'      => 'Requisito annullato',
	);

	private static function table() {
		return Dolly_Install::t( 'requests' );
	}

	public static function certificates( $request_id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'certificates' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE request_id = %d ORDER BY uploaded_at ASC", $request_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	/** Certificate fields of a donation request for the REST output. */
	public static function format_certificate( $r ) {
		$certs = array();
		foreach ( self::certificates( (int) $r->id ) as $c ) {
			$certs[] = array(
				'id'            => (int) $c->id,
				'original_name' => $c->original_name,
				'size'          => (int) $c->size_bytes,
				'uploaded_at'   => Dolly_Time::iso( $c->uploaded_at ),
				'download_url'  => rest_url( DOLLY_REST_NS . '/certificates/' . (int) $c->id . '/download' ),
			);
		}
		$status = (string) $r->certificate_status;
		return array(
			'certificate_status' => $status,
			'certificate_label'  => Dolly_I18n::t( self::CERT_STATUSES[ $status ] ?? '' ),
			'certificate_due'    => $r->certificate_due,
			'certificates'       => $certs,
			// The employee can upload from the day after the donation (or earlier if already requested).
			'can_upload'         => 'approved' === $r->status && 'cancel' !== $r->amend_action && in_array( $status, array( 'missing', 'overdue', 'uploaded' ), true ),
		);
	}

	/** Approval of a donation: the certificate will be requested once the donation day has passed. */
	public static function on_approved( $r ) {
		global $wpdb;
		if ( self::TYPE !== $r->type || 'cancel' === $r->amend_action ) {
			return;
		}
		$mode = Dolly_Settings::get( 'donation_certificate_mode' );
		$wpdb->update( self::table(), array( 'certificate_status' => 'disabled' === $mode ? 'not_required' : 'waiting', 'certificate_due' => null ), array( 'id' => (int) $r->id ) );
		if ( $r->parent_id ) {
			// A modification replaces the original request: its requirement is closed.
			self::close_requirement( (int) $r->parent_id, __( 'Richiesta di donazione sostituita da una modifica.', 'dolly-employee-management' ) );
		}
		self::request_certificates();
	}

	/** The donation was cancelled: nothing to upload anymore. */
	public static function on_cancelled( $request_id ) {
		self::close_requirement( (int) $request_id, __( 'Donazione annullata.', 'dolly-employee-management' ) );
	}

	private static function close_requirement( $request_id, $note ) {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::table() . " SET certificate_status = 'cleared' WHERE id = %d AND certificate_status IN ('waiting','missing','overdue')", $request_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		Dolly_Anomalies::resolve_by_key( 'doncert-' . $request_id, 'dismissed', $note );
	}

	/**
	 * Scheduled: from the day after the donation, asks for the certificate (notification, anomaly
	 * "certificato mancante" and "Carica certificato" on the request).
	 */
	public static function request_certificates() {
		global $wpdb;
		$mode = Dolly_Settings::get( 'donation_certificate_mode' );
		if ( 'disabled' === $mode ) {
			return;
		}
		$t     = self::table();
		$today = Dolly_Time::today();
		$rows  = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE type = %s AND status = 'approved' AND certificate_status = 'waiting' AND " . Dolly_Requests::EFFECTIVE_ROW . ' AND end_date < %s', self::TYPE, $today ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		foreach ( $rows as $r ) {
			$due = 'deadline' === $mode ? Dolly_Time::add_days( $today, (int) Dolly_Settings::get( 'donation_certificate_days' ) ) : null;
			// Conditional update: only one run sends the request.
			$ok = $wpdb->update( $t, array( 'certificate_status' => 'missing', 'certificate_due' => $due ), array( 'id' => (int) $r->id, 'certificate_status' => 'waiting' ) );
			if ( ! $ok ) {
				continue;
			}
			$uid  = (int) $r->user_id;
			$day  = Dolly_Time::fmt_date( $r->start_date );
			$body = __( 'Carica il certificato della donazione di sangue del ', 'dolly-employee-management' ) . $day . ( $due ? __( ' entro il ', 'dolly-employee-management' ) . Dolly_Time::fmt_date( $due ) : '' ) . __( ': Richieste › Donazione sangue › Carica certificato.', 'dolly-employee-management' );
			Dolly_Anomalies::open( $uid, 'missing_certificate', 'doncert-' . (int) $r->id, $r->start_date, 'request', (int) $r->id, __( 'Certificato di donazione sangue mancante per il ', 'dolly-employee-management' ) . $day . ( $due ? __( ' (scadenza ', 'dolly-employee-management' ) . Dolly_Time::fmt_date( $due ) . ')' : '' ) );
			Dolly_Notifications::notify_user( $uid, 'certificate_required', fn () => array( __( 'Certificato di donazione richiesto', 'dolly-employee-management' ), $body ), null, 'richieste', 'doncertreq-' . (int) $r->id );
			Dolly_Notifications::notify_admins( 'certificate_required', fn () => array( __( 'Certificato di donazione richiesto: ', 'dolly-employee-management' ) . Dolly_Employees::display_name( $uid ), __( 'Donazione sangue del ', 'dolly-employee-management' ) . $day . '.' ), null, 'dolly-requests', 'doncertreq-' . (int) $r->id );
		}
	}

	/** Scheduled: marks missing donation certificates overdue once the deadline has passed. */
	public static function check_overdue() {
		global $wpdb;
		if ( 'deadline' !== Dolly_Settings::get( 'donation_certificate_mode' ) ) {
			return;
		}
		$t    = self::table();
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE type = %s AND certificate_status = 'missing' AND certificate_due IS NOT NULL AND certificate_due < %s", self::TYPE, Dolly_Time::today() ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		foreach ( $rows as $r ) {
			if ( ! $wpdb->update( $t, array( 'certificate_status' => 'overdue' ), array( 'id' => (int) $r->id, 'certificate_status' => 'missing' ) ) ) {
				continue;
			}
			Dolly_Anomalies::mark_overdue( 'doncert-' . (int) $r->id );
			$day = Dolly_Time::fmt_date( $r->start_date );
			Dolly_Notifications::notify_user( (int) $r->user_id, 'certificate_overdue', fn () => array( __( 'Certificato di donazione scaduto', 'dolly-employee-management' ), __( 'Il termine per il certificato della donazione di sangue del ', 'dolly-employee-management' ) . $day . __( ' è scaduto. Caricalo appena possibile.', 'dolly-employee-management' ) ), null, 'richieste', 'doncertover-' . (int) $r->id );
			Dolly_Notifications::notify_admins( 'certificate_overdue', fn () => array( __( 'Certificato di donazione scaduto: ', 'dolly-employee-management' ) . Dolly_Employees::display_name( (int) $r->user_id ), __( 'Donazione sangue del ', 'dolly-employee-management' ) . $day . '.' ), null, 'dolly-anomalies', 'doncertover-' . (int) $r->id );
		}
	}

	/**
	 * Stores the donation certificate (employee owner or administrator).
	 *
	 * @param array $file Entry from WP_REST_Request::get_file_params().
	 */
	public static function upload_certificate( $request_id, $file, $as_admin = false ) {
		global $wpdb;
		$r = Dolly_Requests::get( $request_id );
		// A row that replaced the original after an approved modification is the effective donation: only cancellations are excluded.
		if ( ! $r || self::TYPE !== $r->type || 'cancel' === $r->amend_action ) {
			return new WP_Error( 'dolly_not_found', __( 'Richiesta di donazione non trovata.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		if ( ! $as_admin && (int) $r->user_id !== get_current_user_id() ) {
			return new WP_Error( 'dolly_forbidden', __( 'Non autorizzato.', 'dolly-employee-management' ), array( 'status' => 403 ) );
		}
		if ( 'approved' !== $r->status ) {
			return new WP_Error( 'dolly_invalid_state', __( 'Il certificato si carica dopo l\'approvazione della richiesta.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		if ( ! $as_admin && 'waiting' === $r->certificate_status ) {
			return new WP_Error( 'dolly_invalid_state', __( 'Potrai caricare il certificato dal giorno successivo alla donazione.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		$stored = Dolly_Sickness::store_upload( $file );
		if ( is_wp_error( $stored ) ) {
			return $stored;
		}
		$wpdb->insert(
			Dolly_Install::t( 'certificates' ),
			array(
				'sickness_id'   => 0,
				'request_id'    => (int) $r->id,
				'user_id'       => (int) $r->user_id,
				'file_name'     => $stored['file_name'],
				'original_name' => $stored['original_name'],
				'mime'          => $stored['mime'],
				'size_bytes'    => $stored['size_bytes'],
				'uploaded_by'   => get_current_user_id(),
				'uploaded_at'   => Dolly_Time::now_utc(),
			)
		);
		$cert_id = (int) $wpdb->insert_id;
		$wpdb->update( self::table(), array( 'certificate_status' => 'uploaded' ), array( 'id' => (int) $r->id ) );
		Dolly_Anomalies::resolve_by_key( 'doncert-' . (int) $r->id, 'certificate_uploaded', __( 'Certificato di donazione caricato.', 'dolly-employee-management' ) );
		Dolly_Notifications::notify_admins( 'certificate_uploaded', fn () => array( __( 'Certificato di donazione caricato da ', 'dolly-employee-management' ) . Dolly_Employees::display_name( (int) $r->user_id ), __( 'Donazione sangue del ', 'dolly-employee-management' ) . Dolly_Time::fmt_date( $r->start_date ) ), null, 'dolly-requests', 'doncertup-' . $cert_id );
		return Dolly_Requests::format( Dolly_Requests::get( (int) $r->id ) );
	}

	/** Disabling the certificate clears outstanding requirements with an audit entry. */
	public static function clear_outstanding_requirements() {
		global $wpdb;
		$t   = self::table();
		$ids = array_map( 'intval', $wpdb->get_col( $wpdb->prepare( "SELECT id FROM $t WHERE type = %s AND certificate_status IN ('waiting','missing','overdue')", self::TYPE ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		if ( ! $ids ) {
			return 0;
		}
		$wpdb->query( "UPDATE $t SET certificate_status = 'cleared' WHERE id IN (" . implode( ',', $ids ) . ')' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		foreach ( $ids as $id ) {
			Dolly_Anomalies::resolve_by_key( 'doncert-' . $id, 'certificates_disabled', __( 'Requisito certificato di donazione disattivato dalle impostazioni.', 'dolly-employee-management' ) );
		}
		Dolly_Audit::log( 'donation_certificates_disabled', 'settings', 0, 0, __( 'Certificati di donazione disattivati: requisiti in sospeso annullati.', 'dolly-employee-management' ), array( 'request_ids' => $ids ), array( 'certificate_status' => 'cleared' ) );
		return count( $ids );
	}

	/** Applies the configured deadline to outstanding requirements (counted from today). */
	public static function apply_deadlines() {
		global $wpdb;
		$t   = self::table();
		$due = Dolly_Time::add_days( Dolly_Time::today(), (int) Dolly_Settings::get( 'donation_certificate_days' ) );
		$wpdb->query( $wpdb->prepare( "UPDATE $t SET certificate_due = %s WHERE type = %s AND certificate_status = 'missing'", $due, self::TYPE ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}
}
