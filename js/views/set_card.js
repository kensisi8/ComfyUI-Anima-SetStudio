import { getSetThumbnailUrl } from "../api.js";
import {
    ASPECT_RATIO_PRESETS,
    DEFAULT_ASPECT_RATIO,
    DEFAULT_BASE_RESOLUTION,
    formatSetResolutionBadge,
    isPresetAspectRatio,
    normalizeAspectRatio,
    parseAspectRatioParts,
} from "../aspect_ratio.js";
import { renderLoraListEditor } from "../components/lora_list.js";
import { normalizeCategoryKey, renderPromptBoxesEditor } from "../components/prompt_boxes.js";

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[ch]);
}

/**
 * Render one called set card inside the Collection ("イラスト集作成") tab.
 * Supports temporary editing without modifying the saved master set unless explicitly saved.
 */
export function createSelectedSetCard(item, options) {
    const {
        index,
        total,
        defaultImagesPerSet = 1,
        baseResolution = DEFAULT_BASE_RESOLUTION,
        defaultAspectRatio = DEFAULT_ASPECT_RATIO,
        commonCategories = [],
        excludedCategories = [],
        availableLoras = [],
        collapsed = false,
        onToggleCollapse = () => {},
        onChange = () => {},
        onMove = () => {},
        onRemove = () => {},
        onSaveOverwrite = () => {},
        onSaveAsNew = () => {},
        onNotify = () => {},
    } = options;

    const enabled = item.enabled !== false;
    const countPlaceholder = String(defaultImagesPerSet || 1);
    const activeLoraCount = (item.loras || []).filter((l) => l.enabled !== false).length;
    const thumbUrl = getSetThumbnailUrl(item.thumbnail);
    const currentRatio = normalizeAspectRatio(item.aspect_ratio, true);
    const isCustomRatio = Boolean(currentRatio) && !isPresetAspectRatio(currentRatio);
    const [customW, customH] = isCustomRatio ? parseAspectRatioParts(currentRatio) : [4, 5];
    const ratioBadgeText = formatSetResolutionBadge(baseResolution, currentRatio, defaultAspectRatio);
    if (!Array.isArray(item.disabled_common_categories)) {
        item.disabled_common_categories = [];
    }
    const formatDisabledCommonBadge = () => {
        const list = (item.disabled_common_categories || []).filter(Boolean);
        if (!list.length) return "";
        const head = list.slice(0, 2).join(", ");
        return list.length > 2 ? `🚫共通: ${head} +${list.length - 2}` : `🚫共通: ${head}`;
    };
    const initialDisabledCommonBadge = formatDisabledCommonBadge();

    const card = document.createElement("div");
    card.className = `ass-set-card ${enabled ? "" : "is-muted"} ${collapsed ? "is-collapsed" : ""}`;
    card.dataset.instanceId = item.instance_id || "";

    card.innerHTML = `
        <div class="ass-set-card-header">
            <label class="ass-check-inline" title="このセットを実行対象に含める">
                <input type="checkbox" data-enabled ${enabled ? "checked" : ""} />
            </label>
            <span class="ass-set-order">#${index + 1}</span>
            <button type="button" class="ass-set-card-title-btn" data-toggle-collapse title="クリックで開閉">
                <span class="ass-caret">${collapsed ? "▸" : "▾"}</span>
                ${thumbUrl ? `<img class="ass-set-mini-thumb" src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" />` : ""}
                <span class="ass-set-card-name">${escapeHtml(item.name || "無題セット")}</span>
                <span class="ass-badge-soft">LoRA ${activeLoraCount}</span>
                <span class="ass-badge-ratio" data-ratio-badge>${escapeHtml(ratioBadgeText)}</span>
                <span class="ass-badge-common-off" data-common-off-badge ${initialDisabledCommonBadge ? "" : "hidden"} title="このセットでのみ無効化する共通プロンプトのカテゴリ">${escapeHtml(initialDisabledCommonBadge)}</span>
            </button>
            <div class="ass-set-card-actions">
                <label class="ass-count-override" title="空欄なら共通の生成枚数を使用">
                    <input type="number" class="ass-input ass-count-input" data-count min="1" max="100" placeholder="${escapeHtml(countPlaceholder)}" value="${item.images_count != null ? escapeHtml(item.images_count) : ""}" />
                    <span>枚</span>
                </label>
                <button type="button" class="ass-btn-xs" data-move-up ${index === 0 ? "disabled" : ""} title="上へ">↑</button>
                <button type="button" class="ass-btn-xs" data-move-down ${index === total - 1 ? "disabled" : ""} title="下へ">↓</button>
                ${item.source_set_id ? `<button type="button" class="ass-btn-xs" data-save-overwrite title="この一時編集で元のセットを上書き保存">上書き</button>` : ""}
                <button type="button" class="ass-btn-xs" data-save-as-new title="この編集内容を新しいセットとして保存">別名保存</button>
                <button type="button" class="ass-btn-xs ass-btn-danger" data-remove title="リストから外す">✕</button>
            </div>
        </div>
        <div class="ass-set-card-body-wrap" ${collapsed ? "hidden" : ""}>
            <div class="ass-card-ratio-bar">
                <span class="ass-sub-heading">アスペクト比（一時編集可）</span>
                <select class="ass-select ass-ratio-select-sm" data-card-ratio-select>
                    <option value="" ${!currentRatio ? "selected" : ""}>共通設定のまま (${escapeHtml(defaultAspectRatio)})</option>
                    ${ASPECT_RATIO_PRESETS.map(
                        (p) => `<option value="${p.value}" ${currentRatio === p.value ? "selected" : ""}>${escapeHtml(p.label)}</option>`,
                    ).join("")}
                    <option value="__custom__" ${isCustomRatio ? "selected" : ""}>カスタム比率...</option>
                </select>
                <span class="ass-ratio-custom-wrap" data-card-ratio-custom ${isCustomRatio ? "" : "hidden"}>
                    <input type="number" class="ass-input ass-ratio-num" data-card-ratio-w min="1" max="100" step="any" value="${escapeHtml(customW)}" />
                    <span class="ass-muted">:</span>
                    <input type="number" class="ass-input ass-ratio-num" data-card-ratio-h min="1" max="100" step="any" value="${escapeHtml(customH)}" />
                </span>
            </div>
            <div class="ass-card-common-off-bar">
                <span class="ass-sub-heading" title="選択したカテゴリは、このセットを生成する時だけ「共通プロンプト」から除外されます">このセットで無効にする共通カテゴリ（一時編集可）</span>
                <div class="ass-common-off-chips" data-card-common-off-chips></div>
            </div>
            <div class="ass-set-card-body">
                <div class="ass-set-card-col">
                    <div class="ass-sub-heading">LoRA（一時編集可）</div>
                    <div data-lora-slot></div>
                </div>
                <div class="ass-set-card-col ass-set-card-col-prompt">
                    <div class="ass-sub-heading">プロンプト（一時編集可）</div>
                    <div data-prompt-slot></div>
                </div>
            </div>
        </div>
    `;

    card.querySelector("[data-enabled]").onchange = (e) => {
        item.enabled = e.target.checked;
        card.classList.toggle("is-muted", !item.enabled);
        onChange();
    };

    card.querySelector("[data-toggle-collapse]").onclick = () => onToggleCollapse(item.instance_id);

    const countInput = card.querySelector("[data-count]");
    countInput.addEventListener("input", () => {
        const raw = countInput.value.trim();
        if (!raw) {
            item.images_count = null;
        } else {
            const parsed = parseInt(raw, 10);
            if (Number.isFinite(parsed) && parsed >= 1) {
                item.images_count = Math.min(100, parsed);
            }
        }
        onChange();
    });
    countInput.addEventListener("keydown", (e) => e.stopPropagation());

    card.querySelector("[data-move-up]").onclick = () => onMove(index, -1);
    card.querySelector("[data-move-down]").onclick = () => onMove(index, 1);
    card.querySelector("[data-remove]").onclick = () => onRemove(index);

    const overwriteBtn = card.querySelector("[data-save-overwrite]");
    if (overwriteBtn) {
        overwriteBtn.onclick = () => onSaveOverwrite(item);
    }
    card.querySelector("[data-save-as-new]").onclick = () => onSaveAsNew(item);

    if (!collapsed) {
        const ratioSelect = card.querySelector("[data-card-ratio-select]");
        const customWrap = card.querySelector("[data-card-ratio-custom]");
        const customWInput = card.querySelector("[data-card-ratio-w]");
        const customHInput = card.querySelector("[data-card-ratio-h]");
        const ratioBadgeEl = card.querySelector("[data-ratio-badge]");

        const updateCardRatio = (nextRatio) => {
            item.aspect_ratio = normalizeAspectRatio(nextRatio, true);
            if (ratioBadgeEl) {
                ratioBadgeEl.textContent = formatSetResolutionBadge(baseResolution, item.aspect_ratio, defaultAspectRatio);
            }
            onChange();
        };

        const applyCustomCardRatio = () => {
            const norm = normalizeAspectRatio(`${customWInput.value}:${customHInput.value}`, true);
            if (norm) updateCardRatio(norm);
        };

        ratioSelect.onchange = () => {
            const val = ratioSelect.value;
            if (val === "__custom__") {
                customWrap.hidden = false;
                applyCustomCardRatio();
            } else {
                customWrap.hidden = true;
                updateCardRatio(val);
            }
        };
        for (const inp of [customWInput, customHInput]) {
            inp.addEventListener("input", applyCustomCardRatio);
            inp.addEventListener("keydown", (e) => e.stopPropagation());
        }

        const commonOffHost = card.querySelector("[data-card-common-off-chips]");
        const commonOffBadgeEl = card.querySelector("[data-common-off-badge]");
        const renderCardCommonOffChips = () => {
            const selectedMap = new Set((item.disabled_common_categories || []).map(normalizeCategoryKey));
            const candidates = [];
            const seen = new Set();
            for (const label of [...(commonCategories || []), ...(item.disabled_common_categories || [])]) {
                const clean = String(label || "").trim();
                const key = normalizeCategoryKey(clean);
                if (clean && key && !seen.has(key)) {
                    seen.add(key);
                    candidates.push(clean);
                }
            }
            if (!candidates.length) {
                commonOffHost.innerHTML = `<span class="ass-hint-inline">共通プロンプトにカテゴリ名を付けるとここで無効化できます</span>`;
                return;
            }
            commonOffHost.innerHTML = "";
            for (const cat of candidates) {
                const key = normalizeCategoryKey(cat);
                const isOff = selectedMap.has(key);
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = `ass-common-off-chip ${isOff ? "is-off" : ""}`;
                btn.innerHTML = `<span>${isOff ? "🚫" : "✓"}</span><span>${escapeHtml(cat)}</span>`;
                btn.title = isOff
                    ? `共通プロンプトの「${cat}」はこのセットでは無効です（クリックで有効に戻す）`
                    : `クリックするとこのセットでのみ共通プロンプトの「${cat}」を無効にします`;
                btn.onclick = () => {
                    if (isOff) {
                        item.disabled_common_categories = (item.disabled_common_categories || []).filter(
                            (c) => normalizeCategoryKey(c) !== key,
                        );
                    } else {
                        item.disabled_common_categories = [...(item.disabled_common_categories || []), cat];
                    }
                    const nextBadge = formatDisabledCommonBadge();
                    if (commonOffBadgeEl) {
                        commonOffBadgeEl.textContent = nextBadge;
                        commonOffBadgeEl.hidden = !nextBadge;
                    }
                    renderCardCommonOffChips();
                    onChange();
                };
                commonOffHost.appendChild(btn);
            }
        };
        renderCardCommonOffChips();

        renderLoraListEditor(card.querySelector("[data-lora-slot]"), {
            loras: item.loras || [],
            availableLoras,
            emptyTitle: "このセットにLoRAなし",
            onChange: (nextLoras) => {
                item.loras = nextLoras;
                onChange();
            },
            onNotify,
        });

        renderPromptBoxesEditor(card.querySelector("[data-prompt-slot]"), {
            boxes: item.prompt_boxes || [],
            separator: item.separator ?? ", ",
            showSeparator: false,
            excludedCategories,
            onChange: ({ boxes, separator }) => {
                item.prompt_boxes = boxes;
                item.separator = separator;
                onChange();
            },
            onNotify,
        });
    }

    return card;
}
