(() => {
  let loadingPromise = null;
  let loaded = false;

  function simplifyLaunchers(scope = document) {
    scope.querySelectorAll("[data-product-customizer]").forEach((customizer) => {
      const launcher = customizer.querySelector(".pp-launcher");
      const copy = customizer.querySelector(".pp-launcher-copy");
      const button = customizer.querySelector("[data-pp-open-studio]");

      copy?.remove();

      if (launcher) {
        launcher.style.padding = "0";
        launcher.style.border = "0";
        launcher.style.borderRadius = "0";
        launcher.style.background = "transparent";
        launcher.style.gap = "0";
      }

      if (button) {
        button.style.width = "100%";
        button.style.minHeight = "52px";
        button.style.marginTop = "0";
        button.style.borderRadius = "12px";
        button.style.fontSize = "14px";
      }
    });
  }

  simplifyLaunchers();

  document.addEventListener("shopify:section:load", (event) => {
    simplifyLaunchers(event.target || document);
  });

  function getAssetScriptUrl(filename) {
    const scripts = Array.from(
      document.querySelectorAll("script[src]"),
    );

    const loaderScript = scripts.find((script) =>
      script.src.includes("product-customizer.js"),
    );

    if (!loaderScript) {
      throw new Error(
        "Personalize Preview loader URL could not be found.",
      );
    }

    const url = new URL(loaderScript.src);

    url.pathname = url.pathname.replace(
      /product-customizer\.js$/,
      filename,
    );

    return url.href;
  }

  async function loadCustomizer() {
    if (loaded) {
      return;
    }

    if (!loadingPromise) {
      loadingPromise = import(
        getAssetScriptUrl("product-customizer-core.js")
      )
        .then(() =>
          import(
            getAssetScriptUrl("product-customizer-enhancements.js")
          ),
        )
        .then(() => {
          loaded = true;
        })
        .catch((error) => {
          loadingPromise = null;

          console.error(
            "Personalize Preview failed to load:",
            error,
          );

          throw error;
        });
    }

    await loadingPromise;
  }

  document.addEventListener(
    "click",
    async (event) => {
      const button = event.target.closest(
        "[data-pp-open-studio]",
      );

      if (!button || loaded) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      try {
        button.disabled = true;

        await loadCustomizer();

        button.disabled = false;

        button.click();
      } catch (error) {
        button.disabled = false;

        console.error(
          "Could not open product customizer:",
          error,
        );
      }
    },
    true,
  );
})();