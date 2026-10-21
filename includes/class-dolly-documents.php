<?php
/**
 * Employee documents: contracts, CU, payslips and other files the administrator sends to an employee.
 *
 * Storage: every employee has an own directory inside the private directory (outside the web root when
 * possible): documents/u{ID}-{random token}. The token is stored in the user's meta, so directory names
 * cannot be guessed, and every directory has deny rules (.htaccess, web.config) and an empty index.
 * Files are saved with random names and are only served by the REST API, to the employee they belong
 * to (while active) and to administrators.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Documents {

	const MAX_BYTES = 20971520; // 20 MB.

	/** Default categories: always present, they cannot be removed. */
	const CATEGORIES = array(
		'contratto'  => 'Contract',
		'cu'         => 'Tax certificate (CU)',
		'busta_paga' => 'Payslip',
		'altro'      => 'Other',
	);

	/** Categories added by the administrators: [key => label]. */
	const CUSTOM_OPTION = 'dolly_document_categories';
	const TOKEN_META    = 'dolly_documents_token';

	const ALLOWED = array(
		'pdf'  => 'application/pdf',
		'jpg'  => 'image/jpeg',
		'jpeg' => 'image/jpeg',
		'png'  => 'image/png',
		'doc'  => 'application/msword',
		'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'xls'  => 'application/vnd.ms-excel',
		'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		'odt'  => 'application/vnd.oasis.opendocument.text',
		'ods'  => 'application/vnd.oasis.opendocument.spreadsheet',
	);

	/** Content types accepted for each extension (office files are zip or OLE containers for fileinfo). */
	const REAL_TYPES = array(
		'pdf'  => array( 'application/pdf' ),
		'jpg'  => array( 'image/jpeg' ),
		'jpeg' => array( 'image/jpeg' ),
		'png'  => array( 'image/png' ),
		'doc'  => array( 'application/msword', 'application/vnd.ms-office', 'application/CDFV2', 'application/x-ole-storage' ),
		'docx' => array( 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream' ),
		'xls'  => array( 'application/vnd.ms-excel', 'application/vnd.ms-office', 'application/CDFV2', 'application/x-ole-storage' ),
		'xlsx' => array( 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream' ),
		'odt'  => array( 'application/vnd.oasis.opendocument.text', 'application/zip' ),
		'ods'  => array( 'application/vnd.oasis.opendocument.spreadsheet', 'application/zip' ),
	);

	/** Types the browser may show in a tab ("Apri"); everything else is downloaded. */
	const INLINE = array( 'application/pdf', 'image/jpeg', 'image/png' );

	/* ---------- Categories ---------- */

	private static function custom() {
		$c = get_option( self::CUSTOM_OPTION, array() );
		return is_array( $c ) ? $c : array();
	}

	/** All categories: [key => translated label], defaults first ("Altro" last). */
	public static function categories() {
		$out = array();
		foreach ( self::CATEGORIES as $k => $label ) {
			if ( 'altro' !== $k ) {
				$out[ $k ] = Dolly_I18n::t( $label );
			}
		}
		foreach ( self::custom() as $k => $label ) {
			$out[ $k ] = $label;
		}
		$out['altro'] = Dolly_I18n::t( self::CATEGORIES['altro'] );
		return $out;
	}

	/** Categories for the REST output: [{ key, label, custom, count }]. */
	public static function categories_list() {
		global $wpdb;
		$t      = Dolly_Install::t( 'documents' );
		$counts = array();
		foreach ( $wpdb->get_results( "SELECT category, COUNT(*) AS n FROM $t GROUP BY category" ) as $r ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
			$counts[ $r->category ] = (int) $r->n;
		}
		$out = array();
		foreach ( self::categories() as $k => $label ) {
			$out[] = array(
				'key'    => $k,
				'label'  => $label,
				'custom' => ! isset( self::CATEGORIES[ $k ] ),
				'count'  => $counts[ $k ] ?? 0,
			);
		}
		return $out;
	}

	/**
	 * Saves the custom categories: [{ key?, label }]. New ones get a key from the label; removed ones
	 * move their documents to "Altro".
	 */
	public static function save_categories( $items ) {
		global $wpdb;
		$old    = self::custom();
		$new    = array();
		$errors = array();
		$taken  = array_map( 'mb_strtolower', array_map( array( 'Dolly_I18n', 't' ), self::CATEGORIES ) );
		foreach ( (array) $items as $i => $item ) {
			$label = trim( sanitize_text_field( (string) ( $item['label'] ?? '' ) ) );
			if ( '' === $label ) {
				continue;
			}
			$label = mb_substr( $label, 0, 40 );
			if ( in_array( mb_strtolower( $label ), $taken, true ) ) {
				$errors[ 'category_' . $i ] = __( 'A category with this name already exists.', 'dolly-employee-management' );
				continue;
			}
			$taken[] = mb_strtolower( $label );
			$key     = sanitize_key( (string) ( $item['key'] ?? '' ) );
			if ( ! $key || ! isset( $old[ $key ] ) ) {
				$base = substr( 'c_' . sanitize_key( remove_accents( str_replace( ' ', '_', $label ) ) ), 0, 30 );
				$key  = $base;
				for ( $n = 2; isset( $new[ $key ] ) || isset( $old[ $key ] ) || isset( self::CATEGORIES[ $key ] ); $n++ ) {
					$key = $base . '_' . $n;
				}
			}
			$new[ $key ] = $label;
		}
		if ( $errors ) {
			return new WP_Error( 'dolly_invalid', __( 'Check the category names.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => $errors ) );
		}
		$t = Dolly_Install::t( 'documents' );
		foreach ( array_diff_key( $old, $new ) as $key => $label ) {
			$wpdb->update( $t, array( 'category' => 'altro' ), array( 'category' => $key ) );
		}
		update_option( self::CUSTOM_OPTION, $new, false );
		if ( $old !== $new ) {
			Dolly_Audit::log( 'document_categories', 'settings', 0, 0, '', $old, $new );
		}
		return self::categories_list();
	}

	/* ---------- Storage ---------- */

	/** Private directory of an employee's documents, created and protected on first use. */
	private static function user_dir( $user_id, $create = false ) {
		$root = Dolly_Install::private_dir() . '/documents';
		$tok  = (string) get_user_meta( $user_id, self::TOKEN_META, true );
		if ( ! preg_match( '/^[a-f0-9]{32}$/', $tok ) ) {
			if ( ! $create ) {
				return '';
			}
			$tok = bin2hex( random_bytes( 16 ) );
			update_user_meta( $user_id, self::TOKEN_META, $tok );
		}
		$dir = $root . '/u' . (int) $user_id . '-' . $tok;
		if ( $create && ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
			@chmod( $dir, 0750 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.file_system_operations_chmod -- failure handled by the caller; private files of the plugin.
			Dolly_Install::protect_dir( $root );
			Dolly_Install::protect_dir( $dir );
		}
		return $dir;
	}

	private static function path( $doc ) {
		$dir  = self::user_dir( (int) $doc->user_id );
		$name = (string) $doc->file_name;
		return $dir && preg_match( '/^[a-f0-9]{40}$/', $name ) ? $dir . '/' . $name : '';
	}

	/** Validates the upload and moves it to the employee's directory. Returns table values or WP_Error. */
	private static function store( $user_id, $file ) {
		if ( empty( $file ) || ! isset( $file['tmp_name'] ) || UPLOAD_ERR_OK !== (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) ) {
			$code = (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE );
			$msg  = in_array( $code, array( UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE ), true ) ? __( 'The file exceeds the maximum size allowed by the server.', 'dolly-employee-management' ) : __( 'Choose the file to send.', 'dolly-employee-management' );
			return new WP_Error( 'dolly_upload', $msg, array( 'status' => 400, 'fields' => array( 'file' => $msg ) ) );
		}
		if ( (int) $file['size'] > self::MAX_BYTES ) {
			return new WP_Error( 'dolly_upload', __( 'The file is larger than 20 MB.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => array( 'file' => __( 'The file is larger than 20 MB.', 'dolly-employee-management' ) ) ) );
		}
		if ( ! is_uploaded_file( $file['tmp_name'] ) ) {
			return new WP_Error( 'dolly_upload', __( 'Invalid upload.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		$bad   = __( 'File type not allowed. Upload a PDF, an image (JPG, PNG), a Word, Excel or OpenDocument file.', 'dolly-employee-management' );
		$check = wp_check_filetype( $file['name'], self::ALLOWED );
		$ext   = $check['ext'] ? strtolower( $check['ext'] ) : '';
		if ( ! $ext || ! isset( self::ALLOWED[ $ext ] ) ) {
			return new WP_Error( 'dolly_upload', $bad, array( 'status' => 400, 'fields' => array( 'file' => $bad ) ) );
		}
		if ( function_exists( 'finfo_open' ) ) {
			$fi   = finfo_open( FILEINFO_MIME_TYPE );
			$real = finfo_file( $fi, $file['tmp_name'] );
			finfo_close( $fi );
			if ( ! in_array( $real, self::REAL_TYPES[ $ext ], true ) ) {
				$msg = __( 'The content of the file does not match its extension.', 'dolly-employee-management' );
				return new WP_Error( 'dolly_upload', $msg, array( 'status' => 400, 'fields' => array( 'file' => $msg ) ) );
			}
		}
		$dir  = self::user_dir( $user_id, true );
		$name = bin2hex( random_bytes( 20 ) );
		if ( ! $dir || ! @move_uploaded_file( $file['tmp_name'], $dir . '/' . $name ) ) {
			return new WP_Error( 'dolly_upload', __( 'Unable to save the file. Check the permissions of the private folder.', 'dolly-employee-management' ), array( 'status' => 500 ) );
		}
		@chmod( $dir . '/' . $name, 0640 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.file_system_operations_chmod -- failure handled by the caller; private files of the plugin.
		return array(
			'file_name'     => $name,
			'original_name' => sanitize_file_name( $file['name'] ),
			'mime'          => self::ALLOWED[ $ext ],
			'size_bytes'    => (int) $file['size'],
		);
	}

	/* ---------- Records ---------- */

	public static function get( $id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'documents' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id = %d", $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	public static function format( $d ) {
		$cats = self::categories();
		$url  = DOLLY_REST_NS . '/documents/' . (int) $d->id . '/download';
		return array(
			'id'            => (int) $d->id,
			'user_id'       => (int) $d->user_id,
			'category'      => $d->category,
			'category_label'=> $cats[ $d->category ] ?? $cats['altro'],
			'title'         => $d->title,
			'description'   => (string) $d->description,
			'original_name' => $d->original_name,
			'mime'          => $d->mime,
			'size'          => (int) $d->size_bytes,
			'uploaded_at'   => Dolly_Time::iso( $d->uploaded_at ),
			'uploaded_by'   => $d->uploaded_by ? Dolly_Employees::display_name( (int) $d->uploaded_by ) : '',
			'viewed_at'     => $d->viewed_at ? Dolly_Time::iso( $d->viewed_at ) : null,
			'inline'        => in_array( $d->mime, self::INLINE, true ),
			'download_url'  => rest_url( $url ),
		);
	}

	/** Documents of an employee grouped by category: [{ key, label, items: [...] }] (all categories). */
	public static function grouped( $user_id ) {
		global $wpdb;
		$t      = Dolly_Install::t( 'documents' );
		$rows   = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d ORDER BY uploaded_at DESC, id DESC", $user_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
		$groups = array();
		foreach ( self::categories() as $k => $label ) {
			$groups[ $k ] = array(
				'key'   => $k,
				'label' => $label,
				'items' => array(),
			);
		}
		foreach ( $rows as $r ) {
			$k                        = isset( $groups[ $r->category ] ) ? $r->category : 'altro';
			$groups[ $k ]['items'][] = self::format( $r );
		}
		return array(
			'total'  => count( $rows ),
			'unread' => count( array_filter( $rows, function ( $r ) {
				return ! $r->viewed_at;
			} ) ),
			'groups' => array_values( $groups ),
		);
	}

	/** Documents of an employee not opened yet. */
	public static function unread_count( $user_id ) {
		global $wpdb;
		$t = Dolly_Install::t( 'documents' );
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE user_id = %d AND viewed_at IS NULL", $user_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
	}

	/** Employees with their number of documents (Documenti page): search + pagination. */
	public static function people( $args ) {
		global $wpdb;
		$res = Dolly_Employees::query(
			array(
				'search'   => $args['search'] ?? '',
				'status'   => $args['status'] ?? 'all',
				'page'     => $args['page'] ?? 1,
				'per_page' => 10,
			)
		);
		$ids = wp_list_pluck( $res['items'], 'id' );
		$cnt = array();
		if ( $ids ) {
			$t  = Dolly_Install::t( 'documents' );
			$in = implode( ',', array_map( 'intval', $ids ) );
			foreach ( $wpdb->get_results( "SELECT user_id, COUNT(*) AS n, MAX(uploaded_at) AS last_at FROM $t WHERE user_id IN ($in) GROUP BY user_id" ) as $r ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- plugin tables ($wpdb->prefix), values prepared or cast.
				$cnt[ (int) $r->user_id ] = $r;
			}
		}
		$res['items'] = array_map(
			function ( $e ) use ( $cnt ) {
				$c = $cnt[ (int) $e['id'] ] ?? null;
				return array(
					'id'         => (int) $e['id'],
					'name'       => $e['sort_name'] ?? $e['name'],
					'username'   => $e['username'],
					'email'      => $e['email'],
					'active'     => (bool) $e['active'],
					'workplaces' => implode( ', ', wp_list_pluck( (array) ( $e['workplaces'] ?? array() ), 'name' ) ),
					'documents'  => $c ? (int) $c->n : 0,
					'last_at'    => $c ? Dolly_Time::iso( $c->last_at ) : null,
				);
			},
			$res['items']
		);
		return $res;
	}

	/**
	 * Sends a document to an employee: { user_id, category, title, description? } + file.
	 * The employee is notified (event "document_received").
	 */
	public static function send( array $data, $file ) {
		global $wpdb;
		$uid    = (int) ( $data['user_id'] ?? 0 );
		$cat    = sanitize_key( (string) ( $data['category'] ?? '' ) );
		$title  = trim( sanitize_text_field( (string) ( $data['title'] ?? '' ) ) );
		$desc   = trim( sanitize_textarea_field( (string) ( $data['description'] ?? '' ) ) );
		$errors = array();
		if ( ! $uid || ! Dolly_Employees::is_employee( $uid ) ) {
			return new WP_Error( 'dolly_not_found', __( 'Employee not found.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		if ( ! isset( self::categories()[ $cat ] ) ) {
			$errors['category'] = __( 'Choose a category.', 'dolly-employee-management' );
		}
		if ( '' === $title ) {
			$errors['title'] = __( 'Required field.', 'dolly-employee-management' );
		}
		if ( $errors ) {
			return new WP_Error( 'dolly_invalid', __( 'Check the highlighted fields.', 'dolly-employee-management' ), array( 'status' => 400, 'fields' => $errors ) );
		}
		$stored = self::store( $uid, $file );
		if ( is_wp_error( $stored ) ) {
			return $stored;
		}
		$wpdb->insert(
			Dolly_Install::t( 'documents' ),
			array_merge(
				$stored,
				array(
					'user_id'     => $uid,
					'category'    => $cat,
					'title'       => mb_substr( $title, 0, 190 ),
					'description' => '' === $desc ? null : mb_substr( $desc, 0, 2000 ),
					'uploaded_by' => get_current_user_id(),
					'uploaded_at' => Dolly_Time::now_utc(),
				)
			)
		);
		$id  = (int) $wpdb->insert_id;
		$doc = self::get( $id );
		Dolly_Audit::log( 'document_sent', 'document', $id, $uid, '', null, array( 'category' => $cat, 'title' => $doc->title, 'file' => $doc->original_name ) );
		Dolly_Notifications::notify_user(
			$uid,
			'document_received',
			fn () => array(
				sprintf( /* translators: %s: document title. */ __( 'New document: %s', 'dolly-employee-management' ), $doc->title ),
				sprintf( /* translators: %s: document category. */ __( 'Category: %s. You find it in the Documents section of the portal.', 'dolly-employee-management' ), self::categories()[ $doc->category ] ?? $doc->category ) . ( $doc->description ? "\n" . $doc->description : '' ),
			),
			null,
			'documenti'
		);
		return self::format( $doc );
	}

	/** Deletes a document and its file (administrators only). */
	public static function delete( $id ) {
		global $wpdb;
		$d = self::get( $id );
		if ( ! $d ) {
			return new WP_Error( 'dolly_not_found', __( 'Document not found.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$path = self::path( $d );
		if ( $path && file_exists( $path ) ) {
			wp_delete_file( $path );
		}
		$wpdb->delete( Dolly_Install::t( 'documents' ), array( 'id' => (int) $d->id ) );
		Dolly_Audit::log( 'document_deleted', 'document', (int) $d->id, (int) $d->user_id, '', array( 'category' => $d->category, 'title' => $d->title, 'file' => $d->original_name ), null );
		return array( 'deleted' => true );
	}

	/**
	 * Streams a document to its employee (active account) or to an administrator. "inline" shows PDF and
	 * images in the browser; the first opening by the employee is recorded.
	 */
	public static function download( $id, $inline = false ) {
		global $wpdb;
		$d = self::get( $id );
		if ( ! $d ) {
			return new WP_Error( 'dolly_not_found', __( 'Document not found.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		$uid      = get_current_user_id();
		$is_admin = current_user_can( 'dolly_manage' );
		$is_owner = (int) $d->user_id === $uid && Dolly_Employees::is_active( $uid );
		if ( ! $is_admin && ! $is_owner ) {
			return new WP_Error( 'dolly_forbidden', __( 'You are not allowed to open this document.', 'dolly-employee-management' ), array( 'status' => 403 ) );
		}
		$path = self::path( $d );
		if ( ! $path || ! is_readable( $path ) ) {
			return new WP_Error( 'dolly_not_found', __( 'File not available.', 'dolly-employee-management' ), array( 'status' => 404 ) );
		}
		if ( $is_owner && ! $d->viewed_at ) {
			$wpdb->update( Dolly_Install::t( 'documents' ), array( 'viewed_at' => Dolly_Time::now_utc() ), array( 'id' => (int) $d->id ) );
		} elseif ( $is_admin && ! $is_owner ) {
			Dolly_Audit::log( 'document_opened', 'document', (int) $d->id, (int) $d->user_id );
		}
		$inline = $inline && in_array( $d->mime, self::INLINE, true );
		nocache_headers();
		header( 'Content-Type: ' . $d->mime );
		header( 'Content-Length: ' . filesize( $path ) );
		header( 'Content-Disposition: ' . ( $inline ? 'inline' : 'attachment' ) . '; filename="' . rawurlencode( $d->original_name ) . '"; filename*=UTF-8\'\'' . rawurlencode( $d->original_name ) );
		header( 'X-Content-Type-Options: nosniff' );
		header( 'Referrer-Policy: no-referrer' );
		readfile( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile -- private files of the plugin.
		exit;
	}
}
