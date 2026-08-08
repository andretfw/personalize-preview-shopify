(() => {
  let loadingPromise = null;
  let loaded = false;
  let placementFrame = null;

  function getProductSection(customizer) {
    return (
      customizer.closest('[id^="shopify-section-"]') ||
      customizer.closest(".shopify-section") ||
      document
    );
  }

  function findProductForm(customizer) {
    const section = getProductSection(customizer);
    const forms = Array.from(
      section.querySelectorAll('form[action*="/cart/add"]'),
    );

    return (
      forms.find((form) => form.querySelector('[name="id"]')) ||
      forms[0] ||
      null
    );
  }

  function findPurchaseInsertion(customizer) {
    const form = findProductForm(customizer);

    if (!form) {
      return null;
    }

    const buttonGroup = form.querySelector(
      ".product-form__buttons, [data-product-form-buttons], .product-form__actions, .product__buttons",
    );

    if (buttonGroup) {
      return {
        container: buttonGroup,
        before: buttonGroup.firstElementChild,
      };
    }

    const addButton = form.querySelector(
      '[name="add"], button[type="submit"], input[type="submit"]',
    );

    if (addButton?.parentElement) {
      return {
        container: addButton.parentElement,
        before: addButton,
      };
    }

    return null;
  }

  function findExistingProxy(customizerId) {
    return Array.from(
      document.querySelectorAll("[data-pp-launcher-proxy-for]"),
    ).find(
      (element) =>
        element.dataset.ppLauncherProxyFor === customizerId,
    );
  }

  function positionLauncher(customizer) {
    const originalLauncher = customizer.querySelector(".pp-launcher");
    const originalButton = originalLauncher?.querySelector(
      "[data-pp-open-studio]",
    );

    if (!originalLauncher || !originalButton || !customizer.id) {
      return;
    }

    const insertion = findPurchaseInsertion(customizer);
    let proxy = findExistingProxy(customizer.id);

    if (!insertion) {
      proxy?.remove();
      originalLauncher.hidden = false;
      customizer.style.removeProperty("margin");
      return;
    }

    if (!proxy) {
      proxy = originalLauncher.cloneNode(true);
      proxy.dataset.ppLauncherProxyFor = customizer.id;
      proxy.classList.add("pp-purchase-launcher");
      proxy.hidden = false;
      proxy.style.width = "100%";
      proxy.style.margin = "0 0 10px";
      proxy.style.boxSizing = "border-box";

      const proxyButton = proxy.querySelector(
        "[data-pp-open-studio]",
      );

      if (!proxyButton) {
        return;
      }

      proxyButton.removeAttribute("data-pp-open-studio");
      proxyButton.setAttribute("data-pp-open-studio-proxy", "");
      proxyButton.dataset.ppCustomizerTarget = customizer.id;
      proxyButton.style.boxSizing = "border-box";
    }

    if (
      proxy.parentNode !== insertion.container ||
      proxy.nextSibling !== insertion.before
    ) {
      insertion.container.insertBefore(proxy, insertion.before);
    }

    originalLauncher.hidden = true;
    customizer.style.margin = "0";
  }

  function positionLaunchers() {
    document
      .querySelectorAll("[data-product-customizer]")
      .forEach(positionLauncher);
  }

  function scheduleLauncherPlacement() {
    if (placementFrame !== null) {
      return;
    }

    placementFrame = window.requestAnimationFrame(() => {
      placementFrame = null;
      positionLaunchers();
    });
  }

  positionLaunchers();

  document.addEventListener(
    "shopify:section:load",
    scheduleLauncherPlacement,
  );

  const placementObserver = new MutationObserver(
    scheduleLauncherPlacement,
  );

  placementObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
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
      const proxyButton = event.target.closest(
        "[data-pp-open-studio-proxy]",
      );

      if (proxyButton) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const customizer = document.getElementById(
          proxyButton.dataset.ppCustomizerTarget || "",
        );
        const originalButton = customizer?.querySelector(
          "[data-pp-open-studio]",
        );

        if (!originalButton) {
          return;
        }

        try {
          proxyButton.disabled = true;
          await loadCustomizer();
          proxyButton.disabled = false;
          originalButton.click();
        } catch (error) {
          proxyButton.disabled = false;

          console.error(
            "Could not open product customizer:",
            error,
          );
        }

        return;
      }

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