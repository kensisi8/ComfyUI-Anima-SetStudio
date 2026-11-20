import {
    getRandomSelectorDescriptors,
    getSelectAvatarUrl,
    openAnimaPromptSelector,
} from "../bridge_anima_tools.js";

const ICONS = {
    grip: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="7" cy="5" r="1.3"/><circle cx="13" cy="5" r="1.3"/><circle cx="7" cy="10" r="1.3"/><circle cx="13" cy="10" r="1.3"/><circle cx="7" cy="15" r="1.3"/><circle cx="13" cy="15" r="1.3"/></svg>',
    ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6 18.4 18.4"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
    eraser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
    copy: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="3" width="10" height="11" rx="2"/><path d="M13 14v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/></svg>',
    close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8"/></svg>',
    plus: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>',
    check: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8"/></svg>',
};

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[ch]);
}

export function normalizeCategoryKey(label) {
    return String(label || "").trim().toLowerCase();
}

export function createPromptBox(partial = {}) {
    return {
        id: Math.random().toString(36).slice(2, 8),
        label: "",
        text: "",
        disabled: false,
        random: [],
        picks: {},
        ...partial,
    };
}

function pickCount(box) {
    if (!box?.picks || typeof box.picks !== "object") return 0;
    return Object.values(box.picks).reduce((sum, entry) => sum + (entry?.keys?.length || 0), 0);
}

async function copyTextSafe(text) {
    const value = String(text || "");
    if (!value) return false;
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch (_) {}
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
        ok = document.execCommand("copy");
    } finally {
        area.remove();
    }
    return ok;
}

function fitTextareaHeight(textarea) {
    textarea.style.height = "auto";
    const next = Math.min(200, Math.max(46, textarea.scrollHeight));
    textarea.style.height = `${next}px`;
}

let activeRandomMenuCloser = null;

function closeActiveRandomMenu() {
    if (typeof activeRandomMenuCloser === "function") {
        activeRandomMenuCloser();
        activeRandomMenuCloser = null;
    }
}

/**
 * Render an Anima Prompt Plus compatible editor inside `container`.
 *
 * Options:
 * - boxes: Array of prompt box objects
 * - separator: string (default ", ")
 * - showSeparator: boolean (default false)
 * - excludedCategories: Set<string> | Array<string> (normalized labels hidden from view)
 * - onChange: ({ boxes, separator }) => void
 * - onNotify: (message, severity?) => void
 */
export function renderPromptBoxesEditor(container, options) {
    const {
        boxes: initialBoxes = [],
        separator: initialSeparator = ", ",
        showSeparator = false,
        excludedCategories = [],
        onChange = () => {},
        onNotify = () => {},
    } = options;

    let boxes = (Array.isArray(initialBoxes) && initialBoxes.length ? initialBoxes : [createPromptBox()])
        .map((b) => createPromptBox(b));
    let separator = initialSeparator ?? ", ";

    const excludedSet = new Set(
        (Array.isArray(excludedCategories) ? excludedCategories : [...excludedCategories])
            .map(normalizeCategoryKey)
            .filter(Boolean),
    );

    const avatarUrl = getSelectAvatarUrl();
    const root = document.createElement("div");
    root.className = "ass-prompt-boxes";
    container.innerHTML = "";
    container.appendChild(root);

    function emitChange() {
        onChange({ boxes, separator });
    }

    function openRandomMenu(box, anchorBtn) {
        if (anchorBtn.classList.contains("is-open")) {
            closeActiveRandomMenu();
            return;
        }
        closeActiveRandomMenu();

        getRandomSelectorDescriptors().then((descriptors) => {
            const menu = document.createElement("div");
            menu.className = "ass-random-menu";
            menu.innerHTML = `
                <div class="ass-random-menu-title">実行時ランダム (Randomize on run)</div>
                ${descriptors
                    .map((desc) => {
                        const checked = (box.random || []).includes(desc.kind);
                        return `<button type="button" data-kind="${escapeHtml(desc.kind)}" class="${checked ? "is-checked" : ""}">${ICONS.check}<span>${escapeHtml(desc.label)}</span></button>`;
                    })
                    .join("")}
            `;

            menu.addEventListener("click", (event) => {
                const btn = event.target.closest("[data-kind]");
                if (!btn) return;
                const kind = btn.dataset.kind;
                const current = new Set(box.random || []);
                if (current.has(kind)) current.delete(kind);
                else current.add(kind);
                box.random = descriptors.map((d) => d.kind).filter((k) => current.has(k));
                btn.classList.toggle("is-checked", current.has(kind));
                anchorBtn.classList.toggle("is-on", box.random.length > 0);
                anchorBtn.innerHTML = `${ICONS.shuffle}${box.random.length ? `<b>${box.random.length}</b>` : ""}`;
                emitChange();
            });

            const onOutside = (e) => {
                if (!menu.contains(e.target) && !anchorBtn.contains(e.target)) close();
            };
            const onEsc = (e) => {
                if (e.key === "Escape") close();
            };
            const close = () => {
                menu.remove();
                anchorBtn.classList.remove("is-open");
                document.removeEventListener("pointerdown", onOutside, true);
                document.removeEventListener("keydown", onEsc, true);
                if (activeRandomMenuCloser === close) activeRandomMenuCloser = null;
            };

            document.addEventListener("pointerdown", onOutside, true);
            document.addEventListener("keydown", onEsc, true);
            anchorBtn.classList.add("is-open");

            const rect = anchorBtn.getBoundingClientRect();
            menu.style.top = `${Math.min(window.innerHeight - 220, rect.bottom + 4)}px`;
            menu.style.right = `${Math.max(8, document.documentElement.clientWidth - rect.right)}px`;
            document.body.appendChild(menu);
            activeRandomMenuCloser = close;
        });
    }

    function startRename(box, titleEl, index) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "ass-pbox-title-input";
        input.value = box.label || "";
        input.placeholder = `テキスト枠 ${index + 1}`;
        titleEl.replaceWith(input);
        input.focus();
        input.select();

        let finished = false;
        const finish = (save) => {
            if (finished) return;
            finished = true;
            if (save) {
                const nextLabel = input.value.trim();
                if (nextLabel !== (box.label || "")) {
                    box.label = nextLabel;
                    emitChange();
                }
            }
            render();
        };
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") finish(true);
            if (e.key === "Escape") finish(false);
        });
        input.addEventListener("blur", () => finish(true));
    }

    let dragFromIndex = -1;

    function render() {
        root.innerHTML = "";
        const hiddenLabels = [];
        const visibleEntries = [];

        boxes.forEach((box, idx) => {
            const norm = normalizeCategoryKey(box.label);
            if (norm && excludedSet.has(norm)) {
                hiddenLabels.push(box.label.trim());
            } else {
                visibleEntries.push({ box, idx });
            }
        });

        if (hiddenLabels.length) {
            const note = document.createElement("div");
            note.className = "ass-hidden-cat-note";
            note.textContent = `共通プロンプトで上書き中のため非表示: ${hiddenLabels.join(" / ")}`;
            root.appendChild(note);
        }

        const listEl = document.createElement("div");
        listEl.className = "ass-pbox-list";

        if (!visibleEntries.length) {
            const emptyMsg = document.createElement("div");
            emptyMsg.className = "ass-empty-inline";
            emptyMsg.textContent = "表示中のプロンプト枠がありません（すべて共通で上書き中、または下のボタンから追加できます）";
            listEl.appendChild(emptyMsg);
        }

        const totalCount = boxes.length;

        visibleEntries.forEach(({ box, idx }) => {
            const picks = pickCount(box);
            const randomCount = (box.random || []).length;
            const titleText = box.label || `テキスト枠 ${idx + 1}`;
            const card = document.createElement("div");
            card.className = `ass-pbox ${box.disabled ? "is-disabled" : ""}`;
            card.dataset.boxIndex = String(idx);
            card.draggable = totalCount > 1;

            card.innerHTML = `
                <div class="ass-pbox-head">
                    ${totalCount > 1 ? `<span class="ass-pbox-grip" title="ドラッグで並び替え">${ICONS.grip}</span>` : ""}
                    <span class="ass-pbox-title ${box.label ? "" : "is-placeholder"}" title="クリックしてカテゴリ名を変更">${escapeHtml(titleText)}</span>
                    <span class="ass-pbox-spacer"></span>
                    <button type="button" class="ass-pbox-icon" data-action="disable" aria-pressed="${Boolean(box.disabled)}" title="${box.disabled ? "有効にする" : "一時無効化"}">${ICONS.ban}</button>
                    <button type="button" class="ass-pbox-icon ${randomCount ? "is-on" : ""}" data-action="random" title="実行時ランダム (Randomize on run)">${ICONS.shuffle}${randomCount ? `<b>${randomCount}</b>` : ""}</button>
                    <button type="button" class="ass-pbox-icon" data-action="clear" title="クリア">${ICONS.eraser}</button>
                    <button type="button" class="ass-pbox-icon" data-action="copy" title="コピー">${ICONS.copy}</button>
                    <button type="button" class="ass-pbox-select" data-action="select" title="Anima Prompt Selector を開く">
                        <span class="ass-pbox-select-avatar" style="background-image:url('${escapeHtml(avatarUrl)}')"></span>
                        <span>Select</span>
                        ${picks ? `<b>${picks}</b>` : ""}
                    </button>
                    ${totalCount > 1 ? `<button type="button" class="ass-pbox-icon ass-pbox-remove" data-action="remove" title="この枠を削除">${ICONS.close}</button>` : ""}
                </div>
                <textarea class="ass-pbox-textarea" spellcheck="false" placeholder="プロンプトを入力、または右上の Select から選択..."></textarea>
            `;

            const titleEl = card.querySelector(".ass-pbox-title");
            titleEl.onclick = () => startRename(box, titleEl, idx);

            const textarea = card.querySelector("textarea");
            textarea.value = box.text || "";
            textarea.disabled = Boolean(box.disabled);
            textarea.addEventListener("input", () => {
                box.text = textarea.value;
                fitTextareaHeight(textarea);
                emitChange();
            });
            textarea.addEventListener("keydown", (e) => e.stopPropagation());
            requestAnimationFrame(() => fitTextareaHeight(textarea));

            card.querySelector('[data-action="disable"]').onclick = () => {
                box.disabled = !box.disabled;
                emitChange();
                render();
            };

            const randomBtn = card.querySelector('[data-action="random"]');
            randomBtn.disabled = Boolean(box.disabled);
            randomBtn.onclick = () => openRandomMenu(box, randomBtn);

            const clearBtn = card.querySelector('[data-action="clear"]');
            clearBtn.disabled = Boolean(box.disabled);
            clearBtn.onclick = () => {
                box.text = "";
                box.picks = {};
                emitChange();
                render();
            };

            card.querySelector('[data-action="copy"]').onclick = async () => {
                const ok = await copyTextSafe(box.text);
                onNotify(ok ? "プロンプトをコピーしました" : "コピーするテキストがありません", ok ? "success" : "warn");
            };

            const selectBtn = card.querySelector('[data-action="select"]');
            selectBtn.disabled = Boolean(box.disabled);
            selectBtn.onclick = async () => {
                const opened = await openAnimaPromptSelector(box, (updated) => {
                    boxes[idx] = createPromptBox(updated);
                    emitChange();
                    render();
                });
                if (!opened) {
                    onNotify("Comfyui-Anima-Tools の Select 機能が利用できません（手入力は可能です）", "warn");
                }
            };

            const removeBtn = card.querySelector('[data-action="remove"]');
            if (removeBtn) {
                removeBtn.onclick = () => {
                    boxes.splice(idx, 1);
                    if (!boxes.length) boxes.push(createPromptBox());
                    emitChange();
                    render();
                };
            }

            // Drag & drop reorder
            card.addEventListener("dragstart", (e) => {
                if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") {
                    e.preventDefault();
                    return;
                }
                dragFromIndex = idx;
                card.classList.add("is-dragging");
                e.dataTransfer.effectAllowed = "move";
            });
            card.addEventListener("dragend", () => {
                dragFromIndex = -1;
                card.classList.remove("is-dragging");
                listEl.querySelectorAll(".ass-pbox").forEach((el) => el.classList.remove("is-drop-over"));
            });
            card.addEventListener("dragover", (e) => {
                if (dragFromIndex < 0 || dragFromIndex === idx) return;
                e.preventDefault();
                card.classList.add("is-drop-over");
            });
            card.addEventListener("dragleave", () => card.classList.remove("is-drop-over"));
            card.addEventListener("drop", (e) => {
                if (dragFromIndex < 0 || dragFromIndex === idx) return;
                e.preventDefault();
                const [moved] = boxes.splice(dragFromIndex, 1);
                boxes.splice(idx, 0, moved);
                dragFromIndex = -1;
                emitChange();
                render();
            });

            listEl.appendChild(card);
        });

        root.appendChild(listEl);

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "ass-pbox-add";
        addBtn.innerHTML = `${ICONS.plus}<span>Add Text Box</span>`;
        addBtn.onclick = () => {
            const added = createPromptBox();
            boxes.push(added);
            emitChange();
            render();
            requestAnimationFrame(() => {
                const areas = root.querySelectorAll("textarea");
                areas[areas.length - 1]?.focus();
            });
        };
        root.appendChild(addBtn);

        if (showSeparator) {
            const sepRow = document.createElement("div");
            sepRow.className = "ass-sep-row";
            sepRow.innerHTML = `<label>separator</label><input type="text" class="ass-input ass-sep-input" />`;
            const sepInput = sepRow.querySelector("input");
            sepInput.value = separator;
            sepInput.addEventListener("input", () => {
                separator = sepInput.value;
                emitChange();
            });
            sepInput.addEventListener("keydown", (e) => e.stopPropagation());
            root.appendChild(sepRow);
        }
    }

    render();
    return {
        getBoxes: () => boxes,
        getSeparator: () => separator,
    };
}
