import { icons } from "../../ui/icons";

/** A plain square for a name this app's icons do not have: plugins name icons without knowing the host's set. */
const PLAIN = "<rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"3\"/>";

/** The icon a plugin names for its element (slash menu, Element tab), drawn as this app draws its own. */
export function elementIcon(name: string): Node {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.8"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false"); s.setAttribute("class", "ico");
  s.innerHTML = (icons as Record<string, string>)[name] ?? PLAIN;
  return s;
}
