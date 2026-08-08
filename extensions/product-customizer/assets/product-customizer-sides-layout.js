(() => {
  function placeTabs(scope = document) {
    const studios = [];

    if (scope?.matches?.(".pp-studio")) {
      studios.push(scope);
    }

    if (scope?.querySelectorAll) {
      scope.querySelectorAll(".pp-studio").forEach((studio) => studios.push(studio));
    }

    studios.forEach((studio) => {
      const tabs = studio.querySelector(".pp-print-side-tabs");
      const preview = studio.querySelector(".pp-preview");
      const stage = studio.querySelector(".pp-product-stage");

      if (!tabs || !preview || tabs.dataset.ppPlaced === "true") return;

      tabs.dataset.ppPlaced = "true";
      tabs.style.margin = "0 0 14px";
      tabs.style.justifyContent = "center";
      tabs.style.alignSelf = "center";
      tabs.style.flex = "0 0 auto";

      if (stage?.parentNode === preview) {
        preview.insertBefore(tabs, stage);
      } else {
        preview.prepend(tabs);
      }
    });
  }

  const observer = new MutationObserver(() => placeTabs());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  placeTabs();
  document.addEventListener("shopify:section:load", (event) => {
    placeTabs(event.target || document);
  });
})();
