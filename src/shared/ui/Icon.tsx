type IconName = 'home' | 'sound' | 'play' | 'retry' | 'check' | 'info';
const paths: Record<IconName, string> = {
  home: 'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10',
  sound: 'M11 4 6 8H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16',
  play: 'm8 4 12 8-12 8Z',
  retry: 'M20 8a9 9 0 1 0 1 7M20 3v6h-6',
  check: 'm4 12 5 5L20 6',
  info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
};
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
