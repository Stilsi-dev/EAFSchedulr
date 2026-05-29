import { useState, useRef, useEffect, useMemo, type ChangeEvent, type DragEvent } from "react";
import { Upload, Calendar, CheckCircle2, AlertCircle, Sparkles, FileText, ArrowRight, Download, BookOpen, CalendarDays, Shield, Mail, Github, Heart, MapPin, Moon, Sun } from "lucide-react";

const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function getSelectedWeekday(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) {
    return "";
  }

  return WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()];
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
  row_number: number;
  text: string;
  reason: string;
};

type AmbiguousRowGroup = {
  code: string;
  rows: AmbiguousRow[];
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
  const [lasareDate, setLasareDate] = useState("");
  const [validationErrors, setValidationErrors] = useState<{
    termStartDate?: string;
    numWeeks?: string;
    lasareDate?: string;
    general?: string;
  }>({});
  const [ambiguousRows, setAmbiguousRows] = useState<AmbiguousRowGroup[]>([]);
  const [hasLasallianRecollection, setHasLasallianRecollection] = useState(false);
  const [recollectionWeekdays, setRecollectionWeekdays] = useState<string[]>([]);
  const [inspectedEvents, setInspectedEvents] = useState<InspectedEvent[]>([]);
  const [generatedFilename, setGeneratedFilename] = useState("eaf-calendar.ics");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("");
  const [isScheduleCreated, setIsScheduleCreated] = useState(false);
  const [showAllCourses, setShowAllCourses] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('darkMode');
      return saved ? JSON.parse(saved) : false;
    }
    return false;
  });

  const uploadSectionRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scheduleDetailsRef = useRef<HTMLDivElement>(null);
  const successSectionRef = useRef<HTMLDivElement>(null);

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (file && !isScheduleCreated) {
      setTimeout(() => {
        scheduleDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    }
  }, [file, isScheduleCreated]);

  useEffect(() => {
    if (isScheduleCreated) {
      setTimeout(() => {
        successSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 500);
    }
  }, [isScheduleCreated]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('darkMode', JSON.stringify(isDarkMode));
      if (isDarkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, [isDarkMode]);

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
    if (droppedFile?.type === "application/pdf") {
      void inspectFile(droppedFile);
    }
  };

  const inspectFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setValidationErrors({});
    setAmbiguousRows([]);
    setHasLasallianRecollection(false);
    setRecollectionWeekdays([]);
    setInspectedEvents([]);
    setGeneratedFilename(selectedFile.name.replace(/\.pdf$/i, ".ics"));
    setDownloadUrl("");
    setGeneratedAt("");
    setIsScheduleCreated(false);
    setShowAllCourses(false);
    
    const formData = new FormData();
    formData.append("eaf_pdf", selectedFile);

    try {
      const response = await fetch("/inspect", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        setValidationErrors({ general: payload.error || "Could not inspect the uploaded EAF." });
        setAmbiguousRows(Array.isArray(payload.ambiguous_rows) ? payload.ambiguous_rows : []);
        return;
      }

      setHasLasallianRecollection(Boolean(payload.has_recollection));
      setGeneratedFilename(payload.generated_filename || selectedFile.name.replace(/\.pdf$/i, ".ics"));
      setInspectedEvents(Array.isArray(payload.events) ? payload.events : []);
      setAmbiguousRows([]);
      setRecollectionWeekdays(
        Object.values((payload.recollection_days ?? {}) as Record<string, string[]>)
          .flat()
          .map((day) => day.toUpperCase())
          .filter((day: string, index: number, allDays: string[]) => allDays.indexOf(day) === index)
      );
    } catch {
      setValidationErrors({ general: "Could not inspect the uploaded EAF." });
      setAmbiguousRows([]);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    // Allow re-selecting the same file by clearing the input value right away.
    e.target.value = "";
    if (selectedFile) {
      void inspectFile(selectedFile);
    }
  };

  const handleClear = () => {
    resetFileInput();
    setFile(null);
    setTermStartDate("");
    setNumWeeks("14");
    setLasareDate("");
    setValidationErrors({});
    setAmbiguousRows([]);
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
      termStartDate?: string;
      numWeeks?: string;
      lasareDate?: string;
      general?: string;
    } = {};

    if (!termStartDate) {
      errors.termStartDate = "Term start date is required.";
    }

    if (!numWeeks.trim()) {
      errors.numWeeks = "Number of weeks is required.";
    }

    if (hasLasallianRecollection && !lasareDate) {
      errors.lasareDate = "Recollection date is required when your EAF includes a Lasallian Recollection.";
    }

    if (hasLasallianRecollection && lasareDate) {
      const selectedWeekday = getSelectedWeekday(lasareDate);
      if (selectedWeekday && recollectionWeekdays.length > 0 && !recollectionWeekdays.includes(selectedWeekday)) {
        errors.lasareDate = "Selected recollection date does not match your LASARE weekday.";
      }
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors({});

    if (!file) {
      setValidationErrors({ general: "Upload your EAF PDF before creating a schedule." });
      return;
    }

    const recollectionCodes = Array.from(
      new Set(inspectedEvents.filter((event) => event.is_recollection).map((event) => event.code)),
    );
    const formData = new FormData();
    formData.append("eaf_pdf", file);
    formData.append("term_start", termStartDate);
    formData.append("weeks", numWeeks);
    recollectionCodes.forEach((code) => {
      formData.append(`recollection_date_${code}`, lasareDate);
    });

    setIsGenerating(true);

    try {
      const response = await fetch("/generate", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        setValidationErrors({ general: payload.error || "Could not create the calendar file." });
        return;
      }

      setDownloadUrl(payload.download_url || "");
      setGeneratedFilename(payload.generated_filename || generatedFilename);
      setGeneratedAt(payload.generated_at || "");
      setIsScheduleCreated(true);
    } catch {
      setValidationErrors({ general: "Could not connect to the app server." });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!downloadUrl) {
      setValidationErrors({ general: "The calendar file is not ready yet. Please create the schedule again." });
      setIsScheduleCreated(false);
      return;
    }

    window.location.href = downloadUrl;
  };

  const courseSummaries = useMemo(
    () => buildCourseSummaries(inspectedEvents),
    [inspectedEvents],
  );
  const uniqueCourseCount = new Set(inspectedEvents.map((event) => event.code)).size;
  const coursePreview = showAllCourses ? courseSummaries : courseSummaries.slice(0, 4);
  const hasMoreCourses = courseSummaries.length > 4;
  const remainingCourses = Math.max(0, courseSummaries.length - 4);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-slate-950 dark:via-slate-900 dark:to-emerald-950/40 relative overflow-hidden transition-colors duration-300">
      {/* Decorative background elements */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-200 dark:bg-emerald-500/20 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-3xl opacity-20 dark:opacity-30 animate-pulse"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-teal-200 dark:bg-teal-500/20 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-3xl opacity-20 dark:opacity-30 animate-pulse animation-delay-2000"></div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20">
        {/* Brand & Theme Toggle */}
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
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2.5 rounded-xl bg-white/60 dark:bg-slate-800/80 backdrop-blur-sm border border-gray-200 dark:border-emerald-500/30 hover:bg-white dark:hover:bg-slate-700/90 transition-all duration-200 shadow-md hover:shadow-lg dark:shadow-emerald-500/10 dark:hover:shadow-emerald-500/20"
            aria-label="Toggle dark mode"
          >
            {isDarkMode ? (
              <Sun className="w-5 h-5 text-amber-400 dark:drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
            ) : (
              <Moon className="w-5 h-5 text-gray-600" />
            )}
          </button>
        </div>

        {/* Hero Section */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-16 items-start lg:min-h-[420px] mb-16 sm:mb-20">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center space-y-8 text-center lg:items-start lg:text-left self-center">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/40 rounded-full backdrop-blur-sm">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 dark:bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 dark:bg-emerald-400"></span>
                </span>
                <span className="text-sm text-emerald-700 dark:text-emerald-300">Built for DLSU students</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-7xl text-gray-900 dark:text-white leading-[1.1] tracking-tight">
                Turn your EAF into your class schedule <span className="text-emerald-600 dark:text-emerald-400">instantly.</span>
              </h1>

              <p className="text-lg sm:text-2xl text-gray-600 dark:text-gray-400 leading-relaxed">
                Upload your EAF and get a ready-to-use Google Calendar in seconds.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <button
                onClick={scrollToUpload}
                className="group px-8 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-2xl transition-all duration-300 shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 hover:-translate-y-0.5 flex items-center justify-center gap-2"
              >
                Create my schedule
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <button
                onClick={triggerFileUpload}
                className="px-8 py-4 bg-white/80 dark:bg-slate-700/60 backdrop-blur-sm hover:bg-white dark:hover:bg-slate-700/80 text-emerald-700 dark:text-emerald-300 rounded-2xl border border-emerald-200 dark:border-emerald-500/40 transition-all duration-300 shadow-md hover:shadow-lg hover:-translate-y-0.5"
              >
                Upload EAF
              </button>
            </div>
          </div>

          {/* Workflow Card - Glass morphism */}
          <div className="w-full max-w-lg justify-self-center lg:justify-self-end lg:mt-4 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl rounded-3xl shadow-2xl shadow-emerald-500/10 dark:shadow-emerald-500/20 p-8 border border-white/50 dark:border-emerald-500/20">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-1 h-6 bg-gradient-to-b from-emerald-600 to-teal-600 dark:from-emerald-400 dark:to-teal-400 rounded-full shadow-lg dark:shadow-emerald-400/50"></div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">How it works</h2>
            </div>

            <div className="space-y-4">
              <div className="group flex items-start gap-4 p-4 rounded-2xl hover:bg-white/80 dark:hover:bg-slate-700/40 transition-all duration-300">
                <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-600 dark:from-emerald-400 dark:to-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/30 dark:shadow-emerald-400/20 group-hover:scale-110 transition-transform duration-300">
                  <span className="text-white text-lg">1</span>
                </div>
                <div className="pt-0.5">
                  <h3 className="text-gray-900 dark:text-gray-100 mb-1.5">Upload</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-base leading-relaxed">Upload your latest Archers Hub EAF PDF.</p>
                </div>
              </div>

              <div className="group flex items-start gap-4 p-4 rounded-2xl hover:bg-white/80 dark:hover:bg-slate-700/40 transition-all duration-300">
                <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-teal-500 to-teal-600 dark:from-teal-400 dark:to-teal-500 rounded-2xl flex items-center justify-center shadow-lg shadow-teal-500/30 dark:shadow-teal-400/20 group-hover:scale-110 transition-transform duration-300">
                  <span className="text-white text-lg">2</span>
                </div>
                <div className="pt-0.5">
                  <h3 className="text-gray-900 dark:text-gray-100 mb-1.5">Review</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-base leading-relaxed">Adjust schedule details and generate a ready-to-import .ics calendar file.</p>
                </div>
              </div>

              <div className="group flex items-start gap-4 p-4 rounded-2xl hover:bg-white/80 dark:hover:bg-slate-700/40 transition-all duration-300">
                <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 dark:from-emerald-400 dark:to-teal-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/30 dark:shadow-emerald-400/20 group-hover:scale-110 transition-transform duration-300">
                  <span className="text-white text-lg">3</span>
                </div>
                <div className="pt-0.5">
                  <h3 className="text-gray-900 dark:text-gray-100 mb-1.5">Import</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-base leading-relaxed">Import your schedule into Google Calendar securely. Files are processed in memory only.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Upload Section - Glass morphism */}
        <div ref={uploadSectionRef} className="-mt-10 lg:-mt-14 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl rounded-3xl shadow-xl shadow-emerald-500/10 dark:shadow-emerald-500/20 p-6 sm:p-8 mb-6 border border-white/50 dark:border-emerald-500/20">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 dark:from-emerald-400 dark:to-teal-500 rounded-xl flex items-center justify-center shadow-lg dark:shadow-emerald-400/30">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-2xl text-gray-900 dark:text-gray-100">Upload your EAF</h2>
          </div>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`group relative border-2 border-dashed rounded-3xl p-12 sm:p-16 text-center transition-all duration-300 overflow-hidden ${
              isDragging
                ? "border-emerald-500 dark:border-emerald-400 bg-emerald-50/50 dark:bg-emerald-500/10 scale-[1.01]"
                : file
                ? "border-emerald-400 dark:border-emerald-500/60 bg-gradient-to-br from-emerald-50/40 to-teal-50/40 dark:from-emerald-500/5 dark:to-teal-500/5"
                : "border-gray-300 dark:border-slate-600 bg-gradient-to-br from-gray-50/30 to-white/30 dark:from-slate-800/30 dark:to-slate-700/20 hover:border-emerald-400 dark:hover:border-emerald-500/60 hover:from-emerald-50/20 hover:to-teal-50/20 dark:hover:from-emerald-500/10 dark:hover:to-teal-500/10"
            }`}
          >
            {/* Background pattern */}
            <div className="absolute inset-0 opacity-[0.02]" style={{
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
              <div className={`w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br flex items-center justify-center transition-all duration-300 ${
                file
                  ? "from-emerald-500 to-teal-600 dark:from-emerald-400 dark:to-teal-500 shadow-xl shadow-emerald-500/40 dark:shadow-emerald-400/30 scale-110"
                  : "from-gray-400 to-gray-500 dark:from-slate-600 dark:to-slate-700 group-hover:from-emerald-500 group-hover:to-teal-600 dark:group-hover:from-emerald-400 dark:group-hover:to-teal-500 group-hover:shadow-lg group-hover:shadow-emerald-500/30 dark:group-hover:shadow-emerald-400/20 group-hover:scale-105"
              }`}>
                <Upload className={`w-10 h-10 text-white transition-transform duration-300 ${file ? '' : 'group-hover:-translate-y-1'}`} />
              </div>

              {file ? (
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-100 dark:bg-emerald-500/20 rounded-full border border-emerald-200 dark:border-emerald-500/30">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-sm text-emerald-700 dark:text-emerald-300">File uploaded</span>
                  </div>
                  <p className="text-xl text-gray-900 dark:text-gray-100 break-all px-4">{file.name}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Ready to process • {(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xl sm:text-2xl text-gray-800 dark:text-gray-100">Drag and drop your EAF PDF here</p>
                  <p className="text-sm sm:text-base text-gray-500 dark:text-gray-400">or click to browse your files</p>
                  <div className="pt-2">
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 dark:bg-gray-700/50 rounded-full text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 border border-gray-200 dark:border-gray-600">
                      <FileText className="w-3.5 h-3.5" />
                      PDF only, up to 10MB
                    </span>
                  </div>
                </div>
              )}
            </label>
          </div>
        </div>
        
        {/* {validationErrors.general && (
          <div className="mb-8 rounded-2xl border border-red-200 bg-red-50/90 px-5 py-4 text-red-700 shadow-sm dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <p className="text-sm leading-relaxed">{validationErrors.general}</p>
            </div>
          </div>
        )} */}


        {/* Form Section - Glass morphism - Only shows when file is uploaded and schedule not created */}
        {file && !isScheduleCreated && validationErrors.general && (
          <div className="bg-rose-50/90 dark:bg-rose-500/10 backdrop-blur-xl rounded-3xl shadow-xl shadow-rose-500/10 p-6 sm:p-8 mb-12 border border-rose-200/60 dark:border-rose-500/30">
            <div className="flex items-start gap-4">
              <div className="relative flex-shrink-0">
                <div className="w-12 h-12 bg-gradient-to-br from-rose-500 to-red-600 rounded-2xl flex items-center justify-center shadow-lg shadow-rose-500/30">
                  <AlertCircle className="w-6 h-6 text-white" />
                </div>
              </div>
              <div className="flex-1 space-y-5">
                <div>
                  <h3 className="text-lg text-rose-900 dark:text-rose-100 mb-2">Parsing blocked</h3>
                  <p className="text-sm text-rose-800/90 dark:text-rose-100/90 leading-relaxed whitespace-pre-line">
                    {validationErrors.general}
                  </p>
                </div>

                {ambiguousRows.length > 0 && (
                  <div className="space-y-4">
                    {ambiguousRows.map((group) => (
                      <div key={group.code} className="rounded-2xl border border-rose-200/70 dark:border-rose-500/20 bg-white/70 dark:bg-slate-900/30 p-4">
                        <p className="text-base text-rose-900 dark:text-rose-100 font-semibold mb-3">{group.code}</p>
                        <div className="space-y-3">
                          {group.rows.map((row) => (
                            <div key={`${group.code}-${row.row_number}`} className="rounded-xl bg-rose-50/80 dark:bg-rose-500/10 border border-rose-200/70 dark:border-rose-500/20 p-3">
                              <p className="text-sm text-rose-900 dark:text-rose-100 font-medium">
                                Row {row.row_number}
                              </p>
                              <p className="mt-1 text-sm text-rose-800 dark:text-rose-100/90 whitespace-pre-wrap leading-relaxed">
                                {row.text}
                              </p>
                              <p className="mt-2 text-xs text-rose-700 dark:text-rose-200/80 leading-relaxed">
                                {row.reason}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {file && !isScheduleCreated && !validationErrors.general && (
          <>
            <div ref={scheduleDetailsRef} className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl rounded-3xl shadow-xl shadow-emerald-500/10 dark:shadow-emerald-500/20 p-6 sm:p-8 mb-12 border border-white/50 dark:border-emerald-500/20">
              <h2 className="text-2xl text-gray-900 dark:text-gray-100 mb-8">Schedule details</h2>

              <div className="grid sm:grid-cols-2 gap-6 mb-8">
                <div className="space-y-2">
                  <label htmlFor="start-date" className="block text-gray-700 dark:text-gray-300 pl-1">
                    Term start date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    id="start-date"
                    value={termStartDate}
                    onChange={(e) => setTermStartDate(e.target.value)}
                    aria-invalid={Boolean(validationErrors.termStartDate)}
                    className={`w-full px-5 py-3.5 bg-white/70 dark:bg-slate-700/50 border rounded-2xl focus:outline-none focus:ring-2 focus:border-transparent transition-all backdrop-blur-sm hover:bg-white dark:hover:bg-slate-700/70 text-gray-900 dark:text-gray-100 ${
                      validationErrors.termStartDate
                        ? "border-red-300 dark:border-red-500/50 focus:ring-red-500 dark:focus:ring-red-400"
                        : "border-gray-200/50 dark:border-slate-600/50 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                    }`}
                  />
                  {validationErrors.termStartDate && (
                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{validationErrors.termStartDate}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="num-weeks" className="block text-gray-700 dark:text-gray-300 pl-1">
                    Number of weeks <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    id="num-weeks"
                    placeholder="14"
                    value={numWeeks}
                    onChange={(e) => setNumWeeks(e.target.value)}
                    aria-invalid={Boolean(validationErrors.numWeeks)}
                    className={`w-full px-5 py-3.5 bg-white/70 dark:bg-slate-700/50 border rounded-2xl focus:outline-none focus:ring-2 focus:border-transparent transition-all backdrop-blur-sm hover:bg-white dark:hover:bg-slate-700/70 placeholder:text-gray-400 dark:placeholder:text-gray-500 text-gray-900 dark:text-gray-100 ${
                      validationErrors.numWeeks
                        ? "border-red-300 dark:border-red-500/50 focus:ring-red-500 dark:focus:ring-red-400"
                        : "border-gray-200/50 dark:border-slate-600/50 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                    }`}
                  />
                  {validationErrors.numWeeks && (
                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{validationErrors.numWeeks}</span>
                    </div>
                  )}
                </div>
              </div>

              {hasLasallianRecollection && (
                <div className="border-t border-gray-200/50 dark:border-slate-600/30 pt-8">
                  <div className="space-y-2 mb-6">
                    <h3 className="text-lg text-gray-900 dark:text-gray-100">Lasallian Recollection</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">If your EAF includes LASARE (LASALLIAN RECOLLECTION) 1, 2, or 3, select the exact date.</p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label htmlFor="lasare-date" className="block text-gray-700 dark:text-gray-300 pl-1">
                          Recollection date <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="date"
                        id="lasare-date"
                        value={lasareDate}
                        onChange={(e) => setLasareDate(e.target.value)}
                        required
                        aria-invalid={Boolean(validationErrors.lasareDate)}
                        className={`w-full px-5 py-3.5 bg-white/70 dark:bg-slate-700/50 border rounded-2xl focus:outline-none focus:ring-2 focus:border-transparent transition-all backdrop-blur-sm hover:bg-white dark:hover:bg-slate-700/70 text-gray-900 dark:text-gray-100 ${
                          validationErrors.lasareDate
                            ? "border-red-300 dark:border-red-500/50 focus:ring-red-500 dark:focus:ring-red-400"
                            : "border-gray-200/50 dark:border-slate-600/50 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                        }`}
                      />
                      {/* Date preview intentionally hidden here; shown only on recollection course cards */}
                      {validationErrors.lasareDate && (
                        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          <AlertCircle className="w-4 h-4 flex-shrink-0" />
                          <span>{validationErrors.lasareDate}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* CTA Area */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
              <button
                onClick={handleCreateSchedule}
                disabled={isGenerating}
                className="group px-10 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:from-emerald-400 disabled:to-teal-400 disabled:cursor-wait text-white rounded-2xl transition-all duration-300 shadow-xl shadow-emerald-500/30 hover:shadow-2xl hover:shadow-emerald-500/40 hover:-translate-y-1 disabled:hover:translate-y-0 flex items-center gap-3"
              >
                <Calendar className="w-5 h-5" />
                {isGenerating ? "Creating schedule..." : "Create my schedule"}
              </button>
              <button
                onClick={handleClear}
                className="px-10 py-4 bg-white/80 dark:bg-slate-700/60 backdrop-blur-sm hover:bg-white dark:hover:bg-slate-700/80 text-gray-700 dark:text-gray-200 rounded-2xl border border-gray-200 dark:border-slate-600 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-1"
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
            <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-40 h-40 bg-emerald-300 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-pulse"></div>

            {/* Success Header Card */}
            <div className="relative mx-auto max-w-4xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 rounded-[2rem] shadow-2xl shadow-emerald-500/30 p-6 sm:p-8 lg:p-10 mb-6 overflow-hidden">
              {/* Decorative circles */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl"></div>
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-teal-400/20 rounded-full blur-2xl"></div>

              <div className="relative z-10">
                <div className="mx-auto flex w-full max-w-xl flex-col items-center text-center">
                  <div className="relative mb-6">
                    <div className="absolute inset-0 bg-white rounded-full blur-xl opacity-30 animate-pulse"></div>
                    <div className="relative w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-xl animate-in zoom-in duration-500">
                      <CheckCircle2 className="w-8 h-8 text-emerald-600" strokeWidth={2.5} />
                    </div>
                  </div>

                  <h2 className="text-3xl sm:text-4xl text-white mb-3">
                    All set!
                  </h2>
                  <p className="text-base sm:text-lg text-emerald-50 mb-8">Your calendar file is ready to download.</p>

                  <div className="w-full rounded-2xl border border-white/25 bg-white/15 p-5 text-left backdrop-blur-sm">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-50/80">Filename</p>
                    <p className="break-all font-mono text-sm font-semibold leading-relaxed text-white">
                      {generatedFilename}
                    </p>
                    <div className="mt-5 flex items-start gap-2 text-xs text-emerald-50/90">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <p className="leading-relaxed">
                        Compatible with Google Calendar, Apple Calendar, Outlook, and other calendar apps
                      </p>
                    </div>
                    <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/15 bg-white/10 p-3 text-xs text-emerald-50/95">
                      <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <p className="leading-relaxed">
                        Next step: import this .ics file into Google Calendar to view your complete class timetable.
                      </p>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-xs text-emerald-50/80">
                      <div className="h-1.5 w-1.5 rounded-full bg-emerald-100"></div>
                      <span>Generated at {generatedAt || "just now"}</span>
                    </div>
                  </div>

                  <button
                    onClick={handleDownload}
                    className="group mt-6 flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-8 py-4 text-emerald-700 shadow-xl transition-all duration-300 hover:-translate-y-1 hover:scale-[1.01] hover:bg-gray-50 hover:shadow-2xl sm:max-w-md"
                  >
                    <Download className="w-5 h-5 group-hover:animate-bounce" />
                    <span className="text-lg">Download .ics file</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Content Cards Container */}
            <div className="space-y-6">

                {false && (
                  <>
                {/* Filename Card */}
                <div className="bg-gradient-to-br from-gray-50 to-slate-50/80 dark:from-slate-800/60 dark:to-slate-700/40 backdrop-blur-sm rounded-3xl p-6 sm:p-8 mb-8 border border-gray-200/50 dark:border-slate-600/30 shadow-xl shadow-gray-500/5 dark:shadow-slate-500/10 animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-slate-400 to-slate-500 dark:from-slate-500 dark:to-slate-600 rounded-2xl blur-lg opacity-40"></div>
                      <div className="relative w-16 h-16 bg-gradient-to-br from-slate-500 to-slate-600 dark:from-slate-600 dark:to-slate-700 rounded-2xl flex items-center justify-center shadow-xl shadow-slate-500/40">
                        <FileText className="w-8 h-8 text-white" />
                      </div>
                    </div>
                    <div>
                      <p className="text-base text-gray-600 dark:text-gray-300 mb-1">Your calendar file</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-white/70 dark:bg-slate-700/50 backdrop-blur-sm rounded-2xl p-5 border border-gray-200/30 dark:border-slate-600/30">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Filename</p>
                      <p className="text-base text-gray-900 dark:text-gray-100 break-all font-mono leading-relaxed">
                          {generatedFilename}
                      </p>
                    </div>

                    <div className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400 bg-white/50 dark:bg-slate-700/40 rounded-xl p-3 border border-gray-200/30 dark:border-slate-600/30">
                      <div className="w-1.5 h-1.5 bg-slate-500 dark:bg-slate-400 rounded-full mt-1.5 flex-shrink-0"></div>
                      <p className="leading-relaxed">
                        iCalendar format (.ics) • Compatible with Google Calendar, Apple Calendar, Outlook
                      </p>
                    </div>
                  </div>
                </div>
                  </>
                )}

                {/* Schedule Summary - Consistent Cards */}
                <div className="space-y-6 mb-10 animate-in fade-in slide-in-from-bottom-10 duration-700">
                  {/* Courses Card */}
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50/80 dark:from-blue-900/20 dark:to-indigo-900/20 backdrop-blur-sm rounded-3xl p-6 sm:p-8 border border-blue-200/50 dark:border-blue-700/30 shadow-xl shadow-blue-500/5">
                    <div className="w-full flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="absolute inset-0 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-2xl blur-md opacity-25"></div>
                          <div className="relative w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                            <BookOpen className="w-8 h-8 text-white" />
                          </div>
                        </div>
                        <div className="text-left">
                          <p className="text-4xl font-medium leading-none text-gray-900 dark:text-gray-100 mb-0.5">{courseSummaries.length}</p>
                          <p className="text-base font-medium text-gray-700 dark:text-gray-300">Courses</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-3 animate-in fade-in slide-in-from-top-2 duration-300 md:grid-cols-2 xl:grid-cols-4">
                        {coursePreview.map((course) => {
                          const displayCourseName = formatCourseName(course.courseName);

                          return (
                            <div
                              key={course.code}
                              className="flex h-full min-h-[150px] flex-col rounded-3xl border border-blue-200/40 bg-white/85 p-4 shadow-lg shadow-blue-500/5 backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:bg-white hover:shadow-xl hover:shadow-blue-500/10 dark:border-blue-500/20 dark:bg-slate-700/40 dark:hover:bg-slate-700/60"
                            >
                              {/* Header */}
                              <div className="flex items-center justify-between gap-3">
                                {/* Course Code */}
                                <span className="inline-flex min-w-0 items-center rounded-full bg-blue-500/10 px-2.5 py-1 text-sm font-semibold tracking-wide text-blue-700 dark:bg-blue-400/15 dark:text-blue-200">
                                  {course.code}
                                </span>

                                {/* Section Code */}
                                <span className="flex-shrink-0 rounded-full px-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                                  {course.sectionCode}
                                </span>
                              </div>
                              
                              {/* Course Name */}
                              <p
                                title={displayCourseName}
                                className="mt-3 w-full text-sm font-semibold leading-snug text-gray-950 dark:text-gray-100"
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
                                  <span className="leading-none">{course.hasRecollection && hasLasallianRecollection && lasareDate ? "One-time date" : "Recurring weekly"}</span>
                                </span>
                                {course.hasRecollection && hasLasallianRecollection && lasareDate ? (
                                  <DatePill date={lasareDate} />
                                ) : (
                                  <span className="text-gray-400 dark:text-gray-500">Weekly</span>
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
                                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                              {day}
                                            </span>

                                            <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                                              {meetingGroup.startTime} - {meetingGroup.endTime}
                                            </span>

                                            <span className="truncate text-right text-sm text-gray-500 dark:text-gray-400">
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
                            <div className="flex items-center justify-center gap-2 rounded-2xl border border-blue-200/40 bg-blue-50/80 px-4 py-3 text-blue-700 shadow-sm transition-colors hover:bg-blue-100/80 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200 dark:hover:bg-blue-500/20">
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
                  <div className="bg-gradient-to-br from-purple-50 to-violet-50/80 dark:from-purple-900/20 dark:to-violet-900/20 backdrop-blur-sm rounded-3xl p-6 sm:p-8 border border-purple-200/50 dark:border-purple-700/30 shadow-xl shadow-purple-500/5">
                    <div className="w-full flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="absolute inset-0 bg-gradient-to-br from-purple-400 to-violet-500 rounded-2xl blur-md opacity-25"></div>
                          <div className="relative w-16 h-16 bg-gradient-to-br from-purple-500 to-violet-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-500/25">
                            <CalendarDays className="w-8 h-8 text-white" />
                          </div>
                        </div>
                        <div className="text-left">
                          <p className="text-4xl font-medium leading-none text-gray-900 dark:text-gray-100 mb-0.5">{inspectedEvents.length}</p>
                          <p className="text-base font-medium text-gray-700 dark:text-gray-300">Events Ready to Import</p>
                          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Includes all classes, recollections, and recurring sessions.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              {/* Action Button */}
              <div className="flex justify-center pt-4">
                <button
                  onClick={handleClear}
                  className="group px-10 py-4 bg-white/80 dark:bg-gray-700/80 backdrop-blur-sm hover:bg-white dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-2xl border border-gray-200 dark:border-gray-600 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center gap-2"
                >
                  <ArrowRight className="w-5 h-5 rotate-180 group-hover:-translate-x-1 transition-transform" />
                  Create another schedule
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Privacy Notice */}
        <div className="max-w-3xl mx-auto pt-12 pb-8 px-4 border-t border-gray-200/30 dark:border-slate-700/50 mt-16">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm text-gray-500 dark:text-gray-400 mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Privacy Notice
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                We use Google Analytics to understand general site usage. Your uploaded PDF is processed in memory only and is never stored on our servers. All data extracted from the PDF is automatically deleted after processing.
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Need help?</p>
              <div className="flex flex-wrap gap-3 text-sm">
                <a
                  href="mailto:angelo_nuque@dlsu.edu.ph"
                  className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>angelo_nuque@dlsu.edu.ph</span>
                </a>
                <span className="text-gray-300 dark:text-gray-600">•</span>
                <a
                  href="https://github.com/Stilsi-dev/EAFSchedulr/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                >
                  <Github className="w-3.5 h-3.5" />
                  <span>Report on GitHub</span>
                </a>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Footer - Always at bottom */}
      <div className="w-full border-t border-gray-200/30 dark:border-slate-700/50 bg-white/40 dark:bg-slate-900/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center">
          <div className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <span>Made by a Lasallian</span>
            <Heart className="w-4 h-4 text-emerald-500 dark:text-emerald-400 fill-emerald-500 dark:fill-emerald-400 dark:drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]" />
            <span>for Lasallians</span>
          </div>
        </div>
      </div>
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
    <div className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 dark:text-gray-400">
      <Calendar className="w-3 h-3 opacity-60" />
      <span className="leading-none">{formatDisplayDate(date)}</span>
    </div>
  );
}