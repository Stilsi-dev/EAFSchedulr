import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Every gradient fill in the product, one per meaning.
 *
 * The three brand tones carry structure and the two semantic tones carry state.
 * There is deliberately no general-purpose "accent": when a card needed to look
 * different from its neighbour it reached for blue and purple, and the product
 * ended up with hues belonging to no palette. Neighbouring surfaces are
 * separated by `emerald` against `teal` - the identity's own two stops - so a
 * new hue has to be argued for rather than picked.
 *
 * Each tone owns its foreground as well as its fill, because the two are one
 * decision. The tile is always the brightest brand object against its ground -
 * deep in light mode, luminous in dark - so the glyph on it has to flip with
 * the theme rather than defaulting to white. This is the same pairing the
 * theme already makes for `--primary` / `--primary-foreground`, and the same
 * emerald-700 the primary button has always used to carry white text.
 *
 * The fills are contrast decisions, not taste: a tile can hold a numeral as
 * well as an icon, so every `fill` clears 4.5:1 against its `fg` at the
 * *lightest* end of the gradient, not the average. Measured, both themes:
 *
 *   brand / emerald / teal   5.5:1 light,  7.1:1 dark
 *   danger                   4.7:1
 *   warning                  6.9:1
 *
 * Amber is why `warning` reads dark. White on amber-500 measures 2.1:1 - the
 * pairing looks fine and fails badly, which is exactly the kind of thing that
 * ships unnoticed.
 */
const TONES = {
  brand: {
    fill: "from-emerald-700 to-teal-800 dark:from-emerald-400 dark:to-teal-500",
    fg: "text-white dark:text-slate-900",
    glow: "dark:shadow-emerald-400/30",
  },
  emerald: {
    fill: "from-emerald-700 to-emerald-800 dark:from-emerald-400 dark:to-emerald-500",
    fg: "text-white dark:text-slate-900",
    glow: "shadow-emerald-700/30 dark:shadow-emerald-400/20",
  },
  teal: {
    fill: "from-teal-700 to-teal-800 dark:from-teal-400 dark:to-teal-500",
    fg: "text-white dark:text-slate-900",
    glow: "shadow-teal-700/30 dark:shadow-teal-400/20",
  },
  danger: {
    fill: "from-rose-600 to-red-700",
    fg: "text-white",
    glow: "shadow-rose-600/30",
  },
  warning: {
    fill: "from-amber-500 to-orange-600",
    fg: "text-amber-950",
    glow: "shadow-amber-500/30",
  },
} as const;

const SIZES = {
  sm: "h-10 w-10 rounded-xl",
  md: "h-12 w-12 rounded-2xl",
  lg: "h-16 w-16 rounded-2xl",
} as const;

type IconTileProps = {
  tone?: keyof typeof TONES;
  size?: keyof typeof SIZES;
  /** Depth is independent of size - a large tile is not always a heavier one. */
  shadow?: "lg" | "xl";
  children: ReactNode;
  className?: string;
};

/** A gradient-filled rounded square holding a single icon. */
export function IconTile({
  tone = "brand",
  size = "md",
  shadow = "lg",
  children,
  className,
}: IconTileProps) {
  const { fill, fg, glow } = TONES[tone];

  return (
    <div
      className={cn(
        "flex flex-shrink-0 items-center justify-center bg-gradient-to-br",
        SIZES[size],
        shadow === "xl" ? "shadow-xl" : "shadow-lg",
        fill,
        fg,
        glow,
        className,
      )}
    >
      {children}
    </div>
  );
}
