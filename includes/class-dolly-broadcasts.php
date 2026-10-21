<?php
/**
 * Broadcast messages from the administrators to all employees or to chosen employees,
 * sent now or at a scheduled date and time, by email and/or in-app notification
 * (the in-app notification also reaches phones with push notifications enabled).
 *
 * Channels are chosen for each message, so the per-event notification switches do not apply.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Broadcasts {

	const STATUSES = array(
		'scheduled' => 'Programmato',
		'sending'   => 'In invio',
		'sent'      => 'Inviato',
		'cancelled' => 'Annullato',
	);

	public static function get( $id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'broadcasts' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d", $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	private static function recipients_of( $b ) {
		$r = json_decode( (string) $b->recipients, true );
		return is_array( $r ) ? $r : array( 'all' => true );
	}

	public static function format( $b ) {
		$r   = self::recipients_of( $b );
		$all = ! empty( $r['all'] );
		$ids = $all ? array() : array_map( 'intval', (array) ( $r['ids'] ?? array() ) );
		$names = array();
		foreach ( array_slice( $ids, 0, 5 ) as $uid ) {
			$names[] = Dolly_Employees::sort_name( $uid );
		}
		return array(
			'id'               => (int) $b->id,
			'title'            => $b->title,
			'message'          => $b->message,
			'all'              => $all,
			'recipient_ids'    => $ids,
			'recipients_label' => $all ? __( 'Tutti i dipendenti', 'dolly-employee-management' ) : ( sprintf( 1 === count( $ids ) ? /* translators: %d: number of employees. */ __( '%d dipendente', 'dolly-employee-management' ) : /* translators: %d: number of employees. */ __( '%d dipendenti', 'dolly-employee-management' ), count( $ids ) ) . ( $names ? ': ' . implode( ', ', $names ) . ( count( $ids ) > 5 ? '…' : '' ) : '' ) ),
			'email'            => (bool) $b->send_email,
			'portal'           => (bool) $b->send_portal,
			'popup'            => ! empty( $b->show_popup ),
			'send_at'          => Dolly_Time::iso( $b->send_at ),
			'status'           => $b->status,
			'status_label'     => Dolly_I18n::t( self::STATUSES[ $b->status ] ?? $b->status ),
			'sent_at'          => Dolly_Time::iso( $b->sent_at ),
			'recipient_count'  => (int) $b->recipient_count,
			'source'           => $b->source,
			'created_by'       => Dolly_Employees::display_name( (int) $b->created_by ),
			'created_at'       => Dolly_Time::iso( $b->created_at ),
		);
	}

	/**
	 * Creates a broadcast.
	 *
	 * @param array $data { title?, message, all?: bool, recipients?: int[], email: bool, portal: bool,
	 *                      send_now?: bool, send_date?: Y-m-d, send_time?: HH:MM }
	 */
	public static function create( $data, $source = 'manual' ) {
		global $wpdb;
		$errors  = array();
		$title   = mb_substr( sanitize_text_field( $data['title'] ?? '' ), 0, 190 );
		$message = sanitize_textarea_field( $data['message'] ?? '' );
		if ( '' === trim( $message ) ) {
			$errors['message'] = __( 'Scrivi il messaggio.', 'dolly-employee-management' );
		}
		$email  = ! empty( $data['email'] );
		$popup  = ! empty( $data['popup'] );
		// A pop-up message is also kept among the in-app notifications.
		$portal = ! empty( $data['portal'] ) || $popup;
		if ( ! $email && ! $portal ) {
			$errors['channels'] = __( 'Scegli almeno un canale: email e/o notifica nell\'app.', 'dolly-employee-management' );
		}
		$all = ! empty( $data['all'] );
		$ids = array();
		if ( ! $all ) {
			foreach ( (array) ( $data['recipients'] ?? array() ) as $id ) {
				if ( Dolly_Employees::is_employee( (int) $id ) ) {
					$ids[] = (int) $id;
				}
			}
			$ids = array_values( array_unique( $ids ) );
			if ( ! $ids ) {
				$errors['recipients'] = __( 'Seleziona almeno un dipendente.', 'dolly-employee-management' );
			}
		}
		$now = Dolly_Time::now_utc();
		if ( ! empty( $data['send_now'] ) ) {
			$send_at = $now;
		} else {
			$d = (string) ( $data['send_date'] ?? '' );
			$h = (string) ( $data['send_time'] ?? '' );
			if ( ! Dolly_Time::is_date( $d ) ) {
				$errors['send_date'] = __( 'Data di invio non valida.', 'dolly-employee-management' );
			}
			if ( ! Dolly_Time::is_time( $h ) ) {
				$errors['send_time'] = __( 'Orario di invio non valido.', 'dolly-employee-management' );
			}
			$send_at = empty( $errors['send_date'] ) && empty( $errors['send_time'] ) ? Dolly_Time::local_to_utc( $d, $h ) : $now;
			if ( empty( $errors['send_date'] ) && empty( $errors['send_time'] ) && Dolly_Time::utc_ts( $send_at ) < time() - 60 ) {
				$errors['send_time'] = __( 'Scegli una data e un orario futuri, oppure "Invia ora".', 'dolly-employee-management' );
			}
		}
		if ( $errors ) {
			return new WP_Error( 'dolly_invalid', __( 'Controlla i campi evidenziati.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => $errors ) );
		}
		$wpdb->insert(
			Dolly_Install::t( 'broadcasts' ),
			array(
				'title'       => '' !== $title ? $title : __( 'Comunicazione dall\'amministrazione', 'dolly-employee-management' ),
				'message'     => $message,
				'recipients'  => wp_json_encode( $all ? array( 'all' => true ) : array( 'ids' => $ids ) ),
				'send_email'  => $email ? 1 : 0,
				'send_portal' => $portal ? 1 : 0,
				'show_popup'  => $popup ? 1 : 0,
				'send_at'     => $send_at,
				'status'      => 'scheduled',
				'source'      => in_array( $source, array( 'manual', 'closure' ), true ) ? $source : 'manual',
				'created_by'  => get_current_user_id(),
				'created_at'  => $now,
			)
		);
		$id = (int) $wpdb->insert_id;
		Dolly_Audit::log( 'broadcast_created', 'broadcast', $id, 0, $title, null, array( 'recipients' => $all ? 'tutti' : count( $ids ), 'send_at' => Dolly_Time::utc_to_local( $send_at, 'd/m/Y H:i' ) ) );
		if ( ! empty( $data['send_now'] ) ) {
			self::dispatch( $id );
		}
		return self::format( self::get( $id ) );
	}

	/** Cancels a scheduled broadcast that has not been sent yet. */
	public static function cancel( $id ) {
		global $wpdb;
		$ok = $wpdb->update( Dolly_Install::t( 'broadcasts' ), array( 'status' => 'cancelled' ), array( 'id' => (int) $id, 'status' => 'scheduled' ) );
		if ( ! $ok ) {
			return new WP_Error( 'dolly_invalid_state', __( 'Il messaggio è già stato inviato o annullato.', 'dolly-employee-management' ), array( 'status' => 409 ) );
		}
		Dolly_Audit::log( 'broadcast_cancelled', 'broadcast', (int) $id );
		return self::format( self::get( $id ) );
	}

	/**
	 * Sends a broadcast. The row is claimed first, so overlapping scheduler runs never send it twice.
	 * "All employees" is resolved at sending time (active employees only).
	 */
	public static function dispatch( $id ) {
		global $wpdb;
		$t       = Dolly_Install::t( 'broadcasts' );
		$claimed = $wpdb->update( $t, array( 'status' => 'sending' ), array( 'id' => (int) $id, 'status' => 'scheduled' ) );
		if ( ! $claimed ) {
			return 0;
		}
		$b   = self::get( $id );
		$r   = self::recipients_of( $b );
		$ids = ! empty( $r['all'] ) ? Dolly_Employees::active_ids() : array_filter( array_map( 'intval', (array) ( $r['ids'] ?? array() ) ), array( 'Dolly_Employees', 'is_active' ) );
		$n   = 0;
		foreach ( $ids as $uid ) {
			Dolly_Notifications::deliver( $uid, 'broadcast', $b->title, $b->message, 'notifiche', (bool) $b->send_portal, (bool) $b->send_email, 'bc-' . $b->id, ! empty( $b->show_popup ) );
			$n++;
		}
		$wpdb->update( $t, array( 'status' => 'sent', 'sent_at' => Dolly_Time::now_utc(), 'recipient_count' => $n ), array( 'id' => (int) $id ) );
		return $n;
	}

	/** Scheduled: sends the broadcasts whose time has come. */
	public static function process_due() {
		global $wpdb;
		$t   = Dolly_Install::t( 'broadcasts' );
		$ids = $wpdb->get_col( $wpdb->prepare( "SELECT id FROM $t WHERE status = 'scheduled' AND send_at <= %s ORDER BY send_at ASC LIMIT 10", Dolly_Time::now_utc() ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		foreach ( $ids as $id ) {
			self::dispatch( (int) $id );
		}
	}

	public static function query( $args ) {
		global $wpdb;
		$t     = Dolly_Install::t( 'broadcasts' );
		$per   = max( 1, min( 100, (int) ( $args['per_page'] ?? 10 ) ) );
		$page  = max( 1, (int) ( $args['page'] ?? 1 ) );
		$count = (int) $wpdb->get_var( "SELECT COUNT(*) FROM $t" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		$rows  = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t ORDER BY FIELD(status,'scheduled') DESC, send_at DESC, id DESC LIMIT %d OFFSET %d", $per, ( $page - 1 ) * $per ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		return array(
			'items' => array_map( array( __CLASS__, 'format' ), $rows ),
			'total' => $count,
			'pages' => (int) ceil( $count / $per ),
			'page'  => $page,
		);
	}
}
