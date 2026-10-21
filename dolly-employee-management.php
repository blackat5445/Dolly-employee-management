<?php
/**
 * Plugin Name:       Dolly Employee Management
 * Plugin URI:        https://github.com/blackat5445/Dolly-employee-management
 * Description:       Gestione dipendenti: account, permessi, presenze, richieste, certificati, notifiche, amministrazione ed esportazioni.
 * Version:           1.8.0
 * Requires at least: 6.2
 * Requires PHP:      7.4
 * Author:            Kasra Falahati
 * Author URI:        https://github.com/blackat5445
 * Text Domain:       dolly-employee-management
 * License:           MIT
 * License URI:       https://opensource.org/licenses/MIT
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

define( 'MEM_VERSION', '1.8.0' );
define( 'MEM_DB_VERSION', '6' );
define( 'MEM_FILE', __FILE__ );
define( 'MEM_DIR', plugin_dir_path( __FILE__ ) );
define( 'MEM_URL', plugin_dir_url( __FILE__ ) );
define( 'MEM_REST_NS', 'dolly/v1' );

require_once MEM_DIR . 'includes/class-mem-time.php';
require_once MEM_DIR . 'includes/class-mem-holidays.php';
require_once MEM_DIR . 'includes/class-mem-settings.php';
require_once MEM_DIR . 'includes/class-mem-install.php';
require_once MEM_DIR . 'includes/class-mem-audit.php';
require_once MEM_DIR . 'includes/class-mem-workplaces.php';
require_once MEM_DIR . 'includes/class-mem-schedules.php';
require_once MEM_DIR . 'includes/class-mem-employees.php';
require_once MEM_DIR . 'includes/class-mem-verification.php';
require_once MEM_DIR . 'includes/class-mem-attendance.php';
require_once MEM_DIR . 'includes/class-mem-requests.php';
require_once MEM_DIR . 'includes/class-mem-sickness.php';
require_once MEM_DIR . 'includes/class-mem-donations.php';
require_once MEM_DIR . 'includes/class-mem-hours.php';
require_once MEM_DIR . 'includes/class-mem-devices.php';
require_once MEM_DIR . 'includes/class-mem-reminders.php';
require_once MEM_DIR . 'includes/class-mem-anomalies.php';
require_once MEM_DIR . 'includes/class-mem-closures.php';
require_once MEM_DIR . 'includes/class-mem-notifications.php';
require_once MEM_DIR . 'includes/class-mem-push.php';
require_once MEM_DIR . 'includes/class-mem-broadcasts.php';
require_once MEM_DIR . 'includes/class-mem-reports.php';
require_once MEM_DIR . 'includes/class-mem-xlsx.php';
require_once MEM_DIR . 'includes/class-mem-timesheet.php';
require_once MEM_DIR . 'includes/class-mem-analytics.php';
require_once MEM_DIR . 'includes/class-mem-cron.php';
require_once MEM_DIR . 'includes/class-mem-rest.php';
require_once MEM_DIR . 'includes/class-mem-auth.php';
require_once MEM_DIR . 'includes/class-mem-frontend.php';
require_once MEM_DIR . 'includes/class-mem-admin.php';

register_activation_hook( __FILE__, array( 'MEM_Install', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'MEM_Install', 'deactivate' ) );

add_action( 'plugins_loaded', array( 'MEM_Install', 'maybe_upgrade' ) );
add_action( 'plugins_loaded', array( 'MEM_Cron', 'init' ) );
add_action( 'plugins_loaded', array( 'MEM_Auth', 'init' ) );
add_action( 'plugins_loaded', array( 'MEM_Devices', 'init' ) );
add_action( 'plugins_loaded', array( 'MEM_Frontend', 'init' ) );
add_action( 'plugins_loaded', array( 'MEM_Push', 'init' ) );
add_action( 'plugins_loaded', array( 'MEM_Admin', 'init' ) );
add_action( 'rest_api_init', array( 'MEM_REST', 'register_routes' ) );

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	WP_CLI::add_command( 'dolly tick', array( 'MEM_Cron', 'cli_tick' ) );
}
