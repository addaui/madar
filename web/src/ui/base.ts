/**
 * The looks every control shares (ADR 0069). A control's behaviour comes from Base UI; what it looks like when disabled, busy, hovered or
 * focused is decided here and in the CSS utilities (`field`, `hoverable`, `hit`, `panel` in styles/app.css), so one change reaches all of them.
 */

/** Disabled and busy, for anything pressable. Base UI sets the `data-*` attributes. */
export const interactive = "outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[pending]:cursor-progress";

/** The surface of a popup that lists choices (select, combo box, menu): one look, so they do not drift apart. */
export const popup = "z-[80] rounded-md border border-line bg-float p-1.5 shadow-float";

/** One row in such a list. */
export const popupItem = "flex cursor-pointer items-center gap-2.5 rounded-inner px-2.5 py-1.5 outline-none data-[highlighted]:bg-hover data-[selected]:font-semibold data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";

/** A control that is wrong, and the line that says how. */
export const invalid = "data-[invalid]:border-danger";
export const fieldError = "text-[12.5px] text-danger";
export const fieldHint = "text-[12.5px] text-muted-foreground";
export const fieldLabel = "text-[13px] font-medium text-text";
