const RESOLUTION_PRESETS = [
    { label: "縦標準 832×1216", w: 832, h: 1216 },
    { label: "縦 896×1152", w: 896, h: 1152 },
    { label: "縦大 1024×1440", w: 1024, h: 1440 },
    { label: "正方形 1024×1024", w: 1024, h: 1024 },
    { label: "横標準 1216×832", w: 1216, h: 832 },
    { label: "高速ラフ 640×960", w: 640, h: 960 },
];

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[ch]);
}

function buildSelectOptions(items, currentValue) {
    const list = Array.isArray(items) ? [...items] : [];
    const cur = String(currentValue || "");
    if (cur && !list.includes(cur)) {
        list.unshift(cur);
    }
    return list
        .map((item) => `<option value="${escapeHtml(item)}" ${item === cur ? "selected" : ""}>${escapeHtml(item)}</option>`)
        .join("");
}

/**
 * Render negative prompt, basic settings (resolution + images per set),
 * and collapsible detailed KSampler / model settings.
 */
export function renderGenerationSettings(container, options) {
    const {
        negativePrompt = "",
        settings = {},
        runtimeOptions = {},
        onNegativeChange = () => {},
        onSettingsChange = () => {},
    } = options;

    const cur = { ...(runtimeOptions.defaults || {}), ...(settings || {}) };

    container.innerHTML = `
        <div class="ass-settings-wrap">
            <div class="ass-field">
                <label class="ass-label">ネガティブプロンプト</label>
                <textarea class="ass-textarea" data-neg rows="2" spellcheck="false" placeholder="low quality, bad anatomy..."></textarea>
            </div>

            <div class="ass-basic-grid">
                <div class="ass-field">
                    <label class="ass-label">解像度（幅 × 高さ）</label>
                    <div class="ass-inline-row">
                        <input type="number" class="ass-input ass-num-sm" data-key="width" step="16" min="64" max="4096" value="${escapeHtml(cur.width)}" />
                        <span class="ass-muted">×</span>
                        <input type="number" class="ass-input ass-num-sm" data-key="height" step="16" min="64" max="4096" value="${escapeHtml(cur.height)}" />
                    </div>
                    <div class="ass-preset-chips">
                        ${RESOLUTION_PRESETS.map(
                            (p) => `<button type="button" class="ass-chip-btn" data-res-w="${p.w}" data-res-h="${p.h}">${escapeHtml(p.label)}</button>`,
                        ).join("")}
                    </div>
                </div>

                <div class="ass-field">
                    <label class="ass-label">1セットあたりの生成枚数（デフォルト）</label>
                    <div class="ass-inline-row">
                        <input type="number" class="ass-input ass-num-sm" data-key="images_per_set" min="1" max="100" value="${escapeHtml(cur.images_per_set)}" />
                        <span class="ass-muted">枚 / セット</span>
                    </div>
                    <div class="ass-preset-chips">
                        ${[1, 3, 5, 7, 10]
                            .map((n) => `<button type="button" class="ass-chip-btn" data-count="${n}">${n}枚</button>`)
                            .join("")}
                    </div>
                </div>
            </div>

            <details class="ass-details-box">
                <summary>⚙️ 詳細な生成設定（モデル・Kサンプラー・保存名）</summary>
                <div class="ass-details-grid">
                    <div class="ass-field">
                        <label class="ass-label">拡散モデル (UNET / Diffusion Model)</label>
                        <select class="ass-select" data-key="unet_name">${buildSelectOptions(runtimeOptions.diffusion_models, cur.unet_name)}</select>
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">重み dtype</label>
                        <select class="ass-select" data-key="weight_dtype">${buildSelectOptions(runtimeOptions.weight_dtypes, cur.weight_dtype)}</select>
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">CLIP (Text Encoder)</label>
                        <select class="ass-select" data-key="clip_name">${buildSelectOptions(runtimeOptions.clips, cur.clip_name)}</select>
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">CLIP タイプ</label>
                        <select class="ass-select" data-key="clip_type">${buildSelectOptions(runtimeOptions.clip_types, cur.clip_type)}</select>
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">VAE</label>
                        <select class="ass-select" data-key="vae_name">${buildSelectOptions(runtimeOptions.vaes, cur.vae_name)}</select>
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">ModelSamplingAuraFlow シフト</label>
                        <input type="number" class="ass-input" data-key="shift" step="0.1" min="0" max="100" value="${escapeHtml(cur.shift)}" />
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">ステップ数 (Steps)</label>
                        <input type="number" class="ass-input" data-key="steps" step="1" min="1" max="200" value="${escapeHtml(cur.steps)}" />
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">CFG</label>
                        <input type="number" class="ass-input" data-key="cfg" step="0.1" min="0" max="30" value="${escapeHtml(cur.cfg)}" />
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">サンプラー</label>
                        <select class="ass-select" data-key="sampler_name">${buildSelectOptions(runtimeOptions.samplers, cur.sampler_name)}</select>
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">スケジューラ</label>
                        <select class="ass-select" data-key="scheduler">${buildSelectOptions(runtimeOptions.schedulers, cur.scheduler)}</select>
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">ノイズ除去 (Denoise)</label>
                        <input type="number" class="ass-input" data-key="denoise" step="0.05" min="0" max="1" value="${escapeHtml(cur.denoise)}" />
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">保存ファイル名プレフィックス <span class="ass-hint-inline">({set_name} 可)</span></label>
                        <input type="text" class="ass-input" data-key="filename_prefix" value="${escapeHtml(cur.filename_prefix)}" />
                    </div>
                </div>
            </details>
        </div>
    `;

    const negEl = container.querySelector("[data-neg]");
    negEl.value = negativePrompt || "";
    negEl.addEventListener("input", () => onNegativeChange(negEl.value));
    negEl.addEventListener("keydown", (e) => e.stopPropagation());

    const updateKey = (key, rawVal, isFloat = false, isInt = false) => {
        let val = rawVal;
        if (isInt) {
            const parsed = parseInt(rawVal, 10);
            if (!Number.isFinite(parsed)) return;
            val = parsed;
        } else if (isFloat) {
            const parsed = parseFloat(rawVal);
            if (!Number.isFinite(parsed)) return;
            val = parsed;
        }
        cur[key] = val;
        onSettingsChange({ ...cur });
    };

    const intKeys = new Set(["width", "height", "steps", "images_per_set"]);
    const floatKeys = new Set(["shift", "cfg", "denoise"]);

    container.querySelectorAll("[data-key]").forEach((el) => {
        const key = el.dataset.key;
        const handler = () => updateKey(key, el.value, floatKeys.has(key), intKeys.has(key));
        el.addEventListener("change", handler);
        if (el.tagName === "INPUT") {
            el.addEventListener("input", handler);
            el.addEventListener("keydown", (e) => e.stopPropagation());
        }
    });

    const widthInput = container.querySelector('[data-key="width"]');
    const heightInput = container.querySelector('[data-key="height"]');
    container.querySelectorAll("[data-res-w]").forEach((btn) => {
        btn.onclick = () => {
            const w = parseInt(btn.dataset.resW, 10);
            const h = parseInt(btn.dataset.resH, 10);
            widthInput.value = String(w);
            heightInput.value = String(h);
            cur.width = w;
            cur.height = h;
            onSettingsChange({ ...cur });
        };
    });

    const countInput = container.querySelector('[data-key="images_per_set"]');
    container.querySelectorAll("[data-count]").forEach((btn) => {
        btn.onclick = () => {
            const n = parseInt(btn.dataset.count, 10);
            countInput.value = String(n);
            cur.images_per_set = n;
            onSettingsChange({ ...cur });
        };
    });
}
