import { useEffect, useRef, useState } from "react";
import { Shield, X } from "lucide-react";
import type { Consent } from "../analytics";

/**
 * The one-sentence version, shown in the Privacy Notice without any
 * interaction. It leads with the student's own file because that is the claim
 * that matters most and the only one no other tool could make.
 *
 * "Never leaves memory" is gone from every surface. It was engineer vocabulary
 * in a product committed to the students' words, and worse, it read as "never
 * left my phone" - which is not true. The file is uploaded. Saying we read it
 * and never keep it admits the trip and still makes the stronger promise, and
 * a claim a student can actually check beats one that merely sounds airtight.
 */
export const PRIVACY_SUMMARY =
  "We read your EAF to build your calendar, but never store a copy or send its contents to Google.";

/**
 * The full text. Exported separately from the dialog so the words live in one
 * place: the notice shows the summary above, the dialog shows this, and there
 * is no second copy to fall out of step with the first.
 */
/**
 * The full text, in three labelled parts.
 *
 * Labelled because a student who only wants the Google answer should not have
 * to read the other two paragraphs to find it, and because the dialog is
 * called "What we collect" while its first section is about what happens to
 * the student's file - the heading was doing work the sections should do.
 *
 * The logging section previously claimed more than the code does. It said
 * course codes are recorded for every upload; `log_parse_shape` in
 * app/routes.py records counts, and reaches for a course code only in the
 * branch that fires when a row fails to parse. Overstating collection is
 * still a false privacy claim, and it made the product sound greedier than it
 * is. The ten minutes and the two years are here for the same reason: a number
 * a student can hold onto beats a reassuring adjective, and both are already
 * true - `_TOKEN_TTL` is 600 seconds, and nothing configures `_ga` away from
 * Google's two-year default.
 */
function PrivacyDetails() {
  return (
    <div className="space-y-5">
      <section className="space-y-1.5">
        <h3 className="text-sm text-foreground">Your EAF</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          It is read on our server and never written to disk. The schedule we take from it is discarded the moment your .ics file is built, and the download link works once and expires after ten minutes.
        </p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm text-foreground">What we log</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Counts, mostly: how many rows we read, how many we could not, and whether your form's header was readable at all. When a row fails, that row's course code goes in too, so we can see which part of the EAF format DLSU changed. Never your times, your rooms, or your ID number.
        </p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm text-foreground">Google Analytics</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The only third-party script on this page, and it runs unless you switch it off below. It sets one cookie holding a random ID, which Google keeps for two years, and that is enough to count visits and tell us when something breaks. Your EAF is never part of it.
        </p>
      </section>
    </div>
  );
}

type PrivacyDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Analytics is on by default, so `unset` and `granted` both read as on. */
  consent: Consent;
  onConsentChange: (consent: "granted" | "denied") => void;
};

/**
 * The privacy detail, as a read-aside rather than a journey.
 *
 * It exists because the link used to be an anchor: tapping it threw the
 * student 2.6 screens down a 4.2-screen page, mid-upload, with nothing but a
 * manual scroll to get back. Three paragraphs are not worth losing your place
 * over.
 *
 * A native `<dialog>` rather than a div, and rather than the Radix dialog
 * sitting unused in package.json. `showModal()` supplies the focus trap,
 * Escape, and focus return to the trigger from the browser - all of them more
 * reliably than a hand-rolled trap - for no dependency, in a project that is
 * pruning them. It also renders in the top layer, which settles a real problem
 * quietly: this dialog opens from inside a `fixed z-40` bar, and anything
 * built from ordinary elements would have to win a stacking fight it should
 * never have been in.
 *
 * Nothing is gated behind it: the student can dismiss it unread and still
 * finish the job. It carries the analytics switch as well as the explanation,
 * which makes it the settings surface too - but a modal you can decline to
 * open is a far lighter obligation than the modal-for-consent we deliberately
 * did not build.
 */
export function PrivacyDialog({
  open,
  onClose,
  consent,
  onConsentChange,
}: PrivacyDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
      // The top layer floats above the page but does not stop it scrolling
      // underneath, which on a phone reads as the page coming apart.
      document.body.style.overflow = "hidden";
    } else if (!open && dialog.open) {
      dialog.close();
    }

    if (!open) {
      document.body.style.overflow = "";
    }
  }, [open]);

  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  /**
   * On a short phone the last paragraph is clipped mid-sentence, and a clipped
   * privacy disclosure is worse than a long one: the student has no way to know
   * they have not read all of it. The fade is drawn only while there is more
   * below, so on a screen where everything fits, nothing is dimmed for no
   * reason - and it goes as they reach the end.
   */
  useEffect(() => {
    const prose = proseRef.current;
    if (!prose || !open) {
      return;
    }

    const measure = () => {
      setHasMoreBelow(prose.scrollHeight - prose.scrollTop - prose.clientHeight > 4);
    };

    measure();
    prose.addEventListener("scroll", measure, { passive: true });

    const observer = new ResizeObserver(measure);
    observer.observe(prose);

    return () => {
      prose.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="privacy-dialog-title"
      // Fires for Escape too, so the button and the key take the same path
      // out and React's state cannot drift from the element's.
      onClose={onClose}
      // A click landing on the dialog element itself is a click on the
      // backdrop: the content sits in children, which stop it here.
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
      /* `bg-background`, not the `bg-card` glass the rest of the page is built
         from. Every card token is translucent on purpose, and theme.css measures
         its contrast tiers against the painted ground - so three paragraphs of
         `text-muted-foreground` over a 60%-opaque panel had the hero headline
         legible straight through the body copy, and no contrast ratio you could
         name. A surface for reading has to be opaque. */
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-card-inset-border bg-background p-6 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm sm:p-8"
    >
      <div className="flex items-start justify-between gap-4">
        <h2
          id="privacy-dialog-title"
          className="flex items-center gap-2 text-base text-foreground"
        >
          <Shield className="h-4 w-4 shrink-0" />
          What we collect
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-2 grid h-11 w-11 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-card-inset hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Only the prose scrolls. The switch sits outside that box so it is
          always in view: on a phone this dialog is most of the screen, and a
          control you have to scroll to find is a control a student will
          conclude does not exist. */}
      <div
        ref={proseRef}
        className={
          "mt-4 max-h-[50vh] overflow-y-auto" +
          (hasMoreBelow
            ? " [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]"
            : "")
        }
      >
        <PrivacyDetails />
      </div>

      {/* The standing version of the bar's question, and the only place it
          lives. A choice reversible only by clearing site data would be a
          trapdoor rather than a setting - one click behind a permanent link
          is not, though it does mean the notice has to say which way the
          switch is currently set. */}
      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-card-inset-border bg-card-well p-4">
        <input
          type="checkbox"
          checked={consent !== "denied"}
          onChange={(event) => onConsentChange(event.target.checked ? "granted" : "denied")}
          className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-600"
        />
        {/* "This visit" undersold it: the answer is stored, so it governs every
            later visit on this device until it is changed. A consent control
            that describes itself as narrower than it is has the same problem as
            one that overstates a promise. */}
        <span className="text-sm leading-relaxed text-muted-foreground">
          Let Google Analytics count your visits. We remember this choice on this device; switching it off stops the measurement and clears the cookie straight away.
        </span>
      </label>
    </dialog>
  );
}
