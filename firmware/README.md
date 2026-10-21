# Bluetooth clock-in device

Employees can verify their presence with Bluetooth, as an alternative or in addition to GPS and the QR/PIN screen. A small Bluetooth Low Energy board near the entrance serves a 6-digit code that changes every 30 seconds. The employee's phone reads it from a few metres away and sends it to the server, which proves the phone is at the workplace.

## Recommended hardware

Any ESP32 board with Bluetooth LE works. Two good choices:

| Board | Approx. price | Why |
|---|---|---|
| **[M5Stack AtomS3 Lite](https://docs.m5stack.com/en/core/AtomS3%20Lite)** (recommended) | €9–12 | Comes in a plastic case, USB-C power, RGB status LED, Wi-Fi + Bluetooth LE (ESP32-S3). |
| **[Seeed Studio XIAO ESP32-C3](https://wiki.seeedstudio.com/XIAO_ESP32C3_Getting_Started/)** | €5–7 | Smallest and cheapest (ESP32-C3, Bluetooth 5). No case and no RGB LED: set `DOLLY_RGB_LED_PIN` to `-1`. |

Power the board with any USB-C phone charger and mount it near the entrance, out of reach.

## How the code is produced

The code is a standard TOTP (RFC 6238: HMAC-SHA1, 6 digits, 30-second step) of a secret that the plugin creates for each workplace. Two ways to run the device:

- **Standalone (Wi-Fi):** the board connects to the Wi-Fi only to get the internet time, then computes the code itself. Nothing else is sent over the network.
- **Tablet mode (no Wi-Fi):** the workplace display (*/sede/*) running in Chrome on an **Android tablet** connects to the board over Bluetooth and writes the current code into it. Tap **Collega il Bluetooth** on the display once; it reconnects by itself if the link drops. After a page reload, Chrome may ask you to tap the button again.

You can use both at once: a code written by the tablet takes priority while it is valid.

## Installation

1. In WordPress, go to **Gestione Dipendenti › Sedi**, click **Bluetooth** on the workplace and activate it.
2. Click **Scarica config.h**. For standalone mode, fill in `DOLLY_WIFI_SSID` and `DOLLY_WIFI_PASSWORD`.
3. Install [Arduino IDE](https://www.arduino.cc/en/software) and the **esp32 by Espressif Systems** boards package (*Tools › Board › Boards Manager*).
4. Open `dolly-ble-beacon/dolly-ble-beacon.ino` and replace `config.h` with the downloaded file.
5. Choose the board (*M5Stack AtomS3* or *XIAO_ESP32C3*) and its port, then click **Upload**.
6. Open the Serial Monitor (115200 baud): the device prints its current code every 10 seconds. It must match the **Codice attuale** shown in *Sedi › Bluetooth*.
7. In **Impostazioni › Verifica timbrature**, enable **Bluetooth** among the verification methods.

No libraries need installing: the firmware uses the Bluetooth stack included in the ESP32 core, and `totp.h` contains its own SHA-1.

LED (AtomS3 Lite / Atom Lite): **green** = code available, **amber** = waiting for the internet time or the tablet, **white flash** = a phone read the code.

## Phones and browsers

Reading Bluetooth from a website uses the Web Bluetooth API:

- **Android:** Chrome, Edge and Samsung Internet. Bluetooth and location must be on.
- **iPhone / iPad:** Safari does not support Web Bluetooth. Employees can open the portal in the free **Bluefy – Web BLE Browser** app from the App Store, or keep another method (QR/PIN or GPS) enabled.

When an employee chooses Bluetooth, the browser shows its own list of nearby devices. They pick the workplace device once per clock-in.

## Security notes

- The secret in `config.h` is enough to generate valid codes: keep the file private. If the device is lost or the file is shared, use **Genera una nuova chiave** in *Sedi › Bluetooth* and upload the new configuration.
- Like the PIN, a code read by one employee could be passed on to someone else within its 30-second validity. Combine Bluetooth with **Richiedi sempre anche la posizione GPS** if you need a stronger check.
- Lower `DOLLY_TX_POWER` to reduce the range of the device (for example `ESP_PWR_LVL_N12`).
- Invalid codes count towards the same lockout as wrong PINs (*Impostazioni › Verifica timbrature*).
