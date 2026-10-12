// A small hand-drawn icon set (stroke icons, 24px grid). Icons always sit
// next to words; they never carry meaning alone.
const PATHS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5.5h4V20',
  plus: 'M12 5v14M5 12h14',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  scale: 'M12 4v16M6 20h12M4 8h16M7 8l-3 6a3 3 0 0 0 6 0L7 8Zm10 0-3 6a3 3 0 0 0 6 0l-3-6Z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  barcode: 'M4 6v12M7 6v12M10.5 6v12M13 6v12M16.5 6v12M20 6v12',
  pencil: 'M15.5 5.5l3 3L8 19H5v-3L15.5 5.5Z',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM20 20l-4.8-4.8',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4V8Zm0 0 8 4 8-4M12 12v8',
  tag: 'M3.5 12.5V5h7.5l9 9-7.5 7.5-9-9ZM8 8.5h.01',
  cloud: 'M7 18a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.3 9 4.5 4.5 0 0 1 17 18H7Z',
  cloudOff: 'M4 4l16 16M9.5 6.3A5.5 5.5 0 0 1 17.3 9a4.5 4.5 0 0 1 2.5 7.6M14.5 18H7a4 4 0 0 1-1.2-7.8',
  check: 'M5 12.5 10 17l9-10',
  alert: 'M12 4 2.5 20h19L12 4Zm0 6v4.5m0 3h.01',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.5-11.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V14m0 3h.01',
  phone: 'M5 4h3.5l1.5 4-2 1.5a10 10 0 0 0 5 5l1.5-2 4 1.5V18a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2Z',
  back: 'M14.5 5 7.5 12l7 7',
  forward: 'M9.5 5l7 7-7 7',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3 6',
  file: 'M7 3h7l5 5v13H7V3Zm7 0v5h5M9.5 13h7M9.5 16.5h7',
  download: 'M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19h14',
  share: 'M12 15V4m-4 4 4-4 4 4M6 11v8h12v-8',
  shield: 'M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6L12 3Zm-3.5 9.5 2.5 2.5 4.5-5',
  lock: 'M6.5 11h11v9h-11v-9Zm2-0V8a3.5 3.5 0 0 1 7 0v3',
  hand: 'M8 11V5.5a1.5 1.5 0 0 1 3 0V10m0-4.5a1.5 1.5 0 0 1 3 0V10m0-3a1.5 1.5 0 0 1 3 0v6.5a6.5 6.5 0 0 1-6.5 6.5h-.5a6 6 0 0 1-5-2.7L3.5 13a1.5 1.5 0 0 1 2.4-1.8L8 13.5',
  gift: 'M4 10h16v4H4v-4Zm1.5 4h13v6h-13v-6ZM12 10v10M12 10C10 6 6.5 6.5 7.5 8.5S12 10 12 10Zm0 0c2-4 5.5-3.5 4.5-1.5S12 10 12 10Z',
  dollar: 'M12 3v18M16 7.5C16 5.6 14.2 5 12 5s-4 1-4 3c0 4.5 8 2.5 8 7 0 2-1.8 3-4 3s-4-.8-4-2.8',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
  scan: 'M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M7 12h10',
  map: 'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  copy: 'M8 8h11v12H8V8Zm-3 8V4h11',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  x: 'M6 6l12 12M18 6 6 18',
  star: 'm12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.8 2.6 1.1-5.3-4-3.7 5.4-.6L12 4Z',
  pin: 'M9 4h6l-1 5 3 3H7l3-3-1-5Zm3 8v8',
  history: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4.5l3 2',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, className = '', title }: { name: IconName | string; size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name] ?? PATHS.help} />
    </svg>
  );
}
