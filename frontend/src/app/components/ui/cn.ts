/**
 * Join class names, dropping anything falsy.
 *
 * Deliberately dependency-free: `clsx` and `tailwind-merge` are declared in
 * package.json but nothing imports them, and the project is pruning unused
 * dependencies rather than growing new reasons to keep them.
 */
export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
