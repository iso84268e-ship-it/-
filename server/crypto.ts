import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const MASTER_KEY_PATH = path.join(DATA_DIR, '.master.key');
const BRIDGE_KEY_PATH = path.join(DATA_DIR, '.bridge.key');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

function getOrCreateKeyFile(filePath: string): Buffer {
  ensureDataDir();
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    const buf = Buffer.from(raw, 'hex');
    if (buf.length === 32) {
      return buf;
    }
  }
  const fresh = crypto.randomBytes(32);
  fs.writeFileSync(filePath, fresh.toString('hex'), { mode: 0o600 });
  return fresh;
}

const masterKey = process.env.ISO_MASTER_KEY
  ? crypto.createHash('sha256').update(process.env.ISO_MASTER_KEY).digest()
  : getOrCreateKeyFile(MASTER_KEY_PATH);

const encryptionKey = Buffer.from(
  crypto.hkdfSync('sha256', masterKey, 'iso-hosting-salt-v1', 'aes-256-gcm-encryption', 32)
);

const hmacKey = Buffer.from(
  crypto.hkdfSync('sha256', masterKey, 'iso-hosting-salt-v1', 'hmac-sha256-blind-index', 32)
);

export function getBridgeSecret(): string {
  if (process.env.ISO_BRIDGE_SECRET) {
    return process.env.ISO_BRIDGE_SECRET;
  }
  return getOrCreateKeyFile(BRIDGE_KEY_PATH).toString('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function sha256Email(email: string): string {
  return crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

export function hmacIndex(value: string): string {
  return crypto.createHmac('sha256', hmacKey).update(value).digest('hex');
}

export function encryptSensitive(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${authTag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSensitive(ciphertext: string | null | undefined): string {
  if (!ciphertext) return '';
  const parts = ciphertext.split('.');
  if (parts.length !== 3) {
    return '';
  }
  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const authTag = Buffer.from(parts[1], 'base64url');
    const encrypted = Buffer.from(parts[2], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 1) return '***@gmail.com';
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  if (local.length <= 3) {
    return `${local[0]}***@${domain}`;
  }
  return `${local.slice(0, 2)}***${local.slice(-2)}@${domain}`;
}

export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return '••••••••';
  return `${secret.slice(0, 5)}••••••••${secret.slice(-4)}`;
}

export function signBridgePayload(timestamp: string, body: string): string {
  const secret = getBridgeSecret();
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verifyBridgeSignature(timestamp: string, body: string, signature: string): boolean {
  if (!timestamp || !signature) return false;
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > 120_000) {
    return false;
  }
  const expected = signBridgePayload(timestamp, body);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
