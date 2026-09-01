import { useEffect, useRef } from "react";
import { Github, Info, X } from "lucide-react";
import { PRIVACY_SUMMARY } from "./PrivacyDialog";

export const REPO_URL = "https://github.com/Stilsi-dev/EAFSchedulr";

/**
 * The three questions the hero could not answer.
 *
 * "How it works" was already answered, permanently and without a click, by the
 * workflow card sitting beside the buttons - which is why the secondary CTA
 * that scrolled to it did nothing on desktop. What the page never answered is
 * the other half of the hesitation: this looks like an Archers Hub feature and
 * is not one, nobody is named, and a student whose EAF predates the current
 * format finds out only after uploading it.
 *
 * The privacy line is imported rather than written. PRIVACY_SUMMARY exists so
 * the file-handling promise has one author; a third phrasing tuned to this
 * dialog is exactly the drift that export was created to stop.
 */
function AboutDetails({ onOpenPrivacy }: { onOpenPrivacy: () => void }) {
  return (
    <div className="space-y-5">
      <section className="space-y-1.5">
        <h3 className="text-sm text-foreground">What this is</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A student project, not a DLSU service. It is not affiliated with, endorsed by, or connected to Archers Hub, and nothing you do here changes your enrolment.
        </p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm text-foreground">Who built it</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A Lasallian, after a friend's EAF stopped working with the old converters. The whole thing is open source, so you can read exactly what it does with your file before you hand it over.
        </p>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded text-sm text-emerald-700 underline underline-offset-2 transition-colors hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          <Github className="h-3.5 w-3.5 shrink-0" />
          View the source on GitHub
        </a>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm text-foreground">Which EAFs it reads</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The format Archers Hub issues today. Older PDFs, screenshots, and forms from other schools will not parse, and the app will say so rather than guess.
        </p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm text-foreground">Your EAF</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {PRIVACY_SUMMARY}{" "}
          {/* A button, not an anchor: the destination is a dialog, and this one
              has to close first so two modals never stack. The label matches
              the privacy dialog's own heading, because two names would read as
              two destinations. */}
          <button
            type="button"
            onClick={onOpenPrivacy}
            className="rounded underline underline-offset-2 transition-colors hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-emerald-400"
          >
            What we collect
          </button>
        </p>
      </section>
    </div>
  );
}

type AboutDialogProps = {
  open: boolean;
  onClose: () => void;
  onOpenPrivacy: () => void;
};

/**
 * The same native `<dialog>` as PrivacyDialog, for the same reasons: showModal()
 * brings the focus trap, Escape, and focus return with it, and the top layer
 * keeps this out of any stacking fight with the fixed consent bar.
 *
 * No scroll fade here, unlike its sibling. That fade exists because a clipped
 * privacy disclosure leaves a student unable to tell they have not read all of
 * it; this is four short paragraphs of reassurance, where the cost of a
 * missed line is not the same.
 */
export function AboutDialog({ open, onClose, onOpenPrivacy }: AboutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
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

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="about-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-card-inset-border bg-background p-6 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm sm:p-8"
    >
      <div className="flex items-start justify-between gap-4">
        <h2
          id="about-dialog-title"
          className="flex items-center gap-2 text-base text-foreground"
        >
          <Info className="h-4 w-4 shrink-0" />
          About this tool
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

      <div className="mt-4 max-h-[60vh] overflow-y-auto">
        <AboutDetails onOpenPrivacy={onOpenPrivacy} />
      </div>
    </dialog>
  );
}
