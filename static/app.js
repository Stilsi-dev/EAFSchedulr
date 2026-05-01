document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector(".upload-form");
  const fileInput = document.getElementById("eaf-pdf-input");
  const recollectionSection = document.getElementById("recollection-section");
  const dropzone = document.querySelector(".dropzone");
  const dropzoneStatus = document.getElementById("dropzone-upload-status");

  if (!form || !fileInput || !recollectionSection || !dropzone || !dropzoneStatus) {
    return;
  }

  const inspectUrl = form.dataset.inspectUrl;
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

  const setDropzoneStatus = (file) => {
    if (!file) {
      dropzone.classList.remove("has-file");
      dropzoneStatus.textContent = "";
      return;
    }

    dropzone.classList.add("has-file");
    dropzoneStatus.textContent = `Uploaded: ${file.name}`;
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

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      setDropzoneStatus(null);
      setRecollectionVisible([]);
      return;
    }

    setDropzoneStatus(file);

    const formData = new FormData();
    formData.append("eaf_pdf", file, file.name);

    try {
      const response = await fetch(inspectUrl, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        setRecollectionVisible([]);
        return;
      }

      setRecollectionVisible(data.recollection_codes || [], data.recollection_days || {});
    } catch (_error) {
      setRecollectionVisible([]);
    }
  });
});
