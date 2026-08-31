import { forwardRef, type ReactNode } from "react";
import { cn } from "./cn";

type GlassCardProps = {
  children: ReactNode;
  /** `xl` is the standard panel depth; `2xl` lifts the hero's workflow card. */
  shadow?: "xl" | "2xl";
  className?: string;
};

/**
 * The frosted panel the whole page is built from: translucent ground, blurred
 * backdrop, emerald-tinted shadow.
 *
 * Ground and border come from the card tokens, so the light and dark treatments
 * are one decision instead of a pair rewritten at every panel. Refs are
 * forwarded because two of these panels are scroll targets.
 */
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard(
  { children, shadow = "xl", className },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        // A panel must never be the thing that decides how wide the page is.
        // As a grid item it defaults to `min-width: auto`, so it refuses to go
        // narrower than its longest word - at 200% text that floored the hero
        // grid at 465px on a 375px phone and pushed the whole page sideways.
        "min-w-0",
        "rounded-3xl border border-card-border bg-card backdrop-blur-xl",
        shadow === "2xl" ? "shadow-2xl" : "shadow-xl",
        "shadow-emerald-500/10 dark:shadow-emerald-500/20",
        className,
      )}
    >
      {children}
    </div>
  );
});
