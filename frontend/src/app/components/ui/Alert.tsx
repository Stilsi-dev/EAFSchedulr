import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { IconTile } from "./IconTile";
import { cn } from "./cn";

/**
 * Two tones, two meanings. `danger` means the student cannot continue on this
 * path; `warning` means they can continue once they have understood something.
 * Keeping the pair here stops a third near-identical red from appearing.
 */
const TONES = {
  danger: {
    shell: "border-rose-200/60 bg-rose-50/90 dark:border-rose-500/30 dark:bg-rose-500/10",
    shadow: "shadow-rose-500/10",
    title: "text-rose-900 dark:text-rose-100",
    body: "text-rose-800/90 dark:text-rose-100/90",
    icon: "text-rose-600 dark:text-rose-400",
    tile: "danger",
  },
  warning: {
    shell: "border-amber-200/60 bg-amber-50/90 dark:border-amber-500/30 dark:bg-amber-500/10",
    shadow: "shadow-amber-500/10",
    title: "text-amber-900 dark:text-amber-100",
    body: "text-amber-800/90 dark:text-amber-100/90",
    icon: "text-amber-600 dark:text-amber-400",
    tile: "warning",
  },
} as const;

type AlertProps = {
  tone: keyof typeof TONES;
  title: ReactNode;
  /** Body copy shown under the title, above `children`. */
  message?: ReactNode;
  children?: ReactNode;
  /** `panel` is the full-width card; `inline` the lighter in-form banner. */
  variant?: "panel" | "inline";
  className?: string;
};

/**
 * A titled, icon-led message block.
 *
 * `role="alert"` lives here rather than at the call sites so a new alert cannot
 * ship silently to screen readers. Both variants title with an `h3` - the inline
 * one is set back to normal weight so it reads as it always has.
 */
export function Alert({
  tone,
  title,
  message,
  children,
  variant = "panel",
  className,
}: AlertProps) {
  const styles = TONES[tone];
  const isPanel = variant === "panel";

  return (
    <div
      role="alert"
      className={cn(
        "border backdrop-blur-xl",
        styles.shell,
        isPanel
          ? cn("rounded-3xl p-6 shadow-xl sm:p-8", styles.shadow)
          : "rounded-2xl p-5 duration-200 animate-in fade-in slide-in-from-top-2",
        className,
      )}
    >
      <div className={cn("flex items-start", isPanel ? "gap-4" : "gap-3")}>
        {isPanel ? (
          <div className="relative flex-shrink-0">
            <IconTile tone={styles.tile} size="md">
              <AlertCircle className="h-6 w-6" />
            </IconTile>
          </div>
        ) : (
          <AlertCircle className={cn("mt-0.5 h-5 w-5 flex-shrink-0", styles.icon)} />
        )}

        <div className={cn("flex-1", isPanel ? "space-y-5" : "space-y-3")}>
          <div className={isPanel ? undefined : "space-y-1"}>
            <h3
              className={cn(
                isPanel ? "mb-2 text-lg" : "text-base font-normal",
                styles.title,
              )}
            >
              {title}
            </h3>
            {message && (
              <p className={cn("text-sm leading-relaxed whitespace-pre-line", styles.body)}>
                {message}
              </p>
            )}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
