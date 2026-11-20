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
