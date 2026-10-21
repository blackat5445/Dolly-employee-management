// TOTP (RFC 6238: HMAC-SHA1, 6 digits, 30-second step) with a small built-in SHA-1,
// so the firmware needs no extra library. Same algorithm as Dolly_Bluetooth::totp() in the plugin.
#pragma once

#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace dolly {

struct Sha1 {
	uint32_t h[5];
	uint8_t block[64];
	size_t used;
	uint64_t length;

	static uint32_t rol( uint32_t v, int n ) { return ( v << n ) | ( v >> ( 32 - n ) ); }

	void begin() {
		h[0] = 0x67452301; h[1] = 0xEFCDAB89; h[2] = 0x98BADCFE; h[3] = 0x10325476; h[4] = 0xC3D2E1F0;
		used = 0; length = 0;
	}

	void process() {
		uint32_t w[80];
		for ( int i = 0; i < 16; i++ ) {
			w[i] = ( (uint32_t) block[i * 4] << 24 ) | ( (uint32_t) block[i * 4 + 1] << 16 ) | ( (uint32_t) block[i * 4 + 2] << 8 ) | block[i * 4 + 3];
		}
		for ( int i = 16; i < 80; i++ ) {
			w[i] = rol( w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1 );
		}
		uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
		for ( int i = 0; i < 80; i++ ) {
			uint32_t f, k;
			if ( i < 20 ) { f = ( b & c ) | ( ~b & d ); k = 0x5A827999; }
			else if ( i < 40 ) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
			else if ( i < 60 ) { f = ( b & c ) | ( b & d ) | ( c & d ); k = 0x8F1BBCDC; }
			else { f = b ^ c ^ d; k = 0xCA62C1D6; }
			uint32_t t = rol( a, 5 ) + f + e + k + w[i];
			e = d; d = c; c = rol( b, 30 ); b = a; a = t;
		}
		h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
		used = 0;
	}

	void update( const uint8_t *data, size_t len ) {
		for ( size_t i = 0; i < len; i++ ) {
			block[used++] = data[i];
			length += 8;
			if ( 64 == used ) { process(); }
		}
	}

	void finish( uint8_t out[20] ) {
		uint64_t bits = length;
		uint8_t pad = 0x80;
		update( &pad, 1 );
		pad = 0;
		while ( used != 56 ) { update( &pad, 1 ); }
		for ( int i = 7; i >= 0; i-- ) { block[used++] = (uint8_t) ( bits >> ( i * 8 ) ); }
		process();
		for ( int i = 0; i < 5; i++ ) {
			out[i * 4] = h[i] >> 24; out[i * 4 + 1] = h[i] >> 16; out[i * 4 + 2] = h[i] >> 8; out[i * 4 + 3] = h[i];
		}
	}
};

inline void hmac_sha1( const uint8_t *key, size_t key_len, const uint8_t *msg, size_t msg_len, uint8_t out[20] ) {
	uint8_t k[64] = { 0 };
	if ( key_len > 64 ) {
		Sha1 s; s.begin(); s.update( key, key_len ); s.finish( k );
	} else {
		memcpy( k, key, key_len );
	}
	uint8_t pad[64], inner[20];
	Sha1 s;
	for ( int i = 0; i < 64; i++ ) { pad[i] = k[i] ^ 0x36; }
	s.begin(); s.update( pad, 64 ); s.update( msg, msg_len ); s.finish( inner );
	for ( int i = 0; i < 64; i++ ) { pad[i] = k[i] ^ 0x5C; }
	s.begin(); s.update( pad, 64 ); s.update( inner, 20 ); s.finish( out );
}

/** Decodes Base32 (RFC 4648, no padding needed). Returns the number of bytes written. */
inline size_t base32_decode( const char *in, uint8_t *out, size_t max ) {
	uint32_t buffer = 0;
	int bits = 0;
	size_t n = 0;
	for ( ; *in; in++ ) {
		char c = *in;
		int v;
		if ( c >= 'A' && c <= 'Z' ) { v = c - 'A'; }
		else if ( c >= 'a' && c <= 'z' ) { v = c - 'a'; }
		else if ( c >= '2' && c <= '7' ) { v = c - '2' + 26; }
		else { continue; }
		buffer = ( buffer << 5 ) | v;
		bits += 5;
		if ( bits >= 8 ) {
			bits -= 8;
			if ( n < max ) { out[n++] = (uint8_t) ( buffer >> bits ); }
		}
	}
	return n;
}

/** 6-digit code of the given 30-second step, written as a 7-byte C string. */
inline void totp( const uint8_t *key, size_t key_len, uint64_t step, char out[7] ) {
	uint8_t msg[8], hash[20];
	for ( int i = 7; i >= 0; i-- ) { msg[i] = (uint8_t) step; step >>= 8; }
	hmac_sha1( key, key_len, msg, 8, hash );
	int offset = hash[19] & 0x0F;
	uint32_t value = ( (uint32_t) ( hash[offset] & 0x7F ) << 24 ) | ( (uint32_t) hash[offset + 1] << 16 ) | ( (uint32_t) hash[offset + 2] << 8 ) | hash[offset + 3];
	value %= 1000000;
	for ( int i = 5; i >= 0; i-- ) { out[i] = '0' + value % 10; value /= 10; }
	out[6] = '\0';
}

} // namespace dolly
