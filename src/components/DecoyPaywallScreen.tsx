import React, { useState } from 'react';
import { CreditCard, KeyRound, Lock, RefreshCw, RotateCcw } from 'lucide-react';
import type { DecoyPaywallData } from '../types';
import { BrandMark } from './BrandMark';

interface DecoyPaywallScreenProps {
  decoy: DecoyPaywallData;
  onSwitchAccount: () => void;
}

export const DecoyPaywallScreen: React.FC<DecoyPaywallScreenProps> = ({
  decoy,
  onSwitchAccount,
}) => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'voucher'>('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [voucherCode, setVoucherCode] = useState('');
  const [attemptCount, setAttemptCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [gatewayNotice, setGatewayNotice] = useState<string | null>(null);
  const [currentRef, setCurrentRef] = useState(decoy.invoiceRef);

  const selectedPrice =
    billingCycle === 'monthly' ? decoy.monthlyPriceUsd : decoy.yearlyPriceUsd;

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextAttempt = attemptCount + 1;
    setAttemptCount(nextAttempt);
    setProcessing(true);

    try {
      await new Promise((r) => setTimeout(r, 950));
      const res = await fetch('/api/auth/decoy-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: decoy.email,
          attempt: nextAttempt,
          method: paymentMethod,
        }),
      });
      const data = await res.json();
      setGatewayNotice(
        data.message ||
          'جاري التحقق من بوابة الدفع البنكية... يرجى إعادة المحاولة بعد لحظات.'
      );
      if (data.referenceId) {
        setCurrentRef(data.referenceId);
      }
    } catch {
      setGatewayNotice(
        'تشهد بوابة التحقق المالي ضغطاً مؤقتاً الآن. يرجى المحاولة مرة أخرى بعد قليل.'
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-between px-4 py-8">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-4">
        <BrandMark size="md" />
        <button
          type="button"
          onClick={onSwitchAccount}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5 text-orange-600" />
          <span>تغيير حساب جوجل</span>
        </button>
      </header>

      <main className="max-w-lg w-full mx-auto my-auto py-8">
        <div className="bg-white border border-neutral-200 rounded-2xl p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between gap-4 pb-5 mb-6 border-b border-neutral-100">
            <div>
              <h1 className="text-xl font-bold text-neutral-900">
                تفعيل باقة الاستضافة المدفوعة
              </h1>
              <p className="text-xs text-neutral-500 mt-1" dir="ltr">
                {decoy.email} · <span className="tabular-nums">{currentRef}</span>
              </p>
            </div>
            <div className="text-left shrink-0">
              <div className="text-2xl font-bold text-orange-600 tabular-nums">
                ${selectedPrice}
              </div>
              <div className="text-xs text-neutral-500">
                {billingCycle === 'monthly' ? 'شهرياً' : 'سنوياً'}
              </div>
            </div>
          </div>

          <p className="text-sm text-neutral-600 leading-relaxed mb-5">
            {decoy.message}
          </p>

          {/* Billing cycle switcher */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-100 rounded-xl mb-6">
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                billingCycle === 'monthly'
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              اشتراك شهري (${decoy.monthlyPriceUsd})
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('yearly')}
              className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                billingCycle === 'yearly'
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              اشتراك سنوي (${decoy.yearlyPriceUsd})
            </button>
          </div>

          {/* Payment method selector */}
          <div className="flex items-center gap-3 mb-5">
            <button
              type="button"
              onClick={() => setPaymentMethod('card')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                paymentMethod === 'card'
                  ? 'border-orange-600 bg-orange-50 text-orange-800'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span>بطاقة بنكية / فيزا</span>
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('voucher')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                paymentMethod === 'voucher'
                  ? 'border-orange-600 bg-orange-50 text-orange-800'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>كود فاتورة / تحويل</span>
            </button>
          </div>

          <form onSubmit={handlePaymentSubmit} className="space-y-4">
            {paymentMethod === 'card' ? (
              <>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    رقم البطاقة البنكية
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    placeholder="4532 •••• •••• ••••"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-sm font-mono focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">
                      تاريخ الانتهاء
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      required
                      value={cardExpiry}
                      onChange={(e) => setCardExpiry(e.target.value)}
                      placeholder="MM / YY"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-sm font-mono focus:outline-none focus:border-orange-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">
                      رمز الأمان (CVV)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      required
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value)}
                      placeholder="•••"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-sm font-mono focus:outline-none focus:border-orange-600"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  رقم مرجع التحويل أو كود التفعيل
                </label>
                <input
                  type="text"
                  dir="ltr"
                  required
                  value={voucherCode}
                  onChange={(e) => setVoucherCode(e.target.value)}
                  placeholder="PAY-2026-XXXX"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-sm font-mono focus:outline-none focus:border-orange-600"
                />
              </div>
            )}

            {gatewayNotice && (
              <div
                role="status"
                className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed space-y-1.5"
              >
                <div className="font-bold flex items-center justify-between">
                  <span>حالة التحقق من الدفع</span>
                  <span className="font-mono tabular-nums text-[11px] text-amber-700">
                    محاولة #{attemptCount} · {currentRef}
                  </span>
                </div>
                <p>{gatewayNotice}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={processing}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-60"
            >
              {processing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>جاري التحقق مع البنك...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>دفع ${selectedPrice} وتفعيل الحساب الآن</span>
                </>
              )}
            </button>
          </form>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-neutral-400">
        ISO HOSTING · بوابة الاشتراك السحابي
      </footer>
    </div>
  );
};
