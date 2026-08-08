(() => {
  const CUSTOMIZER_SELECTOR = "[data-product-customizer]";
  const PROXY_URL = "/apps/personalize-preview";
  let configuredPrintSize = "";
  let interceptorInstalled = false;

  function productGid(rawId) {
    const value = String(rawId || "").trim();
    if (!value) return "";
    return value.startsWith("gid://shopify/Product/")
      ? value
      : `gid://shopify/Product/${value}`;
  }

  function formatDimension(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "";
    return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10);
  }

  async function loadPrintSize() {
    const customizer = document.querySelector(CUSTOMIZER_SELECTOR);
    const gid = productGid(customizer?.dataset?.productId);
    if (!gid) return;

    try {
      const response = await fetch(PROXY_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ action: "config", productId: gid }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) return;

      const width = formatDimension(result?.config?.printWidthCm);
      const height = formatDimension(result?.config?.printHeightCm);

      configuredPrintSize = width && height ? `${width} × ${height} cm` : "";
    } catch (error) {
      console.warn("Personalize Preview print size unavailable:", error);
    }
  }

  function installCartInterceptor() {
    if (interceptorInstalled) return;
    interceptorInstalled = true;

    const nativeFetch = window.fetch.bind(window);

    window.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input?.url || "";

      if (
        configuredPrintSize &&
        /\/cart\/add\.js(?:\?|$)/.test(url) &&
        typeof init?.body === "string"
      ) {
        try {
          const payload = JSON.parse(init.body);

          if (Array.isArray(payload?.items)) {
            payload.items = payload.items.map((item) => {
              const properties = item?.properties || {};
              const personalized =
                properties["_Personalized"] === "Yes" ||
                properties["_Design confirmed"] === "Yes";

              if (!personalized) return item;

              return {
                ...item,
                properties: {
                  ...properties,
                  "_Print size": configuredPrintSize,
                },
              };
            });

            return nativeFetch(input, {
              ...init,
              body: JSON.stringify(payload),
            });
          }
        } catch (error) {
          console.warn("Could not attach print size to cart request:", error);
        }
      }

      return nativeFetch(input, init);
    };
  }

  installCartInterceptor();
  loadPrintSize();

  document.addEventListener("shopify:section:load", () => {
    loadPrintSize();
  });
})();
