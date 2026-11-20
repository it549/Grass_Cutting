/** โลโก้เว็บ: ใบหญ้าสามใบบนพื้นเขียว (ชุดเดียวกับ src/app/icon.svg) */
export function Logo({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} role="img" aria-label="งานตัดหญ้า">
      <rect width="32" height="32" rx="8" fill="#1d6b45" />
      <path d="M10.4 24.5C10.7 19.6 9.6 15.2 6.8 11.6C11 14.4 13.3 18.9 13.7 24.5Z" fill="#bfe0cc" />
      <path d="M13.9 24.5C13.9 18.6 14.6 12.8 16 7C17.4 12.8 18.1 18.6 18.1 24.5Z" fill="#fff" />
      <path d="M21.6 24.5C21.3 19.6 22.4 15.2 25.2 11.6C21 14.4 18.7 18.9 18.3 24.5Z" fill="#bfe0cc" />
      <path d="M6 24.5H26" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
