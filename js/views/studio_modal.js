import {
    buildBatchJobs,
    deleteSet,
    duplicateSet,
    fetchOptions,
    fetchSets,
    fetchState,
    getSetThumbnailUrl,
    importSetFromImage,
    queueComfyPrompt,
    saveSet,
    saveState,
    uploadSetThumbnail,
} from "../api.js";
import {
    ASPECT_RATIO_PRESETS,
    DEFAULT_ASPECT_RATIO,
    DEFAULT_BASE_RESOLUTION,
    computeDimensionsForAspectRatio,
    formatSetResolutionBadge,
    isPresetAspectRatio,
    normalizeAspectRatio,
    normalizeBaseResolution,
    parseAspectRatioParts,
} from "../aspect_ratio.js";
import { configureAnimaToolsBridge } from "../bridge_anima_tools.js";
import { renderLoraListEditor } from "../components/lora_list.js";
import {
    createPromptBox,
    normalizeCategoryKey,
    renderPromptBoxesEditor,
} from "../components/prompt_boxes.js";
import { renderGenerationSettings } from "../components/settings.js";
import { createSelectedSetCard } from "./set_card.js";

const DEFAULT_TEMPLATE_CATEGORIES = ["品質", "体格", "キャラ", "衣装", "ポーズ", "背景"];

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[ch]);
}

function deepClone(value) {
    try {
        return structuredClone(value);
    } catch (_) {
        return JSON.parse(JSON.stringify(value));
    }
}

function makeInstanceFromSet(setRecord) {
    return {
        instance_id: `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        source_set_id: setRecord.id || "",
        name: setRecord.name || "無題セット",
        thumbnail: setRecord.thumbnail || "",
        aspect_ratio: setRecord.aspect_ratio || "",
        disabled_common_categories: deepClone(setRecord.disabled_common_categories || []),
        enabled: true,
        images_count: null,
        separator: setRecord.separator ?? ", ",
        loras: deepClone(setRecord.loras || []),
        prompt_boxes: deepClone(setRecord.prompt_boxes || [createPromptBox()]),
    };
}

function collectCommonCategoryNames(commonBoxes) {
    const map = new Map();
    for (const box of commonBoxes || []) {
        const label = String(box?.label || "").trim();
        const key = normalizeCategoryKey(label);
        if (label && key && !map.has(key)) {
            map.set(key, label);
        }
    }
    return [...map.values()];
}

function formatDisabledCommonSummary(list) {
    const clean = (Array.isArray(list) ? list : []).map((x) => String(x || "").trim()).filter(Boolean);
    if (!clean.length) return "";
    const head = clean.slice(0, 2).join(", ");
    return clean.length > 2 ? `🚫共通: ${head} +${clean.length - 2}` : `🚫共通: ${head}`;
}

function collectCategoriesFromSets(selectedSets) {
    const map = new Map();
    for (const item of selectedSets || []) {
        for (const box of item.prompt_boxes || []) {
            const label = String(box?.label || "").trim();
            const key = normalizeCategoryKey(label);
            if (label && key && !map.has(key)) {
                map.set(key, label);
            }
        }
    }
    return [...map.values()];
}

export class AnimaSetStudioModal {
    constructor() {
        this.isOpen = false;
        this.activeTab = "collection"; // "collection" | "sets"
        this.sets = [];
        this.state = null;
        this.options = {};
        this.editingSet = null;
        this.setSearchQuery = "";
        this.collapsedCards = new Set();
        this.saveStateTimer = null;
        this.isExecuting = false;
        this.isImportingImage = false;
        this.isUploadingThumb = false;
        this.importAsNewOnDrop = true;
        this.lastImportInfo = null;
        this.lastThumbMeta = null;
        this.overlay = null;
        this.toastContainer = null;
    }

    notify(message, severity = "info") {
        if (!this.toastContainer) {
            this.toastContainer = document.createElement("div");
            this.toastContainer.className = "ass-toast-host";
            document.body.appendChild(this.toastContainer);
        }
        const toast = document.createElement("div");
        toast.className = `ass-toast is-${severity}`;
        toast.textContent = message;
        this.toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add("is-fading");
            setTimeout(() => toast.remove(), 220);
        }, 3200);
    }

    scheduleSaveState() {
        if (!this.state) return;
        if (this.saveStateTimer) clearTimeout(this.saveStateTimer);
        this.saveStateTimer = setTimeout(async () => {
            this.saveStateTimer = null;
            try {
                await saveState(this.state);
            } catch (err) {
                console.warn("[Anima SetStudio] Auto-save state failed:", err);
            }
        }, 450);
    }

    async open() {
        this.isOpen = true;
        this.ensureOverlay();
        this.overlay.classList.add("is-open");
        this.renderLoading();
        try {
            const [sets, state, options] = await Promise.all([
                fetchSets(),
                fetchState(),
                fetchOptions(),
            ]);
            this.sets = sets;
            this.state = state;
            this.options = options || {};
            if (this.options.anima_tools_ext_name) {
                configureAnimaToolsBridge(this.options.anima_tools_ext_name);
            }
            if (!this.editingSet && this.sets.length) {
                this.editingSet = deepClone(this.sets[0]);
            }
            this.render();
        } catch (err) {
            this.notify(`データ読み込みに失敗しました: ${err.message}`, "error");
        }
    }

    close() {
        this.isOpen = false;
        if (this.overlay) {
            this.overlay.classList.remove("is-open");
        }
    }

    toggle() {
        if (this.isOpen) this.close();
        else void this.open();
    }

    ensureOverlay() {
        if (this.overlay) return;
        const overlay = document.createElement("div");
        overlay.id = "anima-set-studio-overlay";
        overlay.className = "ass-overlay";
        overlay.tabIndex = -1;
        // Close ONLY via the explicit ✕ button (do not close on backdrop click or Esc)
        document.body.appendChild(overlay);
        this.overlay = overlay;
    }

    renderLoading() {
        this.overlay.innerHTML = `
            <div class="ass-window">
                <div class="ass-header">
                    <div class="ass-brand">🎨 Anima SetStudio</div>
                    <button type="button" class="ass-icon-btn" data-close>✕</button>
                </div>
                <div class="ass-loading">読み込み中...</div>
            </div>
        `;
        this.overlay.querySelector("[data-close]").onclick = () => this.close();
    }

    computeBatchStats() {
        const selected = this.state?.selected_sets || [];
        const defaultCount = Number(this.state?.settings?.images_per_set) || 1;
        let activeSets = 0;
        let totalImages = 0;
        for (const item of selected) {
            if (item.enabled === false) continue;
            activeSets += 1;
            totalImages += Number(item.images_count) > 0 ? Number(item.images_count) : defaultCount;
        }
        return { activeSets, totalImages };
    }

    updateFooterSummary() {
        const summaryEl = this.overlay?.querySelector("[data-footer-summary]");
        const runBtn = this.overlay?.querySelector("[data-run-btn]");
        if (!summaryEl || !runBtn) return;
        const { activeSets, totalImages } = this.computeBatchStats();
        const baseRes = normalizeBaseResolution(this.state?.settings?.base_resolution ?? DEFAULT_BASE_RESOLUTION);
        const defRatio = normalizeAspectRatio(this.state?.settings?.default_aspect_ratio, false) || DEFAULT_ASPECT_RATIO;
        const { megapixels } = computeDimensionsForAspectRatio(baseRes, defRatio);
        summaryEl.textContent = `有効セット: ${activeSets}件 / 合計生成枚数: ${totalImages}枚 (基準 ${baseRes}px · 約${megapixels}MP)`;
        if (!this.isExecuting) {
            runBtn.disabled = activeSets === 0;
            runBtn.textContent = activeSets > 0 ? `▶ 実行（全 ${totalImages} 枚をまとめて生成）` : "▶ 実行（セットを追加してください）";
        }
    }

    render() {
        if (!this.overlay || !this.state) return;
        const hasAnimaTools = Boolean(this.options?.has_anima_tools);

        this.overlay.innerHTML = `
            <div class="ass-window">
                <header class="ass-header">
                    <div class="ass-header-left">
                        <div class="ass-brand">🎨 Anima SetStudio</div>
                        <nav class="ass-tabs">
                            <button type="button" class="ass-tab ${this.activeTab === "collection" ? "is-active" : ""}" data-tab="collection">📚 イラスト集作成</button>
                            <button type="button" class="ass-tab ${this.activeTab === "sets" ? "is-active" : ""}" data-tab="sets">🧩 セット管理 (${this.sets.length})</button>
                        </nav>
                    </div>
                    <div class="ass-header-right">
                        <span class="ass-status-pill ${hasAnimaTools ? "is-ok" : "is-warn"}" title="${hasAnimaTools ? "Comfyui-Anima-Tools の Select / LoRA Manager と完全連携中" : "標準フォールバックモード"}">
                            ${hasAnimaTools ? "Anima-Tools 連携OK" : "標準モード"}
                        </span>
                        <button type="button" class="ass-icon-btn" data-close title="閉じる">✕</button>
                    </div>
                </header>
                <main class="ass-main" data-main></main>
                <footer class="ass-footer" data-footer></footer>
            </div>
        `;

        this.overlay.querySelector("[data-close]").onclick = () => this.close();
        this.overlay.querySelectorAll("[data-tab]").forEach((btn) => {
            btn.onclick = () => {
                this.activeTab = btn.dataset.tab;
                this.render();
            };
        });

        const mainEl = this.overlay.querySelector("[data-main]");
        const footerEl = this.overlay.querySelector("[data-footer]");

        if (this.activeTab === "collection") {
            this.renderCollectionTab(mainEl, footerEl);
        } else {
            this.renderSetsTab(mainEl, footerEl);
        }
    }

    renderCollectionTab(mainEl, footerEl) {
        mainEl.innerHTML = `
            <div class="ass-collection-layout">
                <section class="ass-pane ass-pane-common">
                    <div class="ass-section-block">
                        <div class="ass-section-title">① 共通LoRA（全セットに合体）</div>
                        <div data-common-loras></div>
                    </div>

                    <div class="ass-section-block">
                        <div class="ass-section-title">② 共通プロンプト（先頭に結合・案B）</div>
                        <div data-common-prompts></div>
                    </div>

                    <div class="ass-section-block">
                        <div class="ass-section-title-row">
                            <span class="ass-section-title">③ 使わないカテゴリ（セット側から隠す）</span>
                            <button type="button" class="ass-btn-xs" data-auto-hide-common title="共通プロンプトと同じカテゴリ名を自動で隠す">✨ 共通と同名を隠す</button>
                        </div>
                        <div class="ass-exclude-chips" data-exclude-chips></div>
                    </div>

                    <div class="ass-section-block">
                        <div class="ass-section-title">④ ネガティブ・解像度・生成設定</div>
                        <div data-settings-slot></div>
                    </div>
                </section>

                <section class="ass-pane ass-pane-sets">
                    <div class="ass-pane-toolbar">
                        <div class="ass-section-title">呼び出したセット一覧（一時編集 OK）</div>
                        <div class="ass-toolbar-btns">
                            <button type="button" class="ass-btn-primary-sm" data-add-set>+ セットを呼び出す</button>
                            <button type="button" class="ass-btn-xs" data-reorder-sets ${(this.state.selected_sets || []).length < 2 ? "disabled" : ""} title="呼び出し済みセットの順番をドラッグや ↑↓ でまとめて並び替え">⇅ 並び替え</button>
                            <button type="button" class="ass-btn-xs" data-clear-sets ${(this.state.selected_sets || []).length ? "" : "disabled"}>全クリア</button>
                        </div>
                    </div>
                    <div class="ass-selected-list" data-selected-list></div>
                </section>
            </div>
        `;

        footerEl.innerHTML = `
            <div class="ass-footer-left">
                <span class="ass-footer-summary" data-footer-summary></span>
                <span class="ass-footer-progress" data-footer-progress></span>
            </div>
            <div class="ass-footer-right">
                <button type="button" class="ass-btn-run" data-run-btn></button>
            </div>
        `;

        // 1. Common LoRAs
        renderLoraListEditor(mainEl.querySelector("[data-common-loras]"), {
            loras: this.state.common_loras || [],
            availableLoras: this.options.loras || [],
            emptyTitle: "共通LoRAなし（例：キャラLoRAを追加）",
            onChange: (nextLoras) => {
                this.state.common_loras = nextLoras;
                this.scheduleSaveState();
            },
            onNotify: (msg, sev) => this.notify(msg, sev),
        });

        // 2. Common Prompt Boxes
        let lastCommonCatSig = collectCommonCategoryNames(this.state.common_prompt_boxes || []).join("|");
        renderPromptBoxesEditor(mainEl.querySelector("[data-common-prompts]"), {
            boxes: this.state.common_prompt_boxes || [],
            separator: this.state.common_separator ?? ", ",
            showSeparator: false,
            onChange: ({ boxes, separator }) => {
                this.state.common_prompt_boxes = boxes;
                this.state.common_separator = separator;
                this.scheduleSaveState();
                const nextSig = collectCommonCategoryNames(boxes).join("|");
                if (nextSig !== lastCommonCatSig) {
                    lastCommonCatSig = nextSig;
                    renderSelectedSets();
                }
            },
            onNotify: (msg, sev) => this.notify(msg, sev),
        });

        // 3. Excluded Category Chips + Auto-match button
        const renderExcludeChips = () => {
            const chipsHost = mainEl.querySelector("[data-exclude-chips]");
            const allCats = collectCategoriesFromSets(this.state.selected_sets || []);
            const currentExcluded = this.state.excluded_categories || [];
            const excludedKeys = new Set(currentExcluded.map(normalizeCategoryKey));

            // Keep any already-excluded categories visible even if temporarily no set has them
            const displayCats = [...allCats];
            const existingKeys = new Set(allCats.map(normalizeCategoryKey));
            for (const ex of currentExcluded) {
                const k = normalizeCategoryKey(ex);
                if (k && !existingKeys.has(k)) {
                    displayCats.push(ex);
                    existingKeys.add(k);
                }
            }

            if (!displayCats.length) {
                chipsHost.innerHTML = `<div class="ass-hint">右側にセットを呼び出すと、セット内のカテゴリ名（品質・キャラ・衣装など）がここに並びます。</div>`;
                return;
            }

            chipsHost.innerHTML = "";
            for (const cat of displayCats) {
                const key = normalizeCategoryKey(cat);
                const isExcluded = excludedKeys.has(key);
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = `ass-exclude-chip ${isExcluded ? "is-excluded" : ""}`;
                btn.innerHTML = `<span class="ass-exclude-mark">${isExcluded ? "🙈" : "👁️"}</span><span>${escapeHtml(cat)}</span>`;
                btn.title = isExcluded
                    ? `「${cat}」は各セットから隠れています（クリックで再表示）`
                    : `クリックすると全セットから「${cat}」を隠して除外します`;
                btn.onclick = () => {
                    if (isExcluded) {
                        this.state.excluded_categories = (this.state.excluded_categories || []).filter(
                            (c) => normalizeCategoryKey(c) !== key,
                        );
                    } else {
                        this.state.excluded_categories = [...(this.state.excluded_categories || []), cat];
                    }
                    this.scheduleSaveState();
                    renderExcludeChips();
                    renderSelectedSets();
                };
                chipsHost.appendChild(btn);
            }
        };

        mainEl.querySelector("[data-auto-hide-common]").onclick = () => {
            const commonLabels = (this.state.common_prompt_boxes || [])
                .filter((b) => !b.disabled && String(b.label || "").trim() && String(b.text || "").trim())
                .map((b) => String(b.label).trim());
            const setCatMap = new Map(
                collectCategoriesFromSets(this.state.selected_sets || []).map((c) => [normalizeCategoryKey(c), c]),
            );
            const matched = [];
            for (const label of commonLabels) {
                const key = normalizeCategoryKey(label);
                if (setCatMap.has(key)) matched.push(setCatMap.get(key));
            }
            if (!matched.length) {
                this.notify("共通プロンプト（入力済み）と一致するカテゴリがセット内にありませんでした", "warn");
                return;
            }
            const existing = new Set((this.state.excluded_categories || []).map(normalizeCategoryKey));
            for (const m of matched) {
                if (!existing.has(normalizeCategoryKey(m))) {
                    this.state.excluded_categories.push(m);
                    existing.add(normalizeCategoryKey(m));
                }
            }
            this.scheduleSaveState();
            renderExcludeChips();
            renderSelectedSets();
            this.notify(`カテゴリを非表示にしました: ${matched.join(", ")}`, "success");
        };

        // 4. Settings
        renderGenerationSettings(mainEl.querySelector("[data-settings-slot]"), {
            negativePrompt: this.state.negative_prompt || "",
            settings: this.state.settings || {},
            runtimeOptions: this.options || {},
            onNegativeChange: (val) => {
                this.state.negative_prompt = val;
                this.scheduleSaveState();
            },
            onSettingsChange: (nextSettings) => {
                const countChanged =
                    Number(this.state.settings?.images_per_set) !== Number(nextSettings.images_per_set);
                const resolutionChanged =
                    Number(this.state.settings?.base_resolution) !== Number(nextSettings.base_resolution) ||
                    String(this.state.settings?.default_aspect_ratio || "") !== String(nextSettings.default_aspect_ratio || "");
                this.state.settings = nextSettings;
                this.scheduleSaveState();
                this.updateFooterSummary();
                if (countChanged) {
                    mainEl.querySelectorAll("[data-count]").forEach((input) => {
                        input.placeholder = String(nextSettings.images_per_set || 1);
                    });
                }
                if (resolutionChanged) {
                    renderSelectedSets();
                }
            },
        });

        // 5. Selected Sets List
        const renderSelectedSets = () => {
            const listHost = mainEl.querySelector("[data-selected-list]");
            const selected = this.state.selected_sets || [];
            const clearBtn = mainEl.querySelector("[data-clear-sets]");
            if (clearBtn) clearBtn.disabled = selected.length === 0;
            const reorderBtn = mainEl.querySelector("[data-reorder-sets]");
            if (reorderBtn) reorderBtn.disabled = selected.length < 2;

            if (!selected.length) {
                listHost.innerHTML = `
                    <div class="ass-empty-stage">
                        <div class="ass-empty-stage-icon">📚</div>
                        <p>まだセットが呼び出されていません。</p>
                        <p class="ass-hint">右上の「+ セットを呼び出す」から、イラスト集に使うセットを複数追加してください。<br/>（セットがまだ無い場合は上部の「🧩 セット管理」タブから作成できます）</p>
                        <div class="ass-empty-stage-actions">
                            <button type="button" class="ass-btn-primary" data-empty-pick>+ セットを呼び出す</button>
                            <button type="button" class="ass-btn-secondary" data-empty-goto-sets>🧩 セットを新規作成</button>
                        </div>
                    </div>
                `;
                listHost.querySelector("[data-empty-pick]").onclick = () => this.openSetPickerModal(() => {
                    renderExcludeChips();
                    renderSelectedSets();
                });
                listHost.querySelector("[data-empty-goto-sets]").onclick = () => {
                    this.startNewSet();
                    this.activeTab = "sets";
                    this.render();
                };
                this.updateFooterSummary();
                return;
            }

            listHost.innerHTML = "";
            selected.forEach((item, idx) => {
                const card = createSelectedSetCard(item, {
                    index: idx,
                    total: selected.length,
                    defaultImagesPerSet: this.state.settings?.images_per_set || 1,
                    baseResolution: normalizeBaseResolution(this.state.settings?.base_resolution ?? DEFAULT_BASE_RESOLUTION),
                    defaultAspectRatio: normalizeAspectRatio(this.state.settings?.default_aspect_ratio, false) || DEFAULT_ASPECT_RATIO,
                    commonCategories: collectCommonCategoryNames(this.state.common_prompt_boxes || []),
                    excludedCategories: this.state.excluded_categories || [],
                    availableLoras: this.options.loras || [],
                    collapsed: this.collapsedCards.has(item.instance_id),
                    onToggleCollapse: (instId) => {
                        if (this.collapsedCards.has(instId)) this.collapsedCards.delete(instId);
                        else this.collapsedCards.add(instId);
                        renderSelectedSets();
                    },
                    onChange: () => {
                        this.scheduleSaveState();
                        renderExcludeChips();
                        this.updateFooterSummary();
                    },
                    onMove: (fromIdx, delta) => {
                        const toIdx = fromIdx + delta;
                        if (toIdx < 0 || toIdx >= selected.length) return;
                        const beforeCard = listHost.children[fromIdx] || null;
                        const beforeTop = beforeCard ? beforeCard.getBoundingClientRect().top : null;
                        const scrollHost =
                            [mainEl.querySelector(".ass-pane-sets"), mainEl, listHost.parentElement].find(
                                (el) => el && el.scrollHeight > el.clientHeight + 2,
                            ) || mainEl.querySelector(".ass-pane-sets");

                        const [moved] = selected.splice(fromIdx, 1);
                        selected.splice(toIdx, 0, moved);
                        this.scheduleSaveState();
                        renderSelectedSets();

                        const afterCard = listHost.children[toIdx] || null;
                        if (afterCard) {
                            if (scrollHost && beforeTop !== null) {
                                const afterTop = afterCard.getBoundingClientRect().top;
                                scrollHost.scrollTop += Math.round(afterTop - beforeTop);
                            }
                            const hostRect = scrollHost?.getBoundingClientRect();
                            const cardRect = afterCard.getBoundingClientRect();
                            if (
                                !hostRect ||
                                cardRect.top < hostRect.top ||
                                cardRect.top > hostRect.bottom - 48
                            ) {
                                afterCard.scrollIntoView({ block: "nearest" });
                            }
                            const sameDirBtn = afterCard.querySelector(
                                delta < 0 ? "[data-move-up]" : "[data-move-down]",
                            );
                            if (sameDirBtn && !sameDirBtn.disabled) {
                                sameDirBtn.focus({ preventScroll: true });
                            }
                            afterCard.classList.add("is-just-moved");
                            setTimeout(() => afterCard.classList.remove("is-just-moved"), 520);
                        }
                    },
                    onRemove: (removeIdx) => {
                        selected.splice(removeIdx, 1);
                        this.scheduleSaveState();
                        renderExcludeChips();
                        renderSelectedSets();
                    },
                    onSaveOverwrite: async (targetItem) => {
                        if (!targetItem.source_set_id) return;
                        if (!confirm(`元のセット「${targetItem.name}」を現在の編集内容で上書き保存しますか？`)) return;
                        try {
                            const saved = await saveSet({
                                id: targetItem.source_set_id,
                                name: targetItem.name,
                                thumbnail: targetItem.thumbnail || "",
                                aspect_ratio: targetItem.aspect_ratio || "",
                                disabled_common_categories: targetItem.disabled_common_categories || [],
                                separator: targetItem.separator,
                                loras: targetItem.loras,
                                prompt_boxes: targetItem.prompt_boxes,
                            });
                            await this.refreshSetsList();
                            this.notify(`セット「${saved.name}」を上書き保存しました`, "success");
                        } catch (err) {
                            this.notify(`保存失敗: ${err.message}`, "error");
                        }
                    },
                    onSaveAsNew: async (targetItem) => {
                        const newName = prompt("新しいセット名を入力してください:", `${targetItem.name} (アレンジ)`);
                        if (!newName || !newName.trim()) return;
                        try {
                            const saved = await saveSet({
                                name: newName.trim(),
                                thumbnail: targetItem.thumbnail || "",
                                aspect_ratio: targetItem.aspect_ratio || "",
                                disabled_common_categories: targetItem.disabled_common_categories || [],
                                separator: targetItem.separator,
                                loras: targetItem.loras,
                                prompt_boxes: targetItem.prompt_boxes,
                            });
                            targetItem.source_set_id = saved.id;
                            targetItem.name = saved.name;
                            await this.refreshSetsList();
                            this.scheduleSaveState();
                            renderSelectedSets();
                            this.notify(`新セット「${saved.name}」として保存しました`, "success");
                        } catch (err) {
                            this.notify(`保存失敗: ${err.message}`, "error");
                        }
                    },
                    onNotify: (msg, sev) => this.notify(msg, sev),
                });
                listHost.appendChild(card);
            });
            this.updateFooterSummary();
        };

        mainEl.querySelector("[data-add-set]").onclick = () => {
            this.openSetPickerModal(() => {
                renderExcludeChips();
                renderSelectedSets();
            });
        };

        mainEl.querySelector("[data-reorder-sets]").onclick = () => {
            this.openSetReorderModal(() => {
                renderSelectedSets();
            });
        };

        mainEl.querySelector("[data-clear-sets]").onclick = () => {
            if (!confirm("呼び出し済みのセットをすべてクリアしますか？（保存済みの元セットは消えません）")) return;
            this.state.selected_sets = [];
            this.scheduleSaveState();
            renderExcludeChips();
            renderSelectedSets();
        };

        footerEl.querySelector("[data-run-btn]").onclick = () => void this.executeBatch();

        renderExcludeChips();
        renderSelectedSets();
    }

    openSetReorderModal(onApplied) {
        const current = this.state?.selected_sets || [];
        if (current.length < 2) {
            this.notify("並び替えるには2件以上のセットを呼び出してください", "info");
            return;
        }
        const existing = document.getElementById("ass-set-reorder-modal");
        if (existing) existing.remove();

        const initialOrder = [...current];
        let draftOrder = [...current];
        const baseRes = normalizeBaseResolution(this.state?.settings?.base_resolution ?? DEFAULT_BASE_RESOLUTION);
        const defRatio = normalizeAspectRatio(this.state?.settings?.default_aspect_ratio, false) || DEFAULT_ASPECT_RATIO;
        const defaultCount = Number(this.state?.settings?.images_per_set) || 1;

        const overlay = document.createElement("div");
        overlay.id = "ass-set-reorder-modal";
        overlay.className = "ass-submodal-overlay";
        overlay.innerHTML = `
            <div class="ass-submodal ass-submodal-reorder">
                <div class="ass-submodal-header">
                    <h3>⇅ 呼び出したセットの並び替え（全 ${draftOrder.length} 件）</h3>
                    <button type="button" class="ass-icon-btn" data-close title="閉じる">✕</button>
                </div>
                <div class="ass-submodal-body">
                    <div class="ass-reorder-toolbar">
                        <span class="ass-hint">行をドラッグ＆ドロップ、または右の ⤒ ↑ ↓ ⤓ ボタンで生成順を変更できます。</span>
                        <div class="ass-toolbar-btns">
                            <button type="button" class="ass-btn-xs" data-reverse title="順番を上下反転">↕ 逆順</button>
                            <button type="button" class="ass-btn-xs" data-reset title="開く前の順番に戻す">↺ 元に戻す</button>
                        </div>
                    </div>
                    <div class="ass-reorder-list" data-reorder-list></div>
                </div>
                <div class="ass-submodal-footer">
                    <span class="ass-muted">上から順にキュー投入されます</span>
                    <div class="ass-toolbar-btns">
                        <button type="button" class="ass-btn-secondary" data-close>キャンセル</button>
                        <button type="button" class="ass-btn-primary" data-apply>✓ この順番を適用</button>
                    </div>
                </div>
            </div>
        `;

        const listEl = overlay.querySelector("[data-reorder-list]");
        let dragIdx = null;

        const clearDropMarks = () => {
            listEl.querySelectorAll(".ass-reorder-item").forEach((el) => {
                el.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
            });
        };

        const moveItem = (fromIdx, toIdx, { followScroll = false } = {}) => {
            if (fromIdx === toIdx || fromIdx < 0 || fromIdx >= draftOrder.length) return;
            const boundedTo = Math.max(0, Math.min(draftOrder.length - 1, toIdx));
            const beforeRow = followScroll ? listEl.children[fromIdx] || null : null;
            const beforeTop = beforeRow ? beforeRow.getBoundingClientRect().top : null;
            const [moved] = draftOrder.splice(fromIdx, 1);
            draftOrder.splice(boundedTo, 0, moved);
            renderList();
            if (followScroll) {
                const afterRow = listEl.children[boundedTo] || null;
                if (afterRow) {
                    if (beforeTop !== null) {
                        const afterTop = afterRow.getBoundingClientRect().top;
                        listEl.scrollTop += Math.round(afterTop - beforeTop);
                    }
                    afterRow.scrollIntoView({ block: "nearest" });
                }
            }
        };

        const renderList = () => {
            listEl.innerHTML = "";
            draftOrder.forEach((item, idx) => {
                const thumbUrl = getSetThumbnailUrl(item.thumbnail);
                const enabled = item.enabled !== false;
                const count = Number(item.images_count) > 0 ? Number(item.images_count) : defaultCount;
                const loraCount = (item.loras || []).filter((l) => l.enabled !== false).length;
                const ratioBadge = formatSetResolutionBadge(baseRes, item.aspect_ratio, defRatio);

                const row = document.createElement("div");
                row.className = `ass-reorder-item ${enabled ? "" : "is-muted"}`;
                row.draggable = true;
                row.dataset.index = String(idx);
                row.innerHTML = `
                    <span class="ass-reorder-handle" title="ドラッグして移動">⋮⋮</span>
                    <span class="ass-reorder-index">#${idx + 1}</span>
                    <div class="ass-set-thumb-box ass-set-thumb-reorder ${thumbUrl ? "has-image" : ""}">
                        ${thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" />` : `<span>🖼️</span>`}
                    </div>
                    <div class="ass-reorder-info">
                        <div class="ass-reorder-name">
                            <strong>${escapeHtml(item.name || "無題セット")}</strong>
                            ${enabled ? "" : '<span class="ass-badge-common-off">OFF</span>'}
                        </div>
                        <div class="ass-reorder-meta">
                            <span class="ass-badge-ratio">${escapeHtml(ratioBadge)}</span>
                            <span class="ass-badge-soft">LoRA ${loraCount}</span>
                            <span class="ass-badge-soft">${count}枚</span>
                        </div>
                    </div>
                    <div class="ass-reorder-btns">
                        <button type="button" class="ass-btn-xs" data-top ${idx === 0 ? "disabled" : ""} title="先頭へ">⤒</button>
                        <button type="button" class="ass-btn-xs" data-up ${idx === 0 ? "disabled" : ""} title="1つ上へ">↑</button>
                        <button type="button" class="ass-btn-xs" data-down ${idx === draftOrder.length - 1 ? "disabled" : ""} title="1つ下へ">↓</button>
                        <button type="button" class="ass-btn-xs" data-bottom ${idx === draftOrder.length - 1 ? "disabled" : ""} title="末尾へ">⤓</button>
                    </div>
                `;

                row.querySelector("[data-top]").onclick = (e) => {
                    e.stopPropagation();
                    moveItem(idx, 0, { followScroll: true });
                };
                row.querySelector("[data-up]").onclick = (e) => {
                    e.stopPropagation();
                    moveItem(idx, idx - 1, { followScroll: true });
                };
                row.querySelector("[data-down]").onclick = (e) => {
                    e.stopPropagation();
                    moveItem(idx, idx + 1, { followScroll: true });
                };
                row.querySelector("[data-bottom]").onclick = (e) => {
                    e.stopPropagation();
                    moveItem(idx, draftOrder.length - 1, { followScroll: true });
                };

                row.addEventListener("dragstart", (e) => {
                    dragIdx = idx;
                    row.classList.add("is-dragging");
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(idx));
                });
                row.addEventListener("dragover", (e) => {
                    if (dragIdx === null || dragIdx === idx) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const rect = row.getBoundingClientRect();
                    const isBefore = e.clientY < rect.top + rect.height / 2;
                    listEl.querySelectorAll(".ass-reorder-item").forEach((el) => {
                        el.classList.remove("is-drop-before", "is-drop-after");
                    });
                    row.classList.add(isBefore ? "is-drop-before" : "is-drop-after");
                });
                row.addEventListener("drop", (e) => {
                    if (dragIdx === null) return;
                    e.preventDefault();
                    const rect = row.getBoundingClientRect();
                    const isBefore = e.clientY < rect.top + rect.height / 2;
                    let targetIdx = isBefore ? idx : idx + 1;
                    if (dragIdx < targetIdx) targetIdx -= 1;
                    const from = dragIdx;
                    dragIdx = null;
                    clearDropMarks();
                    if (from !== targetIdx) {
                        moveItem(from, targetIdx);
                    }
                });
                row.addEventListener("dragend", () => {
                    dragIdx = null;
                    clearDropMarks();
                });

                listEl.appendChild(row);
            });
        };

        overlay.querySelector("[data-reverse]").onclick = () => {
            draftOrder.reverse();
            renderList();
        };
        overlay.querySelector("[data-reset]").onclick = () => {
            draftOrder = [...initialOrder];
            renderList();
        };
        overlay.querySelector("[data-apply]").onclick = () => {
            this.state.selected_sets = [...draftOrder];
            this.scheduleSaveState();
            overlay.remove();
            onApplied();
            this.notify("セットの並び順を更新しました", "success");
        };

        const close = () => overlay.remove();
        overlay.querySelectorAll("[data-close]").forEach((btn) => (btn.onclick = close));

        renderList();
        document.body.appendChild(overlay);
    }

    openSetPickerModal(onAdded) {
        const existing = document.getElementById("ass-set-picker-modal");
        if (existing) existing.remove();

        const overlay = document.createElement("div");
        overlay.id = "ass-set-picker-modal";
        overlay.className = "ass-submodal-overlay";
        overlay.innerHTML = `
            <div class="ass-submodal ass-submodal-lg">
                <div class="ass-submodal-header">
                    <h3>📚 呼び出すセットを選択（複数選択可）</h3>
                    <button type="button" class="ass-icon-btn" data-close>✕</button>
                </div>
                <div class="ass-submodal-body">
                    <div class="ass-inline-row">
                        <input type="text" class="ass-input" data-search placeholder="セット名やカテゴリで検索..." />
                        <button type="button" class="ass-btn-xs" data-select-all>表示中を全選択</button>
                    </div>
                    <div class="ass-picker-grid" data-grid></div>
                </div>
                <div class="ass-submodal-footer">
                    <span class="ass-muted" data-picked-count>0 件選択中</span>
                    <div class="ass-toolbar-btns">
                        <button type="button" class="ass-btn-secondary" data-close>キャンセル</button>
                        <button type="button" class="ass-btn-primary" data-confirm disabled>選択したセットを追加</button>
                    </div>
                </div>
            </div>
        `;

        const gridEl = overlay.querySelector("[data-grid]");
        const searchEl = overlay.querySelector("[data-search]");
        const countEl = overlay.querySelector("[data-picked-count]");
        const confirmBtn = overlay.querySelector("[data-confirm]");
        const pickedIds = [];

        const updateCount = () => {
            countEl.textContent = `${pickedIds.length} 件選択中`;
            confirmBtn.disabled = pickedIds.length === 0;
        };

        const filteredSets = (q) => {
            const needle = q.trim().toLowerCase();
            return this.sets.filter((s) => {
                if (!needle) return true;
                if ((s.name || "").toLowerCase().includes(needle)) return true;
                return (s.prompt_boxes || []).some((b) => (b.label || "").toLowerCase().includes(needle));
            });
        };

        const renderGrid = () => {
            const items = filteredSets(searchEl.value);
            if (!items.length) {
                gridEl.innerHTML = `<div class="ass-empty-inline">保存済みのセットがありません。「🧩 セット管理」タブから先に作成してください。</div>`;
                return;
            }
            gridEl.innerHTML = "";
            for (const setItem of items) {
                const isPicked = pickedIds.includes(setItem.id);
                const cats = (setItem.prompt_boxes || [])
                    .map((b) => String(b.label || "").trim())
                    .filter(Boolean);
                const loraCount = (setItem.loras || []).filter((l) => l.enabled !== false).length;

                const thumbUrl = getSetThumbnailUrl(setItem.thumbnail);
                const card = document.createElement("button");
                card.type = "button";
                card.className = `ass-picker-card ${isPicked ? "is-picked" : ""}`;
                card.innerHTML = `
                    <div class="ass-picker-card-row">
                        <div class="ass-set-thumb-box ass-set-thumb-sm ${thumbUrl ? "has-image" : ""}">
                            ${thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" />` : `<span>🖼️</span>`}
                        </div>
                        <div class="ass-picker-card-content">
                            <div class="ass-picker-card-top">
                                <strong>${escapeHtml(setItem.name)}</strong>
                                <span class="ass-badge-group">
                                    ${setItem.aspect_ratio ? `<span class="ass-badge-ratio">📐 ${escapeHtml(setItem.aspect_ratio)}</span>` : ""}
                                    ${formatDisabledCommonSummary(setItem.disabled_common_categories) ? `<span class="ass-badge-common-off">${escapeHtml(formatDisabledCommonSummary(setItem.disabled_common_categories))}</span>` : ""}
                                    <span class="ass-badge-soft">LoRA ${loraCount}</span>
                                </span>
                            </div>
                            <div class="ass-picker-cats">${cats.length ? cats.map((c) => `<span>${escapeHtml(c)}</span>`).join("") : '<span class="ass-muted">カテゴリ名なし</span>'}</div>
                        </div>
                    </div>
                `;
                card.onclick = () => {
                    const pos = pickedIds.indexOf(setItem.id);
                    if (pos >= 0) pickedIds.splice(pos, 1);
                    else pickedIds.push(setItem.id);
                    card.classList.toggle("is-picked", pickedIds.includes(setItem.id));
                    updateCount();
                };
                gridEl.appendChild(card);
            }
        };

        overlay.querySelector("[data-select-all]").onclick = () => {
            for (const s of filteredSets(searchEl.value)) {
                if (!pickedIds.includes(s.id)) pickedIds.push(s.id);
            }
            renderGrid();
            updateCount();
        };

        confirmBtn.onclick = () => {
            const byId = new Map(this.sets.map((s) => [s.id, s]));
            let added = 0;
            for (const id of pickedIds) {
                const rec = byId.get(id);
                if (rec) {
                    this.state.selected_sets.push(makeInstanceFromSet(rec));
                    added += 1;
                }
            }
            this.scheduleSaveState();
            overlay.remove();
            onAdded();
            if (added) this.notify(`${added}件のセットを追加しました`, "success");
        };

        const close = () => overlay.remove();
        overlay.querySelectorAll("[data-close]").forEach((btn) => (btn.onclick = close));
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) close();
        });
        searchEl.addEventListener("input", renderGrid);
        searchEl.addEventListener("keydown", (e) => e.stopPropagation());

        renderGrid();
        updateCount();
        document.body.appendChild(overlay);
        searchEl.focus();
    }

    async executeBatch() {
        if (this.isExecuting) return;
        const { activeSets, totalImages } = this.computeBatchStats();
        if (!activeSets) {
            this.notify("実行対象のセットが選択されていません", "warn");
            return;
        }

        const runBtn = this.overlay?.querySelector("[data-run-btn]");
        const progressEl = this.overlay?.querySelector("[data-footer-progress]");
        this.isExecuting = true;
        if (runBtn) {
            runBtn.disabled = true;
            runBtn.textContent = "ジョブ構築中...";
        }

        try {
            // Save latest workspace state first
            await saveState(this.state);

            const built = await buildBatchJobs({
                common_prompt_boxes: this.state.common_prompt_boxes,
                common_separator: this.state.common_separator,
                common_loras: this.state.common_loras,
                negative_prompt: this.state.negative_prompt,
                excluded_categories: this.state.excluded_categories,
                settings: this.state.settings,
                selected_sets: this.state.selected_sets,
                tz_offset_minutes: -new Date().getTimezoneOffset(),
            });

            const jobs = built.jobs || [];
            let queued = 0;
            for (const job of jobs) {
                queued += 1;
                if (progressEl) {
                    progressEl.textContent = `キュー投入中 (${queued} / ${jobs.length}): ${job.set_name}`;
                }
                if (runBtn) {
                    runBtn.textContent = `投入中 ${queued} / ${jobs.length}...`;
                }
                await queueComfyPrompt(job.prompt, job.extra_pnginfo);
            }

            if (progressEl) {
                progressEl.textContent = `✅ 全 ${jobs.length} 枚を ComfyUI キューに投入しました`;
            }
            this.notify(`全 ${jobs.length} 枚（${activeSets}セット分）の生成をComfyUIキューに投入しました！`, "success");
        } catch (err) {
            if (progressEl) {
                progressEl.textContent = `❌ エラー: ${err.message}`;
            }
            this.notify(`実行エラー: ${err.message}`, "error");
        } finally {
            this.isExecuting = false;
            this.updateFooterSummary();
        }
    }

    startNewSet(withTemplate = false) {
        this.lastImportInfo = null;
        this.lastThumbMeta = null;
        this.editingSet = {
            id: "",
            name: "",
            thumbnail: "",
            aspect_ratio: "",
            disabled_common_categories: [],
            separator: ", ",
            loras: [],
            prompt_boxes: withTemplate
                ? DEFAULT_TEMPLATE_CATEGORIES.map((label) => createPromptBox({ label, text: "" }))
                : [createPromptBox({ label: "品質" }), createPromptBox({ label: "衣装" })],
        };
    }

    async uploadThumbnailIntoEditor(file) {
        if (!file || this.isUploadingThumb) return;
        const lowerName = String(file.name || "").toLowerCase();
        const isSupported =
            String(file.type || "").startsWith("image/") ||
            /\.(png|webp|jpe?g|gif|bmp)$/i.test(lowerName);
        if (!isSupported) {
            this.notify("画像ファイル（PNG / WebP / JPEG）を選択してください", "warn");
            return;
        }

        this.isUploadingThumb = true;
        this.render();
        try {
            const uploaded = await uploadSetThumbnail(file);
            if (!this.editingSet) this.startNewSet(false);
            this.editingSet.thumbnail = uploaded.thumbnail;
            this.lastThumbMeta = uploaded;
            const kb = Math.max(1, Math.round((uploaded.size_bytes || 0) / 1024));
            const dims = uploaded.width && uploaded.height ? ` / ${uploaded.width}×${uploaded.height}` : "";
            const fmt = String(uploaded.format || "webp").toUpperCase();
            this.notify(`軽量サムネイルを設定しました (${fmt} 約${kb}KB${dims}) — 「💾 セットを保存」で確定`, "success");
        } catch (err) {
            this.notify(`サムネイル登録失敗: ${err.message}`, "error");
        } finally {
            this.isUploadingThumb = false;
            this.render();
        }
    }

    async importImageIntoEditor(file, { asNew = false } = {}) {
        if (!file || this.isImportingImage) return;
        const lowerName = String(file.name || "").toLowerCase();
        const isSupported =
            String(file.type || "").startsWith("image/") ||
            /\.(png|webp|jpe?g)$/i.test(lowerName);
        if (!isSupported) {
            this.notify("PNG / WebP / JPEG 画像ファイルを選択してください", "warn");
            return;
        }

        this.isImportingImage = true;
        this.render();
        try {
            const imported = await importSetFromImage(file);
            const boxes = Array.isArray(imported.prompt_boxes) && imported.prompt_boxes.length
                ? deepClone(imported.prompt_boxes)
                : [createPromptBox({ label: "プロンプト" })];
            const rawBoxes = Array.isArray(imported.raw_prompt_boxes) && imported.raw_prompt_boxes.length
                ? deepClone(imported.raw_prompt_boxes)
                : deepClone(boxes);
            const loras = Array.isArray(imported.loras) ? deepClone(imported.loras) : [];
            const separator = imported.separator ?? ", ";

            let autoThumb = null;
            const shouldAutoThumb = asNew || !this.editingSet?.thumbnail;
            if (shouldAutoThumb) {
                try {
                    autoThumb = await uploadSetThumbnail(file);
                } catch (_) {
                    autoThumb = null;
                }
            }

            const detectedRatio = normalizeAspectRatio(imported.aspect_ratio, true);
            if (asNew || !this.editingSet) {
                this.editingSet = {
                    id: "",
                    name: imported.suggested_name || "画像から読込セット",
                    thumbnail: autoThumb?.thumbnail || "",
                    aspect_ratio: detectedRatio,
                    disabled_common_categories: [],
                    separator,
                    loras,
                    prompt_boxes: boxes,
                };
                this.lastThumbMeta = autoThumb;
            } else {
                if (!String(this.editingSet.name || "").trim()) {
                    this.editingSet.name = imported.suggested_name || "画像から読込セット";
                }
                if (autoThumb?.thumbnail) {
                    this.editingSet.thumbnail = autoThumb.thumbnail;
                    this.lastThumbMeta = autoThumb;
                }
                if (detectedRatio && !this.editingSet.aspect_ratio) {
                    this.editingSet.aspect_ratio = detectedRatio;
                }
                this.editingSet.separator = separator;
                this.editingSet.loras = loras;
                this.editingSet.prompt_boxes = boxes;
            }

            this.lastImportInfo = {
                filename: file.name || "image",
                source_type: imported.source_type || "",
                source_label: imported.source_label || "画像メタデータ",
                auto_categorized: Boolean(imported.auto_categorized),
                mode: imported.auto_categorized ? "auto" : "raw",
                auto_boxes: deepClone(boxes),
                raw_boxes: deepClone(rawBoxes),
                lora_count: loras.length,
                box_count: boxes.length,
                warnings: Array.isArray(imported.warnings) ? [...imported.warnings] : [],
            };

            this.notify(
                `画像から読み込みました（LoRA ${loras.length}件 / プロンプト ${boxes.length}枠）— 確認後に「💾 セットを保存」を押してください`,
                "success",
            );
            if (this.lastImportInfo.warnings.length) {
                this.notify(this.lastImportInfo.warnings[0], "warn");
            }
        } catch (err) {
            this.notify(`画像読み込み失敗: ${err.message}`, "error");
        } finally {
            this.isImportingImage = false;
            this.render();
        }
    }

    async refreshSetsList() {
        this.sets = await fetchSets();
        const tabBtn = this.overlay?.querySelector('[data-tab="sets"]');
        if (tabBtn) tabBtn.textContent = `🧩 セット管理 (${this.sets.length})`;
    }

    renderSetsTab(mainEl, footerEl) {
        if (!this.editingSet) {
            if (this.sets.length) this.editingSet = deepClone(this.sets[0]);
            else this.startNewSet(true);
        }

        const editingThumbUrl = getSetThumbnailUrl(this.editingSet.thumbnail);
        const thumbInfoText = this.lastThumbMeta && this.lastThumbMeta.thumbnail === this.editingSet.thumbnail
            ? `${String(this.lastThumbMeta.format || "webp").toUpperCase()} · 約${Math.max(1, Math.round((this.lastThumbMeta.size_bytes || 0) / 1024))}KB`
            : this.editingSet.thumbnail
                ? `${this.editingSet.thumbnail.split(".").pop().toUpperCase()} 軽量済`
                : "最大320px WebPに自動軽量化";

        const baseRes = normalizeBaseResolution(this.state?.settings?.base_resolution ?? DEFAULT_BASE_RESOLUTION);
        const defRatio = normalizeAspectRatio(this.state?.settings?.default_aspect_ratio, false) || DEFAULT_ASPECT_RATIO;
        const editRatio = normalizeAspectRatio(this.editingSet.aspect_ratio, true);
        const editIsCustomRatio = Boolean(editRatio) && !isPresetAspectRatio(editRatio);
        const [editCustomW, editCustomH] = editIsCustomRatio ? parseAspectRatioParts(editRatio) : [4, 5];
        const editRatioPreview = formatSetResolutionBadge(baseRes, editRatio, defRatio);

        mainEl.innerHTML = `
            <div class="ass-sets-layout">
                <aside class="ass-pane ass-pane-setlist">
                    <div class="ass-pane-toolbar">
                        <input type="text" class="ass-input" data-set-search placeholder="セットを検索..." value="${escapeHtml(this.setSearchQuery)}" />
                    </div>
                    <div class="ass-new-set-row">
                        <button type="button" class="ass-btn-primary-sm" data-new-set>+ 新規セット</button>
                        <button type="button" class="ass-btn-xs" data-new-template-set title="品質・体格・キャラ・衣装・ポーズ・背景の6枠入りで作成">+ 6カテゴリ雛形</button>
                        <button type="button" class="ass-btn-xs" data-new-from-image title="生成画像のメタデータから新規セットを作成" ${this.isImportingImage ? "disabled" : ""}>🖼️ 画像から新規</button>
                    </div>
                    <div class="ass-saved-sets-list" data-saved-list></div>
                </aside>

                <section class="ass-pane ass-pane-editor" data-editor-pane>
                    <input type="file" accept="image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg" data-import-file hidden />
                    <input type="file" accept="image/*" data-thumb-file hidden />

                    <div class="ass-editor-top">
                        <div class="ass-thumb-uploader ${editingThumbUrl ? "has-image" : ""} ${this.isUploadingThumb ? "is-busy" : ""}" data-thumb-dropzone title="クリックまたは画像ドロップでセットのサムネイルを設定（自動で320px以下の軽量WebPに変換されます）">
                            ${editingThumbUrl
                                ? `<img src="${escapeHtml(editingThumbUrl)}" alt="セットサムネイル" />`
                                : `<span class="ass-thumb-placeholder">${this.isUploadingThumb ? "⏳" : "📷"}</span>`}
                            ${editingThumbUrl ? `<button type="button" class="ass-thumb-clear" data-thumb-clear title="サムネイルを削除">✕</button>` : ""}
                        </div>
                        <div class="ass-field ass-grow">
                            <label class="ass-label">セット名</label>
                            <input type="text" class="ass-input ass-name-input" data-edit-name placeholder="例：制服衣装セット / カフェ背景セット" value="${escapeHtml(this.editingSet.name || "")}" />
                            <div class="ass-thumb-controls-row">
                                <button type="button" class="ass-btn-xs" data-thumb-pick ${this.isUploadingThumb ? "disabled" : ""}>
                                    ${this.isUploadingThumb ? "⏳ 軽量化中..." : editingThumbUrl ? "📷 サムネ変更" : "📷 サムネ画像アップ"}
                                </button>
                                <span class="ass-thumb-meta">${escapeHtml(thumbInfoText)}</span>
                            </div>
                            <div class="ass-ratio-editor-row">
                                <span class="ass-label-inline">アスペクト比</span>
                                <select class="ass-select ass-ratio-select-sm" data-edit-ratio-select>
                                    <option value="" ${!editRatio ? "selected" : ""}>共通設定のまま (${escapeHtml(defRatio)})</option>
                                    ${ASPECT_RATIO_PRESETS.map(
                                        (p) => `<option value="${p.value}" ${editRatio === p.value ? "selected" : ""}>${escapeHtml(p.label)}</option>`,
                                    ).join("")}
                                    <option value="__custom__" ${editIsCustomRatio ? "selected" : ""}>カスタム比率...</option>
                                </select>
                                <span class="ass-ratio-custom-wrap" data-edit-ratio-custom ${editIsCustomRatio ? "" : "hidden"}>
                                    <input type="number" class="ass-input ass-ratio-num" data-edit-ratio-w min="1" max="100" step="any" value="${escapeHtml(editCustomW)}" />
                                    <span class="ass-muted">:</span>
                                    <input type="number" class="ass-input ass-ratio-num" data-edit-ratio-h min="1" max="100" step="any" value="${escapeHtml(editCustomH)}" />
                                </span>
                                <span class="ass-badge-ratio" data-edit-ratio-preview title="イラスト集作成タブの現在の基準解像度 (${baseRes}px) での出力サイズ目安">${escapeHtml(editRatioPreview)}</span>
                            </div>
                        </div>
                        <div class="ass-editor-top-btns">
                            <button type="button" class="ass-btn-primary" data-save-set>💾 セットを保存</button>
                        </div>
                    </div>

                    <div class="ass-import-dropzone ${this.isImportingImage ? "is-busy" : ""}" data-import-dropzone>
                        <div class="ass-import-dropzone-main">
                            <span class="ass-import-icon">${this.isImportingImage ? "⏳" : "🖼️"}</span>
                            <div class="ass-import-text">
                                <strong>${this.isImportingImage ? "画像メタデータを解析中..." : "画像からカテゴリ別プロンプトとLoRAを読み込む"}</strong>
                                <span>PNG / WebP / JPEG をここにドラッグ＆ドロップ、または右のボタンから選択（ComfyUI / Anima-Tools / A1111 対応）</span>
                            </div>
                        </div>
                        <div class="ass-import-actions">
                            <label class="ass-import-mode-check" title="チェック時はドロップで新規セットを作成します（オフ時は現在編集中のセット欄へ上書き読込）">
                                <input type="checkbox" data-import-as-new ${this.importAsNewOnDrop ? "checked" : ""} />
                                <span>ドロップ時は新規</span>
                            </label>
                            <button type="button" class="ass-btn-xs" data-import-btn-new ${this.isImportingImage ? "disabled" : ""}>画像から新規</button>
                            <button type="button" class="ass-btn-xs" data-import-btn-current ${this.isImportingImage ? "disabled" : ""}>編集中へ読込</button>
                        </div>
                    </div>

                    ${this.lastImportInfo ? `
                        <div class="ass-import-banner" data-import-banner>
                            <div class="ass-import-banner-main">
                                <span class="ass-badge-soft">${escapeHtml(this.lastImportInfo.source_label)}</span>
                                <span class="ass-import-banner-summary">
                                    <strong>${escapeHtml(this.lastImportInfo.filename)}</strong> から読込済
                                    （LoRA ${this.lastImportInfo.lora_count}件 / プロンプト ${(this.editingSet.prompt_boxes || []).length}枠）
                                </span>
                                ${this.lastImportInfo.warnings.length ? `<span class="ass-import-warning">⚠️ ${escapeHtml(this.lastImportInfo.warnings.join(" / "))}</span>` : ""}
                            </div>
                            <div class="ass-import-banner-actions">
                                ${this.lastImportInfo.auto_categorized ? `
                                    <button type="button" class="ass-btn-xs" data-toggle-import-mode title="単一プロンプト画像の自動カテゴリ分けと1枠表示を切り替えます">
                                        ${this.lastImportInfo.mode === "auto" ? "📄 1枠のままにする" : "🏷️ 自動カテゴリ分けに戻す"}
                                    </button>
                                ` : ""}
                                <button type="button" class="ass-icon-btn" data-dismiss-import-banner title="閉じる">✕</button>
                            </div>
                        </div>
                    ` : ""}

                    <div class="ass-common-off-panel">
                        <div class="ass-common-off-header">
                            <span class="ass-section-title">このセットで無効にする共通プロンプトのカテゴリ</span>
                            <span class="ass-hint-inline">選択したカテゴリは、このセットを生成する時だけ「共通プロンプト」から除外されます（セット自身のプロンプトやイラスト集側の除外設定とは独立）</span>
                        </div>
                        <div class="ass-common-off-body">
                            <div class="ass-common-off-chips" data-edit-common-off-chips></div>
                            <div class="ass-common-off-add">
                                <input type="text" class="ass-input ass-common-off-input" data-edit-common-off-input placeholder="任意のカテゴリ名を追加..." />
                                <button type="button" class="ass-btn-xs" data-edit-common-off-add>+ 追加</button>
                            </div>
                        </div>
                    </div>

                    <div class="ass-editor-grid">
                        <div class="ass-section-block">
                            <div class="ass-section-title">LoRAリスト（Anima Multi LoRA Loader 互換）</div>
                            <div data-edit-loras></div>
                        </div>
                        <div class="ass-section-block">
                            <div class="ass-section-title">カテゴリ別プロンプト（Anima Prompt Plus 互換）</div>
                            <div data-edit-prompts></div>
                        </div>
                    </div>
                </section>
            </div>
        `;

        footerEl.innerHTML = `
            <div class="ass-footer-left">
                <span class="ass-hint">保存したセットは Google ドライブ（ComfyUI/user/anima_set_studio/sets/）に永続保存されます。</span>
            </div>
            <div class="ass-footer-right">
                <button type="button" class="ass-btn-secondary" data-goto-collection>📚 イラスト集作成タブへ →</button>
            </div>
        `;

        footerEl.querySelector("[data-goto-collection]").onclick = () => {
            this.activeTab = "collection";
            this.render();
        };

        const searchEl = mainEl.querySelector("[data-set-search]");
        searchEl.addEventListener("input", () => {
            this.setSearchQuery = searchEl.value;
            renderSavedList();
        });
        searchEl.addEventListener("keydown", (e) => e.stopPropagation());

        mainEl.querySelector("[data-new-set]").onclick = () => {
            this.startNewSet(false);
            this.render();
        };
        mainEl.querySelector("[data-new-template-set]").onclick = () => {
            this.startNewSet(true);
            this.render();
        };

        // Thumbnail upload controls & dedicated drag-and-drop
        const thumbFileInput = mainEl.querySelector("[data-thumb-file]");
        const thumbDropzone = mainEl.querySelector("[data-thumb-dropzone]");
        const openThumbPicker = () => {
            if (this.isUploadingThumb) return;
            thumbFileInput.value = "";
            thumbFileInput.click();
        };
        mainEl.querySelector("[data-thumb-pick]").onclick = openThumbPicker;
        thumbDropzone.onclick = (e) => {
            if (e.target.closest("[data-thumb-clear]")) return;
            openThumbPicker();
        };
        const thumbClearBtn = mainEl.querySelector("[data-thumb-clear]");
        if (thumbClearBtn) {
            thumbClearBtn.onclick = (e) => {
                e.stopPropagation();
                this.editingSet.thumbnail = "";
                this.lastThumbMeta = null;
                this.render();
            };
        }
        thumbFileInput.onchange = () => {
            const file = thumbFileInput.files?.[0];
            if (file) void this.uploadThumbnailIntoEditor(file);
        };
        thumbDropzone.addEventListener("dragenter", (e) => {
            if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
            e.preventDefault();
            e.stopPropagation();
            thumbDropzone.classList.add("is-dragover");
        });
        thumbDropzone.addEventListener("dragover", (e) => {
            if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            thumbDropzone.classList.add("is-dragover");
        });
        thumbDropzone.addEventListener("dragleave", (e) => {
            e.stopPropagation();
            thumbDropzone.classList.remove("is-dragover");
        });
        thumbDropzone.addEventListener("drop", (e) => {
            if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
            e.preventDefault();
            e.stopPropagation();
            thumbDropzone.classList.remove("is-dragover");
            const file = e.dataTransfer?.files?.[0];
            if (file) void this.uploadThumbnailIntoEditor(file);
        });

        // Image import controls & drag-and-drop
        const fileInput = mainEl.querySelector("[data-import-file]");
        const dropzone = mainEl.querySelector("[data-import-dropzone]");
        const editorPane = mainEl.querySelector("[data-editor-pane]");
        const asNewCheckbox = mainEl.querySelector("[data-import-as-new]");
        let pendingImportAsNew = this.importAsNewOnDrop;

        const openImagePicker = (asNew) => {
            pendingImportAsNew = Boolean(asNew);
            fileInput.value = "";
            fileInput.click();
        };

        asNewCheckbox.onchange = () => {
            this.importAsNewOnDrop = asNewCheckbox.checked;
        };
        mainEl.querySelector("[data-new-from-image]").onclick = () => openImagePicker(true);
        mainEl.querySelector("[data-import-btn-new]").onclick = (e) => {
            e.stopPropagation();
            openImagePicker(true);
        };
        mainEl.querySelector("[data-import-btn-current]").onclick = (e) => {
            e.stopPropagation();
            openImagePicker(false);
        };
        dropzone.onclick = (e) => {
            if (e.target.closest("button, label, input")) return;
            openImagePicker(this.importAsNewOnDrop);
        };

        fileInput.onchange = () => {
            const file = fileInput.files?.[0];
            if (file) {
                void this.importImageIntoEditor(file, { asNew: pendingImportAsNew });
            }
        };

        const hasDraggedFiles = (e) => {
            const types = e.dataTransfer?.types;
            if (!types) return false;
            return Array.from(types).includes("Files");
        };

        let dragDepth = 0;
        editorPane.addEventListener("dragenter", (e) => {
            if (!hasDraggedFiles(e)) return;
            e.preventDefault();
            dragDepth += 1;
            dropzone.classList.add("is-dragover");
        });
        editorPane.addEventListener("dragover", (e) => {
            if (!hasDraggedFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            dropzone.classList.add("is-dragover");
        });
        editorPane.addEventListener("dragleave", (e) => {
            if (!hasDraggedFiles(e)) return;
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) dropzone.classList.remove("is-dragover");
        });
        editorPane.addEventListener("drop", (e) => {
            if (!hasDraggedFiles(e)) return;
            e.preventDefault();
            dragDepth = 0;
            dropzone.classList.remove("is-dragover");
            const file = e.dataTransfer?.files?.[0];
            if (file) {
                void this.importImageIntoEditor(file, { asNew: this.importAsNewOnDrop });
            }
        });

        const toggleModeBtn = mainEl.querySelector("[data-toggle-import-mode]");
        if (toggleModeBtn && this.lastImportInfo) {
            toggleModeBtn.onclick = () => {
                if (this.lastImportInfo.mode === "auto") {
                    this.lastImportInfo.mode = "raw";
                    this.editingSet.prompt_boxes = deepClone(this.lastImportInfo.raw_boxes);
                } else {
                    this.lastImportInfo.mode = "auto";
                    this.editingSet.prompt_boxes = deepClone(this.lastImportInfo.auto_boxes);
                }
                this.render();
            };
        }
        const dismissBannerBtn = mainEl.querySelector("[data-dismiss-import-banner]");
        if (dismissBannerBtn) {
            dismissBannerBtn.onclick = () => {
                this.lastImportInfo = null;
                this.render();
            };
        }

        const nameInput = mainEl.querySelector("[data-edit-name]");
        nameInput.addEventListener("input", () => {
            this.editingSet.name = nameInput.value;
        });
        nameInput.addEventListener("keydown", (e) => e.stopPropagation());

        // Set aspect ratio editor controls
        const editRatioSelect = mainEl.querySelector("[data-edit-ratio-select]");
        const editRatioCustomWrap = mainEl.querySelector("[data-edit-ratio-custom]");
        const editRatioW = mainEl.querySelector("[data-edit-ratio-w]");
        const editRatioH = mainEl.querySelector("[data-edit-ratio-h]");
        const editRatioPreviewEl = mainEl.querySelector("[data-edit-ratio-preview]");

        const setEditingRatio = (nextVal) => {
            this.editingSet.aspect_ratio = normalizeAspectRatio(nextVal, true);
            if (editRatioPreviewEl) {
                editRatioPreviewEl.textContent = formatSetResolutionBadge(baseRes, this.editingSet.aspect_ratio, defRatio);
            }
        };
        const applyEditCustomRatio = () => {
            const norm = normalizeAspectRatio(`${editRatioW.value}:${editRatioH.value}`, true);
            if (norm) setEditingRatio(norm);
        };
        editRatioSelect.onchange = () => {
            const val = editRatioSelect.value;
            if (val === "__custom__") {
                editRatioCustomWrap.hidden = false;
                applyEditCustomRatio();
            } else {
                editRatioCustomWrap.hidden = true;
                setEditingRatio(val);
            }
        };
        for (const inp of [editRatioW, editRatioH]) {
            inp.addEventListener("input", applyEditCustomRatio);
            inp.addEventListener("keydown", (e) => e.stopPropagation());
        }

        // Disabled common prompt categories editor for this set
        if (!Array.isArray(this.editingSet.disabled_common_categories)) {
            this.editingSet.disabled_common_categories = [];
        }
        const editCommonOffHost = mainEl.querySelector("[data-edit-common-off-chips]");
        const editCommonOffInput = mainEl.querySelector("[data-edit-common-off-input]");
        const editCommonOffAddBtn = mainEl.querySelector("[data-edit-common-off-add]");

        const renderEditCommonOffChips = () => {
            const selectedKeys = new Set(
                (this.editingSet.disabled_common_categories || []).map(normalizeCategoryKey),
            );
            const candidates = [];
            const seen = new Set();
            const addCandidate = (raw) => {
                const clean = String(raw || "").trim();
                const key = normalizeCategoryKey(clean);
                if (clean && key && !seen.has(key)) {
                    seen.add(key);
                    candidates.push(clean);
                }
            };
            // Common prompt categories first, then already-selected, then standard & set categories
            for (const c of collectCommonCategoryNames(this.state?.common_prompt_boxes || [])) addCandidate(c);
            for (const c of this.editingSet.disabled_common_categories || []) addCandidate(c);
            for (const c of ["品質", "画師", "キャラ", "体格", "衣装", "ポーズ", "背景"]) addCandidate(c);
            for (const b of this.editingSet.prompt_boxes || []) addCandidate(b?.label);

            editCommonOffHost.innerHTML = "";
            for (const cat of candidates) {
                const key = normalizeCategoryKey(cat);
                const isOff = selectedKeys.has(key);
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = `ass-common-off-chip ${isOff ? "is-off" : ""}`;
                btn.innerHTML = `<span>${isOff ? "🚫" : "✓"}</span><span>${escapeHtml(cat)}</span>`;
                btn.title = isOff
                    ? `共通プロンプトの「${cat}」はこのセットでは無効です（クリックで解除）`
                    : `クリックするとこのセットでのみ共通プロンプトの「${cat}」を無効にします`;
                btn.onclick = () => {
                    if (isOff) {
                        this.editingSet.disabled_common_categories =
                            (this.editingSet.disabled_common_categories || []).filter(
                                (c) => normalizeCategoryKey(c) !== key,
                            );
                    } else {
                        this.editingSet.disabled_common_categories = [
                            ...(this.editingSet.disabled_common_categories || []),
                            cat,
                        ];
                    }
                    renderEditCommonOffChips();
                };
                editCommonOffHost.appendChild(btn);
            }
        };

        const addCustomDisabledCommonCategory = () => {
            const label = String(editCommonOffInput.value || "").trim();
            const key = normalizeCategoryKey(label);
            if (!label || !key) return;
            const existing = new Set((this.editingSet.disabled_common_categories || []).map(normalizeCategoryKey));
            if (!existing.has(key)) {
                this.editingSet.disabled_common_categories = [
                    ...(this.editingSet.disabled_common_categories || []),
                    label,
                ];
            }
            editCommonOffInput.value = "";
            renderEditCommonOffChips();
        };

        editCommonOffAddBtn.onclick = addCustomDisabledCommonCategory;
        editCommonOffInput.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                e.preventDefault();
                addCustomDisabledCommonCategory();
            }
        });
        renderEditCommonOffChips();

        mainEl.querySelector("[data-save-set]").onclick = async () => {
            const trimmed = String(this.editingSet.name || "").trim();
            if (!trimmed) {
                this.notify("セット名を入力してください", "warn");
                nameInput.focus();
                return;
            }
            try {
                const saved = await saveSet({
                    id: this.editingSet.id || undefined,
                    name: trimmed,
                    thumbnail: this.editingSet.thumbnail || "",
                    aspect_ratio: this.editingSet.aspect_ratio || "",
                    disabled_common_categories: this.editingSet.disabled_common_categories || [],
                    separator: this.editingSet.separator ?? ", ",
                    loras: this.editingSet.loras || [],
                    prompt_boxes: this.editingSet.prompt_boxes || [],
                });
                this.editingSet = deepClone(saved);
                // Keep thumbnails, aspect_ratio & disabled_common_categories in sync for matching called instances
                let syncedInstances = false;
                for (const inst of this.state?.selected_sets || []) {
                    if (inst.source_set_id === saved.id) {
                        inst.thumbnail = saved.thumbnail || "";
                        inst.aspect_ratio = saved.aspect_ratio || "";
                        inst.disabled_common_categories = deepClone(saved.disabled_common_categories || []);
                        syncedInstances = true;
                    }
                }
                if (syncedInstances) this.scheduleSaveState();
                await this.refreshSetsList();
                this.render();
                this.notify(`セット「${saved.name}」を保存しました`, "success");
            } catch (err) {
                this.notify(`保存エラー: ${err.message}`, "error");
            }
        };

        renderLoraListEditor(mainEl.querySelector("[data-edit-loras]"), {
            loras: this.editingSet.loras || [],
            availableLoras: this.options.loras || [],
            emptyTitle: "このセットにLoRAはまだありません",
            onChange: (nextLoras) => {
                this.editingSet.loras = nextLoras;
            },
            onNotify: (msg, sev) => this.notify(msg, sev),
        });

        renderPromptBoxesEditor(mainEl.querySelector("[data-edit-prompts]"), {
            boxes: this.editingSet.prompt_boxes || [],
            separator: this.editingSet.separator ?? ", ",
            showSeparator: true,
            onChange: ({ boxes, separator }) => {
                this.editingSet.prompt_boxes = boxes;
                this.editingSet.separator = separator;
            },
            onNotify: (msg, sev) => this.notify(msg, sev),
        });

        const renderSavedList = () => {
            const listHost = mainEl.querySelector("[data-saved-list]");
            const q = this.setSearchQuery.trim().toLowerCase();
            const visible = this.sets.filter((s) => !q || (s.name || "").toLowerCase().includes(q));

            if (!visible.length) {
                listHost.innerHTML = `<div class="ass-empty-inline">セットが見つかりません</div>`;
                return;
            }
            listHost.innerHTML = "";
            for (const setItem of visible) {
                const isSelected = this.editingSet?.id === setItem.id;
                const loraCount = (setItem.loras || []).filter((l) => l.enabled !== false).length;
                const cats = (setItem.prompt_boxes || [])
                    .map((b) => String(b.label || "").trim())
                    .filter(Boolean)
                    .slice(0, 6);

                const thumbUrl = getSetThumbnailUrl(setItem.thumbnail);
                const row = document.createElement("div");
                row.className = `ass-saved-item ${isSelected ? "is-selected" : ""}`;
                row.innerHTML = `
                    <div class="ass-saved-item-main" data-select>
                        <div class="ass-saved-item-row">
                            <div class="ass-set-thumb-box ass-set-thumb-xs ${thumbUrl ? "has-image" : ""}">
                                ${thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" />` : `<span>🖼️</span>`}
                            </div>
                            <div class="ass-saved-item-meta">
                                <div class="ass-saved-item-title">
                                    <strong>${escapeHtml(setItem.name)}</strong>
                                    <span class="ass-badge-group">
                                        ${setItem.aspect_ratio ? `<span class="ass-badge-ratio">📐 ${escapeHtml(setItem.aspect_ratio)}</span>` : ""}
                                        ${formatDisabledCommonSummary(setItem.disabled_common_categories) ? `<span class="ass-badge-common-off">${escapeHtml(formatDisabledCommonSummary(setItem.disabled_common_categories))}</span>` : ""}
                                        <span class="ass-badge-soft">LoRA ${loraCount}</span>
                                    </span>
                                </div>
                                <div class="ass-saved-item-cats">${cats.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>
                            </div>
                        </div>
                    </div>
                    <div class="ass-saved-item-actions">
                        <button type="button" class="ass-btn-xs" data-add-to-col title="イラスト集作成リストに追加">+ 集へ</button>
                        <button type="button" class="ass-btn-xs" data-dup title="複製">複製</button>
                        <button type="button" class="ass-btn-xs ass-btn-danger" data-del title="削除">削除</button>
                    </div>
                `;

                row.querySelector("[data-select]").onclick = () => {
                    this.lastImportInfo = null;
                    this.lastThumbMeta = null;
                    this.editingSet = deepClone(setItem);
                    this.render();
                };
                row.querySelector("[data-add-to-col]").onclick = () => {
                    this.state.selected_sets.push(makeInstanceFromSet(setItem));
                    this.scheduleSaveState();
                    this.notify(`「${setItem.name}」をイラスト集に追加しました`, "success");
                };
                row.querySelector("[data-dup]").onclick = async () => {
                    try {
                        const copied = await duplicateSet(setItem.id);
                        this.editingSet = deepClone(copied);
                        await this.refreshSetsList();
                        this.render();
                        this.notify(`「${copied.name}」を作成しました`, "success");
                    } catch (err) {
                        this.notify(`複製失敗: ${err.message}`, "error");
                    }
                };
                row.querySelector("[data-del]").onclick = async () => {
                    if (!confirm(`セット「${setItem.name}」を削除しますか？`)) return;
                    try {
                        await deleteSet(setItem.id);
                        if (this.editingSet?.id === setItem.id) this.editingSet = null;
                        await this.refreshSetsList();
                        this.render();
                        this.notify(`「${setItem.name}」を削除しました`, "info");
                    } catch (err) {
                        this.notify(`削除失敗: ${err.message}`, "error");
                    }
                };
                listHost.appendChild(row);
            }
        };

        renderSavedList();
    }
}
