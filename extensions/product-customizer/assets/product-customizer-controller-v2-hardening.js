(() => {
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

  document.addEventListener(
    "load",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.matches("[data-pp-artwork]")) return;

      queueMicrotask(() => {
        target.onload = null;
      });
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;

      const savingStudio = document.querySelector(
        ".pp-studio:not([hidden]):has([data-pp-confirm]:disabled)",
      );
      if (!savingStudio) return;

      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;

      const customizers = Array.from(
        document.querySelectorAll("[data-product-customizer]"),
      );
      const customizer = customizers.find(
        (candidate) => findProductForm(candidate) === form,
      );
      if (!customizer) return;

      const fileInput = customizer.querySelector("[data-pp-file]");
      if (fileInput?.dataset.required !== "true") return;

      const diagnostics = customizer.ppDiagnostics?.();
      const hasArtwork = Boolean(
        diagnostics?.front?.artwork || diagnostics?.back?.artwork,
      );
      if (hasArtwork) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const error = customizer.querySelector("[data-pp-error]");
      if (error) {
        error.textContent =
          "Please upload and confirm your artwork before adding this product to the cart.";
        error.hidden = false;
      }

      customizer.querySelector("[data-pp-open-studio]")?.click();
    },
    true,
  );
})();
