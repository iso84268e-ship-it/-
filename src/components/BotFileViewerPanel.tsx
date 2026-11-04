import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, ShieldCheck } from 'lucide-react';
import type { BotSourceFile } from '../types';

interface BotFileViewerPanelProps {
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const BotFileViewerPanel: React.FC<BotFileViewerPanelProps> = ({ onNotify }) => {
  const [files, setFiles] = useState<BotSourceFile[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/bot/files');
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    };
    void load();
  }, []);

  const activeFile = files[selectedIdx];

  const handleCopy = async () => {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.code);
    setCopied(true);
    onNotify(`تم نسخ كود ${activeFile.filename}`, 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!activeFile) return;
    const blob = new Blob([activeFile.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.filename;
    a.click();
    URL.revokeObjectURL(url);
    onNotify(`جاري تحميل ${activeFile.filename}`, 'success');
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-neutral-100">
        <div>
          <h2 className="text-lg font-bold text-neutral-900">
            ملف البوت الرئيسي (ISO HOSTING)
          </h2>
          <p className="text-sm text-neutral-600 mt-1">
            ملف البوت جاهز ومربوط مباشرة بالتطبيق — لا يحتوي على أي توكن أو معرّف مالك (ID) مكتوب داخله لمنع أي شخص من تعديل الملف والدخول.
          </p>
        </div>

        <div className="inline-flex items-center p-1 rounded-xl bg-neutral-100">
          {files.map((f, idx) => (
            <button
              key={f.filename}
              type="button"
              onClick={() => setSelectedIdx(idx)}
              className={`px-3.5 py-2 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                selectedIdx === idx
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {f.filename}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 rounded-xl bg-orange-50 border border-orange-200 flex items-start gap-3 text-xs text-orange-900 leading-relaxed">
        <ShieldCheck className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
        <div>
          <div className="font-bold mb-0.5">
            حماية كاملة: التوكن والـ ID يضافان من التطبيق فقط
          </div>
          <div>
            يعمل ملف البوت تلقائياً داخل خادم التطبيق فور إدخالك للتوكن ومعرّف المالك في تبويب "إعدادات البوت الرئيسي"، ويمكنك أيضاً تحميله وتشغيله كملف مستقل يقرأ الإعدادات المشفرة عبر الجسر الآمن.
          </div>
        </div>
      </div>

      {activeFile && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-neutral-600">
              <span className="font-bold text-neutral-900">{activeFile.language}</span> ·{' '}
              {activeFile.description}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-700 cursor-pointer"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-orange-600" />
                )}
                <span>{copied ? 'تم النسخ' : 'نسخ الكود'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-xs font-semibold text-white cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>تحميل {activeFile.filename}</span>
              </button>
            </div>
          </div>

          <pre
            dir="ltr"
            className="bg-neutral-950 text-neutral-100 rounded-xl p-5 overflow-x-auto max-h-[460px] text-xs font-mono leading-relaxed"
          >
            <code>{activeFile.code}</code>
          </pre>
        </div>
      )}
    </div>
  );
};
