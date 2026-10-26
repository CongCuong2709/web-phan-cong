import React from 'react';

/** Logo TAG vẽ bằng SVG nội bộ — không phụ thuộc URL ảnh bên ngoài (có thể hết hạn). */
export const BrandMark: React.FC<{ className?: string }> = ({ className = 'h-8 w-8' }) => (
  <svg viewBox="0 0 64 64" className={className} role="img" aria-label="TAG">
    <rect width="64" height="64" rx="12" fill="var(--color-primary)" />
    <text x="32" y="41" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="22" fontWeight="700" fill="#fff">
      TAG
    </text>
  </svg>
);

/** Ảnh đại diện; không có ảnh thì hiện chữ cái đầu thay vì thẻ <img src=""> vỡ. */
export const Avatar: React.FC<{ name: string; src?: string; className?: string }> = ({
  name,
  src,
  className = 'w-8 h-8 text-xs',
}) =>
  src ? (
    <img alt={name} src={src} className={`${className} rounded-full object-cover ring-1 ring-outline-variant bg-surface-container-high`} />
  ) : (
    <span
      aria-label={name}
      role="img"
      className={`${className} rounded-full ring-1 ring-outline-variant bg-secondary-container text-on-secondary-fixed font-bold inline-flex items-center justify-center`}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
