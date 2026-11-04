import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  decryptSensitive,
  encryptSensitive,
  generateSessionToken,
  hmacIndex,
  maskEmail,
  normalizeEmail,
  sha256Email,
} from './crypto.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'iso_hosting.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS authorized_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_sha256 TEXT UNIQUE NOT NULL,
    email_enc TEXT,
    display_name TEXT NOT NULL DEFAULT 'مستخدم مصرح له',
    role TEXT NOT NULL DEFAULT 'admin',
    is_primary_owner INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hmac TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES authorized_users(id) ON DELETE CASCADE,
    email_enc TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bot_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    bot_name TEXT NOT NULL DEFAULT 'ISO HOSTING',
    bot_token_enc TEXT,
    owner_id_enc TEXT,
    extra_admin_ids_enc TEXT,
    welcome_message TEXT NOT NULL,
    auto_start_master INTEGER NOT NULL DEFAULT 1,
    auto_restart_children INTEGER NOT NULL DEFAULT 1,
    notify_unauthorized INTEGER NOT NULL DEFAULT 1,
    bot_username TEXT,
    bot_telegram_id TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hosted_bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    runtime TEXT NOT NULL,
    entry_file TEXT NOT NULL,
    code TEXT NOT NULL,
    env_vars_enc TEXT,
    status TEXT NOT NULL DEFAULT 'stopped',
    auto_restart INTEGER NOT NULL DEFAULT 1,
    pid INTEGER,
    restarts_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    actor_masked TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Seed primary owner SHA-256 digests without storing plaintext addresses in code or DB
const PRIMARY_OWNER_DIGESTS = [
  '9bc023912fae5dc1dc5e614c56e85acb393c1b870fdc5ac98eb2ef5778e81cee',
  '01b62a60ca0f08a693c6cdc897b571b40f17329e8f47eb51a3bfe95748c35c07',
];

const nowIso = new Date().toISOString();
const seedOwnerStmt = db.prepare(`
  INSERT OR IGNORE INTO authorized_users (
    email_sha256, email_enc, display_name, role, is_primary_owner, is_active, created_at
  ) VALUES (?, NULL, ?, 'owner', 1, 1, ?)
`);

PRIMARY_OWNER_DIGESTS.forEach((digest, idx) => {
  seedOwnerStmt.run(digest, `المالك الرئيسي #${idx + 1}`, nowIso);
});

// Seed initial bot_config row waiting for owner token & ID
const defaultWelcome =
  'مرحباً بك في لوحة بوت ISO HOSTING لإدارة واستضافة البوتات.\nلديك صلاحيات التحكم الكاملة في السيرفر.';

db.prepare(`
  INSERT OR IGNORE INTO bot_config (
    id, bot_name, bot_token_enc, owner_id_enc, extra_admin_ids_enc,
    welcome_message, auto_start_master, auto_restart_children, notify_unauthorized,
    bot_username, bot_telegram_id, updated_at
  ) VALUES (1, 'ISO HOSTING', NULL, NULL, NULL, ?, 1, 1, 1, NULL, NULL, ?)
`).run(defaultWelcome, nowIso);

// Reset any stale 'running' PIDs from prior process exits on boot
db.prepare(`UPDATE hosted_bots SET status = 'stopped', pid = NULL WHERE status = 'running'`).run();

export interface AuthenticatedUser {
  id: number;
  email: string;
  displayName: string;
  role: 'owner' | 'admin';
  isPrimaryOwner: boolean;
}

export interface DecryptedBotConfig {
  botName: string;
  botToken: string;
  ownerId: string;
  extraAdminIds: string[];
  welcomeMessage: string;
  autoStartMaster: boolean;
  autoRestartChildren: boolean;
  notifyUnauthorized: boolean;
  botUsername: string | null;
  botTelegramId: string | null;
  updatedAt: string;
}

export interface HostedBotRecord {
  id: string;
  name: string;
  description: string;
  runtime: 'nodejs' | 'python';
  entryFile: string;
  code: string;
  envVars: Record<string, string>;
  status: 'running' | 'stopped' | 'error';
  autoRestart: boolean;
  pid: number | null;
  restartsCount: number;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizedAccountView {
  id: number;
  maskedEmail: string;
  revealedEmail?: string;
  displayName: string;
  role: 'owner' | 'admin';
  isPrimaryOwner: boolean;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AccessLogItem {
  id: number;
  eventType: string;
  actorMasked: string;
  detail: string;
  createdAt: string;
}

export function logAccessEvent(eventType: string, actorMasked: string, detail: string): void {
  db.prepare(`
    INSERT INTO access_logs (event_type, actor_masked, detail, created_at)
    VALUES (?, ?, ?, ?)
  `).run(eventType, actorMasked, detail, new Date().toISOString());
}

export function authenticateGoogleContinue(rawEmail: string): {
  authorized: boolean;
  sessionToken?: string;
  user?: AuthenticatedUser;
} {
  const cleanEmail = normalizeEmail(rawEmail);
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { authorized: false };
  }

  const digest = sha256Email(cleanEmail);
  const row = db
    .prepare(
      `SELECT id, email_enc, display_name, role, is_primary_owner, is_active
       FROM authorized_users
       WHERE email_sha256 = ? AND is_active = 1`
    )
    .get(digest) as
    | {
        id: number;
        email_enc: string | null;
        display_name: string;
        role: string;
        is_primary_owner: number;
        is_active: number;
      }
    | undefined;

  if (!row) {
    logAccessEvent(
      'decoy_paywall',
      maskEmail(cleanEmail),
      'محاولة دخول بحساب غير مصرح له — تم توجيهه لبوابة الدفع الوهمية'
    );
    return { authorized: false };
  }

  const encryptedEmail = encryptSensitive(cleanEmail);
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE authorized_users SET email_enc = ?, last_login_at = ? WHERE id = ?`
  ).run(encryptedEmail, now, row.id);

  const rawToken = generateSessionToken();
  const tokenHmac = hmacIndex(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO sessions (token_hmac, user_id, email_enc, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(tokenHmac, row.id, encryptedEmail, now, expiresAt);

  logAccessEvent(
    'login_success',
    maskEmail(cleanEmail),
    row.is_primary_owner === 1
      ? 'دخول مباشر للمالك الرئيسي عبر المتابعة بحساب جوجل'
      : 'دخول مباشر لحساب مصرح له عبر المتابعة بحساب جوجل'
  );

  return {
    authorized: true,
    sessionToken: rawToken,
    user: {
      id: row.id,
      email: cleanEmail,
      displayName: row.display_name,
      role: row.role === 'owner' ? 'owner' : 'admin',
      isPrimaryOwner: row.is_primary_owner === 1,
    },
  };
}

export function getSessionUser(rawToken: string | undefined): AuthenticatedUser | null {
  if (!rawToken) return null;
  const tokenHmac = hmacIndex(rawToken);
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.email_enc, s.expires_at,
              u.id AS user_id, u.display_name, u.role, u.is_primary_owner, u.is_active
       FROM sessions s
       JOIN authorized_users u ON u.id = s.user_id
       WHERE s.token_hmac = ? AND u.is_active = 1`
    )
    .get(tokenHmac) as
    | {
        session_id: number;
        email_enc: string;
        expires_at: string;
        user_id: number;
        display_name: string;
        role: string;
        is_primary_owner: number;
        is_active: number;
      }
    | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(row.session_id);
    return null;
  }

  const email = decryptSensitive(row.email_enc);
  if (!email) return null;

  return {
    id: row.user_id,
    email,
    displayName: row.display_name,
    role: row.role === 'owner' ? 'owner' : 'admin',
    isPrimaryOwner: row.is_primary_owner === 1,
  };
}

export function destroySession(rawToken: string | undefined): void {
  if (!rawToken) return;
  db.prepare(`DELETE FROM sessions WHERE token_hmac = ?`).run(hmacIndex(rawToken));
}

export function getMasterBotConfig(): DecryptedBotConfig {
  const row = db.prepare(`SELECT * FROM bot_config WHERE id = 1`).get() as {
    bot_name: string;
    bot_token_enc: string | null;
    owner_id_enc: string | null;
    extra_admin_ids_enc: string | null;
    welcome_message: string;
    auto_start_master: number;
    auto_restart_children: number;
    notify_unauthorized: number;
    bot_username: string | null;
    bot_telegram_id: string | null;
    updated_at: string;
  };

  const rawExtra = decryptSensitive(row.extra_admin_ids_enc);
  const extraAdminIds = rawExtra
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    botName: row.bot_name || 'ISO HOSTING',
    botToken: decryptSensitive(row.bot_token_enc),
    ownerId: decryptSensitive(row.owner_id_enc),
    extraAdminIds,
    welcomeMessage: row.welcome_message,
    autoStartMaster: row.auto_start_master === 1,
    autoRestartChildren: row.auto_restart_children === 1,
    notifyUnauthorized: row.notify_unauthorized === 1,
    botUsername: row.bot_username,
    botTelegramId: row.bot_telegram_id,
    updatedAt: row.updated_at,
  };
}

export function saveMasterBotConfig(input: {
  botName?: string;
  botToken?: string;
  ownerId?: string;
  extraAdminIds?: string[];
  welcomeMessage?: string;
  autoStartMaster?: boolean;
  autoRestartChildren?: boolean;
  notifyUnauthorized?: boolean;
  botUsername?: string | null;
  botTelegramId?: string | null;
  clearCredentials?: boolean;
}): DecryptedBotConfig {
  const current = getMasterBotConfig();

  const nextBotName = (input.botName ?? current.botName).trim() || 'ISO HOSTING';
  const nextWelcome = (input.welcomeMessage ?? current.welcomeMessage).trim() || defaultWelcome;

  let nextToken = current.botToken;
  let nextOwnerId = current.ownerId;
  let nextUsername = input.botUsername !== undefined ? input.botUsername : current.botUsername;
  let nextTelegramId = input.botTelegramId !== undefined ? input.botTelegramId : current.botTelegramId;

  if (input.clearCredentials) {
    nextToken = '';
    nextOwnerId = '';
    nextUsername = null;
    nextTelegramId = null;
  } else {
    if (input.botToken !== undefined) {
      nextToken = input.botToken.trim();
      if (nextToken !== current.botToken) {
        nextUsername = input.botUsername ?? null;
        nextTelegramId = input.botTelegramId ?? null;
      }
    }
    if (input.ownerId !== undefined) {
      nextOwnerId = input.ownerId.trim();
    }
  }

  const nextExtra =
    input.extraAdminIds !== undefined
      ? input.extraAdminIds.map((s) => s.trim()).filter(Boolean)
      : current.extraAdminIds;

  const nextAutoStart =
    input.autoStartMaster !== undefined ? input.autoStartMaster : current.autoStartMaster;
  const nextAutoRestart =
    input.autoRestartChildren !== undefined
      ? input.autoRestartChildren
      : current.autoRestartChildren;
  const nextNotify =
    input.notifyUnauthorized !== undefined ? input.notifyUnauthorized : current.notifyUnauthorized;

  const updatedAt = new Date().toISOString();

  db.prepare(
    `UPDATE bot_config SET
      bot_name = ?,
      bot_token_enc = ?,
      owner_id_enc = ?,
      extra_admin_ids_enc = ?,
      welcome_message = ?,
      auto_start_master = ?,
      auto_restart_children = ?,
      notify_unauthorized = ?,
      bot_username = ?,
      bot_telegram_id = ?,
      updated_at = ?
     WHERE id = 1`
  ).run(
    nextBotName,
    nextToken ? encryptSensitive(nextToken) : null,
    nextOwnerId ? encryptSensitive(nextOwnerId) : null,
    nextExtra.length > 0 ? encryptSensitive(nextExtra.join(',')) : null,
    nextWelcome,
    nextAutoStart ? 1 : 0,
    nextAutoRestart ? 1 : 0,
    nextNotify ? 1 : 0,
    nextUsername,
    nextTelegramId,
    updatedAt
  );

  return getMasterBotConfig();
}

export function listHostedBots(): HostedBotRecord[] {
  const rows = db
    .prepare(`SELECT * FROM hosted_bots ORDER BY created_at DESC`)
    .all() as Array<{
    id: string;
    name: string;
    description: string;
    runtime: string;
    entry_file: string;
    code: string;
    env_vars_enc: string | null;
    status: string;
    auto_restart: number;
    pid: number | null;
    restarts_count: number;
    started_at: string | null;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => {
    let envVars: Record<string, string> = {};
    if (r.env_vars_enc) {
      try {
        envVars = JSON.parse(decryptSensitive(r.env_vars_enc) || '{}');
      } catch {
        envVars = {};
      }
    }
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      runtime: r.runtime === 'python' ? 'python' : 'nodejs',
      entryFile: r.entry_file,
      code: r.code,
      envVars,
      status:
        r.status === 'running' ? 'running' : r.status === 'error' ? 'error' : 'stopped',
      autoRestart: r.auto_restart === 1,
      pid: r.pid,
      restartsCount: r.restarts_count,
      startedAt: r.started_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export function getHostedBotById(id: string): HostedBotRecord | null {
  const r = db.prepare(`SELECT * FROM hosted_bots WHERE id = ?`).get(id) as
    | {
        id: string;
        name: string;
        description: string;
        runtime: string;
        entry_file: string;
        code: string;
        env_vars_enc: string | null;
        status: string;
        auto_restart: number;
        pid: number | null;
        restarts_count: number;
        started_at: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!r) return null;

  let envVars: Record<string, string> = {};
  if (r.env_vars_enc) {
    try {
      envVars = JSON.parse(decryptSensitive(r.env_vars_enc) || '{}');
    } catch {
      envVars = {};
    }
  }

  return {
    id: r.id,
    name: r.name,
    description: r.description,
    runtime: r.runtime === 'python' ? 'python' : 'nodejs',
    entryFile: r.entry_file,
    code: r.code,
    envVars,
    status: r.status === 'running' ? 'running' : r.status === 'error' ? 'error' : 'stopped',
    autoRestart: r.auto_restart === 1,
    pid: r.pid,
    restartsCount: r.restarts_count,
    startedAt: r.started_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function upsertHostedBot(bot: {
  id: string;
  name: string;
  description: string;
  runtime: 'nodejs' | 'python';
  entryFile: string;
  code: string;
  envVars: Record<string, string>;
  autoRestart: boolean;
}): HostedBotRecord {
  const existing = getHostedBotById(bot.id);
  const now = new Date().toISOString();
  const envEnc =
    Object.keys(bot.envVars).length > 0
      ? encryptSensitive(JSON.stringify(bot.envVars))
      : null;

  if (existing) {
    db.prepare(
      `UPDATE hosted_bots SET
        name = ?, description = ?, runtime = ?, entry_file = ?,
        code = ?, env_vars_enc = ?, auto_restart = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      bot.name,
      bot.description,
      bot.runtime,
      bot.entryFile,
      bot.code,
      envEnc,
      bot.autoRestart ? 1 : 0,
      now,
      bot.id
    );
  } else {
    db.prepare(
      `INSERT INTO hosted_bots (
        id, name, description, runtime, entry_file, code, env_vars_enc,
        status, auto_restart, pid, restarts_count, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'stopped', ?, NULL, 0, NULL, ?, ?)`
    ).run(
      bot.id,
      bot.name,
      bot.description,
      bot.runtime,
      bot.entryFile,
      bot.code,
      envEnc,
      bot.autoRestart ? 1 : 0,
      now,
      now
    );
  }

  return getHostedBotById(bot.id)!;
}

export function updateHostedBotRuntimeState(
  id: string,
  state: {
    status: 'running' | 'stopped' | 'error';
    pid: number | null;
    startedAt?: string | null;
    incrementRestarts?: boolean;
  }
): void {
  const now = new Date().toISOString();
  if (state.incrementRestarts) {
    db.prepare(
      `UPDATE hosted_bots
       SET status = ?, pid = ?, started_at = ?, restarts_count = restarts_count + 1, updated_at = ?
       WHERE id = ?`
    ).run(state.status, state.pid, state.startedAt ?? null, now, id);
  } else {
    db.prepare(
      `UPDATE hosted_bots
       SET status = ?, pid = ?, started_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(state.status, state.pid, state.startedAt ?? null, now, id);
  }
}

export function removeHostedBotRecord(id: string): void {
  db.prepare(`DELETE FROM hosted_bots WHERE id = ?`).run(id);
}

export function listAuthorizedAccounts(revealOwnEmailForUserId?: number): AuthorizedAccountView[] {
  const rows = db
    .prepare(
      `SELECT id, email_enc, display_name, role, is_primary_owner, is_active, created_at, last_login_at
       FROM authorized_users
       ORDER BY is_primary_owner DESC, id ASC`
    )
    .all() as Array<{
    id: number;
    email_enc: string | null;
    display_name: string;
    role: string;
    is_primary_owner: number;
    is_active: number;
    created_at: string;
    last_login_at: string | null;
  }>;

  return rows.map((r) => {
    const decrypted = decryptSensitive(r.email_enc);
    const isPrimary = r.is_primary_owner === 1;
    const maskedEmail = decrypted
      ? maskEmail(decrypted)
      : 'حساب مالك محمي (مشفر SHA-256)';

    return {
      id: r.id,
      maskedEmail,
      revealedEmail:
        !isPrimary || r.id === revealOwnEmailForUserId ? decrypted || undefined : undefined,
      displayName: r.display_name,
      role: r.role === 'owner' ? 'owner' : 'admin',
      isPrimaryOwner: isPrimary,
      isActive: r.is_active === 1,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
    };
  });
}

export function authorizeNewGmail(input: {
  email: string;
  displayName?: string;
  role?: 'owner' | 'admin';
}): { ok: boolean; error?: string } {
  const clean = normalizeEmail(input.email);
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return { ok: false, error: 'يرجى إدخال عنوان بريد إلكتروني صحيح' };
  }

  const digest = sha256Email(clean);
  const existing = db
    .prepare(`SELECT id, is_primary_owner FROM authorized_users WHERE email_sha256 = ?`)
    .get(digest) as { id: number; is_primary_owner: number } | undefined;

  const now = new Date().toISOString();
  const encrypted = encryptSensitive(clean);
  const displayName = (input.displayName || clean.split('@')[0]).trim();
  const role = input.role === 'owner' ? 'owner' : 'admin';

  if (existing) {
    db.prepare(
      `UPDATE authorized_users SET is_active = 1, email_enc = ?, display_name = ?, role = ? WHERE id = ?`
    ).run(
      encrypted,
      existing.is_primary_owner === 1 ? 'المالك الرئيسي' : displayName,
      existing.is_primary_owner === 1 ? 'owner' : role,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO authorized_users (
        email_sha256, email_enc, display_name, role, is_primary_owner, is_active, created_at
      ) VALUES (?, ?, ?, ?, 0, 1, ?)`
    ).run(digest, encrypted, displayName, role, now);
  }

  logAccessEvent(
    'user_authorized',
    maskEmail(clean),
    `تم منح صلاحية الدخول الكامل للحساب (${role === 'owner' ? 'مالك' : 'مشرف'})`
  );

  return { ok: true };
}

export function revokeAuthorizedUser(id: number): { ok: boolean; error?: string } {
  const row = db
    .prepare(`SELECT id, email_enc, is_primary_owner FROM authorized_users WHERE id = ?`)
    .get(id) as
    | { id: number; email_enc: string | null; is_primary_owner: number }
    | undefined;

  if (!row) {
    return { ok: false, error: 'الحساب غير موجود' };
  }
  if (row.is_primary_owner === 1) {
    return { ok: false, error: 'لا يمكن حذف حسابات المالكين الأساسيين المحمية' };
  }

  const email = decryptSensitive(row.email_enc);
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
  db.prepare(`DELETE FROM authorized_users WHERE id = ?`).run(id);

  logAccessEvent(
    'user_revoked',
    email ? maskEmail(email) : `#${id}`,
    'تم سحب تصريح الدخول وإنهاء الجلسات النشطة'
  );

  return { ok: true };
}

export function listRecentAccessLogs(limit = 40): AccessLogItem[] {
  const rows = db
    .prepare(`SELECT * FROM access_logs ORDER BY id DESC LIMIT ?`)
    .all(limit) as Array<{
    id: number;
    event_type: string;
    actor_masked: string;
    detail: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    actorMasked: r.actor_masked,
    detail: r.detail,
    createdAt: r.created_at,
  }));
}
