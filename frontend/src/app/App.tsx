import { useState, useRef, useEffect, useMemo, type ChangeEvent, type DragEvent } from "react";
import { Upload, Calendar, CheckCircle2, AlertCircle, FileText, CalendarPlus, ExternalLink, ArrowRight, Download, BookOpen, CalendarDays, Shield, Mail, Github, Heart, MapPin, Moon, Sun } from "lucide-react";
import { Alert } from "./components/ui/Alert";
import { AmbiguousRowList } from "./components/ui/AmbiguousRowList";
import { Field } from "./components/ui/Field";
import { GlassCard } from "./components/ui/GlassCard";
import { IconTile } from "./components/ui/IconTile";
import { ConsentBanner } from "./components/ConsentBanner";
import { PrivacyDialog, PRIVACY_SUMMARY } from "./components/PrivacyDialog";
import { readConsent, writeConsent, type Consent } from "./analytics";
import {
  applyTheme,
  DARK_QUERY,
  prefersDark,
  readPreference,
  writePreference,
  type ThemePreference,
} from "./theme";

const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const WEEKDAY_NAMES: Record<string, string> = {
  SUN: "Sunday",
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
};

// Mirrors MAX_PDF_SIZE_BYTES in app/config.py. Checked here too so an oversized
// file is refused before it is uploaded, not after.
const MAX_PDF_BYTES = 10 * 1024 * 1024;

function getSelectedWeekday(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) {
    return "";
  }

  return WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()];
}

/**
 * First date on or after `start` that falls on `dayCode`, as YYYY-MM-DD.
 *
 * This is the date the weekly branch would have used for its first event, so
 * ticking the box moves a session the student already had rather than
 * inventing one somewhere new.
 */
function firstOccurrenceOnOrAfter(start: string, dayCode: string) {
  const target = WEEKDAY_LABELS.indexOf(dayCode.toUpperCase());
  const [year, month, day] = start.split("-").map(Number);
  if (target < 0 || !year || !month || !day) {
    return "";
  }

  const cursor = new Date(year, month - 1, day);
  if (Number.isNaN(cursor.getTime())) {
    return "";
  }

  cursor.setDate(cursor.getDate() + ((target - cursor.getDay() + 7) % 7));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
}

/** Join weekday codes into prose: "Tuesday", "Tuesday or Thursday". */
function formatWeekdayList(days: string[]) {
  const names = days.map((day) => WEEKDAY_NAMES[day.toUpperCase()] ?? day);
  if (names.length <= 1) {
    return names[0] ?? "";
  }

  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * Some browsers report an empty MIME type for dragged files, so fall back to
 * the extension rather than silently rejecting a real PDF.
 */
function isPdfFile(candidate: File) {
  return candidate.type === "application/pdf" || /\.pdf$/i.test(candidate.name);
}

/**
 * Read an error message from a response that may not be JSON at all - rate
 * limiting and unhandled server errors both return HTML.
 */
async function readErrorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (payload?.error) {
      return { message: String(payload.error), payload };
    }
  } catch {
    // Fall through to the status-based message below.
  }

  if (response.status === 429) {
    return {
      message: "Too many uploads from this connection. Wait a minute, then try again.",
      payload: null,
    };
  }

  if (response.status >= 500) {
    return {
      message: "The app server ran into a problem. Try again in a moment.",
      payload: null,
    };
  }

  return { message: fallback, payload: null };
}

function formatCourseName(courseName: string) {
  const smallWords = new Set(["and", "or", "of", "for", "the", "to", "in", "on"]);
  const acronyms = new Set(["ECE"]);

  return courseName
    .toLowerCase()
    .split(" ")
    .map((word, index) => {
      return word
        .split("/")
        .map((part) => {
          const uppercasePart = part.toUpperCase();
          if (acronyms.has(uppercasePart)) {
            return uppercasePart;
          }

          if (index > 0 && smallWords.has(part)) {
            return part;
          }

          return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join("/");
    })
    .join(" ");
}

type InspectedEvent = {
  code: string;
  title: string;
  course_name: string;
  day: string;
  start_time: string;
  end_time: string;
  location: string;
  is_recollection: boolean;
};

type AmbiguousRow = {
  code: string;
  row_number: number;
  text: string;
  reason: string;
};

type AmbiguousRowGroup = {
  code: string;
  rows: AmbiguousRow[];
};

/** One recollection the EAF contains, and the weekdays it may fall on. */
type RecollectionField = {
  code: string;
  name: string;
  days: string[];
};

/**
 * A course the server thinks might meet only once, and the weekdays the EAF
 * printed for it. A suggestion the student answers, never a decision: leaving
 * it alone keeps the weekly recurrence.
 */
type OneTimeCandidate = {
  code: string;
  name: string;
  days: string[];
};

/**
 * A parse failure means the file itself cannot be used, so the form is
 * replaced. A submit failure leaves the form standing and offers a retry.
 * `kind` decides the heading: blaming the PDF for a dropped connection sends
 * the student off to re-download an EAF that was never the problem.
 */
type ParseError = {
  kind: "file" | "transport";
  message: string;
};

type SubmitError = {
  kind: "transport" | "server";
  message: string;
};

type CourseSummary = {
  code: string;
  sectionCode: string;
  courseName: string;
  hasRecollection: boolean;
  meetingGroups: Array<{
    days: string[];
    startTime: string;
    endTime: string;
    locations: string[];
  }>;
};

function buildCourseSummaries(events: InspectedEvent[]): CourseSummary[] {
  return Array.from(
    events.reduce((summaries, event) => {
      const existingSummary = summaries.get(event.code);
      if (existingSummary) {
        existingSummary.hasRecollection = existingSummary.hasRecollection || event.is_recollection;
        const existingMeetingGroup = existingSummary.meetingGroups.find(
          (meetingGroup) =>
            meetingGroup.startTime === event.start_time
            && meetingGroup.endTime === event.end_time,
        );

        if (existingMeetingGroup) {
          existingMeetingGroup.days.push(event.day);
          if (event.location && !existingMeetingGroup.locations.includes(event.location)) {
            existingMeetingGroup.locations.push(event.location);
          }
        } else {
          existingSummary.meetingGroups.push({
            days: [event.day],
            startTime: event.start_time,
            endTime: event.end_time,
            locations: event.location ? [event.location] : [],
          });
        }

        return summaries;
      }

      summaries.set(event.code, {
        code: event.code,
        sectionCode: event.title.replace(`${event.code} `, "").trim(),
        courseName: event.course_name,
        hasRecollection: event.is_recollection,
        meetingGroups: [
          {
            days: [event.day],
            startTime: event.start_time,
            endTime: event.end_time,
            locations: event.location ? [event.location] : [],
          },
        ],
      });
      return summaries;
    }, new Map<string, CourseSummary>()).values(),
  ).map((summary) => ({
    ...summary,
    meetingGroups: summary.meetingGroups.map((meetingGroup) => ({
      ...meetingGroup,
      days: Array.from(new Set(meetingGroup.days)),
    })),
  }));
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [termStartDate, setTermStartDate] = useState("");
  const [numWeeks, setNumWeeks] = useState("14");
  const [recollectionDates, setRecollectionDates] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<{
    acknowledgeRows?: string;
    termStartDate?: string;
    numWeeks?: string;
    recollections?: Record<string, string>;
    oneTimeSessions?: Record<string, string>;
  }>({});
  // The uploaded file cannot be used at all - replaces the form.
  const [parseError, setParseError] = useState<ParseError | null>(null);
  // Creating the calendar failed - the form stays put so the student can retry.
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [ambiguousRows, setAmbiguousRows] = useState<AmbiguousRow[]>([]);
  const [acknowledgedMissingRows, setAcknowledgedMissingRows] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [recollectionFields, setRecollectionFields] = useState<RecollectionField[]>([]);
  const [oneTimeCandidates, setOneTimeCandidates] = useState<OneTimeCandidate[]>([]);
  const [oneTimeChecked, setOneTimeChecked] = useState<Record<string, boolean>>({});
  const [oneTimeDates, setOneTimeDates] = useState<Record<string, string>>({});
  const [inspectedEvents, setInspectedEvents] = useState<InspectedEvent[]>([]);
  const [generatedFilename, setGeneratedFilename] = useState("eaf-calendar.ics");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [isInspecting, setIsInspecting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("");
  const [isScheduleCreated, setIsScheduleCreated] = useState(false);
  const [showAllCourses, setShowAllCourses] = useState(false);
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(readPreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(prefersDark);
  // Derived, never stored. A second piece of state for the resolved theme
  // could disagree with the preference that produced it, and the bug that
  // falls out of that is a toggle the page ignores.
  const isDarkMode =
    themePreference === "system" ? systemPrefersDark : themePreference === "dark";
  const [analyticsConsent, setAnalyticsConsent] = useState<Consent>(readConsent);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);

  const uploadSectionRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scheduleDetailsRef = useRef<HTMLDivElement>(null);
  const successSectionRef = useRef<HTMLDivElement>(null);
  const parseErrorRef = useRef<HTMLDivElement>(null);
  const importStepsRef = useRef<HTMLDivElement>(null);

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const hasLasallianRecollection = recollectionFields.length > 0;
  const hasOneTimeCandidates = oneTimeCandidates.length > 0;

  /**
   * The date a ticked session lands on: the student's own choice if they made
   * one, otherwise the first occurrence after the term start they entered two
   * fields up. Derived rather than stored, so correcting the term start moves
   * an untouched date with it instead of leaving a stale one behind.
   */
  const oneTimeDateFor = (candidate: OneTimeCandidate) =>
    oneTimeDates[candidate.code]
    || firstOccurrenceOnOrAfter(termStartDate, candidate.days[0] ?? "");

  // Each scroll timer is cleared on re-run: uploading twice in quick succession
  // otherwise queues two competing smooth scrolls.
  useEffect(() => {
    if (!file || isScheduleCreated) {
      return;
    }

    const timer = setTimeout(() => {
      scheduleDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);

    return () => clearTimeout(timer);
  }, [file, isScheduleCreated]);

  useEffect(() => {
    if (!isScheduleCreated) {
      return;
    }

    const timer = setTimeout(() => {
      successSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 500);

    return () => clearTimeout(timer);
  }, [isScheduleCreated]);

  /**
   * A rejected file replaces the form with an explanation - roughly 1600px down
   * the page on a phone. Every other state change here scrolls to what it
   * produced; this one did not, because it scrolls to the schedule panel and a
   * parse error is precisely the case where that panel does not exist. The
   * student pressed upload, the page appeared to do nothing, and the reason sat
   * two screens below the fold.
   */
  useEffect(() => {
    if (!parseError) {
      return;
    }

    const timer = setTimeout(() => {
      parseErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);

    return () => clearTimeout(timer);
  }, [parseError]);

  useEffect(() => {
    applyTheme(isDarkMode);
  }, [isDarkMode]);

  // Storage is written by the toggle, not here. An effect that saved on mount
  // would turn every first visit into a permanent choice, which is exactly
  // what keeps `system` from meaning anything.

  // Subscribed only while following the system. A student who picked a theme
  // should not have it pulled out from under them when their machine dims at
  // sunset.
  useEffect(() => {
    if (themePreference !== "system") return;

    const query = window.matchMedia(DARK_QUERY);
    const sync = (event: MediaQueryListEvent) =>
      setSystemPrefersDark(event.matches);

    // Re-read on subscribe: the OS can flip between the first render and here.
    setSystemPrefersDark(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [themePreference]);

  /**
   * Stored and applied in the same breath. `writeConsent` reaches the loader in
   * index.html, so switching analytics off silences a tag that is already
   * running instead of waiting for a next visit that, once a term, never comes.
   */
  const handleConsent = (consent: "granted" | "denied") => {
    writeConsent(consent);
    setAnalyticsConsent(consent);
  };

  /**
   * Reports whether it actually opened. Both triggers are real `#privacy`
   * anchors, and only suppress their navigation when the dialog takes over -
   * so a browser without `showModal` still gets the student to the notice
   * rather than to nothing at all.
   */
  const openPrivacy = () => {
    if (typeof HTMLDialogElement === "undefined" || !HTMLDialogElement.prototype.showModal) {
      return false;
    }

    setIsPrivacyOpen(true);
    return true;
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      acceptFile(droppedFile);
    }
  };

  /**
   * Refuse a file the server would reject anyway, and say why. Dropping the
   * wrong thing used to do nothing at all, which reads as a broken page.
   */
  const acceptFile = (candidate: File) => {
    if (!isPdfFile(candidate)) {
      setFile(null);
      setParseError({
        kind: "file",
        message: `"${candidate.name}" is not a PDF. Upload the EAF PDF you downloaded from Archers Hub.`,
      });
      setStatusMessage("That file is not a PDF.");
      return;
    }

    if (candidate.size > MAX_PDF_BYTES) {
      const sizeInMb = (candidate.size / 1024 / 1024).toFixed(1);
      setFile(null);
      setParseError({
        kind: "file",
        message: `"${candidate.name}" is ${sizeInMb}MB. The limit is 10MB - an EAF is normally well under that, so check you picked the right file.`,
      });
      setStatusMessage("That file is too large.");
      return;
    }

    void inspectFile(candidate);
  };

  const inspectFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setValidationErrors({});
    setParseError(null);
    setSubmitError(null);
    setAmbiguousRows([]);
    setAcknowledgedMissingRows(false);
    setReportCopied(false);
    setRecollectionFields([]);
    setRecollectionDates({});
    setOneTimeCandidates([]);
    setOneTimeChecked({});
    setOneTimeDates({});
    setInspectedEvents([]);
    setGeneratedFilename(selectedFile.name.replace(/\.pdf$/i, ".ics"));
    setDownloadUrl("");
    setGeneratedAt("");
    setIsScheduleCreated(false);
    setShowAllCourses(false);
    setIsInspecting(true);
    setStatusMessage(`Reading ${selectedFile.name}...`);

    const formData = new FormData();
    formData.append("eaf_pdf", selectedFile);

    try {
      const response = await fetch("/inspect", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const { message, payload } = await readErrorMessage(
          response,
          "Could not read the uploaded EAF.",
        );
        setParseError({ kind: "file", message });
        setAmbiguousRows(Array.isArray(payload?.ambiguous_rows) ? payload.ambiguous_rows : []);
        setStatusMessage(message);
        return;
      }

      const payload = await response.json();
      const events: InspectedEvent[] = Array.isArray(payload.events) ? payload.events : [];
      const recollectionDays = (payload.recollection_days ?? {}) as Record<string, string[]>;

      // One field per recollection code. The server validates each code against
      // its own weekday, so the UI has to collect each one separately.
      const fields: RecollectionField[] = Object.keys(recollectionDays)
        .sort()
        .map((code) => ({
          code,
          name:
            events.find((event) => event.code === code)?.course_name
            ?? code,
          days: recollectionDays[code].map((day) => day.toUpperCase()),
        }));

      setGeneratedFilename(payload.generated_filename || selectedFile.name.replace(/\.pdf$/i, ".ics"));
      setInspectedEvents(events);
      setAmbiguousRows(Array.isArray(payload.ambiguous_rows) ? payload.ambiguous_rows : []);
      setRecollectionFields(fields);
      setRecollectionDates(Object.fromEntries(fields.map((field) => [field.code, ""])));

      // Courses to ASK about. Unticked by default: the app does not know
      // whether these meet once, and guessing wrong would drop real classes.
      const oneTimeDays = (payload.one_time_candidates ?? {}) as Record<string, string[]>;
      setOneTimeCandidates(
        Object.keys(oneTimeDays)
          .sort()
          .map((code) => ({
            code,
            name: events.find((event) => event.code === code)?.course_name ?? code,
            days: oneTimeDays[code].map((day) => day.toUpperCase()),
          })),
      );
      setOneTimeChecked({});
      setOneTimeDates({});

      const courseCount = payload.course_count ?? 0;
      const unreadable = Array.isArray(payload.ambiguous_rows) ? payload.ambiguous_rows.length : 0;
      setStatusMessage(
        `Read ${courseCount} ${courseCount === 1 ? "course" : "courses"} from ${selectedFile.name}.`
        + (unreadable > 0
          ? ` ${unreadable} ${unreadable === 1 ? "row" : "rows"} could not be read.`
          : "")
        + " Fill in your schedule details below.",
      );
    } catch {
      setParseError({
        kind: "transport",
        message: "Could not reach the app server. Check your connection, then upload the file again.",
      });
      setAmbiguousRows([]);
      setAcknowledgedMissingRows(false);
      setStatusMessage("Could not reach the app server.");
    } finally {
      setIsInspecting(false);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    // Allow re-selecting the same file by clearing the input value right away.
    e.target.value = "";
    if (selectedFile) {
      acceptFile(selectedFile);
    }
  };

  const handleClear = () => {
    resetFileInput();
    setFile(null);
    setTermStartDate("");
    setNumWeeks("14");
    setRecollectionDates({});
    setRecollectionFields([]);
    setOneTimeCandidates([]);
    setOneTimeChecked({});
    setOneTimeDates({});
    setValidationErrors({});
    setParseError(null);
    setSubmitError(null);
    setStatusMessage("");
    setAmbiguousRows([]);
    setAcknowledgedMissingRows(false);
    setReportCopied(false);
    setInspectedEvents([]);
    setGeneratedFilename("eaf-calendar.ics");
    setDownloadUrl("");
    setGeneratedAt("");
    setIsGenerating(false);
    setIsScheduleCreated(false);
    setShowAllCourses(false);

    setTimeout(() => {
      uploadSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  };

  const scrollToUpload = () => {
    uploadSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const triggerFileUpload = () => {
    // Clearing before open ensures selecting the same file triggers onChange.
    resetFileInput();
    fileInputRef.current?.click();
  };

  const handleCreateSchedule = async () => {
    const errors: {
      acknowledgeRows?: string;
      termStartDate?: string;
      numWeeks?: string;
      recollections?: Record<string, string>;
    oneTimeSessions?: Record<string, string>;
    } = {};

    if (!termStartDate) {
      errors.termStartDate = "Term start date is required.";
    }

    const weekCount = Number(numWeeks);
    if (!numWeeks.trim()) {
      errors.numWeeks = "Number of weeks is required.";
    } else if (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > 52) {
      errors.numWeeks = "Enter a whole number of weeks between 1 and 52.";
    }

    // Validate each recollection against its own weekday. Checking the selected
    // date against every recollection's weekdays at once lets a date that suits
    // one recollection pass for another, which the server then rejects.
    const recollectionErrors: Record<string, string> = {};
    recollectionFields.forEach((field) => {
      const selected = recollectionDates[field.code] ?? "";

      if (!selected) {
        recollectionErrors[field.code] = "Choose the date for this recollection.";
        return;
      }

      const selectedWeekday = getSelectedWeekday(selected);
      if (selectedWeekday && field.days.length > 0 && !field.days.includes(selectedWeekday)) {
        recollectionErrors[field.code] =
          `${field.code} is scheduled on ${formatWeekdayList(field.days)}. Choose a ${formatWeekdayList(field.days)} date.`;
      }
    });

    if (Object.keys(recollectionErrors).length > 0) {
      errors.recollections = recollectionErrors;
    }

    // Only ticked sessions are checked. An unticked one has no date to be
    // wrong about, which is the point of the default.
    const oneTimeErrors: Record<string, string> = {};
    oneTimeCandidates.forEach((candidate) => {
      if (!oneTimeChecked[candidate.code]) {
        return;
      }

      const selected = oneTimeDateFor(candidate);
      if (!selected) {
        oneTimeErrors[candidate.code] = "Choose the date this session takes place.";
        return;
      }

      const weekday = getSelectedWeekday(selected);
      if (weekday && !candidate.days.includes(weekday)) {
        oneTimeErrors[candidate.code] =
          `${candidate.code} is scheduled on ${formatWeekdayList(candidate.days)}. Please choose a ${formatWeekdayList(candidate.days)} date.`;
      }
    });

    if (Object.keys(oneTimeErrors).length > 0) {
      errors.oneTimeSessions = oneTimeErrors;
    }

    if (ambiguousRows.length > 0 && !acknowledgedMissingRows) {
      errors.acknowledgeRows =
        "Confirm you understand these classes will be missing before creating the schedule.";
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      setSubmitError(null);
      setStatusMessage("Some details still need fixing before your calendar can be created.");
      return;
    }

    setValidationErrors({});
    setSubmitError(null);

    if (!file) {
      setSubmitError({ kind: "server", message: "Upload your EAF PDF before creating a schedule." });
      return;
    }

    const formData = new FormData();
    formData.append("eaf_pdf", file);
    formData.append("term_start", termStartDate);
    formData.append("weeks", numWeeks);
    recollectionFields.forEach((field) => {
      formData.append(`recollection_date_${field.code}`, recollectionDates[field.code] ?? "");
    });
    oneTimeCandidates.forEach((candidate) => {
      if (oneTimeChecked[candidate.code]) {
        formData.append(`one_time_date_${candidate.code}`, oneTimeDateFor(candidate));
      }
    });

    setIsGenerating(true);
    setStatusMessage("Creating your schedule...");

    try {
      const response = await fetch("/generate", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: formData,
      });

      if (!response.ok) {
        const { message } = await readErrorMessage(response, "Could not create the calendar file.");
        setSubmitError({ kind: "server", message });
        setStatusMessage(message);
        return;
      }

      const payload = await response.json();
      setDownloadUrl(payload.download_url || "");
      setGeneratedFilename(payload.generated_filename || generatedFilename);
      setGeneratedAt(payload.generated_at || "");
      setIsScheduleCreated(true);
      setDownloadError(null);
      setStatusMessage("Your calendar file is ready to download.");
    } catch {
      setSubmitError({
        kind: "transport",
        message: "Could not reach the app server. Your details are still here - try again.",
      });
      setStatusMessage("Could not reach the app server.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!downloadUrl) {
      setSubmitError({
        kind: "server",
        message: "The calendar file is not ready yet. Create the schedule again.",
      });
      setIsScheduleCreated(false);
      return;
    }

    // Fetched, not navigated to. Navigation hands the browser whatever the
    // server says, and for an expired token that is a redirect back to the
    // shell: the page reloads and the parsed schedule, the file and every
    // ambiguous-row decision go with it, for a link that had merely gone
    // stale. Reading the response here keeps all of it on screen and makes the
    // recovery one click instead of a re-upload.
    setDownloadError(null);

    try {
      const response = await fetch(downloadUrl, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const { message } = await readErrorMessage(
          response,
          "That download link expired. Create the schedule again.",
        );
        setDownloadError(message);
        setStatusMessage(message);
        return;
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = generatedFilename || "schedule.ics";
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoked on a delay rather than immediately: some browsers abort a
      // download whose object URL is released in the same tick as the click.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

      // Success was silent here. Both failure paths announced themselves and
      // the one that worked said nothing, so a screen reader user got no
      // confirmation the file had arrived - and the browser's own download
      // indicator is not something the page can rely on being heard.
      setStatusMessage("Downloaded. Next, import it into Google Calendar.");

      // Only on the success path. Pulling the page down to the import steps
      // while a download error is rendering above them would be perverse.
      // Unlike the two scrolls above, this one honours reduced motion.
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      window.setTimeout(() => {
        importStepsRef.current?.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start",
        });
      }, 300);
    } catch {
      setDownloadError(
        "Could not reach the app server. Your schedule is still here - try again.",
      );
      setStatusMessage("Could not reach the app server.");
    }
  };

  const courseSummaries = useMemo(
    () => buildCourseSummaries(inspectedEvents),
    [inspectedEvents],
  );
  const ambiguousRowGroups = useMemo<AmbiguousRowGroup[]>(() => {
    const grouped = new Map<string, AmbiguousRow[]>();
    ambiguousRows.forEach((row) => {
      const existing = grouped.get(row.code);
      if (existing) {
        existing.push(row);
      } else {
        grouped.set(row.code, [row]);
      }
    });
    return Array.from(grouped.entries()).map(([code, rows]) => ({ code, rows }));
  }, [ambiguousRows]);

  const handleCopyReport = async () => {
    const report = [
      "EAF Schedulr - rows that could not be read",
      "",
      ...ambiguousRows.map(
        (row) => `[${row.code}] row ${row.row_number}: ${row.text}\n  reason: ${row.reason}`,
      ),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(report);
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2000);
    } catch {
      setReportCopied(false);
    }
  };

  const uniqueCourseCount = new Set(inspectedEvents.map((event) => event.code)).size;
  const coursePreview = showAllCourses ? courseSummaries : courseSummaries.slice(0, 4);
  const hasMoreCourses = courseSummaries.length > 4;
  const remainingCourses = Math.max(0, courseSummaries.length - 4);

  /* The consent bar floats over the page rather than displacing it, so the
     page has to grow by its height for as long as it is up. Without this the
     upload dropzone can sit underneath the bar on a short phone screen with no
     way to scroll it clear. ConsentBanner measures itself and publishes the
     variable; it is absent, and the fallback applies, whenever the bar is not
     rendered. */
  const consentBarInset = { paddingBottom: "var(--consent-bar-h, 0px)" };

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-slate-950 dark:via-slate-900 dark:to-emerald-950/40 relative transition-colors duration-300"
      style={consentBarInset}
    >
      {/* Decorative background elements.
          The clipping lives here, on the decoration, and not on the page root.
          Two 384px circles carrying a 64px blur hang off opposite corners and
          would otherwise push the page sideways, so something has to contain
          them - but when `overflow-hidden` sat on the root it contained the
          content too. At 200% text the headline was not wrapped or scrolled
          but cut off, with no scrollbar to reach the rest: text resized, text
          lost. Scoping it to a sibling layer keeps the circles in and lets
          everything the student actually reads overflow honestly. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-200 dark:bg-emerald-500/20 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-3xl opacity-20 dark:opacity-30"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-teal-200 dark:bg-teal-500/20 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-3xl opacity-20 dark:opacity-30"></div>
      </div>

      {/* Parsing, validation and generation all happen without a page change,
          so screen readers need them narrated. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {statusMessage}
      </div>

      {/* Ahead of every other focusable thing on the page, because the form
          is a long way down and tabbing to it is the slowest way there. */}
      <a
        href="#main-content"
        className="sr-only rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-lg outline-none focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:ring-2 focus:ring-ring"
      >
        Skip to the schedule
      </a>

      {/* Placed here, right behind the skip link, so a screen reader meets it
          near the top of the page even though it paints at the bottom of the
          viewport. Asked once: after an answer it never returns, and the
          standing checkbox in the Privacy Notice takes over. */}
      {analyticsConsent === "unset" && (
        <ConsentBanner onDecide={handleConsent} onOpenPrivacy={openPrivacy} />
      )}

      <header className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16 lg:pt-20">
        <div className="flex items-center justify-between mb-12 sm:mb-16">
          <div className="flex items-center gap-2">
            <img
              src="/schedulr-logo.svg"
              alt="EAF Schedulr logo"
              className="w-6 h-6"
            />
            <span className="tracking-tight text-gray-900 dark:text-white text-lg font-medium">EAF Schedulr</span>
          </div>

          {/* Dark Mode Toggle */}
          <button
            onClick={() => {
              // The first tap leaves `system` for good. That is the trade the
              // two-icon header buys: one obvious control, no hidden third stop.
              const chosen = isDarkMode ? "light" : "dark";
              setThemePreference(chosen);
              writePreference(chosen);
            }}
            className="p-3 rounded-xl bg-white/60 dark:bg-slate-800/80 backdrop-blur-sm border border-gray-200 dark:border-emerald-500/30 hover:bg-white dark:hover:bg-slate-700/90 transition-all duration-200 shadow-md hover:shadow-lg dark:shadow-emerald-500/10 dark:hover:shadow-emerald-500/20"
            aria-label={isDarkMode ? "Switch to light theme" : "Switch to dark theme"}
          >
            {isDarkMode ? (
              <Sun className="w-5 h-5 text-amber-400 dark:drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
            ) : (
              <Moon className="w-5 h-5 text-gray-600" />
            )}
          </button>
        </div>
      </header>

      <main id="main-content" className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12 sm:pb-16 lg:pb-20">
        {/* Hero Section */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-16 items-start lg:min-h-[420px] mb-16 sm:mb-20">
          <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col items-center space-y-8 text-center lg:items-start lg:text-left self-center">
            <div className="space-y-5">
              <div className="inline-flex max-w-full items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/40 rounded-full backdrop-blur-sm">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400"></span>
                <span className="min-w-0 text-sm text-emerald-700 dark:text-emerald-300">Built for DLSU students</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-7xl text-gray-900 dark:text-white leading-[1.1] tracking-tight hyphens-auto break-words">
                Turn your EAF into your class schedule <span className="text-emerald-600 dark:text-emerald-400">instantly.</span>
              </h1>

              <p className="text-lg sm:text-2xl text-muted-foreground leading-relaxed">
                Upload your EAF and get a ready-to-use Google Calendar in seconds.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <button
                onClick={scrollToUpload}
                className="group px-6 sm:px-8 py-4 bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-800 hover:to-teal-800 text-white rounded-2xl transition-all duration-300 shadow-lg shadow-emerald-700/30 hover:shadow-xl hover:shadow-emerald-700/40 hover:-translate-y-0.5 flex items-center justify-center gap-2"
              >
                Create my schedule
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <button
                onClick={triggerFileUpload}
                className="px-6 sm:px-8 py-4 bg-white/80 dark:bg-slate-700/60 backdrop-blur-sm hover:bg-white dark:hover:bg-slate-700/80 text-emerald-700 dark:text-emerald-300 rounded-2xl border border-emerald-200 dark:border-emerald-500/40 transition-all duration-300 shadow-md hover:shadow-lg hover:-translate-y-0.5"
              >
                Upload EAF
              </button>
            </div>
          </div>

          {/* Workflow Card - Glass morphism */}
          <GlassCard shadow="2xl" className="w-full max-w-lg justify-self-center p-8 lg:mt-4 lg:justify-self-end">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-1 h-6 bg-gradient-to-b from-emerald-600 to-teal-600 dark:from-emerald-400 dark:to-teal-400 rounded-full shadow-lg dark:shadow-emerald-400/50"></div>
              <h2 className="text-xl font-semibold text-foreground">How it works</h2>
            </div>

            <div className="space-y-4">
              <div className="group flex items-start gap-4 p-4 rounded-2xl hover:bg-white/80 dark:hover:bg-slate-700/40 transition-all duration-300">
                <IconTile tone="emerald" className="transition-transform duration-300 group-hover:scale-110">
                  <span className="text-lg">1</span>
                </IconTile>
                <div className="min-w-0 pt-0.5">
                  <h3 className="text-foreground mb-1.5">Upload</h3>
                  <p className="text-muted-foreground text-base leading-relaxed">Upload your latest Archers Hub EAF PDF.</p>
                </div>
              </div>

              <div className="group flex items-start gap-4 p-4 rounded-2xl hover:bg-white/80 dark:hover:bg-slate-700/40 transition-all duration-300">
                <IconTile tone="teal" className="transition-transform duration-300 group-hover:scale-110">
                  <span className="text-lg">2</span>
                </IconTile>
                <div className="min-w-0 pt-0.5">
                  <h3 className="text-foreground mb-1.5">Review</h3>
                  <p className="text-muted-foreground text-base leading-relaxed">Adjust schedule details and generate a ready-to-import .ics calendar file.</p>
                </div>
              </div>

              <div className="group flex items-start gap-4 p-4 rounded-2xl hover:bg-white/80 dark:hover:bg-slate-700/40 transition-all duration-300">
                <IconTile tone="brand" className="shadow-emerald-700/30 dark:shadow-emerald-400/30 transition-transform duration-300 group-hover:scale-110">
                  <span className="text-lg">3</span>
                </IconTile>
                <div className="min-w-0 pt-0.5">
                  <h3 className="text-foreground mb-1.5">Import</h3>
                  <p className="text-muted-foreground text-base leading-relaxed">Import your schedule into Google Calendar securely. Files are processed in memory only.</p>
                </div>
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Upload Section - Glass morphism */}
        <GlassCard ref={uploadSectionRef} className="-mt-10 mb-6 p-6 sm:p-8 lg:-mt-14">
          <div className="flex items-center gap-3 mb-6">
            <IconTile tone="brand" size="sm">
              <FileText className="w-5 h-5" />
            </IconTile>
            <h2 className="text-2xl text-foreground">Upload your EAF</h2>
          </div>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`group relative border-2 border-dashed rounded-3xl p-8 sm:p-12 lg:p-16 text-center transition-all duration-300 ${
              isDragging
                ? "border-emerald-500 dark:border-emerald-400 bg-emerald-50/50 dark:bg-emerald-500/10 scale-[1.01]"
                : file
                ? "border-emerald-400 dark:border-emerald-500/60 bg-gradient-to-br from-emerald-50/40 to-teal-50/40 dark:from-emerald-500/5 dark:to-teal-500/5"
                : "border-gray-300 dark:border-slate-600 bg-gradient-to-br from-gray-50/30 to-white/30 dark:from-slate-800/30 dark:to-slate-700/20 hover:border-emerald-400 dark:hover:border-emerald-500/60 hover:from-emerald-50/20 hover:to-teal-50/20 dark:hover:from-emerald-500/10 dark:hover:to-teal-500/10"
            }`}
          >
            {/* Background pattern */}
            <div aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-[inherit] opacity-[0.02]" style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}></div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer block relative z-10">
              {/* The one tile that is not an <IconTile>, because its fill is a
                  three-way state - waiting, hovered, holding a file - rather
                  than a tone. It still owes the tile system its values: left on
                  the old emerald-500 it drifted a full step lighter than every
                  other tile the moment those were corrected, and its icon sat
                  at 2.1:1. Fill and foreground move together here for the same
                  reason they do in IconTile's TONES. */}
              <div className={`w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br flex items-center justify-center transition-all duration-300 ${
                file
                  ? "from-emerald-700 to-teal-800 text-white dark:from-emerald-400 dark:to-teal-500 dark:text-slate-900 shadow-xl shadow-emerald-700/40 dark:shadow-emerald-400/30 scale-110"
                  : "from-gray-500 to-gray-600 text-white dark:from-slate-600 dark:to-slate-700 group-hover:from-emerald-700 group-hover:to-teal-800 dark:group-hover:from-emerald-400 dark:group-hover:to-teal-500 dark:group-hover:text-slate-900 group-hover:shadow-lg group-hover:shadow-emerald-700/30 dark:group-hover:shadow-emerald-400/20 group-hover:scale-105"
              }`}>
                <Upload className={`w-10 h-10 transition-transform duration-300 ${file ? '' : 'group-hover:-translate-y-1'}`} />
              </div>

              {file ? (
                <div className="space-y-3">
                  <div className={`inline-flex items-center gap-2 px-4 py-2 bg-emerald-100 dark:bg-emerald-500/20 rounded-full border border-emerald-200 dark:border-emerald-500/30 ${isInspecting ? "animate-pulse" : ""}`}>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-sm text-emerald-700 dark:text-emerald-300">
                      {isInspecting ? "Reading your EAF" : "File uploaded"}
                    </span>
                  </div>
                  <p className="text-xl text-foreground break-all px-4">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {isInspecting ? "Looking for your schedule" : "Ready to process"} • {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xl sm:text-2xl text-gray-800 dark:text-gray-100">Drag and drop your EAF PDF here</p>
                  <p className="text-sm sm:text-base text-subtle-foreground">or click to browse your files</p>
                  <div className="pt-2">
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 dark:bg-gray-700/50 rounded-full text-xs text-subtle-foreground dark:text-gray-400 border border-gray-200 dark:border-gray-600">
                      <FileText className="w-3.5 h-3.5" />
                      PDF only, up to 10MB
                    </span>
                  </div>
                </div>
              )}
            </label>
          </div>
        </GlassCard>
        
        {/* The file itself is unusable, so the form is replaced until a new upload. */}
        {parseError && !isScheduleCreated && (
          <div ref={parseErrorRef}>
          <Alert
            tone="danger"
            className="mb-12"
            title={
              parseError.kind === "transport" ? "Can't reach the server" : "This file can't be read"
            }
            message={parseError.message}
          >
            <AmbiguousRowList groups={ambiguousRowGroups} tone="danger" />
          </Alert>
          </div>
        )}

        {file && !isScheduleCreated && !parseError && (
          <>
            {ambiguousRowGroups.length > 0 && (
              <Alert
                tone="warning"
                className="mb-12"
                title={
                  ambiguousRows.length === 1
                    ? "1 row could not be read"
                    : `${ambiguousRows.length} rows could not be read`
                }
                message="Everything else parsed fine, and your calendar will be created without these. Add them to Google Calendar yourself, and please send us the report so the reader can be fixed."
              >
                    <AmbiguousRowList groups={ambiguousRowGroups} tone="warning" />

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={handleCopyReport}
                        className="px-4 py-2 rounded-xl text-sm bg-amber-700 text-white hover:bg-amber-800 transition-colors shadow-lg shadow-amber-900/20"
                      >
                        {reportCopied ? "Copied to clipboard" : "Copy report"}
                      </button>
                      <a
                        href="https://github.com/Stilsi-dev/EAFSchedulr/issues"
                        target="_blank"
                        rel="noreferrer"
                        className="px-4 py-2 rounded-xl text-sm border border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-100 hover:bg-amber-100/60 dark:hover:bg-amber-500/10 transition-colors"
                      >
                        Report on GitHub
                      </a>
                    </div>

                    <label className="flex items-start gap-3 cursor-pointer rounded-xl bg-card-well border border-amber-200/70 dark:border-amber-500/20 p-4">
                      <input
                        type="checkbox"
                        checked={acknowledgedMissingRows}
                        onChange={(e) => setAcknowledgedMissingRows(e.target.checked)}
                        aria-invalid={Boolean(validationErrors.acknowledgeRows)}
                        aria-describedby={validationErrors.acknowledgeRows ? "acknowledge-rows-error" : undefined}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-amber-600"
                      />
                      <span className="text-sm text-amber-900 dark:text-amber-100 leading-relaxed">
                        I understand these classes will not be in my calendar, and I will add them myself.
                      </span>
                    </label>

                    {validationErrors.acknowledgeRows && (
                      <p id="acknowledge-rows-error" className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-300">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{validationErrors.acknowledgeRows}</span>
                      </p>
                    )}
              </Alert>
            )}

            <GlassCard ref={scheduleDetailsRef} className="mb-12 p-6 sm:p-8">
              <h2 className="text-2xl text-foreground mb-8">Schedule details</h2>

              <div className="grid sm:grid-cols-2 gap-6 mb-8">
                <Field
                  id="start-date"
                  type="date"
                  label="Term start date"
                  required
                  value={termStartDate}
                  onChange={setTermStartDate}
                  error={validationErrors.termStartDate}
                />

                <Field
                  id="num-weeks"
                  type="number"
                  label="Number of weeks"
                  required
                  placeholder="14"
                  value={numWeeks}
                  onChange={setNumWeeks}
                  min={1}
                  max={52}
                  step={1}
                  inputMode="numeric"
                  hint="A DLSU term is usually 14 weeks."
                  error={validationErrors.numWeeks}
                />
              </div>

              {hasLasallianRecollection && (
                <div className="border-t border-gray-200/50 dark:border-slate-600/30 pt-8">
                  <div className="space-y-2 mb-6">
                    <h3 className="text-lg text-foreground">
                      {recollectionFields.length === 1 ? "Lasallian Recollection" : "Lasallian Recollections"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {recollectionFields.length === 1
                        ? "Your EAF includes one recollection. Pick the exact date it takes place."
                        : `Your EAF includes ${recollectionFields.length} recollections. Pick the exact date for each one - they can fall on different days.`}
                    </p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-6">
                    {recollectionFields.map((field) => {
                      const fieldId = `recollection-date-${field.code}`;
                      const fieldError = validationErrors.recollections?.[field.code];
                      const weekdayHint = formatWeekdayList(field.days);

                      return (
                        <Field
                          key={field.code}
                          id={fieldId}
                          type="date"
                          label={formatCourseName(field.name)}
                          required
                          value={recollectionDates[field.code] ?? ""}
                          onChange={(value) =>
                            setRecollectionDates((current) => ({
                              ...current,
                              [field.code]: value,
                            }))
                          }
                          /* The weekday is stated up front so the date picker is a
                             confirmation rather than a guess the server rejects. */
                          hint={weekdayHint ? `${field.code} falls on a ${weekdayHint}.` : undefined}
                          error={fieldError}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {hasOneTimeCandidates && (
                <div className="border-t border-gray-200/50 dark:border-slate-600/30 pt-8">
                  <div className="space-y-2 mb-6">
                    <h3 className="text-lg text-foreground">One-time sessions</h3>
                    <p className="text-sm text-muted-foreground">
                      Orientations and seminars sometimes meet once instead of every
                      week. Tick any that meet only once and pick the date. Leave them
                      alone and they repeat weekly, like the rest of your schedule.
                    </p>
                  </div>

                  <div className="space-y-6">
                    {oneTimeCandidates.map((candidate) => {
                      const checked = oneTimeChecked[candidate.code] ?? false;
                      const weekdayHint = formatWeekdayList(candidate.days);

                      return (
                        <div key={candidate.code} className="space-y-3">
                          <label
                            className="flex items-start gap-3 cursor-pointer"
                            htmlFor={`one-time-toggle-${candidate.code}`}
                          >
                            <input
                              id={`one-time-toggle-${candidate.code}`}
                              type="checkbox"
                              className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                              checked={checked}
                              onChange={(event) =>
                                setOneTimeChecked((current) => ({
                                  ...current,
                                  [candidate.code]: event.target.checked,
                                }))
                              }
                            />
                            <span className="text-sm">
                              <span className="text-foreground">
                                {formatCourseName(candidate.name)}
                              </span>
                              <span className="block text-muted-foreground">
                                {candidate.code} meets only once
                              </span>
                            </span>
                          </label>

                          {/* The date only appears once the student has said the
                              session is one-time, so an untouched course shows no
                              field to answer and nothing to get wrong. */}
                          {checked && (
                            <div className="pl-7 sm:max-w-xs">
                              <Field
                                id={`one-time-date-${candidate.code}`}
                                type="date"
                                label="Date"
                                required
                                value={oneTimeDateFor(candidate)}
                                onChange={(value) =>
                                  setOneTimeDates((current) => ({
                                    ...current,
                                    [candidate.code]: value,
                                  }))
                                }
                                hint={weekdayHint ? `${candidate.code} falls on a ${weekdayHint}.` : undefined}
                                error={validationErrors.oneTimeSessions?.[candidate.code]}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </GlassCard>

            {/* Creating the calendar failed. The form above keeps every value the
                student entered, so recovery is one button rather than a re-upload. */}
            {submitError && (
              <Alert
                tone="danger"
                variant="inline"
                className="mb-6"
                title={
                  submitError.kind === "transport"
                    ? "Couldn't reach the server"
                    : "Couldn't create your calendar"
                }
                message={submitError.message}
              >
                <button
                  type="button"
                  onClick={handleCreateSchedule}
                  disabled={isGenerating}
                  className="rounded-xl border border-rose-300 px-5 py-3 text-sm text-rose-900 transition-colors hover:bg-rose-100/60 disabled:cursor-wait disabled:opacity-70 dark:border-rose-500/40 dark:text-rose-100 dark:hover:bg-rose-500/10"
                >
                  {isGenerating ? "Trying again..." : "Try again"}
                </button>
              </Alert>
            )}

            {/* CTA Area */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
              <button
                onClick={handleCreateSchedule}
                disabled={isGenerating}
                className="group px-6 sm:px-10 py-4 bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-800 hover:to-teal-800 disabled:from-emerald-600 disabled:to-teal-600 disabled:cursor-wait text-white rounded-2xl transition-all duration-300 shadow-xl shadow-emerald-700/30 hover:shadow-2xl hover:shadow-emerald-700/40 hover:-translate-y-1 disabled:hover:translate-y-0 flex items-center gap-3"
              >
                <Calendar className="w-5 h-5" />
                {isGenerating ? "Creating schedule..." : "Create my schedule"}
              </button>
              <button
                onClick={handleClear}
                className="px-6 sm:px-10 py-4 bg-white/80 dark:bg-slate-700/60 backdrop-blur-sm hover:bg-white dark:hover:bg-slate-700/80 text-gray-700 dark:text-gray-200 rounded-2xl border border-gray-200 dark:border-slate-600 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-1"
              >
                Clear and upload again
              </button>
            </div>
          </>
        )}

        {/* Success Section - Shows after schedule is created */}
        {isScheduleCreated && (
          <div ref={successSectionRef} className="relative pb-8">
            {/* Decorative elements */}
            <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-40 h-40 bg-emerald-300 rounded-full mix-blend-multiply filter blur-3xl opacity-30"></div>

            {/* Success Header Card */}
            <div className="relative mx-auto max-w-4xl bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-800 rounded-[2rem] shadow-2xl shadow-emerald-900/40 p-6 sm:p-8 lg:p-10 mb-6 overflow-hidden">
              {/* Decorative circles */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl"></div>
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-teal-400/20 rounded-full blur-2xl"></div>

              <div className="relative z-10">
                <div className="mx-auto flex w-full max-w-xl flex-col items-center text-center">
                  <div className="relative mb-6">
                    <div aria-hidden="true" className="seal-bloom absolute inset-0 rounded-full bg-white blur-xl"></div>
                    <div className="seal relative flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-xl">
                      <CheckCircle2 className="w-8 h-8 text-emerald-600" strokeWidth={2.5} />
                    </div>
                  </div>

                  <h2 className="text-3xl sm:text-4xl text-white mb-3">
                    All set!
                  </h2>
                  <p className="text-base sm:text-lg text-emerald-100 mb-8">Your calendar file is ready to download.</p>

                  <div className="w-full rounded-2xl border border-emerald-900/40 bg-emerald-950/25 p-5 text-left backdrop-blur-sm">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-100">Filename</p>
                    <p className="break-all font-mono text-sm font-semibold leading-relaxed text-white">
                      {generatedFilename}
                    </p>
                    <div className="mt-5 flex items-start gap-2 text-xs text-emerald-100">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <p className="max-w-[60ch] leading-relaxed">
                        Compatible with Google Calendar, Apple Calendar, Outlook, and other calendar apps
                      </p>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-xs text-emerald-100">
                      <div className="h-1.5 w-1.5 rounded-full bg-emerald-100"></div>
                      <span className="tabular-nums">Generated at {generatedAt || "just now"}</span>
                    </div>
                  </div>

                  <button
                    onClick={handleDownload}
                    className="group mt-6 flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-8 py-4 text-emerald-700 shadow-xl transition-all duration-300 hover:-translate-y-1 hover:scale-[1.01] hover:bg-gray-50 hover:shadow-2xl sm:max-w-md"
                  >
                    <Download className="h-5 w-5 transition-transform duration-200 ease-out group-hover:translate-y-0.5" />
                    <span className="text-lg">Download .ics file</span>
                  </button>
                </div>
              </div>
            </div>

            {/* The link expired, or the network dropped. The schedule, the file
                and every form value are still here, so the way out is one button
                rather than another upload. */}
            {downloadError && (
              <Alert
                tone="danger"
                variant="inline"
                className="mx-auto mb-6 max-w-4xl"
                title="Couldn't download your calendar"
                message={downloadError}
              >
                <button
                  type="button"
                  onClick={handleCreateSchedule}
                  disabled={isGenerating}
                  className="rounded-xl border border-rose-300 px-5 py-3 text-sm text-rose-900 transition-colors hover:bg-rose-100/60 disabled:cursor-wait disabled:opacity-70 dark:border-rose-500/40 dark:text-rose-100 dark:hover:bg-rose-500/10"
                >
                  Create the schedule again
                </button>
              </Alert>
            )}

            {/* Content Cards Container */}
            <div className="space-y-6">

                {/* The ref lives here rather than inside the component: only
                    shared primitives forward refs, and this is a one-off. */}
                <div ref={importStepsRef} className="scroll-mt-8">
                  <ImportSteps />
                </div>

                {/* Schedule Summary - Consistent Cards */}
                <div className="space-y-6 mb-10 animate-in fade-in slide-in-from-bottom-4 duration-400">
                  {/* Courses Card */}
                  <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/70 dark:from-emerald-900/20 dark:to-emerald-800/20 backdrop-blur-sm rounded-3xl p-6 sm:p-8 border border-emerald-200/50 dark:border-emerald-700/30 shadow-xl shadow-emerald-500/5">
                    <div className="w-full flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="absolute inset-0 bg-gradient-to-br from-emerald-400 to-emerald-500 rounded-2xl blur-md opacity-25"></div>
                          <IconTile tone="emerald" size="lg" className="relative">
                            <BookOpen className="w-8 h-8" />
                          </IconTile>
                        </div>
                        <div className="text-left">
                          <p className="text-4xl font-medium leading-none text-foreground mb-0.5 tabular-nums">{courseSummaries.length}</p>
                          <p className="text-base font-medium text-label-foreground">Courses</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-3 animate-in fade-in slide-in-from-top-2 duration-300 md:grid-cols-2 xl:grid-cols-4">
                        {coursePreview.map((course) => {
                          const displayCourseName = formatCourseName(course.courseName);

                          return (
                            <div
                              key={course.code}
                              className="flex h-full min-h-[150px] flex-col rounded-3xl border border-emerald-200/40 bg-white/85 p-4 shadow-lg shadow-emerald-500/5 backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:bg-white hover:shadow-xl hover:shadow-emerald-500/10 dark:border-emerald-500/20 dark:bg-slate-700/40 dark:hover:bg-slate-700/60"
                            >
                              {/* Header */}
                              <div className="flex items-center justify-between gap-3">
                                {/* Course Code */}
                                <span className="inline-flex min-w-0 items-center rounded-full bg-emerald-500/10 px-2.5 py-1 text-sm font-semibold tracking-wide text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">
                                  {course.code}
                                </span>

                                {/* Section Code */}
                                <span className="flex-shrink-0 rounded-full px-1 text-xs font-semibold text-subtle-foreground">
                                  {course.sectionCode}
                                </span>
                              </div>
                              
                              {/* Course Name */}
                              <p
                                title={displayCourseName}
                                className="mt-3 w-full text-sm font-semibold leading-snug text-strong-foreground"
                                style={{
                                  display: "-webkit-box",
                                  WebkitBoxOrient: "vertical",
                                  WebkitLineClamp: 2,
                                  overflow: "hidden",
                                }}
                              >
                                {displayCourseName}
                              </p>

                              <div className="mt-2 flex items-center justify-between gap-2 rounded-2xl bg-slate-50/80 px-3 py-2 text-[13px] text-gray-500 dark:bg-slate-900/30 dark:text-gray-400">
                                <span className="inline-flex items-center gap-1.5">
                                  <Calendar className="h-3 w-3 opacity-60" />
                                  <span className="leading-none">{course.hasRecollection && recollectionDates[course.code] ? "One-time date" : "Recurring weekly"}</span>
                                </span>
                                {/* The slot beside the label carries the value, not the
                                    label again: a recollection shows the date it lands
                                    on, so a weekly course shows how long it runs. It
                                    used to read "Recurring weekly - Weekly", which said
                                    the same thing twice and left the one number the
                                    student actually chose off the summary. */}
                                {course.hasRecollection && recollectionDates[course.code] ? (
                                  <DatePill date={recollectionDates[course.code]} />
                                ) : (
                                  <span className="text-subtle-foreground tabular-nums">
                                    {Number(numWeeks) > 0
                                      ? `${numWeeks} ${Number(numWeeks) === 1 ? "week" : "weeks"}`
                                      : "Every week"}
                                  </span>
                                )}
                              </div>

                              {/* Schedule */}
                              <div className="mt-5 space-y-3">
                                {course.meetingGroups.map((meetingGroup) => {
                                  const perDayLocation =
                                    meetingGroup.days.length === meetingGroup.locations.length;

                                  return (
                                    <div
                                      key={`${course.code}-${meetingGroup.days.join("-")}-${meetingGroup.startTime}`}
                                    >
                                      <div className="space-y-2 text-sm">
                                        {meetingGroup.days.map((day, idx) => (
                                          <div
                                            key={`${course.code}-${meetingGroup.startTime}-${day}`}
                                            className="grid grid-cols-[2.5rem_minmax(7.5rem,1fr)_3.25rem] items-baseline gap-2"
                                          >
                                            <span className="text-sm font-semibold text-label-foreground">
                                              {day}
                                            </span>

                                            <span className="whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                                              {meetingGroup.startTime} - {meetingGroup.endTime}
                                            </span>

                                            <span className="truncate text-right text-sm text-subtle-foreground">
                                              {perDayLocation
                                                ? meetingGroup.locations[idx]
                                                : meetingGroup.locations.length > 0
                                                ? meetingGroup.locations.join(" / ")
                                                : "No location listed"}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}

                        {/* Show More Button */}
                        {hasMoreCourses && (
                          <button
                            type="button"
                            onClick={() => setShowAllCourses(!showAllCourses)}
                            className="md:col-span-2 xl:col-span-4"
                            aria-label={
                              showAllCourses
                                ? "Show fewer courses"
                                : `View ${remainingCourses} more courses`
                            }
                          >
                            <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200/40 bg-emerald-50/80 px-4 py-3 text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100/80 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20">
                              <ArrowRight
                                className={`h-4 w-4 transition-transform duration-300 ${
                                  showAllCourses ? "rotate-180" : ""
                                }`}
                              />
                              <span className="text-sm font-semibold">
                                {showAllCourses
                                  ? "Show fewer courses"
                                  : `View ${remainingCourses} more courses`}
                              </span>
                            </div>
                          </button>
                        )}
                      </div>
                  </div>

                  {/* Calendar Events Card */}
                  <div className="bg-gradient-to-br from-teal-50 to-teal-100/70 dark:from-teal-900/20 dark:to-teal-800/20 backdrop-blur-sm rounded-3xl p-6 sm:p-8 border border-teal-200/50 dark:border-teal-700/30 shadow-xl shadow-teal-500/5">
                    <div className="w-full flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="absolute inset-0 bg-gradient-to-br from-teal-400 to-teal-500 rounded-2xl blur-md opacity-25"></div>
                          <IconTile tone="teal" size="lg" className="relative">
                            <CalendarDays className="w-8 h-8" />
                          </IconTile>
                        </div>
                        <div className="text-left">
                          <p className="text-4xl font-medium leading-none text-foreground mb-0.5 tabular-nums">{inspectedEvents.length}</p>
                          <p className="text-base font-medium text-label-foreground">Events Ready to Import</p>
                          <p className="mt-1 text-sm text-subtle-foreground">Includes all classes, recollections, and recurring sessions.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              {/* Action Button */}
              <div className="flex justify-center pt-4">
                <button
                  onClick={handleClear}
                  className="group px-6 sm:px-10 py-4 bg-white/80 dark:bg-gray-700/80 backdrop-blur-sm hover:bg-white dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-2xl border border-gray-200 dark:border-gray-600 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center gap-2"
                >
                  <ArrowRight className="w-5 h-5 rotate-180 group-hover:-translate-x-1 transition-transform" />
                  Create another schedule
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Privacy Notice. Still the `#privacy` anchor, because both "What we
            collect" links are real anchors first and only suppress their
            navigation once the dialog has taken over - so this stays the
            fallback destination on a browser without `showModal`. There is no
            policy page: the whole policy is three paragraphs, and a separate
            document would only drift away from what the code does. */}
        <div id="privacy" className="max-w-3xl mx-auto pt-12 pb-8 px-4 border-t border-gray-200/30 dark:border-slate-700/50 mt-16 scroll-mt-8">
          <div className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-sm text-subtle-foreground flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Privacy Notice
              </h3>
              {/* One paragraph, not three stacked lines: the promise, the current
                  state, and the way to the detail all belong to the same
                  thought, and breaking them apart gave a three-line block the
                  visual weight of three separate claims.

                  The switch itself lives in the dialog, which means the page no
                  longer shows the student what they chose - and the checkbox was
                  doing that job as much as it was offering the choice. Three
                  words of status put it back. `unset` reads as off because that
                  is the truth: nothing loads until someone agrees.

                  The status is withheld until there is a real answer to report.
                  While the bar is still asking, a flat "Analytics is off."
                  sitting further down the same page reads as though the question
                  had already been settled, and quietly argues with the thing
                  asking it. Only that sentence is conditional - the link is the
                  permanent way back into the dialog and must never go with it,
                  and the label matches the bar's because two names for one
                  destination would read as two destinations. */}
              <p className="max-w-[62ch] text-sm text-subtle-foreground leading-relaxed">
                {PRIVACY_SUMMARY}{" "}
                {analyticsConsent !== "unset" && (
                  <>{analyticsConsent === "granted" ? "Analytics is on." : "Analytics is off."}{" "}</>
                )}
                <a
                  href="#privacy"
                  onClick={(event) => {
                    if (openPrivacy()) {
                      event.preventDefault();
                    }
                  }}
                  className="rounded underline underline-offset-2 transition-colors hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-emerald-400"
                >
                  What we collect
                </a>
              </p>
            </div>

            <div>
              <p className="text-sm text-subtle-foreground mb-3">Need help?</p>
              <div className="flex flex-wrap gap-3 text-sm">
                <a
                  href="mailto:angelo_nuque@dlsu.edu.ph"
                  className="inline-flex min-w-0 items-center gap-1.5 py-2 text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                >
                  <Mail className="w-3.5 h-3.5 shrink-0" />
                  <span className="break-all">angelo_nuque@dlsu.edu.ph</span>
                </a>
                {/* A separator, not content. Left readable to a screen reader
                    it announces "bullet" between two links; hidden, it is also
                    exempt from the contrast floor it could never meet without
                    becoming louder than the links it separates. */}
                <span aria-hidden="true" className="text-gray-300 dark:text-gray-600">•</span>
                <a
                  href="https://github.com/Stilsi-dev/EAFSchedulr/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 py-2 text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                >
                  <Github className="w-3.5 h-3.5 shrink-0" />
                  <span>Report on GitHub</span>
                </a>
              </div>
            </div>
          </div>
        </div>

      </main>

      {/* Footer - Always at bottom */}
      <footer className="w-full border-t border-gray-200/30 dark:border-slate-700/50 bg-white/40 dark:bg-slate-900/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <span>Made by a Lasallian</span>
            {/* One step down from emerald-500, which measured 2.4:1 here and
                read as a pale smudge rather than a mark of authorship. Dark
                mode keeps its lighter fill and its glow. */}
            <Heart className="w-4 h-4 text-emerald-600 dark:text-emerald-400 fill-emerald-600 dark:fill-emerald-400 dark:drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]" />
            <span>for Lasallians</span>
          </div>
        </div>
      </footer>

      <PrivacyDialog
        open={isPrivacyOpen}
        onClose={() => setIsPrivacyOpen(false)}
        consent={analyticsConsent}
        onConsentChange={handleConsent}
      />
    </div>
  );
}

function formatDisplayDate(dateValue: string) {
  try {
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  } catch {
    return "";
  }
}

function DatePill({ date }: { date: string }) {
  if (!date) return null;

  return (
    <div className="inline-flex items-center gap-1.5 text-[13px] text-subtle-foreground">
      <Calendar className="w-3 h-3 opacity-60" />
      <span className="leading-none tabular-nums">{formatDisplayDate(date)}</span>
    </div>
  );
}
/**
 * What to do with the file once it is on disk.
 *
 * The app's last mile is a file, not a synced calendar, so this is a step in
 * the flow rather than reference material: always rendered, never collapsed,
 * and above the schedule summary, because importing is the next action and
 * reviewing the parse is optional.
 *
 * Google is the only one of the three that earns numbered steps. Its import
 * lives in Settings and cannot be reached by opening the file, while Apple
 * Calendar and Outlook are close enough to a double-click that giving them
 * equal weight would misrepresent equal difficulty.
 */
function ImportSteps() {
  return (
    <div className="bg-gradient-to-br from-teal-50 to-teal-100/70 dark:from-teal-900/20 dark:to-teal-800/20 backdrop-blur-sm rounded-3xl p-6 sm:p-8 border border-teal-200/50 dark:border-teal-700/30 shadow-xl shadow-teal-500/5">
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-br from-teal-400 to-teal-500 rounded-2xl blur-md opacity-25"></div>
          <IconTile tone="teal" size="lg" className="relative">
            <CalendarPlus className="w-8 h-8" />
          </IconTile>
        </div>
        <div className="text-left">
          <h3 className="text-xl font-medium text-foreground">Import it into your calendar</h3>
          <p className="mt-1 text-sm text-subtle-foreground">Takes about a minute.</p>
        </div>
      </div>

      {/* Unconditional, and not behind a viewport check. Google Calendar's
          mobile apps have no import at all, so a student who runs this on a
          phone hits a dead end no wording can rescue. Width is not device: a
          narrow desktop window would be told to go and find the computer it is
          already running on, and the student planning ahead on a laptop would
          never learn the constraint. One line everyone reads is the honest
          shape. */}
      <p className="mt-6 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
        Google Calendar only imports from a computer. If you are on your phone, save the file
        now and finish these steps on a desktop browser.
      </p>

      <div className="mt-6">
        <p className="text-sm font-semibold text-label-foreground">Google Calendar</p>
        <ol className="mt-3 max-w-[68ch] list-decimal space-y-3 pl-5 text-sm leading-relaxed text-muted-foreground marker:font-semibold marker:text-teal-700 dark:marker:text-teal-300">
          {/* Step one on purpose. Every generation mints fresh event UIDs, so a
              student who regenerates and imports again stacks a second
              timetable on the first, with no bulk undo in Google Calendar. A
              term on its own calendar is one click to delete. The reason
              trails the list rather than living in the step: people follow
              numbered lists, and an item that argues with you reads as a
              warning and gets skipped. */}
          <li>
            In Google Calendar on a computer, create a new calendar for this term. In the left
            sidebar, next to <span className="text-label-foreground">Other calendars</span>, click
            + and then <span className="text-label-foreground">Create new calendar</span>.
          </li>
          <li>
            Go to <span className="text-label-foreground">Settings</span>, then{" "}
            <span className="text-label-foreground">Import &amp; export</span>.
          </li>
          <li>Choose the .ics file you just downloaded.</li>
          <li>
            Under <span className="text-label-foreground">Add to calendar</span>, pick the calendar
            you made in step 1, then click <span className="text-label-foreground">Import</span>.
          </li>
        </ol>

        {/* The written path above is the one that survives. This link opens a
            new tab, so our text is no longer in front of the student once they
            are over there - and it is deliberately account-neutral, with no
            `/u/0/`, because students commonly have a personal and a DLSU
            account signed in at once and pinning index 0 lands them in
            whichever they logged into first. */}
        <a
          href="https://calendar.google.com/calendar/r/settings/export"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-teal-200/60 bg-white/70 px-4 py-2.5 text-sm font-semibold text-teal-700 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-teal-500/25 dark:bg-slate-700/40 dark:text-teal-200 dark:hover:bg-slate-700/60"
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          Open Google Calendar import
        </a>

        <p className="mt-4 max-w-[68ch] text-sm leading-relaxed text-subtle-foreground">
          Keeping the term on its own calendar lets you hide it in one toggle, and delete the whole
          thing in one click if you ever need to generate a corrected file.
        </p>
      </div>

      <div className="mt-6 space-y-2 border-t border-teal-200/50 pt-5 text-sm leading-relaxed text-muted-foreground dark:border-teal-700/30">
        <p className="max-w-[68ch]">
          <span className="font-semibold text-label-foreground">Apple Calendar</span> · Open the
          .ics file and choose which calendar to add it to.
        </p>
        <p className="max-w-[68ch]">
          <span className="font-semibold text-label-foreground">Outlook</span> · On the web,{" "}
          <span className="text-label-foreground">Add calendar</span>, then{" "}
          <span className="text-label-foreground">Upload from file</span>. In the desktop app,
          File → Open &amp; Export → Import/Export.
        </p>
      </div>
    </div>
  );
}
