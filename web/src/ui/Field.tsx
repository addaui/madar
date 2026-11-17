import type { ReactNode } from "react";
import { useId, useState, type FocusEvent, type KeyboardEvent } from "react";
import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { FieldError as AriaFieldError, Label, Text, type FieldErrorProps } from "react-aria-components";
import { cn } from "../lib/cn";
import { fieldError, fieldHint, fieldLabel, invalid } from "./base";
import { Icon } from "./Icon";

/**
 * What every text-like field is made of (ADR 0069): a name (visible, or only for assistive technology), an optional hint and error line, and the
 * `field` look from the stylesheet. `label` is always required, so no field is ever unnamed.
 */
export interface FieldFrameProps {
  label: string;
  /** Show the label above the field. Without it the label is only for assistive technology. */
  showLabel?: boolean;
  description?: string;
  errorMessage?: FieldErrorProps["children"];
  className?: string;
}

/** The label, hint and error around one control. The control itself is `children`. */
export function FieldFrame({ label, showLabel, description, errorMessage, children }: FieldFrameProps & { children: ReactNode }) {
  return (
    <>
      <Label className={showLabel ? fieldLabel : "sr-only"}>{label}</Label>
      {children}
      {description && <Text slot="description" className={fieldHint}>{description}</Text>}
      <AriaFieldError className={fieldError}>{errorMessage}</AriaFieldError>
    </>
  );
}

interface TextProps extends FieldFrameProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFocus?: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  name?: string;
  placeholder?: string;
  type?: "text" | "url" | "email" | "password" | "search" | "tel";
  maxLength?: number;
  dir?: "auto" | "ltr" | "rtl";
  autoFocus?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "url" | "numeric" | "email" | "search";
  spellCheck?: boolean;
  isRequired?: boolean;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  inputClassName?: string;
  /** No box: the text sits in the surface around it (a title edited in place). */
  bare?: boolean;
}

/** The label, the hint and the error line around one plain control, tied to it for assistive technology. */
function Plain({ id, label, showLabel, description, errorMessage, className, children }: FieldFrameProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn("grid gap-1", className)}>
      <label htmlFor={id} className={showLabel ? fieldLabel : "sr-only"}>{label}</label>
      {children}
      {description && <p id={`${id}-hint`} className={cn("m-0", fieldHint)}>{description}</p>}
      {errorMessage && <p id={`${id}-error`} role="alert" className={cn("m-0", fieldError)}>{errorMessage as ReactNode}</p>}
    </div>
  );
}

const common = (id: string, p: Pick<TextProps, "description" | "errorMessage" | "isRequired" | "isDisabled" | "isReadOnly">) => ({
  id,
  required: p.isRequired,
  disabled: p.isDisabled,
  readOnly: p.isReadOnly,
  "aria-invalid": p.errorMessage ? true : undefined,
  "aria-describedby": [p.description && `${id}-hint`, p.errorMessage && `${id}-error`].filter(Boolean).join(" ") || undefined,
});

/** A line of text. */
export function TextField({ label, showLabel, description, errorMessage, className, inputClassName, bare, placeholder, dir, maxLength, spellCheck, inputMode, onChange, isRequired, isDisabled, isReadOnly, type, ...rest }: TextProps) {
  const id = useId();
  return (
    <Plain id={id} label={label} showLabel={showLabel} description={description} errorMessage={errorMessage} className={className}>
      <input {...common(id, { description, errorMessage, isRequired, isDisabled, isReadOnly })} type={type ?? "text"} className={cn(bare ? "w-full min-w-0 border-0 bg-transparent p-0 outline-none" : "field w-full", invalid, "aria-invalid:border-danger", inputClassName)} placeholder={placeholder} dir={dir} maxLength={maxLength} spellCheck={spellCheck} inputMode={inputMode} onChange={(e) => onChange?.(e.target.value)} {...rest} />
    </Plain>
  );
}

/** Several lines of text. */
export function TextArea({ label, showLabel, description, errorMessage, className, inputClassName, placeholder, dir, maxLength, rows, spellCheck, onChange, isRequired, isDisabled, isReadOnly, ...rest }: Omit<TextProps, "inputMode" | "type"> & { rows?: number }) {
  const id = useId();
  return (
    <Plain id={id} label={label} showLabel={showLabel} description={description} errorMessage={errorMessage} className={className}>
      <textarea {...common(id, { description, errorMessage, isRequired, isDisabled, isReadOnly })} className={cn("field w-full resize-y", invalid, "aria-invalid:border-danger", inputClassName)} placeholder={placeholder} dir={dir} maxLength={maxLength} rows={rows} spellCheck={spellCheck} onChange={(e) => onChange?.(e.target.value)} {...rest} />
    </Plain>
  );
}

/** A field that searches, with a button that clears it. Enter submits. */
export function SearchField({ label, showLabel, className, inputClassName, placeholder, autoFocus, value, defaultValue, onChange, onSubmit, onKeyDown, maxLength, dir, isDisabled }: Omit<TextProps, "type"> & { onSubmit?: (value: string) => void }) {
  const id = useId();
  const [own, setOwn] = useState(defaultValue ?? "");
  const text = value ?? own;
  const set = (v: string) => { if (value === undefined) setOwn(v); onChange?.(v); };
  return (
    <div className={cn("group relative grid gap-1", className)}>
      <label htmlFor={id} className={showLabel ? fieldLabel : "sr-only"}>{label}</label>
      <span className="relative block">
        <Icon name="search" className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input id={id} type="search" role="searchbox" value={text} autoFocus={autoFocus} disabled={isDisabled} className={cn("field w-full ps-8 pe-8 [&::-webkit-search-cancel-button]:hidden", inputClassName)} placeholder={placeholder} maxLength={maxLength} dir={dir} autoComplete="off" onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSubmit?.(text); else if (e.key === "Escape" && text) { set(""); e.preventDefault(); } onKeyDown?.(e); }} />
        {text !== "" && !isDisabled && (
          <button type="button" aria-label="×" tabIndex={-1} onClick={() => set("")} className="absolute end-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground outline-none hoverable hover:text-text">
            <Icon name="close" className="size-3.5" />
          </button>
        )}
      </span>
    </div>
  );
}

/** A number, typed or stepped with the arrow keys. */
export function NumberField({ label, showLabel, className, inputClassName, value, defaultValue, onChange, name, minValue, maxValue, step, isDisabled, onBlur }: Omit<TextProps, "value" | "defaultValue" | "onChange" | "type"> & { value?: number; defaultValue?: number; onChange?: (value: number) => void; minValue?: number; maxValue?: number; step?: number }) {
  const id = useId();
  return (
    <NumberFieldPrimitive.Root className={cn("grid gap-1", className)} value={value} defaultValue={defaultValue} onValueChange={(v) => onChange?.(v ?? Number.NaN)} name={name} min={minValue} max={maxValue} step={step} disabled={isDisabled}>
      <label htmlFor={id} className={showLabel ? fieldLabel : "sr-only"}>{label}</label>
      <NumberFieldPrimitive.Input id={id} onBlur={onBlur as never} className={cn("field w-full tabular-nums", invalid, inputClassName)} />
    </NumberFieldPrimitive.Root>
  );
}
