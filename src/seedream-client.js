/**
 * AtlasCloud Seedream image API (bytedance/seedream-v5.0-pro/edit).
 * Follows api.docx: submit → poll → outputs[0].
 */

const DEFAULT_BASE = 'https://api.atlascloud.ai';
const DEFAULT_MODEL = 'bytedance/seedream-v5.0-pro/edit';
const SIZE_OPTIONS = new Set([
    '2048*2048', '2304*1728', '1728*2304', '2720*1530', '1530*2720',
    '2496*1664', '1664*2496', '1024*1024', '1536*1536', '1776*1328',
    '1328*1776', '2048*1152', '1152*2048',
]);

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function trimBase(url) {
    return String(url || DEFAULT_BASE).trim().replace(/\/+$/, '') || DEFAULT_BASE;
}

function authHeaders(apiKey, extra = {}) {
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('缺少 AtlasCloud API Key');
    return {
        Authorization: `Bearer ${key}`,
        ...extra,
    };
}

/**
 * @param {object} settings
 */
export function getSeedreamConfig(settings = {}) {
    const s = settings || {};
    return {
        enabled: s.seedreamEnabled === true,
        apiKey: String(s.seedreamApiKey || '').trim(),
        baseUrl: trimBase(s.seedreamBaseUrl || DEFAULT_BASE),
        model: String(s.seedreamModel || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
        size: SIZE_OPTIONS.has(String(s.seedreamSize || ''))
            ? String(s.seedreamSize)
            : '1024*1024',
        outputFormat: s.seedreamOutputFormat === 'png' ? 'png' : 'jpeg',
        thinking: s.seedreamThinking === 'disabled' ? 'disabled' : 'enabled',
        pollIntervalMs: Math.max(1000, Number(s.seedreamPollIntervalMs) || 2000),
        pollTimeoutMs: Math.max(15000, Number(s.seedreamPollTimeoutMs) || 180000),
    };
}

export function isSeedreamConfigured(settings = {}) {
    const c = getSeedreamConfig(settings);
    return Boolean(c.enabled && c.apiKey);
}

/**
 * Optional media upload (multipart). Returns a public URL when successful.
 * @param {Blob|File} blob
 * @param {{ apiKey: string, baseUrl?: string, filename?: string, signal?: AbortSignal }} opts
 */
export async function uploadSeedreamMedia(blob, opts = {}) {
    const apiKey = String(opts.apiKey || '').trim();
    const baseUrl = trimBase(opts.baseUrl);
    if (!apiKey) throw new Error('缺少 AtlasCloud API Key');
    if (!blob) throw new Error('没有可上传的文件');

    const form = new FormData();
    const filename = String(opts.filename || `momo_${Date.now()}.jpg`).replace(/[^\w.\-]+/g, '_');
    form.append('file', blob, filename);

    const response = await fetch(`${baseUrl}/api/v1/model/uploadMedia`, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: form,
        signal: opts.signal,
    });
    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    if (!response.ok) {
        const msg = json?.message || json?.error || json?.data?.error || text.slice(0, 160);
        throw new Error(`uploadMedia 失败 (${response.status})${msg ? `: ${msg}` : ''}`);
    }

    const data = json?.data ?? json;
    const candidates = [
        data?.url,
        data?.media_url,
        data?.mediaUrl,
        data?.file_url,
        data?.fileUrl,
        data?.path,
        data?.outputs?.[0],
        data?.files?.[0]?.url,
        data?.file?.url,
        Array.isArray(data) ? data[0]?.url || data[0] : '',
        typeof data === 'string' ? data : '',
    ];
    const url = candidates.map((x) => String(x || '').trim()).find((x) => /^https?:\/\//i.test(x) || /^data:image\//i.test(x)) || '';
    if (!url) {
        console.warn('[st-momo] uploadMedia unexpected payload', json);
        throw new Error('uploadMedia 成功但未返回可用 URL');
    }
    return url;
}

/**
 * Submit edit job + poll until completed/succeeded/failed.
 * @param {{
 *   prompt: string,
 *   images: string[],
 *   apiKey?: string,
 *   baseUrl?: string,
 *   model?: string,
 *   size?: string,
 *   outputFormat?: 'jpeg'|'png',
 *   thinking?: 'enabled'|'disabled',
 *   enableBase64Output?: boolean,
 *   pollIntervalMs?: number,
 *   pollTimeoutMs?: number,
 *   signal?: AbortSignal,
 * }} options
 */
export async function generateSeedreamImage(options = {}) {
    const prompt = String(options.prompt || '').trim();
    const images = (Array.isArray(options.images) ? options.images : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .slice(0, 10);
    if (!prompt) throw new Error('prompt 不能为空');
    if (!images.length) throw new Error('images 至少需要 1 张参考图（Seedream edit 必填）');

    const apiKey = String(options.apiKey || '').trim();
    const baseUrl = trimBase(options.baseUrl);
    const model = String(options.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const size = SIZE_OPTIONS.has(String(options.size || ''))
        ? String(options.size)
        : '1024*1024';
    const outputFormat = options.outputFormat === 'png' ? 'png' : 'jpeg';
    const thinking = options.thinking === 'disabled' ? 'disabled' : 'enabled';
    const pollIntervalMs = Math.max(1000, Number(options.pollIntervalMs) || 2000);
    const pollTimeoutMs = Math.max(15000, Number(options.pollTimeoutMs) || 180000);

    const payload = {
        model,
        prompt,
        images,
        size,
        output_format: outputFormat,
        thinking,
        enable_base64_output: options.enableBase64Output === true,
    };

    const generateUrl = `${baseUrl}/api/v1/model/generateImage`;
    const submitRes = await fetch(generateUrl, {
        method: 'POST',
        headers: {
            ...authHeaders(apiKey),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: options.signal,
    });
    const submitText = await submitRes.text();
    let submitJson = null;
    try {
        submitJson = submitText ? JSON.parse(submitText) : null;
    } catch {
        submitJson = null;
    }
    if (!submitRes.ok) {
        const msg = submitJson?.message || submitJson?.error || submitJson?.data?.error || submitText.slice(0, 200);
        throw new Error(`generateImage 失败 (${submitRes.status})${msg ? `: ${msg}` : ''}`);
    }

    const predictionId = String(submitJson?.data?.id || submitJson?.id || '').trim();
    if (!predictionId) throw new Error('generateImage 未返回 prediction id');

    const pollUrl = `${baseUrl}/api/v1/model/prediction/${encodeURIComponent(predictionId)}`;
    const started = Date.now();

    while (true) {
        if (options.signal?.aborted) throw new Error('生图已取消');
        if (Date.now() - started > pollTimeoutMs) {
            throw new Error(`生图超时（>${Math.round(pollTimeoutMs / 1000)}s）`);
        }

        const pollRes = await fetch(pollUrl, {
            method: 'GET',
            headers: authHeaders(apiKey),
            signal: options.signal,
        });
        const pollText = await pollRes.text();
        let pollJson = null;
        try {
            pollJson = pollText ? JSON.parse(pollText) : null;
        } catch {
            pollJson = null;
        }
        if (!pollRes.ok) {
            const msg = pollJson?.message || pollJson?.error || pollText.slice(0, 160);
            throw new Error(`轮询失败 (${pollRes.status})${msg ? `: ${msg}` : ''}`);
        }

        const data = pollJson?.data ?? pollJson ?? {};
        const status = String(data.status || '').toLowerCase();

        if (status === 'completed' || status === 'succeeded' || status === 'success') {
            const outputs = Array.isArray(data.outputs) ? data.outputs : [];
            const out = String(outputs[0] || '').trim();
            if (!out) throw new Error('生图完成但 outputs 为空');
            return {
                imageUrl: out,
                predictionId,
                model: String(data.model || model),
                status,
                outputs,
                raw: data,
            };
        }
        if (status === 'failed' || status === 'error') {
            throw new Error(String(data.error || data.message || 'Generation failed'));
        }

        await sleep(pollIntervalMs);
    }
}

export { DEFAULT_BASE, DEFAULT_MODEL, SIZE_OPTIONS };
