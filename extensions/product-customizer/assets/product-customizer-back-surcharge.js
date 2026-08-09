(() => {
  const CUSTOMIZER_SELECTOR = "[data-product-customizer]";
  const PRICING_URL = "/apps/personalize-preview/pricing";
  const initialized = new WeakSet();

  const productGid = (rawId) => {
    const value = String(rawId || "").trim();
    if (!value) return "";
    return value.startsWith("gid://shopify/Product/")
      ? value
      : `gid://shopify/Product/${value}`;
  };

  function formatFee(config) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: config.currencyCode || "USD",
        maximumFractionDigits: 2,
      }).format(config.surcharge);
    } catch {
      return `${config.surcharge.toFixed(2)} ${config.currencyCode || ""}`.trim();
    }
  }

  function installPriceNote(config) {
    const addNote = () => {
      if (!config.customizer.isConnected) return;
      const tabs = config.customizer.querySelector(".pp-print-side-tabs");
      if (!tabs || tabs.parentNode?.querySelector("[data-pp-back-surcharge-note]")) return;

      const note = document.createElement("div");
      note.dataset.ppBackSurchargeNote = "true";
      note.textContent = `Back personalization adds ${formatFee(config)}`;
      note.style.margin = "-7px 0 13px";
      note.style.color = "rgba(17,17,17,.62)";
      note.style.fontSize = "11px";
      note.style.fontWeight = "650";
      note.style.textAlign = "center";
      note.style.lineHeight = "1.4";
      tabs.insertAdjacentElement("afterend", note);
    };

    addNote();
    const observer = new MutationObserver(addNote);
    observer.observe(config.customizer, { childList: true, subtree: true });
  }

  async function loadPricing(customizer) {
    const gid = productGid(customizer.dataset.productId);
    if (!gid) return null;

    const response = await fetch(PRICING_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ productId: gid }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || "The Back-side price could not be loaded.");
    }
    return result;
  }

  async function initialize(customizer) {
    if (initialized.has(customizer)) return;
    initialized.add(customizer);

    try {
      const pricing = await loadPricing(customizer);
      if (!pricing?.backEnabled || Number(pricing.surcharge) <= 0) return;

      installPriceNote({
        customizer,
        surcharge: Number(pricing.surcharge) || 0,
        currencyCode: String(pricing.currencyCode || ""),
      });
    } catch (error) {
      console.warn("Personalize Preview Back pricing unavailable:", error);
    }
  }

  function initializeAll(scope = document) {
    if (!scope?.querySelectorAll) return;
    scope.querySelectorAll(CUSTOMIZER_SELECTOR).forEach((customizer) => {
      void initialize(customizer);
    });
  }

  initializeAll();
  document.addEventListener("shopify:section:load", (event) => {
    initializeAll(event.target || document);
  });
})();
