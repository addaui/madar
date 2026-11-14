import type { ReactNode } from "react";

/**
 * The stickers made for Madar: simple shapes drawn here, so there is no licence to carry. Each is a 100 by 100 drawing; a page keeps only the id.
 * Colours are fixed on purpose (a sticker looks the same on every theme, in light and dark).
 */
const S = (children: ReactNode) => <svg viewBox="0 0 100 100" className="size-full" aria-hidden="true" focusable="false">{children}</svg>;
const line = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const PACK: { id: string; label: string; draw: () => ReactNode }[] = [
  { id: "star", label: "Star", draw: () => S(<path d="M50 8l12.2 25.4 27.8 3.6-20.4 19.3 5.2 27.6L50 70.2 25.2 83.9l5.2-27.6L10 37l27.8-3.6z" fill="#FFC83D" stroke="#E0A100" strokeWidth="4" {...line} />) },
  { id: "heart", label: "Heart", draw: () => S(<path d="M50 88S10 62 10 34c0-13 10-22 22-22 8 0 14 4 18 11 4-7 10-11 18-11 12 0 22 9 22 22 0 28-40 54-40 54z" fill="#FF5A6E" stroke="#D93550" strokeWidth="4" {...line} />) },
  { id: "sparkle", label: "Sparkle", draw: () => S(<><path d="M50 8c3 24 8 31 32 34-24 3-29 10-32 34-3-24-8-31-32-34 24-3 29-10 32-34z" fill="#8F7CFF" stroke="#6552E0" strokeWidth="4" {...line} /><path d="M82 66c1 8 3 10 10 11-7 1-9 3-10 11-1-8-3-10-10-11 7-1 9-3 10-11z" fill="#8F7CFF" /></>) },
  { id: "check", label: "Check", draw: () => S(<><circle cx="50" cy="50" r="40" fill="#34C77B" stroke="#1E9C5C" strokeWidth="4" /><path d="M30 52l14 14 27-30" fill="none" stroke="#fff" strokeWidth="9" {...line} /></>) },
  { id: "exclaim", label: "Exclamation", draw: () => S(<><circle cx="50" cy="50" r="40" fill="#FF8A3D" stroke="#D96B1E" strokeWidth="4" /><path d="M50 26v32" stroke="#fff" strokeWidth="9" {...line} /><circle cx="50" cy="73" r="5.5" fill="#fff" /></>) },
  { id: "question", label: "Question", draw: () => S(<><circle cx="50" cy="50" r="40" fill="#3D9BFF" stroke="#1E78D9" strokeWidth="4" /><path d="M36 38c0-8 6-13 14-13s14 5 14 12c0 10-14 11-14 22" fill="none" stroke="#fff" strokeWidth="8" {...line} /><circle cx="50" cy="75" r="5.5" fill="#fff" /></>) },
  { id: "bubble", label: "Speech bubble", draw: () => S(<path d="M16 16h68a8 8 0 0 1 8 8v38a8 8 0 0 1-8 8H50L32 88V70H16a8 8 0 0 1-8-8V24a8 8 0 0 1 8-8z" fill="#fff" stroke="#3A3A4A" strokeWidth="4" {...line} />) },
  { id: "arrow", label: "Arrow", draw: () => S(<path d="M14 62C30 30 56 24 80 38M80 38L62 36M80 38L74 54" fill="none" stroke="#E5484D" strokeWidth="8" {...line} />) },
  { id: "circle", label: "Circled", draw: () => S(<path d="M52 12C28 10 10 28 12 52c2 24 24 38 46 34 24-4 32-26 28-46C82 22 66 12 44 16" fill="none" stroke="#E5484D" strokeWidth="6" {...line} />) },
  { id: "underline", label: "Underline", draw: () => S(<path d="M8 58c10-8 14 8 24 0s14 8 24 0 14 8 24 0 8 4 12 0" fill="none" stroke="#FFB000" strokeWidth="7" {...line} />) },
  { id: "tape", label: "Tape", draw: () => S(<path d="M8 32l6 4-6 4 6 4-6 4 6 4-6 4v0h84l-6-4 6-4-6-4 6-4-6-4 6-4z" transform="translate(0 -4)" fill="#F7D774" fillOpacity=".85" stroke="#D9B13E" strokeWidth="2.5" {...line} />) },
  { id: "burst", label: "Burst", draw: () => S(<path d="M50 6l9 17 19-6-4 19 19 6-16 12 12 16-19 1 1 19-17-9-11 16-11-16-17 9 1-19-19-1 12-16L6 36l19-6-4-19 19 6z" fill="#FF4D8D" stroke="#C72A68" strokeWidth="4" {...line} />) },
  { id: "pin", label: "Pin", draw: () => S(<><circle cx="50" cy="36" r="24" fill="#E5484D" stroke="#B82E33" strokeWidth="4" /><circle cx="42" cy="28" r="6" fill="#fff" fillOpacity=".6" /><path d="M50 60v32" stroke="#6B6B78" strokeWidth="6" {...line} /></>) },
];
export const PACK_IDS = new Set(PACK.map((p) => p.id));
