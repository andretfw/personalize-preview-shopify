(() => {
  const owners = new WeakMap();

  function indexCustomizers(scope = document) {
    if (!scope?.querySelectorAll) return;
    scope.querySelectorAll("[data-product-customizer]").forEach((customizer) => {
      const studio = customizer.querySelector("[data-pp-studio]");
      if (studio) owners.set(studio, customizer);
    });
  }

  indexCustomizers();

  document.addEventListener("shopify:section:load", (event) => {
    indexCustomizers(event.target || document);
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest(".pp-print-side-tabs button");
    if (!button) return;

    const studio = button.closest("[data-pp-studio]") || button.closest(".pp-studio");
    const customizer = studio ? owners.get(studio) : null;
    if (!studio || !customizer) return;

    // The controller's own tab listener runs on the button first. By the time
    // this document-level listener runs, the requested side is already active.
    const diagnostics = customizer.ppDiagnostics?.();
    if (!diagnostics?.confirmed) return;

    const key = String(button.textContent || "").trim().toLowerCase();
    if (key !== "front" && key !== "back") return;

    const selectedSide = diagnostics[key];
    if (selectedSide?.customized) return;

    // A confirmed product may still have an unused side. Re-open editing only
    // for that blank side. Dispatching the controller's existing text-input
    // path invalidates the blank side and aggregate confirmation, while keeping
    // already-saved artwork/proofs on the other side intact.
    const textInput = studio.querySelector("[data-pp-text-input]");
    if (!textInput) return;

    textInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
})();
