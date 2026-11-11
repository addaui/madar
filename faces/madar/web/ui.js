// SPDX-License-Identifier: Apache-2.0
// Small parts every screen shares: drawn icons, avatars, a popup menu, the shortcut sheet.
// Icons are 24-unit line drawings in `currentColor`; the ones that point somewhere carry `dir` so a right-to-left
// layout mirrors them (numbers, check marks and clocks never mirror).

const ICONS = {
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  undo: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  type: '<path d="M4 7V5h16v2M12 5v14M9 19h6"/>',
  textSize: '<path d="M3 19l5-13 5 13M5 14h6M15 19l3.5-8.5L22 19M16.5 16h4"/>',
  lineHeight: '<path d="M8 6h12M8 12h12M8 18h12M4 8V4M4 16v4M2.5 5.5 4 4l1.5 1.5M2.5 18.5 4 20l1.5-1.5"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.5-1.9-.4-1.2.3-2.1 1.5-2.1h2a3 3 0 0 0 3-3C20 8 16.5 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  width: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  spacing: '<path d="M4 4h16M4 20h16M12 8v8M9 10.5 12 8l3 2.5M9 13.5 12 16l3-2.5"/>',
  fill: '<path d="M5 11l6-6 8 8-6 6a2 2 0 0 1-3 0l-5-5a2 2 0 0 1 0-3zM11 5 8 2M20 17c0 1.2-.8 2-1.5 2S17 18.2 17 17c0-1 1.5-3 1.5-3S20 16 20 17z"/>',
  opacity: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11zM12 8v12"/>',
  backdrop: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="7.5" y="8" width="9" height="8" rx="1"/>',
  shadow: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M8 20h12V8"/>',
  grid: '<path d="M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
  marginLine: '<path d="M4 4h16v16H4zM9 4v16M12.5 9H17M12.5 13H17M12.5 17H17"/>',
  rule: '<path d="M4 7h16M4 12h16M4 17h16" stroke-dasharray="0"/><path d="M4 20h16" stroke-dasharray="2 3"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  scale: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M14 10l-4 4M10 10h4v4"/>',
  pin: '<path d="M9 3h6l-1 6 3 3H7l3-3zM12 12v9"/>',
  "heading-1": '<path d="M4 12h8M4 18V6M12 18V6M17 12l3-2v8"/>',
  "heading-2": '<path d="M4 12h8M4 18V6M12 18V6M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>',
  "heading-3": '<path d="M4 12h8M4 18V6M12 18V6M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/>',
  quote: '<path d="M9 7c-2.5 0-4 1.5-4 4v6h5v-5H7.5M19 7c-2.5 0-4 1.5-4 4v6h5v-5h-2.500"/>',
  divider: '<path d="M3 12h18M7 6h.01M12 6h.01M17 6h.01M7 18h.01M12 18h.01M17 18h.01"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  "list-bullet": '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  "list-ordered": '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.500-2-1"/>',
  "list-check": '<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
  toggle: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m10 8 4 4-4 4"/>',
  callout: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 9v3M12 15.500h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  tip: '<path d="M15 14c.2-1 .7-1.700 1.500-2.500 1-.9 1.500-2.200 1.500-3.500A6 6 0 0 0 6 8c0 1 .2 2.200 1.500 3.500.7.7 1.300 1.500 1.500 2.500M9 18h6M10 22h4"/>',
  warning: '<path d="m21.700 18-8-14a2 2 0 0 0-3.500 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.700-3zM12 9v4M12 17h.01"/>',
  danger: '<path d="M7.900 2h8.200L22 7.900v8.200L16.100 22H7.900L2 16.100V7.900zM12 8v4M12 16h.01"/>',
  attachment: '<path d="m21.400 11-9.200 9.200a6 6 0 0 1-8.500-8.500l8.600-8.600A4 4 0 1 1 18 8.800l-8.600 8.600a2 2 0 0 1-2.800-2.800l8.500-8.500"/>',
  video: '<path d="M2.500 17a24.100 24.100 0 0 1 0-10 2 2 0 0 1 1.400-1.400 49.600 49.600 0 0 1 16.200 0A2 2 0 0 1 21.500 7a24.100 24.100 0 0 1 0 10 2 2 0 0 1-1.400 1.400 49.600 49.600 0 0 1-16.200 0A2 2 0 0 1 2.500 17M10 15l5-3-5-3z"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  mention: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  folderPlus: '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6H10l2 2.5h6.5A1.5 1.5 0 0 1 20 10v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M12 11.5v5M9.5 14h5"/>',
  filePlus: '<path d="M6.5 3.5h8L19 8v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-14.5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14.5 3.5V8H19M12 11.5v5M9.5 14h5"/>',
  today: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  inbox: '<path d="M4 13.5 6.2 5.9a1.5 1.5 0 0 1 1.4-1.1h8.8a1.5 1.5 0 0 1 1.4 1.1L20 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13.5h4.2l1.2 2.2h5.2l1.2-2.2H20"/>',
  pages: '<path d="M6.5 3.5h8L19 8v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-14.5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14.5 3.5V8H19M8.5 12.5h7M8.5 16h5"/>',
  page: '<path d="M6.5 3.5h8L19 8v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-14.5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14.5 3.5V8H19"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="M8.5 12.2l2.5 2.5 4.6-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="3.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  repeat: '<path d="M5 11V9.5A2.5 2.5 0 0 1 7.5 7H19M16 4l3 3-3 3M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H5M8 20l-3-3 3-3"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7M10.5 11v5M13.5 11v5"/>',
  edit: '<path d="M5 19l.8-3.8L16.4 4.6a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L8.8 18.2z"/><path d="M14.5 6.5l3 3"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  archive: '<path d="M4 6.5h16V10H4zM5.5 10v8.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V10M10 13.5h4"/>',
  focus: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  board: '<rect x="4" y="4.5" width="4.6" height="15" rx="1.6"/><rect x="9.7" y="4.5" width="4.6" height="9" rx="1.6"/><rect x="15.4" y="4.5" width="4.6" height="12" rx="1.6"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.8" cy="7" r=".9"/><circle cx="4.8" cy="12" r=".9"/><circle cx="4.8" cy="17" r=".9"/>',
  chart: '<path d="M5 20v-8M12 20V5M19 20v-5"/>',
  book: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13.5H6.5A1.5 1.5 0 0 0 5 19z"/><path d="M5 19a1.5 1.5 0 0 0 1.5 1.5H19v-3"/>',
  more: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  flag: '<path d="M6 20.5V4M6 5h11l-2.2 3.6L17 12H6"/>',
  tag: '<path d="M4 12.2V5.5A1.5 1.5 0 0 1 5.5 4h6.7l8 8-7.7 7.700z"/><circle cx="8.5" cy="8.5" r="1"/>',
  link: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="M5 17l4.5-4.500 3.500 3.500 2.500-2.500L20 17"/>',
  upload: '<path d="M12 16V5M7.5 9.5 12 5l4.500 4.500M5 19.500h14"/>',
  folder: '<path d="M4 7.5A1.5 1.5 0 0 1 5.500 6H10l2 2.500h6.500A1.500 1.500 0 0 1 20 10v8a1.500 1.500 0 0 1-1.500 1.500h-13A1.500 1.500 0 0 1 4 18z"/>',
  logout: '<path d="M9 4.500H6A1.500 1.500 0 0 0 4.500 6v12A1.500 1.500 0 0 0 6 19.500h3M14 8l4 4-4 4M18 12H9.500"/>',
  moon: '<path d="M19.500 14.500A8 8 0 0 1 9.500 4.500a8 8 0 1 0 10 10z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.500l1.300 2.100 2.400-.6.900 2.300 2.300.9-.6 2.400 2.100 1.300-2.100 1.300.6 2.400-2.300.9-.9 2.300-2.400-.6L12 20.500l-1.300-2.100-2.400.6-.9-2.300-2.300-.9.6-2.400L3.500 12l2.100-1.300-.6-2.400 2.300-.9.9-2.300 2.400.6z"/>',
  message: '<path d="M5 5.500h14A1.500 1.500 0 0 1 20.500 7v8.500A1.500 1.500 0 0 1 19 17h-7l-4.500 3.500V17H5a1.500 1.500 0 0 1-1.500-1.500V7A1.500 1.500 0 0 1 5 5.500z"/>',
  subtask: '<path d="M6 4.500v9a2 2 0 0 0 2 2h9M14 12l3 3.500-3 3.500"/>',
  download: '<path d="M12 5v11M7.500 11.500 12 16l4.500-4.500M5 19.500h14"/>',
  up: '<path d="M12 19V5M6.500 10.500 12 5l5.500 5.500"/>',
  grip: '<circle cx="9" cy="7" r="1.100" fill="currentColor"/><circle cx="15" cy="7" r="1.100" fill="currentColor"/><circle cx="9" cy="12" r="1.100" fill="currentColor"/><circle cx="15" cy="12" r="1.100" fill="currentColor"/><circle cx="9" cy="17" r="1.100" fill="currentColor"/><circle cx="15" cy="17" r="1.100" fill="currentColor"/>',
  side: '<rect x="3.500" y="5" width="17" height="14" rx="3.500"/><path d="M9.500 5v14"/>',
  help: '<circle cx="12" cy="12" r="8.500"/><path d="M9.700 9.700a2.400 2.400 0 1 1 3.400 2.200c-.7.400-1.100.800-1.100 1.600M12 16.600v.1"/>',
  move: '<path d="M5 12h14M14.500 7.500 19 12l-4.500 4.500"/>',
  alert: '<path d="M12 4.500 3.500 19h17z"/><path d="M12 10v4M12 16.700v.1"/>',
  sparkle: '<path d="M12 4l1.700 5.300L19 11l-5.300 1.700L12 18l-1.700-5.300L5 11l5.300-1.700z"/>',
  logo: '<defs><path id="halfAxis" d="M312.87 -38.40L311.35 -40.29L309.75 -42.18L308.08 -44.07L306.32 -45.96L304.49 -47.85L302.58 -49.75L300.60 -51.64L298.53 -53.53L296.39 -55.41L294.17 -57.29L291.88 -59.16L289.51 -61.03L287.07 -62.89L284.55 -64.74L281.96 -66.58L279.29 -68.41L276.56 -70.23L273.75 -72.04L270.87 -73.84L267.92 -75.62L264.90 -77.38L261.81 -79.13L258.65 -80.87L255.42 -82.58L252.13 -84.29L248.78 -85.97L245.36 -87.63L241.87 -89.27L238.32 -90.90L234.71 -92.50L231.04 -94.08L227.31 -95.64L223.53 -97.17L219.68 -98.68L215.78 -100.17L211.82 -101.64L207.80 -103.08L203.74 -104.49L199.62 -105.88L195.45 -107.24L191.22 -108.57L186.95 -109.87L182.63 -111.15L178.27 -112.40L173.86 -113.62L169.40 -114.81L164.90 -115.97L160.36 -117.10L155.77 -118.20L151.15 -119.27L146.48 -120.31L141.78 -121.32L137.05 -122.29L132.27 -123.23L127.47 -124.14L122.63 -125.02L117.76 -125.86L112.86 -126.67L107.93 -127.44L102.97 -128.18L97.98 -128.89L92.97 -129.56L87.94 -130.20L82.89 -130.80L77.81 -131.36L72.71 -131.89L67.60 -132.39L62.46 -132.85L57.31 -133.27L52.15 -133.66L46.97 -134.00L41.79 -134.32L36.59 -134.59L31.38 -134.83L26.16 -135.04L20.94 -135.20L15.71 -135.33L10.47 -135.43L5.24 -135.48L0.00 -135.50L-5.24 -135.48L-10.47 -135.43L-15.71 -135.33L-20.94 -135.20L-26.16 -135.04L-31.38 -134.83L-36.59 -134.59L-41.79 -134.32L-46.97 -134.00L-52.15 -133.66L-57.31 -133.27L-62.46 -132.85L-67.60 -132.39L-72.71 -131.89L-77.81 -131.36L-82.89 -130.80L-87.94 -130.20L-92.97 -129.56L-97.98 -128.89L-102.97 -128.18L-107.93 -127.44L-112.86 -126.67L-117.76 -125.86L-122.63 -125.02L-127.47 -124.14L-132.27 -123.23L-137.05 -122.29L-141.78 -121.32L-146.48 -120.31L-151.15 -119.27L-155.77 -118.20L-160.36 -117.10L-164.90 -115.97L-169.40 -114.81L-173.86 -113.62L-178.27 -112.40L-182.63 -111.15L-186.95 -109.87L-191.22 -108.57L-195.45 -107.24L-199.62 -105.88L-203.74 -104.49L-207.80 -103.08L-211.82 -101.64L-215.78 -100.17L-219.68 -98.68L-223.53 -97.17L-227.31 -95.64L-231.04 -94.08L-234.71 -92.50L-238.32 -90.90L-241.87 -89.27L-245.36 -87.63L-248.78 -85.97L-252.13 -84.29L-255.42 -82.58L-258.65 -80.87L-261.81 -79.13L-264.90 -77.38L-267.92 -75.62L-270.87 -73.84L-273.75 -72.04L-276.56 -70.23L-279.29 -68.41L-281.96 -66.58L-284.55 -64.74L-287.07 -62.89L-289.51 -61.03L-291.88 -59.16L-294.17 -57.29L-296.39 -55.41L-298.53 -53.53L-300.60 -51.64L-302.58 -49.75L-304.49 -47.85L-306.32 -45.96L-308.08 -44.07L-309.75 -42.18L-311.35 -40.29L-312.87 -38.40A11.20 11.20 0 0 1 -330.06 -52.78L-328.08 -54.98L-326.01 -57.16L-323.88 -59.31L-321.67 -61.44L-319.38 -63.54L-317.03 -65.61L-314.60 -67.66L-312.10 -69.68L-309.54 -71.67L-306.90 -73.64L-304.20 -75.58L-301.43 -77.50L-298.59 -79.40L-295.68 -81.26L-292.71 -83.10L-289.68 -84.92L-286.58 -86.71L-283.42 -88.48L-280.20 -90.22L-276.91 -91.93L-273.56 -93.62L-270.16 -95.28L-266.69 -96.92L-263.16 -98.53L-259.58 -100.11L-255.94 -101.67L-252.24 -103.21L-248.49 -104.71L-244.68 -106.20L-240.82 -107.65L-236.90 -109.08L-232.93 -110.48L-228.91 -111.86L-224.84 -113.20L-220.72 -114.52L-216.56 -115.82L-212.34 -117.09L-208.07 -118.33L-203.76 -119.54L-199.41 -120.72L-195.01 -121.88L-190.56 -123.01L-186.08 -124.11L-181.55 -125.19L-176.98 -126.23L-172.38 -127.25L-167.73 -128.24L-163.05 -129.20L-158.33 -130.13L-153.57 -131.04L-148.79 -131.91L-143.96 -132.76L-139.11 -133.58L-134.23 -134.37L-129.31 -135.13L-124.37 -135.86L-119.40 -136.56L-114.40 -137.23L-109.37 -137.88L-104.33 -138.49L-99.25 -139.07L-94.16 -139.63L-89.05 -140.15L-83.91 -140.65L-78.76 -141.11L-73.59 -141.55L-68.40 -141.95L-63.20 -142.33L-57.98 -142.68L-52.75 -142.99L-47.51 -143.28L-42.26 -143.54L-37.00 -143.76L-31.73 -143.96L-26.45 -144.12L-21.17 -144.26L-15.88 -144.36L-10.59 -144.44L-5.29 -144.48L0.00 -144.50L5.29 -144.48L10.59 -144.44L15.88 -144.36L21.17 -144.26L26.45 -144.12L31.73 -143.96L37.00 -143.76L42.26 -143.54L47.51 -143.28L52.75 -142.99L57.98 -142.68L63.20 -142.33L68.40 -141.95L73.59 -141.55L78.76 -141.11L83.91 -140.65L89.05 -140.15L94.16 -139.63L99.25 -139.07L104.33 -138.49L109.37 -137.88L114.40 -137.23L119.40 -136.56L124.37 -135.86L129.31 -135.13L134.23 -134.37L139.11 -133.58L143.96 -132.76L148.79 -131.91L153.57 -131.04L158.33 -130.13L163.05 -129.20L167.73 -128.24L172.38 -127.25L176.98 -126.23L181.55 -125.19L186.08 -124.11L190.56 -123.01L195.01 -121.88L199.41 -120.72L203.76 -119.54L208.07 -118.33L212.34 -117.09L216.56 -115.82L220.72 -114.52L224.84 -113.20L228.91 -111.86L232.93 -110.48L236.90 -109.08L240.82 -107.65L244.68 -106.20L248.49 -104.71L252.24 -103.21L255.94 -101.67L259.58 -100.11L263.16 -98.53L266.69 -96.92L270.16 -95.28L273.56 -93.62L276.91 -91.93L280.20 -90.22L283.42 -88.48L286.58 -86.71L289.68 -84.92L292.71 -83.10L295.68 -81.26L298.59 -79.40L301.43 -77.50L304.20 -75.58L306.90 -73.64L309.54 -71.67L312.10 -69.68L314.60 -67.66L317.03 -65.61L319.38 -63.54L321.67 -61.44L323.88 -59.31L326.01 -57.16L328.08 -54.98L330.06 -52.78A11.20 11.20 0 0 1 312.87 -38.40Z"/><path id="halfDiag" d="M326.56 -46.05L324.69 -47.85L322.74 -49.65L320.72 -51.45L318.62 -53.25L316.45 -55.04L314.21 -56.83L311.90 -58.62L309.51 -60.40L307.05 -62.17L304.52 -63.93L301.91 -65.69L299.24 -67.44L296.50 -69.17L293.69 -70.90L290.81 -72.62L287.86 -74.32L284.84 -76.01L281.76 -77.68L278.62 -79.35L275.41 -80.99L272.13 -82.62L268.79 -84.24L265.39 -85.84L261.93 -87.42L258.41 -88.98L254.82 -90.53L251.18 -92.06L247.48 -93.56L243.72 -95.05L239.91 -96.52L236.04 -97.96L232.12 -99.39L228.14 -100.79L224.11 -102.17L220.03 -103.53L215.89 -104.86L211.71 -106.17L207.48 -107.46L203.20 -108.72L198.88 -109.96L194.51 -111.17L190.09 -112.35L185.63 -113.51L181.13 -114.65L176.59 -115.75L172.00 -116.83L167.38 -117.88L162.72 -118.91L158.02 -119.90L153.28 -120.87L148.51 -121.81L143.71 -122.72L138.87 -123.60L134.00 -124.45L129.10 -125.27L124.17 -126.06L119.21 -126.82L114.22 -127.55L109.21 -128.25L104.18 -128.91L99.11 -129.55L94.03 -130.16L88.93 -130.73L83.80 -131.27L78.66 -131.78L73.49 -132.26L68.32 -132.70L63.12 -133.11L57.91 -133.49L52.69 -133.84L47.45 -134.16L42.21 -134.44L36.95 -134.69L31.69 -134.90L26.42 -135.08L21.14 -135.23L15.86 -135.35L10.58 -135.43L5.29 -135.48L0.00 -135.50L-5.29 -135.48L-10.58 -135.43L-15.86 -135.35L-21.14 -135.23L-26.42 -135.08L-31.69 -134.90L-36.95 -134.69L-42.21 -134.44L-47.45 -134.16L-52.69 -133.84L-57.91 -133.49L-63.12 -133.11L-68.32 -132.70L-73.49 -132.26L-78.66 -131.78L-83.80 -131.27L-88.93 -130.73L-94.03 -130.16L-99.11 -129.55L-104.18 -128.91L-109.21 -128.25L-114.22 -127.55L-119.21 -126.82L-124.17 -126.06L-129.10 -125.27L-134.00 -124.45L-138.87 -123.60L-143.71 -122.72L-148.51 -121.81L-153.28 -120.87L-158.02 -119.90L-162.72 -118.91L-167.38 -117.88L-172.00 -116.83L-176.59 -115.75L-181.13 -114.65L-185.63 -113.51L-190.09 -112.35L-194.51 -111.17L-198.88 -109.96L-203.20 -108.72L-207.48 -107.46L-211.71 -106.17L-215.89 -104.86L-220.03 -103.53L-224.11 -102.17L-228.14 -100.79L-232.12 -99.39L-236.04 -97.96L-239.91 -96.52L-243.72 -95.05L-247.48 -93.56L-251.18 -92.06L-254.82 -90.53L-258.41 -88.98L-261.93 -87.42L-265.39 -85.84L-268.79 -84.24L-272.13 -82.62L-275.41 -80.99L-278.62 -79.35L-281.76 -77.68L-284.84 -76.01L-287.86 -74.32L-290.81 -72.62L-293.69 -70.90L-296.50 -69.17L-299.24 -67.44L-301.91 -65.69L-304.52 -63.93L-307.05 -62.17L-309.51 -60.40L-311.90 -58.62L-314.21 -56.83L-316.45 -55.04L-318.62 -53.25L-320.72 -51.45L-322.74 -49.65L-324.69 -47.85L-326.56 -46.05A10.88 10.88 0 0 1 -341.33 -62.03L-339.03 -64.01L-336.65 -65.97L-334.22 -67.90L-331.71 -69.81L-329.14 -71.69L-326.50 -73.55L-323.80 -75.39L-321.03 -77.21L-318.20 -79.00L-315.30 -80.77L-312.35 -82.52L-309.33 -84.24L-306.25 -85.94L-303.10 -87.62L-299.90 -89.28L-296.64 -90.91L-293.32 -92.53L-289.94 -94.11L-286.51 -95.68L-283.01 -97.22L-279.46 -98.74L-275.86 -100.24L-272.20 -101.71L-268.48 -103.16L-264.71 -104.59L-260.89 -105.99L-257.02 -107.37L-253.09 -108.73L-249.12 -110.06L-245.09 -111.37L-241.02 -112.66L-236.89 -113.92L-232.72 -115.15L-228.51 -116.37L-224.24 -117.56L-219.94 -118.72L-215.58 -119.86L-211.19 -120.98L-206.75 -122.07L-202.27 -123.13L-197.75 -124.17L-193.19 -125.19L-188.59 -126.18L-183.95 -127.15L-179.28 -128.09L-174.57 -129.00L-169.82 -129.89L-165.04 -130.76L-160.23 -131.59L-155.38 -132.41L-150.51 -133.19L-145.60 -133.96L-140.66 -134.69L-135.70 -135.40L-130.71 -136.08L-125.69 -136.74L-120.64 -137.37L-115.57 -137.97L-110.48 -138.55L-105.37 -139.10L-100.23 -139.63L-95.07 -140.12L-89.90 -140.60L-84.71 -141.04L-79.50 -141.46L-74.27 -141.85L-69.03 -142.21L-63.77 -142.55L-58.50 -142.86L-53.22 -143.15L-47.93 -143.40L-42.63 -143.63L-37.32 -143.84L-32.00 -144.01L-26.68 -144.16L-21.35 -144.28L-16.02 -144.38L-10.68 -144.45L-5.34 -144.49L0.00 -144.50L5.34 -144.49L10.68 -144.45L16.02 -144.38L21.35 -144.28L26.68 -144.16L32.00 -144.01L37.32 -143.84L42.63 -143.63L47.93 -143.40L53.22 -143.15L58.50 -142.86L63.77 -142.55L69.03 -142.21L74.27 -141.85L79.50 -141.46L84.71 -141.04L89.90 -140.60L95.07 -140.12L100.23 -139.63L105.37 -139.10L110.48 -138.55L115.57 -137.97L120.64 -137.37L125.69 -136.74L130.71 -136.08L135.70 -135.40L140.66 -134.69L145.60 -133.96L150.51 -133.19L155.38 -132.41L160.23 -131.59L165.04 -130.76L169.82 -129.89L174.57 -129.00L179.28 -128.09L183.95 -127.15L188.59 -126.18L193.19 -125.19L197.75 -124.17L202.27 -123.13L206.75 -122.07L211.19 -120.98L215.58 -119.86L219.94 -118.72L224.24 -117.56L228.51 -116.37L232.72 -115.15L236.89 -113.92L241.02 -112.66L245.09 -111.37L249.12 -110.06L253.09 -108.73L257.02 -107.37L260.89 -105.99L264.71 -104.59L268.48 -103.16L272.20 -101.71L275.86 -100.24L279.46 -98.74L283.01 -97.22L286.51 -95.68L289.94 -94.11L293.32 -92.53L296.64 -90.91L299.90 -89.28L303.10 -87.62L306.25 -85.94L309.33 -84.24L312.35 -82.52L315.30 -80.77L318.20 -79.00L321.03 -77.21L323.80 -75.39L326.50 -73.55L329.14 -71.69L331.71 -69.81L334.22 -67.90L336.65 -65.97L339.03 -64.01L341.33 -62.03A10.88 10.88 0 0 1 326.56 -46.05Z"/><g id="orbitAxis"><use href="#halfAxis"/><use href="#halfAxis" transform="scale(1,-1)"/></g><g id="orbitDiag"><use href="#halfDiag"/><use href="#halfDiag" transform="scale(1,-1)"/></g></defs><g transform="translate(12 12) scale(0.0234375)"><g fill="currentColor" stroke="none"><use href="#orbitDiag" transform="rotate(45)"/><use href="#orbitDiag" transform="rotate(-45)"/><use href="#orbitAxis"/><use href="#orbitAxis" transform="rotate(90)"/><circle r="42"/><circle cx="340" cy="0" r="26"/><circle cx="-340" cy="0" r="26"/><circle cx="0" cy="340" r="26"/><circle cx="0" cy="-340" r="26"/><circle cx="256" cy="256" r="38"/><circle cx="-256" cy="256" r="38"/><circle cx="256" cy="-256" r="38"/><circle cx="-256" cy="-256" r="38"/></g></g>',
};
// Pointing icons flip in right-to-left; the rest do not.
const MIRROR = new Set(["chevron", "move", "logout", "subtask", "side"]);
function ico(name, cls) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
  s.setAttribute("class", "ico" + (MIRROR.has(name) ? " mirror" : "") + (cls ? " " + cls : ""));
  s.innerHTML = ICONS[name] || "";
  return s;
}
// A button that is only an icon always has a name for screen readers and a tooltip.
function iconBtn(name, label, onclick, extra = {}) {
  return h("button", { class: "icon-btn" + (extra.class ? " " + extra.class : ""), type: "button", title: label, "aria-label": label, onclick, ...(extra.attrs || {}) }, ico(name));
}
function btn(label, { icon, kind, onclick, title, type } = {}) {
  return h("button", { class: "btn" + (kind ? " " + kind : ""), type: type || "button", title: title || null, onclick }, icon ? ico(icon) : null, label ? h("span", {}, label) : null);
}

// ---------- people ----------
function hueOf(s) { let n = 0; for (const c of String(s || "?")) n = (n * 31 + c.codePointAt(0)) >>> 0; return n % 360; }
function initials(s) { const w = String(s || "?").trim().split(/[\s._-]+/).filter(Boolean); return ((w[0] || "?")[0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase(); }
function avatar(subject, display, size) {
  const name = display || subject || "?", mine = S.who && subject === S.who.subject && S.prefs && S.prefs.avatar_color;
  const e = h("span", { class: "avatar" + (size ? " " + size : ""), title: name, "data-h": String(hueOf(subject)) }, h("bdi", {}, initials(name)));
  e.style.setProperty("--ah", String(hueOf(subject)));
  if (mine) e.style.setProperty("--avatar-own", S.prefs.avatar_color);
  return e;
}
function avatarStack(list, max = 4) {
  const shown = list.slice(0, max), more = list.length - shown.length;
  return h("span", { class: "avatars" }, ...shown.map((m) => avatar(m.subject, m.display)), more > 0 ? h("span", { class: "avatar more" }, "+" + more) : null);
}

// ---------- the popup menu ----------
// items: [{label, icon, onclick, danger, disabled, checked, sub}] or "-" for a rule or {heading}. Opens next to `anchor`, flips to stay on screen.
// `sub: () => items` makes a row that opens a second level in the same menu (a Back row returns), which works with a finger too.
// A context menu opens at a point: pass pointAnchor(x, y).
function pointAnchor(x, y) { return { point: true, getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }), contains: () => false, focus() {}, setAttribute() {}, removeAttribute() {} }; }
function openMenu(anchor, items, { align = "end" } = {}) {
  closeMenu();
  const menu = h("div", { class: "menu", role: "menu" }), stack = [], rtl = document.documentElement.dir === "rtl";
  const place = () => {
    const r = anchor.getBoundingClientRect(), m = menu.getBoundingClientRect();
    let x, y;
    if (anchor.point) { x = r.left; y = r.top; if (rtl) x -= m.width; }
    else { const endEdge = align === "end" ? (rtl ? r.left : r.right) : (rtl ? r.right : r.left); x = (align === "end") !== rtl ? endEdge - m.width : endEdge; y = r.bottom + 6; if (y + m.height > innerHeight - 8) y = Math.max(8, r.top - m.height - 6); }
    x = Math.max(8, Math.min(innerWidth - m.width - 8, x)); y = Math.max(8, Math.min(innerHeight - m.height - 8, y));
    menu.style.left = x + "px"; menu.style.top = y + "px";
  };
  const render = (rows) => {
    menu.replaceChildren();
    for (const it of rows.filter(Boolean)) {
      if (it.heading) { menu.append(h("div", { class: "menu-head" }, it.heading)); continue; }
      if (it === "-") { menu.append(h("div", { class: "menu-rule", role: "separator" })); continue; }
      menu.append(h("button", { class: "menu-item" + (it.danger ? " danger" : ""), role: it.checked !== undefined ? "menuitemradio" : "menuitem", "aria-checked": it.checked !== undefined ? String(!!it.checked) : null, "aria-haspopup": it.sub ? "menu" : null, disabled: !!it.disabled, type: "button",
        onclick: () => {
          if (it.sub) { stack.push(rows); render([{ label: (rtl ? "→ " : "← ") + it.label, keep: true, onclick: () => { render(stack.pop()); place(); focusFirst(); } }, "-", ...it.sub()]); place(); focusFirst(); return; }
          if (it.keep) { it.onclick && it.onclick(); return; }
          closeMenu(); it.onclick && it.onclick();
        } },
        it.icon ? ico(it.icon) : h("span", { class: "ico-gap" }), h("span", { class: "grow" }, it.label), it.checked ? ico("check", "tick") : null, it.sub ? ico("chevron", "sub-caret") : null));
    }
  };
  const focusFirst = () => { const first = menu.querySelector(".menu-item:not(:disabled)"); if (first) first.focus(); };
  render(items);
  document.body.append(menu);
  place();
  const focusables = () => [...menu.querySelectorAll(".menu-item:not(:disabled)")];
  const onKey = (e) => {
    const f = focusables(), i = f.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); anchor.focus && anchor.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); (f[i + 1] || f[0]).focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (f[i - 1] || f[f.length - 1]).focus(); }
    else if (e.key === "Tab") closeMenu();
  };
  const onDown = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  document.addEventListener("keydown", onKey, true); document.addEventListener("mousedown", onDown, true); document.addEventListener("touchstart", onDown, true);
  openMenu.cur = { menu, off: () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("mousedown", onDown, true); document.removeEventListener("touchstart", onDown, true); } };
  anchor.setAttribute("aria-expanded", "true");
  focusFirst();
  openMenu.anchor = anchor;
}
function closeMenu() {
  const c = openMenu.cur; if (!c) return;
  c.off(); c.menu.remove(); openMenu.cur = null;
  if (openMenu.anchor) { openMenu.anchor.removeAttribute("aria-expanded"); openMenu.anchor = null; }
}
// Right click, a long press, or the Menu key opens a context menu built from the same items as the row's ⋯ button.
// Shift + right click keeps the browser's own menu. `items` is a function, called when the menu opens.
function bindContext(el, items, { stop = true } = {}) {
  let timer, at = { x: 0, y: 0 }, fired = 0;
  const open = (x, y) => { const list = items(); if (list && list.length) openMenu(pointAnchor(x, y), list); };
  el.addEventListener("contextmenu", (e) => {
    if (e.shiftKey || e.target.closest("input, textarea, select, [contenteditable='true'], .madar-editor")) return;
    e.preventDefault(); if (stop) e.stopPropagation();
    if (Date.now() - fired < 900) return;
    open(e.clientX, e.clientY);
  });
  el.addEventListener("keydown", (e) => { if (e.target === el && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) { e.preventDefault(); const r = el.getBoundingClientRect(); open(r.left + 24, r.top + r.height / 2); } });
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || e.target.closest("input, textarea, select, .madar-editor")) return;
    at = { x: e.clientX, y: e.clientY }; timer = setTimeout(() => { fired = Date.now(); open(at.x, at.y); }, 450);
  });
  const stopTimer = () => clearTimeout(timer);
  el.addEventListener("pointermove", (e) => { if (timer && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 10) stopTimer(); });
  el.addEventListener("pointerup", stopTimer); el.addEventListener("pointercancel", stopTimer);
  el.classList.add("has-context");
}
function menuBtn(label, itemsFn, icon = "more") {
  const b = iconBtn(icon, label, (e) => { e.stopPropagation(); openMenu(b, itemsFn()); }, { attrs: { "aria-haspopup": "menu" } });
  return b;
}

// ---------- keyboard help ----------
function openShortcuts() {
  const rows = [["/  ·  Ctrl K", t("kSearch")], ["N", t("kNewTask")], ["Esc", t("kClose")], ["Ctrl \\", t("focusMode")], ["?", t("kHelp")]];
  openModal(t("kHelp"), h("div", { class: "kbd-list" }, ...rows.map(([k, d]) => h("div", { class: "kbd-row" }, h("span", { class: "grow" }, d), h("span", { class: "kbd-keys", dir: "ltr" }, ...k.split("  ·  ").map((x) => h("kbd", {}, x)))))));
}

// ---------- readable identifiers (ADR 0029): MDR-12 for a task, MDR-P3 for a page ----------
Object.assign(STR.en, { copyId: "Copy ID", copied: "Copied", markDone: "Mark done", reopen: "Reopen", changeKey: "Change project key…", keyLabel: "Project key (2–6 capital letters or digits)", tabDetails: "Details", tabActivity: "Activity" });
Object.assign(STR.ar, { copyId: "نسخ المعرّف", copied: "تم النسخ", markDone: "إنهاء", reopen: "إعادة فتح", changeKey: "تغيير مفتاح المشروع…", keyLabel: "مفتاح المشروع (٢–٦ أحرف لاتينية كبيرة أو أرقام)", tabDetails: "التفاصيل", tabActivity: "النشاط" });
const projectKeyOf = (projectId) => { const p = (S.projects || []).find((x) => x.id === projectId) || (S.project && S.project.id === projectId ? S.project : null); return p && p.key ? p.key : null; };
const taskCode = (task) => { const k = projectKeyOf(task.project); return k && task.number ? k + "-" + task.number : null; };
const pageCode = (pg) => { const k = pg.project ? projectKeyOf(pg.project) : null; return k && pg.number ? k + "-P" + pg.number : null; };
async function copyText(text) { try { await navigator.clipboard.writeText(text); toast(t("copied") + ": " + text); } catch (e) { toast(text); } }
/** The code as a small button that copies it. Cards show it only when the theme's "mono IDs" element is on. */
function codeChip(code, always) {
  if (!code) return null;
  return h("button", { type: "button", class: "id" + (always ? " always" : ""), dir: "ltr", title: t("copyId"), "aria-label": t("copyId") + ": " + code, onclick: (e) => { e.stopPropagation(); copyText(code); } }, code);
}

// ---------- a popover: any content next to an anchor, closed by a click outside or Escape ----------
function closePopover() { const c = openPopover.cur; if (!c) return; c.off(); c.box.remove(); openPopover.cur = null; }
function openPopover(anchor, content, { cls = "", align = "start", onClose } = {}) {
  closePopover(); closeMenu();
  const box = h("div", { class: "popover " + cls, role: "dialog" }, content), rtl = document.documentElement.dir === "rtl";
  document.body.append(box);
  const place = () => {
    const r = anchor.getBoundingClientRect(), m = box.getBoundingClientRect();
    let x = (align === "start") !== rtl ? r.left : r.right - m.width, y = r.bottom + 6;
    if (y + m.height > innerHeight - 8) y = Math.max(8, r.top - m.height - 6);
    box.style.left = Math.max(8, Math.min(innerWidth - m.width - 8, x)) + "px"; box.style.top = y + "px";
  };
  place();
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); if (anchor.focus) anchor.focus(); } };
  const onDown = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) close(); };
  document.addEventListener("keydown", onKey, true); document.addEventListener("mousedown", onDown, true);
  const close = () => { closePopover(); if (onClose) onClose(); };
  openPopover.cur = { box, off: () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("mousedown", onDown, true); } };
  return { close, place, box };
}

// ---------- emoji sets (the `emoji` plugin): the picture set that shows the emoji ----------
const EMOJI_RANGE = "U+00A9,U+00AE,U+203C,U+2049,U+2122,U+2139,U+2194-21AA,U+231A-23FF,U+24C2,U+25AA-25FE,U+2600-27BF,U+2934,U+2935,U+2B05-2B55,U+3030,U+303D,U+3297,U+3299,U+FE0F,U+200D,U+20E3,U+1F000-1FAFF";
S.emojiSets = [];
/** Applies the chosen set: a font set puts the family in front of the text fonts (for emoji code points only); an images set is used by `emo`.
 *  A font a plugin ships (`asset`) is fetched through the Core; any other family is the device's own (`local`). */
function applyEmojiSet() {
  const id = (S.prefs && S.prefs["emoji.set"]) || "system", set = S.emojiSets.find((x) => x.id === id), root = document.documentElement.style;
  if (applyEmojiSet.face) { try { document.fonts.delete(applyEmojiSet.face); } catch (e) { /* gone */ } applyEmojiSet.face = null; }
  S.emojiUrl = set && set.kind === "images" && set.url ? set.url : null;
  const apply = (face) => { applyEmojiSet.face = face; document.fonts.add(face); return face.load().then(() => root.setProperty("--emoji-first", '"MadarEmoji"')); };
  if (set && set.kind === "font" && set.asset && window.FontFace) {
    const mine = ++applyEmojiSet.seq;
    call("emoji.asset", { id: set.asset }).then((a) => { if (mine !== applyEmojiSet.seq) return; const bin = atob(a.data), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i); return apply(new FontFace("MadarEmoji", buf.buffer, { unicodeRange: EMOJI_RANGE })); }).catch(() => root.removeProperty("--emoji-first"));
  } else if (set && set.kind === "font" && set.family && window.FontFace) {
    applyEmojiSet.seq++;
    apply(new FontFace("MadarEmoji", 'local("' + set.family.replace(/"/g, "") + '")', { unicodeRange: EMOJI_RANGE })).catch(() => root.removeProperty("--emoji-first")); // not on this device: the device's own emoji stay
  } else { applyEmojiSet.seq++; root.removeProperty("--emoji-first"); }
}
applyEmojiSet.seq = 0;
const emojiCode = (ch) => Array.from(ch).map((c) => c.codePointAt(0).toString(16)).filter((x) => x !== "fe0f").join("-");
/** An emoji as an element, drawn by the chosen set. */
function emo(ch, cls) {
  if (S.emojiUrl) return h("img", { class: "emo-img" + (cls ? " " + cls : ""), src: S.emojiUrl.replace("{code}", emojiCode(ch)), alt: ch, draggable: false, loading: "lazy" });
  return h("span", { class: "emo" + (cls ? " " + cls : "") }, ch);
}
const PAGE_EMOJI_DEFAULT = "📄", FOLDER_EMOJI_DEFAULT = "📁";
