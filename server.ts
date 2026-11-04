import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { IsoHostingBotEngine } from './bot/iso_hosting_bot.ts';
import {
  createOrUpdateBot,
  deleteHostedBot,
  getBotLogs,
  getHostedBotsSummary,
  restartHostedBot,
  setOwnerNotifyCallback,
  startHostedBot,
  stopAllHostedBots,
  stopHostedBot,
} from './server/botHostManager.ts';
import { maskEmail, maskSecret, verifyBridgeSignature } from './server/crypto.ts';
import {
  authenticateGoogleContinue,
  authorizeNewGmail,
  destroySession,
  getHostedBotById,
  getMasterBotConfig,
  getSessionUser,
  listAuthorizedAccounts,
  listHostedBots,
  listRecentAccessLogs,
  logAccessEvent,
  revokeAuthorizedUser,
  saveMasterBotConfig,
  type AuthenticatedUser,
} from './server/db.ts';

const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE_NAME = 'iso_session';

interface AuthedRequest extends Request {
  user?: AuthenticatedUser;
  rawBody?: string;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

function setSessionCookie(res: Response, token: string): void {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${30 * 24 * 60 * 60}`,
  ];
  if (isProd) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

// Initialize Master Bot Engine ("ISO HOSTING") backed by local encrypted SQLite
const masterBot = new IsoHostingBotEngine({
  getConfig: async () => {
    const cfg = getMasterBotConfig();
    return {
      botName: cfg.botName,
      botToken: cfg.botToken,
      ownerId: cfg.ownerId,
      extraAdminIds: cfg.extraAdminIds,
      welcomeMessage: cfg.welcomeMessage,
      notifyUnauthorized: cfg.notifyUnauthorized,
    };
  },
  updateBotIdentity: async (username, telegramId) => {
    saveMasterBotConfig({
      botUsername: username,
      botTelegramId: telegramId,
    });
  },
  listBots: async () => {
    return listHostedBots().map((b) => ({
      id: b.id,
      name: b.name,
      runtime: b.runtime,
      status: b.status,
      pid: b.pid,
    }));
  },
  controlBot: async (botId, action) => {
    if (action === 'start') {
      const r = startHostedBot(botId);
      return { ok: r.ok, status: r.bot?.status, error: r.error };
    }
    if (action === 'stop') {
      const r = await stopHostedBot(botId);
      return { ok: r.ok, status: r.bot?.status };
    }
    const r = await restartHostedBot(botId);
    return { ok: r.ok, status: r.bot?.status, error: r.error };
  },
  getBotLogs: async (botId) => {
    return getBotLogs(botId);
  },
  deployUploadedBot: async (input) => {
    const saved = createOrUpdateBot({
      name: input.name,
      description: 'تم رفعه مباشرة عبر بوت ISO HOSTING على تيليجرام',
      runtime: input.runtime,
      code: input.code,
      autoRestart: true,
    });
    return { id: saved.id, name: saved.name };
  },
  recordUnauthorizedAttempt: async (telegramUserId, username) => {
    logAccessEvent(
      'bot_unauthorized',
      `TG:${telegramUserId}`,
      `محاولة استخدام بوت ISO HOSTING من حساب غير مصرح له (${username})`
    );
  },
});

setOwnerNotifyCallback(async (text) => {
  await masterBot.sendMessageToOwner(text);
});

const DECOY_STALL_MESSAGES = [
  'جاري التحقق من بوابة الدفع البنكية... يرجى الانتظار لحظات ثم إعادة الضغط على تأكيد الدفع لإتمام التفويض.',
  'تنبيه من المصرف المصدر: يرجى التأكد من تفعيل خيار المشتريات الدولية / التجارة الإلكترونية على بطاقتك ثم المحاولة مجدداً.',
  'تشهد بوابة التحقق المالي ضغطاً مرتفعاً حالياً. تم حجز رقم الفاتورة الخاص بك، يرجى إعادة المحاولة بعد قليل.',
  'تعذر مطابقة رمز الحماية البنكي (3D Secure). يرجى التحقق من البيانات المدخلة أو إدخال كود فاتورة دفع معتمد.',
  'تم إدراج طلب الاشتراك في قائمة المراجعة المالية الآلية. قد تستغرق عملية التأكيد من 24 إلى 72 ساعة عمل.',
  'بوابة السداد تخضع لتحديث أمني مجدول حالياً. يرجى المحاولة مرة أخرى لاحقاً لإكمال تفعيل الباقة.',
];

async function startServer(): Promise<void> {
  const app = express();

  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as AuthedRequest).rawBody = buf.toString('utf8');
      },
    })
  );

  const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const cookies = parseCookies(req);
    const user = getSessionUser(cookies[SESSION_COOKIE_NAME]);
    if (!user) {
      res.status(401).json({ error: 'يرجى المتابعة بحساب جوجل المصرح له أولاً' });
      return;
    }
    req.user = user;
    next();
  };

  const requireBridgeAuth = (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const ts = String(req.headers['x-iso-timestamp'] || '');
    const sig = String(req.headers['x-iso-signature'] || '');
    const raw = req.rawBody || '';
    if (!verifyBridgeSignature(ts, raw, sig)) {
      res.status(403).json({ error: 'Invalid bridge signature' });
      return;
    }
    next();
  };

  // --- Public Authentication & Decoy Routes ---
  app.get('/api/auth/session', (req: AuthedRequest, res: Response) => {
    const cookies = parseCookies(req);
    const user = getSessionUser(cookies[SESSION_COOKIE_NAME]);
    if (!user) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        isPrimaryOwner: user.isPrimaryOwner,
      },
    });
  });

  app.post('/api/auth/google-continue', (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'يرجى إدخال عنوان بريد جوجل صحيح للمتابعة' });
      return;
    }

    const result = authenticateGoogleContinue(email);
    if (!result.authorized || !result.sessionToken || !result.user) {
      // Never reveal the existence of the two owner Gmails — present paid subscription gate
      const invoiceRef = `INV-${Math.floor(100000 + Math.random() * 900000)}`;
      res.json({
        authenticated: false,
        requirePayment: true,
        invoiceRef,
        monthlyPriceUsd: 49,
        yearlyPriceUsd: 490,
        message:
          'للمتابعة واستخدام خوادم استضافة البوتات في ISO HOSTING، يرجى تفعيل الاشتراك المدفوع أولاً.',
      });
      return;
    }

    setSessionCookie(res, result.sessionToken);
    res.json({
      authenticated: true,
      user: result.user,
    });
  });

  app.post('/api/auth/decoy-payment', (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? req.body.email : 'unknown';
    const attempt = Number(req.body?.attempt || 1);
    const method = typeof req.body?.method === 'string' ? req.body.method : 'card';

    logAccessEvent(
      'decoy_payment_attempt',
      maskEmail(email),
      `محاولة دفع وهمية رقم #${attempt} (${method === 'voucher' ? 'كود فاتورة' : 'بطاقة بنكية'})`
    );

    const idx = Math.max(0, attempt - 1) % DECOY_STALL_MESSAGES.length;
    const nextRef = `TRX-${Math.floor(1000000 + Math.random() * 9000000)}`;

    res.json({
      status: 'pending_verification',
      referenceId: nextRef,
      message: DECOY_STALL_MESSAGES[idx],
    });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const cookies = parseCookies(req);
    destroySession(cookies[SESSION_COOKIE_NAME]);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // --- Protected Dashboard & Master Bot Routes ---
  app.get('/api/dashboard/overview', requireAuth, (req: AuthedRequest, res: Response) => {
    const cfg = getMasterBotConfig();
    const runtime = masterBot.getState();
    const botsSummary = getHostedBotsSummary();

    res.json({
      user: req.user,
      plan: {
        name: 'الخطة الكاملة غير المحدودة',
        isFreeForever: true,
        priceLabel: 'مجانية بالكامل — بدون قيود',
      },
      masterBot: {
        botName: cfg.botName,
        hasToken: Boolean(cfg.botToken),
        hasOwnerId: Boolean(cfg.ownerId),
        maskedToken: maskSecret(cfg.botToken),
        maskedOwnerId: maskSecret(cfg.ownerId),
        botUsername: runtime.botUsername || cfg.botUsername,
        botTelegramId: runtime.botTelegramId || cfg.botTelegramId,
        runtimeStatus: runtime.status,
        lastError: runtime.lastError,
        lastPollAt: runtime.lastPollAt,
        processedCommandsCount: runtime.processedCommandsCount,
      },
      hosting: {
        runningCount: botsSummary.runningCount,
        totalCount: botsSummary.totalCount,
        uptimeSeconds: Math.floor(process.uptime()),
      },
    });
  });

  app.get('/api/bot/config', requireAuth, (req: AuthedRequest, res: Response) => {
    const cfg = getMasterBotConfig();
    const runtime = masterBot.getState();
    const reveal = req.query.reveal === '1';

    res.json({
      botName: cfg.botName,
      hasToken: Boolean(cfg.botToken),
      hasOwnerId: Boolean(cfg.ownerId),
      botToken: reveal ? cfg.botToken : '',
      maskedToken: maskSecret(cfg.botToken),
      ownerId: cfg.ownerId,
      extraAdminIds: cfg.extraAdminIds,
      welcomeMessage: cfg.welcomeMessage,
      autoStartMaster: cfg.autoStartMaster,
      autoRestartChildren: cfg.autoRestartChildren,
      notifyUnauthorized: cfg.notifyUnauthorized,
      botUsername: runtime.botUsername || cfg.botUsername,
      botTelegramId: runtime.botTelegramId || cfg.botTelegramId,
      runtimeStatus: runtime.status,
      lastError: runtime.lastError,
      updatedAt: cfg.updatedAt,
    });
  });

  app.put('/api/bot/config', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    const clearCredentials = body.clearCredentials === true;

    if (clearCredentials) {
      saveMasterBotConfig({ clearCredentials: true });
      await masterBot.syncWithConfig();
      logAccessEvent(
        'bot_config_updated',
        maskEmail(req.user!.email),
        'تم مسح توكن البوت ومعرّف المالك من الإعدادات'
      );
      res.json({
        ok: true,
        message: 'تم مسح التوكن ومعرّف المالك بنجاح. البوت الآن بانتظار إدخال بيانات جديدة.',
        runtime: masterBot.getState(),
      });
      return;
    }

    const current = getMasterBotConfig();
    const incomingToken =
      typeof body.botToken === 'string' && body.botToken.trim().length > 0
        ? body.botToken.trim()
        : current.botToken;
    const incomingOwnerId =
      typeof body.ownerId === 'string' ? body.ownerId.trim() : current.ownerId;

    if (incomingOwnerId && !/^\d+$/.test(incomingOwnerId)) {
      res.status(400).json({
        error: 'معرّف المالك (Owner ID) يجب أن يكون رقماً صحيحاً (مثال: 123456789)',
      });
      return;
    }

    let verifiedUsername: string | null = current.botUsername;
    let verifiedId: string | null = current.botTelegramId;
    let warning: string | null = null;

    if (incomingToken) {
      try {
        const me = await masterBot.verifyToken(incomingToken);
        verifiedUsername = me.username;
        verifiedId = me.id;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'تعذر التحقق من التوكن';
        if (
          errMsg.toLowerCase().includes('unauthorized') ||
          errMsg.toLowerCase().includes('not found')
        ) {
          res.status(400).json({
            error: `توكن البوت غير صحيح حسب رد تيليجرام (${errMsg}). يرجى التأكد من التوكن والمحاولة مجدداً.`,
          });
          return;
        }
        warning = `تم حفظ الإعدادات وتشفيرها في قاعدة البيانات، لكن تعذر الاتصال المباشر بتيليجرام حالياً (${errMsg}).`;
      }
    }

    const extraAdminIds = Array.isArray(body.extraAdminIds)
      ? body.extraAdminIds.map((x: unknown) => String(x).trim()).filter(Boolean)
      : typeof body.extraAdminIds === 'string'
      ? body.extraAdminIds
          .split(',')
          .map((x: string) => x.trim())
          .filter(Boolean)
      : current.extraAdminIds;

    const saved = saveMasterBotConfig({
      botName: typeof body.botName === 'string' ? body.botName : current.botName,
      botToken: incomingToken,
      ownerId: incomingOwnerId,
      extraAdminIds,
      welcomeMessage:
        typeof body.welcomeMessage === 'string' ? body.welcomeMessage : current.welcomeMessage,
      autoStartMaster:
        typeof body.autoStartMaster === 'boolean'
          ? body.autoStartMaster
          : current.autoStartMaster,
      autoRestartChildren:
        typeof body.autoRestartChildren === 'boolean'
          ? body.autoRestartChildren
          : current.autoRestartChildren,
      notifyUnauthorized:
        typeof body.notifyUnauthorized === 'boolean'
          ? body.notifyUnauthorized
          : current.notifyUnauthorized,
      botUsername: verifiedUsername,
      botTelegramId: verifiedId,
    });

    await masterBot.syncWithConfig();

    logAccessEvent(
      'bot_config_updated',
      maskEmail(req.user!.email),
      saved.botToken && saved.ownerId
        ? `تم تحديث وتشفير إعدادات البوت الرئيسي (${saved.botUsername || saved.botName})`
        : 'تم تحديث إعدادات البوت الرئيسي'
    );

    res.json({
      ok: true,
      warning,
      message:
        saved.botToken && saved.ownerId
          ? 'تم حفظ التوكن ومعرّف المالك وتشفيرهما بنجاح وتشغيل البوت.'
          : 'تم حفظ الإعدادات بنجاح. يرجى إدخال كل من التوكن ومعرّف المالك لبدء تشغيل البوت.',
      runtime: masterBot.getState(),
      botUsername: saved.botUsername,
    });
  });

  app.post('/api/bot/control', requireAuth, async (req: AuthedRequest, res: Response) => {
    const action = req.body?.action;
    if (action === 'start') {
      await masterBot.start();
      res.json({ ok: true, runtime: masterBot.getState() });
      return;
    }
    if (action === 'stop') {
      masterBot.stop();
      res.json({ ok: true, runtime: masterBot.getState() });
      return;
    }
    if (action === 'restart') {
      await masterBot.restart();
      res.json({ ok: true, runtime: masterBot.getState() });
      return;
    }
    if (action === 'test_owner_message') {
      const cfg = getMasterBotConfig();
      const result = await masterBot.sendMessageToOwner(
        `✅ رسالة اختبار من لوحة تحكم ${cfg.botName}:\nتم ربط البوت بنجاح وتشفير التوكن ومعرّف المالك في قاعدة البيانات المحلية.`
      );
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ ok: true, message: 'تم إرسال رسالة الاختبار إلى حساب المالك على تيليجرام بنجاح' });
      return;
    }
    res.status(400).json({ error: 'إجراء غير معروف' });
  });

  app.get('/api/bot/files', requireAuth, (_req: AuthedRequest, res: Response) => {
    const tsPath = path.resolve(process.cwd(), 'bot', 'iso_hosting_bot.ts');
    const pyPath = path.resolve(process.cwd(), 'bot', 'iso_hosting_bot.py');
    const tsCode = fs.existsSync(tsPath) ? fs.readFileSync(tsPath, 'utf8') : '';
    const pyCode = fs.existsSync(pyPath) ? fs.readFileSync(pyPath, 'utf8') : '';
    res.json({
      files: [
        {
          filename: 'iso_hosting_bot.ts',
          language: 'TypeScript / Node.js',
          description:
            'ملف البوت الرئيسي المتكامل والمستقل — خالٍ تماماً من أي توكن أو ID مكتوب داخله',
          code: tsCode,
        },
        {
          filename: 'iso_hosting_bot.py',
          language: 'Python 3',
          description:
            'نسخة بايثون المستقلة للبوت — تتصل بالجسر الآمن وتجلب الإعدادات المشفرة من التطبيق',
          code: pyCode,
        },
      ],
    });
  });

  // --- Hosted Bots CRUD & Lifecycle ---
  app.get('/api/bots', requireAuth, (_req: AuthedRequest, res: Response) => {
    res.json(getHostedBotsSummary());
  });

  app.post('/api/bots', requireAuth, (req: AuthedRequest, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const description =
      typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const runtime = req.body?.runtime === 'python' ? 'python' : 'nodejs';
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    const autoRestart = req.body?.autoRestart !== false;
    const startNow = req.body?.startNow === true;
    const envVars: Record<string, string> = {};

    if (req.body?.envVars && typeof req.body.envVars === 'object') {
      for (const [k, v] of Object.entries(req.body.envVars)) {
        if (k.trim()) {
          envVars[k.trim()] = String(v ?? '');
        }
      }
    }

    if (!name) {
      res.status(400).json({ error: 'يرجى كتابة اسم البوت المستضاف' });
      return;
    }
    if (!code.trim()) {
      res.status(400).json({ error: 'يرجى إدخال كود البوت أو رفع ملف البرمجة' });
      return;
    }

    const created = createOrUpdateBot({
      name,
      description,
      runtime,
      code,
      envVars,
      autoRestart,
    });

    if (startNow) {
      startHostedBot(created.id);
    }

    res.status(201).json({
      bot: getHostedBotById(created.id),
      logs: getBotLogs(created.id),
    });
  });

  app.get('/api/bots/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const bot = getHostedBotById(String(req.params.id));
    if (!bot) {
      res.status(404).json({ error: 'البوت غير موجود' });
      return;
    }
    res.json({
      bot,
      logs: getBotLogs(bot.id),
    });
  });

  app.put('/api/bots/:id', requireAuth, async (req: AuthedRequest, res: Response) => {
    const existing = getHostedBotById(String(req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'البوت غير موجود' });
      return;
    }

    const name =
      typeof req.body?.name === 'string' && req.body.name.trim()
        ? req.body.name.trim()
        : existing.name;
    const description =
      typeof req.body?.description === 'string'
        ? req.body.description.trim()
        : existing.description;
    const runtime =
      req.body?.runtime === 'python' || req.body?.runtime === 'nodejs'
        ? req.body.runtime
        : existing.runtime;
    const code = typeof req.body?.code === 'string' ? req.body.code : existing.code;
    const autoRestart =
      typeof req.body?.autoRestart === 'boolean' ? req.body.autoRestart : existing.autoRestart;

    let envVars = existing.envVars;
    if (req.body?.envVars && typeof req.body.envVars === 'object') {
      envVars = {};
      for (const [k, v] of Object.entries(req.body.envVars)) {
        if (k.trim()) {
          envVars[k.trim()] = String(v ?? '');
        }
      }
    }

    const wasRunning = existing.status === 'running';
    const updated = createOrUpdateBot({
      id: existing.id,
      name,
      description,
      runtime,
      code,
      envVars,
      autoRestart,
    });

    if (wasRunning && req.body?.restartIfRunning !== false) {
      await restartHostedBot(updated.id);
    }

    res.json({
      bot: getHostedBotById(updated.id),
      logs: getBotLogs(updated.id),
    });
  });

  app.post('/api/bots/:id/action', requireAuth, async (req: AuthedRequest, res: Response) => {
    const id = String(req.params.id);
    const action = req.body?.action;

    if (action === 'start') {
      const r = startHostedBot(id);
      if (!r.ok) {
        res.status(400).json({ error: r.error });
        return;
      }
      res.json({ bot: r.bot, logs: getBotLogs(id) });
      return;
    }
    if (action === 'stop') {
      const r = await stopHostedBot(id);
      res.json({ bot: r.bot, logs: getBotLogs(id) });
      return;
    }
    if (action === 'restart') {
      const r = await restartHostedBot(id);
      if (!r.ok) {
        res.status(400).json({ error: r.error });
        return;
      }
      res.json({ bot: r.bot, logs: getBotLogs(id) });
      return;
    }

    res.status(400).json({ error: 'إجراء غير مدعوم' });
  });

  app.get('/api/bots/:id/logs', requireAuth, (req: AuthedRequest, res: Response) => {
    const id = String(req.params.id);
    const bot = getHostedBotById(id);
    if (!bot) {
      res.status(404).json({ error: 'البوت غير موجود' });
      return;
    }
    res.json({
      status: bot.status,
      pid: bot.pid,
      logs: getBotLogs(id),
    });
  });

  app.delete('/api/bots/:id', requireAuth, async (req: AuthedRequest, res: Response) => {
    const id = String(req.params.id);
    await deleteHostedBot(id);
    res.json({ ok: true });
  });

  // --- Authorized Users & Security Log Routes ---
  app.get('/api/access/users', requireAuth, (req: AuthedRequest, res: Response) => {
    const revealSelf = req.query.revealSelf === '1' ? req.user?.id : undefined;
    res.json({
      accounts: listAuthorizedAccounts(revealSelf),
      logs: listRecentAccessLogs(50),
    });
  });

  app.post('/api/access/users', requireAuth, (req: AuthedRequest, res: Response) => {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    const displayName =
      typeof req.body?.displayName === 'string' ? req.body.displayName : undefined;
    const role = req.body?.role === 'owner' ? 'owner' : 'admin';

    const result = authorizeNewGmail({ email, displayName, role });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json({
      ok: true,
      accounts: listAuthorizedAccounts(),
      logs: listRecentAccessLogs(50),
    });
  });

  app.delete('/api/access/users/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const result = revokeAuthorizedUser(id);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({
      ok: true,
      accounts: listAuthorizedAccounts(),
      logs: listRecentAccessLogs(50),
    });
  });

  // --- Signed Internal Bridge Routes for Standalone Bot Runner ---
  app.get('/api/bot-bridge/config', requireBridgeAuth, (_req: Request, res: Response) => {
    const cfg = getMasterBotConfig();
    res.json({
      botName: cfg.botName,
      botToken: cfg.botToken,
      ownerId: cfg.ownerId,
      extraAdminIds: cfg.extraAdminIds,
      welcomeMessage: cfg.welcomeMessage,
      notifyUnauthorized: cfg.notifyUnauthorized,
    });
  });

  app.post('/api/bot-bridge/identity', requireBridgeAuth, (req: Request, res: Response) => {
    saveMasterBotConfig({
      botUsername: typeof req.body?.username === 'string' ? req.body.username : null,
      botTelegramId: typeof req.body?.telegramId === 'string' ? req.body.telegramId : null,
    });
    res.json({ ok: true });
  });

  app.get('/api/bot-bridge/bots', requireBridgeAuth, (_req: Request, res: Response) => {
    res.json(
      listHostedBots().map((b) => ({
        id: b.id,
        name: b.name,
        runtime: b.runtime,
        status: b.status,
        pid: b.pid,
      }))
    );
  });

  app.post(
    '/api/bot-bridge/bots/:id/action',
    requireBridgeAuth,
    async (req: Request, res: Response) => {
      const id = String(req.params.id);
      const action = req.body?.action;
      if (action === 'start') {
        const r = startHostedBot(id);
        res.json({ ok: r.ok, status: r.bot?.status, error: r.error });
        return;
      }
      if (action === 'stop') {
        const r = await stopHostedBot(id);
        res.json({ ok: r.ok, status: r.bot?.status });
        return;
      }
      const r = await restartHostedBot(id);
      res.json({ ok: r.ok, status: r.bot?.status, error: r.error });
    }
  );

  app.get('/api/bot-bridge/bots/:id/logs', requireBridgeAuth, (req: Request, res: Response) => {
    res.json(getBotLogs(String(req.params.id)));
  });

  app.post('/api/bot-bridge/bots/deploy', requireBridgeAuth, (req: Request, res: Response) => {
    const saved = createOrUpdateBot({
      name: String(req.body?.name || 'uploaded-bot'),
      description: 'تم رفعه عبر ملف البوت المستقل',
      runtime: req.body?.runtime === 'python' ? 'python' : 'nodejs',
      code: String(req.body?.code || ''),
      autoRestart: true,
    });
    res.json({ id: saved.id, name: saved.name });
  });

  app.post('/api/bot-bridge/unauthorized', requireBridgeAuth, (req: Request, res: Response) => {
    logAccessEvent(
      'bot_unauthorized',
      `TG:${String(req.body?.telegramUserId || 'unknown')}`,
      `محاولة وصول غير مصرح بها للبوت (${String(req.body?.username || 'بدون معرّف')})`
    );
    res.json({ ok: true });
  });

  // --- Vite Dev Middleware / Production Static Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ISO HOSTING] Server running at http://0.0.0.0:${PORT}`);
    const initialCfg = getMasterBotConfig();
    if (initialCfg.autoStartMaster && initialCfg.botToken && initialCfg.ownerId) {
      void masterBot.start();
    } else {
      console.log(
        '[ISO HOSTING] Master bot is waiting for owner Token & ID configuration in the Web App.'
      );
    }
  });

  const shutdown = async () => {
    masterBot.stop();
    await stopAllHostedBots();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void startServer();
