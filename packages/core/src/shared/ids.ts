/**
 * Dependency-free UUIDv7 + trace-id generation for AGUHOT.
 *
 * Primary keys across the system are UUIDv7 (ARCHITECTURE-SPINE.md consistency
 * conventions): time-ordered (so rows cluster by insertion time, friendly to
 * Postgres b-tree inserts) while still carrying 74 bits of randomness. We
 * generate them here with only `Date.now()` + `crypto.getRandomValues`, so the
 * shared kernel stays free of a `uuid` dependency and works in both the worker
 * runtime and tsx-run scripts.
 *
 * `newTraceId()` reuses the same v7 string: every record and BullMQ job carries
 * a trace_id (AD consistency convention), and a v7 trace id additionally tells
 * you roughly when the trace started.
 */

/**
 * Generate a UUIDv7 string (lowercase, dashed). Layout per RFC 9562:
 *   - 48 bits unix-ms timestamp
 *   - 4 bits version (0x7)
 *   - 12 bits random
 *   - 2 bits variant (0b10)
 *   - 62 bits random
 */
export function uuidv7(): string {
  const value = new Uint8Array(16);
  crypto.getRandomValues(value);

  // Bytes 0-5: 48-bit unix milliseconds (big-endian).
  const now = Date.now();
  value[0] = (now / 2 ** 40) & 0xff;
  value[1] = (now / 2 ** 32) & 0xff;
  value[2] = (now / 2 ** 24) & 0xff;
  value[3] = (now / 2 ** 16) & 0xff;
  value[4] = (now / 2 ** 8) & 0xff;
  value[5] = now & 0xff;

  // Byte 6: version 0x7 in the high nibble, low nibble from randomness.
  value[6] = (value[6]! & 0x0f) | 0x70;
  // Byte 8: variant 0b10 in the high two bits.
  value[8] = (value[8]! & 0x3f) | 0x80;

  return toUuidString(value);
}

/**
 * Generate a trace id. Reuses the UUIDv7 format so a trace id is globally
 * unique and time-ordered, matching the system-wide trace_id convention.
 */
export function newTraceId(): string {
  return uuidv7();
}

function toUuidString(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    const byte = bytes[i]!;
    hex.push((byte >> 4).toString(16), (byte & 0xf).toString(16));
  }
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
