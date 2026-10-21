// Dolly Bluetooth clock-in device (ESP32, Arduino core 2.x or 3.x).
//
// Serves "<workplace id>:<6-digit code>" over Bluetooth Low Energy. Employees' phones read it with
// the Dolly portal (Web Bluetooth) to prove they are at the workplace. The code changes every
// 30 seconds and comes from one of two sources:
//   - standalone: computed here (TOTP of the workplace secret) using the internet time over Wi-Fi;
//   - tablet mode: written into the device by the workplace display (Chrome on an Android tablet).
// A code written by the tablet takes priority while it is valid.
//
// LED: green = code available, amber = waiting for time or tablet, short white flash = code read.

#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include "config.h"
#include "totp.h"

// Same identifiers as Dolly_Bluetooth in the plugin.
#define SERVICE_UUID "8d1f3e5a-6b2c-4c7e-9a41-2f6d0c9b7a10"
#define CODE_UUID    "8d1f3e5a-6b2c-4c7e-9a41-2f6d0c9b7a11"
#define PUSH_UUID    "8d1f3e5a-6b2c-4c7e-9a41-2f6d0c9b7a12"

static uint8_t secretKey[64];
static size_t secretLen = 0;

static char pushedCode[7] = "";
static uint32_t pushedUntil = 0;  // millis() when the code written by the tablet expires.
static uint32_t flashUntil = 0;

static void setLed( uint8_t r, uint8_t g, uint8_t b ) {
#if DOLLY_RGB_LED_PIN >= 0
#if defined( ESP_ARDUINO_VERSION_MAJOR ) && ESP_ARDUINO_VERSION_MAJOR >= 3
	rgbLedWrite( DOLLY_RGB_LED_PIN, r, g, b );
#else
	neopixelWrite( DOLLY_RGB_LED_PIN, r, g, b );
#endif
#endif
}

static bool timeIsSet() {
	return time( nullptr ) > 1700000000;  // After November 2023: the clock was synchronised.
}

static bool pushedIsValid() {
	return pushedCode[0] && (int32_t) ( pushedUntil - millis() ) > 0;
}

/** Current value for the phones, or "" when no valid code is available. */
static String currentValue() {
	char code[7];
	if ( pushedIsValid() ) {
		strcpy( code, pushedCode );
	} else if ( secretLen && timeIsSet() ) {
		dolly::totp( secretKey, secretLen, (uint64_t) time( nullptr ) / 30, code );
	} else {
		return "";
	}
	return String( DOLLY_WORKPLACE_ID ) + ":" + code;
}

class CodeCallbacks : public BLECharacteristicCallbacks {
	void onRead( BLECharacteristic *c ) override {
		String v = currentValue();
		c->setValue( (uint8_t *) v.c_str(), v.length() );
		flashUntil = millis() + 300;
	}
};

// The tablet writes "<workplace id>:<code>:<seconds of validity>".
class PushCallbacks : public BLECharacteristicCallbacks {
	void onWrite( BLECharacteristic *c ) override {
		String v = String( c->getValue().c_str() );
		int a = v.indexOf( ':' ), b = v.indexOf( ':', a + 1 );
		if ( a < 0 || b < 0 || v.substring( 0, a ).toInt() != DOLLY_WORKPLACE_ID ) {
			return;
		}
		String code = v.substring( a + 1, b );
		long ttl = v.substring( b + 1 ).toInt();
		if ( code.length() != 6 || ttl <= 0 || ttl > 60 ) {
			return;
		}
		strcpy( pushedCode, code.c_str() );
		pushedUntil = millis() + ( ttl + 5 ) * 1000UL;
	}
};

class ServerCallbacks : public BLEServerCallbacks {
	void onDisconnect( BLEServer * ) override {
		BLEDevice::startAdvertising();  // Ready for the next phone.
	}
};

void setup() {
	Serial.begin( 115200 );
	setLed( 40, 25, 0 );
	secretLen = dolly::base32_decode( DOLLY_TOTP_SECRET, secretKey, sizeof secretKey );

	if ( strlen( DOLLY_WIFI_SSID ) ) {
		WiFi.mode( WIFI_STA );
		WiFi.begin( DOLLY_WIFI_SSID, DOLLY_WIFI_PASSWORD );
		configTime( 0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com" );
	}

	BLEDevice::init( DOLLY_DEVICE_NAME );
	BLEDevice::setPower( DOLLY_TX_POWER );
	BLEServer *server = BLEDevice::createServer();
	server->setCallbacks( new ServerCallbacks() );
	BLEService *service = server->createService( SERVICE_UUID );
	service->createCharacteristic( CODE_UUID, BLECharacteristic::PROPERTY_READ )->setCallbacks( new CodeCallbacks() );
	service->createCharacteristic( PUSH_UUID, BLECharacteristic::PROPERTY_WRITE )->setCallbacks( new PushCallbacks() );
	service->start();
	BLEAdvertising *adv = BLEDevice::getAdvertising();
	adv->addServiceUUID( SERVICE_UUID );
	adv->setScanResponse( true );
	BLEDevice::startAdvertising();
	Serial.printf( "Dolly Bluetooth device for workplace %d ready.\n", DOLLY_WORKPLACE_ID );
}

void loop() {
	static uint32_t lastLog = 0;
	String value = currentValue();
	if ( (int32_t) ( flashUntil - millis() ) > 0 ) {
		setLed( 60, 60, 60 );
	} else if ( value.length() ) {
		setLed( 0, 40, 0 );
	} else {
		setLed( 40, 25, 0 );
	}
	// Every 10 seconds: current code, to compare with Sedi > Bluetooth in the plugin.
	if ( millis() - lastLog > 10000 ) {
		lastLog = millis();
		Serial.printf( "Code: %s | time %s | tablet %s | Wi-Fi %s\n", value.length() ? value.c_str() : "(none)",
			timeIsSet() ? "synchronised" : "not set", pushedIsValid() ? "yes" : "no",
			strlen( DOLLY_WIFI_SSID ) ? ( WiFi.status() == WL_CONNECTED ? "connected" : "connecting" ) : "off" );
	}
	if ( strlen( DOLLY_WIFI_SSID ) && WiFi.status() != WL_CONNECTED && millis() % 60000 < 20 ) {
		WiFi.reconnect();
	}
	delay( 20 );
}
