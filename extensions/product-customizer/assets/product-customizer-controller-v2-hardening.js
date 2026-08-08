(() => {
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
})();
