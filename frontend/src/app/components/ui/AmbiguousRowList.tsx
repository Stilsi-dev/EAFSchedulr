import { cn } from "./cn";

export type AmbiguousRow = {
  code: string;
  row_number: number;
  text: string;
  reason: string;
};

export type AmbiguousRowGroup = {
  code: string;
  rows: AmbiguousRow[];
};

/**
 * The rows the parser could not read, grouped by course.
 *
 * Rendered in amber when the rest of the EAF parsed and the student may
 * continue, and in rose when nothing parsed and this list is the only thing
 * they can send us. Same markup either way - the tone is the whole difference,
 * which is exactly why it is a parameter rather than a second copy.
 */
const TONES = {
  danger: {
    group: "border-rose-200/70 dark:border-rose-500/20",
    row: "bg-rose-50/80 border-rose-200/70 dark:bg-rose-500/10 dark:border-rose-500/20",
    code: "text-rose-900 dark:text-rose-100",
    text: "text-rose-800 dark:text-rose-100/90",
    reason: "text-rose-700 dark:text-rose-200/80",
  },
  warning: {
    group: "border-amber-200/70 dark:border-amber-500/20",
    row: "bg-amber-50/80 border-amber-200/70 dark:bg-amber-500/10 dark:border-amber-500/20",
    code: "text-amber-900 dark:text-amber-100",
    text: "text-amber-800 dark:text-amber-100/90",
    reason: "text-amber-700 dark:text-amber-200/80",
  },
} as const;

type AmbiguousRowListProps = {
  groups: AmbiguousRowGroup[];
  tone: keyof typeof TONES;
};

export function AmbiguousRowList({ groups, tone }: AmbiguousRowListProps) {
  if (groups.length === 0) {
    return null;
  }

  const styles = TONES[tone];

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.code} className={cn("rounded-2xl border bg-card-well p-3 sm:p-4", styles.group)}>
          <p className={cn("mb-3 text-base font-semibold [overflow-wrap:anywhere]", styles.code)}>{group.code}</p>
          <div className="space-y-3">
            {group.rows.map((row) => (
              <div
                key={`${group.code}-${row.row_number}`}
                className={cn("rounded-xl border p-2.5 sm:p-3", styles.row)}
              >
                <p className={cn("text-sm font-medium tabular-nums", styles.code)}>Row {row.row_number}</p>
                {/* The whole point of this list is text the parser could not read, so
                    it arrives malformed by definition - and the classic drift
                    artifact is columns concatenated into one long run with no
                    spaces in it. `pre-wrap` alone only breaks on whitespace, so
                    a single 90-character token pushed the page 489px sideways on
                    a phone. `anywhere` also lowers the min-content width, which
                    is what stops the row from widening its container. */}
                <p className={cn("mt-1 max-w-[70ch] text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]", styles.text)}>
                  {row.text}
                </p>
                <p className={cn("mt-2 text-xs leading-relaxed", styles.reason)}>{row.reason}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
