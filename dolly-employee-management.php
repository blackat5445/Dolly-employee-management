<?php
/**
 * Plugin Name:       Dolly Employee Management
 * Plugin URI:        https://github.com/blackat5445/Dolly-employee-management
 * Description:       Employee portal with verified clock-in (GPS, QR/PIN, Bluetooth, smart working), requests, sickness certificates, documents, administration and payroll exports.
 * Version:           1.14.1
 * Requires at least: 6.2
 * Requires PHP:      7.4
 * Author:            Kasra Falahati
 * Author URI:        https://kasra.eu
 * Text Domain:       dolly-employee-management
 * Domain Path:       /languages
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 *
 * Copyright (C) 2026 Kasra Falahati
 *
 * This program is free software; you can redistribute it and/or modify it under the terms of the GNU
 * General Public License as published by the Free Software Foundation; either version 2 of the License,
 * or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even
 * the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
 * License for more details.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

define( 'DOLLY_VERSION', '1.14.1' );
define( 'DOLLY_DB_VERSION', '7' );
define( 'DOLLY_FILE', __FILE__ );
define( 'DOLLY_DIR', plugin_dir_path( __FILE__ ) );
define( 'DOLLY_URL', plugin_dir_url( __FILE__ ) );
define( 'DOLLY_REST_NS', 'dolly/v1' );

require_once DOLLY_DIR . 'includes/class-dolly-time.php';
require_once DOLLY_DIR . 'includes/class-dolly-holidays.php';
require_once DOLLY_DIR . 'includes/class-dolly-settings.php';
require_once DOLLY_DIR . 'includes/class-dolly-appearance.php';
require_once DOLLY_DIR . 'includes/class-dolly-i18n.php';
require_once DOLLY_DIR . 'includes/class-dolly-install.php';
require_once DOLLY_DIR . 'includes/class-dolly-audit.php';
require_once DOLLY_DIR . 'includes/class-dolly-workplaces.php';
require_once DOLLY_DIR . 'includes/class-dolly-schedules.php';
require_once DOLLY_DIR . 'includes/class-dolly-employees.php';
require_once DOLLY_DIR . 'includes/class-dolly-verification.php';
require_once DOLLY_DIR . 'includes/class-dolly-bluetooth.php';
require_once DOLLY_DIR . 'includes/class-dolly-attendance.php';
require_once DOLLY_DIR . 'includes/class-dolly-requests.php';
require_once DOLLY_DIR . 'includes/class-dolly-sickness.php';
require_once DOLLY_DIR . 'includes/class-dolly-donations.php';
require_once DOLLY_DIR . 'includes/class-dolly-documents.php';
require_once DOLLY_DIR . 'includes/class-dolly-hours.php';
require_once DOLLY_DIR . 'includes/class-dolly-devices.php';
require_once DOLLY_DIR . 'includes/class-dolly-reminders.php';
require_once DOLLY_DIR . 'includes/class-dolly-anomalies.php';
require_once DOLLY_DIR . 'includes/class-dolly-closures.php';
require_once DOLLY_DIR . 'includes/class-dolly-notifications.php';
require_once DOLLY_DIR . 'includes/class-dolly-push.php';
require_once DOLLY_DIR . 'includes/class-dolly-broadcasts.php';
require_once DOLLY_DIR . 'includes/class-dolly-reports.php';
require_once DOLLY_DIR . 'includes/class-dolly-xlsx.php';
require_once DOLLY_DIR . 'includes/class-dolly-timesheet.php';
require_once DOLLY_DIR . 'includes/class-dolly-analytics.php';
require_once DOLLY_DIR . 'includes/class-dolly-cron.php';
require_once DOLLY_DIR . 'includes/class-dolly-rest.php';
require_once DOLLY_DIR . 'includes/class-dolly-auth.php';
require_once DOLLY_DIR . 'includes/class-dolly-frontend.php';
require_once DOLLY_DIR . 'includes/class-dolly-login-screen.php';
require_once DOLLY_DIR . 'includes/class-dolly-admin.php';
require_once DOLLY_DIR . 'includes/class-dolly-onboarding.php';

register_activation_hook( __FILE__, array( 'Dolly_Install', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'Dolly_Install', 'deactivate' ) );

add_action( 'plugins_loaded', array( 'Dolly_I18n', 'init' ) );
add_action( 'plugins_loaded', array( 'Dolly_Install', 'maybe_upgrade' ) );
add_action( 'plugins_loaded', array( 'Dolly_Cron', 'init' ) );
add_action( 'plugins_loaded', array( 'Dolly_Auth', 'init' ) );
add_action( 'plugins_loaded', array( 'Dolly_Devices', 'init' ) );
add_action( 'plugins_loaded', array( 'Dolly_Frontend', 'init' ) );
add_action( 'plugins_loaded', array( 'Dolly_Login_Screen', 'init' ) );
add_action( 'plugins_loaded', array( 'Dolly_Push', 'init' ) );
add_action( 'plugins_loaded', array( 'Dolly_Admin', 'init' ) );
add_action( 'plugins_loaded', array( 'Dolly_Onboarding', 'init' ) );
add_action( 'rest_api_init', array( 'Dolly_REST', 'register_routes' ) );

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	WP_CLI::add_command( 'dolly tick', array( 'Dolly_Cron', 'cli_tick' ) );
}
