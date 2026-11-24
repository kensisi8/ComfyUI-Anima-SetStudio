const RESOLUTION_PRESETS = [
    { label: "縦標準 832×1216", w: 832, h: 1216 },
    { label: "縦 896×1152", w: 896, h: 1152 },
    { label: "縦大 1024×1440", w: 1024, h: 1440 },
    { label: "正方形 1024×1024", w: 1024, h: 1024 },
    { label: "横標準 1216×832", w: 1216, h: 832 },
    { label: "高速ラフ 640×960", w: 640, h: 960 },
];

const SEED_MODE_OPTIONS = [
    { value: "randomize", label: "ランダム（1枚ごと自動）", hint: "(ランダム時は自動発行)" },
    { value: "fixed", label: "固定（指定シードを全画像で使用）", hint: "(全画像で固定)" },
    { value: "increment", label: "連番（+1 ずつ増加）", hint: "(開始値・+1ずつ)" },
    { value: "decrement", label: "連番（-1 ずつ減少）", hint: "(開始値・-1ずつ)" },
];

const MAX_SAFE_SEED = 9007199254740991;

function rollRandomSeed() {
    if (window.crypto?.getRandomValues) {
        const buf = new Uint32Array(2);
        window.crypto.getRandomValues(buf);
        const hi = buf[0] & 0x1fffff; // 21 bits
        const lo = buf[1]; // 32 bits -> 53 bits total
        const val = hi * 4294967296 + lo;
        return val > 0 ? val : 1;
    }
    return Math.floor(Math.random() * MAX_SAFE_SEED) + 1;
}

function getSeedHint(mode) {
    return SEED_MODE_OPTIONS.find((opt) => opt.value === mode)?.hint || "(ランダム時は自動発行)";
}

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
                        <label class="ass-label">シード制御モード</label>
                        <select class="ass-select" data-key="seed_mode">
                            ${SEED_MODE_OPTIONS.map(
                                (opt) => `<option value="${opt.value}" ${(cur.seed_mode || "randomize") === opt.value ? "selected" : ""}>${escapeHtml(opt.label)}</option>`,
                            ).join("")}
                        </select>
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">シード値 <span class="ass-hint-inline" data-seed-hint>${escapeHtml(getSeedHint(cur.seed_mode || "randomize"))}</span></label>
                        <div class="ass-inline-row">
                            <input type="number" class="ass-input ass-grow" data-key="seed" step="1" min="0" max="${MAX_SAFE_SEED}" value="${escapeHtml(cur.seed ?? 0)}" />
                            <button type="button" class="ass-btn-xs" data-roll-seed title="ランダムなシード値を入力欄へセット">🎲</button>
                        </div>
                    </div>
                    <div class="ass-field">
                        <label class="ass-label">保存ファイル名プレフィックス <span class="ass-hint-inline">(%date:yyyyMMdd%, {set_name} 可)</span></label>
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

    const seedInput = container.querySelector('[data-key="seed"]');
    const seedModeSelect = container.querySelector('[data-key="seed_mode"]');
    const seedHintEl = container.querySelector("[data-seed-hint]");

    const syncSeedUi = () => {
        const mode = cur.seed_mode || "randomize";
        if (seedHintEl) seedHintEl.textContent = getSeedHint(mode);
        if (seedInput) seedInput.style.opacity = mode === "randomize" ? "0.65" : "1";
    };
    syncSeedUi();

    const updateKey = (key, rawVal, isFloat = false, isInt = false) => {
        let val = rawVal;
        if (isInt) {
            const parsed = parseInt(rawVal, 10);
            if (!Number.isFinite(parsed)) return;
            val = key === "seed" ? Math.max(0, Math.min(MAX_SAFE_SEED, parsed)) : parsed;
        } else if (isFloat) {
            const parsed = parseFloat(rawVal);
            if (!Number.isFinite(parsed)) return;
            val = parsed;
        }
        cur[key] = val;
        if (key === "seed_mode") syncSeedUi();
        onSettingsChange({ ...cur });
    };

    const intKeys = new Set(["width", "height", "steps", "images_per_set", "seed"]);
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

    const rollSeedBtn = container.querySelector("[data-roll-seed]");
    if (rollSeedBtn && seedInput) {
        rollSeedBtn.onclick = () => {
            const rolled = rollRandomSeed();
            seedInput.value = String(rolled);
            cur.seed = rolled;
            // If user explicitly rolls a seed while in randomize mode, keep their mode choice
            // and let them see the fresh value immediately.
            onSettingsChange({ ...cur });
        };
    }

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
