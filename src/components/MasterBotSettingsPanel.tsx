import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  Square,
  Trash2,
} from 'lucide-react';
import type { MasterBotConfigData } from '../types';

interface MasterBotSettingsPanelProps {
  onUpdated: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const MasterBotSettingsPanel: React.FC<MasterBotSettingsPanelProps> = ({
  onUpdated,
  onNotify,
}) => {
  const [config, setConfig] = useState<MasterBotConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [controlling, setControlling] = useState(false);

  const [botName, setBotName] = useState('ISO HOSTING');
  const [botTokenInput, setBotTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [ownerIdInput, setOwnerIdInput] = useState('');
  const [extraAdminsInput, setExtraAdminsInput] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [autoStartMaster, setAutoStartMaster] = useState(true);
  const [autoRestartChildren, setAutoRestartChildren] = useState(true);
  const [notifyUnauthorized, setNotifyUnauthorized] = useState(true);
  const [confirmClearModal, setConfirmClearModal] = useState(false);

  const loadConfig = async (reveal = false) => {
    try {
      const res = await fetch(`/api/bot/config${reveal ? '?reveal=1' : ''}`);
      if (!res.ok) return;
      const data = (await res.json()) as MasterBotConfigData;
      setConfig(data);
      setBotName(data.botName || 'ISO HOSTING');
      if (reveal && data.botToken) {
        setBotTokenInput(data.botToken);
        setShowToken(true);
      } else {
        setBotTokenInput('');
      }
      setOwnerIdInput(data.ownerId || '');
      setExtraAdminsInput((data.extraAdminIds || []).join(', '));
      setWelcomeMessage(data.welcomeMessage || '');
      setAutoStartMaster(data.autoStartMaster);
      setAutoRestartChildren(data.autoRestartChildren);
      setNotifyUnauthorized(data.notifyUnauthorized);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig(false);
  }, []);

  const handleRevealExistingToken = async () => {
    if (showToken) {
      setShowToken(false);
      return;
    }
    await loadConfig(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        botName,
        ownerId: ownerIdInput,
        extraAdminIds: extraAdminsInput,
        welcomeMessage,
        autoStartMaster,
        autoRestartChildren,
        notifyUnauthorized,
      };
      if (botTokenInput.trim().length > 0) {
        payload.botToken = botTokenInput.trim();
      }

      const res = await fetch('/api/bot/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'تعذر حفظ الإعدادات', 'error');
        return;
      }

      if (data.warning) {
        onNotify(data.warning, 'error');
      } else {
        onNotify(data.message || 'تم حفظ الإعدادات بنجاح', 'success');
      }

      await loadConfig(false);
      onUpdated();
    } catch {
      onNotify('حدث خطأ أثناء الاتصال بالخادم', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleBotAction = async (
    action: 'start' | 'stop' | 'restart' | 'test_owner_message'
  ) => {
    setControlling(true);
    try {
      const res = await fetch('/api/bot/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'تعذر تنفيذ الإجراء', 'error');
        return;
      }
      if (action === 'test_owner_message') {
        onNotify(data.message || 'تم إرسال رسالة الاختبار للمالك', 'success');
      } else {
        onNotify('تم تحديث حالة البوت الرئيسي بنجاح', 'success');
      }
      await loadConfig(false);
      onUpdated();
    } finally {
      setControlling(false);
    }
  };

  const handleClearCredentials = async () => {
    setConfirmClearModal(false);
    setSaving(true);
    try {
      const res = await fetch('/api/bot/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearCredentials: true }),
      });
      const data = await res.json();
      if (res.ok) {
        onNotify(data.message || 'تم مسح التوكن ومعرّف المالك', 'success');
        setBotTokenInput('');
        setOwnerIdInput('');
        await loadConfig(false);
        onUpdated();
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="bg-white border border-neutral-200 rounded-2xl p-8 animate-pulse space-y-4">
        <div className="h-6 w-48 bg-neutral-100 rounded" />
        <div className="h-12 bg-neutral-100 rounded-xl" />
        <div className="h-12 bg-neutral-100 rounded-xl" />
      </div>
    );
  }

  const statusInfo = (() => {
    switch (config.runtimeStatus) {
      case 'connected':
        return {
          label: `متصل ويعمل الآن (${config.botUsername || config.botName})`,
          cls: 'text-green-700',
        };
      case 'connecting':
        return { label: 'جاري الاتصال بخادم تيليجرام...', cls: 'text-amber-700' };
      case 'error':
        return {
          label: `خطأ في الاتصال: ${config.lastError || 'يرجى مراجعة التوكن'}`,
          cls: 'text-red-700',
        };
      case 'stopped':
        return { label: 'متوقف يدوياً', cls: 'text-neutral-600' };
      default:
        return {
          label: 'بانتظار إدخال توكن البوت ومعرّف المالك (ID)',
          cls: 'text-orange-700',
        };
    }
  })();

  return (
    <div className="space-y-6">
      <div className="bg-white border border-neutral-200 rounded-2xl p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-6 mb-6 border-b border-neutral-100">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">
              إعدادات البوت الرئيسي (ISO HOSTING)
            </h2>
            <p className="text-sm text-neutral-600 mt-1">
              يتم تشفير التوكن ومعرّف المالك (Owner ID) بتقنية AES-256-GCM في قاعدة البيانات المحلية ولا يتم كتابتهما داخل ملف البوت نهائياً.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {config.runtimeStatus === 'connected' ? (
              <button
                type="button"
                disabled={controlling}
                onClick={() => void handleBotAction('stop')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-800 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Square className="w-3.5 h-3.5 text-red-600" />
                <span>إيقاف البوت</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={controlling || !config.hasToken || !config.hasOwnerId}
                onClick={() => void handleBotAction('start')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                <span>تشغيل البوت</span>
              </button>
            )}

            <button
              type="button"
              disabled={controlling || !config.hasToken || !config.hasOwnerId}
              onClick={() => void handleBotAction('restart')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-800 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5 text-orange-600" />
              <span>إعادة تشغيل</span>
            </button>

            <button
              type="button"
              disabled={controlling || !config.hasToken || !config.hasOwnerId}
              onClick={() => void handleBotAction('test_owner_message')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-orange-200 bg-orange-50 hover:bg-orange-100 text-xs font-semibold text-orange-800 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>اختبار رسالة للمالك</span>
            </button>
          </div>
        </div>

        {/* Status summary bar */}
        <div className="mb-6 p-4 rounded-xl bg-[#F8FAFC] border border-neutral-200 flex flex-wrap items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className={`w-4 h-4 shrink-0 ${statusInfo.cls}`} />
            <span className="font-semibold text-neutral-700">حالة الاتصال:</span>
            <span className={`font-semibold ${statusInfo.cls}`}>{statusInfo.label}</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-neutral-500 font-mono tabular-nums">
            <span>
              التوكن: {config.hasToken ? config.maskedToken : 'غير مضاف'}
            </span>
            <span>·</span>
            <span>
              معرّف المالك: {config.hasOwnerId ? config.ownerId : 'غير مضاف'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Bot Token */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="master-bot-token"
                  className="text-sm font-semibold text-neutral-800"
                >
                  توكن البوت (Bot Token)
                </label>
                {config.hasToken && (
                  <button
                    type="button"
                    onClick={() => void handleRevealExistingToken()}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 cursor-pointer"
                  >
                    {showToken ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>إخفاء التوكن</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        <span>عرض التوكن الحالي للتعديل</span>
                      </>
                    )}
                  </button>
                )}
              </div>
              <input
                id="master-bot-token"
                type={showToken ? 'text' : 'password'}
                dir="ltr"
                value={botTokenInput}
                onChange={(e) => setBotTokenInput(e.target.value)}
                placeholder={
                  config.hasToken
                    ? `محفوظ ومشفر (${config.maskedToken}) — اكتب توكناً جديداً لتغييره`
                    : '1234567890:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
                }
                className="w-full px-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 text-sm font-mono placeholder:text-neutral-400 focus:outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-600/15"
              />
              <p className="text-xs text-neutral-500 mt-1.5">
                احصل عليه من <span className="font-mono">@BotFather</span> على تيليجرام ويمكنك تغييره في أي وقت.
              </p>
            </div>

            {/* Owner Telegram ID */}
            <div>
              <label
                htmlFor="master-owner-id"
                className="block text-sm font-semibold text-neutral-800 mb-1.5"
              >
                معرّف المالك (Owner ID)
              </label>
              <input
                id="master-owner-id"
                type="text"
                dir="ltr"
                inputMode="numeric"
                value={ownerIdInput}
                onChange={(e) => setOwnerIdInput(e.target.value)}
                placeholder="مثال: 987654321"
                className="w-full px-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 text-sm font-mono tabular-nums placeholder:text-neutral-400 focus:outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-600/15"
              />
              <p className="text-xs text-neutral-500 mt-1.5">
                المعرّف الرقمي لحسابك على تيليجرام — يمنحك كل الصلاحيات في البوت ويمنع أي شخص آخر من استخدامه.
              </p>
            </div>

            {/* Bot Display Name */}
            <div>
              <label
                htmlFor="master-bot-name"
                className="block text-sm font-semibold text-neutral-800 mb-1.5"
              >
                اسم البوت في لوحة التحكم
              </label>
              <input
                id="master-bot-name"
                type="text"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                placeholder="ISO HOSTING"
                className="w-full px-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 text-sm focus:outline-none focus:border-orange-600"
              />
            </div>

            {/* Extra Bot Admin IDs */}
            <div>
              <label
                htmlFor="master-extra-admins"
                className="block text-sm font-semibold text-neutral-800 mb-1.5"
              >
                معرّفات مشرفين إضافيين للبوت (اختياري)
              </label>
              <input
                id="master-extra-admins"
                type="text"
                dir="ltr"
                value={extraAdminsInput}
                onChange={(e) => setExtraAdminsInput(e.target.value)}
                placeholder="مثال: 111222333, 444555666"
                className="w-full px-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 text-sm font-mono placeholder:text-neutral-400 focus:outline-none focus:border-orange-600"
              />
              <p className="text-xs text-neutral-500 mt-1.5">
                افصل بين المعرّفات بفاصلة (,) إذا رغبت بتفويض حساب تيليجرام آخر لإدارة البوتات.
              </p>
            </div>
          </div>

          {/* Welcome Message */}
          <div>
            <label
              htmlFor="master-welcome-msg"
              className="block text-sm font-semibold text-neutral-800 mb-1.5"
            >
              رسالة الترحيب التلقائية عند إرسال /start للبوت
            </label>
            <textarea
              id="master-welcome-msg"
              rows={3}
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 text-sm leading-relaxed focus:outline-none focus:border-orange-600"
            />
          </div>

          {/* Flexible Runtime Toggles */}
          <div className="pt-4 border-t border-neutral-100 grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-neutral-200 bg-[#F8FAFC] cursor-pointer">
              <input
                type="checkbox"
                checked={autoStartMaster}
                onChange={(e) => setAutoStartMaster(e.target.checked)}
                className="mt-1 w-4 h-4 accent-orange-600 rounded"
              />
              <div>
                <div className="text-sm font-semibold text-neutral-900">
                  تشغيل تلقائي للبوت الرئيسي
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  تشغيل بوت ISO HOSTING تلقائياً عند بدء السيرفر
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-neutral-200 bg-[#F8FAFC] cursor-pointer">
              <input
                type="checkbox"
                checked={autoRestartChildren}
                onChange={(e) => setAutoRestartChildren(e.target.checked)}
                className="mt-1 w-4 h-4 accent-orange-600 rounded"
              />
              <div>
                <div className="text-sm font-semibold text-neutral-900">
                  إنعاش تلقائي للبوتات المستضافة
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  إعادة تشغيل أي بوت مستضاف فوراً إذا توقف فجأة
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-neutral-200 bg-[#F8FAFC] cursor-pointer">
              <input
                type="checkbox"
                checked={notifyUnauthorized}
                onChange={(e) => setNotifyUnauthorized(e.target.checked)}
                className="mt-1 w-4 h-4 accent-orange-600 rounded"
              />
              <div>
                <div className="text-sm font-semibold text-neutral-900">
                  تنبيه المالك عند محاولة اختراق
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  إرسال إشعار فوري لحسابك إذا راسل البوت شخص غير مصرح له
                </div>
              </div>
            </label>
          </div>

          <div className="pt-4 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-4">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-60"
            >
              {saving ? 'جاري التشفير والحفظ...' : 'حفظ وتشغيل البوت الآن'}
            </button>

            {(config.hasToken || config.hasOwnerId) && (
              <button
                type="button"
                onClick={() => setConfirmClearModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-xs font-semibold text-red-600 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>مسح التوكن والـ ID</span>
              </button>
            )}
          </div>
        </form>
      </div>

      {/* In-app Confirmation Modal for Clearing Credentials */}
      {confirmClearModal && (
        <div
          className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-neutral-200 rounded-2xl max-w-md w-full p-6 shadow-lg">
            <div className="flex items-center gap-3 text-red-600 mb-3">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-neutral-900">
                تأكيد مسح التوكن ومعرّف المالك
              </h3>
            </div>
            <p className="text-sm text-neutral-600 leading-relaxed mb-6">
              سيتم إيقاف اتصال البوت الرئيسي حالياً وحذف التوكن ومعرّف المالك المشفرين من قاعدة البيانات حتى تقوم بإدخال بيانات جديدة. هل تريد المتابعة؟
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmClearModal(false)}
                className="px-4 py-2 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-700 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleClearCredentials()}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-xs font-semibold text-white cursor-pointer"
              >
                نعم، مسح البيانات
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
