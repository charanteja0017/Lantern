// Minimal TOTP (RFC 6238) implementation for the demo 2FA enrollment flow.
// In production the backend handles secret generation and verification;
// keeping a client-side implementation lets demo mode exercise the UI end-to-end.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(length = 20): string {
  const bytes = new Uint8Array(length);
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return toBase32(bytes);
}

function toBase32(bytes: Uint8Array): string {
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    out += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}

function fromBase32(input: string): Uint8Array {
  const clean = input.replace(/=+$/g, "").toUpperCase().replace(/\s+/g, "");
  let bits = "";
  for (const c of clean) {
    const idx = BASE32_ALPHABET.indexOf(c);
    if (idx === -1) throw new Error("Invalid base32 character");
    bits += idx.toString(2).padStart(5, "0");
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return out;
}

async function hmacSha1(key: Uint8Array, counter: Uint8Array): Promise<Uint8Array> {
  const cryptoObj = typeof window !== "undefined" ? window.crypto : undefined;
  if (!cryptoObj?.subtle) throw new Error("Web Crypto not available");
  const keyBytes = Uint8Array.from(key);
  const counterBytes = Uint8Array.from(counter);
  const cryptoKey = await cryptoObj.subtle.importKey(
    "raw",
    keyBytes.buffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await cryptoObj.subtle.sign("HMAC", cryptoKey, counterBytes.buffer);
  return new Uint8Array(sig);
}

export async function generateTotp(secret: string, timestepSeconds = 30, digits = 6): Promise<string> {
  const key = fromBase32(secret);
  const counter = Math.floor(Date.now() / 1000 / timestepSeconds);
  const counterBytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i -= 1) {
    counterBytes[i] = counter >>> 0 & 0xff;
    // shift uses 32-bit; for values within safe int range the JS operator works for 4 low bytes.
  }
  // Rebuild counter with full 64-bit simulation for correctness.
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  counterBytes[0] = (high >>> 24) & 0xff;
  counterBytes[1] = (high >>> 16) & 0xff;
  counterBytes[2] = (high >>> 8) & 0xff;
  counterBytes[3] = high & 0xff;
  counterBytes[4] = (low >>> 24) & 0xff;
  counterBytes[5] = (low >>> 16) & 0xff;
  counterBytes[6] = (low >>> 8) & 0xff;
  counterBytes[7] = low & 0xff;

  const hmac = await hmacSha1(key, counterBytes);
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = bin % 10 ** digits;
  return code.toString().padStart(digits, "0");
}

export async function verifyTotp(
  secret: string,
  code: string,
  timestepSeconds = 30,
  digits = 6,
  window = 1,
): Promise<boolean> {
  const target = code.replace(/\s+/g, "");
  const key = fromBase32(secret);
  const counter = Math.floor(Date.now() / 1000 / timestepSeconds);
  for (let drift = -window; drift <= window; drift += 1) {
    const c = counter + drift;
    const high = Math.floor(c / 0x100000000);
    const low = c >>> 0;
    const counterBytes = new Uint8Array(8);
    counterBytes[0] = (high >>> 24) & 0xff;
    counterBytes[1] = (high >>> 16) & 0xff;
    counterBytes[2] = (high >>> 8) & 0xff;
    counterBytes[3] = high & 0xff;
    counterBytes[4] = (low >>> 24) & 0xff;
    counterBytes[5] = (low >>> 16) & 0xff;
    counterBytes[6] = (low >>> 8) & 0xff;
    counterBytes[7] = low & 0xff;
    const hmac = await hmacSha1(key, counterBytes);
    const offset = hmac[hmac.length - 1] & 0xf;
    const bin =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    const expected = (bin % 10 ** digits).toString().padStart(digits, "0");
    if (expected === target) return true;
  }
  return false;
}

export function otpauthUrl({
  secret,
  issuer,
  account,
}: {
  secret: string;
  issuer: string;
  account: string;
}): string {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(account)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = generateSecret(6).toLowerCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return codes;
}
