const STYLE_ID = "anima-set-studio-styles";

const CSS = `
/* Keep Comfyui-Anima-Tools popups cleanly above SetStudio modal */
.anima-sel-overlay,
.alm-overlay,
.alm-selector-overlay {
    z-index: 10500 !important;
}

.ass-launch-btn {
    position: fixed;
    left: 16px;
    bottom: 18px;
    z-index: 8900;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 15px;
    border: 1px solid color-mix(in srgb, var(--primary-background, #31b9f4) 55%, transparent);
    border-radius: 999px;
    background: linear-gradient(135deg, color-mix(in srgb, var(--primary-background, #31b9f4) 24%, var(--comfy-menu-bg, #1b1d22)), var(--comfy-menu-bg, #1b1d22));
    color: var(--fg-color, #eef1f5);
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.42);
    transition: transform 0.14s ease, box-shadow 0.14s ease, border-color 0.14s ease;
}
.ass-launch-btn:hover {
    transform: translateY(-1px);
    border-color: var(--primary-background, #31b9f4);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.52);
}

.ass-overlay {
    --ass-bg: var(--comfy-menu-bg, #181a1f);
    --ass-surface: var(--comfy-input-bg, #22252c);
    --ass-card: color-mix(in srgb, var(--ass-surface) 88%, var(--ass-bg));
    --ass-text: var(--input-text, var(--fg-color, #e8ecf2));
    --ass-muted: color-mix(in srgb, var(--ass-text) 56%, transparent);
    --ass-line: color-mix(in srgb, var(--ass-text) 13%, transparent);
    --ass-hover: color-mix(in srgb, var(--ass-text) 8%, transparent);
    --ass-accent: var(--primary-background, var(--p-primary-color, #31b9f4));
    --ass-danger: #f87171;
    --ass-success: #4ade80;
    --ass-warn: #fbbf24;

    position: fixed;
    inset: 0;
    z-index: 9000;
    display: none;
    place-items: center;
    padding: 18px;
    background: rgba(8, 10, 14, 0.72);
    backdrop-filter: blur(5px);
    color: var(--ass-text);
    font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
}
.ass-overlay.is-open { display: grid; }
.ass-overlay *, .ass-submodal-overlay *, .ass-random-menu * { box-sizing: border-box; }

.ass-window {
    display: flex;
    flex-direction: column;
    width: min(1480px, 96vw);
    height: min(920px, 93vh);
    border: 1px solid var(--ass-line);
    border-radius: 14px;
    background: var(--ass-bg);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
    overflow: hidden;
}

.ass-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--ass-line);
    background: color-mix(in srgb, var(--ass-surface) 55%, var(--ass-bg));
}
.ass-header-left, .ass-header-right { display: flex; align-items: center; gap: 12px; }
.ass-brand { font-size: 15px; font-weight: 800; letter-spacing: 0.02em; }

.ass-tabs { display: flex; gap: 6px; }
.ass-tab {
    padding: 6px 13px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--ass-muted);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.ass-tab:hover { background: var(--ass-hover); color: var(--ass-text); }
.ass-tab.is-active {
    background: color-mix(in srgb, var(--ass-accent) 16%, transparent);
    border-color: color-mix(in srgb, var(--ass-accent) 55%, transparent);
    color: var(--ass-text);
}

.ass-status-pill {
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
}
.ass-status-pill.is-ok { background: rgba(74, 222, 128, 0.14); color: #86efac; }
.ass-status-pill.is-warn { background: rgba(251, 191, 36, 0.15); color: #fde68a; }

.ass-icon-btn {
    width: 30px;
    height: 30px;
    border: 1px solid var(--ass-line);
    border-radius: 8px;
    background: transparent;
    color: var(--ass-text);
    font-size: 14px;
    cursor: pointer;
}
.ass-icon-btn:hover { background: var(--ass-hover); }

.ass-main { flex: 1; min-height: 0; overflow: hidden; }
.ass-loading { display: grid; place-items: center; height: 100%; color: var(--ass-muted); font-size: 14px; }

.ass-collection-layout {
    display: grid;
    grid-template-columns: minmax(380px, 460px) 1fr;
    height: 100%;
}
.ass-sets-layout {
    display: grid;
    grid-template-columns: 310px 1fr;
    height: 100%;
}
@media (max-width: 980px) {
    .ass-collection-layout, .ass-sets-layout { grid-template-columns: 1fr; overflow-y: auto; }
}

.ass-pane {
    min-height: 0;
    overflow-y: auto;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.ass-pane-common, .ass-pane-setlist {
    border-right: 1px solid var(--ass-line);
    background: color-mix(in srgb, var(--ass-bg) 96%, #000);
}

.ass-section-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--ass-line);
}
.ass-section-block:last-child { border-bottom: 0; padding-bottom: 0; }
.ass-section-title { font-size: 13px; font-weight: 700; color: var(--ass-text); }
.ass-section-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ass-sub-heading { font-size: 11px; font-weight: 700; color: var(--ass-muted); margin-bottom: 6px; }

.ass-pane-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
}
.ass-toolbar-btns { display: flex; align-items: center; gap: 6px; }

/* Inputs & Buttons */
.ass-field { display: flex; flex-direction: column; gap: 4px; }
.ass-grow { flex: 1; }
.ass-label { font-size: 11px; font-weight: 600; color: var(--ass-muted); }
.ass-hint { font-size: 12px; color: var(--ass-muted); line-height: 1.5; margin: 0; }
.ass-hint-inline { font-size: 10px; font-weight: 400; color: var(--ass-muted); }
.ass-muted { color: var(--ass-muted); font-size: 12px; }

.ass-input, .ass-select, .ass-textarea {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid var(--ass-line);
    border-radius: 7px;
    background: var(--ass-surface);
    color: var(--ass-text);
    font-family: inherit;
    font-size: 12.5px;
    outline: none;
}
.ass-input:focus, .ass-select:focus, .ass-textarea:focus {
    border-color: color-mix(in srgb, var(--ass-accent) 70%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ass-accent) 18%, transparent);
}
.ass-textarea { resize: vertical; line-height: 1.45; }
.ass-name-input { font-size: 14px; font-weight: 700; }
.ass-num-sm { width: 90px; }
.ass-inline-row { display: flex; align-items: center; gap: 8px; }

.ass-btn-primary, .ass-btn-primary-sm, .ass-btn-secondary, .ass-btn-xs, .ass-btn-run, .ass-chip-btn {
    border: 1px solid var(--ass-line);
    border-radius: 7px;
    font-family: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.14s, border-color 0.14s, opacity 0.14s;
}
.ass-btn-primary {
    padding: 8px 16px;
    background: var(--ass-accent);
    border-color: transparent;
    color: #081018;
    font-size: 13px;
}
.ass-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
.ass-btn-primary-sm {
    padding: 6px 12px;
    background: color-mix(in srgb, var(--ass-accent) 20%, transparent);
    border-color: color-mix(in srgb, var(--ass-accent) 55%, transparent);
    color: var(--ass-text);
    font-size: 12px;
}
.ass-btn-primary-sm:hover { background: color-mix(in srgb, var(--ass-accent) 30%, transparent); }
.ass-btn-secondary {
    padding: 7px 14px;
    background: var(--ass-surface);
    color: var(--ass-text);
    font-size: 12.5px;
}
.ass-btn-secondary:hover { background: var(--ass-hover); }
.ass-btn-xs {
    padding: 4px 8px;
    background: transparent;
    color: var(--ass-text);
    font-size: 11px;
}
.ass-btn-xs:hover:not(:disabled) { background: var(--ass-hover); }
.ass-btn-xs:disabled, .ass-btn-primary:disabled, .ass-btn-run:disabled { opacity: 0.4; cursor: not-allowed; }
.ass-btn-danger:hover:not(:disabled) { border-color: rgba(248, 113, 113, 0.6); color: var(--ass-danger); background: rgba(248, 113, 113, 0.12); }

.ass-btn-run {
    padding: 10px 22px;
    background: linear-gradient(135deg, var(--ass-accent), color-mix(in srgb, var(--ass-accent) 70%, #6366f1));
    border: 0;
    color: #081018;
    font-size: 14px;
    font-weight: 800;
    border-radius: 9px;
}
.ass-btn-run:hover:not(:disabled) { filter: brightness(1.08); }

/* Exclude category chips */
.ass-exclude-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ass-exclude-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border: 1px solid var(--ass-line);
    border-radius: 999px;
    background: var(--ass-surface);
    color: var(--ass-text);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
}
.ass-exclude-chip:hover { border-color: color-mix(in srgb, var(--ass-accent) 55%, transparent); }
.ass-exclude-chip.is-excluded {
    border-color: rgba(248, 113, 113, 0.65);
    background: rgba(248, 113, 113, 0.16);
    color: #fecaca;
    text-decoration: line-through;
}

/* Settings */
.ass-settings-wrap { display: flex; flex-direction: column; gap: 10px; }
.ass-basic-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
.ass-preset-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 3px; }
.ass-chip-btn {
    padding: 3px 8px;
    background: transparent;
    color: var(--ass-muted);
    font-size: 11px;
}
.ass-chip-btn:hover { color: var(--ass-text); background: var(--ass-hover); border-color: color-mix(in srgb, var(--ass-accent) 45%, transparent); }
.ass-details-box {
    border: 1px solid var(--ass-line);
    border-radius: 8px;
    background: color-mix(in srgb, var(--ass-surface) 60%, transparent);
    padding: 8px 10px;
}
.ass-details-box summary {
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    color: var(--ass-text);
    user-select: none;
}
.ass-details-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 10px;
    margin-top: 10px;
}

/* Anima Prompt Plus compatible boxes */
.ass-prompt-boxes { display: flex; flex-direction: column; gap: 6px; }
.ass-pbox-list { display: flex; flex-direction: column; gap: 6px; }
.ass-hidden-cat-note {
    padding: 5px 9px;
    border-radius: 6px;
    background: rgba(251, 191, 36, 0.12);
    border: 1px solid rgba(251, 191, 36, 0.28);
    color: #fde68a;
    font-size: 11px;
}
.ass-pbox {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--ass-line);
    border-radius: 8px;
    background: var(--ass-surface);
    transition: border-color 0.14s, opacity 0.14s;
}
.ass-pbox:focus-within {
    border-color: color-mix(in srgb, var(--ass-accent) 65%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ass-accent) 16%, transparent);
}
.ass-pbox.is-disabled { opacity: 0.52; filter: grayscale(1); }
.ass-pbox.is-dragging { opacity: 0.4; }
.ass-pbox.is-drop-over { border-top: 2px solid var(--ass-accent); }
.ass-pbox-head {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 29px;
    padding: 0 5px 0 6px;
}
.ass-pbox-grip {
    display: grid;
    place-items: center;
    width: 16px;
    height: 20px;
    color: var(--ass-muted);
    cursor: grab;
}
.ass-pbox-grip svg, .ass-pbox-head svg, .ass-pbox-add svg { width: 14px; height: 14px; flex: none; }
.ass-pbox-title {
    max-width: 48%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 6px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 700;
    cursor: text;
}
.ass-pbox-title.is-placeholder { color: var(--ass-muted); font-weight: 500; }
.ass-pbox-title:hover { background: var(--ass-hover); }
.ass-pbox-title-input {
    width: 45%;
    height: 22px;
    padding: 0 6px;
    border: 1px solid var(--ass-accent);
    border-radius: 5px;
    background: transparent;
    color: var(--ass-text);
    font-size: 12px;
    font-weight: 700;
    outline: none;
}
.ass-pbox-spacer { flex: 1; }
.ass-pbox-head button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 22px;
    padding: 0 5px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: color-mix(in srgb, var(--ass-text) 74%, transparent);
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
}
.ass-pbox-head button:hover:not(:disabled),
.ass-pbox-head button.is-open {
    border-color: color-mix(in srgb, var(--ass-accent) 65%, transparent);
    background: color-mix(in srgb, var(--ass-accent) 14%, transparent);
    color: var(--ass-text);
}
.ass-pbox-head button:disabled { opacity: 0.4; cursor: not-allowed; }
.ass-pbox-head button.is-on svg { color: var(--ass-accent); }
.ass-pbox-head button[aria-pressed="true"] { border-color: var(--ass-line); background: var(--ass-hover); }
.ass-pbox-head .ass-pbox-remove:hover { border-color: rgba(248, 113, 113, 0.6); color: var(--ass-danger); background: rgba(248, 113, 113, 0.12); }
.ass-pbox-head .ass-pbox-select { padding: 0 6px 0 0; overflow: hidden; }
.ass-pbox-select-avatar {
    width: 18px;
    height: 100%;
    flex: none;
    border-right: 1px solid var(--ass-line);
    background-size: cover;
    background-position: center;
    background-color: color-mix(in srgb, var(--ass-accent) 22%, transparent);
}
.ass-pbox-head button b {
    min-width: 14px;
    height: 14px;
    padding: 0 4px;
    border-radius: 7px;
    background: var(--ass-accent);
    color: #081018;
    font-size: 9px;
    line-height: 14px;
}
.ass-pbox-textarea {
    width: 100%;
    min-height: 46px;
    padding: 2px 10px 8px;
    border: 0;
    background: transparent;
    color: var(--ass-text);
    font-family: inherit;
    font-size: 12.5px;
    line-height: 1.5;
    resize: none;
    outline: none;
}
.ass-pbox-add {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    height: 34px;
    border: 1px dashed color-mix(in srgb, var(--ass-text) 24%, transparent);
    border-radius: 8px;
    background: transparent;
    color: var(--ass-muted);
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
}
.ass-pbox-add:hover {
    border-color: color-mix(in srgb, var(--ass-accent) 70%, transparent);
    color: var(--ass-text);
    background: color-mix(in srgb, var(--ass-accent) 8%, transparent);
}
.ass-sep-row { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.ass-sep-row label { font-size: 11px; color: var(--ass-muted); }
.ass-sep-input { width: 80px; padding: 4px 8px; }

/* Random dropdown menu */
.ass-random-menu {
    position: fixed;
    z-index: 9500;
    min-width: 165px;
    padding: 5px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 9px;
    background: var(--comfy-menu-bg, #1f2128);
    color: var(--fg-color, #eef1f5);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.48);
}
.ass-random-menu-title { padding: 4px 8px; font-size: 10px; font-weight: 700; opacity: 0.65; }
.ass-random-menu button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 27px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font-size: 12px;
    cursor: pointer;
}
.ass-random-menu button:hover { background: rgba(255, 255, 255, 0.08); }
.ass-random-menu button svg { width: 14px; height: 14px; color: var(--primary-background, #31b9f4); opacity: 0; }
.ass-random-menu button.is-checked svg { opacity: 1; }

/* Anima Multi LoRA Loader compatible panel */
.ass-lora-panel { display: flex; flex-direction: column; gap: 6px; }
.ass-lora-list { display: flex; flex-direction: column; gap: 6px; }
.ass-lora-empty {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border: 1px dashed color-mix(in srgb, var(--ass-text) 24%, transparent);
    border-radius: 9px;
    background: transparent;
    color: var(--ass-text);
    text-align: left;
    cursor: pointer;
}
.ass-lora-empty:hover {
    border-color: color-mix(in srgb, var(--ass-accent) 70%, transparent);
    background: color-mix(in srgb, var(--ass-accent) 8%, transparent);
}
.ass-lora-empty-icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--ass-accent) 18%, transparent);
    color: var(--ass-accent);
}
.ass-lora-empty-icon svg { width: 16px; height: 16px; }
.ass-lora-empty-text { display: flex; flex-direction: column; gap: 2px; }
.ass-lora-empty-text strong { font-size: 12px; }
.ass-lora-empty-text span { font-size: 11px; color: var(--ass-muted); }

.ass-lora-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 8px;
    border: 1px solid var(--ass-line);
    border-radius: 8px;
    background: var(--ass-surface);
}
.ass-lora-row.is-disabled { opacity: 0.5; }
.ass-lora-thumb {
    position: relative;
    width: 40px;
    height: 44px;
    flex: none;
    border-radius: 6px;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--ass-text) 7%, transparent);
    color: var(--ass-muted);
}
.ass-lora-thumb svg { width: 18px; height: 18px; }
.ass-lora-thumb img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.2s;
}
.ass-lora-thumb.has-image img { opacity: 1; }
.ass-lora-thumb.has-image svg { opacity: 0; }

.ass-lora-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.ass-lora-header { display: flex; align-items: center; gap: 6px; }
.ass-lora-toggle {
    position: relative;
    width: 28px;
    height: 16px;
    flex: none;
    border: 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ass-text) 24%, transparent);
    cursor: pointer;
    transition: background 0.15s;
}
.ass-lora-toggle::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
}
.ass-lora-toggle[aria-checked="true"] { background: var(--ass-accent); }
.ass-lora-toggle[aria-checked="true"]::after { transform: translateX(12px); }

.ass-lora-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--ass-text);
    font-size: 12px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
}
.ass-lora-name:hover { color: var(--ass-accent); }
.ass-lora-icon {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ass-muted);
    cursor: pointer;
}
.ass-lora-icon svg { width: 13px; height: 13px; }
.ass-lora-icon:hover { background: var(--ass-hover); color: var(--ass-text); }
.ass-lora-icon.is-empty { opacity: 0.35; }
.ass-lora-remove:hover { color: var(--ass-danger); }

.ass-lora-strength { display: flex; align-items: center; gap: 8px; }
.ass-lora-strength input[type="range"] {
    flex: 1;
    height: 4px;
    accent-color: var(--ass-accent);
    cursor: pointer;
}
.ass-lora-strength input[type="number"] {
    width: 58px;
    padding: 2px 5px;
    border: 1px solid var(--ass-line);
    border-radius: 5px;
    background: transparent;
    color: var(--ass-text);
    font-size: 11px;
    text-align: right;
}

.ass-lora-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.ass-lora-summary { font-size: 11px; color: var(--ass-muted); }
.ass-lora-open-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border: 1px solid color-mix(in srgb, var(--ass-accent) 45%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, var(--ass-accent) 12%, transparent);
    color: var(--ass-text);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
}
.ass-lora-open-btn svg { width: 12px; height: 12px; }
.ass-lora-open-btn:hover { background: color-mix(in srgb, var(--ass-accent) 22%, transparent); }

/* Selected set cards */
.ass-selected-list { display: flex; flex-direction: column; gap: 12px; }
.ass-set-card {
    border: 1px solid var(--ass-line);
    border-radius: 10px;
    background: var(--ass-card);
    overflow: hidden;
}
.ass-set-card.is-muted { opacity: 0.55; }
.ass-set-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: color-mix(in srgb, var(--ass-surface) 75%, transparent);
    border-bottom: 1px solid var(--ass-line);
    flex-wrap: wrap;
}
.ass-set-card.is-collapsed .ass-set-card-header { border-bottom: 0; }
.ass-set-order { font-size: 11px; font-weight: 800; color: var(--ass-accent); }
.ass-set-card-title-btn {
    flex: 1;
    min-width: 140px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    color: var(--ass-text);
    font-size: 13px;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
}
.ass-badge-soft {
    padding: 1px 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ass-text) 10%, transparent);
    color: var(--ass-muted);
    font-size: 10.5px;
    font-weight: 600;
}
.ass-set-card-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.ass-count-override { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--ass-muted); margin-right: 4px; }
.ass-count-input { width: 52px; padding: 3px 5px; font-size: 11px; text-align: center; }

.ass-set-card-body {
    display: grid;
    grid-template-columns: minmax(240px, 310px) 1fr;
    gap: 12px;
    padding: 10px 12px;
}
@media (max-width: 1120px) {
    .ass-set-card-body { grid-template-columns: 1fr; }
}

/* Sets manager tab */
.ass-new-set-row { display: flex; gap: 6px; }
.ass-saved-sets-list { display: flex; flex-direction: column; gap: 7px; }
.ass-saved-item {
    border: 1px solid var(--ass-line);
    border-radius: 8px;
    background: var(--ass-surface);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.ass-saved-item.is-selected {
    border-color: var(--ass-accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ass-accent) 40%, transparent);
}
.ass-saved-item-main { cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
.ass-saved-item-title { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 13px; }
.ass-saved-item-cats, .ass-picker-cats { display: flex; flex-wrap: wrap; gap: 4px; }
.ass-saved-item-cats span, .ass-picker-cats span {
    padding: 1px 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--ass-text) 8%, transparent);
    font-size: 10.5px;
    color: var(--ass-muted);
}
.ass-saved-item-actions { display: flex; gap: 5px; justify-content: flex-end; }

.ass-editor-top { display: flex; align-items: flex-end; gap: 12px; }
.ass-editor-grid {
    display: grid;
    grid-template-columns: minmax(280px, 360px) 1fr;
    gap: 16px;
}
@media (max-width: 980px) {
    .ass-editor-grid { grid-template-columns: 1fr; }
}

/* Empty states & Submodals */
.ass-empty-stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 10px;
    padding: 46px 20px;
    border: 1px dashed var(--ass-line);
    border-radius: 12px;
}
.ass-empty-stage-icon { font-size: 32px; }
.ass-empty-stage-actions { display: flex; gap: 8px; margin-top: 6px; }
.ass-empty-inline { padding: 14px; text-align: center; font-size: 12px; color: var(--ass-muted); }

.ass-submodal-overlay {
    position: fixed;
    inset: 0;
    z-index: 9400;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(6, 8, 12, 0.72);
    color: var(--fg-color, #e8ecf2);
    font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", sans-serif;
}
.ass-submodal {
    display: flex;
    flex-direction: column;
    width: min(560px, 92vw);
    max-height: 82vh;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 12px;
    background: var(--comfy-menu-bg, #1c1e24);
    box-shadow: 0 20px 56px rgba(0, 0, 0, 0.55);
    overflow: hidden;
}
.ass-submodal-lg { width: min(760px, 92vw); }
.ass-submodal-header, .ass-submodal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.ass-submodal-footer { border-bottom: 0; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.ass-submodal-header h3 { margin: 0; font-size: 14px; }
.ass-submodal-body { padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }

.ass-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 8px;
}
.ass-picker-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 9px;
    background: var(--comfy-input-bg, #23262e);
    color: inherit;
    text-align: left;
    cursor: pointer;
}
.ass-picker-card:hover { border-color: var(--primary-background, #31b9f4); }
.ass-picker-card.is-picked {
    border-color: var(--primary-background, #31b9f4);
    background: color-mix(in srgb, var(--primary-background, #31b9f4) 18%, var(--comfy-input-bg, #23262e));
}
.ass-picker-card-top { display: flex; justify-content: space-between; gap: 6px; font-size: 13px; }

.ass-fallback-lora-list { display: flex; flex-direction: column; gap: 4px; max-height: 360px; overflow-y: auto; }
.ass-fallback-lora-item {
    padding: 7px 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    background: transparent;
    color: inherit;
    text-align: left;
    font-size: 12px;
    cursor: pointer;
}
.ass-fallback-lora-item:hover { background: rgba(255, 255, 255, 0.08); }
.ass-fallback-lora-item.is-applied { border-color: #4ade80; color: #86efac; }

/* Footer & Toasts */
.ass-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    border-top: 1px solid var(--ass-line);
    background: color-mix(in srgb, var(--ass-surface) 60%, var(--ass-bg));
}
.ass-footer-left { display: flex; flex-direction: column; gap: 2px; }
.ass-footer-summary { font-size: 13px; font-weight: 700; }
.ass-footer-progress { font-size: 11.5px; color: var(--ass-accent); }

.ass-toast-host {
    position: fixed;
    top: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 11000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
}
.ass-toast {
    padding: 9px 16px;
    border-radius: 9px;
    background: #1e222b;
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: #f3f4f6;
    font-size: 12.5px;
    font-weight: 600;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    transition: opacity 0.2s ease;
}
.ass-toast.is-success { border-color: rgba(74, 222, 128, 0.6); color: #bbf7d0; }
.ass-toast.is-warn { border-color: rgba(251, 191, 36, 0.6); color: #fde68a; }
.ass-toast.is-error { border-color: rgba(248, 113, 113, 0.7); color: #fecaca; }
.ass-toast.is-fading { opacity: 0; }

/* Image-to-Set Importer */
.ass-new-set-row { flex-wrap: wrap; }
.ass-import-dropzone {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    padding: 9px 12px;
    border: 1.5px dashed color-mix(in srgb, var(--ass-accent) 42%, var(--ass-line));
    border-radius: 10px;
    background: color-mix(in srgb, var(--ass-accent) 6%, var(--ass-surface));
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease, transform 0.12s ease;
}
.ass-import-dropzone:hover {
    border-color: color-mix(in srgb, var(--ass-accent) 75%, transparent);
    background: color-mix(in srgb, var(--ass-accent) 11%, var(--ass-surface));
}
.ass-import-dropzone.is-dragover {
    border-color: var(--ass-accent);
    background: color-mix(in srgb, var(--ass-accent) 18%, var(--ass-surface));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ass-accent) 28%, transparent);
}
.ass-import-dropzone.is-busy {
    opacity: 0.72;
    cursor: wait;
}
.ass-import-dropzone-main {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    flex: 1 1 260px;
}
.ass-import-icon {
    font-size: 18px;
    line-height: 1;
    flex: none;
}
.ass-import-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.ass-import-text strong {
    font-size: 12.5px;
    color: var(--ass-text);
}
.ass-import-text span {
    font-size: 11px;
    color: var(--ass-muted);
}
.ass-import-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
}
.ass-import-mode-check {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--ass-muted);
    cursor: pointer;
    user-select: none;
    margin-right: 4px;
}
.ass-import-mode-check input {
    accent-color: var(--ass-accent);
    cursor: pointer;
}
.ass-import-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 11px;
    border: 1px solid color-mix(in srgb, var(--ass-accent) 45%, var(--ass-line));
    border-radius: 9px;
    background: color-mix(in srgb, var(--ass-accent) 9%, var(--ass-surface));
    font-size: 12px;
}
.ass-import-banner-main {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
}
.ass-import-banner-summary {
    color: var(--ass-text);
    font-size: 11.5px;
}
.ass-import-warning {
    color: #fbbf24;
    font-size: 11px;
}
.ass-import-banner-actions {
    display: flex;
    align-items: center;
    gap: 6px;
}

/* Set Thumbnails */
.ass-thumb-uploader {
    position: relative;
    width: 68px;
    height: 88px;
    flex: none;
    border-radius: 9px;
    border: 1.5px dashed color-mix(in srgb, var(--ass-text) 28%, transparent);
    background: var(--ass-surface);
    overflow: hidden;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
}
.ass-thumb-uploader:hover,
.ass-thumb-uploader.is-dragover {
    border-color: var(--ass-accent);
    background: color-mix(in srgb, var(--ass-accent) 12%, var(--ass-surface));
}
.ass-thumb-uploader.has-image {
    border-style: solid;
    border-color: var(--ass-line);
}
.ass-thumb-uploader.is-busy {
    opacity: 0.7;
    cursor: wait;
}
.ass-thumb-uploader img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.ass-thumb-placeholder {
    font-size: 20px;
    opacity: 0.65;
}
.ass-thumb-clear {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgba(15, 18, 24, 0.82);
    color: #fff;
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
    display: grid;
    place-items: center;
}
.ass-thumb-clear:hover {
    background: var(--ass-danger);
}
.ass-thumb-controls-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 5px;
}
.ass-thumb-meta {
    font-size: 11px;
    color: var(--ass-muted);
}

.ass-saved-item-row,
.ass-picker-card-row {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
}
.ass-saved-item-meta,
.ass-picker-card-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.ass-set-thumb-box {
    flex: none;
    border-radius: 7px;
    overflow: hidden;
    background: color-mix(in srgb, var(--ass-text) 7%, transparent);
    border: 1px solid var(--ass-line);
    display: grid;
    place-items: center;
    color: var(--ass-muted);
}
.ass-set-thumb-box img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.ass-set-thumb-xs {
    width: 38px;
    height: 48px;
    font-size: 14px;
}
.ass-set-thumb-sm {
    width: 44px;
    height: 58px;
    font-size: 16px;
}
.ass-set-mini-thumb {
    width: 24px;
    height: 30px;
    border-radius: 4px;
    object-fit: cover;
    flex: none;
    border: 1px solid var(--ass-line);
}
`;

export function injectStudioStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}
