/**
 * Interop between Momo and SillyTavern main chat.
 *
 * Modes:
 * - off:  no cross-injection into main generation
 * - soft: update extension prompt slot only (does NOT write chat bubbles)
 * - hard: soft + rare curated system lines for key RP events (never feed refreshes)
 *
 * Inspired by dual-track phone extensions: keep main chat usable while sharing context.
 */

const MODULE_NAME = 'st-momo';
export const INTEROP_KEY = 'st-momo-interop';
export const INTEROP_MODES = Object.freeze(['off', 'soft', 'hard']);

/** @type {string[]} */
let eventLog = [];

function getCtx() {
    try {
        return window.SillyTavern?.getContext?.() || null;
    } catch {
        return null;
    }
}

function getSettings() {
    try {
        return getCtx()?.extensionSettings?.[MODULE_NAME]?.settings || {};
    } catch {
        return {};
    }
}

/**
 * Normalize stored setting (supports legacy storyInject boolean).
 * @param {object} [settings]
 * @returns {'off'|'soft'|'hard'}
 */
export function getInteropMode(settings = null) {
    const s = settings || getSettings();
    const raw = String(s.interopMode || '').trim().toLowerCase();
    if (INTEROP_MODES.includes(raw)) return raw;
    // legacy: storyInject true → hard (old behavior wrote bubbles)
    if (s.storyInject === true) return 'hard';
    return 'off';
}

export function isInteropOn(settings = null) {
    return getInteropMode(settings) !== 'off';
}

function clipLine(text, max = 120) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, max)}…`;
}

function buildPromptBlock() {
    if (!eventLog.length) return '';
    return [
        '【陌陌近况｜扩展提示，非聊天气泡】',
        '以下为玩家在陌陌 App 中的近期重要动态，生成主线回复时可自然感知，不要复读系统公告口吻：',
        ...eventLog.map((line, i) => `${i + 1}. ${line}`),
    ].join('\n');
}

/**
 * Push into ST prompt via setExtensionPrompt — never touches chat[].
 * Signature varies by ST version; try modern then fallbacks.
 */
export function applySoftPrompt() {
    const ctx = getCtx();
    if (typeof ctx?.setExtensionPrompt !== 'function') return false;

    const mode = getInteropMode();
    const value = mode === 'off' ? '' : buildPromptBlock();

    // position: 1 = IN_CHAT (common); depth: 2–4 so it sits near recent turns
    const position = 1;
    const depth = 3;
    const role = 0; // SYSTEM

    try {
        ctx.setExtensionPrompt(INTEROP_KEY, value, position, depth, false, role);
        return true;
    } catch {
        /* try shorter signature */
    }
    try {
        ctx.setExtensionPrompt(INTEROP_KEY, value, position, depth);
        return true;
    } catch {
        /* try minimal */
    }
    try {
        ctx.setExtensionPrompt(INTEROP_KEY, value);
        return true;
    } catch (e) {
        console.warn('[st-momo] setExtensionPrompt failed', e);
        return false;
    }
}

export function clearSoftPrompt() {
    eventLog = [];
    return applySoftPrompt();
}

/**
 * Record an important Momo event for soft (and optionally hard) interop.
 * Feed refreshes must NOT call this.
 * @param {string} line
 * @param {{hard?: boolean}} [opts]
 */
export async function recordInteropEvent(line, opts = {}) {
    const text = clipLine(line, 140);
    if (!text) return false;

    const mode = getInteropMode();
    if (mode === 'off') return false;

    eventLog = [text, ...eventLog.filter((x) => x !== text)].slice(0, 6);
    applySoftPrompt();

    if (mode === 'hard' && opts.hard) {
        return hardInjectChat(text);
    }
    return true;
}

/**
 * Write one curated system line into main chat (hard mode only).
 * Avoid sendSystemMessage when possible — prefer is_system push with clear marker.
 */
async function hardInjectChat(text) {
    const ctx = getCtx();
    if (!ctx || !Array.isArray(ctx.chat)) return false;

    const mes = `【陌陌·剧情同步】${text}`;
    try {
        const msg = {
            name: '陌陌',
            is_user: false,
            is_system: true,
            is_name: true,
            send_date: Date.now(),
            mes,
            extra: {
                type: 'st-momo-interop',
                // Hint for some ST builds / scripts; still may appear in UI
                isSmallSys: true,
            },
        };
        ctx.chat.push(msg);
        if (typeof ctx.addOneMessage === 'function') {
            ctx.addOneMessage(msg);
        }
        await ctx.saveChat?.();
        return true;
    } catch (e) {
        console.warn('[st-momo] hard inject failed', e);
        return false;
    }
}

export function notifyMatchSuccess(user) {
    if (!user) return Promise.resolve(false);
    return recordInteropEvent(
        `在陌陌匹配到 ${user.nickname}（${user.age || '?'}岁 · ${user.city || ''}）并加为好友`,
        { hard: true },
    );
}

export function notifyAddFriend(user) {
    if (!user) return Promise.resolve(false);
    return recordInteropEvent(
        `在陌陌添加了好友 ${user.nickname}`,
        { hard: true },
    );
}

/**
 * Feed refresh: soft-only brief note is optional and OFF by default policy —
 * never hard-inject; never spam. We intentionally no-op.
 */
export function notifyFeedRefresh() {
    return Promise.resolve(false);
}

/** Re-apply soft prompt after mode change */
export function syncInteropFromSettings() {
    const mode = getInteropMode();
    if (mode === 'off') {
        eventLog = [];
        applySoftPrompt();
        return 'off';
    }
    applySoftPrompt();
    return mode;
}

/** For UI / debugging */
export function getInteropEventLog() {
    return [...eventLog];
}
