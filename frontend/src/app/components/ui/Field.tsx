import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "./cn";

type FieldProps = {
  /** Input id. Also derives the hint and error ids the input points at. */
  id: string;
  label: ReactNode;
  /** Marks the label and applies `required` to the input. */
  required?: boolean;
  /** Standing guidance. Replaced by `error` when validation fails. */
  hint?: ReactNode;
  error?: string;
  type?: "date" | "number" | "text";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  inputMode?: "numeric" | "text";
};

/**
 * A labelled input with its hint and error message.
 *
 * The accessible wiring is the reason this is a component rather than a class
 * string: `aria-invalid`, and an `aria-describedby` that points at whichever of
 * the hint or the error is actually rendered. Repeating that by hand at each
 * call site is how one field ends up silently unlabelled.
 */
export function Field({
  id,
  label,
  required = false,
  hint,
  error,
  type = "text",
  value,
  onChange,
  placeholder,
  min,
  max,
  step,
  inputMode,
}: FieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block pl-1 text-label-foreground">
        {label}
        {required && <span className="text-rose-600 dark:text-rose-400"> *</span>}
      </label>

      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        inputMode={inputMode}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={cn(
          "w-full rounded-2xl border bg-card-inset px-5 py-3.5 text-foreground backdrop-blur-sm transition-all",
          "placeholder:text-subtle-foreground hover:bg-white dark:hover:bg-slate-700/70",
          "focus:border-transparent focus:outline-none focus:ring-2",
          // Both rings come from tokens. Written as literal emerald and red
          // they ignored `--ring` and `--destructive` entirely, so the theme
          // could be retuned without the focus state ever following.
          error
            ? "border-destructive focus:ring-destructive"
            : "border-card-inset-border focus:ring-ring",
        )}
      />

      {!error && hint && (
        <p id={hintId} className="pl-1 text-sm text-muted-foreground">
          {hint}
        </p>
      )}

      {error && (
        <div
          id={errorId}
          className="mt-2 flex items-start gap-2 text-sm text-red-600 duration-200 animate-in fade-in slide-in-from-top-1 dark:text-red-400"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
