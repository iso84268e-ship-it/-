/**
 * ISO HOSTING — Master Bot Engine (Standalone & Integrated)
 *
 * تنبيه أمني هام:
 * لا يتم تخزين توكن البوت (BOT_TOKEN) أو معرّف المالك (OWNER_ID) داخل هذا الملف نهائياً.
 * يتم جلب الإعدادات المشفرة والتحقق من صلاحية المالك حصرياً عبر لوحة التحكم وقاعدة البيانات المحلية المشفرة.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface BotBridgeProvider {
  getConfig: () => Promise<{
    botName: string;
    botToken: string;
    ownerId: string;
    extraAdminIds: string[];
    welcomeMessage: string;
    notifyUnauthorized: boolean;
  }>;
  updateBotIdentity: (username: string, telegramId: string) => Promise<void>;
  listBots: () => Promise<
    Array<{
      id: string;
      name: string;
      runtime: 'nodejs' | 'python';
      status: 'running' | 'stopped' | 'error';
      pid: number | null;
    }>
  >;
  controlBot: (
    botId: string,
    action: 'start' | 'stop' | 'restart'
  ) => Promise<{ ok: boolean; status?: string; error?: string }>;
  getBotLogs: (botId: string) => Promise<string[]>;
  deployUploadedBot: (input: {
    name: string;
    runtime: 'nodejs' | 'python';
    code: string;
  }) => Promise<{ id: string; name: string }>;
  recordUnauthorizedAttempt: (telegramUserId: string, username: string) => Promise<void>;
}

export interface MasterBotRuntimeState {
  status: 'waiting_for_credentials' | 'connecting' | 'connected' | 'stopped' | 'error';
  botUsername: string | null;
  botTelegramId: string | null;
  lastError: string | null;
  lastPollAt: string | null;
  processedCommandsCount: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      username?: string;
      first_name?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
    document?: {
      file_id: string;
      file_name?: string;
      file_size?: number;
    };
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      username?: string;
      first_name?: string;
    };
    message?: {
      message_id: number;
      chat: {
        id: number;
      };
    };
    data?: string;
  };
}

export class IsoHostingBotEngine {
  private provider: BotBridgeProvider;
  private running = false;
  private offset = 0;
  private abortController: AbortController | null = null;
  private state: MasterBotRuntimeState = {
    status: 'waiting_for_credentials',
    botUsername: null,
    botTelegramId: null,
    lastError: null,
    lastPollAt: null,
    processedCommandsCount: 0,
  };

  constructor(provider: BotBridgeProvider) {
    this.provider = provider;
  }

  public getState(): MasterBotRuntimeState {
    return { ...this.state };
  }

  private async callTelegram<T = unknown>(
    token: string,
    method: string,
    payload?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
      signal,
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      throw new Error(json.description || `Telegram API error on ${method}`);
    }
    return json.result as T;
  }

  public async verifyToken(token: string): Promise<{ username: string; id: string }> {
    const me = await this.callTelegram<{ id: number; username?: string; first_name: string }>(
      token,
      'getMe'
    );
    return {
      username: me.username ? `@${me.username}` : me.first_name,
      id: String(me.id),
    };
  }

  public async sendMessageToOwner(text: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = await this.provider.getConfig();
    if (!cfg.botToken || !cfg.ownerId) {
      return { ok: false, error: 'توكن البوت أو معرّف المالك غير مضاف بعد' };
    }
    try {
      await this.callTelegram(cfg.botToken, 'sendMessage', {
        chat_id: cfg.ownerId,
        text,
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'تعذر إرسال الرسالة',
      };
    }
  }

  public async start(): Promise<void> {
    if (this.running) return;

    const cfg = await this.provider.getConfig();
    if (!cfg.botToken || !cfg.ownerId) {
      this.state.status = 'waiting_for_credentials';
      this.state.lastError = null;
      return;
    }

    this.running = true;
    this.state.status = 'connecting';
    this.state.lastError = null;
    this.abortController = new AbortController();

    try {
      const me = await this.verifyToken(cfg.botToken);
      this.state.botUsername = me.username;
      this.state.botTelegramId = me.id;
      this.state.status = 'connected';
      await this.provider.updateBotIdentity(me.username, me.id);
      void this.pollLoop();
    } catch (err) {
      this.running = false;
      this.state.status = 'error';
      this.state.lastError =
        err instanceof Error ? err.message : 'تعذر الاتصال بخادم تيليجرام';
    }
  }

  public stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.state.status = 'stopped';
  }

  public async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  public async syncWithConfig(): Promise<void> {
    const cfg = await this.provider.getConfig();
    if (!cfg.botToken || !cfg.ownerId) {
      this.stop();
      this.state.status = 'waiting_for_credentials';
      this.state.botUsername = null;
      this.state.botTelegramId = null;
      this.state.lastError = null;
      return;
    }
    await this.restart();
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const cfg = await this.provider.getConfig();
        if (!cfg.botToken || !cfg.ownerId) {
          this.stop();
          this.state.status = 'waiting_for_credentials';
          break;
        }

        const updates = await this.callTelegram<TelegramUpdate[]>(
          cfg.botToken,
          'getUpdates',
          {
            offset: this.offset,
            timeout: 25,
            allowed_updates: ['message', 'callback_query'],
          },
          this.abortController?.signal
        );

        this.state.status = 'connected';
        this.state.lastError = null;
        this.state.lastPollAt = new Date().toISOString();

        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(cfg, update);
        }
      } catch (err) {
        if (!this.running) break;
        const msg = err instanceof Error ? err.message : 'خطأ في الاتصال';
        if (!msg.toLowerCase().includes('abort')) {
          this.state.status = 'error';
          this.state.lastError = msg;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }

  private isAuthorizedSender(
    senderId: number | undefined,
    ownerId: string,
    extraAdminIds: string[]
  ): boolean {
    if (!senderId) return false;
    const sid = String(senderId);
    return sid === ownerId || extraAdminIds.includes(sid);
  }

  private buildMainMenuKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: 'البوتات المستضافة', callback_data: 'iso:bots' },
          { text: 'حالة السيرفر', callback_data: 'iso:stats' },
        ],
        [
          { text: 'طريقة رفع بوت جديد', callback_data: 'iso:upload_help' },
          { text: 'تحديث القائمة', callback_data: 'iso:menu' },
        ],
      ],
    };
  }

  private async handleUpdate(
    cfg: Awaited<ReturnType<BotBridgeProvider['getConfig']>>,
    update: TelegramUpdate
  ): Promise<void> {
    if (update.message) {
      const msg = update.message;
      const senderId = msg.from?.id;

      if (!this.isAuthorizedSender(senderId, cfg.ownerId, cfg.extraAdminIds)) {
        const uname = msg.from?.username ? `@${msg.from.username}` : 'بدون معرّف';
        await this.provider.recordUnauthorizedAttempt(String(senderId ?? 'unknown'), uname);

        await this.callTelegram(cfg.botToken, 'sendMessage', {
          chat_id: msg.chat.id,
          text: 'هذا البوت مخصص لخادم استضافة خاص مدفوع.\nيرجى تفعيل اشتراكك عبر بوابة الدفع المعتمدة للحصول على صلاحية الوصول.',
        });

        if (cfg.notifyUnauthorized && cfg.ownerId) {
          await this.callTelegram(cfg.botToken, 'sendMessage', {
            chat_id: cfg.ownerId,
            text: `تنبيه أمني (${cfg.botName}):\nحاول مستخدم غير مصرح له الوصول إلى البوت.\nالمعرّف: ${senderId ?? 'غير معروف'} (${uname})`,
          });
        }
        return;
      }

      this.state.processedCommandsCount += 1;

      if (msg.document) {
        const fileName = msg.document.file_name || 'bot.py';
        const isPy = fileName.endsWith('.py');
        const isJs = fileName.endsWith('.js');
        if (!isPy && !isJs) {
          await this.callTelegram(cfg.botToken, 'sendMessage', {
            chat_id: msg.chat.id,
            text: 'يرجى إرسال ملف بوت بصيغة .py (بايثون) أو .js (نود جي إس) فقط.',
          });
          return;
        }

        const fileInfo = await this.callTelegram<{ file_path: string }>(
          cfg.botToken,
          'getFile',
          { file_id: msg.document.file_id }
        );

        const fileRes = await fetch(
          `https://api.telegram.org/file/bot${cfg.botToken}/${fileInfo.file_path}`
        );
        const code = await fileRes.text();
        const botTitle = fileName.replace(/\.(py|js)$/i, '');

        const deployed = await this.provider.deployUploadedBot({
          name: botTitle,
          runtime: isPy ? 'python' : 'nodejs',
          code,
        });

        await this.callTelegram(cfg.botToken, 'sendMessage', {
          chat_id: msg.chat.id,
          text: `تم استلام وحفظ البوت "${deployed.name}" بنجاح في السيرفر.\nاختر إجراءً للتحكم الفوري:`,
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'تشغيل البوت الآن', callback_data: `iso:bot_start:${deployed.id}` },
                { text: 'قائمة البوتات', callback_data: 'iso:bots' },
              ],
            ],
          },
        });
        return;
      }

      const bots = await this.provider.listBots();
      const runningCount = bots.filter((b) => b.status === 'running').length;

      await this.callTelegram(cfg.botToken, 'sendMessage', {
        chat_id: msg.chat.id,
        text: `${cfg.welcomeMessage}\n\nملخص السيرفر الحالي:\n• البوتات النشطة: ${runningCount} من ${bots.length}\n• حالة الحماية: مفعلة (معرّف المالك مشفر في التطبيق)`,
        reply_markup: this.buildMainMenuKeyboard(),
      });
      return;
    }

    if (update.callback_query) {
      const cb = update.callback_query;
      if (!this.isAuthorizedSender(cb.from.id, cfg.ownerId, cfg.extraAdminIds)) {
        await this.callTelegram(cfg.botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'غير مصرح لك بتنفيذ هذا الإجراء — يتطلب اشتراكاً مفعلاً.',
          show_alert: true,
        });
        return;
      }

      this.state.processedCommandsCount += 1;
      await this.callTelegram(cfg.botToken, 'answerCallbackQuery', {
        callback_query_id: cb.id,
      });

      const chatId = cb.message?.chat.id ?? cb.from.id;
      const messageId = cb.message?.message_id;
      const data = cb.data || 'iso:menu';

      if (data === 'iso:menu') {
        const bots = await this.provider.listBots();
        const runningCount = bots.filter((b) => b.status === 'running').length;
        await this.editOrSend(
          cfg.botToken,
          chatId,
          messageId,
          `${cfg.welcomeMessage}\n\n• البوتات النشطة: ${runningCount} من ${bots.length}`,
          this.buildMainMenuKeyboard()
        );
        return;
      }

      if (data === 'iso:stats') {
        const bots = await this.provider.listBots();
        const runningCount = bots.filter((b) => b.status === 'running').length;
        const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
        await this.editOrSend(
          cfg.botToken,
          chatId,
          messageId,
          `حالة سيرفر ${cfg.botName}:\n• البوتات العاملة: ${runningCount}\n• إجمالي البوتات المستضافة: ${bots.length}\n• استهلاك الذاكرة: ${memMb} MB\n• الأوامر المنفذة: ${this.state.processedCommandsCount}`,
          this.buildMainMenuKeyboard()
        );
        return;
      }

      if (data === 'iso:upload_help') {
        await this.editOrSend(
          cfg.botToken,
          chatId,
          messageId,
          'لرفع بوت جديد عبر تيليجرام مباشرة:\nأرسل ملف البوت بصيغة (.py) أو (.js) هنا في المحادثة، وسيتم حفظه في قاعدة البيانات المشفرة وتجهيزه للتشغيل فوراً.',
          this.buildMainMenuKeyboard()
        );
        return;
      }

      if (data === 'iso:bots') {
        const bots = await this.provider.listBots();
        if (bots.length === 0) {
          await this.editOrSend(
            cfg.botToken,
            chatId,
            messageId,
            'لا توجد بوتات مستضافة حالياً.\nيمكنك إضافة بوت من لوحة الويب أو إرسال ملف .py / .js هنا مباشرة.',
            this.buildMainMenuKeyboard()
          );
          return;
        }

        const rows = bots.map((b) => [
          {
            text: `${b.status === 'running' ? 'يعمل' : 'متوقف'} — ${b.name}`,
            callback_data: `iso:bot_view:${b.id}`,
          },
        ]);
        rows.push([{ text: 'العودة للقائمة الرئيسية', callback_data: 'iso:menu' }]);

        await this.editOrSend(
          cfg.botToken,
          chatId,
          messageId,
          'اختر البوت المطلوب للتحكم به:',
          { inline_keyboard: rows }
        );
        return;
      }

      if (data.startsWith('iso:bot_view:')) {
        const botId = data.replace('iso:bot_view:', '');
        const bots = await this.provider.listBots();
        const bot = bots.find((b) => b.id === botId);
        if (!bot) {
          await this.editOrSend(
            cfg.botToken,
            chatId,
            messageId,
            'تعذر العثور على هذا البوت.',
            this.buildMainMenuKeyboard()
          );
          return;
        }

        await this.editOrSend(
          cfg.botToken,
          chatId,
          messageId,
          `تفاصيل البوت: ${bot.name}\n• البيئة: ${bot.runtime === 'python' ? 'Python' : 'Node.js'}\n• الحالة: ${bot.status === 'running' ? 'يعمل الآن' : 'متوقف'}\n• معرّف العملية (PID): ${bot.pid ?? '—'}`,
          {
            inline_keyboard: [
              [
                { text: 'تشغيل', callback_data: `iso:bot_start:${bot.id}` },
                { text: 'إيقاف', callback_data: `iso:bot_stop:${bot.id}` },
                { text: 'إعادة تشغيل', callback_data: `iso:bot_restart:${bot.id}` },
              ],
              [
                { text: 'آخر السجلات', callback_data: `iso:bot_logs:${bot.id}` },
                { text: 'قائمة البوتات', callback_data: 'iso:bots' },
              ],
            ],
          }
        );
        return;
      }

      if (
        data.startsWith('iso:bot_start:') ||
        data.startsWith('iso:bot_stop:') ||
        data.startsWith('iso:bot_restart:')
      ) {
        const [, actionPart, botId] = data.split(':');
        const action =
          actionPart === 'bot_start'
            ? 'start'
            : actionPart === 'bot_stop'
            ? 'stop'
            : 'restart';

        const res = await this.provider.controlBot(botId, action);
        const statusText = res.ok
          ? `تم تنفيذ (${action === 'start' ? 'تشغيل' : action === 'stop' ? 'إيقاف' : 'إعادة تشغيل'}) بنجاح.`
          : `فشل التنفيذ: ${res.error ?? 'خطأ غير معروف'}`;

        await this.editOrSend(cfg.botToken, chatId, messageId, statusText, {
          inline_keyboard: [
            [
              { text: 'عرض حالة البوت', callback_data: `iso:bot_view:${botId}` },
              { text: 'قائمة البوتات', callback_data: 'iso:bots' },
            ],
          ],
        });
        return;
      }

      if (data.startsWith('iso:bot_logs:')) {
        const botId = data.replace('iso:bot_logs:', '');
        const logs = await this.provider.getBotLogs(botId);
        const tail = logs.slice(-12).join('\n') || 'لا توجد سجلات مسجلة حتى الآن.';
        await this.editOrSend(
          cfg.botToken,
          chatId,
          messageId,
          `آخر سجلات التشغيل:\n\n${tail.slice(0, 3500)}`,
          {
            inline_keyboard: [
              [
                { text: 'تحديث السجلات', callback_data: `iso:bot_logs:${botId}` },
                { text: 'رجوع للبوت', callback_data: `iso:bot_view:${botId}` },
              ],
            ],
          }
        );
      }
    }
  }

  private async editOrSend(
    token: string,
    chatId: number,
    messageId: number | undefined,
    text: string,
    replyMarkup: unknown
  ): Promise<void> {
    if (messageId) {
      try {
        await this.callTelegram(token, 'editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text,
          reply_markup: replyMarkup,
        });
        return;
      } catch {
        // Fallback to sendMessage if message text is unchanged
      }
    }
    await this.callTelegram(token, 'sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
    });
  }
}

// Standalone execution entry point (when run directly via `npx tsx bot/iso_hosting_bot.ts`)
// Connects securely to the Web App bridge without any hardcoded token or owner ID!
const isDirectExecution =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('iso_hosting_bot.ts');

if (isDirectExecution) {
  const webappUrl = (process.env.ISO_WEBAPP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const keyPath = path.resolve(process.cwd(), 'data', '.bridge.key');
  const bridgeSecret =
    process.env.ISO_BRIDGE_SECRET ||
    (fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8').trim() : '');

  const signedFetch = async <T>(endpoint: string, bodyObj?: unknown): Promise<T> => {
    const body = bodyObj !== undefined ? JSON.stringify(bodyObj) : '';
    const ts = String(Date.now());
    const sig = crypto
      .createHmac('sha256', bridgeSecret)
      .update(`${ts}.${body}`)
      .digest('hex');

    const res = await fetch(`${webappUrl}${endpoint}`, {
      method: bodyObj !== undefined ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-ISO-Timestamp': ts,
        'X-ISO-Signature': sig,
      },
      body: bodyObj !== undefined ? body : undefined,
    });
    if (!res.ok) {
      throw new Error(`Bridge request failed (${res.status})`);
    }
    return (await res.json()) as T;
  };

  const standaloneEngine = new IsoHostingBotEngine({
    getConfig: () => signedFetch('/api/bot-bridge/config'),
    updateBotIdentity: (username, telegramId) =>
      signedFetch('/api/bot-bridge/identity', { username, telegramId }),
    listBots: () => signedFetch('/api/bot-bridge/bots'),
    controlBot: (botId, action) =>
      signedFetch(`/api/bot-bridge/bots/${botId}/action`, { action }),
    getBotLogs: (botId) => signedFetch(`/api/bot-bridge/bots/${botId}/logs`),
    deployUploadedBot: (input) => signedFetch('/api/bot-bridge/bots/deploy', input),
    recordUnauthorizedAttempt: (telegramUserId, username) =>
      signedFetch('/api/bot-bridge/unauthorized', { telegramUserId, username }),
  });

  console.log('[ISO HOSTING BOT] Standalone runner initialized. Fetching encrypted settings from Web App...');
  void standaloneEngine.start();
  setInterval(() => {
    void standaloneEngine.syncWithConfig();
  }, 15000);
}
