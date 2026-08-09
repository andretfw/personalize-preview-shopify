(() => {
  let loadingPromise = null;
  let loaded = false;

  function getAssetScriptUrl(filename) {
    const scripts = Array.from(document.querySelectorAll("script[src]"));
    const loaderScript = scripts.find((script) =>
      script.src.includes("product-customizer.js"),
    );

    if (!loaderScript) {
      throw new Error("Personalize Preview loader URL could not be found.");
    }

    const url = new URL(loaderScript.src);
    url.pathname = url.pathname.replace(/product-customizer\.js$/, filename);
    return url.href;
  }

  async function loadCustomizer() {
    if (loaded) return;

    if (!loadingPromise) {
      loadingPromise = import(
        getAssetScriptUrl("product-customizer-controller-v2-styles.js")
      )
        .then(() =>
          import(getAssetScriptUrl("product-customizer-controller-v2-hardening.js")),
        )
        .then(() =>
          import(getAssetScriptUrl("product-customizer-controller-v2.js")),
        )
        .then(() =>
          import(getAssetScriptUrl("product-customizer-back-surcharge.js")),
        )
        .then(() =>
          import(getAssetScriptUrl("product-customizer-empty-side-unlock.js")),
        )
        .then(() => {
          loaded = true;
        })
        .catch((error) => {
          loadingPromise = null;
          console.error("Personalize Preview failed to load:", error);
          throw error;
        });
    }

    await loadingPromise;
  }

  document.addEventListener(
    "click",
    async (event) => {
      const button = event.target.closest("[data-pp-open-studio]");
      if (!button || loaded) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      try {
        button.disabled = true;
        await loadCustomizer();
        button.disabled = false;
        button.click();
      } catch (error) {
        button.disabled = false;
        console.error("Could not open product customizer:", error);
      }
    },
    true,
  );
})();
