import React from 'react';

interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg';
}

export const BrandMark: React.FC<BrandMarkProps> = ({ size = 'md' }) => {
  const iconDims =
    size === 'lg' ? 'w-11 h-11' : size === 'sm' ? 'w-7 h-7' : 'w-8 h-8';
  const textCls =
    size === 'lg'
      ? 'text-2xl font-bold tracking-tight text-neutral-900'
      : 'text-lg font-bold tracking-tight text-neutral-900';

  return (
    <div className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <svg
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${iconDims} shrink-0`}
        aria-hidden="true"
      >
        <rect width="36" height="36" rx="9" fill="#EA580C" />
        <rect
          x="9"
          y="10"
          width="18"
          height="6.5"
          rx="2"
          fill="#FFFFFF"
        />
        <rect
          x="9"
          y="19.5"
          width="18"
          height="6.5"
          rx="2"
          fill="#FFFFFF"
          fillOpacity="0.88"
        />
        <circle cx="13" cy="13.25" r="1.35" fill="#EA580C" />
        <circle cx="13" cy="22.75" r="1.35" fill="#EA580C" />
      </svg>
      <span className={textCls} dir="ltr">
        ISO HOSTING
      </span>
    </div>
  );
};
