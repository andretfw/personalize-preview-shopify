(() => {
  if (document.querySelector("style[data-pp-controller-v2-styles]")) return;

  const style = document.createElement("style");
  style.dataset.ppControllerV2Styles = "true";
  style.textContent = `
    .pp-quality-guard {
      display: grid;
      gap: 3px;
      margin-top: 12px;
      padding: 11px 12px;
      border: 1px solid rgba(17,17,17,.12);
      border-radius: 10px;
      background: #f7f7f5;
      color: #303633;
      line-height: 1.35;
    }
    .pp-quality-guard[hidden] { display: none !important; }
    .pp-quality-guard strong { font-size: 12px; font-weight: 780; }
    .pp-quality-guard span { font-size: 11px; color: rgba(17,17,17,.62); }
    .pp-quality-guard[data-quality="great"] {
      border-color: rgba(0,110,82,.25);
      background: #f0faf5;
    }
    .pp-quality-guard[data-quality="great"] strong { color: #006e52; }
    .pp-quality-guard[data-quality="okay"] {
      border-color: rgba(157,105,0,.28);
      background: #fff9e9;
    }
    .pp-quality-guard[data-quality="okay"] strong { color: #7a5200; }
    .pp-quality-guard[data-quality="low"] {
      border-color: rgba(183,45,35,.24);
      background: #fff3f1;
    }
    .pp-quality-guard[data-quality="low"] strong { color: #9d2118; }
    .pp-proof-status {
      margin: 8px 0 0;
      color: rgba(17,17,17,.62);
      font-size: 11px;
      line-height: 1.4;
    }
    .pp-proof-status[data-state="saved"] {
      color: #006e52;
      font-weight: 700;
    }
    .pp-proof-status[data-state="error"] {
      color: #9d2118;
      font-weight: 700;
    }
    .pp-proof-status[hidden] { display: none !important; }
    .pp-print-side-tabs button:disabled { cursor: wait; opacity: .6; }
    .pp-studio:has([data-pp-confirm]:disabled) .pp-control-section,
    .pp-studio:has([data-pp-confirm]:disabled) .pp-print-side-tabs,
    .pp-studio:has([data-pp-confirm]:disabled) .pp-artwork,
    .pp-studio:has([data-pp-confirm]:disabled) .pp-text-layer,
    .pp-studio:has([data-pp-confirm]:disabled) [data-pp-close-studio] {
      pointer-events: none;
    }
    .pp-studio:has([data-pp-confirm]:disabled) .pp-control-section,
    .pp-studio:has([data-pp-confirm]:disabled) .pp-print-side-tabs,
    .pp-studio:has([data-pp-confirm]:disabled) .pp-close-studio-button {
      opacity: .58;
    }
  `;
  document.head.appendChild(style);
})();
