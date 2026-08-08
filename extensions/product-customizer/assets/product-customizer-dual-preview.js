(() => {
  const initialized = new WeakSet();

  const normalizeImageUrl = (raw) => {
    try {
      const url = new URL(String(raw || ""), window.location.href);
      return `${url.origin}${url.pathname}`;
    } catch {
      return String(raw || "").split("?")[0];
    }
  };

  const percentage = (value, total) => {
    if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
    return Math.max(0, Math.min(100, (value / total) * 100));
  };

  const activeSideKey = (studio) => {
    const pressed = studio.querySelector(
      '.pp-print-side-tabs button[aria-pressed="true"]',
    );
    return pressed?.textContent?.trim().toLowerCase() === "back" ? "back" : "front";
  };

  const cleanArtworkClone = (source) => {
    if (!(source instanceof HTMLImageElement) || source.hidden || !source.src) return null;
    const clone = source.cloneNode(true);
    clone.removeAttribute("data-pp-artwork");
    clone.removeAttribute("id");
    clone.removeAttribute("draggable");
    clone.removeAttribute("hidden");
    clone.setAttribute("aria-hidden", "true");
    clone.style.pointerEvents = "none";
    clone.style.cursor = "default";
    return clone;
  };

  const cleanTextClone = (source) => {
    if (!(source instanceof HTMLElement) || source.hidden || !source.textContent?.trim()) {
      return null;
    }
    const clone = source.cloneNode(true);
    clone.removeAttribute("data-pp-text-layer");
    clone.removeAttribute("id");
    clone.removeAttribute("role");
    clone.removeAttribute("aria-label");
    clone.removeAttribute("hidden");
    clone.setAttribute("aria-hidden", "true");
    clone.style.pointerEvents = "none";
    clone.style.cursor = "default";
    return clone;
  };

  function initialize(customizer) {
    if (initialized.has(customizer)) return;
    initialized.add(customizer);

    const studio = customizer.querySelector("[data-pp-studio]");
    const stage = customizer.querySelector(".pp-product-stage");
    const productImage = customizer.querySelector(".pp-product-image");
    const printArea = customizer.querySelector("[data-pp-print-area]");
    const artwork = customizer.querySelector("[data-pp-artwork]");
    const textLayer = customizer.querySelector("[data-pp-text-layer]");

    if (!studio || !stage || !productImage || !printArea || !artwork || !textLayer) {
      return;
    }

    const snapshots = { front: null, back: null };

    const passive = document.createElement("div");
    passive.className = "pp-passive-side-preview";
    passive.hidden = true;
    passive.setAttribute("aria-hidden", "true");
    Object.assign(passive.style, {
      position: "absolute",
      overflow: "hidden",
      borderRadius: "6px",
      pointerEvents: "none",
      zIndex: "2",
    });

    stage.insertBefore(passive, printArea);
    printArea.style.zIndex = "3";

    const capture = (key = activeSideKey(studio)) => {
      const stageRect = stage.getBoundingClientRect();
      const areaRect = printArea.getBoundingClientRect();
      if (!stageRect.width || !stageRect.height || !areaRect.width || !areaRect.height) {
        return;
      }

      const artworkClone = cleanArtworkClone(artwork);
      const textClone = cleanTextClone(textLayer);

      snapshots[key] = artworkClone || textClone
        ? {
            baseImage: normalizeImageUrl(productImage.currentSrc || productImage.src),
            left: percentage(areaRect.left - stageRect.left, stageRect.width),
            top: percentage(areaRect.top - stageRect.top, stageRect.height),
            width: percentage(areaRect.width, stageRect.width),
            height: percentage(areaRect.height, stageRect.height),
            artwork: artworkClone,
            text: textClone,
          }
        : null;
    };

    const renderInactive = () => {
      const active = activeSideKey(studio);
      const inactive = active === "front" ? "back" : "front";
      const snapshot = snapshots[inactive];

      passive.replaceChildren();
      passive.hidden = true;

      if (!snapshot) return;

      const currentBase = normalizeImageUrl(productImage.currentSrc || productImage.src);
      if (snapshot.baseImage && currentBase && snapshot.baseImage !== currentBase) {
        return;
      }

      passive.style.left = `${snapshot.left}%`;
      passive.style.top = `${snapshot.top}%`;
      passive.style.width = `${snapshot.width}%`;
      passive.style.height = `${snapshot.height}%`;

      if (snapshot.artwork) passive.appendChild(snapshot.artwork.cloneNode(true));
      if (snapshot.text) passive.appendChild(snapshot.text.cloneNode(true));

      passive.hidden = passive.childElementCount === 0;
    };

    const renderAfterSwitch = () => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(renderInactive);
      });
    };

    studio.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest(".pp-print-side-tabs button");
        if (!button || !studio.contains(button)) return;

        const current = activeSideKey(studio);
        const next = button.textContent?.trim().toLowerCase() === "back" ? "back" : "front";
        if (current === next) return;

        capture(current);
        renderAfterSwitch();
      },
      true,
    );

    const observer = new MutationObserver((mutations) => {
      if (
        mutations.some(
          (mutation) =>
            mutation.type === "attributes" &&
            mutation.attributeName === "aria-pressed",
        )
      ) {
        renderAfterSwitch();
      }
    });
    observer.observe(studio, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed"],
    });

    window.addEventListener("resize", renderInactive);
  }

  const initializeAll = (scope = document) => {
    scope
      .querySelectorAll?.("[data-product-customizer]")
      .forEach(initialize);
  };

  initializeAll();
  document.addEventListener("shopify:section:load", (event) => {
    initializeAll(event.target || document);
  });
})();
