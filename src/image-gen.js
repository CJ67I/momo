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

const IMAGE_TAG_CORE = '(?:个人)?(?:图片|照片|自拍|形象图|美照)';

/**
 * True if bubble looks like an image placeholder / send-photo intent tag.
 * Covers `[个人图片]` / `【图片】` / `[图片]……` etc.
 * @param {string} text
 */
export function isImageIntentBubble(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    if (new RegExp(`^[\\[【]\\s*${IMAGE_TAG_CORE}\\s*[\\]】]`, 'i').test(raw)) return true;
    if (new RegExp(`^(?:发一张|发个|给你看|这是我的)?\\s*[\\[【]\\s*${IMAGE_TAG_CORE}\\s*[\\]】]`, 'i').test(raw)) return true;
    // Models often write: 【图片】...... / [图片]…… / 【照片】xxx
    if (new RegExp(`[\\[【]\\s*${IMAGE_TAG_CORE}\\s*[\\]】]\\s*[.。…·\\-—]*`, 'i').test(raw)
        && raw.length <= 80) {
        return true;
    }
    return false;
}

/**
 * Parse NPC/user image tags into a scene prompt.
 * Accepts `[个人图片]（描述）` / `【图片】……` / `[照片]: xxx` etc.
 * @param {string} text
 * @returns {{ prompt: string, raw: string }|null}
 */
export function parsePersonalImageTag(text) {
    const raw = String(text || '').trim();
    if (!raw || !isImageIntentBubble(raw)) return null;

    const m = raw.match(new RegExp(
        `^[\\[【]\\s*${IMAGE_TAG_CORE}\\s*[\\]】]\\s*(?:[（(]\\s*([\\s\\S]+?)\\s*[）)]|[:：]\\s*([\\s\\S]+)|[-—]\\s*([\\s\\S]+)|([\\s\\S]*))\\s*$`,
        'i',
    ));
    let prompt = '';
    if (m) {
        prompt = String(m[1] || m[2] || m[3] || m[4] || '').trim();
    } else {
        // strip leading tag then take remainder
        prompt = raw
            .replace(new RegExp(`^[\\[【]\\s*${IMAGE_TAG_CORE}\\s*[\\]】]\\s*`, 'i'), '')
            .trim();
    }
    // Dots / ellipsis placeholders → default scene
    if (!prompt || /^[.。…·\-\s]+$/.test(prompt)) {
        prompt = 'casual selfie, natural lighting, looking at camera';
    }
    return { prompt: prompt.slice(0, 600), raw };
}

/** User text asks the peer to send a photo. */
export function userAskedForPhoto(text) {
    const t = String(text || '');
    return /照片|自拍|发张图|发个图|发图片|看看你|看看样子|长什么样|露个脸|看看你现在|发张自拍|看看你今天/.test(t);
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
 * Resolve subject (friend or profile) reference image for Seedream `images`.
 * @param {object} subject
 */
export function getPeerReferenceImage(subject) {
    if (!subject) return '';
    if (subject.seedreamRefEnabled === false || subject.seedreamRefEnabled === 'false') return '';
    return String(
        subject.seedreamRefDataUrl
        || subject.seedreamRefUrl
        || subject.referenceImage
        || '',
    ).trim();
}

/** @param {object} profile */
export function getUserReferenceImage(profile) {
    return getPeerReferenceImage(profile);
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
 * @param {object} subject friend or profile
 * @param {string} scenePrompt
 */
export function buildPersonalImagePrompt(subject, scenePrompt) {
    const scene = String(scenePrompt || '').trim() || 'a natural casual photo';
    const tags = String(subject?.seedreamPromptTags || subject?.imageTags || '')
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
 * Call Seedream edit with a subject reference (friend or self profile).
 * @param {{
 *   subject?: object,
 *   peer?: object,
 *   prompt: string,
 *   settings: object,
 *   signal?: AbortSignal,
 *   noRefHint?: string,
 * }} opts
 */
export async function generatePersonalImage(opts) {
    const { prompt, settings, signal } = opts || {};
    const subject = opts.subject || opts.peer;
    if (!isSeedreamConfigured(settings)) {
        throw Object.assign(new Error('请先在「我」页启用 Seedream 并填写 API Key'), { code: 'seedream_off' });
    }
    const refStored = getPeerReferenceImage(subject);
    if (!refStored) {
        throw Object.assign(
            new Error(opts.noRefHint || '请先上传个人形象参考图'),
            { code: 'no_ref' },
        );
    }
    const cfg = getSeedreamConfig(settings);
    const finalPrompt = buildPersonalImagePrompt(subject, prompt);
    if (!finalPrompt) throw new Error('缺少生图描述');

    const refForApi = await resolveReferenceForApi(refStored, { signal });
    if (!refForApi) throw new Error('参考图无法加载');

    try {
        console.info('[st-momo] Seedream edit', {
            model: cfg.model,
            promptPreview: finalPrompt.slice(0, 160),
            refKind: /^data:image\//i.test(refForApi) ? 'data-uri' : 'url',
            refChars: refForApi.length,
            subject: subject?.id || subject?.nickname || '?',
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
 * @param {{ prompt: string, from?: 'me'|'them', useUserReference?: boolean }} opts
 */
export function appendImagePromptMessage(store, peerId, opts) {
    const prompt = String(opts?.prompt || '').trim().slice(0, 600);
    const from = opts?.from === 'me' ? 'me' : 'them';
    const useUserReference = opts?.useUserReference === true;
    const msg = {
        id: uid('msg'),
        from,
        type: 'image_prompt',
        text: useUserReference ? `[用户照片]（${prompt}）` : `[个人图片]（${prompt}）`,
        imagePrompt: prompt,
        imageGenStatus: 'idle',
        usePersonalReference: !useUserReference,
        useUserReference,
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
    if (!message || (!peer && message.from !== 'me')) {
        _locks.delete(lockKey);
        return;
    }

    const settings = store.getSettings();
    const useUser = message.useUserReference === true || /^\[\s*用户照片\s*\]/.test(String(message.text || ''));
    const subject = useUser ? store.getProfile() : peer;
    const prompt = String(message.imagePrompt || parsePersonalImageTag(message.text)?.prompt || '').trim();

    store.updateMessage(peerId, messageId, {
        imageGenStatus: 'loading',
        imageGenError: '',
        type: 'image_prompt',
        usePersonalReference: !useUser,
        useUserReference: useUser,
        imagePrompt: prompt,
    });
    hooks.onUpdate?.();

    try {
        const result = await generatePersonalImage({
            subject,
            prompt,
            settings,
            noRefHint: useUser
                ? '请先在「我」页上传自己的形象参考图'
                : '请先在好友编辑资料里上传个人形象参考图',
        });
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
 * If bubble text is an image tag / 【图片】 placeholder, append + generate.
 */
export async function tryHandlePersonalImageBubble(store, peerId, bubbleText, hooks = {}) {
    const parsed = parsePersonalImageTag(bubbleText);
    if (!parsed) return false;
    const settings = store.getSettings();
    if (!isSeedreamConfigured(settings)) return false;
    const peer = store.getFriend(peerId);
    if (!getPeerReferenceImage(peer)) return false;

    const msg = appendImagePromptMessage(store, peerId, {
        prompt: parsed.prompt,
        from: 'them',
    });
    hooks.onUpdate?.();
    fulfillImagePromptMessage(store, peerId, msg.id, hooks).catch((e) => {
        console.warn('[st-momo] personal image gen failed', e);
    });
    return true;
}

export { isSeedreamConfigured, getSeedreamConfig };
