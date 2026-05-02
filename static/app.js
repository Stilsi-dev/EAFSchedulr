document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector(".upload-form");
  const fileInput = document.getElementById("eaf-pdf-input");
  const recollectionSection = document.getElementById("recollection-section");
  const dropzone = document.querySelector(".dropzone");
  const dropzoneStatus = document.getElementById("dropzone-upload-status");
  const fileSizeHint = document.getElementById("file-size-hint");
  const courseSummary = document.getElementById("course-summary");
  const courseCountText = document.getElementById("course-count-text");
  const courseCount = document.getElementById("course-count");
  const formStatus = document.getElementById("form-status");
  const clearBtn = document.getElementById("clear-btn");
  const generateBtn = document.getElementById("generate-btn");

  if (!form || !fileInput || !recollectionSection || !dropzone || !dropzoneStatus) {
    return;
  }

  const inspectUrl = form.dataset.inspectUrl;
  const MAX_FILE_SIZE_MB = 10;
  const weekdayIndexByCode = {
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
    SUN: 0,
  };

  const weekdayLabelByCode = {
    MON: "Monday",
    TUE: "Tuesday",
    WED: "Wednesday",
    THU: "Thursday",
    FRI: "Friday",
    SAT: "Saturday",
    SUN: "Sunday",
  };

  const recollectionRows = {
    LASARE1: document.getElementById("recollection-row-LASARE1"),
    LASARE2: document.getElementById("recollection-row-LASARE2"),
    LASARE3: document.getElementById("recollection-row-LASARE3"),
  };

  const originalGenerateLabel = generateBtn ? generateBtn.textContent : "Generate calendar";
  let isInspecting = false;
  let isGenerating = false;
  let hasValidFile = false;

  const updateGenerateButtonState = () => {
    if (!generateBtn) {
      return;
    }

    const disabled = isInspecting || isGenerating || !hasValidFile;
    generateBtn.disabled = disabled;
    generateBtn.textContent = isGenerating ? "Generating..." : originalGenerateLabel;
    if (formStatus) {
      formStatus.classList.toggle("is-loading", isInspecting || isGenerating);
      formStatus.textContent = isInspecting
        ? "Checking your PDF for courses and recollection dates..."
        : isGenerating
          ? "Generating your calendar file..."
          : "";
    }
    form.setAttribute("aria-busy", String(isInspecting || isGenerating));
  };

  const setDropzoneStatus = (file) => {
    if (!file) {
      dropzone.classList.remove("has-file");
      dropzoneStatus.textContent = "";
      fileSizeHint.textContent = "";
      courseCountText.classList.add("is-hidden");
      hasValidFile = false;
      isInspecting = false;
      isGenerating = false;
      updateGenerateButtonState();
      return;
    }

    dropzone.classList.add("has-file");
    dropzoneStatus.textContent = `Uploaded: ${file.name}`;
    
    // Show file size
    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      fileSizeHint.textContent = `⚠️ File size (${fileSizeMB}MB) exceeds maximum of ${MAX_FILE_SIZE_MB}MB`;
      fileSizeHint.classList.add("error");
      hasValidFile = false;
    } else {
      fileSizeHint.textContent = `File size: ${fileSizeMB}MB`;
      fileSizeHint.classList.remove("error");
      hasValidFile = true;
    }

    updateGenerateButtonState();
  };

  const validateRecollectionInput = (input) => {
    const expectedDay = input.dataset.expectedDay;
    if (!expectedDay || !input.value) {
      input.setCustomValidity("");
      return true;
    }

    const selectedDate = new Date(`${input.value}T00:00:00`);
    if (Number.isNaN(selectedDate.getTime())) {
      input.setCustomValidity("Please choose a valid date.");
      return false;
    }

    if (selectedDate.getDay() !== weekdayIndexByCode[expectedDay]) {
      input.setCustomValidity(`Choose a ${weekdayLabelByCode[expectedDay]} date for this recollection.`);
      return false;
    }

    input.setCustomValidity("");
    return true;
  };

  const setRecollectionVisible = (visibleCodes, recollectionDays = {}) => {
    const codes = new Set(visibleCodes);
    const visible = codes.size > 0;
    recollectionSection.classList.toggle("is-hidden", !visible);

    Object.entries(recollectionRows).forEach(([code, row]) => {
      if (!row) {
        return;
      }

      const shouldShow = codes.has(code);
      row.classList.toggle("is-hidden", !shouldShow);
      const input = row.querySelector("input[type='date']");
      if (input) {
        input.required = shouldShow;
        input.dataset.expectedDay = recollectionDays[code] || "";
        if (!shouldShow) {
          input.value = "";
          input.setCustomValidity("");
          input.title = "";
        } else if (input.dataset.expectedDay) {
          input.title = `Choose a ${weekdayLabelByCode[input.dataset.expectedDay]} date.`;
          validateRecollectionInput(input);
        }
      }
    });

    if (!visible) {
      Object.values(recollectionRows).forEach((row) => {
        if (!row) {
          return;
        }
        const input = row.querySelector("input[type='date']");
        if (input) {
          input.required = false;
          input.value = "";
          input.dataset.expectedDay = "";
          input.setCustomValidity("");
          input.title = "";
        }
      });
    }
  };

  const updateCourseCount = (count) => {
    if (count > 0) {
      courseCount.textContent = count;
      courseCountText.classList.remove("is-hidden");
    } else {
      courseCountText.classList.add("is-hidden");
    }
  };

  Object.values(recollectionRows).forEach((row) => {
    if (!row) {
      return;
    }

    const input = row.querySelector("input[type='date']");
    if (!input) {
      return;
    }

    input.addEventListener("input", () => validateRecollectionInput(input));
    input.addEventListener("change", () => validateRecollectionInput(input));
  });

  // Clear button resets the form
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      form.reset();
      setDropzoneStatus(null);
      setRecollectionVisible([]);
      updateCourseCount(0);
      if (formStatus) {
        formStatus.textContent = "";
        formStatus.classList.remove("is-loading");
      }
    });
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      setDropzoneStatus(null);
      setRecollectionVisible([]);
      updateCourseCount(0);
      return;
    }

    setDropzoneStatus(file);

    // Client-side file validation
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setRecollectionVisible([]);
      updateCourseCount(0);
      return;
    }

    if (!file.type.includes("pdf") && !file.name.endsWith(".pdf")) {
      dropzoneStatus.textContent = "⚠️ Please upload a PDF file";
      setRecollectionVisible([]);
      updateCourseCount(0);
      return;
    }

    isInspecting = true;
    updateGenerateButtonState();
    dropzoneStatus.textContent = `Inspecting ${file.name}...`;

    const formData = new FormData();
    formData.append("eaf_pdf", file, file.name);

    try {
      const response = await fetch(inspectUrl, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        dropzoneStatus.textContent = `⚠️ ${data.error || "Error reading PDF"}`;
        setRecollectionVisible([]);
        updateCourseCount(0);
        hasValidFile = false;
        return;
      }

      dropzoneStatus.textContent = `✓ Uploaded: ${file.name}`;
      setRecollectionVisible(data.recollection_codes || [], data.recollection_days || {});
      updateCourseCount(data.course_count || 0);
      hasValidFile = true;
    } catch (_error) {
      dropzoneStatus.textContent = "⚠️ Error reading PDF";
      setRecollectionVisible([]);
      updateCourseCount(0);
      hasValidFile = false;
    } finally {
      isInspecting = false;
      updateGenerateButtonState();
    }
  });

  form.addEventListener("submit", () => {
    if (!hasValidFile) {
      return;
    }

    isGenerating = true;
    updateGenerateButtonState();
    if (clearBtn) {
      clearBtn.disabled = true;
    }
  });
});
