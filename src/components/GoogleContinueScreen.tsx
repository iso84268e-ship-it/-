import React, { useEffect, useState } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import type { DecoyPaywallData, UserProfile } from '../types';
import { BrandMark } from './BrandMark';

interface GoogleContinueScreenProps {
  onSuccess: (user: UserProfile) => void;
  onTriggerPaywall: (decoy: DecoyPaywallData) => void;
}

const REMEMBERED_KEY = 'iso_hosting_last_google';

export const GoogleContinueScreen: React.FC<GoogleContinueScreenProps> = ({
  onSuccess,
  onTriggerPaywall,
}) => {
  const [email, setEmail] = useState('');
  const [rememberedEmail, setRememberedEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBERED_KEY);
      if (saved && saved.includes('@')) {
        setRememberedEmail(saved);
        setEmail(saved);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const submitGoogleAccount = async (targetEmail: string) => {
    const clean = targetEmail.trim();
    if (!clean || !clean.includes('@')) {
      setErrorMsg('يرجى إدخال بريد حساب جوجل للمتابعة');
      return;
    }

    setErrorMsg(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/google-continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: clean }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'تعذر المتابعة، يرجى المحاولة مرة أخرى');
        return;
      }

      if (data.authenticated && data.user) {
        try {
          localStorage.setItem(REMEMBERED_KEY, data.user.email);
        } catch {
          // ignore
        }
        onSuccess(data.user as UserProfile);
        return;
      }

      if (data.requirePayment) {
        onTriggerPaywall({
          email: clean,
          invoiceRef: data.invoiceRef,
          monthlyPriceUsd: data.monthlyPriceUsd ?? 49,
          yearlyPriceUsd: data.yearlyPriceUsd ?? 490,
          message: data.message,
        });
      }
    } catch {
      setErrorMsg('حدث خطأ في الاتصال بالخادم المحلي');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitGoogleAccount(email);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-between px-4 py-8">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <BrandMark size="md" />
        <span className="text-xs font-medium text-neutral-500">
          خادم استضافة البوتات السحابي
        </span>
      </header>

      <main className="max-w-md w-full mx-auto my-auto py-8">
        <div className="bg-white border border-neutral-200 rounded-2xl p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="mb-7">
            <h1 className="text-2xl font-bold text-neutral-900 mb-2">
              المتابعة إلى لوحة التحكم
            </h1>
            <p className="text-sm text-neutral-600 leading-relaxed">
              ادخل مباشرة باستخدام حساب جوجل الخاص بك للوصول الفوري إلى خادم البوتات بدون خطوات تسجيل إضافية.
            </p>
          </div>

          {rememberedEmail && (
            <div className="mb-6">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submitGoogleAccount(rememberedEmail)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl bg-orange-50 border border-orange-200 hover:bg-orange-100/80 transition-colors text-right cursor-pointer disabled:opacity-60"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-orange-800">
                    الحساب المحفوظ على هذا الجهاز
                  </div>
                  <div
                    className="text-sm font-mono font-medium text-neutral-900 truncate mt-0.5"
                    dir="ltr"
                  >
                    {rememberedEmail}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-semibold whitespace-nowrap shrink-0">
                  <span>متابعة فورية</span>
                  <ArrowLeft className="w-3.5 h-3.5" />
                </span>
              </button>
            </div>
          )}

          <form onSubmit={handleFormSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="google-email-input"
                className="block text-sm font-semibold text-neutral-800 mb-1.5"
              >
                حساب جوجل (Gmail)
              </label>
              <input
                id="google-email-input"
                type="email"
                dir="ltr"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@gmail.com"
                className="w-full px-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 text-sm font-mono placeholder:text-neutral-400 focus:outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-600/15 transition-colors"
              />
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700"
              >
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-xl bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-60"
            >
              <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center shrink-0">
                <svg
                  viewBox="0 0 48 48"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
              </span>
              <span>
                {submitting ? 'جاري التحقق والمتابعة...' : 'المتابعة بحساب جوجل'}
              </span>
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-neutral-100 flex items-center gap-2.5 text-xs text-neutral-500">
            <ShieldCheck className="w-4 h-4 text-orange-600 shrink-0" />
            <span>
              نظام مصادقة محلي مشفر بالكامل — اتصال مباشر وآمن
            </span>
          </div>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-neutral-400">
        ISO HOSTING · استضافة وإدارة البوتات السحابية
      </footer>
    </div>
  );
};
