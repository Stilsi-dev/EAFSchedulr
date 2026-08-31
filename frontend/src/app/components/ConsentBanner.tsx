import { useEffect, useRef } from "react";

type ConsentBannerProps = {
  onDecide: (consent: "granted" | "denied") => void;
  /**
   * Opens the privacy dialog. Returns false when the browser cannot open it,
   * so the link falls back to being the `#privacy` anchor it already is.
   */
  onOpenPrivacy: () => boolean;
};

/**
 * The analytics consent bar, shown only until the student has answered once.
 *
 * Deliberately not a dialog. It does not trap focus, does not take focus on
 * mount, and does not make the page inert: a student can ignore it completely
 * and still upload, generate and download. An interstitial standing between a
 * student and their calendar would contradict the one-sitting principle the
 * whole product is built on, and a modal would collect more consent precisely
 * by making the refusal harder - which is the thing this bar exists to not do.
 *
 * It does float over the page, so it publishes its own height as
 * `--consent-bar-h` for App.tsx to pad the page by. Measured rather than
 * hard-coded per breakpoint because the copy wraps to two or three lines
 * depending on width and text size; a stale constant would leave the upload
 * dropzone sitting under the bar on exactly the narrow screens least able to
 * spare the room.
 */
export function ConsentBanner({ onDecide, onOpenPrivacy }: ConsentBannerProps) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) {
      return;
    }

    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty("--consent-bar-h", `${bar.offsetHeight}px`);
    };

    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(bar);

    return () => {
      observer.disconnect();
      root.style.removeProperty("--consent-bar-h");
    };
  }, []);

  return (
    <div
      ref={barRef}
      role="region"
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-card-border bg-card backdrop-blur-xl shadow-[0_-8px_32px_rgba(0,0,0,0.08)] dark:shadow-[0_-8px_32px_rgba(0,0,0,0.4)]"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
        <div className="space-y-1">
          <p className="text-base text-foreground">Can we count this visit?</p>
          {/* Two sentences: what the data is for, and what is not in it. The
              cookie-and-random-ID detail lives in the dialog rather than here,
              trading the most checkable fact for a shorter read at the moment
              the student is actually deciding. The page reserves whatever
              height this comes to, so nothing below is ever trapped - only
              scrolled to - and with both buttons weighted the same, the nudge
              is toward answering rather than toward agreeing. */}
          <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
            Google Analytics helps us understand how many students use this and when
            things break. Your EAF is never included or saved.{" "}
            <a
              href="#privacy"
              onClick={(event) => {
                if (onOpenPrivacy()) {
                  event.preventDefault();
                }
              }}
              className="rounded underline underline-offset-2 transition-colors hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-emerald-400"
            >
              What we collect
            </a>
          </p>
        </div>

        {/* Both labels name the outcome rather than agreeing with a question.
            "Mind if we count this visit?" inverted against them: answered
            literally, "Sure" means "sure, I do mind" - a decline. A consent
            control cannot afford a heading its own buttons contradict.

            Equal weight, on purpose. A filled Accept beside a quiet Decline
            asks for one answer while appearing to offer either, and this bar
            exists to be believed rather than to be got past. Neither button
            takes the emerald gradient: that belongs to "Generate calendar",
            and nothing here should compete with the actual task. */}
        {/* `flex-1` only below `sm`. The row stays stacked under the copy until
            `lg`, so leaving the buttons to divide the full width made each one
            420px wide at 900px - a pair of banners for a two-word answer. Under
            640px the split is right: two thumb-sized halves. */}
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => onDecide("denied")}
            className="flex-1 rounded-xl border border-card-inset-border bg-card-inset px-5 py-3 text-sm text-label-foreground transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-slate-700/80 sm:flex-none"
          >
            Don't allow
          </button>
          <button
            type="button"
            onClick={() => onDecide("granted")}
            className="flex-1 rounded-xl border border-card-inset-border bg-card-inset px-5 py-3 text-sm text-label-foreground transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-slate-700/80 sm:flex-none"
          >
            Allow analytics
          </button>
        </div>
      </div>
    </div>
  );
}
