import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  getHostedBotById,
  getMasterBotConfig,
  listHostedBots,
  removeHostedBotRecord,
  updateHostedBotRuntimeState,
  upsertHostedBot,
  type HostedBotRecord,
} from './db.ts';

const HOSTED_BOTS_DIR = path.resolve(process.cwd(), 'data', 'hosted_bots');

if (!fs.existsSync(HOSTED_BOTS_DIR)) {
  fs.mkdirSync(HOSTED_BOTS_DIR, { recursive: true, mode: 0o700 });
}

interface ActiveProcessEntry {
  child: ChildProcess;
  manualStop: boolean;
}

const activeProcesses = new Map<string, ActiveProcessEntry>();
const botLogBuffers = new Map<string, string[]>();
const MAX_LOG_LINES = 250;

let ownerNotifyCallback: ((text: string) => Promise<void>) | null = null;

export function setOwnerNotifyCallback(cb: ((text: string) => Promise<void>) | null): void {
  ownerNotifyCallback = cb;
}

function appendLog(botId: string, stream: 'OUT' | 'ERR' | 'SYS', chunk: string): void {
  const existing = botLogBuffers.get(botId) ?? [];
  const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const lines = chunk
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    existing.push(`[${timestamp}] [${stream}] ${line}`);
  }

  if (existing.length > MAX_LOG_LINES) {
    existing.splice(0, existing.length - MAX_LOG_LINES);
  }
  botLogBuffers.set(botId, existing);
}

export function getBotLogs(botId: string): string[] {
  return botLogBuffers.get(botId) ?? [];
}

function syncBotFilesToDisk(bot: HostedBotRecord): string {
  const botDir = path.join(HOSTED_BOTS_DIR, bot.id);
  if (!fs.existsSync(botDir)) {
    fs.mkdirSync(botDir, { recursive: true, mode: 0o700 });
  }
  const entryPath = path.join(botDir, bot.entryFile);
  fs.writeFileSync(entryPath, bot.code, 'utf8');
  return botDir;
}

export function startHostedBot(
  id: string,
  isAutoRestart = false
): { ok: boolean; error?: string; bot?: HostedBotRecord } {
  const bot = getHostedBotById(id);
  if (!bot) {
    return { ok: false, error: 'البوت غير موجود' };
  }

  if (activeProcesses.has(id)) {
    return { ok: true, bot };
  }

  const botDir = syncBotFilesToDisk(bot);
  const cmd = bot.runtime === 'python' ? 'python3' : 'node';
  const args = bot.runtime === 'python' ? ['-u', bot.entryFile] : [bot.entryFile];

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...bot.envVars,
    PYTHONUNBUFFERED: '1',
    ISO_HOSTED_BOT_ID: bot.id,
    ISO_HOSTED_BOT_NAME: bot.name,
  };

  try {
    const child = spawn(cmd, args, {
      cwd: botDir,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const entry: ActiveProcessEntry = { child, manualStop: false };
    activeProcesses.set(id, entry);

    const startedAt = new Date().toISOString();
    updateHostedBotRuntimeState(id, {
      status: 'running',
      pid: child.pid ?? null,
      startedAt,
      incrementRestarts: isAutoRestart,
    });

    appendLog(
      id,
      'SYS',
      isAutoRestart
        ? `إعادة تشغيل تلقائية للبوت (${bot.name}) — PID: ${child.pid}`
        : `تم تشغيل البوت (${bot.name}) باستخدام ${cmd} — PID: ${child.pid}`
    );

    child.stdout?.on('data', (data: Buffer) => {
      appendLog(id, 'OUT', data.toString('utf8'));
    });

    child.stderr?.on('data', (data: Buffer) => {
      appendLog(id, 'ERR', data.toString('utf8'));
    });

    child.on('error', (err) => {
      appendLog(id, 'ERR', `فشل تشغيل العملية: ${err.message}`);
      activeProcesses.delete(id);
      updateHostedBotRuntimeState(id, { status: 'error', pid: null });
    });

    child.on('exit', (code, signal) => {
      const currentEntry = activeProcesses.get(id);
      const wasManual = currentEntry?.manualStop ?? false;
      activeProcesses.delete(id);

      if (wasManual) {
        appendLog(id, 'SYS', `تم إيقاف البوت يدوياً (code=${code ?? 'null'})`);
        updateHostedBotRuntimeState(id, { status: 'stopped', pid: null });
        return;
      }

      const crashed = code !== 0;
      appendLog(
        id,
        crashed ? 'ERR' : 'SYS',
        `توقف البوت (code=${code ?? 'null'}, signal=${signal ?? 'none'})`
      );
      updateHostedBotRuntimeState(id, {
        status: crashed ? 'error' : 'stopped',
        pid: null,
      });

      const latestBot = getHostedBotById(id);
      const masterCfg = getMasterBotConfig();
      if (latestBot && latestBot.autoRestart && masterCfg.autoRestartChildren) {
        appendLog(id, 'SYS', 'سيتم إعادة تشغيل البوت تلقائياً خلال 3 ثوانٍ...');
        if (ownerNotifyCallback) {
          void ownerNotifyCallback(
            `⚠️ تنبيه من ISO HOSTING:\nتوقف البوت المستضاف "${latestBot.name}" بشكل مفاجئ (رمز الخروج: ${code ?? 'غير معروف'}) وجاري إعادة تشغيله تلقائياً.`
          );
        }
        setTimeout(() => {
          const checkAgain = getHostedBotById(id);
          if (checkAgain && checkAgain.autoRestart && !activeProcesses.has(id)) {
            startHostedBot(id, true);
          }
        }, 3000);
      }
    });

    return { ok: true, bot: getHostedBotById(id)! };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'خطأ غير معروف';
    appendLog(id, 'ERR', `تعذر بدء العملية: ${message}`);
    updateHostedBotRuntimeState(id, { status: 'error', pid: null });
    return { ok: false, error: message };
  }
}

export async function stopHostedBot(id: string): Promise<{ ok: boolean; bot?: HostedBotRecord }> {
  const entry = activeProcesses.get(id);
  if (!entry) {
    updateHostedBotRuntimeState(id, { status: 'stopped', pid: null });
    return { ok: true, bot: getHostedBotById(id) ?? undefined };
  }

  entry.manualStop = true;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try {
        entry.child.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, 2500);

    entry.child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    try {
      entry.child.kill('SIGTERM');
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });

  activeProcesses.delete(id);
  updateHostedBotRuntimeState(id, { status: 'stopped', pid: null });
  return { ok: true, bot: getHostedBotById(id) ?? undefined };
}

export async function restartHostedBot(
  id: string
): Promise<{ ok: boolean; error?: string; bot?: HostedBotRecord }> {
  await stopHostedBot(id);
  return startHostedBot(id, false);
}

export async function deleteHostedBot(id: string): Promise<void> {
  await stopHostedBot(id);
  botLogBuffers.delete(id);
  const botDir = path.join(HOSTED_BOTS_DIR, id);
  if (fs.existsSync(botDir)) {
    fs.rmSync(botDir, { recursive: true, force: true });
  }
  removeHostedBotRecord(id);
}

export async function stopAllHostedBots(): Promise<void> {
  const ids = Array.from(activeProcesses.keys());
  await Promise.all(ids.map((id) => stopHostedBot(id)));
}

export function getHostedBotsSummary(): {
  bots: Array<
    Omit<HostedBotRecord, 'envVars'> & {
      envKeysCount: number;
      recentLogsCount: number;
    }
  >;
  runningCount: number;
  totalCount: number;
} {
  const all = listHostedBots();
  const runningCount = all.filter((b) => b.status === 'running').length;
  return {
    bots: all.map(({ envVars, ...rest }) => ({
      ...rest,
      envKeysCount: Object.keys(envVars).length,
      recentLogsCount: (botLogBuffers.get(rest.id) ?? []).length,
    })),
    runningCount,
    totalCount: all.length,
  };
}

export function createOrUpdateBot(input: {
  id?: string;
  name: string;
  description?: string;
  runtime: 'nodejs' | 'python';
  code: string;
  envVars?: Record<string, string>;
  autoRestart?: boolean;
}): HostedBotRecord {
  const id =
    input.id ||
    `bot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const entryFile = input.runtime === 'python' ? 'bot.py' : 'index.js';

  const saved = upsertHostedBot({
    id,
    name: input.name.trim(),
    description: (input.description || '').trim(),
    runtime: input.runtime,
    entryFile,
    code: input.code,
    envVars: input.envVars || {},
    autoRestart: input.autoRestart ?? true,
  });

  syncBotFilesToDisk(saved);
  return saved;
}
