import { api } from "../../scripts/api.js";

const API_BASE = "/anima-set-studio/api";

async function requestJson(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
        ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
        throw new Error(data.error || `APIエラー (${response.status})`);
    }
    return data;
}

export async function fetchSets() {
    const data = await requestJson("/sets");
    return Array.isArray(data.sets) ? data.sets : [];
}

export async function saveSet(setPayload) {
    const data = await requestJson("/sets", {
        method: "POST",
        body: JSON.stringify(setPayload),
    });
    return data.set;
}

export async function duplicateSet(setId, newName = "") {
    const data = await requestJson(`/sets/${encodeURIComponent(setId)}/duplicate`, {
        method: "POST",
        body: JSON.stringify(newName ? { name: newName } : {}),
    });
    return data.set;
}

export async function deleteSet(setId) {
    return requestJson(`/sets/${encodeURIComponent(setId)}`, {
        method: "DELETE",
    });
}

export async function fetchState() {
    const data = await requestJson("/state");
    return data.state;
}

export async function saveState(statePayload) {
    const data = await requestJson("/state", {
        method: "POST",
        body: JSON.stringify(statePayload),
    });
    return data.state;
}

export async function fetchOptions() {
    const data = await requestJson("/options");
    return data.options;
}

export async function buildBatchJobs(payload) {
    return requestJson("/build-jobs", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export async function importSetFromImage(file) {
    const formData = new FormData();
    formData.append("image", file, file?.name || "image.png");
    const response = await fetch(`${API_BASE}/import-image`, {
        method: "POST",
        body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
        throw new Error(data.error || `画像読み込みエラー (${response.status})`);
    }
    return data.imported;
}

export function getSetThumbnailUrl(filename) {
    const clean = String(filename || "").trim();
    if (!clean) return "";
    return `${API_BASE}/thumbnails/${encodeURIComponent(clean)}`;
}

function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve) => {
        if (typeof canvas.toBlob !== "function") {
            resolve(null);
            return;
        }
        canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    });
}

function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("画像ファイルのデコードに失敗しました"));
        };
        img.src = url;
    });
}

/**
 * Downscale an image file in the browser to maxDim (default 320px) and
 * re-encode as lightweight WebP (with JPEG fallback) before upload.
 */
export async function compressImageToThumbnailBlob(file, maxDim = 320) {
    const img = await loadImageFromFile(file);
    const srcW = img.naturalWidth || img.width || 1;
    const srcH = img.naturalHeight || img.height || 1;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const outW = Math.max(1, Math.round(srcW * scale));
    const outH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1a1d24";
    ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, outW, outH);

    // Prefer WebP for minimal file size; tighten quality if still > 45KB
    let blob = await canvasToBlob(canvas, "image/webp", 0.74);
    if (blob && blob.type === "image/webp") {
        if (blob.size > 45 * 1024) {
            const tighter = await canvasToBlob(canvas, "image/webp", 0.6);
            if (tighter && tighter.type === "image/webp" && tighter.size < blob.size) {
                blob = tighter;
            }
        }
        return { blob, filename: "thumb.webp", width: outW, height: outH };
    }

    // Fallback to optimized JPEG if browser cannot encode WebP
    const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.78);
    if (jpegBlob) {
        return { blob: jpegBlob, filename: "thumb.jpg", width: outW, height: outH };
    }
    return { blob: file, filename: file?.name || "thumb.jpg", width: srcW, height: srcH };
}

export async function uploadSetThumbnail(file) {
    const { blob, filename, width, height } = await compressImageToThumbnailBlob(file, 320);
    const formData = new FormData();
    formData.append("image", blob, filename);
    const response = await fetch(`${API_BASE}/thumbnails`, {
        method: "POST",
        body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
        throw new Error(data.error || `サムネイル保存エラー (${response.status})`);
    }
    return {
        ...data,
        width: data.width || width,
        height: data.height || height,
    };
}

/**
 * Submit a single built job directly into ComfyUI's /prompt queue.
 */
export async function queueComfyPrompt(promptGraph, extraPnginfo = {}) {
    const body = {
        prompt: promptGraph,
        client_id: api?.clientId || undefined,
        extra_data: {
            extra_pnginfo: extraPnginfo || {},
        },
    };
    const response = await api.fetchApi("/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
        const errMsg = typeof data.error === "string"
            ? data.error
            : data.error?.message || `キュー投入失敗 (${response.status})`;
        throw new Error(errMsg);
    }
    return data;
}
