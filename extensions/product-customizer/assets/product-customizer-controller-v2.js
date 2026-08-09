(() => {
  const CUSTOMIZER_SELECTOR = "[data-product-customizer]";
  const PROXY_URL = "/apps/personalize-preview";
  const initialized = new WeakSet();

  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  const allowedExtensions = /\.(png|jpe?g|webp)$/i;
  const maximumFileSize = 15 * 1024 * 1024;

  const clamp = (value, minimum, maximum) =>
    Math.min(Math.max(value, minimum), maximum);
  const round = (value) => Math.round(value * 10) / 10;
  const sleep = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  const nextFrame = () =>
    new Promise((resolve) =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
    );

  const productGid = (rawId) => {
    const value = String(rawId || "").trim();
    if (!value) return "";
    return value.startsWith("gid://shopify/Product/")
      ? value
      : `gid://shopify/Product/${value}`;
  };

  const formatDimension = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "";
    return Number.isInteger(number)
      ? String(number)
      : String(Math.round(number * 10) / 10);
  };

  const percent = (value) => {
    const text = String(value ?? "").trim();
    if (!text) return "0%";
    return text.endsWith("%") ? text : `${text}%`;
  };

  function findProductForm(customizer) {
    const closestForm = customizer.closest('form[action*="/cart/add"]');
    if (closestForm) return closestForm;

    const section =
      customizer.closest('[id^="shopify-section-"]') ||
      customizer.closest(".shopify-section") ||
      document;
    const forms = Array.from(
      section.querySelectorAll('form[action*="/cart/add"]'),
    );

    return forms.find((form) => form.querySelector('[name="id"]')) || forms[0] || null;
  }

  async function safeJson(response) {
    return response.json().catch(() => null);
  }

  async function postProxyJson(payload) {
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(PROXY_URL, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });

        const result = await safeJson(response);
        if (!response.ok || !result?.ok) {
          throw new Error(result?.error || "The personalization request failed.");
        }
        return result;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await sleep(250);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("The personalization service could not be reached.");
  }

  function getMimeType(file) {
    if (file.type && allowedTypes.has(file.type)) return file.type;
    const name = file.name.toLowerCase();
    if (name.endsWith(".png")) return "image/png";
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
    if (name.endsWith(".webp")) return "image/webp";
    return "";
  }

  function validateFile(file) {
    if (!allowedTypes.has(file.type) && !allowedExtensions.test(file.name)) {
      return "Please upload a PNG, JPG, JPEG, or WebP image.";
    }
    if (file.size <= 0) return "The uploaded image is empty.";
    if (file.size > maximumFileSize) {
      return "The image is too large. Please choose a file under 15 MB.";
    }
    return "";
  }

  async function waitForUploadedFile(file) {
    if (file?.url) return file;
    if (!file?.id) throw new Error("Shopify did not return an uploaded file ID.");

    let current = file;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      if (current?.url) return current;
      if (current?.status === "FAILED") {
        throw new Error(current?.error || "Shopify could not process the uploaded image.");
      }

      await sleep(700);
      const result = await postProxyJson({ action: "status", fileId: file.id });
      current = result.file;
    }

    throw new Error("The image is still processing. Please confirm the design again.");
  }

  async function uploadFileToShopify(file) {
    const mimeType = getMimeType(file);
    if (!mimeType) throw new Error("Please upload a PNG, JPG, JPEG, or WebP image.");

    const prepared = await postProxyJson({
      action: "prepare-upload",
      filename: file.name,
      mimeType,
      fileSize: file.size,
    });
    const upload = prepared?.upload;
    if (!upload?.url || !upload?.resourceUrl) {
      throw new Error("Shopify did not return an upload destination.");
    }

    const data = new FormData();
    (Array.isArray(upload.parameters) ? upload.parameters : []).forEach((parameter) => {
      if (parameter?.name && typeof parameter.value === "string") {
        data.append(parameter.name, parameter.value);
      }
    });
    data.append("file", file, upload.filename || file.name);

    let stagedResponse;
    try {
      stagedResponse = await fetch(upload.url, { method: "POST", body: data });
    } catch {
      throw new Error("The image upload connection failed. Please confirm the design again.");
    }
    if (!stagedResponse.ok) throw new Error("Shopify could not receive the image upload.");

    const completed = await postProxyJson({
      action: "complete-upload",
      resourceUrl: upload.resourceUrl,
      filename: upload.filename || file.name,
    });
    if (!completed?.file?.id) throw new Error("Shopify did not create the image file.");
    return waitForUploadedFile(completed.file);
  }

  function createSideState(key, label) {
    return {
      key,
      label,
      imageUrl: "",
      left: "35",
      top: "22",
      width: "30",
      height: "45",
      printWidthCm: 0,
      printHeightCm: 0,
      hasArtwork: false,
      sourceFile: null,
      sourceFileKey: "",
      artworkFileName: "",
      artworkUrl: "",
      shopifyFileId: "",
      uploadedFileKey: "",
      objectUrl: "",
      artworkX: 50,
      artworkY: 50,
      artworkScale: 1,
      artworkBaseWidth: 70,
      hasText: false,
      text: "",
      textX: 50,
      textY: 75,
      textSize: 30,
      textFont: "Arial, sans-serif",
      textColor: "#111111",
      quality: "",
      proofUrl: "",
      proofFileId: "",
      confirmed: false,
    };
  }

  function createTabs(preview) {
    const row = document.createElement("div");
    row.className = "pp-print-side-tabs";
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.justifyContent = "center";
    row.style.margin = "0 0 16px";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Choose print side");

    const makeButton = (label) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.minHeight = "38px";
      button.style.padding = "0 16px";
      button.style.borderRadius = "999px";
      button.style.border = "1px solid rgba(17,17,17,.18)";
      button.style.fontWeight = "750";
      button.style.cursor = "pointer";
      return button;
    };

    const front = makeButton("Front");
    const back = makeButton("Back");
    row.append(front, back);
    preview.prepend(row);
    return { row, front, back };
  }

  function initialize(customizer) {
    if (initialized.has(customizer)) return;
    initialized.add(customizer);

    const studio = customizer.querySelector("[data-pp-studio]");
    const openButton = customizer.querySelector("[data-pp-open-studio]");
    const closeButtons = customizer.querySelectorAll("[data-pp-close-studio]");
    const preview = customizer.querySelector(".pp-preview");
    const productImage = customizer.querySelector(".pp-product-image");
    const printArea = customizer.querySelector("[data-pp-print-area]");
    const emptyState = customizer.querySelector("[data-pp-empty-state] span");
    const artwork = customizer.querySelector("[data-pp-artwork]");
    const textLayer = customizer.querySelector("[data-pp-text-layer]");
    const previewHelp = customizer.querySelector("[data-pp-preview-help]");
    const fileInput = customizer.querySelector("[data-pp-file]");
    const fileName = customizer.querySelector("[data-pp-file-name]");
    const editControls = customizer.querySelector("[data-pp-edit-controls]");
    const scaleInput = customizer.querySelector("[data-pp-scale]");
    const centerButton = customizer.querySelector("[data-pp-center]");
    const resetButton = customizer.querySelector("[data-pp-reset]");
    const textInput = customizer.querySelector("[data-pp-text-input]");
    const fontSelect = customizer.querySelector("[data-pp-font]");
    const textColorInput = customizer.querySelector("[data-pp-text-color]");
    const textEditControls = customizer.querySelector("[data-pp-text-edit-controls]");
    const textSizeInput = customizer.querySelector("[data-pp-text-size]");
    const centerTextButton = customizer.querySelector("[data-pp-center-text]");
    const removeTextButton = customizer.querySelector("[data-pp-remove-text]");
    const confirmButton = customizer.querySelector("[data-pp-confirm]");
    const confirmedState = customizer.querySelector("[data-pp-confirmed-state]");
    const editDesignButton = customizer.querySelector("[data-pp-edit-design]");
    const continueButton = customizer.querySelector("[data-pp-continue]");
    const errorMessage = customizer.querySelector("[data-pp-error]");

    if (!studio || !openButton || !preview || !productImage || !printArea || !artwork ||
        !textLayer || !fileInput || !fileName || !editControls || !scaleInput ||
        !textInput || !fontSelect || !textColorInput || !textSizeInput ||
        !confirmButton || !confirmedState || !editDesignButton || !continueButton) {
      console.warn("Personalize Preview: customizer markup is incomplete.");
      return;
    }

    const productForm = findProductForm(customizer);
    if (!productForm) {
      if (errorMessage) {
        errorMessage.textContent = "The Shopify product form could not be found.";
        errorMessage.hidden = false;
      }
      return;
    }

    const studioOriginalParent = studio.parentNode;
    const studioOriginalNextSibling = studio.nextSibling;
    const oldHtmlOverflow = document.documentElement.style.overflow;
    const oldBodyOverflow = document.body.style.overflow;
    const front = createSideState("front", "Front");
    const back = createSideState("back", "Back");
    const sides = { front, back };
    let backEnabled = false;
    let currentKey = "front";
    let aggregateConfirmed = false;
    let confirming = false;
    let tabs = null;
    let configLoaded = false;

    const frontStyles = window.getComputedStyle(customizer);
    front.imageUrl = productImage.currentSrc || productImage.src || "";
    front.left = frontStyles.getPropertyValue("--pp-print-left").trim() || "35";
    front.top = frontStyles.getPropertyValue("--pp-print-top").trim() || "22";
    front.width = frontStyles.getPropertyValue("--pp-print-width").trim() || "30";
    front.height = frontStyles.getPropertyValue("--pp-print-height").trim() || "45";
    front.textFont = fontSelect.value;
    front.textColor = textColorInput.value;
    back.textFont = fontSelect.value;
    back.textColor = textColorInput.value;

    const uploadIsRequired = fileInput.dataset.required === "true";
    const originalConfirmText = confirmButton.textContent?.trim() || "Confirm design";
    const originalContinueText = continueButton.textContent?.trim() || "Add personalized product to cart";

    const qualityCard = document.createElement("div");
    qualityCard.className = "pp-quality-guard";
    qualityCard.hidden = true;
    qualityCard.setAttribute("aria-live", "polite");
    const qualityLabel = document.createElement("strong");
    const qualityDetail = document.createElement("span");
    qualityCard.append(qualityLabel, qualityDetail);
    if (editControls.parentNode) {
      editControls.parentNode.insertBefore(qualityCard, editControls.nextSibling);
    }

    const proofStatus = document.createElement("p");
    proofStatus.className = "pp-proof-status";
    proofStatus.hidden = true;
    confirmedState.appendChild(proofStatus);

    const currentSide = () => sides[currentKey];
    const personalizedSideList = () =>
      [front, ...(backEnabled ? [back] : [])].filter((side) => side.hasArtwork || side.hasText);
    const hasCustomization = () => personalizedSideList().length > 0;
    const hasAnyArtwork = () => personalizedSideList().some((side) => side.hasArtwork);

    function showError(message) {
      if (!errorMessage) return;
      errorMessage.textContent = message;
      errorMessage.hidden = false;
    }
    function clearError() {
      if (!errorMessage) return;
      errorMessage.textContent = "";
      errorMessage.hidden = true;
    }
    function setProofStatus(message, state = "") {
      proofStatus.textContent = message;
      proofStatus.hidden = !message;
      if (state) proofStatus.dataset.state = state;
      else proofStatus.removeAttribute("data-state");
    }
    function setConfirming(value, message = "") {
      confirming = value;
      confirmButton.disabled = value;
      confirmButton.textContent = value ? message || "Saving design…" : originalConfirmText;
    }
    function setAggregateConfirmed(value) {
      aggregateConfirmed = value;
      customizer.classList.toggle("pp-is-confirmed", value);
      studio.classList.toggle("pp-is-confirmed", value);
      [fileInput, scaleInput, centerButton, resetButton, textInput, fontSelect,
       textColorInput, textSizeInput, centerTextButton, removeTextButton]
        .filter(Boolean)
        .forEach((control) => { control.disabled = value; });
      confirmButton.hidden = value;
      confirmedState.hidden = !value;
      if (!value) {
        continueButton.disabled = false;
        continueButton.textContent = originalContinueText;
        setProofStatus("");
      }
    }
    function invalidateSide(side) {
      side.confirmed = false;
      side.proofUrl = "";
      side.proofFileId = "";
      if (aggregateConfirmed) setAggregateConfirmed(false);
    }
    function setPrintVariables(side) {
      const values = {
        "--pp-print-left": percent(side.left),
        "--pp-print-top": percent(side.top),
        "--pp-print-width": percent(side.width),
        "--pp-print-height": percent(side.height),
      };
      Object.entries(values).forEach(([name, value]) => {
        customizer.style.setProperty(name, value);
        studio.style.setProperty(name, value);
      });
    }
    function updateTabStyles() {
      if (!tabs) return;
      [[tabs.front, "front"], [tabs.back, "back"]].forEach(([button, key]) => {
        const active = currentKey === key;
        button.style.background = active ? "#111" : "#fff";
        button.style.color = active ? "#fff" : "#222";
        button.style.borderColor = active ? "#111" : "rgba(17,17,17,.18)";
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }
    function updateSharedUi(side) {
      const customized = side.hasArtwork || side.hasText;
      printArea.classList.toggle("pp-has-artwork", side.hasArtwork);
      printArea.classList.toggle("pp-has-text", side.hasText);
      const emptyContainer = emptyState?.parentElement;
      if (emptyContainer) emptyContainer.hidden = customized;
      if (previewHelp) previewHelp.hidden = !customized;
    }
    function renderArtwork(side) {
      artwork.style.setProperty("--pp-artwork-x", `${side.artworkX}%`);
      artwork.style.setProperty("--pp-artwork-y", `${side.artworkY}%`);
      artwork.style.setProperty("--pp-artwork-scale", String(side.artworkScale));
      artwork.style.setProperty("--pp-artwork-width", `${side.artworkBaseWidth}%`);
      const source = side.objectUrl || side.artworkUrl;
      if (side.hasArtwork && source) {
        if (artwork.src !== source) artwork.src = source;
        artwork.hidden = false;
      } else {
        artwork.hidden = true;
        artwork.removeAttribute("src");
      }
      editControls.hidden = !side.hasArtwork;
      fileName.textContent = side.hasArtwork ? side.artworkFileName || "Artwork selected" : "No file selected";
      scaleInput.value = String(Math.round(side.artworkScale * 100));
      updateSharedUi(side);
    }
    function renderText(side) {
      textLayer.textContent = side.text;
      textLayer.hidden = !side.hasText;
      textLayer.style.setProperty("--pp-text-x", `${side.textX}%`);
      textLayer.style.setProperty("--pp-text-y", `${side.textY}%`);
      textLayer.style.fontSize = `${side.textSize}px`;
      textLayer.style.fontFamily = side.textFont;
      textLayer.style.color = side.textColor;
      textInput.value = side.text;
      fontSelect.value = side.textFont;
      textColorInput.value = side.textColor;
      textSizeInput.value = String(side.textSize);
      if (textEditControls) textEditControls.hidden = !side.hasText;
      updateSharedUi(side);
    }
    function hideQuality() {
      qualityCard.hidden = true;
      qualityCard.removeAttribute("data-quality");
      qualityLabel.textContent = "";
      qualityDetail.textContent = "";
    }
    function calculateQuality(side) {
      if (artwork.hidden || !artwork.naturalWidth || !artwork.naturalHeight ||
          side.printWidthCm <= 0 || side.printHeightCm <= 0) {
        side.quality = "";
        hideQuality();
        return "";
      }
      const artworkRect = artwork.getBoundingClientRect();
      const areaRect = printArea.getBoundingClientRect();
      if (areaRect.width <= 0 || areaRect.height <= 0 || artworkRect.width <= 0 || artworkRect.height <= 0) {
        side.quality = "";
        hideQuality();
        return "";
      }
      const printedWidthCm = side.printWidthCm * (artworkRect.width / areaRect.width);
      const printedHeightCm = side.printHeightCm * (artworkRect.height / areaRect.height);
      const dpiWidth = artwork.naturalWidth / (printedWidthCm / 2.54);
      const dpiHeight = artwork.naturalHeight / (printedHeightCm / 2.54);
      const dpi = Math.max(1, Math.round(Math.min(dpiWidth, dpiHeight)));
      qualityCard.hidden = false;
      if (dpi >= 250) {
        qualityCard.dataset.quality = "great";
        qualityLabel.textContent = `${side.label} print quality: Great`;
        qualityDetail.textContent = `About ${dpi} DPI at this size. Good to print.`;
        side.quality = `Great · ~${dpi} DPI`;
      } else if (dpi >= 150) {
        qualityCard.dataset.quality = "okay";
        qualityLabel.textContent = `${side.label} print quality: Okay`;
        qualityDetail.textContent = `About ${dpi} DPI. A higher-resolution image would be sharper.`;
        side.quality = `Okay · ~${dpi} DPI`;
      } else {
        qualityCard.dataset.quality = "low";
        qualityLabel.textContent = `${side.label} print quality: Too low`;
        qualityDetail.textContent = `About ${dpi} DPI. Use a larger image or make the artwork smaller.`;
        side.quality = `Too low · ~${dpi} DPI`;
      }
      return side.quality;
    }
    function scheduleQuality() {
      window.requestAnimationFrame(() => calculateQuality(currentSide()));
    }
    function applySide(key, { keepFileInput = false } = {}) {
      if (!sides[key] || (key === "back" && !backEnabled)) return;
      currentKey = key;
      const side = currentSide();
      productImage.src = side.imageUrl || front.imageUrl;
      setPrintVariables(side);
      if (emptyState) emptyState.textContent = `${side.label} print area`;
      if (!keepFileInput) fileInput.value = "";
      renderArtwork(side);
      renderText(side);
      updateTabStyles();
      scheduleQuality();
    }
    async function calculateInitialArtworkSize(side) {
      await nextFrame();
      const rectangle = printArea.getBoundingClientRect();
      if (!rectangle.width || !rectangle.height || !artwork.naturalWidth || !artwork.naturalHeight) {
        side.artworkBaseWidth = 70;
        return;
      }
      const artworkRatio = artwork.naturalWidth / artwork.naturalHeight;
      const areaRatio = rectangle.width / rectangle.height;
      if (artworkRatio >= areaRatio) side.artworkBaseWidth = 72;
      else {
        const fittedWidth = (72 * rectangle.height * artworkRatio) / rectangle.width;
        side.artworkBaseWidth = clamp(fittedWidth, 22, 72);
      }
    }
    function removeArtwork(side) {
      invalidateSide(side);
      if (side.objectUrl) URL.revokeObjectURL(side.objectUrl);
      Object.assign(side, {
        hasArtwork: false,
        sourceFile: null,
        sourceFileKey: "",
        artworkFileName: "",
        artworkUrl: "",
        shopifyFileId: "",
        uploadedFileKey: "",
        objectUrl: "",
        artworkX: 50,
        artworkY: 50,
        artworkScale: 1,
        artworkBaseWidth: 70,
        quality: "",
      });
      fileInput.value = "";
      renderArtwork(side);
      hideQuality();
      clearError();
    }
    function removeText(side) {
      invalidateSide(side);
      side.hasText = false;
      side.text = "";
      side.textX = 50;
      side.textY = 75;
      side.textSize = 30;
      renderText(side);
      clearError();
    }
    function openStudio() {
      document.body.appendChild(studio);
      studio.hidden = false;
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      applySide(currentKey);
    }
    function closeStudio() {
      studio.hidden = true;
      document.documentElement.style.overflow = oldHtmlOverflow;
      document.body.style.overflow = oldBodyOverflow;
      if (studioOriginalParent) {
        if (studioOriginalNextSibling && studioOriginalNextSibling.parentNode === studioOriginalParent) {
          studioOriginalParent.insertBefore(studio, studioOriginalNextSibling);
        } else studioOriginalParent.appendChild(studio);
      }
    }

    openButton.addEventListener("click", openStudio);
    closeButtons.forEach((button) => button.addEventListener("click", closeStudio));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !studio.hidden) closeStudio();
    });
    fileInput.removeAttribute("name");
    textInput.removeAttribute("name");

    fileInput.addEventListener("change", async () => {
      clearError();
      const side = currentSide();
      const file = fileInput.files?.[0];
      if (!file) return;
      const validationError = validateFile(file);
      if (validationError) {
        showError(validationError);
        fileInput.value = "";
        return;
      }
      invalidateSide(side);
      if (side.objectUrl) URL.revokeObjectURL(side.objectUrl);
      side.objectUrl = URL.createObjectURL(file);
      side.sourceFile = file;
      side.sourceFileKey = [file.name, file.size, file.type, file.lastModified].join(":");
      side.artworkFileName = file.name;
      side.artworkUrl = "";
      side.shopifyFileId = "";
      side.uploadedFileKey = "";
      side.hasArtwork = true;
      side.artworkX = 50;
      side.artworkY = 50;
      side.artworkScale = 1;
      artwork.onload = async () => {
        await calculateInitialArtworkSize(side);
        renderArtwork(side);
        scheduleQuality();
      };
      renderArtwork(side);
    });
    scaleInput.addEventListener("input", () => {
      const side = currentSide();
      if (!side.hasArtwork) return;
      invalidateSide(side);
      side.artworkScale = Number(scaleInput.value) / 100;
      renderArtwork(side);
      scheduleQuality();
    });
    centerButton?.addEventListener("click", () => {
      const side = currentSide();
      if (!side.hasArtwork) return;
      invalidateSide(side);
      side.artworkX = 50;
      side.artworkY = 50;
      renderArtwork(side);
      scheduleQuality();
    });
    resetButton?.addEventListener("click", () => removeArtwork(currentSide()));
    textInput.addEventListener("input", () => {
      const side = currentSide();
      invalidateSide(side);
      side.text = textInput.value.slice(0, 80);
      side.hasText = side.text.trim().length > 0;
      renderText(side);
    });
    fontSelect.addEventListener("change", () => {
      const side = currentSide();
      invalidateSide(side);
      side.textFont = fontSelect.value;
      renderText(side);
    });
    textColorInput.addEventListener("input", () => {
      const side = currentSide();
      invalidateSide(side);
      side.textColor = textColorInput.value;
      renderText(side);
    });
    textSizeInput.addEventListener("input", () => {
      const side = currentSide();
      invalidateSide(side);
      side.textSize = Number(textSizeInput.value);
      renderText(side);
    });
    centerTextButton?.addEventListener("click", () => {
      const side = currentSide();
      if (!side.hasText) return;
      invalidateSide(side);
      side.textX = 50;
      side.textY = 50;
      renderText(side);
    });
    removeTextButton?.addEventListener("click", () => removeText(currentSide()));

    let artworkPointer = null;
    artwork.addEventListener("pointerdown", (event) => {
      const side = currentSide();
      if (!side.hasArtwork || aggregateConfirmed) return;
      event.preventDefault();
      artworkPointer = {
        id: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: side.artworkX,
        startY: side.artworkY,
      };
      artwork.setPointerCapture(event.pointerId);
    });
    artwork.addEventListener("pointermove", (event) => {
      if (!artworkPointer || artworkPointer.id !== event.pointerId) return;
      const side = currentSide();
      const rectangle = printArea.getBoundingClientRect();
      if (!rectangle.width || !rectangle.height) return;
      event.preventDefault();
      invalidateSide(side);
      side.artworkX = clamp(
        artworkPointer.startX + ((event.clientX - artworkPointer.startClientX) / rectangle.width) * 100,
        0,
        100,
      );
      side.artworkY = clamp(
        artworkPointer.startY + ((event.clientY - artworkPointer.startClientY) / rectangle.height) * 100,
        0,
        100,
      );
      renderArtwork(side);
      scheduleQuality();
    });
    function stopArtworkPointer(event) {
      if (!artworkPointer || artworkPointer.id !== event.pointerId) return;
      if (artwork.hasPointerCapture(event.pointerId)) artwork.releasePointerCapture(event.pointerId);
      artworkPointer = null;
    }
    artwork.addEventListener("pointerup", stopArtworkPointer);
    artwork.addEventListener("pointercancel", stopArtworkPointer);

    let textPointer = null;
    textLayer.addEventListener("pointerdown", (event) => {
      const side = currentSide();
      if (!side.hasText || aggregateConfirmed) return;
      event.preventDefault();
      textPointer = {
        id: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: side.textX,
        startY: side.textY,
      };
      textLayer.setPointerCapture(event.pointerId);
    });
    textLayer.addEventListener("pointermove", (event) => {
      if (!textPointer || textPointer.id !== event.pointerId) return;
      const side = currentSide();
      const rectangle = printArea.getBoundingClientRect();
      if (!rectangle.width || !rectangle.height) return;
      event.preventDefault();
      invalidateSide(side);
      side.textX = clamp(
        textPointer.startX + ((event.clientX - textPointer.startClientX) / rectangle.width) * 100,
        0,
        100,
      );
      side.textY = clamp(
        textPointer.startY + ((event.clientY - textPointer.startClientY) / rectangle.height) * 100,
        0,
        100,
      );
      renderText(side);
    });
    function stopTextPointer(event) {
      if (!textPointer || textPointer.id !== event.pointerId) return;
      if (textLayer.hasPointerCapture(event.pointerId)) textLayer.releasePointerCapture(event.pointerId);
      textPointer = null;
    }
    textLayer.addEventListener("pointerup", stopTextPointer);
    textLayer.addEventListener("pointercancel", stopTextPointer);

    const canvasBlob = (canvas) =>
      new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("The approved proof image could not be created."));
        }, "image/png", 1);
      });

    async function createProofFile(side) {
      await nextFrame();
      const areaRect = printArea.getBoundingClientRect();
      if (areaRect.width <= 0 || areaRect.height <= 0) {
        throw new Error(`${side.label} print area is not visible enough to create a proof.`);
      }
      const ratio = areaRect.width / areaRect.height;
      const longEdge = 1400;
      const canvas = document.createElement("canvas");
      if (ratio >= 1) {
        canvas.width = longEdge;
        canvas.height = Math.max(1, Math.round(longEdge / ratio));
      } else {
        canvas.height = longEdge;
        canvas.width = Math.max(1, Math.round(longEdge * ratio));
      }
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The browser could not create the approved proof.");
      const scaleX = canvas.width / areaRect.width;
      const scaleY = canvas.height / areaRect.height;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.beginPath();
      context.rect(0, 0, canvas.width, canvas.height);
      context.clip();
      if (side.hasArtwork && !artwork.hidden && artwork.naturalWidth && artwork.naturalHeight) {
        const artworkRect = artwork.getBoundingClientRect();
        context.drawImage(
          artwork,
          (artworkRect.left - areaRect.left) * scaleX,
          (artworkRect.top - areaRect.top) * scaleY,
          artworkRect.width * scaleX,
          artworkRect.height * scaleY,
        );
      }
      if (side.hasText && !textLayer.hidden && textLayer.textContent?.trim()) {
        const textRect = textLayer.getBoundingClientRect();
        const computed = window.getComputedStyle(textLayer);
        const cssFontSize = Number.parseFloat(computed.fontSize) || 16;
        context.fillStyle = computed.color || "#111111";
        context.font = `${computed.fontWeight || "400"} ${cssFontSize * scaleY}px ${computed.fontFamily || "sans-serif"}`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(
          textLayer.textContent,
          (textRect.left + textRect.width / 2 - areaRect.left) * scaleX,
          (textRect.top + textRect.height / 2 - areaRect.top) * scaleY,
        );
      }
      context.restore();
      const blob = await canvasBlob(canvas);
      const safeProduct = String(customizer.dataset.productId || "product").replace(/[^a-zA-Z0-9_-]/g, "-");
      return new File([blob], `approved-proof-${safeProduct}-${side.key}-${Date.now()}.png`, { type: "image/png" });
    }

    async function ensureArtworkUploaded(side) {
      if (!side.hasArtwork) return;
      if (!side.sourceFile && !side.artworkUrl) throw new Error(`${side.label}: please upload the artwork again.`);
      const needsUpload = side.sourceFile && (!side.artworkUrl || side.uploadedFileKey !== side.sourceFileKey);
      if (!needsUpload) return;
      const uploaded = await uploadFileToShopify(side.sourceFile);
      side.artworkUrl = uploaded.url || "";
      side.shopifyFileId = uploaded.id || "";
      side.uploadedFileKey = side.sourceFileKey;
      if (!side.artworkUrl) throw new Error(`${side.label}: Shopify did not return the artwork URL.`);
    }
    async function ensureProofUploaded(side) {
      applySide(side.key, { keepFileInput: true });
      await nextFrame();
      calculateQuality(side);
      const proofFile = await createProofFile(side);
      const uploaded = await uploadFileToShopify(proofFile);
      side.proofUrl = uploaded.url || "";
      side.proofFileId = uploaded.id || "";
      if (!side.proofUrl) throw new Error(`${side.label}: Shopify did not return the approved proof URL.`);
    }
    const placementFor = (side) => JSON.stringify({
      x: round(side.artworkX),
      y: round(side.artworkY),
      scale: round(side.artworkScale),
      area: {
        left: percent(side.left),
        top: percent(side.top),
        width: percent(side.width),
        height: percent(side.height),
      },
    });
    const textDetailsFor = (side) => JSON.stringify({
      x: round(side.textX),
      y: round(side.textY),
      size: side.textSize,
      font: side.textFont,
      color: side.textColor,
    });
    const printSizeFor = (side) => {
      const width = formatDimension(side.printWidthCm);
      const height = formatDimension(side.printHeightCm);
      return width && height ? `${width} × ${height} cm` : "Not recorded";
    };

    function buildCartProperties() {
      const personalizedSides = personalizedSideList();
      const properties = {
        "_Personalized": "Yes",
        "_Design confirmed": aggregateConfirmed ? "Yes" : "No",
        "_Personalized sides": personalizedSides.map((side) => side.label).join(", "),
      };
      if (personalizedSides.length > 1) {
        properties["Print sides"] = personalizedSides.map((side) => side.label).join(" + ");
      }
      personalizedSides.forEach((side) => {
        const prefix = side.label;
        if (side.artworkUrl) properties[`_${prefix} artwork preview`] = side.artworkUrl;
        if (side.artworkFileName) properties[`_${prefix} artwork file`] = side.artworkFileName;
        if (side.shopifyFileId) properties[`_${prefix} Shopify file ID`] = side.shopifyFileId;
        if (side.proofUrl) properties[`_${prefix} approved proof`] = side.proofUrl;
        properties[`_${prefix} print quality`] = side.quality || "Not measured";
        properties[`_${prefix} print size`] = printSizeFor(side);
        if (side.hasArtwork) properties[`_${prefix} artwork placement`] = placementFor(side);
        if (side.hasText) {
          properties[`_${prefix} text customization`] = textDetailsFor(side);
          properties[`${prefix} text`] = side.text;
        }
      });
      const primary = personalizedSides[0];
      if (primary) {
        if (primary.artworkUrl) properties["_Artwork preview"] = primary.artworkUrl;
        if (primary.artworkFileName) properties["_Artwork file"] = primary.artworkFileName;
        if (primary.shopifyFileId) properties["_Shopify file ID"] = primary.shopifyFileId;
        if (primary.proofUrl) properties["_Approved design proof"] = primary.proofUrl;
        if (primary.hasArtwork) properties["_Artwork placement"] = placementFor(primary);
        if (primary.hasText) {
          properties["_Text customization"] = textDetailsFor(primary);
          properties["Custom text"] = primary.text;
        }
        properties["_Print quality"] = primary.quality || "Not measured";
        properties["_Print size"] = printSizeFor(primary);
        properties["_Print side"] = primary.label;
      }
      Object.keys(properties).forEach((key) => {
        if (properties[key] === "") delete properties[key];
      });
      return properties;
    }

    confirmButton.addEventListener("click", async () => {
      if (confirming) return;
      clearError();
      const personalizedSides = personalizedSideList();
      if (!personalizedSides.length) {
        showError("Please upload an image or add text before confirming your design.");
        return;
      }
      if (uploadIsRequired && !hasAnyArtwork()) {
        showError("Please upload artwork before confirming this product.");
        return;
      }
      const sidesToSave = personalizedSides.filter(
        (side) => !side.confirmed || !side.proofUrl,
      );
      const activeKey = currentKey;
      try {
        setConfirming(true, "Saving design…");
        continueButton.disabled = true;
        setProofStatus(
          sidesToSave.length > 0
            ? "Saving changed artwork and approved proofs…"
            : "Checking saved designs…",
        );
        for (const side of sidesToSave) {
          setConfirming(true, `Saving ${side.label}…`);
          applySide(side.key, { keepFileInput: true });
          await nextFrame();
          await ensureArtworkUploaded(side);
          await ensureProofUploaded(side);
          side.confirmed = true;
        }
        applySide(activeKey);
        aggregateConfirmed = personalizedSides.every((side) => side.confirmed && side.proofUrl);
        if (!aggregateConfirmed) throw new Error("The design could not be fully confirmed.");
        setAggregateConfirmed(true);
        setProofStatus("✓ All personalized sides saved", "saved");
        continueButton.disabled = false;
        continueButton.textContent = originalContinueText;
      } catch (error) {
        console.error("Personalization confirmation failed:", error);
        sidesToSave.forEach((side) => { side.confirmed = false; });
        setAggregateConfirmed(false);
        showError(error instanceof Error ? error.message : "The design could not be confirmed.");
      } finally {
        setConfirming(false);
        applySide(activeKey);
      }
    });

    editDesignButton.addEventListener("click", () => {
      personalizedSideList().forEach((side) => {
        side.confirmed = false;
        side.proofUrl = "";
        side.proofFileId = "";
      });
      setAggregateConfirmed(false);
      applySide(currentKey);
    });

    continueButton.addEventListener("click", async () => {
      clearError();
      if (!aggregateConfirmed) {
        showError("Please confirm your design before continuing.");
        return;
      }
      const personalizedSides = personalizedSideList();
      if (!personalizedSides.length || personalizedSides.some((side) => !side.proofUrl)) {
        showError("The approved proofs are not ready yet. Please confirm the design again.");
        return;
      }
      const variantInput = productForm.querySelector('[name="id"]');
      if (!variantInput?.value) {
        showError("The selected product variant could not be found.");
        return;
      }
      const quantityInput = productForm.querySelector('[name="quantity"]');
      const sellingPlanInput = productForm.querySelector('[name="selling_plan"]');
      const quantity = Math.max(1, Number(quantityInput?.value || 1));
      const item = {
        id: Number(variantInput.value),
        quantity,
        properties: buildCartProperties(),
      };
      if (sellingPlanInput?.value) item.selling_plan = Number(sellingPlanInput.value);
      try {
        continueButton.disabled = true;
        continueButton.textContent = "Adding to cart…";
        const root = window.Shopify?.routes?.root || "/";
        const response = await fetch(`${root}cart/add.js`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ items: [item] }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(result?.description || result?.message || "The personalized product could not be added to the cart.");
        }
        window.location.href = `${root}cart`;
      } catch (error) {
        console.error("Personalized add to cart failed:", error);
        showError(error instanceof Error ? error.message : "The personalized product could not be added to the cart.");
        continueButton.disabled = false;
        continueButton.textContent = originalContinueText;
      }
    });

    productForm.addEventListener("submit", (event) => {
      if (!hasCustomization()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showError(
        aggregateConfirmed
          ? "Use the Add personalized product to cart button to add this design."
          : "Please confirm your design before adding this product to the cart.",
      );
      openStudio();
    }, true);

    function installAutoFit() {
      const row = editControls.querySelector(".pp-button-row");
      if (!row || row.querySelector("[data-pp-auto-fit]")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pp-secondary-button";
      button.dataset.ppAutoFit = "true";
      button.textContent = "Auto fit";
      if (centerButton?.parentNode === row) row.insertBefore(button, centerButton);
      else row.prepend(button);
      button.addEventListener("click", async () => {
        const side = currentSide();
        if (!side.hasArtwork || !artwork.naturalWidth) return;
        invalidateSide(side);
        side.artworkX = 50;
        side.artworkY = 50;
        side.artworkScale = 1;
        renderArtwork(side);
        await nextFrame();
        const areaRect = printArea.getBoundingClientRect();
        const artworkRect = artwork.getBoundingClientRect();
        if (areaRect.width <= 0 || areaRect.height <= 0 || artworkRect.width <= 0 || artworkRect.height <= 0) return;
        const widthFit = (areaRect.width * 0.9) / artworkRect.width;
        const heightFit = (areaRect.height * 0.9) / artworkRect.height;
        const minScale = Number(scaleInput.min || 30) / 100;
        const maxScale = Number(scaleInput.max || 200) / 100;
        side.artworkScale = clamp(Math.min(widthFit, heightFit), minScale, maxScale);
        renderArtwork(side);
        scheduleQuality();
      });
    }
    installAutoFit();

    async function loadConfig() {
      const gid = productGid(customizer.dataset.productId);
      if (!gid) {
        configLoaded = true;
        return;
      }
      try {
        const result = await postProxyJson({ action: "config", productId: gid });
        const config = result?.config || {};
        front.printWidthCm = Number(config.printWidthCm) || 0;
        front.printHeightCm = Number(config.printHeightCm) || 0;
        if (config.front?.imageUrl && !front.imageUrl) front.imageUrl = config.front.imageUrl;
        if (config.back?.enabled && config.back?.imageUrl) {
          backEnabled = true;
          back.imageUrl = config.back.imageUrl;
          back.left = config.back.left;
          back.top = config.back.top;
          back.width = config.back.width;
          back.height = config.back.height;
          back.printWidthCm = Number(config.back.printWidthCm) || 0;
          back.printHeightCm = Number(config.back.printHeightCm) || 0;
          tabs = createTabs(preview);
          tabs.front.addEventListener("click", () => applySide("front"));
          tabs.back.addEventListener("click", () => applySide("back"));
          updateTabStyles();
        }
      } catch (error) {
        console.warn("Personalize Preview product configuration unavailable:", error);
      } finally {
        configLoaded = true;
        scheduleQuality();
      }
    }

    productImage.addEventListener("load", scheduleQuality);
    artwork.addEventListener("load", scheduleQuality);
    window.addEventListener("resize", scheduleQuality);
    setAggregateConfirmed(false);
    renderArtwork(front);
    renderText(front);
    loadConfig();

    customizer.ppDiagnostics = () => ({
      configLoaded,
      backEnabled,
      currentSide: currentKey,
      confirmed: aggregateConfirmed,
      front: {
        customized: front.hasArtwork || front.hasText,
        artwork: front.hasArtwork,
        text: front.hasText,
        proof: Boolean(front.proofUrl),
      },
      back: {
        customized: back.hasArtwork || back.hasText,
        artwork: back.hasArtwork,
        text: back.hasText,
        proof: Boolean(back.proofUrl),
      },
    });
  }

  function initializeAll(scope = document) {
    if (!scope?.querySelectorAll) return;
    scope.querySelectorAll(CUSTOMIZER_SELECTOR).forEach(initialize);
  }

  initializeAll();
  document.addEventListener("shopify:section:load", (event) => {
    initializeAll(event.target || document);
  });
})();
