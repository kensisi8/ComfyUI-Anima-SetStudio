import {
    openAnimaLoraManager,
    openFallbackLoraPicker,
    resolveLoraPreviewMedia,
} from "../bridge_anima_tools.js";

const COPY_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="3" width="10" height="11" rx="2"/><path d="M13 14v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/></svg>';
const REMOVE_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8"/></svg>';
const LAYERS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>';

function formatStrength(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(2) : "1.00";
}

function paintStrengthRange(range, value) {
    const min = Number(range.min);
    const max = Number(range.max);
    const span = max - min || 1;
    const ratio = (n) => Math.min(1, Math.max(0, (n - min) / span)).toFixed(4);
    const zero = ratio(0);
    const current = ratio(value);
    range.style.setProperty("--ass-fill-from", value < 0 ? current : zero);
    range.style.setProperty("--ass-fill-to", value < 0 ? zero : current);
    range.style.setProperty("--ass-zero", zero);
}

async function copyTriggerWords(entry, onNotify) {
    const words = Array.isArray(entry?.trained_words)
        ? entry.trained_words.map((w) => String(w || "").trim()).filter(Boolean)
        : [];
    if (!words.length) {
        onNotify("このLoRAにはキャッシュ済みのトリガーワードがありません", "warn");
        return;
    }
    const text = words.join(", ");
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
        }
        onNotify(`トリガーワード (${words.length}件) をコピーしました`, "success");
    } catch (_) {
        onNotify("クリップボードへのコピーに失敗しました", "error");
    }
}

/**
 * Render an Anima Multi LoRA Loader compatible editor inside `container`.
 *
 * Options:
 * - loras: Array of LoRA objects
 * - availableLoras: Array<string> (fallback picker list)
 * - emptyTitle: string
 * - onChange: (updatedLoras) => void
 * - onNotify: (message, severity?) => void
 */
export function renderLoraListEditor(container, options) {
    const {
        loras: initialLoras = [],
        availableLoras = [],
        emptyTitle = "LoRAがまだ追加されていません",
        onChange = () => {},
        onNotify = () => {},
    } = options;

    let loras = (Array.isArray(initialLoras) ? initialLoras : []).map((item) => ({
        ...item,
        strength_model: Number.isFinite(Number(item.strength_model)) ? Number(item.strength_model) : 1.0,
        enabled: item.enabled !== false,
    }));

    const root = document.createElement("div");
    root.className = "ass-lora-panel";
    container.innerHTML = "";
    container.appendChild(root);

    function emitChange() {
        onChange(loras);
    }

    function openManager() {
        const opened = openAnimaLoraManager(loras, (updated) => {
            loras = (Array.isArray(updated) ? updated : []).map((item) => ({
                ...item,
                strength_model: Number.isFinite(Number(item.strength_model)) ? Number(item.strength_model) : 1.0,
                enabled: item.enabled !== false,
            }));
            emitChange();
            render();
        });
        if (!opened) {
            openFallbackLoraPicker(availableLoras, loras, (added) => {
                const exists = loras.findIndex(
                    (l) => String(l.name || "").toLowerCase() === String(added.name || "").toLowerCase(),
                );
                if (exists >= 0) {
                    loras[exists].enabled = true;
                } else {
                    loras.push(added);
                }
                emitChange();
                render();
                onNotify(`LoRAを追加しました: ${added.display_name || added.name}`, "success");
            });
        }
    }

    function render() {
        root.innerHTML = "";

        if (!loras.length) {
            const emptyBtn = document.createElement("button");
            emptyBtn.type = "button";
            emptyBtn.className = "ass-lora-empty";
            emptyBtn.innerHTML = `
                <span class="ass-lora-empty-icon">${PLUS_ICON}</span>
                <span class="ass-lora-empty-text">
                    <strong>${emptyTitle}</strong>
                    <span>Open LoRA Manager（クリックしてLoRAを選択）</span>
                </span>
            `;
            emptyBtn.onclick = openManager;
            root.appendChild(emptyBtn);
            return;
        }

        const listEl = document.createElement("div");
        listEl.className = "ass-lora-list";

        loras.forEach((entry, idx) => {
            const enabled = entry.enabled !== false;
            const strength = Number.isFinite(Number(entry.strength_model)) ? Number(entry.strength_model) : 1.0;
            const displayName = String(entry.display_name || entry.name || "LoRA")
                .replaceAll("\\", "/")
                .split("/")
                .pop();
            const hasTriggers = Array.isArray(entry.trained_words) && entry.trained_words.some((w) => String(w || "").trim());

            const row = document.createElement("div");
            row.className = `ass-lora-row ${enabled ? "" : "is-disabled"} ${strength < 0 ? "is-negative" : ""}`;

            const thumb = document.createElement("div");
            thumb.className = "ass-lora-thumb";
            thumb.title = entry.name || "";
            thumb.innerHTML = LAYERS_ICON;
            const img = document.createElement("img");
            img.alt = "";
            img.decoding = "async";
            img.loading = "lazy";
            thumb.appendChild(img);

            if (entry.preview_url) {
                resolveLoraPreviewMedia(entry.preview_url, 96).then(({ src, fallbacks }) => {
                    if (!src) return;
                    const queue = [...fallbacks];
                    img.onload = () => thumb.classList.add("has-image");
                    img.onerror = () => {
                        const next = queue.shift();
                        if (next) img.src = next;
                        else thumb.classList.remove("has-image");
                    };
                    img.src = src;
                });
            }

            const body = document.createElement("div");
            body.className = "ass-lora-body";

            const header = document.createElement("div");
            header.className = "ass-lora-header";

            const toggleBtn = document.createElement("button");
            toggleBtn.type = "button";
            toggleBtn.className = "ass-lora-toggle";
            toggleBtn.setAttribute("role", "switch");
            toggleBtn.setAttribute("aria-checked", String(enabled));
            toggleBtn.title = enabled ? "LoRAを無効にする" : "LoRAを有効にする";
            toggleBtn.onclick = () => {
                entry.enabled = !enabled;
                emitChange();
                render();
            };

            const nameBtn = document.createElement("button");
            nameBtn.type = "button";
            nameBtn.className = "ass-lora-name";
            nameBtn.textContent = displayName;
            nameBtn.title = `${entry.name}\nクリックでトリガーワードをコピー`;
            nameBtn.onclick = () => copyTriggerWords(entry, onNotify);

            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.className = `ass-lora-icon ${hasTriggers ? "" : "is-empty"}`;
            copyBtn.innerHTML = COPY_ICON;
            copyBtn.title = "トリガーワードをコピー";
            copyBtn.onclick = () => copyTriggerWords(entry, onNotify);

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "ass-lora-icon ass-lora-remove";
            removeBtn.innerHTML = REMOVE_ICON;
            removeBtn.title = "削除";
            removeBtn.onclick = () => {
                loras.splice(idx, 1);
                emitChange();
                render();
            };

            header.append(toggleBtn, nameBtn, copyBtn, removeBtn);

            const strengthRow = document.createElement("div");
            strengthRow.className = "ass-lora-strength";

            const range = document.createElement("input");
            range.type = "range";
            range.step = "0.05";
            range.min = String(Math.min(-2, strength));
            range.max = String(Math.max(2, strength));
            range.value = String(strength);
            range.disabled = !enabled;
            range.title = "強度（ダブルクリックで 1.00 にリセット）";
            paintStrengthRange(range, strength);

            const numInput = document.createElement("input");
            numInput.type = "number";
            numInput.step = "0.05";
            numInput.value = formatStrength(strength);
            numInput.disabled = !enabled;

            const applyStrength = (val) => {
                if (!Number.isFinite(val)) return;
                entry.strength_model = val;
                range.min = String(Math.min(-2, val));
                range.max = String(Math.max(2, val));
                range.value = String(val);
                numInput.value = formatStrength(val);
                row.classList.toggle("is-negative", val < 0);
                paintStrengthRange(range, val);
                emitChange();
            };

            range.oninput = () => applyStrength(range.valueAsNumber);
            range.ondblclick = () => applyStrength(1.0);
            numInput.onchange = () => {
                const parsed = numInput.valueAsNumber;
                if (Number.isFinite(parsed)) applyStrength(parsed);
                else numInput.value = formatStrength(entry.strength_model);
            };
            numInput.onkeydown = (e) => {
                e.stopPropagation();
                if (e.key === "Enter") numInput.onchange();
            };

            strengthRow.append(range, numInput);
            body.append(header, strengthRow);
            row.append(thumb, body);
            listEl.appendChild(row);
        });

        const enabledCount = loras.filter((l) => l.enabled !== false).length;
        const footer = document.createElement("div");
        footer.className = "ass-lora-footer";
        footer.innerHTML = `<span class="ass-lora-summary">${enabledCount} / ${loras.length} 有効</span>`;

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "ass-lora-open-btn";
        openBtn.innerHTML = `${PLUS_ICON}<span>Open LoRA Manager</span>`;
        openBtn.onclick = openManager;
        footer.appendChild(openBtn);

        root.append(listEl, footer);
    }

    render();
    return {
        getLoras: () => loras,
    };
}
