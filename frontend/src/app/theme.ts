/**
 * Theme preference, and the bridge to the bootstrap script in `index.html`.
 *
 * Three states, not two. `system` is the absence of a stored choice, and it
 * means the student has never picked, so the operating system decides and goes
 * on deciding every visit. Only an explicit tap on the toggle writes anything.
 * That asymmetry is the whole design: an app that saved a value on first load
 * would freeze every student on whatever their OS happened to be that day, and
 * a student who later switched their machine to dark would keep getting light
 * forever without ever having asked for it.
 *
 * Leaving `system` is deliberately one-way through the UI. The toggle sets an
 * explicit `light` or `dark` and there is no button back, because the header
 * has room for two icons and a three-stop cycle hides its third stop. Clearing
 * site data is the way back, which is a fair price for a control that is
 * obvious at a glance.
 *
 * The key and its values must match the bootstrap script in index.html, which
 * runs long before this module is parsed and has to reach the same answer.
 */

const STORAGE_KEY = "themePreference";

// An older build wrote this on every mount, including mounts where the student
// never touched the toggle, so it records nothing about what anyone wanted.
// Cleared on sight rather than migrated: a value that means both "chose light"
// and "never chose" cannot be read either way.
const LEGACY_KEY = "darkMode";

export type ThemePreference = "system" | "light" | "dark";

/** Shared so the listener and the first read cannot drift apart. */
export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

export function readPreference(): ThemePreference {
  try {
    localStorage.removeItem(LEGACY_KEY);
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    // Private mode or blocked storage. Nothing was ever saved, so the OS is
    // the only preference that exists.
    return "system";
  }
}

/**
 * Persist an explicit choice.
 *
 * `system` is not writable on purpose. It is the absence of a choice, and
 * storing it would be indistinguishable from a student having deliberately
 * picked whichever theme their OS was showing at the time.
 */
export function writePreference(
  preference: Exclude<ThemePreference, "system">,
): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Nothing can be remembered, but the choice still holds for this session.
  }
}

/** Paint the resolved theme. The class is what every `dark:` utility reads. */
export function applyTheme(isDark: boolean): void {
  document.documentElement.classList.toggle("dark", isDark);
}
