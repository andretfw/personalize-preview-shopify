(() => {
  const CUSTOMIZER_SELECTOR = "[data-product-customizer]";
  const PROXY_URL = "/apps/personalize-preview";
  const initialized = new WeakSet();
  let cartInterceptorInstalled = false;
  let pendingSideProperties = null;

  function safeJson(response) {
    return response.json().catch(() => null);
  }

  function productGid(rawId) {
    const value = String(rawId || "").trim();
    if (!value) return "";
    return value.startsWith("gid://shopify/Product/")
      ? value
      : `gid://shopify/Product/${value}`;
  }

  async function loadConfig(productId) {
    const response = await fetch(PROXY_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ action: "config", productId }),
    });

    const result = await safeJson(response);
    if (!response.ok || !result?.ok || !result?.config) {
      throw new Error(result?.error || "The print-side setup could not be loaded.");
    }

    return result.config;
  }

  function formatDimension(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "";
    return Number.isInteger(number)
      ? String(number)
      : String(Math.round(number * 10) / 10);
  }

  function setPendingSideProperties(properties) {
    pendingSideProperties = properties;
    const expected = properties;

    window.setTimeout(() => {
      if (pendingSideProperties === expected) pendingSideProperties = null;
    }, 5000);
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
        pendingSideProperties &&
        /\/cart\/add\.js(?:\?|$)/.test(url) &&
        typeof init?.body === "string"
      ) {
        try {
          const payload = JSON.parse(init.body);
          if (Array.isArray(payload?.items)) {
            const extra = pendingSideProperties;
            payload.items = payload.items.map((item) => {
              const properties = item?.properties || {};
              const personalized =
                properties["_Personalized"] === "Yes" ||
                properties["_Design confirmed"] === "Yes";

              if (!personalized) return item;

              let placement = properties["_Artwork placement"] || "";
              if (placement) {
                try {
                  const parsed = JSON.parse(placement);
                  placement = JSON.stringify({
                    ...parsed,
                    side: extra["_Print side"],
                  });
                } catch {
                  // Keep legacy placement text unchanged if it is not JSON.
                }
              }

              return {
                ...item,
                properties: {
                  ...properties,
                  ...extra,
                  ...(placement ? { "_Artwork placement": placement } : {}),
                },
              };
            });

            pendingSideProperties = null;
            return nativeFetch(input, {
              ...init,
              body: JSON.stringify(payload),
            });
          }
        } catch (error) {
          console.warn("Could not attach print-side data to cart request:", error);
        }
      }

      return nativeFetch(input, init);
    };
  }

  function percent(value) {
    const text = String(value ?? "").trim();
    if (!text) return "0%";
    return text.endsWith("%") ? text : `${text}%`;
  }

  function createTabs(previewColumn) {
    const row = document.createElement("div");
    row.className = "pp-print-side-tabs";
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.margin = "0 0 10px";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Choose print side");

    const createButton = (label) => {
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

    const front = createButton("Front");
    const back = createButton("Back");
    row.append(front, back);
    previewColumn.prepend(row);
    return { row, front, back };
  }

  function createQualityCard(editControls) {
    const card = document.createElement("div");
    card.className = "pp-side-quality-guard";
    card.hidden = true;
    card.setAttribute("aria-live", "polite");
    card.style.display = "none";
    card.style.gap = "3px";
    card.style.marginTop = "12px";
    card.style.padding = "11px 12px";
    card.style.border = "1px solid rgba(17,17,17,.12)";
    card.style.borderRadius = "10px";
    card.style.background = "#f7f7f5";
    card.style.lineHeight = "1.35";

    const label = document.createElement("strong");
    label.style.fontSize = "12px";
    const detail = document.createElement("span");
    detail.style.fontSize = "11px";
    detail.style.color = "rgba(17,17,17,.62)";
    card.append(label, detail);

    if (editControls?.parentNode) {
      editControls.parentNode.insertBefore(card, editControls.nextSibling);
    }

    return { card, label, detail };
  }

  function initialize(customizer) {
    if (initialized.has(customizer)) return;
    initialized.add(customizer);
    installCartInterceptor();

    const productId = productGid(customizer.dataset.productId);
    if (!productId) return;

    loadConfig(productId)
      .then((config) => {
        if (!config?.back?.enabled || !config.back.imageUrl) return;

        const studio = customizer.querySelector("[data-pp-studio]");
        const previewColumn = customizer.querySelector(".pp-studio-preview-column");
        const productImage = customizer.querySelector(".pp-product-image");
        const printArea = customizer.querySelector("[data-pp-print-area]");
        const emptyState = customizer.querySelector("[data-pp-empty-state] span");
        const artwork = customizer.querySelector("[data-pp-artwork]");
        const scaleInput = customizer.querySelector("[data-pp-scale]");
        const editControls = customizer.querySelector("[data-pp-edit-controls]");
        const continueButton = customizer.querySelector("[data-pp-continue]");
        const editDesignButton = customizer.querySelector("[data-pp-edit-design]");

        if (
          !studio ||
          !previewColumn ||
          !productImage ||
          !printArea ||
          !artwork ||
          !scaleInput ||
          !editControls ||
          !continueButton
        ) {
          console.warn("Personalize Preview print sides: customizer markup is incomplete.");
          return;
        }

        const styles = window.getComputedStyle(customizer);
        const originalImage = productImage.currentSrc || productImage.src;
        const front = {
          label: "Front",
          imageUrl: originalImage || config.front?.imageUrl || "",
          left: styles.getPropertyValue("--pp-print-left").trim(),
          top: styles.getPropertyValue("--pp-print-top").trim(),
          width: styles.getPropertyValue("--pp-print-width").trim(),
          height: styles.getPropertyValue("--pp-print-height").trim(),
          printWidthCm: Number(config.front?.printWidthCm) || 0,
          printHeightCm: Number(config.front?.printHeightCm) || 0,
        };
        const back = {
          label: "Back",
          imageUrl: config.back.imageUrl,
          left: config.back.left,
          top: config.back.top,
          width: config.back.width,
          height: config.back.height,
          printWidthCm: Number(config.back.printWidthCm) || 0,
          printHeightCm: Number(config.back.printHeightCm) || 0,
        };
        const sides = { front, back };
        let currentKey = "front";
        let currentQualitySummary = "";

        const tabs = createTabs(previewColumn);
        const quality = createQualityCard(editControls);

        function hideGenericQualityCards() {
          studio.querySelectorAll(".pp-quality-guard").forEach((card) => {
            card.style.display = "none";
          });
        }

        const qualityObserver = new MutationObserver(hideGenericQualityCards);
        qualityObserver.observe(studio, { childList: true, subtree: true });
        hideGenericQualityCards();

        function currentSide() {
          return sides[currentKey];
        }

        function updateTabStyles() {
          [[tabs.front, "front"], [tabs.back, "back"]].forEach(([button, key]) => {
            const active = currentKey === key;
            button.style.background = active ? "#111" : "#fff";
            button.style.color = active ? "#fff" : "#222";
            button.style.borderColor = active ? "#111" : "rgba(17,17,17,.18)";
            button.setAttribute("aria-pressed", active ? "true" : "false");
          });
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

        function hideQuality() {
          quality.card.hidden = true;
          quality.card.style.display = "none";
          quality.label.textContent = "";
          quality.detail.textContent = "";
          currentQualitySummary = "";
        }

        function updateQuality() {
          const side = currentSide();
          const printWidthCm = Number(side.printWidthCm) || 0;
          const printHeightCm = Number(side.printHeightCm) || 0;

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

          quality.card.hidden = false;
          quality.card.style.display = "grid";

          if (dpi >= 250) {
            quality.card.style.borderColor = "rgba(0,110,82,.25)";
            quality.card.style.background = "#f0faf5";
            quality.label.style.color = "#006e52";
            quality.label.textContent = `${side.label} print quality: Great`;
            quality.detail.textContent = `About ${dpi} DPI at this size. Good to print.`;
            currentQualitySummary = `Great · ~${dpi} DPI`;
            return;
          }

          if (dpi >= 150) {
            quality.card.style.borderColor = "rgba(157,105,0,.28)";
            quality.card.style.background = "#fff9e9";
            quality.label.style.color = "#7a5200";
            quality.label.textContent = `${side.label} print quality: Okay`;
            quality.detail.textContent = `About ${dpi} DPI. A higher-resolution image would be sharper.`;
            currentQualitySummary = `Okay · ~${dpi} DPI`;
            return;
          }

          quality.card.style.borderColor = "rgba(183,45,35,.24)";
          quality.card.style.background = "#fff3f1";
          quality.label.style.color = "#9d2118";
          quality.label.textContent = `${side.label} print quality: Too low`;
          quality.detail.textContent = `About ${dpi} DPI. Use a larger image or make the artwork smaller.`;
          currentQualitySummary = `Too low · ~${dpi} DPI`;
        }

        function scheduleQuality() {
          window.requestAnimationFrame(updateQuality);
        }

        function applySide(key) {
          if (!sides[key]) return;
          if (customizer.classList.contains("pp-is-confirmed")) {
            editDesignButton?.click();
          }

          currentKey = key;
          const side = currentSide();
          productImage.src = side.imageUrl;
          setPrintVariables(side);
          customizer.dataset.ppPrintSide = side.label;
          if (emptyState) emptyState.textContent = `${side.label} print area`;
          updateTabStyles();
          scaleInput.dispatchEvent(new Event("input", { bubbles: true }));
          scheduleQuality();
        }

        tabs.front.addEventListener("click", () => applySide("front"));
        tabs.back.addEventListener("click", () => applySide("back"));
        artwork.addEventListener("load", scheduleQuality);
        scaleInput.addEventListener("input", scheduleQuality);
        productImage.addEventListener("load", scheduleQuality);
        window.addEventListener("resize", scheduleQuality);

        continueButton.addEventListener(
          "click",
          () => {
            updateQuality();
            const side = currentSide();
            const width = formatDimension(side.printWidthCm);
            const height = formatDimension(side.printHeightCm);
            const size = width && height
              ? `${side.label} · ${width} × ${height} cm`
              : `${side.label} · size not configured`;

            setPendingSideProperties({
              "Print side": side.label,
              "_Print side": side.label,
              "_Print size": size,
              "_Print quality": currentQualitySummary || "Not measured",
            });
          },
          true,
        );

        applySide("front");
      })
      .catch((error) => {
        console.warn("Personalize Preview print sides unavailable:", error);
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
