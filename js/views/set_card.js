import { getSetThumbnailUrl } from "../api.js";
import { renderLoraListEditor } from "../components/lora_list.js";
import { renderPromptBoxesEditor } from "../components/prompt_boxes.js";

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

    const card = document.createElement("div");
    card.className = `ass-set-card ${enabled ? "" : "is-muted"} ${collapsed ? "is-collapsed" : ""}`;

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
        <div class="ass-set-card-body" ${collapsed ? "hidden" : ""}>
            <div class="ass-set-card-col">
                <div class="ass-sub-heading">LoRA（一時編集可）</div>
                <div data-lora-slot></div>
            </div>
            <div class="ass-set-card-col ass-set-card-col-prompt">
                <div class="ass-sub-heading">プロンプト（一時編集可）</div>
                <div data-prompt-slot></div>
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
