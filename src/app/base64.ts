/** URL-safe base64 for short strings, with no Buffer or atob dependency. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

function fromUtf8(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function encode(text: string): string {
  const bytes = utf8(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '';
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '';
  }
  return out;
}

export function decode(code: string): string {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of code) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('not a valid code');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return fromUtf8(bytes);
}
