import type { ReactNode } from "react";
import {
  Button as AriaButton, FieldError as AriaFieldError, Input, Label, NumberField as AriaNumberField, SearchField as AriaSearchField, Text,
  TextArea as AriaTextArea, TextField as AriaTextField, type FieldErrorProps, type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components";
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
  onBlur?: AriaTextFieldProps["onBlur"];
  onFocus?: AriaTextFieldProps["onFocus"];
  onKeyDown?: AriaTextFieldProps["onKeyDown"];
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

/** A line of text. */
export function TextField({ label, showLabel, description, errorMessage, className, inputClassName, bare, placeholder, dir, maxLength, spellCheck, inputMode, ...rest }: TextProps) {
  return (
    <AriaTextField className={cn("grid gap-1", className)} {...rest}>
      <FieldFrame label={label} showLabel={showLabel} description={description} errorMessage={errorMessage}>
        <Input className={cn(bare ? "w-full min-w-0 border-0 bg-transparent p-0 outline-none" : "field w-full", invalid, inputClassName)} placeholder={placeholder} dir={dir} maxLength={maxLength} spellCheck={spellCheck} inputMode={inputMode} />
      </FieldFrame>
    </AriaTextField>
  );
}

/** Several lines of text. */
export function TextArea({ label, showLabel, description, errorMessage, className, inputClassName, placeholder, dir, maxLength, rows, spellCheck, ...rest }: Omit<TextProps, "inputMode"> & { rows?: number }) {
  return (
    <AriaTextField className={cn("grid gap-1", className)} {...rest}>
      <FieldFrame label={label} showLabel={showLabel} description={description} errorMessage={errorMessage}>
        <AriaTextArea className={cn("field w-full resize-y", invalid, inputClassName)} placeholder={placeholder} dir={dir} maxLength={maxLength} rows={rows} spellCheck={spellCheck} />
      </FieldFrame>
    </AriaTextField>
  );
}

/** A field that searches, with a button that clears it. */
export function SearchField({ label, showLabel, className, inputClassName, placeholder, autoFocus, value, defaultValue, onChange, onSubmit, onKeyDown, maxLength, dir, isDisabled }: Omit<TextProps, "type"> & { onSubmit?: (value: string) => void }) {
  return (
    <AriaSearchField className={cn("group relative grid gap-1", className)} autoFocus={autoFocus} value={value} defaultValue={defaultValue} onChange={onChange} onSubmit={onSubmit} onKeyDown={onKeyDown} isDisabled={isDisabled}>
      <Label className={showLabel ? fieldLabel : "sr-only"}>{label}</Label>
      <span className="relative block">
        <Icon name="search" className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className={cn("field w-full ps-8 pe-8 [&::-webkit-search-cancel-button]:hidden", inputClassName)} placeholder={placeholder} maxLength={maxLength} dir={dir} autoComplete="off" />
        <ClearButton />
      </span>
    </AriaSearchField>
  );
}

function ClearButton() {
  return (
    <AriaButton aria-label="×" className="absolute end-1.5 top-1/2 hidden size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground outline-none hoverable hover:text-text group-data-[empty=false]:grid">
      <Icon name="close" className="size-3.5" />
    </AriaButton>
  );
}

/** A number, typed or stepped with the arrow keys. */
export function NumberField({ label, showLabel, className, inputClassName, value, defaultValue, onChange, name, minValue, maxValue, step, isDisabled, onBlur }: Omit<TextProps, "value" | "defaultValue" | "onChange" | "type" | "onBlur"> & { onBlur?: () => void; value?: number; defaultValue?: number; onChange?: (value: number) => void; minValue?: number; maxValue?: number; step?: number }) {
  return (
    <AriaNumberField className={cn("grid gap-1", className)} value={value} defaultValue={defaultValue} onChange={onChange} name={name} minValue={minValue} maxValue={maxValue} step={step} isDisabled={isDisabled} onBlur={onBlur}>
      <Label className={showLabel ? fieldLabel : "sr-only"}>{label}</Label>
      <Input className={cn("field w-full tabular-nums", invalid, inputClassName)} />
    </AriaNumberField>
  );
}
