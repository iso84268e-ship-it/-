import React, { useEffect, useState } from 'react';
import {
  Code2,
  FileUp,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type { HostedBotDetail, HostedBotSummary } from '../types';

interface HostedBotsPanelProps {
  onChanged: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  openCreateTrigger?: number;
}

const NODE_TEMPLATE = `// قالب بوت Node.js جاهز للاستضافة على ISO HOSTING
const token = process.env.BOT_TOKEN || '';
console.log('تم تشغيل البوت بنجاح على منصة ISO HOSTING');

if (!token) {
  console.log('ملاحظة: أضف BOT_TOKEN في متغيرات البيئة للاتصال بتيليجرام');
}

setInterval(() => {
  console.log('نبض البوت نشط:', new Date().toISOString());
}, 30000);
`;

const PYTHON_TEMPLATE = `# قالب بوت Python جاهز للاستضافة على ISO HOSTING
import os
import time

token = os.environ.get("BOT_TOKEN", "")
print("تم تشغيل بوت بايثون بنجاح على منصة ISO HOSTING", flush=True)

if not token:
    print("ملاحظة: أضف BOT_TOKEN في متغيرات البيئة للاتصال بتيليجرام", flush=True)

while True:
    time.sleep(30)
    print("البوت يعمل بثبات...", flush=True)
`;

export const HostedBotsPanel: React.FC<HostedBotsPanelProps> = ({
  onChanged,
  onNotify,
  openCreateTrigger = 0,
}) => {
  const [bots, setBots] = useState<HostedBotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped'>('all');

  // Create / Edit Modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);
  const [botName, setBotName] = useState('');
  const [botDesc, setBotDesc] = useState('');
  const [runtime, setRuntime] = useState<'nodejs' | 'python'>('nodejs');
  const [code, setCode] = useState(NODE_TEMPLATE);
  const [autoRestart, setAutoRestart] = useState(true);
  const [startNow, setStartNow] = useState(true);
  const [envPairs, setEnvPairs] = useState<Array<{ key: string; value: string }>>([
    { key: 'BOT_TOKEN', value: '' },
  ]);
  const [savingBot, setSavingBot] = useState(false);

  // Live Console Logs Drawer/Modal
  const [logsBot, setLogsBot] = useState<{ id: string; name: string; status: string } | null>(
    null
  );
  const [logsLines, setLogsLines] = useState<string[]>([]);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const loadBots = async () => {
    try {
      const res = await fetch('/api/bots');
      if (!res.ok) return;
      const data = await res.json();
      setBots(data.bots || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBots();
    const timer = setInterval(() => {
      void loadBots();
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (openCreateTrigger > 0) {
      openCreateModal('nodejs');
    }
  }, [openCreateTrigger]);

  // Poll logs when log viewer is open
  useEffect(() => {
    if (!logsBot) return;
    let active = true;
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/bots/${logsBot.id}/logs`);
        if (!res.ok || !active) return;
        const data = await res.json();
        setLogsLines(data.logs || []);
        setLogsBot((prev) => (prev ? { ...prev, status: data.status } : null));
      } catch {
        // ignore
      }
    };
    void fetchLogs();
    const interval = setInterval(() => {
      void fetchLogs();
    }, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [logsBot?.id]);

  const openCreateModal = (initialRuntime: 'nodejs' | 'python' = 'nodejs') => {
    setEditingBotId(null);
    setBotName('');
    setBotDesc('');
    setRuntime(initialRuntime);
    setCode(initialRuntime === 'python' ? PYTHON_TEMPLATE : NODE_TEMPLATE);
    setAutoRestart(true);
    setStartNow(true);
    setEnvPairs([{ key: 'BOT_TOKEN', value: '' }]);
    setEditorOpen(true);
  };

  const openEditModal = async (id: string) => {
    try {
      const res = await fetch(`/api/bots/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { bot: HostedBotDetail };
      const b = data.bot;
      setEditingBotId(b.id);
      setBotName(b.name);
      setBotDesc(b.description);
      setRuntime(b.runtime);
      setCode(b.code);
      setAutoRestart(b.autoRestart);
      const entries = Object.entries(b.envVars || {});
      setEnvPairs(
        entries.length > 0
          ? entries.map(([key, value]) => ({ key, value }))
          : [{ key: 'BOT_TOKEN', value: '' }]
      );
      setEditorOpen(true);
    } catch {
      onNotify('تعذر تحميل بيانات البوت', 'error');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const isPy = file.name.endsWith('.py');
    setRuntime(isPy ? 'python' : 'nodejs');
    setCode(text);
    if (!botName.trim()) {
      setBotName(file.name.replace(/\.(py|js|ts)$/i, ''));
    }
    onNotify(`تم تحميل ملف "${file.name}" بنجاح`, 'success');
  };

  const handleSaveBot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botName.trim() || !code.trim()) {
      onNotify('يرجى كتابة اسم البوت وكود التشغيل', 'error');
      return;
    }

    const envVars: Record<string, string> = {};
    for (const pair of envPairs) {
      const k = pair.key.trim();
      if (k && pair.value.trim()) {
        envVars[k] = pair.value;
      }
    }

    setSavingBot(true);
    try {
      const url = editingBotId ? `/api/bots/${editingBotId}` : '/api/bots';
      const method = editingBotId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: botName.trim(),
          description: botDesc.trim(),
          runtime,
          code,
          autoRestart,
          startNow,
          envVars,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'تعذر حفظ البوت', 'error');
        return;
      }

      onNotify(
        editingBotId ? 'تم تحديث البوت المستضاف بنجاح' : 'تمت إضافة البوت بنجاح',
        'success'
      );
      setEditorOpen(false);
      await loadBots();
      onChanged();
    } finally {
      setSavingBot(false);
    }
  };

  const handleLifecycleAction = async (
    id: string,
    action: 'start' | 'stop' | 'restart'
  ) => {
    try {
      const res = await fetch(`/api/bots/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'تعذر تنفيذ العملية', 'error');
        return;
      }
      await loadBots();
      onChanged();
    } catch {
      onNotify('حدث خطأ في الاتصال بالخادم', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await fetch(`/api/bots/${target.id}`, { method: 'DELETE' });
    onNotify(`تم حذف البوت "${target.name}"`, 'success');
    await loadBots();
    onChanged();
  };

  const filteredBots = bots.filter((b) => {
    const matchesSearch =
      !searchQuery.trim() ||
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter =
      statusFilter === 'all' ||
      (statusFilter === 'running' && b.status === 'running') ||
      (statusFilter === 'stopped' && b.status !== 'running');
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-6">
      <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
        {/* Toolbar */}
        <div className="p-5 md:p-6 border-b border-neutral-100 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-4 h-4 text-neutral-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن بوت..."
                className="w-full pr-10 pl-3.5 py-2 rounded-xl border border-neutral-200 bg-[#F8FAFC] text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-orange-600 focus:bg-white"
              />
            </div>

            <div className="inline-flex items-center p-1 rounded-xl bg-neutral-100">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  statusFilter === 'all'
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                الكل ({bots.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('running')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  statusFilter === 'running'
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                يعمل ({bots.filter((b) => b.status === 'running').length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('stopped')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  statusFilter === 'stopped'
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                متوقف ({bots.filter((b) => b.status !== 'running').length})
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => openCreateModal('nodejs')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>استضافة بوت جديد</span>
          </button>
        </div>

        {/* Table / Empty State */}
        {loading ? (
          <div className="p-8 space-y-3 animate-pulse">
            <div className="h-12 bg-neutral-100 rounded-xl" />
            <div className="h-12 bg-neutral-100 rounded-xl" />
          </div>
        ) : filteredBots.length === 0 ? (
          <div className="p-10 text-center max-w-lg mx-auto">
            <h3 className="text-base font-bold text-neutral-900 mb-2">
              {bots.length === 0
                ? 'لا توجد بوتات مستضافة بعد'
                : 'لا توجد نتائج مطابقة للبحث'}
            </h3>
            <p className="text-sm text-neutral-600 leading-relaxed mb-6">
              {bots.length === 0
                ? 'يمكنك رفع ملف البوت الخاص بك (.py أو .js) أو لصق الكود مباشرة ليتم تشغيله على السيرفر مجاناً وعلى مدار الساعة.'
                : 'جرب تغيير كلمات البحث أو تصفية الحالة.'}
            </p>
            {bots.length === 0 && (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => openCreateModal('nodejs')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة بوت Node.js</span>
                </button>
                <button
                  type="button"
                  onClick={() => openCreateModal('python')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-800 text-sm font-semibold transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة بوت Python</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {filteredBots.map((bot) => (
              <div
                key={bot.id}
                className="p-5 md:px-6 flex flex-wrap items-center justify-between gap-4 hover:bg-[#F8FAFC] transition-colors"
              >
                <div className="min-w-[220px] flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="text-base font-bold text-neutral-900">
                      {bot.name}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        bot.status === 'running'
                          ? 'text-green-700'
                          : bot.status === 'error'
                          ? 'text-red-700'
                          : 'text-neutral-500'
                      }`}
                    >
                      · {bot.status === 'running' ? 'يعمل الآن' : bot.status === 'error' ? 'توقف بخطأ' : 'متوقف'}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500 mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono">
                      {bot.runtime === 'python' ? 'Python 3' : 'Node.js'} ({bot.entryFile})
                    </span>
                    <span>·</span>
                    <span className="font-mono tabular-nums">
                      PID: {bot.pid ?? '—'}
                    </span>
                    <span>·</span>
                    <span>
                      {bot.autoRestart ? 'إنعاش تلقائي مفعل' : 'تشغيل يدوي'}
                    </span>
                    {bot.envKeysCount > 0 && (
                      <>
                        <span>·</span>
                        <span className="tabular-nums">
                          {bot.envKeysCount} متغير بيئة مشفر
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {bot.status === 'running' ? (
                    <button
                      type="button"
                      onClick={() => void handleLifecycleAction(bot.id, 'stop')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-xs font-semibold text-red-700 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Square className="w-3.5 h-3.5" />
                      <span>إيقاف</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleLifecycleAction(bot.id, 'start')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-xs font-semibold text-white transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>تشغيل</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleLifecycleAction(bot.id, 'restart')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-700 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-orange-600" />
                    <span>إعادة تشغيل</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setLogsBot({ id: bot.id, name: bot.name, status: bot.status })
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-700 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Terminal className="w-3.5 h-3.5 text-neutral-600" />
                    <span>السجلات</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void openEditModal(bot.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-700 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Code2 className="w-3.5 h-3.5 text-orange-600" />
                    <span>تعديل الكود</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeleteTarget({ id: bot.id, name: bot.name })}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-red-50 hover:border-red-200 text-xs font-semibold text-neutral-500 hover:text-red-600 transition-colors cursor-pointer"
                    title="حذف البوت"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Hosted Bot Modal */}
      {editorOpen && (
        <div
          className="fixed inset-0 z-50 bg-neutral-900/45 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-neutral-200 rounded-2xl max-w-3xl w-full p-6 md:p-8 shadow-xl my-8">
            <div className="flex items-center justify-between gap-4 pb-4 mb-6 border-b border-neutral-100">
              <h3 className="text-lg font-bold text-neutral-900">
                {editingBotId ? 'تعديل البوت المستضاف' : 'إضافة واستضافة بوت جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="p-2 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBot} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-neutral-800 mb-1.5">
                    اسم البوت
                  </label>
                  <input
                    type="text"
                    required
                    value={botName}
                    onChange={(e) => setBotName(e.target.value)}
                    placeholder="مثال: بوت إدارة الجروبات"
                    className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 text-sm focus:outline-none focus:border-orange-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-neutral-800 mb-1.5">
                    بيئة التشغيل (Runtime)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRuntime('nodejs');
                        if (!editingBotId && code === PYTHON_TEMPLATE) {
                          setCode(NODE_TEMPLATE);
                        }
                      }}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-semibold cursor-pointer ${
                        runtime === 'nodejs'
                          ? 'border-orange-600 bg-orange-50 text-orange-800'
                          : 'border-neutral-200 bg-white text-neutral-700'
                      }`}
                    >
                      Node.js (index.js)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRuntime('python');
                        if (!editingBotId && code === NODE_TEMPLATE) {
                          setCode(PYTHON_TEMPLATE);
                        }
                      }}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-semibold cursor-pointer ${
                        runtime === 'python'
                          ? 'border-orange-600 bg-orange-50 text-orange-800'
                          : 'border-neutral-200 bg-white text-neutral-700'
                      }`}
                    >
                      Python 3 (bot.py)
                    </button>
                  </div>
                </div>
              </div>

              {/* Upload file or pick template */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-[#F8FAFC] border border-neutral-200">
                <span className="text-xs font-semibold text-neutral-700">
                  استيراد ملف جاهز أو استخدام قالب:
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 text-xs font-semibold text-orange-800 cursor-pointer">
                    <FileUp className="w-3.5 h-3.5" />
                    <span>رفع ملف (.py / .js)</span>
                    <input
                      type="file"
                      accept=".py,.js,.ts"
                      onChange={(e) => void handleFileUpload(e)}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setRuntime('nodejs');
                      setCode(NODE_TEMPLATE);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-700 cursor-pointer"
                  >
                    قالب Node.js
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRuntime('python');
                      setCode(PYTHON_TEMPLATE);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-700 cursor-pointer"
                  >
                    قالب Python
                  </button>
                </div>
              </div>

              {/* Code Editor */}
              <div>
                <label className="block text-sm font-semibold text-neutral-800 mb-1.5">
                  كود البوت ({runtime === 'python' ? 'bot.py' : 'index.js'})
                </label>
                <textarea
                  rows={10}
                  dir="ltr"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full p-4 rounded-xl border border-neutral-300 bg-neutral-950 text-neutral-100 text-xs font-mono leading-relaxed focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Encrypted Environment Variables (e.g. BOT_TOKEN for this hosted bot) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-neutral-800">
                    متغيرات البيئة المشفرة للبوت (مثل BOT_TOKEN)
                  </label>
                  <button
                    type="button"
                    onClick={() => setEnvPairs((p) => [...p, { key: '', value: '' }])}
                    className="text-xs font-semibold text-orange-600 hover:text-orange-700 cursor-pointer"
                  >
                    + إضافة متغير جديد
                  </button>
                </div>
                <div className="space-y-2">
                  {envPairs.map((pair, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2">
                      <input
                        type="text"
                        dir="ltr"
                        value={pair.key}
                        onChange={(e) => {
                          const next = [...envPairs];
                          next[index].key = e.target.value;
                          setEnvPairs(next);
                        }}
                        placeholder="BOT_TOKEN"
                        className="col-span-5 px-3 py-2 rounded-xl border border-neutral-300 text-xs font-mono"
                      />
                      <input
                        type="text"
                        dir="ltr"
                        value={pair.value}
                        onChange={(e) => {
                          const next = [...envPairs];
                          next[index].value = e.target.value;
                          setEnvPairs(next);
                        }}
                        placeholder="أدخل القيمة السرية..."
                        className="col-span-6 px-3 py-2 rounded-xl border border-neutral-300 text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setEnvPairs((p) => p.filter((_, idx) => idx !== index))
                        }
                        className="col-span-1 flex items-center justify-center rounded-xl border border-neutral-200 text-neutral-400 hover:text-red-600 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6 pt-2">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoRestart}
                    onChange={(e) => setAutoRestart(e.target.checked)}
                    className="w-4 h-4 accent-orange-600 rounded"
                  />
                  <span>إعادة تشغيل تلقائي عند التوقف المفاجئ</span>
                </label>

                {!editingBotId && (
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={startNow}
                      onChange={(e) => setStartNow(e.target.checked)}
                      className="w-4 h-4 accent-orange-600 rounded"
                    />
                    <span>تشغيل البوت مباشرة بعد الحفظ</span>
                  </label>
                )}
              </div>

              <div className="pt-4 border-t border-neutral-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-700 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingBot}
                  className="px-6 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  {savingBot ? 'جاري الحفظ...' : 'حفظ البوت'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Live Console Logs Modal */}
      {logsBot && (
        <div
          className="fixed inset-0 z-50 bg-neutral-900/45 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-neutral-200 rounded-2xl max-w-3xl w-full p-6 shadow-xl">
            <div className="flex items-center justify-between gap-4 pb-4 mb-4 border-b border-neutral-100">
              <div>
                <h3 className="text-base font-bold text-neutral-900">
                  سجلات التشغيل المباشرة — {logsBot.name}
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  الحالة الحالية: {logsBot.status === 'running' ? 'يعمل الآن' : 'متوقف'} · تحديث تلقائي كل ثانيتين
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogsBot(null)}
                className="p-2 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div
              dir="ltr"
              className="bg-neutral-950 text-neutral-100 rounded-xl p-4 h-80 overflow-y-auto font-mono text-xs leading-relaxed space-y-1"
            >
              {logsLines.length === 0 ? (
                <div className="text-neutral-400">
                  لا توجد سجلات مخرجات حتى الآن. اضغط على "تشغيل" لبدء البوت ومراقبة السجلات.
                </div>
              ) : (
                logsLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={
                      line.includes('[ERR]')
                        ? 'text-red-400'
                        : line.includes('[SYS]')
                        ? 'text-orange-400'
                        : 'text-neutral-200'
                    }
                  >
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Bot Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-neutral-900/45 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-neutral-200 rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-neutral-900 mb-2">
              تأكيد حذف البوت المستضاف
            </h3>
            <p className="text-sm text-neutral-600 leading-relaxed mb-6">
              هل أنت متأكد من إيقاف وحذف البوت "{deleteTarget.name}" نهائياً من السيرفر؟
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-700 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-xs font-semibold text-white cursor-pointer"
              >
                نعم، حذف البوت
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
