(() => {
  const CUSTOMIZER_SELECTOR = "[data-product-customizer]";
  const PRICING_URL = "/apps/personalize-preview/pricing";
  const initialized = new WeakSet();
  const configs = new Set();
  let interceptorInstalled = false;

  const productGid = (rawId) => {
    const value = String(rawId || "").trim();
    if (!value) return "";
    return value.startsWith("gid://shopify/Product/")
      ? value
      : `gid://shopify/Product/${value}`;
  };

  function findProductForm(customizer) {
    const closest = customizer.closest('form[action*="/cart/add"]');
    if (closest) return closest;

    const section =
      customizer.closest('[id^="shopify-section-"]') ||
      customizer.closest(".shopify-section") ||
      document;
    const forms = Array.from(section.querySelectorAll('form[action*="/cart/add"]'));
    return forms.find((form) => form.querySelector('[name="id"]')) || forms[0] || null;
  }

  function currentVariantId(config) {
    const raw = config.productForm?.querySelector('[name="id"]')?.value || "";
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : 0;
  }

  function backIsPersonalized(properties) {
    if (!properties || typeof properties !== "object") return false;
    const sides = String(properties["_Personalized sides"] || "");
    if (sides.split(",").some((side) => side.trim().toLowerCase() === "back")) {
      return true;
    }

    return Boolean(
      properties["_Back artwork preview"] ||
        properties["_Back approved proof"] ||
        properties["_Back artwork placement"] ||
        properties["Back text"],
    );
  }

  function findConfigForItem(item) {
    const itemId = Number(item?.id || 0);
    const active = Array.from(configs).filter(
      (config) => config.surcharge > 0 && config.backEnabled,
    );
    return (
      active.find((config) => currentVariantId(config) === itemId) ||
      (active.length === 1 ? active[0] : null)
    );
  }

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
    config.observer = observer;
  }

  function installCartInterceptor() {
    if (interceptorInstalled) return;
    interceptorInstalled = true;
    const nativeFetch = window.fetch.bind(window);

    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input?.url || "";

      if (!/\/cart\/add\.js(?:\?|$)/.test(url) || typeof init?.body !== "string") {
        return nativeFetch(input, init);
      }

      let payload;
      try {
        payload = JSON.parse(init.body);
      } catch {
        return nativeFetch(input, init);
      }

      if (!Array.isArray(payload?.items)) return nativeFetch(input, init);

      const originalItems = [...payload.items];
      const additions = [];

      for (const item of originalItems) {
        if (!backIsPersonalized(item?.properties)) continue;
        const config = findConfigForItem(item);
        if (!config || config.surcharge <= 0) continue;

        const feeVariantId = Number(config.feeVariantId || 0);
        if (!Number.isFinite(feeVariantId) || feeVariantId <= 0) {
          throw new Error(
            "Back personalization pricing is not ready yet. Please contact the store before checkout.",
          );
        }

        const parentId = Number(item.id || 0);
        const quantity = Math.max(1, Number(item.quantity || 1));
        const alreadyPresent = originalItems.some(
          (candidate) =>
            Number(candidate?.id || 0) === feeVariantId &&
            Number(candidate?.parent_id || 0) === parentId,
        );
        if (alreadyPresent) continue;

        additions.push({
          id: feeVariantId,
          quantity,
          parent_id: parentId,
          properties: {
            "Add-on": "Back side personalization",
            "_Personalization add-on": "Back side",
          },
        });
      }

      if (!additions.length) return nativeFetch(input, init);

      payload.items.push(...additions);
      return nativeFetch(input, {
        ...init,
        body: JSON.stringify(payload),
      });
    };
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

      const config = {
        customizer,
        productForm: findProductForm(customizer),
        surcharge: Number(pricing.surcharge) || 0,
        currencyCode: String(pricing.currencyCode || ""),
        feeVariantId: String(pricing.feeVariantId || ""),
        backEnabled: Boolean(pricing.backEnabled),
        observer: null,
      };
      configs.add(config);
      installPriceNote(config);
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

  installCartInterceptor();
  initializeAll();
  document.addEventListener("shopify:section:load", (event) => {
    initializeAll(event.target || document);
  });
})();
