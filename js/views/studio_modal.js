import {
    buildBatchJobs,
    deleteSet,
    duplicateSet,
    fetchOptions,
    fetchSets,
    fetchState,
    queueComfyPrompt,
    saveSet,
    saveState,
} from "../api.js";
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
        enabled: true,
        images_count: null,
        separator: setRecord.separator ?? ", ",
        loras: deepClone(setRecord.loras || []),
        prompt_boxes: deepClone(setRecord.prompt_boxes || [createPromptBox()]),
    };
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
        window.addEventListener("keydown", (e) => {
            if (!this.isOpen || e.key !== "Escape") return;
            // Only close if no Anima-Tools popup or submodal is open above us
            const topPopup = document.querySelector(
                ".anima-sel-overlay, .alm-overlay.show, .alm-selector-overlay.show, #ass-set-picker-modal, #ass-fallback-lora-modal, .ass-random-menu",
            );
            if (!topPopup) {
                e.stopPropagation();
                this.close();
            }
        });
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) this.close();
        });
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
        const w = this.state?.settings?.width || 832;
        const h = this.state?.settings?.height || 1216;
        summaryEl.textContent = `有効セット: ${activeSets}件 / 合計生成枚数: ${totalImages}枚 (${w}×${h})`;
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
                        <button type="button" class="ass-icon-btn" data-close title="閉じる (Esc)">✕</button>
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
        renderPromptBoxesEditor(mainEl.querySelector("[data-common-prompts]"), {
            boxes: this.state.common_prompt_boxes || [],
            separator: this.state.common_separator ?? ", ",
            showSeparator: false,
            onChange: ({ boxes, separator }) => {
                this.state.common_prompt_boxes = boxes;
                this.state.common_separator = separator;
                this.scheduleSaveState();
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
                this.state.settings = nextSettings;
                this.scheduleSaveState();
                this.updateFooterSummary();
                if (countChanged) {
                    mainEl.querySelectorAll("[data-count]").forEach((input) => {
                        input.placeholder = String(nextSettings.images_per_set || 1);
                    });
                }
            },
        });

        // 5. Selected Sets List
        const renderSelectedSets = () => {
            const listHost = mainEl.querySelector("[data-selected-list]");
            const selected = this.state.selected_sets || [];
            const clearBtn = mainEl.querySelector("[data-clear-sets]");
            if (clearBtn) clearBtn.disabled = selected.length === 0;

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
                        const [moved] = selected.splice(fromIdx, 1);
                        selected.splice(toIdx, 0, moved);
                        this.scheduleSaveState();
                        renderSelectedSets();
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

                const card = document.createElement("button");
                card.type = "button";
                card.className = `ass-picker-card ${isPicked ? "is-picked" : ""}`;
                card.innerHTML = `
                    <div class="ass-picker-card-top">
                        <strong>${escapeHtml(setItem.name)}</strong>
                        <span class="ass-badge-soft">LoRA ${loraCount}</span>
                    </div>
                    <div class="ass-picker-cats">${cats.length ? cats.map((c) => `<span>${escapeHtml(c)}</span>`).join("") : '<span class="ass-muted">カテゴリ名なし</span>'}</div>
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
        this.editingSet = {
            id: "",
            name: "",
            separator: ", ",
            loras: [],
            prompt_boxes: withTemplate
                ? DEFAULT_TEMPLATE_CATEGORIES.map((label) => createPromptBox({ label, text: "" }))
                : [createPromptBox({ label: "品質" }), createPromptBox({ label: "衣装" })],
        };
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

        mainEl.innerHTML = `
            <div class="ass-sets-layout">
                <aside class="ass-pane ass-pane-setlist">
                    <div class="ass-pane-toolbar">
                        <input type="text" class="ass-input" data-set-search placeholder="セットを検索..." value="${escapeHtml(this.setSearchQuery)}" />
                    </div>
                    <div class="ass-new-set-row">
                        <button type="button" class="ass-btn-primary-sm" data-new-set>+ 新規セット</button>
                        <button type="button" class="ass-btn-xs" data-new-template-set title="品質・体格・キャラ・衣装・ポーズ・背景の6枠入りで作成">+ 6カテゴリ雛形</button>
                    </div>
                    <div class="ass-saved-sets-list" data-saved-list></div>
                </aside>

                <section class="ass-pane ass-pane-editor">
                    <div class="ass-editor-top">
                        <div class="ass-field ass-grow">
                            <label class="ass-label">セット名</label>
                            <input type="text" class="ass-input ass-name-input" data-edit-name placeholder="例：制服衣装セット / カフェ背景セット" value="${escapeHtml(this.editingSet.name || "")}" />
                        </div>
                        <div class="ass-editor-top-btns">
                            <button type="button" class="ass-btn-primary" data-save-set>💾 セットを保存</button>
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

        const nameInput = mainEl.querySelector("[data-edit-name]");
        nameInput.addEventListener("input", () => {
            this.editingSet.name = nameInput.value;
        });
        nameInput.addEventListener("keydown", (e) => e.stopPropagation());

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
                    separator: this.editingSet.separator ?? ", ",
                    loras: this.editingSet.loras || [],
                    prompt_boxes: this.editingSet.prompt_boxes || [],
                });
                this.editingSet = deepClone(saved);
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

                const row = document.createElement("div");
                row.className = `ass-saved-item ${isSelected ? "is-selected" : ""}`;
                row.innerHTML = `
                    <div class="ass-saved-item-main" data-select>
                        <div class="ass-saved-item-title">
                            <strong>${escapeHtml(setItem.name)}</strong>
                            <span class="ass-badge-soft">LoRA ${loraCount}</span>
                        </div>
                        <div class="ass-saved-item-cats">${cats.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>
                    </div>
                    <div class="ass-saved-item-actions">
                        <button type="button" class="ass-btn-xs" data-add-to-col title="イラスト集作成リストに追加">+ 集へ</button>
                        <button type="button" class="ass-btn-xs" data-dup title="複製">複製</button>
                        <button type="button" class="ass-btn-xs ass-btn-danger" data-del title="削除">削除</button>
                    </div>
                `;

                row.querySelector("[data-select]").onclick = () => {
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
