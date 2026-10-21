# Dolly Employee Management

A WordPress plugin for running a small or medium workforce: employee accounts, clock-in/clock-out with GPS or rotating QR/PIN codes, leave and overtime requests, sickness certificates, push notifications, anomaly detection and monthly Excel/CSV exports.

Employees use a mobile-first portal that installs as an app (PWA). Each workplace runs a display screen that shows the rotating QR code. Administrators manage everything from a dedicated area in wp-admin.

> **Languages:** Italian and English, chosen per user. Dates use the `Europe/Rome` timezone and Italian national holidays are built in.

## Features

### Employee portal (`/portale/`)
- **Clock in/out:** entry, break start, break end and exit. Each punch is verified in one of the ways you allow: GPS geofence, the workplace QR code or 6-digit PIN, or a [Bluetooth device](firmware/README.md) at the workplace. You can also require GPS on top of a workplace code. In smart working (remote work) the employee clocks in and out with one tap, without any presence verification.
- **Requests:** holidays, hourly leave, overtime, punch corrections, on-call shifts and blood-donation leave. Approved requests can be edited or cancelled, and each change needs approval again.
- **Sickness and injury reports,** with a private medical-certificate upload (PDF/JPG/PNG) and/or the protocol number of the electronic certificate, typed by the employee.
- **Documents:** contracts, CU, payslips and other documents sent by the company, by category, with a counter of new ones.
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
- **Schedules:** full-time, part-time and on-call contracts, with history. A schedule can be one fixed timetable (regular shifts) or different times for each weekday (different shifts).
- **Smart working:** with regular shifts one switch puts the whole schedule in smart working; with different shifts each day is on site, smart working, or mixed (an on-site slot and a smart-working slot that must not overlap). Smart-working punches need no GPS, QR/PIN or Bluetooth; on mixed days the punches of the on-site slot are still verified. The smart-working hours of a day are approved automatically or by the administrator in *Richieste* (setting *Smart working*); until approved they are not counted.
- **Documents:** send each employee documents by category (Contratto, CU, Busta paga, Altro, plus your own categories) with a title and an optional description. A list of employees with search and pagination, a modal to send a document and one to browse, open or delete the documents of an employee. The employee is notified (event *Nuovo documento*, in-app and/or email).
- **Workplaces:** address and an interactive map (OpenStreetMap) to place the workplace: it shows your current position, you tap the map, drag the pin or search for an address, and a circle shows the GPS radius. Plus a per-site late tolerance and employee assignments.
- **Requests:** approve and revoke requests. On-call shifts can be approved automatically below a threshold; smart-working days automatically or one by one.
- **Attendance:** daily and monthly views, with audited corrections.
- **Analytics:** hours, overtime, presence, absences, lateness and anomalies.
- **Anomalies:** unjustified absences, missing exits, missing certificates and sickness conflicts, each with a resolution workflow.
- **Closures:** collective or holiday closures for chosen workplaces.
- **Broadcasts:** messages sent by email and/or push, either now or at a scheduled time.
- **Exports:** a monthly Excel attendance sheet, an employees CSV, a monthly attendance ZIP and an hours summary CSV.
- **Appearance (white label):** brand name, logos, app icon, colours, dark mode, fonts, shapes, login page, email sender and custom CSS, with a live preview.
- **Settings:** clock-in rules, notifications, certificates, reminders, a system-status panel and an audit log.
- **Guided setup:** opens right after activation. It walks through the settings category by category, explaining for each option what it is for and what happens when it is turned on, off or changed, then creates the first workplace and the first employee. Progress is saved, so it resumes where it stopped, and it can be restarted from *Impostazioni › Configurazione guidata*.
- **Interactive tutorial:** a spotlight tour of every section of the panel (dashboard, workplaces, employees, requests, attendance, analytics, anomalies, broadcasts, exports, appearance and settings). It starts at the end of the guided setup. Administrators added later, once the setup is done, are only offered the tutorial. It can be watched again from *Impostazioni*.

## Requirements

- **WordPress 6.2+** with pretty permalinks enabled.
- **PHP 7.4+** with `mbstring`. Two more extensions are recommended:
  - `openssl` for push notifications.
  - `zip` for exports. Without it the plugin falls back to PclZip.
- **MySQL or MariaDB.**
- **HTTPS.** Browsers allow GPS, camera (QR scanning) and Bluetooth access only on secure origins.
- **Optional, for Bluetooth clock-in:** an ESP32 board at each workplace, such as the M5Stack AtomS3 Lite. See [firmware/README.md](firmware/README.md).
- **A system cron** that calls the plugin's scheduler every minute (see below).

## Installation

1. Download or clone this repository into `wp-content/plugins/dolly-employee-management`.
2. Activate **Dolly Employee Management** under *Plugins*.
3. The guided setup opens: follow it to configure the settings, create the first workplace and the first employee, then take the tutorial.
4. Go to *Gestione Dipendenti › Aspetto* to complete your brand (logo, icon, fonts).
5. Set up the scheduler as described below.
6. Optional: install the latest version of the companion theme **Dolly Portal** for a dedicated portal site. Until it is installed, the plugin shows a reminder in wp-admin (dismissible per administrator).

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

## Bluetooth clock-in

Bluetooth is a third way to verify presence, next to GPS and QR/PIN. An ESP32 board near the entrance serves a 6-digit code that changes every 30 seconds (TOTP). The employee's phone reads it over Bluetooth from a few metres away.

1. In *Sedi*, click **Bluetooth** on a workplace, activate it and download `config.h`.
2. Flash the firmware in [`firmware/dolly-ble-beacon`](firmware/dolly-ble-beacon) to the board.
3. In *Impostazioni › Verifica timbrature*, enable **Bluetooth**.

The board either gets the time over Wi-Fi and computes the code itself, or runs without Wi-Fi: the workplace display on an Android tablet relays the code to it over Bluetooth (**Collega il Bluetooth** button).

Phones need Chrome, Edge or Samsung Internet on Android. Safari on iPhone does not support Web Bluetooth, so iPhone users need the Bluefy browser, or another method must stay enabled. The full guide, recommended boards and security notes are in [firmware/README.md](firmware/README.md).

## Configuration

### Certificate and document storage
Medical and donation certificates and employee documents are stored outside the public web root when possible: by default in a `dolly-private` folder next to the WordPress directory. If that folder can't be created, the plugin falls back to a protected folder inside `uploads`. To choose the location yourself, add this to `wp-config.php`:

```php
define( 'DOLLY_PRIVATE_DIR', '/absolute/path/outside/webroot' );
```

Employee documents are isolated per employee in `documents/u{ID}-{random token}`: the token is random and stored only in the employee's user meta, every folder has deny rules (`.htaccess`, `web.config`) and an empty index, and the files have random names. They are served only through the REST API, to the employee they belong to (while the account is active) and to administrators; administrator openings are written to the audit log.

Medical certificates: in *Impostazioni › Malattia, infortunio e certificati* choose whether the file and/or the protocol number are required. With both off, either one is enough.

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
| `dipendenti` | Employees | `dolly_employee` |
| `dolly_sede` | Workplace display accounts, one per workplace (created automatically) | `dolly_workplace` |
| `administrator` | Plugin administrators | `dolly_manage` (added on activation) |

## Appearance and white labelling

*Gestione Dipendenti › Aspetto* rebrands the whole plugin without touching code. A live preview, in light and dark, shows changes before you save.

| Section | Options |
|---|---|
| Brand | Brand name, app name, portal and display subtitles, admin panel title |
| Logo and icon | Logo, a separate logo for the coloured header, logo height, home-screen/notification icon |
| Colours | Primary, accent, header, background, surfaces, text, borders, success/warning/error/info, eight ready-made palettes, WCAG contrast check |
| Dark mode | Light, dark or automatic (follows the device), with its own background, surface, text and border colours |
| Fonts | System font stacks or a custom font (with an optional stylesheet URL), text size, heading weight |
| Shapes | Corner radius, button shape, shadows, spacing density |
| Login page | Title, intro text, background image |
| Email | Sender name and address, subject prefix, signature |
| Custom CSS | Extra CSS for the portal, login pages and workplace display |

The default theme uses `#2563EB` as its primary colour. All the other shades (hover states, tinted backgrounds, text on coloured buttons, dark-mode variants) are derived automatically from the colours you choose.

Every visual value is a CSS custom property (`--dolly-primary`, `--dolly-surface`, `--dolly-radius`…) defined in `assets/css/dolly-ui.css` and overridden by the Appearance settings, so you can also use them in custom CSS or a theme. Dark mode applies to the employee-facing pages; the admin screens always stay light.

## Languages

The plugin ships in **Italian** (the source language) and **English**.

- **Default language:** set in *Impostazioni › Lingua*. It applies to the portal, the login pages, emails and the admin screens. **Come il sito** follows the WordPress site language: Italian for Italian sites, English otherwise.
- **Per user:** administrators pick their own language in the same card. Employees choose theirs in *Profilo › Lingua* in the portal. Visitors can switch language with the links under the login form, and the choice is kept when they sign in.
- **Notifications and emails** are written in each recipient's language, including those sent by the scheduler.

Translations are standard gettext files in [`languages/`](languages): a `.po` source for translators, a `.mo` for PHP and a `.js` dictionary for the browser screens. To add a language, copy `dolly-employee-management.pot` to `dolly-employee-management-<locale>.po`, translate it (for example with Poedit), then run:

```bash
python3 tools/i18n/i18n.py update    # after code changes: refresh the .pot and merge new strings into every .po
python3 tools/i18n/i18n.py check     # untranslated strings and placeholder mistakes
python3 tools/i18n/i18n.py compile   # build the .mo and .js files
```

A translation placed in `wp-content/languages/plugins/` takes priority over the bundled one.

## Theme integration

The plugin works with any theme through its built-in fallback layout. The companion theme [Dolly Portal](https://github.com/blackat5445/Dolly-employee-management-portal) is a ready-made base for a dedicated portal site: it only adds the page layout, and everything else stays in the plugin.

Whatever the theme, the plugin also brands the WordPress sign-in and password-reset screens (`wp-login.php`) with the Appearance settings, and sends employees back to the portal sign-in after resetting their password. To use your theme's own layout for the portal pages, add a template named `dolly/{view}.php` to the theme, where `{view}` is one of `login`, `login-sede`, `recupero-password`, `portale` or `sede`. Use `templates/fallback.php` as the starting point. A template must:

- call `wp_head()` and `wp_footer()`;
- call `Dolly_Frontend::render_view()`.

Helpers for theme templates: `Dolly_Frontend::skip_link()`, `Dolly_Frontend::theme_color()` (for `<meta name="theme-color">`), `Dolly_Frontend::brand()`, and, for theme pages that are not plugin views, `Dolly_Frontend::enqueue_styles()` and `Dolly_Frontend::render_welcome()`. The plugin adds the `dolly-body dolly-view-{view}` body classes and `noindex` to its views by itself.

Other filters you can use:

- `dolly_redirect_front_page`: return `false` to stop the plugin redirecting the site's front page to the portal or login page.
- `dolly_map`: map tiles and address search used to place the workplaces. Return an array with `tiles` (URL template), `attribution` (HTML) and `geocoder` (a Nominatim-compatible search URL).

## Map and privacy

The workplace map is shown only in wp-admin. The administrator's browser loads map tiles from OpenStreetMap (`tile.openstreetmap.org`) and, when the address search is used, queries Nominatim (`nominatim.openstreetmap.org`). The administrator's position is only used in the browser to centre the map; it is never sent to the server unless it is saved as the workplace position. Employees' devices never contact these services. Use the `dolly_map` filter to switch to another tile or search provider, for example one covered by your data processing agreements.

## REST API

The admin screens and the portal run on an authenticated REST API under `/wp-json/dolly/v1/`. It uses cookie authentication with the WordPress REST nonce.

## Data

The plugin creates its tables with the `{prefix}dolly_` prefix. Data is never deleted on deactivation or upgrade, so historical records are always kept.

## Third-party libraries

These are bundled in `assets/vendor/`, so nothing is loaded from a CDN at runtime:

| Library | Version | License |
|---|---|---|
| [Lucide](https://lucide.dev) | 0.469.0 | ISC |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 1.4.4 | MIT |
| [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 | Apache-2.0 |
| [Chart.js](https://www.chartjs.org) | 4.4.4 | MIT |
| [FullCalendar](https://fullcalendar.io) | 6.1.15 | MIT |
| [Leaflet](https://leafletjs.com) | 1.9.4 | BSD-2-Clause |

## License

[MIT](LICENSE) © Kasra Falahati
