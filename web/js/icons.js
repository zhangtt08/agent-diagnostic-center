const S = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICONS = {
  grid: S('<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>'),
  records: S('<path d="M8 3h8l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M9 12h6M9 16h4"/>'),
  alert: S('<path d="M12 3l9 16H3z"/><path d="M12 9v5M12 17h.01"/>'),
  trace: S('<path d="M4 7h5M15 7h5M4 17h5M15 17h5"/><circle cx="12" cy="7" r="2.4"/><circle cx="12" cy="17" r="2.4"/><path d="M12 9.4v5.2"/>'),
  book: S('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5v15"/>'),
  wrench: S('<path d="M14.7 6.3a4 4 0 0 0 5 5L19 21l-8.5-8.5a4 4 0 0 1 4.2-6.2z"/><path d="M6 6l3 3-2 2-3-3z"/>'),
  gear: S('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M4.6 4.6l1.9 1.9M17.5 17.5l1.9 1.9M2.8 12h2.6M18.6 12h2.6M4.6 19.4l1.9-1.9M17.5 6.5l1.9-1.9"/>'),
  search: S('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  bell: S('<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 19a2 2 0 0 0 4 0"/>'),
  play: S('<path d="M5 12l14-7 7 14z" transform="translate(-2 0) scale(0.86)"/><path d="M6 4l14 8-14 8z"/>'),
  clock: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>'),
  layers: S('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  gauge: S('<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4.2-6"/>'),
  spark: S('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),
  user: S('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>'),
  plan: S('<rect x="3.5" y="4" width="17" height="16" rx="2.4"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
  tool: S('<path d="M13.5 6.5a4.2 4.2 0 0 1 5.6 5.6l-8.1 8.1a2.6 2.6 0 0 1-3.7-3.7z"/><path d="M6 6l2.5 2.5"/>'),
  brain: S('<path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.4A3 3 0 0 0 7 19a3 3 0 0 0 5 1.2V4.9A3 3 0 0 0 9 4.5z"/><path d="M15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.4A3 3 0 0 1 17 19a3 3 0 0 1-5 1.2"/>'),
  doc: S('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
  arrow: S('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  arrowRight: S('<path d="M9 6l6 6-6 6"/>'),
  check: S('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.6L16 9.6"/>'),
  shield: S('<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  chart: S('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  refresh: S('<path d="M20 11a8 8 0 1 0-2.3 6.1"/><path d="M20 5v6h-6"/>'),
  bulb: S('<path d="M9.5 18h5M10 21h4"/><path d="M12 3a6 6 0 0 1 3.6 10.8V16H8.4v-2.2A6 6 0 0 1 12 3z"/>'),
  folder: S('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2.5h7.4A2.5 2.5 0 0 1 21 10v7.5A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>'),
  upload: S('<path d="M12 16V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>'),
  cal: S('<rect x="3.5" y="5" width="17" height="15" rx="2.2"/><path d="M3.5 10h17M8 3.5V7M16 3.5V7"/>'),
};

export function icon(name, cls = '') {
  const svg = ICONS[name] ?? ICONS.doc;
  return svg.replace('<svg ', `<svg class="ic ${cls}" `);
}
