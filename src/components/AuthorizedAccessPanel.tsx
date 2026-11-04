import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import type { AccessLog, AuthorizedAccount } from '../types';

interface AuthorizedAccessPanelProps {
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const AuthorizedAccessPanel: React.FC<AuthorizedAccessPanelProps> = ({
  onNotify,
}) => {
  const [accounts, setAccounts] = useState<AuthorizedAccount[]>([]);
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [revealSelf, setRevealSelf] = useState(false);

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'owner'>('admin');
  const [adding, setAdding] = useState(false);

  const loadAccessData = async (reveal = revealSelf) => {
    const res = await fetch(`/api/access/users${reveal ? '?revealSelf=1' : ''}`);
    if (!res.ok) return;
    const data = await res.json();
    setAccounts(data.accounts || []);
    setLogs(data.logs || []);
  };

  useEffect(() => {
    void loadAccessData(false);
  }, []);

  const handleToggleReveal = async () => {
    const next = !revealSelf;
    setRevealSelf(next);
    await loadAccessData(next);
  };

  const handleAuthorizeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/access/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail.trim(),
          displayName: newName.trim() || undefined,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'تعذر إضافة الحساب', 'error');
        return;
      }
      setNewEmail('');
      setNewName('');
      onNotify('تم تصريح الحساب بنجاح — يمكنه الآن الدخول مباشرة عبر جوجل مجاناً', 'success');
      await loadAccessData(revealSelf);
    } finally {
      setAdding(false);
    }
  };

  const handleRevoke = async (id: number) => {
    const res = await fetch(`/api/access/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      onNotify(data.error || 'تعذر سحب الصلاحية', 'error');
      return;
    }
    onNotify('تم سحب التصريح وإنهاء جلسات الحساب بنجاح', 'success');
    await loadAccessData(revealSelf);
  };

  return (
    <div className="space-y-6">
      {/* Grant access to a new Gmail */}
      <div className="bg-white border border-neutral-200 rounded-2xl p-6 md:p-8">
        <div className="pb-5 mb-6 border-b border-neutral-100">
          <h2 className="text-lg font-bold text-neutral-900">
            التصريح لحسابات جوجل بالدخول المجاني
          </h2>
          <p className="text-sm text-neutral-600 mt-1">
            أي حساب غير مصرح له هنا يتم تحويله تلقائياً لبوابة الدفع الوهمية دون معرفة حسابات المالكين. الحسابات المصرح لها تدخل مباشرة وتستمتع بجميع الميزات مجاناً بالكامل.
          </p>
        </div>

        <form onSubmit={handleAuthorizeEmail} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-5">
            <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
              بريد جوجل المراد التصريح له (Gmail)
            </label>
            <input
              type="email"
              dir="ltr"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="friend@gmail.com"
              className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-sm font-mono focus:outline-none focus:border-orange-600"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
              الاسم التعريفي (اختياري)
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="مثال: مشرف البوتات"
              className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-sm focus:outline-none focus:border-orange-600"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
              الصلاحية
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'admin' | 'owner')}
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 bg-white text-sm focus:outline-none focus:border-orange-600"
            >
              <option value="admin">مشرف بوتات</option>
              <option value="owner">صلاحية كاملة</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={adding}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4" />
              <span>{adding ? 'جاري الإضافة...' : 'منح تصريح'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Authorized Accounts List */}
      <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
        <div className="p-5 md:px-6 border-b border-neutral-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-orange-600" />
            <h3 className="text-base font-bold text-neutral-900">
              قائمة الحسابات المصرح لها ({accounts.length})
            </h3>
          </div>
          <button
            type="button"
            onClick={() => void handleToggleReveal()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-700 cursor-pointer"
          >
            {revealSelf ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{revealSelf ? 'إخفاء بريدي' : 'عرض بريدي الحالي'}</span>
          </button>
        </div>

        <div className="divide-y divide-neutral-100">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="p-4 md:px-6 flex flex-wrap items-center justify-between gap-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-neutral-900">
                    {acc.displayName}
                  </span>
                  <span className="text-xs font-semibold text-orange-700">
                    · {acc.isPrimaryOwner ? 'مالك أساسي محمي' : acc.role === 'owner' ? 'صلاحية كاملة' : 'مشرف'}
                  </span>
                </div>
                <div className="text-xs font-mono text-neutral-500 mt-1" dir="ltr">
                  {acc.revealedEmail || acc.maskedEmail}
                </div>
              </div>

              <div>
                {acc.isPrimaryOwner ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-400">
                    <Lock className="w-3.5 h-3.5" />
                    <span>حساب أساسي مقفل</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleRevoke(acc.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-xs font-semibold text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>سحب الصلاحية</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Security & Decoy Activity Log */}
      <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
        <div className="p-5 md:px-6 border-b border-neutral-100">
          <h3 className="text-base font-bold text-neutral-900">
            سجل الدخول ومحاولات الوصول
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            يسجل عمليات الدخول الناجحة ومحاولات المستخدمين غير المصرح لهم الذين تم تحويلهم لبوابة الدفع الوهمية.
          </p>
        </div>

        {logs.length === 0 ? (
          <div className="p-6 text-center text-xs text-neutral-500">
            لا توجد أحداث مسجلة بعد.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 max-h-80 overflow-y-auto">
            {logs.map((item) => (
              <div
                key={item.id}
                className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`font-semibold ${
                      item.eventType === 'login_success' ||
                      item.eventType === 'user_authorized'
                        ? 'text-green-700'
                        : item.eventType.includes('decoy') ||
                          item.eventType.includes('unauthorized')
                        ? 'text-amber-700'
                        : 'text-neutral-700'
                    }`}
                  >
                    {item.detail}
                  </span>
                </div>
                <div className="flex items-center gap-3 font-mono text-neutral-500 tabular-nums">
                  <span dir="ltr">{item.actorMasked}</span>
                  <span>·</span>
                  <span>
                    {new Date(item.createdAt).toLocaleTimeString('en-GB', {
                      hour12: false,
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
