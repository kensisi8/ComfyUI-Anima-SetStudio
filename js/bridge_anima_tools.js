/**
 * Bridge to an installed Comfyui-Anima-Tools extension so SetStudio reuses:
 * 1) Anima Prompt Plus's exact Select popup (openBoxSelector + all selectors & My Tags)
 * 2) Anima Multi LoRA Loader's exact LoRA Manager popup (local, Civitai discover, favorites, downloads)
 * Falls back gracefully when Comfyui-Anima-Tools is not installed.
 */

let extFolderName = "Comfyui-Anima-Tools";
let promptModulesPromise = null;
let mediaModulePromise = null;
let virtualLoraNode = null;
let suppressLoraSync = false;
let activeLoraChangeHandler = null;
let lastSyncedLoraJson = "";

const FALLBACK_RANDOM_SELECTORS = [
    { kind: "artist", label: "Artists" },
    { kind: "character", label: "Characters" },
    { kind: "clothing", label: "Clothing" },
    { kind: "pose", label: "Pose" },
    { kind: "background", label: "Background" },
];

export function configureAnimaToolsBridge(folderName) {
    if (folderName && typeof folderName === "string" && folderName.trim()) {
        extFolderName = folderName.trim();
        promptModulesPromise = null;
        mediaModulePromise = null;
    }
}

export function getSelectAvatarUrl() {
    return `/extensions/${encodeURIComponent(extFolderName)}/anima_select_avatar.webp`;
}

function deepClone(value) {
    try {
        return structuredClone(value);
    } catch (_) {
        return JSON.parse(JSON.stringify(value));
    }
}

async function loadPromptModules() {
    if (promptModulesPromise) return promptModulesPromise;
    const base = `/extensions/${encodeURIComponent(extFolderName)}`;
    promptModulesPromise = Promise.all([
        import(`${base}/anima_gallery_selector.js`),
        import(`${base}/anima_artist_selector.js`),
        import(`${base}/anima_character_selector.js`),
        import(`${base}/anima_tag_selectors.js`),
        import(`${base}/anima_my_tags.js`),
        import(`${base}/i18n.js`),
    ])
        .then(([galleryMod, artistMod, characterMod, tagMod, myTagsMod, i18nMod]) => {
            const [clothingSelector, backgroundSelector, poseSelector, ...librarySelectors] =
                tagMod.TAG_SELECTORS || [];
            const selectors = [
                artistMod.artistSelector,
                characterMod.characterSelector,
                clothingSelector,
                poseSelector,
                backgroundSelector,
                ...librarySelectors,
                myTagsMod.myTagsSelector,
            ].filter(Boolean);
            return {
                openBoxSelector: galleryMod.openBoxSelector,
                selectors,
                randomSelectors: selectors.filter((item) => item.random !== false),
                t: i18nMod.t || ((key) => key),
            };
        })
        .catch((err) => {
            console.warn("[Anima SetStudio] Comfyui-Anima-Tools prompt modules unavailable:", err);
            promptModulesPromise = null;
            return null;
        });
    return promptModulesPromise;
}

async function loadMediaModule() {
    if (mediaModulePromise) return mediaModulePromise;
    const base = `/extensions/${encodeURIComponent(extFolderName)}`;
    mediaModulePromise = import(`${base}/lora_manager/media.js`).catch(() => {
        mediaModulePromise = null;
        return null;
    });
    return mediaModulePromise;
}

export async function resolveLoraPreviewMedia(url, width = 96) {
    if (!url) return { src: "", fallbacks: [] };
    const mod = await loadMediaModule();
    if (mod?.createPreviewMedia) {
        const media = mod.createPreviewMedia(url, width);
        if (media.type === "video") {
            return { src: media.posterUrl || "", fallbacks: [...(media.posterFallbackUrls || [])] };
        }
        return { src: media.url || "", fallbacks: [...(media.fallbackUrls || [])] };
    }
    return { src: String(url), fallbacks: [] };
}

export async function getRandomSelectorDescriptors() {
    const mods = await loadPromptModules();
    if (mods?.randomSelectors?.length) {
        return mods.randomSelectors.map((item) => ({
            kind: item.kind,
            label: mods.t(item.label || item.kind),
        }));
    }
    return FALLBACK_RANDOM_SELECTORS;
}

/**
 * Open Comfyui-Anima-Tools's native Select popup for a prompt box.
 * Returns true if opened via Comfyui-Anima-Tools, false otherwise.
 */
export async function openAnimaPromptSelector(box, onApply) {
    const mods = await loadPromptModules();
    if (!mods?.openBoxSelector || !mods.selectors.length) {
        return false;
    }
    const copy = deepClone({
        id: box.id || Math.random().toString(36).slice(2, 8),
        label: box.label || "",
        text: box.text || "",
        disabled: Boolean(box.disabled),
        random: Array.isArray(box.random) ? [...box.random] : [],
        picks: box.picks && typeof box.picks === "object" ? box.picks : {},
    });
    mods.openBoxSelector(mods.t("Anima Prompt Selector"), mods.selectors, copy, (updated) => {
        if (typeof onApply === "function") {
            onApply(deepClone(updated));
        }
    });
    return true;
}

function emitVirtualLoraChange(node) {
    if (suppressLoraSync || !node) return;
    if (typeof activeLoraChangeHandler !== "function" || !Array.isArray(node._almLoras)) return;
    const serialized = JSON.stringify(node._almLoras);
    if (serialized === lastSyncedLoraJson) return;
    lastSyncedLoraJson = serialized;
    activeLoraChangeHandler(deepClone(node._almLoras));
}

function ensureVirtualLoraNode() {
    if (virtualLoraNode) return virtualLoraNode;
    const LG = window.LiteGraph;
    if (!LG || typeof LG.createNode !== "function") return null;
    let node = null;
    try {
        node = LG.createNode("AnimaMultiLoraLoader");
    } catch (err) {
        console.warn("[Anima SetStudio] Failed to create virtual AnimaMultiLoraLoader:", err);
        return null;
    }
    if (!node || !node._almLoraParts?.open) {
        return null;
    }

    node.size = node.size || [320, 200];
    // Provide a safe off-canvas graph stub implementing modern LiteGraph methods
    // (including canvasAction, beforeChange, afterChange, setDirtyCanvas) so
    // Comfyui-Anima-Tools never throws when updating this detached virtual node.
    node.graph = {
        _version: 0,
        _nodes: [],
        links: {},
        list_of_graphcanvas: [],
        beforeChange() {},
        afterChange() {
            emitVirtualLoraChange(node);
        },
        change() {
            emitVirtualLoraChange(node);
        },
        canvasAction() {},
        setDirtyCanvas() {},
        trigger() {},
        sendEventToAllNodes() {},
    };

    node.setDirtyCanvas = function () {
        emitVirtualLoraChange(node);
    };

    const origSetSize = node.setSize?.bind(node);
    node.setSize = function (size) {
        if (Array.isArray(size) && size.length >= 2) {
            node.size = [size[0], size[1]];
        }
        try {
            origSetSize?.(size);
        } catch (_) {
            // Ignore canvas-only resize errors on the detached virtual node.
        }
    };

    virtualLoraNode = node;
    return virtualLoraNode;
}

/**
 * Open Comfyui-Anima-Tools's native LoRA Manager popup bound to `currentLoras`.
 * Calls `onChange(updatedLoras)` live whenever the user applies/removes/edits LoRAs in the popup.
 * Returns true if native popup opened, false if fallback picker should be used.
 */
export function openAnimaLoraManager(currentLoras, onChange) {
    const node = ensureVirtualLoraNode();
    if (!node || !node._almLoraParts?.open) {
        return false;
    }
    const cloned = deepClone(Array.isArray(currentLoras) ? currentLoras : []);
    const serialized = JSON.stringify(cloned);
    suppressLoraSync = true;
    try {
        node._almLoras = cloned;
        lastSyncedLoraJson = serialized;
        const jsonWidget = node.widgets?.find((w) => w.name === "lora_list_json");
        if (jsonWidget) {
            jsonWidget.value = serialized;
        }
    } finally {
        suppressLoraSync = false;
    }

    activeLoraChangeHandler = onChange;
    node._almLoraParts.open.click();
    return true;
}

/**
 * Simple built-in fallback LoRA picker modal when Comfyui-Anima-Tools is not installed.
 */
export function openFallbackLoraPicker(availableLoras, currentLoras, onAdd) {
    const existing = document.getElementById("ass-fallback-lora-modal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "ass-fallback-lora-modal";
    overlay.className = "ass-submodal-overlay";
    overlay.innerHTML = `
        <div class="ass-submodal">
            <div class="ass-submodal-header">
                <h3>LoRAを追加（標準一覧）</h3>
                <button type="button" class="ass-icon-btn" data-close>✕</button>
            </div>
            <div class="ass-submodal-body">
                <p class="ass-hint">Comfyui-Anima-Tools の LoRA Manager が利用できないため、ComfyUIのLoRA一覧を表示しています。</p>
                <input type="text" class="ass-input" data-search placeholder="LoRA名で絞り込み..." />
                <div class="ass-fallback-lora-list" data-list></div>
            </div>
        </div>
    `;
    const listEl = overlay.querySelector("[data-list]");
    const searchEl = overlay.querySelector("[data-search]");
    const appliedNames = new Set((currentLoras || []).map((l) => String(l.name || "").toLowerCase()));

    const renderList = (query = "") => {
        const q = query.trim().toLowerCase();
        const filtered = (availableLoras || []).filter((name) => !q || name.toLowerCase().includes(q));
        if (!filtered.length) {
            listEl.innerHTML = `<div class="ass-empty-inline">該当するLoRAが見つかりません</div>`;
            return;
        }
        listEl.innerHTML = "";
        for (const name of filtered.slice(0, 200)) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `ass-fallback-lora-item ${appliedNames.has(name.toLowerCase()) ? "is-applied" : ""}`;
            btn.textContent = name;
            btn.onclick = () => {
                onAdd({
                    name,
                    display_name: name.split("/").pop(),
                    strength_model: 1.0,
                    enabled: true,
                });
                appliedNames.add(name.toLowerCase());
                btn.classList.add("is-applied");
            };
            listEl.appendChild(btn);
        }
    };

    const close = () => overlay.remove();
    overlay.querySelector("[data-close]").onclick = close;
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
    });
    searchEl.addEventListener("input", () => renderList(searchEl.value));

    renderList();
    document.body.appendChild(overlay);
    searchEl.focus();
}
