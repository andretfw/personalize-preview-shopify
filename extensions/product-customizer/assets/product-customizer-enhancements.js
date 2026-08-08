(() => {
  const CUSTOMIZER_SELECTOR = "[data-product-customizer]";
  const PROXY_URL = "/apps/personalize-preview";
  const initialized = new WeakSet();
  let stylesInstalled = false;
  let cartInterceptorInstalled = false;
  let pendingCartProperties = null;

  function installStyles() {
    if (stylesInstalled) return;
    stylesInstalled = true;

    const style = document.createElement("style");
    style.textContent = `
      .pp-quality-guard {
        display: grid;
        gap: 3px;
        margin-top: 12px;
        padding: 11px 12px;
        border: 1px solid rgba(17,17,17,.12);
        border-radius: 10px;
        background: #f7f7f5;
        color: #303633;
        line-height: 1.35;
      }
      .pp-quality-guard[hidden] { display: none !important; }
      .pp-quality-guard strong { font-size: 12px; font-weight: 780; }
      .pp-quality-guard span { font-size: 11px; color: rgba(17,17,17,.62); }
      .pp-quality-guard[data-quality="great"] {
        border-color: rgba(0,110,82,.25);
        background: #f0faf5;
      }
      .pp-quality-guard[data-quality="great"] strong { color: #006e52; }
      .pp-quality-guard[data-quality="okay"] {
        border-color: rgba(157,105,0,.28);
        background: #fff9e9;
      }
      .pp-quality-guard[data-quality="okay"] strong { color: #7a5200; }
      .pp-quality-guard[data-quality="low"] {
        border-color: rgba(183,45,35,.24);
        background: #fff3f1;
      }
      .pp-quality-guard[data-quality="low"] strong { color: #9d2118; }
      .pp-proof-status {
        margin: 8px 0 0;
        color: rgba(17,17,17,.62);
        font-size: 11px;
        line-height: 1.4;
      }
      .pp-proof-status[data-state="saved"] { color: #006e52; font-weight: 700; }
      .pp-proof-status[data-state="error"] { color: #9d2118; font-weight: 700; }
      .pp-proof-status[hidden] { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  function installCartInterceptor() {
    if (cartInterceptorInstalled) return;
    cartInterceptorInstalled = true;

    const nativeFetch = window.fetch.bind(window);

    window.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input?.url || "";

      if (
        pendingCartProperties &&
        /\/cart\/add\.js(?:\?|$)/.test(url) &&
        typeof init?.body === "string"
      ) {
        try {
          const payload = JSON.parse(init.body);
          if (Array.isArray(payload?.items)) {
            const extraProperties = pendingCartProperties;
            payload.items = payload.items.map((item) => ({
              ...item,
              properties: {
                ...(item?.properties || {}),
                ...extraProperties,
              },
            }));

            pendingCartProperties = null;
            return nativeFetch(input, {
              ...init,
              body: JSON.stringify(payload),
            });
          }
        } catch (error) {
          console.warn("Could not attach approved proof to cart request:", error);
        }
      }

      return nativeFetch(input, init);
    };
  }

  function setPendingCartProperties(properties) {
    pendingCartProperties = properties;
    const expected = properties;

    window.setTimeout(() => {
      if (pendingCartProperties === expected) {
        pendingCartProperties = null;
      }
    }, 5000);
  }

  function safeJson(response) {
    return response.json().catch(() => null);
  }

  async function postProxyJson(payload) {
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
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function waitForUploadedFile(file) {
    if (file?.url) return file;
    if (!file?.id) throw new Error("Shopify did not return a proof file ID.");

    let current = file;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      if (current?.url) return current;
      if (current?.status === "FAILED") {
        throw new Error("Shopify could not process the approved proof.");
      }

      await sleep(700);
      const result = await postProxyJson({ action: "status", fileId: file.id });
      current = result.file;
    }

    throw new Error("The approved proof is still processing. Please confirm again.");
  }

  async function uploadImageFile(file) {
    const prepared = await postProxyJson({
      action: "prepare-upload",
      filename: file.name,
      mimeType: file.type,
      fileSize: file.size,
    });

    const upload = prepared?.upload;
    if (!upload?.url || !upload?.resourceUrl) {
      throw new Error("Shopify did not return a proof upload destination.");
    }

    const data = new FormData();
    (Array.isArray(upload.parameters) ? upload.parameters : []).forEach((parameter) => {
      if (parameter?.name && typeof parameter.value === "string") {
        data.append(parameter.name, parameter.value);
      }
    });
    data.append("file", file, upload.filename || file.name);

    const stagedResponse = await fetch(upload.url, {
      method: "POST",
      body: data,
    });

    if (!stagedResponse.ok) {
      throw new Error("Shopify could not receive the approved proof.");
    }

    const completed = await postProxyJson({
      action: "complete-upload",
      resourceUrl: upload.resourceUrl,
      filename: upload.filename || file.name,
    });

    if (!completed?.file?.id) {
      throw new Error("Shopify did not create the approved proof file.");
    }

    return waitForUploadedFile(completed.file);
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The approved proof image could not be created."));
      }, "image/png", 1);
    });
  }

  async function createProofFile(productId, artwork, printArea, textLayer) {
    const areaRect = printArea.getBoundingClientRect();
    if (areaRect.width <= 0 || areaRect.height <= 0) {
      throw new Error("The print area is not visible enough to create a proof.");
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

    if (!artwork.hidden && artwork.naturalWidth && artwork.naturalHeight) {
      const artworkRect = artwork.getBoundingClientRect();
      context.drawImage(
        artwork,
        (artworkRect.left - areaRect.left) * scaleX,
        (artworkRect.top - areaRect.top) * scaleY,
        artworkRect.width * scaleX,
        artworkRect.height * scaleY,
      );
    }

    if (textLayer && !textLayer.hidden && textLayer.textContent?.trim()) {
      const textRect = textLayer.getBoundingClientRect();
      const computed = window.getComputedStyle(textLayer);
      const cssFontSize = Number.parseFloat(computed.fontSize) || 16;
      const fontSize = cssFontSize * scaleY;
      const fontWeight = computed.fontWeight || "400";
      const fontFamily = computed.fontFamily || "sans-serif";

      context.fillStyle = computed.color || "#111111";
      context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
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
    const safeId = String(productId || "product").replace(/[^a-zA-Z0-9_-]/g, "-");
    return new File(
      [blob],
      `approved-proof-${safeId}-${Date.now()}.png`,
      { type: "image/png" },
    );
  }

  function productGid(rawId) {
    const value = String(rawId || "").trim();
    if (!value) return "";
    return value.startsWith("gid://shopify/Product/")
      ? value
      : `gid://shopify/Product/${value}`;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function createQualityCard(editControls) {
    const card = document.createElement("div");
    card.className = "pp-quality-guard";
    card.hidden = true;
    card.setAttribute("aria-live", "polite");

    const label = document.createElement("strong");
    const detail = document.createElement("span");
    card.append(label, detail);

    if (editControls?.parentNode) {
      editControls.parentNode.insertBefore(card, editControls.nextSibling);
    }

    return { card, label, detail };
  }

  function initialize(customizer) {
    if (initialized.has(customizer)) return;
    initialized.add(customizer);
    installStyles();
    installCartInterceptor();

    const fileInput = customizer.querySelector("[data-pp-file]");
    const artwork = customizer.querySelector("[data-pp-artwork]");
    const printArea = customizer.querySelector("[data-pp-print-area]");
    const scaleInput = customizer.querySelector("[data-pp-scale]");
    const centerButton = customizer.querySelector("[data-pp-center]");
    const resetButton = customizer.querySelector("[data-pp-reset]");
    const editControls = customizer.querySelector("[data-pp-edit-controls]");
    const textLayer = customizer.querySelector("[data-pp-text-layer]");
    const continueButton = customizer.querySelector("[data-pp-continue]");
    const confirmedState = customizer.querySelector("[data-pp-confirmed-state]");
    const errorMessage = customizer.querySelector("[data-pp-error]");

    if (!fileInput || !artwork || !printArea || !scaleInput || !editControls) {
      return;
    }

    const { card, label, detail } = createQualityCard(editControls);
    let printWidthCm = 0;
    let printHeightCm = 0;
    let currentQualitySummary = "";
    let approvedProofUrl = "";
    let proofVersion = 0;
    let proofSaving = false;
    const originalContinueText = continueButton?.textContent?.trim() ||
      "Add personalized product to cart";

    const proofStatus = document.createElement("p");
    proofStatus.className = "pp-proof-status";
    proofStatus.hidden = true;
    confirmedState?.appendChild(proofStatus);

    function setProofStatus(message, state = "") {
      proofStatus.textContent = message;
      proofStatus.hidden = !message;
      if (state) proofStatus.dataset.state = state;
      else proofStatus.removeAttribute("data-state");
    }

    function showProofError(message) {
      setProofStatus(message, "error");
      if (errorMessage) {
        errorMessage.textContent = message;
        errorMessage.hidden = false;
      }
    }

    function hideQuality() {
      card.hidden = true;
      card.removeAttribute("data-quality");
      label.textContent = "";
      detail.textContent = "";
      currentQualitySummary = "";
    }

    function updateQuality() {
      if (
        artwork.hidden ||
        !artwork.naturalWidth ||
        !artwork.naturalHeight ||
        printWidthCm <= 0 ||
        printHeightCm <= 0
      ) {
        hideQuality();
        return;
      }

      const artworkRect = artwork.getBoundingClientRect();
      const areaRect = printArea.getBoundingClientRect();

      if (
        areaRect.width <= 0 ||
        areaRect.height <= 0 ||
        artworkRect.width <= 0 ||
        artworkRect.height <= 0
      ) {
        hideQuality();
        return;
      }

      const printedWidthCm = printWidthCm * (artworkRect.width / areaRect.width);
      const printedHeightCm = printHeightCm * (artworkRect.height / areaRect.height);

      if (printedWidthCm <= 0 || printedHeightCm <= 0) {
        hideQuality();
        return;
      }

      const dpiWidth = artwork.naturalWidth / (printedWidthCm / 2.54);
      const dpiHeight = artwork.naturalHeight / (printedHeightCm / 2.54);
      const dpi = Math.max(1, Math.round(Math.min(dpiWidth, dpiHeight)));

      card.hidden = false;

      if (dpi >= 250) {
        card.dataset.quality = "great";
        label.textContent = "Print quality: Great";
        detail.textContent = `About ${dpi} DPI at this size. Good to print.`;
        currentQualitySummary = `Great · ~${dpi} DPI`;
        return;
      }

      if (dpi >= 150) {
        card.dataset.quality = "okay";
        label.textContent = "Print quality: Okay";
        detail.textContent = `About ${dpi} DPI. A higher-resolution image would be sharper.`;
        currentQualitySummary = `Okay · ~${dpi} DPI`;
        return;
      }

      card.dataset.quality = "low";
      label.textContent = "Print quality: Too low";
      detail.textContent = `About ${dpi} DPI. Use a larger image or make this artwork smaller to avoid blur.`;
      currentQualitySummary = `Too low · ~${dpi} DPI`;
    }

    function scheduleQualityUpdate() {
      window.requestAnimationFrame(updateQuality);
    }

    async function saveApprovedProof() {
      if (proofSaving || approvedProofUrl || !customizer.classList.contains("pp-is-confirmed")) {
        return;
      }

      proofSaving = true;
      const version = ++proofVersion;

      if (continueButton) {
        continueButton.disabled = true;
        continueButton.textContent = "Saving approved proof…";
      }
      setProofStatus("Saving approved proof…");

      try {
        const proofFile = await createProofFile(
          customizer.dataset.productId,
          artwork,
          printArea,
          textLayer,
        );
        const uploaded = await uploadImageFile(proofFile);

        if (
          version !== proofVersion ||
          !customizer.classList.contains("pp-is-confirmed")
        ) {
          return;
        }

        approvedProofUrl = uploaded.url || "";
        if (!approvedProofUrl) {
          throw new Error("Shopify did not return the approved proof URL.");
        }

        setProofStatus("✓ Approved proof saved", "saved");
        if (continueButton) {
          continueButton.disabled = false;
          continueButton.textContent = originalContinueText;
        }
      } catch (error) {
        if (version !== proofVersion) return;

        console.error("Approved proof save failed:", error);
        approvedProofUrl = "";
        showProofError(
          error instanceof Error
            ? `${error.message} Click Edit design, then Confirm design again.`
            : "The approved proof could not be saved. Click Edit design, then Confirm design again.",
        );

        if (continueButton) {
          continueButton.disabled = true;
          continueButton.textContent = "Proof not saved";
        }
      } finally {
        if (version === proofVersion) proofSaving = false;
      }
    }

    const buttonRow = editControls.querySelector(".pp-button-row");
    if (buttonRow) {
      const autoFitButton = document.createElement("button");
      autoFitButton.type = "button";
      autoFitButton.className = "pp-secondary-button";
      autoFitButton.textContent = "Auto fit";

      if (centerButton?.parentNode === buttonRow) {
        buttonRow.insertBefore(autoFitButton, centerButton);
      } else {
        buttonRow.prepend(autoFitButton);
      }

      autoFitButton.addEventListener("click", () => {
        if (artwork.hidden || !artwork.naturalWidth || !artwork.naturalHeight) {
          return;
        }

        centerButton?.click();
        scaleInput.value = "100";
        scaleInput.dispatchEvent(new Event("input", { bubbles: true }));

        window.requestAnimationFrame(() => {
          const areaRect = printArea.getBoundingClientRect();
          const artworkRect = artwork.getBoundingClientRect();

          if (
            areaRect.width <= 0 ||
            areaRect.height <= 0 ||
            artworkRect.width <= 0 ||
            artworkRect.height <= 0
          ) {
            return;
          }

          const widthFit = (areaRect.width * 0.9) / artworkRect.width;
          const heightFit = (areaRect.height * 0.9) / artworkRect.height;
          const minScale = Number(scaleInput.min || 30) / 100;
          const maxScale = Number(scaleInput.max || 200) / 100;
          const targetScale = clamp(Math.min(widthFit, heightFit), minScale, maxScale);

          scaleInput.value = String(Math.round(targetScale * 100));
          scaleInput.dispatchEvent(new Event("input", { bubbles: true }));
          centerButton?.click();
          scheduleQualityUpdate();
        });
      });
    }

    artwork.addEventListener("load", scheduleQualityUpdate);
    scaleInput.addEventListener("input", scheduleQualityUpdate);
    fileInput.addEventListener("change", scheduleQualityUpdate);
    resetButton?.addEventListener("click", scheduleQualityUpdate);
    window.addEventListener("resize", scheduleQualityUpdate);

    if (continueButton) {
      continueButton.addEventListener(
        "click",
        () => {
          if (!approvedProofUrl) return;

          const extra = {
            "_Approved design proof": approvedProofUrl,
          };
          if (currentQualitySummary) {
            extra["_Print quality"] = currentQualitySummary;
          }
          setPendingCartProperties(extra);
        },
        true,
      );
    }

    const confirmationObserver = new MutationObserver(() => {
      if (customizer.classList.contains("pp-is-confirmed")) {
        scheduleQualityUpdate();
        window.requestAnimationFrame(saveApprovedProof);
        return;
      }

      proofVersion += 1;
      proofSaving = false;
      approvedProofUrl = "";
      setProofStatus("");
      if (continueButton) {
        continueButton.textContent = originalContinueText;
      }
    });

    confirmationObserver.observe(customizer, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const gid = productGid(customizer.dataset.productId);
    if (gid) {
      postProxyJson({ action: "config", productId: gid })
        .then((result) => {
          printWidthCm = Number(result?.config?.printWidthCm) || 0;
          printHeightCm = Number(result?.config?.printHeightCm) || 0;
          scheduleQualityUpdate();
        })
        .catch((error) => {
          console.warn("Personalize Preview quality settings unavailable:", error);
          hideQuality();
        });
    }
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
