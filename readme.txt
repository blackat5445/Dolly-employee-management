=== Dolly Employee Management ===
Contributors: blackat5445
Tags: employee, attendance, time tracking, timesheet, hr
Requires at least: 6.2
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.14.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Employee portal with verified clock-in (GPS, QR/PIN, Bluetooth, smart working), requests, sickness certificates, documents and payroll exports.

== Description ==

Dolly Employee Management turns WordPress into a complete attendance and HR portal for small and medium companies. Employees use an installable mobile web app; administrators manage everything from the WordPress dashboard.

The interface is available in Italian and English, and every user can choose their own language.

= Employee portal =

* **Clock in and out** (entry, break, exit) with presence verification: GPS geofence, the rotating QR code or PIN shown by the workplace tablet, or a Bluetooth device at the workplace. GPS can also be required on top of a workplace code.
* **Remote work**: on remote days, or in the remote part of a mixed day, the employee clocks in with one tap, without presence verification.
* **Requests**: holidays, hourly leave, overtime, punch corrections and blood-donation leave, with approval.
* **Sickness and injury** reports, with the medical certificate (file and/or protocol number of the electronic certificate).
* **Documents**: contracts, tax certificates (CU), payslips and other documents sent by the company.
* Calendar, monthly attendance, notifications (in-app, push and email), profile and bank details.
* Installable app (PWA) with push notifications, reminders to clock in and out, device sessions and a guided tour.

= Administration =

* Guided setup after activation and an interactive tutorial of every section.
* Dashboard, employees, schedules (regular or different shifts per day, on site / smart working / mixed), workplaces with an interactive map, requests, attendance with audited corrections, analytics, anomalies, closures, broadcasts.
* Documents: send documents to each employee by category; files are stored in a private folder, separate for each employee.
* Exports: monthly Excel attendance sheet, CSV and ZIP files for payroll.
* White label: brand, logos, app icon, colors, dark mode, fonts, sign-in page and email sender.
* Audit log of every change.

= Companion theme =

The plugin works with any theme. The free **Dolly Portal** theme is a ready-made base for a site dedicated to the employee portal.

== Installation ==

1. Install and activate the plugin from **Plugins › Add New**, or upload the `dolly-employee-management` folder to `/wp-content/plugins/`.
2. The guided setup opens: follow it to configure the settings, create the first workplace and the first employee, then take the tutorial.
3. Set up a system cron that calls the scheduler every minute (the command is shown in **Employee Management › Settings › System status**).
4. Employees sign in at `/accesso/`; the workplace tablet signs in at `/accesso-sede/`.

Requirements: pretty permalinks and HTTPS (browsers allow GPS, camera and Bluetooth only on secure sites).

== Frequently Asked Questions ==

= Does it need a special theme? =

No. The portal pages work with any theme. The optional Dolly Portal theme gives a dedicated portal site.

= Where are certificates and documents stored? =

In a private folder outside the public web root when possible (by default `dolly-private` next to the WordPress folder; it can be set with the `DOLLY_PRIVATE_DIR` constant in `wp-config.php`). Employee documents are in a separate folder for each employee with a random name. Files are served only through the plugin, to the employee they belong to and to administrators.

= Which devices does the Bluetooth clock-in need? =

A small ESP32 board at each workplace (for example M5Stack AtomS3 Lite or Seeed XIAO ESP32-C3) running the firmware in the `firmware` folder. Web Bluetooth works in Chrome, Edge and Samsung Internet on Android; on iPhone the free Bluefy browser is needed.

= Is data deleted when the plugin is deactivated? =

No. Attendance history is never deleted on deactivation or update.

= Is support provided? =

Support is provided on the plugin's support forum on WordPress.org and on GitHub.

== External services ==

The plugin works on your own server and does not send data to its authors. It uses these external services, only when the related feature is used:

= OpenStreetMap map tiles =

Used to show the map where the administrator places a workplace (Employee Management › Workplaces). When the map is opened, the administrator's browser downloads map images from `tile.openstreetmap.org`; the request includes the visible map area and the browser's IP address. No data of the employees is sent. Terms: https://operations.osmfoundation.org/policies/tiles/ — Privacy policy: https://osmfoundation.org/wiki/Privacy_Policy

= Nominatim address search (OpenStreetMap) =

Used only when the administrator types an address in the workplace map search. The browser sends the typed address to `nominatim.openstreetmap.org` to find its position. Terms: https://operations.osmfoundation.org/policies/nominatim/ — Privacy policy: https://osmfoundation.org/wiki/Privacy_Policy

The map and search providers can be changed with the `dolly_map` filter.

= Browser push services =

Used only for employees who turn on push notifications in their profile. The site sends encrypted notifications to the push service of the employee's browser (for example Google Firebase Cloud Messaging for Chrome, Mozilla Push Service for Firefox, Apple Push Notification service for Safari). The content is encrypted end to end (RFC 8291) when the server supports it; otherwise an empty message is sent and the phone downloads the content from your site. Terms and privacy: https://firebase.google.com/terms — https://policies.google.com/privacy — https://www.mozilla.org/privacy/websites/ — https://www.apple.com/legal/privacy/

= Custom web font (optional) =

Only if the administrator enters a font URL in Employee Management › Appearance, the portal loads that stylesheet from the given address(for example Google Fonts). By default system fonts are used and nothing is loaded. Google Fonts privacy: https://policies.google.com/privacy

== Privacy ==

The plugin stores attendance punches (with the position used for GPS verification, only at the moment of clocking in), requests, sickness reports, certificates, documents, notifications, device sessions and an audit log in your WordPress database and private folder. Positions are read only when the employee clocks in with GPS. Administrators should inform employees in their privacy notice.

== Bundled libraries ==

* Lucide 0.469.0 — ISC
* qrcode-generator 1.4.4 — MIT
* jsQR 1.4.0 — Apache-2.0
* Chart.js 4.4.4 — MIT
* FullCalendar 6.1.15 — MIT
* Leaflet 1.9.4 — BSD-2-Clause

The libraries are bundled in `assets/vendor/` with their licenses; nothing is loaded from a CDN. All are compatible with the plugin's license (GPLv2 or later; jsQR's Apache-2.0 is compatible with GPLv3, which the "or later" clause allows).

== Copyright ==

Dolly Employee Management, Copyright (C) 2026 Kasra Falahati (https://kasra.eu).
Distributed under the terms of the GNU General Public License, version 2 or (at your option) any later version.

== Screenshots ==

1. Guided setup: each setting explains what happens when it is turned on, off or changed.
2. Employee portal: one-tap clock-in.
3. Workplace with the interactive map.
4. Employee documents.

== Changelog ==

= 1.14.0 =
* Source language is now English, with the Italian translation included; gendered Italian forms use translation contexts.
* License changed to GPLv2 or later.
* Fix: the short month "Mar" (March) was shown as "Tue" in English analytics.
* Fix: the employee tutorial found the profile cards only in Italian.

= 1.13.1 =
* WordPress.org directory compliance: readme, coding standards, documented external services.
* With the Dolly Portal theme the plugin (not the theme) keeps the site out of search engines; filter `dolly_noindex_site`.
* Service worker moved to a static file.

= 1.13.0 =
* Smart working: regular or different shifts per day, on site / smart working / mixed days, one-tap clock-in, automatic or manual approval.
* Protocol number of the medical certificate; settings for what is required.
* Documents: send contracts, CU, payslips and other documents to each employee.

= 1.12.0 =
* Guided setup, interactive admin tutorial and workplace map.

= 1.11.0 =
* Theme integration, English translation, Bluetooth clock-in.

== Upgrade Notice ==

= 1.14.0 =
English is now the source language (Italian included). No changes to your data.

= 1.13.1 =
Maintenance release for the WordPress.org directory. No changes to your data.
