(() => {
  const CUSTOMIZER_SELECTOR = "[data-product-customizer]";
  const PROXY_URL = "/apps/personalize-preview";
  const initialized = new WeakSet();
  let stylesInstalled = false;

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
    `;
    document.head.appendChild(style);
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
      throw new Error(result?.error || "The production settings could not be loaded.");
    }
    return result;
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

    const fileInput = customizer.querySelector("[data-pp-file]");
    const artwork = customizer.querySelector("[data-pp-artwork]");
    const printArea = customizer.querySelector("[data-pp-print-area]");
    const scaleInput = customizer.querySelector("[data-pp-scale]");
    const centerButton = customizer.querySelector("[data-pp-center]");
    const resetButton = customizer.querySelector("[data-pp-reset]");
    const editControls = customizer.querySelector("[data-pp-edit-controls]");

    if (!fileInput || !artwork || !printArea || !scaleInput || !editControls) {
      return;
    }

    const { card, label, detail } = createQualityCard(editControls);
    let printWidthCm = 0;
    let printHeightCm = 0;

    function hideQuality() {
      card.hidden = true;
      card.removeAttribute("data-quality");
      label.textContent = "";
      detail.textContent = "";
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
        return;
      }

      if (dpi >= 150) {
        card.dataset.quality = "okay";
        label.textContent = "Print quality: Okay";
        detail.textContent = `About ${dpi} DPI. A higher-resolution image would be sharper.`;
        return;
      }

      card.dataset.quality = "low";
      label.textContent = "Print quality: Too low";
      detail.textContent = `About ${dpi} DPI. Use a larger image or make this artwork smaller to avoid blur.`;
    }

    function scheduleQualityUpdate() {
      window.requestAnimationFrame(updateQuality);
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
    scope.querySelectorAll(CUSTOMIZER_SELECTOR).forEach(initialize);
  }

  initializeAll();

  document.addEventListener("shopify:section:load", (event) => {
    initializeAll(event.target || document);
  });
})();
