/**
 * Interop between Momo and SillyTavern main chat.
 *
 * Modes:
 * - off:  no cross-injection into main generation
 * - soft: update extension prompt slot only (does NOT write chat bubbles)
 * - hard: soft + rare curated system lines for key RP events (never feed refreshes)
 *
 * Soft inject uses ONLY the stable 4-arg setExtensionPrompt(key, value, position, depth)
 * with position=IN_PROMPT (0) to avoid breaking Chat Completion turns.
 */

const MODULE_NAME = 'st-momo';
export const INTEROP_KEY = 'st-momo-interop';
export const INTEROP_MODES = Object.freeze(['off', 'soft', 'hard']);

/** IN_PROMPT — do not use IN_CHAT + ASSISTANT role (causes empty main replies). */
const POSITION_IN_PROMPT = 0;
const DEPTH = 0;

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
 * @param {object} [settings]
 * @returns {'off'|'soft'|'hard'}
 */
export function getInteropMode(settings = null) {
    const s = settings || getSettings();
    const raw = String(s.interopMode || '').trim().toLowerCase();
    if (INTEROP_MODES.includes(raw)) return raw;
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
 * Safe soft inject — 4-arg form only; empty value clears the slot.
 */
export function applySoftPrompt() {
    const ctx = getCtx();
    if (typeof ctx?.setExtensionPrompt !== 'function') return false;

    const mode = getInteropMode();
    const value = mode === 'off' ? '' : buildPromptBlock();

    try {
        // (key, value, position, depth) — never pass role/scan extras
        ctx.setExtensionPrompt(INTEROP_KEY, value, POSITION_IN_PROMPT, DEPTH);
        return true;
    } catch (e) {
        console.warn('[st-momo] setExtensionPrompt failed', e);
        return false;
    }
}

export function clearSoftPrompt() {
    eventLog = [];
    const ctx = getCtx();
    if (typeof ctx?.setExtensionPrompt === 'function') {
        try {
            ctx.setExtensionPrompt(INTEROP_KEY, '', POSITION_IN_PROMPT, DEPTH);
        } catch {
            /* ignore */
        }
    }
    return true;
}

/**
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
                isSmallSys: true,
            },
        };
        ctx.chat.push(msg);
        // Prefer not to call addOneMessage — can interact with generation UI.
        // Still save so it persists if user refreshes.
        await ctx.saveChat?.();
        // Soft re-render if available without triggering Generate
        try {
            ctx.printMessages?.();
        } catch {
            /* ignore */
        }
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

export function notifyFeedRefresh() {
    return Promise.resolve(false);
}

export function syncInteropFromSettings() {
    const mode = getInteropMode();
    if (mode === 'off' || !eventLog.length) {
        clearSoftPrompt();
        if (mode === 'off') eventLog = [];
        return mode;
    }
    applySoftPrompt();
    return mode;
}

export function getInteropEventLog() {
    return [...eventLog];
}
