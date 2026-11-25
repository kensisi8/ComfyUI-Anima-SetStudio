/**
 * Shared aspect-ratio & base-resolution helpers matching backend/storage.py.
 */

export const DEFAULT_BASE_RESOLUTION = 1024;
export const DEFAULT_ASPECT_RATIO = "2:3";
export const MIN_BASE_RESOLUTION = 512;
export const MAX_BASE_RESOLUTION = 2048;

export const BASE_RESOLUTION_PRESETS = [
    { label: "ラフ 768 (~0.6MP)", value: 768 },
    { label: "標準 1024 (~1.0MP)", value: 1024 },
    { label: "高画質 1216 (~1.5MP)", value: 1216 },
    { label: "特大 1408 (~2.0MP)", value: 1408 },
];

export const ASPECT_RATIO_PRESETS = [
    { value: "2:3", label: "2:3 (縦標準)" },
    { value: "3:4", label: "3:4 (縦)" },
    { value: "4:5", label: "4:5 (縦)" },
    { value: "9:16", label: "9:16 (縦長)" },
    { value: "1:1", label: "1:1 (正方形)" },
    { value: "4:3", label: "4:3 (横)" },
    { value: "3:2", label: "3:2 (横標準)" },
    { value: "16:9", label: "16:9 (ワイド)" },
];

const ASPECT_RATIO_RE = /^\s*(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)\s*$/;
const PRESET_SET = new Set(ASPECT_RATIO_PRESETS.map((p) => p.value));

function formatRatioPart(val) {
    const rounded = Math.round(val * 100) / 100;
    if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
        return String(Math.round(rounded));
    }
    return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function normalizeAspectRatio(raw, allowEmpty = true) {
    const text = String(raw ?? "").trim();
    if (!text || ["common", "default", "auto", "inherit"].includes(text.toLowerCase())) {
        return allowEmpty ? "" : DEFAULT_ASPECT_RATIO;
    }
    const m = ASPECT_RATIO_RE.exec(text);
    if (!m) return allowEmpty ? "" : DEFAULT_ASPECT_RATIO;
    const w = parseFloat(m[1]);
    const h = parseFloat(m[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        return allowEmpty ? "" : DEFAULT_ASPECT_RATIO;
    }
    const ratio = w / h;
    if (ratio < 0.2 || ratio > 5.0) {
        return allowEmpty ? "" : DEFAULT_ASPECT_RATIO;
    }
    return `${formatRatioPart(w)}:${formatRatioPart(h)}`;
}

export function isPresetAspectRatio(ratio) {
    return PRESET_SET.has(String(ratio || ""));
}

export function parseAspectRatioParts(ratio, fallback = DEFAULT_ASPECT_RATIO) {
    const norm = normalizeAspectRatio(ratio, false) || fallback;
    const m = ASPECT_RATIO_RE.exec(norm);
    if (!m) return [2, 3];
    return [parseFloat(m[1]), parseFloat(m[2])];
}

function roundToStep(val, step = 16, minV = 64, maxV = 4096) {
    const snapped = Math.round(val / step) * step;
    return Math.max(minV, Math.min(maxV, snapped));
}

export function normalizeBaseResolution(raw) {
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return DEFAULT_BASE_RESOLUTION;
    return Math.max(MIN_BASE_RESOLUTION, Math.min(MAX_BASE_RESOLUTION, Math.round(num)));
}

export function computeDimensionsForAspectRatio(
    baseResolution,
    aspectRatio,
    fallbackRatio = DEFAULT_ASPECT_RATIO,
    step = 16,
) {
    const base = normalizeBaseResolution(baseResolution);
    const [rw, rh] = parseAspectRatioParts(aspectRatio || fallbackRatio, fallbackRatio);
    const area = base * base;
    const width = roundToStep(Math.sqrt(area * (rw / rh)), step);
    const height = roundToStep(Math.sqrt(area * (rh / rw)), step);
    const megapixels = ((width * height) / 1_000_000).toFixed(2);
    return { width, height, megapixels };
}

export function formatSetResolutionBadge(baseResolution, setAspectRatio, defaultAspectRatio = DEFAULT_ASPECT_RATIO) {
    const own = normalizeAspectRatio(setAspectRatio, true);
    const effective = own || normalizeAspectRatio(defaultAspectRatio, false);
    const { width, height } = computeDimensionsForAspectRatio(baseResolution, effective);
    if (own) {
        return `📐 ${own} · ${width}×${height}`;
    }
    return `📐 共通(${effective}) · ${width}×${height}`;
}
