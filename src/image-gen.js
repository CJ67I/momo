/**
 * Momo personal-image flow: parse tags → Seedream edit → chat message update.
 */

import {
    generateSeedreamImage,
    getSeedreamConfig,
    isSeedreamConfigured,
    uploadSeedreamMedia,
} from './seedream-client.js';
import { uid } from './utils.js';

/** @type {Set<string>} */
const _locks = new Set();

/**
 * Match `[个人图片]（描述）` / `[个人图片](描述)` / `[个人图片] 描述`
 * @param {string} text
 * @returns {{ prompt: string, raw: string }|null}
 */
export function parsePersonalImageTag(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const m = raw.match(/^\[\s*个人图片\s*\]\s*(?:[（(]\s*([\s\S]+?)\s*[）)]|[:：]\s*([\s\S]+)|([\s\S]+))\s*$/);
    if (!m) return null;
    const prompt = String(m[1] || m[2] || m[3] || '').trim();
    if (!prompt) return null;
    return { prompt: prompt.slice(0, 600), raw };
}

/**
 * Compress a local image file to JPEG data URL (for Seedream `images`).
 * @param {File|Blob} file
 * @param {{ maxSide?: number, quality?: number }} [opts]
 */
export async function compressImageToDataUrl(file, opts = {}) {
    if (!file) throw new Error('未选择图片');
    const type = String(file.type || '');
    if (type && !type.startsWith('image/')) throw new Error('请选择图片文件');
    if (file.size > 8 * 1024 * 1024) throw new Error('参考图最大 8MB');

    const maxSide = Math.max(512, Number(opts.maxSide) || 1280);
    const quality = Math.min(0.95, Math.max(0.5, Number(opts.quality) || 0.85));

    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('图片解码失败'));
        el.src = dataUrl;
    });

    const sw = Number(img.naturalWidth || img.width || 0);
    const sh = Number(img.naturalHeight || img.height || 0);
    if (!sw || !sh) throw new Error('无法读取图片尺寸');

    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const tw = Math.max(1, Math.round(sw * scale));
    const th = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 不可用');
    ctx.drawImage(img, 0, 0, tw, th);
    return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Prepare a reference image for Seedream: compress → prefer uploadMedia URL → else data URI.
 * Always keep a local data URI copy so generate can embed bytes even if remote URL dies.
 * @param {File|Blob} file
 * @param {object} settings
 */
export async function prepareReferenceImage(file, settings = {}) {
    const dataUrl = await compressImageToDataUrl(file);
    const cfg = getSeedreamConfig(settings);
    if (!cfg.apiKey) {
        return { url: dataUrl, dataUrl, storedAs: 'data' };
    }
    try {
        const blob = await (await fetch(dataUrl)).blob();
        const url = await uploadSeedreamMedia(blob, {
            apiKey: cfg.apiKey,
            baseUrl: cfg.baseUrl,
            filename: `momo_ref_${Date.now()}.jpg`,
        });
        return { url, dataUrl, storedAs: 'remote' };
    } catch (e) {
        console.warn('[st-momo] uploadMedia failed, fallback data URI', e);
        return { url: dataUrl, dataUrl, storedAs: 'data', uploadError: e?.message || String(e) };
    }
}

/**
 * Resolve peer reference image for Seedream `images` array.
 * @param {object} peer
 */
export function getPeerReferenceImage(peer) {
    if (!peer) return '';
    if (peer.seedreamRefEnabled === false || peer.seedreamRefEnabled === 'false') return '';
    return String(
        peer.seedreamRefDataUrl
        || peer.seedreamRefUrl
        || peer.referenceImage
        || '',
    ).trim();
}

/**
 * Turn a stored ref (http URL or data URI) into an API-ready image string.
 * Prefers data URI so Atlas receives the actual pixels (avoids dead/wrong remote URLs).
 * @param {string} ref
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function resolveReferenceForApi(ref, opts = {}) {
    const raw = String(ref || '').trim();
    if (!raw) throw new Error('参考图为空');
    if (/^data:image\//i.test(raw)) return raw;

    if (/^https?:\/\//i.test(raw)) {
        try {
            const res = await fetch(raw, { signal: opts.signal, mode: 'cors' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            if (!String(blob.type || '').startsWith('image/')) {
                // still try; some CDNs omit type
            }
            return await compressImageToDataUrl(blob);
        } catch (e) {
            console.warn('[st-momo] fetch ref as data URI failed, pass URL through', e);
            return raw;
        }
    }

    throw new Error('参考图格式无效（需要 http(s) URL 或 data:image）');
}

/**
 * Seedream Edit needs instruction-style prompts that refer to image 1.
 * Plain "casual selfie" prompts tend to ignore the reference and invent a new person.
 * @param {object} peer
 * @param {string} scenePrompt
 */
export function buildPersonalImagePrompt(peer, scenePrompt) {
    const scene = String(scenePrompt || '').trim() || 'a natural casual photo';
    const tags = String(peer?.seedreamPromptTags || peer?.imageTags || '')
        .split(/[,，\n]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .join(', ');
    const look = tags ? ` Appearance hints: ${tags}.` : '';
    return [
        'Edit image 1.',
        'Keep the exact same person from image 1: same face, facial features, hair, skin tone, body proportions and identity.',
        'Do not invent a different person or swap identity.',
        `Change only the scene / pose / clothing / framing as requested: ${scene}.`,
        look,
        'Photorealistic result, natural lighting, preserve identity above all else.',
    ].join(' ').replace(/\s+/g, ' ').trim().slice(0, 900);
}

/**
 * Call Seedream edit for a friend with reference image.
 * @param {{ peer: object, prompt: string, settings: object, signal?: AbortSignal }} opts
 */
export async function generatePersonalImage(opts) {
    const { peer, prompt, settings, signal } = opts || {};
    if (!isSeedreamConfigured(settings)) {
        throw Object.assign(new Error('请先在「我」页启用 Seedream 并填写 API Key'), { code: 'seedream_off' });
    }
    const refStored = getPeerReferenceImage(peer);
    if (!refStored) {
        throw Object.assign(new Error('请先在好友「编辑资料」上传个人形象参考图'), { code: 'no_ref' });
    }
    const cfg = getSeedreamConfig(settings);
    const finalPrompt = buildPersonalImagePrompt(peer, prompt);
    if (!finalPrompt) throw new Error('缺少生图描述');

    const refForApi = await resolveReferenceForApi(refStored, { signal });
    if (!refForApi) throw new Error('参考图无法加载');

    try {
        console.info('[st-momo] Seedream edit', {
            model: cfg.model,
            promptPreview: finalPrompt.slice(0, 160),
            refKind: /^data:image\//i.test(refForApi) ? 'data-uri' : 'url',
            refChars: refForApi.length,
        });
    } catch {
        // ignore
    }

    return generateSeedreamImage({
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        size: cfg.size,
        outputFormat: cfg.outputFormat,
        thinking: cfg.thinking,
        pollIntervalMs: cfg.pollIntervalMs,
        pollTimeoutMs: cfg.pollTimeoutMs,
        enableBase64Output: false,
        prompt: finalPrompt,
        images: [refForApi],
        signal,
    });
}

/**
 * Create an image_prompt message and kick off generation.
 * @param {import('./storage.js').MomoStore} store
 * @param {string} peerId
 * @param {{ prompt: string, from?: 'me'|'them' }} opts
 */
export function appendImagePromptMessage(store, peerId, opts) {
    const prompt = String(opts?.prompt || '').trim().slice(0, 600);
    const from = opts?.from === 'me' ? 'me' : 'them';
    const msg = {
        id: uid('msg'),
        from,
        type: 'image_prompt',
        text: `[个人图片]（${prompt}）`,
        imagePrompt: prompt,
        imageGenStatus: 'idle',
        usePersonalReference: true,
        createdAt: store.now(),
    };
    store.appendMessage(peerId, msg);
    return msg;
}

/**
 * Generate / regenerate for an existing message id.
 * @param {import('./storage.js').MomoStore} store
 * @param {string} peerId
 * @param {string} messageId
 * @param {{ onUpdate?: () => void }} [hooks]
 */
export async function fulfillImagePromptMessage(store, peerId, messageId, hooks = {}) {
    const lockKey = `${peerId}:${messageId}`;
    if (_locks.has(lockKey)) return;
    _locks.add(lockKey);

    const peer = store.getFriend(peerId);
    const messages = store.getMessages(peerId);
    const message = messages.find((m) => String(m?.id || '') === String(messageId || ''));
    if (!peer || !message) {
        _locks.delete(lockKey);
        return;
    }

    const settings = store.getSettings();
    const prompt = String(message.imagePrompt || parsePersonalImageTag(message.text)?.prompt || '').trim();

    store.updateMessage(peerId, messageId, {
        imageGenStatus: 'loading',
        imageGenError: '',
        type: 'image_prompt',
        usePersonalReference: true,
        imagePrompt: prompt,
    });
    hooks.onUpdate?.();

    try {
        const result = await generatePersonalImage({ peer, prompt, settings });
        store.updateMessage(peerId, messageId, {
            type: 'image',
            text: prompt ? `[图片] ${prompt}` : '[图片]',
            imageUrl: result.imageUrl,
            imagePrompt: prompt,
            imageGenStatus: 'done',
            imageGenError: '',
            imageModel: result.model,
            imageProvider: 'seedream',
        });
        hooks.onUpdate?.();
        return result;
    } catch (e) {
        const err = String(e?.message || e || '生图失败').slice(0, 160);
        store.updateMessage(peerId, messageId, {
            imageGenStatus: 'failed',
            imageGenError: err,
        });
        hooks.onUpdate?.();
        throw e;
    } finally {
        _locks.delete(lockKey);
    }
}

/**
 * If bubble text is a personal-image tag, append + generate; else return false.
 */
export async function tryHandlePersonalImageBubble(store, peerId, bubbleText, hooks = {}) {
    const parsed = parsePersonalImageTag(bubbleText);
    if (!parsed) return false;
    const settings = store.getSettings();
    if (!isSeedreamConfigured(settings)) return false;

    const msg = appendImagePromptMessage(store, peerId, {
        prompt: parsed.prompt,
        from: 'them',
    });
    hooks.onUpdate?.();
    // fire-and-forget generation; errors surface on the card
    fulfillImagePromptMessage(store, peerId, msg.id, hooks).catch((e) => {
        console.warn('[st-momo] personal image gen failed', e);
    });
    return true;
}

export { isSeedreamConfigured, getSeedreamConfig };
