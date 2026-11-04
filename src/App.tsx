import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  LogOut,
  Plus,
  Settings,
} from 'lucide-react';
import { AuthorizedAccessPanel } from './components/AuthorizedAccessPanel';
import { BotFileViewerPanel } from './components/BotFileViewerPanel';
import { BrandMark } from './components/BrandMark';
import { DecoyPaywallScreen } from './components/DecoyPaywallScreen';
import { GoogleContinueScreen } from './components/GoogleContinueScreen';
import { HostedBotsPanel } from './components/HostedBotsPanel';
import { MasterBotSettingsPanel } from './components/MasterBotSettingsPanel';
import type { DashboardOverview, DecoyPaywallData, UserProfile } from './types';

type ActiveTab = 'bots' | 'master-settings' | 'bot-file' | 'access';

export default function App() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [decoyPaywall, setDecoyPaywall] = useState<DecoyPaywallData | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('bots');
  const [openCreateCounter, setOpenCreateCounter] = useState(0);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const loadOverview = async () => {
    try {
      const res = await fetch('/api/dashboard/overview');
      if (!res.ok) return;
      const data = (await res.json()) as DashboardOverview;
      setOverview(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const checkInitialSession = async () => {
      try {
        const res = await fetch('/api/auth/session');
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated && data.user) {
            setUser(data.user as UserProfile);
            await loadOverview();
          }
        }
      } finally {
        setCheckingSession(false);
      }
    };
    void checkInitialSession();
  }, []);

  const handleLoginSuccess = async (authedUser: UserProfile) => {
    setDecoyPaywall(null);
    setUser(authedUser);
    await loadOverview();
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setOverview(null);
    setDecoyPaywall(null);
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="bg-white border border-neutral-200 rounded-2xl px-8 py-6 flex items-center gap-3">
          <BrandMark size="md" />
          <span className="text-sm font-medium text-neutral-500">
            جاري التحقق من الجلسة...
          </span>
        </div>
      </div>
    );
  }

  if (decoyPaywall && !user) {
    return (
      <DecoyPaywallScreen
        decoy={decoyPaywall}
        onSwitchAccount={() => setDecoyPaywall(null)}
      />
    );
  }

  if (!user) {
    return (
      <GoogleContinueScreen
        onSuccess={(u) => void handleLoginSuccess(u)}
        onTriggerPaywall={(d) => setDecoyPaywall(d)}
      />
    );
  }

  const needsBotSetup =
    overview && (!overview.masterBot.hasToken || !overview.masterBot.hasOwnerId);

  const masterBotStatusLabel = (() => {
    if (!overview) return 'جاري التحميل...';
    switch (overview.masterBot.runtimeStatus) {
      case 'connected':
        return `متصل (${overview.masterBot.botUsername || overview.masterBot.botName})`;
      case 'connecting':
        return 'جاري الاتصال...';
      case 'error':
        return 'خطأ في الاتصال';
      case 'stopped':
        return 'متوقف';
      default:
        return 'بانتظار التوكن والـ ID';
    }
  })();

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
      {/* Top Bar Contract: Brand — Clean Single-Line Nav Links — Primary CTA */}
      <header className="sticky top-0 z-30 bg-white border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-8">
          <BrandMark size="md" />

          <nav
            aria-label="القائمة الرئيسية"
            className="hidden md:flex items-center gap-6 text-sm font-semibold"
          >
            <button
              type="button"
              onClick={() => setActiveTab('bots')}
              className={`py-5 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'bots'
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              البوتات المستضافة
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('master-settings')}
              className={`py-5 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'master-settings'
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              إعدادات البوت الرئيسي
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('bot-file')}
              className={`py-5 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'bot-file'
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              ملف البوت
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('access')}
              className={`py-5 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'access'
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              المصرح لهم
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                setActiveTab('bots');
                setOpenCreateCounter((c) => c + 1);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة بوت</span>
            </button>

            <button
              type="button"
              onClick={() => void handleLogout()}
              title="تسجيل الخروج"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 text-neutral-500" />
              <span>خروج</span>
            </button>
          </div>
        </div>

        {/* Mobile navigation strip */}
        <div className="md:hidden border-t border-neutral-100 px-4 py-2 flex items-center gap-2 overflow-x-auto">
          {(
            [
              { id: 'bots', label: 'البوتات المستضافة' },
              { id: 'master-settings', label: 'إعدادات البوت' },
              { id: 'bot-file', label: 'ملف البوت' },
              { id: 'access', label: 'المصرح لهم' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                activeTab === t.id
                  ? 'bg-orange-600 text-white'
                  : 'bg-neutral-100 text-neutral-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-8 py-8 space-y-6">
        {/* Waiting for Bot Token & Owner ID Action Banner */}
        {needsBotSetup && activeTab !== 'master-settings' && (
          <div className="bg-white border border-orange-300 rounded-2xl p-5 md:p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-neutral-900">
                البوت الرئيسي ISO HOSTING بانتظار التوكن ومعرّف المالك (ID)
              </h2>
              <p className="text-sm text-neutral-600 mt-1">
                تم تجهيز التطبيق وملف البوت بنجاح. أضف توكن البوت ومعرّف المالك الخاص بك الآن لتفعيل التحكم الكامل عبر تيليجرام.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('master-settings')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Settings className="w-4 h-4" />
              <span>إدخال التوكن والـ ID الآن</span>
            </button>
          </div>
        )}

        {/* 4-Column Unified Status Strip (Single-level hairline grid) */}
        <section
          aria-label="ملخص السيرفر"
          className="bg-white border border-neutral-200 rounded-2xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-neutral-200"
        >
          <div className="p-5">
            <div className="text-xs font-medium text-neutral-500">
              البوت الرئيسي (ISO HOSTING)
            </div>
            <div
              className={`text-sm font-bold mt-1.5 ${
                overview?.masterBot.runtimeStatus === 'connected'
                  ? 'text-green-700'
                  : overview?.masterBot.runtimeStatus === 'error'
                  ? 'text-red-700'
                  : 'text-orange-600'
              }`}
            >
              {masterBotStatusLabel}
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-neutral-500">
              البوتات المستضافة النشطة
            </div>
            <div className="text-xl font-bold text-neutral-900 mt-1 tabular-nums">
              {overview ? `${overview.hosting.runningCount} / ${overview.hosting.totalCount}` : '0 / 0'}
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-neutral-500">
              معرّف المالك المشفر (Owner ID)
            </div>
            <div className="text-sm font-mono font-bold text-neutral-900 mt-1.5 tabular-nums">
              {overview?.masterBot.hasOwnerId
                ? overview.masterBot.maskedOwnerId
                : 'بانتظار الإضافة'}
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-neutral-500">
              حالة الاشتراك والميزات
            </div>
            <div className="text-sm font-bold text-green-700 mt-1.5">
              مجانية بالكامل — صلاحيات كاملة
            </div>
          </div>
        </section>

        {/* Active Tab Viewport */}
        {activeTab === 'bots' && (
          <HostedBotsPanel
            onChanged={() => void loadOverview()}
            onNotify={notify}
            openCreateTrigger={openCreateCounter}
          />
        )}

        {activeTab === 'master-settings' && (
          <MasterBotSettingsPanel
            onUpdated={() => void loadOverview()}
            onNotify={notify}
          />
        )}

        {activeTab === 'bot-file' && <BotFileViewerPanel onNotify={notify} />}

        {activeTab === 'access' && <AuthorizedAccessPanel onNotify={notify} />}
      </main>

      <footer className="max-w-6xl w-full mx-auto px-4 md:px-8 py-5 border-t border-neutral-200/80 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
        <span>ISO HOSTING · لوحة التحكم الخاصة</span>
        <span className="font-mono" dir="ltr">
          {user.email}
        </span>
      </footer>

      {/* Floating Toast Notification */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 left-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-lg text-xs font-semibold max-w-md ${
            toast.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-white border-orange-200 text-neutral-900'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-orange-600 shrink-0" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
