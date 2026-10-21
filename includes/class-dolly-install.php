<?php
/**
 * Installation, migrations, roles and capabilities.
 *
 * Data is never dropped on deactivation or upgrade; historical records are preserved.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Install {

	const ROLE_EMPLOYEE  = 'dipendenti';
	const ROLE_WORKPLACE = 'dolly_sede';

	/** Fully-qualified table name. */
	public static function t( $name ) {
		global $wpdb;
		return $wpdb->prefix . 'dolly_' . $name;
	}

	public static function activate() {
		self::create_tables();
		self::create_roles();
		self::ensure_private_dir();
		Dolly_Settings::cron_key();
		if ( false === get_option( Dolly_Settings::OPTION, false ) ) {
			add_option( Dolly_Settings::OPTION, Dolly_Settings::defaults(), '', false );
			Dolly_Settings::cron_key();
		}
		self::mark_feature_dates();
		Dolly_Hours::rename_old_codes(); // Also after a deactivate / replace files / activate upgrade.
		update_option( 'dolly_db_version', DOLLY_DB_VERSION, false );
		Dolly_Cron::schedule();
		Dolly_Onboarding::on_activation();
		Dolly_Frontend::add_rewrites();
		flush_rewrite_rules();
	}

	public static function deactivate() {
		Dolly_Cron::unschedule();
		flush_rewrite_rules();
	}

	public static function maybe_upgrade() {
		if ( get_option( 'dolly_db_version' ) !== DOLLY_DB_VERSION ) {
			self::create_tables();
			self::create_roles();
			self::ensure_private_dir();
			self::mark_feature_dates();
			// Version 1.7: the labels of the hours history changed (L → O, ST → S, Fs → FS).
			Dolly_Hours::rename_old_codes();
			update_option( 'dolly_db_version', DOLLY_DB_VERSION, false );
		}
	}

	/**
	 * Unjustified-absence checks start from the day the feature is installed:
	 * earlier days are never flagged retroactively.
	 */
	private static function mark_feature_dates() {
		if ( ! get_option( 'dolly_absence_since' ) ) {
			update_option( 'dolly_absence_since', Dolly_Time::today(), false );
		}
	}

	public static function create_roles() {
		if ( ! get_role( self::ROLE_EMPLOYEE ) ) {
			add_role( self::ROLE_EMPLOYEE, __( 'Employee', 'dolly-employee-management' ), array( 'read' => true ) );
		}
		get_role( self::ROLE_EMPLOYEE )->add_cap( 'dolly_employee' );

		if ( ! get_role( self::ROLE_WORKPLACE ) ) {
			add_role( self::ROLE_WORKPLACE, __( 'Workplace account', 'dolly-employee-management' ), array( 'read' => true ) );
		}
		get_role( self::ROLE_WORKPLACE )->add_cap( 'dolly_workplace' );

		$admin = get_role( 'administrator' );
		if ( $admin ) {
			$admin->add_cap( 'dolly_manage' );
		}
	}

	/**
	 * Directory used for certificates. Outside the web root when possible.
	 * Can be forced with define( 'DOLLY_PRIVATE_DIR', '/percorso/assoluto' ) in wp-config.php.
	 */
	public static function private_dir() {
		if ( defined( 'DOLLY_PRIVATE_DIR' ) && DOLLY_PRIVATE_DIR ) {
			return untrailingslashit( DOLLY_PRIVATE_DIR );
		}
		$stored = get_option( 'dolly_private_dir' );
		if ( $stored && is_dir( $stored ) ) {
			return $stored;
		}
		return self::ensure_private_dir();
	}

	/** True when the certificate directory is outside the publicly served document root. */
	public static function private_dir_is_outside_webroot() {
		$dir  = wp_normalize_path( self::private_dir() );
		$root = wp_normalize_path( untrailingslashit( ABSPATH ) );
		return 0 !== strpos( $dir, $root );
	}

	public static function ensure_private_dir() {
		if ( defined( 'DOLLY_PRIVATE_DIR' ) && DOLLY_PRIVATE_DIR ) {
			wp_mkdir_p( DOLLY_PRIVATE_DIR );
			return untrailingslashit( DOLLY_PRIVATE_DIR );
		}
		$stored = get_option( 'dolly_private_dir' );
		if ( $stored && is_dir( $stored ) ) {
			return $stored;
		}
		// Preferred: one level above the WordPress root (not served by the web server).
		$outside = dirname( untrailingslashit( ABSPATH ) ) . '/dolly-private';
		if ( ( is_dir( $outside ) || @wp_mkdir_p( $outside ) ) && wp_is_writable( $outside ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors
			$dir = $outside;
		} else {
			// Fallback inside uploads with a random name and deny rules. Hosting check must confirm it is not served.
			$uploads = wp_upload_dir( null, false );
			$dir     = trailingslashit( $uploads['basedir'] ) . 'dolly-private-' . wp_generate_password( 16, false, false );
			wp_mkdir_p( $dir );
		}
		self::protect_dir( $dir );
		update_option( 'dolly_private_dir', $dir, false );
		return $dir;
	}

	/** Adds the deny rules (.htaccess, web.config) and an empty index to a private directory. */
	public static function protect_dir( $dir ) {
		$files = array(
			'.htaccess'  => "Require all denied\nDeny from all\n",
			'index.php'  => "<?php\n// Silence is golden.\n",
			'web.config' => '<?xml version="1.0" encoding="UTF-8"?><configuration><system.webServer><authorization><deny users="*" /></authorization></system.webServer></configuration>',
		);
		foreach ( $files as $name => $content ) {
			$path = trailingslashit( $dir ) . $name;
			if ( ! file_exists( $path ) ) {
				@file_put_contents( $path, $content ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- failure handled by the caller; private files of the plugin.
			}
		}
	}

	public static function create_tables() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$c = $wpdb->get_charset_collate();

		$sql = array();

		$sql[] = 'CREATE TABLE ' . self::t( 'workplaces' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
name varchar(190) NOT NULL,
address varchar(255) NOT NULL DEFAULT '',
city varchar(120) NOT NULL DEFAULT '',
province varchar(10) NOT NULL DEFAULT '',
lat decimal(10,7) NULL,
lng decimal(10,7) NULL,
radius_m int(10) unsigned NOT NULL DEFAULT 100,
late_tolerance smallint(5) unsigned NULL,
account_user_id bigint(20) unsigned NULL,
active tinyint(1) NOT NULL DEFAULT 1,
created_at datetime NOT NULL,
updated_at datetime NOT NULL,
PRIMARY KEY  (id),
KEY account_user_id (account_user_id),
KEY active (active)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'assignments' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
workplace_id bigint(20) unsigned NOT NULL,
valid_from date NOT NULL,
valid_to date NULL,
created_by bigint(20) unsigned NOT NULL DEFAULT 0,
created_at datetime NOT NULL,
PRIMARY KEY  (id),
KEY user_valid (user_id,valid_from,valid_to),
KEY workplace_valid (workplace_id,valid_from,valid_to)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'schedules' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
valid_from date NOT NULL,
valid_to date NULL,
weekdays varchar(20) NOT NULL DEFAULT '1,2,3,4,5',
start_time time NOT NULL,
end_time time NOT NULL,
lunch_start time NULL,
lunch_end time NULL,
day_times longtext NULL,
employment_type varchar(20) NOT NULL DEFAULT 'full_time',
work_mode varchar(10) NOT NULL DEFAULT 'office',
created_by bigint(20) unsigned NOT NULL DEFAULT 0,
created_at datetime NOT NULL,
PRIMARY KEY  (id),
KEY user_valid (user_id,valid_from,valid_to)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'punches' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
work_date date NOT NULL,
action varchar(20) NOT NULL,
punched_at datetime NOT NULL,
workplace_id bigint(20) unsigned NULL,
method varchar(20) NOT NULL,
lat decimal(10,7) NULL,
lng decimal(10,7) NULL,
accuracy_m int(10) unsigned NULL,
distance_m int(10) unsigned NULL,
challenge_ref varchar(64) NULL,
exception_id bigint(20) unsigned NULL,
source varchar(20) NOT NULL DEFAULT 'employee',
request_key varchar(64) NULL,
is_active tinyint(1) NULL DEFAULT 1,
created_by bigint(20) unsigned NOT NULL DEFAULT 0,
created_at datetime NOT NULL,
voided_at datetime NULL,
voided_by bigint(20) unsigned NULL,
PRIMARY KEY  (id),
UNIQUE KEY one_action (user_id,work_date,action,is_active),
UNIQUE KEY request_key (request_key),
KEY work_date (work_date),
KEY workplace_date (workplace_id,work_date)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'requests' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
type varchar(20) NOT NULL,
status varchar(20) NOT NULL DEFAULT 'pending',
start_date date NOT NULL,
end_date date NOT NULL,
start_time time NULL,
end_time time NULL,
lunch_start time NULL,
lunch_end time NULL,
extra_kind varchar(20) NULL,
correction_action varchar(20) NULL,
leave_kind varchar(20) NULL,
hours_code varchar(8) NULL,
certificate_status varchar(20) NULL,
certificate_due date NULL,
notes text NULL,
parent_id bigint(20) unsigned NULL,
amend_action varchar(10) NULL,
source varchar(20) NULL,
created_by bigint(20) unsigned NOT NULL DEFAULT 0,
decided_by bigint(20) unsigned NULL,
decided_at datetime NULL,
decision_note text NULL,
created_at datetime NOT NULL,
updated_at datetime NOT NULL,
PRIMARY KEY  (id),
KEY user_status (user_id,status),
KEY dates (start_date,end_date),
KEY status_created (status,created_at),
KEY parent_id (parent_id)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'sickness' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
kind varchar(20) NOT NULL DEFAULT 'malattia',
start_date date NOT NULL,
end_date date NOT NULL,
notes text NULL,
status varchar(20) NOT NULL DEFAULT 'active',
certificate_status varchar(20) NOT NULL DEFAULT 'missing',
certificate_due date NULL,
protocol varchar(40) NULL,
conflict tinyint(1) NOT NULL DEFAULT 0,
conflict_details text NULL,
reviewed_by bigint(20) unsigned NULL,
reviewed_at datetime NULL,
review_note text NULL,
reported_by bigint(20) unsigned NOT NULL DEFAULT 0,
reported_at datetime NOT NULL,
PRIMARY KEY  (id),
KEY user_dates (user_id,start_date,end_date),
KEY certificate_status (certificate_status)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'certificates' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
sickness_id bigint(20) unsigned NOT NULL DEFAULT 0,
request_id bigint(20) unsigned NULL,
user_id bigint(20) unsigned NOT NULL,
file_name varchar(100) NOT NULL,
original_name varchar(255) NOT NULL,
mime varchar(100) NOT NULL,
size_bytes int(10) unsigned NOT NULL DEFAULT 0,
uploaded_by bigint(20) unsigned NOT NULL DEFAULT 0,
uploaded_at datetime NOT NULL,
PRIMARY KEY  (id),
KEY sickness_id (sickness_id),
KEY request_id (request_id),
KEY user_id (user_id)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'documents' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
category varchar(40) NOT NULL,
title varchar(190) NOT NULL,
description text NULL,
file_name varchar(120) NOT NULL,
original_name varchar(255) NOT NULL,
mime varchar(100) NOT NULL,
size_bytes int(10) unsigned NOT NULL DEFAULT 0,
uploaded_by bigint(20) unsigned NOT NULL DEFAULT 0,
uploaded_at datetime NOT NULL,
viewed_at datetime NULL,
PRIMARY KEY  (id),
KEY user_category (user_id,category),
KEY uploaded_at (uploaded_at)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'anomalies' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
work_date date NULL,
type varchar(30) NOT NULL,
status varchar(20) NOT NULL DEFAULT 'open',
overdue tinyint(1) NOT NULL DEFAULT 0,
uniq_key varchar(120) NOT NULL,
related_type varchar(20) NULL,
related_id bigint(20) unsigned NULL,
details text NULL,
employee_note text NULL,
employee_note_at datetime NULL,
resolution varchar(30) NULL,
resolution_note text NULL,
resolved_by bigint(20) unsigned NULL,
resolved_at datetime NULL,
created_at datetime NOT NULL,
updated_at datetime NOT NULL,
PRIMARY KEY  (id),
UNIQUE KEY uniq_key (uniq_key),
KEY status_type (status,type),
KEY user_date (user_id,work_date)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'notifications' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
event varchar(40) NOT NULL,
title varchar(255) NOT NULL,
body text NULL,
link varchar(255) NULL,
read_at datetime NULL,
push_state tinyint(1) NOT NULL DEFAULT 0,
popup tinyint(1) NOT NULL DEFAULT 0,
created_at datetime NOT NULL,
PRIMARY KEY  (id),
KEY user_read (user_id,read_at),
KEY user_created (user_id,created_at),
KEY push_state (push_state)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'closures' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
closure_date date NOT NULL,
workplace_id bigint(20) unsigned NOT NULL,
name varchar(190) NOT NULL DEFAULT '',
type varchar(20) NOT NULL DEFAULT 'collective',
created_by bigint(20) unsigned NOT NULL DEFAULT 0,
created_at datetime NOT NULL,
PRIMARY KEY  (id),
UNIQUE KEY date_workplace (closure_date,workplace_id)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'broadcasts' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
title varchar(190) NOT NULL DEFAULT '',
message text NOT NULL,
recipients longtext NOT NULL,
send_email tinyint(1) NOT NULL DEFAULT 1,
send_portal tinyint(1) NOT NULL DEFAULT 1,
show_popup tinyint(1) NOT NULL DEFAULT 0,
send_at datetime NOT NULL,
status varchar(20) NOT NULL DEFAULT 'scheduled',
sent_at datetime NULL,
recipient_count int(10) unsigned NOT NULL DEFAULT 0,
source varchar(20) NOT NULL DEFAULT 'manual',
created_by bigint(20) unsigned NOT NULL DEFAULT 0,
created_at datetime NOT NULL,
PRIMARY KEY  (id),
KEY status_send (status,send_at)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'push_subs' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
endpoint text NOT NULL,
endpoint_hash char(64) NOT NULL,
p256dh varchar(255) NOT NULL DEFAULT '',
auth varchar(255) NOT NULL DEFAULT '',
user_agent varchar(255) NOT NULL DEFAULT '',
created_at datetime NOT NULL,
last_success_at datetime NULL,
PRIMARY KEY  (id),
UNIQUE KEY endpoint_hash (endpoint_hash),
KEY user_id (user_id)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'email_queue' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL DEFAULT 0,
event varchar(40) NOT NULL,
dedupe_key varchar(160) NULL,
to_email varchar(190) NOT NULL,
subject varchar(255) NOT NULL,
body longtext NOT NULL,
status varchar(20) NOT NULL DEFAULT 'pending',
attempts smallint(5) unsigned NOT NULL DEFAULT 0,
next_attempt_at datetime NOT NULL,
locked_until datetime NULL,
last_error text NULL,
created_at datetime NOT NULL,
sent_at datetime NULL,
PRIMARY KEY  (id),
UNIQUE KEY dedupe_key (dedupe_key),
KEY status_next (status,next_attempt_at)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'exceptions' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
reason text NOT NULL,
expires_at datetime NOT NULL,
use_count int(10) unsigned NOT NULL DEFAULT 0,
created_by bigint(20) unsigned NOT NULL DEFAULT 0,
created_at datetime NOT NULL,
revoked_at datetime NULL,
revoked_by bigint(20) unsigned NULL,
PRIMARY KEY  (id),
KEY user_expires (user_id,expires_at)
) $c;";

		$sql[] = 'CREATE TABLE ' . self::t( 'audit' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
actor_id bigint(20) unsigned NOT NULL DEFAULT 0,
action varchar(60) NOT NULL,
object_type varchar(30) NOT NULL,
object_id bigint(20) unsigned NOT NULL DEFAULT 0,
subject_user_id bigint(20) unsigned NOT NULL DEFAULT 0,
reason text NULL,
before_json longtext NULL,
after_json longtext NULL,
ip varchar(45) NULL,
created_at datetime NOT NULL,
PRIMARY KEY  (id),
KEY object (object_type,object_id),
KEY subject (subject_user_id,created_at),
KEY created_at (created_at)
) $c;";

		// Hours history: one row per employee, day and justification code (see Dolly_Hours::CODES).
		$sql[] = 'CREATE TABLE ' . self::t( 'hours' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
work_date date NOT NULL,
code varchar(8) NOT NULL,
minutes smallint(5) unsigned NOT NULL DEFAULT 0,
planned_minutes smallint(5) unsigned NOT NULL DEFAULT 0,
provisional tinyint(1) NOT NULL DEFAULT 0,
updated_at datetime NOT NULL,
PRIMARY KEY  (id),
UNIQUE KEY user_day_code (user_id,work_date,code),
KEY code_date (code,work_date)
) $c;";

		// Devices an employee signed in with (device sessions).
		$sql[] = 'CREATE TABLE ' . self::t( 'devices' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
token_hash char(64) NOT NULL,
name varchar(120) NOT NULL DEFAULT '',
user_agent varchar(255) NOT NULL DEFAULT '',
created_at datetime NOT NULL,
last_seen_at datetime NOT NULL,
revoked_at datetime NULL,
revoked_by bigint(20) unsigned NULL,
PRIMARY KEY  (id),
UNIQUE KEY token_hash (token_hash),
KEY user_active (user_id,revoked_at)
) $c;";

		// Clock-in / clock-out reminders already sent (one per employee, day, kind and offset).
		$sql[] = 'CREATE TABLE ' . self::t( 'reminders' ) . " (
id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
user_id bigint(20) unsigned NOT NULL,
work_date date NOT NULL,
kind varchar(10) NOT NULL,
offset_min smallint(5) unsigned NOT NULL DEFAULT 0,
sent_at datetime NOT NULL,
PRIMARY KEY  (id),
UNIQUE KEY once (user_id,work_date,kind,offset_min),
KEY work_date (work_date)
) $c;";

		foreach ( $sql as $q ) {
			dbDelta( $q );
		}
	}
}
