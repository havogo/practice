// Inline SVG icons. Stroke-based, 24px grid, sized by CSS.

import { raw } from "./ui.js";

const svg = (body, { size = 24, fill = false } = {}) =>
  raw(
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ` +
      `fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" ` +
      `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  );

export const icons = {
  home: (o) => svg(`<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>`, o),
  script: (o) => svg(`<path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M8.5 12h5"/><path d="M8.5 16h7"/>`, o),
  people: (o) => svg(`<circle cx="9" cy="8" r="3.2"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M16.5 5.6a3 3 0 0 1 0 5.6"/><path d="M17.6 14.4A5.5 5.5 0 0 1 21.2 19"/>`, o),
  pill: (o) => svg(`<rect x="2.6" y="8.4" width="18.8" height="7.2" rx="3.6" transform="rotate(-45 12 12)"/><path d="M8.8 8.8l6.4 6.4"/>`, o),
  chart: (o) => svg(`<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M2 20h20"/>`, o),
  gear: (o) => svg(`<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 0 1 0-4h.11a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 0 1 4 0v.11a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 0 1 0 4h-.11a1.7 1.7 0 0 0-1.56 1Z"/>`, o),
  plus: (o) => svg(`<path d="M12 5v14"/><path d="M5 12h14"/>`, o),
  plusCircle: (o) => svg(`<circle cx="12" cy="12" r="9"/><path d="M12 8.5v7"/><path d="M8.5 12h7"/>`, o),
  search: (o) => svg(`<circle cx="11" cy="11" r="6.4"/><path d="m20 20-4.4-4.4"/>`, o),
  chevronRight: (o) => svg(`<path d="m9 5 7 7-7 7"/>`, o),
  chevronLeft: (o) => svg(`<path d="m15 5-7 7 7 7"/>`, o),
  chevronUp: (o) => svg(`<path d="m5 15 7-7 7 7"/>`, o),
  chevronDown: (o) => svg(`<path d="m5 9 7 7 7-7"/>`, o),
  close: (o) => svg(`<path d="M6 6l12 12"/><path d="M18 6 6 18"/>`, o),
  trash: (o) => svg(`<path d="M4 7h16"/><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l.8 12.1a1.2 1.2 0 0 0 1.2 1.1h7a1.2 1.2 0 0 0 1.2-1.1L17.5 7"/>`, o),
  print: (o) => svg(`<path d="M7 9V3h10v6"/><path d="M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/>`, o),
  share: (o) => svg(`<path d="M12 15V3"/><path d="m8 6.6 4-3.6 4 3.6"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>`, o),
  note: (o) => svg(`<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H15l4 4v12.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5Z"/><path d="M8.5 11h7"/><path d="M8.5 15h4.5"/>`, o),
  receipt: (o) => svg(`<path d="M5 3.5 6.7 5l1.6-1.5L10 5l1.7-1.5L13.4 5 15 3.5 16.7 5l1.6-1.5v17L16.7 19 15 20.5 13.4 19l-1.7 1.5L10 19l-1.7 1.5L6.7 19 5 20.5Z"/><path d="M8.5 9.5h7"/><path d="M8.5 14h4"/>`, o),
  camera: (o) => svg(`<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.3-2.2A1 1 0 0 1 8.9 4.3h6.2a1 1 0 0 1 .86.5L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"/><circle cx="12" cy="13" r="3.4"/>`, o),
  cloud: (o) => svg(`<path d="M7 18.5a4.2 4.2 0 0 1-.3-8.4 5.6 5.6 0 0 1 10.8-1.3A3.9 3.9 0 0 1 17.6 18.5Z"/><path d="M12 12v6"/><path d="m9.5 14.5 2.5-2.5 2.5 2.5"/>`, o),
  check: (o) => svg(`<path d="m5 12.5 4.5 4.5L19 7.5"/>`, o),
  warning: (o) => svg(`<path d="M10.3 3.9 2.6 17.2A1.9 1.9 0 0 0 4.3 20h15.4a1.9 1.9 0 0 0 1.7-2.8L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"/><path d="M12 9v4.2"/><path d="M12 17h.01"/>`, o),
  clock: (o) => svg(`<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.3l3.2 2"/>`, o),
  download: (o) => svg(`<path d="M12 3v11"/><path d="m8 10.5 4 4 4-4"/><path d="M4.5 18.5v1A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-1"/>`, o),
  upload: (o) => svg(`<path d="M12 15V4"/><path d="m8 7.5 4-4 4 4"/><path d="M4.5 18.5v1A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-1"/>`, o),
  edit: (o) => svg(`<path d="M4 20h4.2L19 9.2a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8Z"/><path d="m14.5 6.5 3 3"/>`, o),
  copy: (o) => svg(`<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 5.5A2 2 0 0 0 13.5 3.5h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2"/>`, o),
  star: (o) => svg(`<path d="m12 3.8 2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.75-5.2 2.75 1-5.8-4.2-4.1 5.8-.85Z"/>`, o),
  book: (o) => svg(`<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5Z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19v-3"/>`, o),
};

export const icon = (name, opts) => (icons[name] ? icons[name](opts) : raw(""));
