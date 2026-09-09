type IconName =
  'home' | 'sound' | 'play' | 'retry' | 'check' | 'settings' | 'close';
const paths: Record<IconName, string> = {
  close: 'm6 6 12 12M18 6 6 18',
  settings:
    'M19.69 9.79L21.84 10.21L21.84 13.79L19.69 14.21L19.00 15.87L20.22 17.69L17.69 20.22L15.87 19.00L14.21 19.69L13.79 21.84L10.21 21.84L9.79 19.69L8.13 19.00L6.31 20.22L3.78 17.69L5.00 15.87L4.31 14.21L2.16 13.79L2.16 10.21L4.31 9.79L5.00 8.13L3.78 6.31L6.31 3.78L8.13 5.00L9.79 4.31L10.21 2.16L13.79 2.16L14.21 4.31L15.87 5.00L17.69 3.78L20.22 6.31L19.00 8.13ZM15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
  home: 'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10',
  sound: 'M11 4 6 8H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16',
  play: 'm8 4 12 8-12 8Z',
  retry: 'M20 8a9 9 0 1 0 1 7M20 3v6h-6',
  check: 'm4 12 5 5L20 6',
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
