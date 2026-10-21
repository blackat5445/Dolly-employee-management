# Dolly Employee Management

A WordPress plugin for running a small or medium workforce: employee accounts, clock-in/clock-out with GPS or rotating QR/PIN codes, leave and overtime requests, sickness certificates, push notifications, anomaly detection and monthly Excel/CSV exports.

Employees use a mobile-first portal that installs as an app (PWA). Each workplace runs a display screen that shows the rotating QR code. Administrators manage everything from a dedicated area in wp-admin.

> **Language and locale:** the interface is in Italian. Dates use the `Europe/Rome` timezone and Italian national holidays are built in.

## Features

### Employee portal (`/portale/`)
- **Clock in/out:** entry, break start, break end and exit. Each punch is verified by GPS geofence, by scanning the workplace QR code, by a 6-digit PIN, or by a combination of these, depending on your settings.
- **Requests:** holidays, hourly leave, overtime, punch corrections, on-call shifts and blood-donation leave. Approved requests can be edited or cancelled, and each change needs approval again.
- **Sickness and injury reports,** with a private medical-certificate upload (PDF/JPG/PNG).
- **Calendar and history:** a calendar, the monthly attendance history and in-app notifications.
- **Profile,** including bank details (the IBAN is validated).
- **Installable app (PWA)** with Web Push notifications and optional reminders to clock in and out.
- **Device sessions:** employees can sign in only from registered devices.
- **Guided tour** on first use.

### Workplace display (`/sede/`)
- A full-screen page showing a QR code and a PIN that change every 15 seconds, with a countdown and the connection status.
- It uses a dedicated workplace account that stays signed in for 30 days.

### Administration (wp-admin › *Gestione Dipendenti*)
- **Dashboard:** today's attendance, latest requests, open anomalies, a calendar and an attendance chart.
- **Employees:** create, edit and deactivate employees, reset passwords and set device limits.
- **Schedules:** full-time, part-time and on-call contracts, with history. A schedule can be one fixed timetable or different times for each weekday.
- **Workplaces:** address, coordinates and GPS radius, plus a per-site late tolerance and employee assignments.
- **Requests:** approve and revoke requests. On-call shifts can be approved automatically below a threshold.
- **Attendance:** daily and monthly views, with audited corrections.
- **Analytics:** hours, overtime, presence, absences, lateness and anomalies.
- **Anomalies:** unjustified absences, missing exits, missing certificates and sickness conflicts, each with a resolution workflow.
- **Closures:** collective or holiday closures for chosen workplaces.
- **Broadcasts:** messages sent by email and/or push, either now or at a scheduled time.
- **Exports:** a monthly Excel attendance sheet, an employees CSV, a monthly attendance ZIP and an hours summary CSV.
- **Settings:** clock-in rules, notifications, certificates, reminders, logo, a system-status panel and an audit log.

## Requirements

- **WordPress 6.2+** with pretty permalinks enabled.
- **PHP 7.4+** with `mbstring`. Two more extensions are recommended:
  - `openssl` for push notifications.
  - `zip` for exports. Without it the plugin falls back to PclZip.
- **MySQL or MariaDB.**
- **HTTPS.** Browsers allow GPS and camera access (for QR scanning) only on secure origins.
- **A system cron** that calls the plugin's scheduler every minute (see below).

## Installation

1. Download or clone this repository into `wp-content/plugins/dolly-employee-management`.
2. Activate **Dolly Employee Management** under *Plugins*.
3. Go to *Gestione Dipendenti › Impostazioni* and review the settings, including the logo.
4. Create your workplaces (*Sedi*), then your employees (*Dipendenti*).
5. Set up the scheduler as described below.

## Scheduler

Anomaly checks, reminders, scheduled broadcasts and email/push retries run on a one-minute tick. On a production site, disable WP-Cron's visitor-triggered mode and call the tick from the server's cron instead:

```php
// wp-config.php
define( 'DISABLE_WP_CRON', true );
```

```cron
# With WP-CLI
* * * * * wp --path=/path/to/wordpress dolly tick

# Or over HTTP. The key is shown in Impostazioni › Stato del sistema.
* * * * * curl -s "https://example.com/wp-json/dolly/v1/cron?key=YOUR_KEY" >/dev/null
```

*Impostazioni › Stato del sistema* shows the exact commands for your site and whether the scheduler is running.

## Configuration

### Certificate storage
Medical and donation certificates are stored outside the public web root when possible: by default in a `dolly-private` folder next to the WordPress directory. If that folder can't be created, the plugin falls back to a protected folder inside `uploads`. To choose the location yourself, add this to `wp-config.php`:

```php
define( 'DOLLY_PRIVATE_DIR', '/absolute/path/outside/webroot' );
```

### Front-end URLs

| URL | Purpose |
|---|---|
| `/accesso/` | Employee login |
| `/accesso-sede/` | Workplace display login |
| `/recupero-password/` | Password recovery |
| `/portale/` | Employee portal |
| `/sede/` | Workplace QR/PIN display |
| `/esci/` | Logout |

### Roles

| Role | Created for | Capability |
|---|---|---|
| `dipendenti` | Employees | `mem_employee` |
| `dolly_sede` | Workplace display accounts, one per workplace (created automatically) | `mem_workplace` |
| `administrator` | Plugin administrators | `mem_manage` (added on activation) |

## Theme integration

The plugin works with any theme through its built-in fallback layout. To use your theme's own layout for the portal pages, add a template named `dolly/{view}.php` to the theme, where `{view}` is one of `login`, `login-sede`, `recupero-password`, `portale` or `sede`. Use `templates/fallback.php` as the starting point. A template must:

- call `wp_head()` and `wp_footer()`;
- call `MEM_Frontend::render_view()`.

Other filters you can use:

- `mem_redirect_front_page`: return `false` to stop the plugin redirecting the site's front page to the portal or login page.

## REST API

The admin screens and the portal run on an authenticated REST API under `/wp-json/dolly/v1/`. It uses cookie authentication with the WordPress REST nonce.

## Data

The plugin creates its tables with the `{prefix}mem_` prefix. Data is never deleted on deactivation or upgrade, so historical records are always kept.

## Third-party libraries

These are bundled in `assets/vendor/`, so nothing is loaded from a CDN at runtime:

| Library | Version | License |
|---|---|---|
| [Lucide](https://lucide.dev) | 0.469.0 | ISC |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 1.4.4 | MIT |
| [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 | Apache-2.0 |
| [Chart.js](https://www.chartjs.org) | 4.4.4 | MIT |
| [FullCalendar](https://fullcalendar.io) | 6.1.15 | MIT |

## License

[MIT](LICENSE) © Kasra Falahati
