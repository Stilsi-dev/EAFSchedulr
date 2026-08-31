/**
 * Analytics consent, and the bridge to the loader in `index.html`.
 *
 * Three states, not two. `unset` is the absence of the key and means the
 * student has not been asked yet - the only state that shows the consent bar.
 * The loader treats `unset` and `denied` identically, because neither may load
 * anything; only this side has to tell them apart, to decide whether to ask.
 *
 * The key and its values must match the `analyticsConsent` read in the inline
 * script in index.html.
 */

const STORAGE_KEY = "analyticsConsent";

export type Consent = "unset" | "granted" | "denied";

declare global {
  interface Window {
    __eafAnalytics?: { enable(): void; disable(): void };
  }
}

export function readConsent(): Consent {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "granted" || saved === "denied" ? saved : "unset";
  } catch {
    // Private mode or blocked storage. Nothing can be remembered, so the
    // honest reading is that the student has not answered and nothing loads.
    return "unset";
  }
}

/**
 * Persist the decision and act on it now, in this session.
 *
 * Acting immediately is the whole point rather than a nicety: students use
 * this once a term, so "takes effect on your next visit" would mean never for
 * anyone who changes their mind while they are here.
 */
export function writeConsent(consent: Exclude<Consent, "unset">) {
  try {
    localStorage.setItem(STORAGE_KEY, consent);
  } catch {
    // The choice still applies for this session; it just will not survive it.
  }

  if (consent === "granted") {
    window.__eafAnalytics?.enable();
  } else {
    window.__eafAnalytics?.disable();
  }
}
