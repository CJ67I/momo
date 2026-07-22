/**
 * Interop between Momo and SillyTavern main chat.
 *
 * Modes:
 * - off:  no cross-injection into main generation
 * - soft: update extension prompt slot only (does NOT write chat bubbles)
 * - hard: soft + rare curated system lines for key RP events (never feed refreshes)
 *
 * Soft inject uses ONLY IN_PROMPT + SYSTEM role.
 * Never use IN_CHAT + ASSISTANT (causes empty main replies on many CC backends).
 */

import { isMainChatGenerating } from './api-client.js';

const MODULE_NAME = 'st-momo';
export const INTEROP_KEY = 'st-momo-interop';
/** Legacy keys that may still sit in ST extension_prompts from older builds. */
const LEGACY_PROMPT_KEYS = Object.freeze([
    'st-momo-interop',
    'st-momo-inject',
    'st-momo-story',
    'st-momo',
]);

export const INTEROP_MODES = Object.freeze(['off', 'soft', 'hard']);

/** IN_PROMPT — do not use IN_CHAT + ASSISTANT role (causes empty main replies). */
const POSITION_IN_PROMPT = 0;
const DEPTH = 0;
const ROLE_SYSTEM = 0;

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
 * Wipe any momo-related extension prompt slots (including legacy keys).
 * Prefer direct delete on ctx.extensionPrompts when available.
 */
export function purgeAllMomoPrompts() {
    const ctx = getCtx();
    const bag = ctx?.extensionPrompts;
    if (bag && typeof bag === 'object') {
        for (const key of Object.keys(bag)) {
            if (key.startsWith('st-momo') || LEGACY_PROMPT_KEYS.includes(key)) {
                try {
                    delete bag[key];
                } catch {
                    /* ignore */
                }
            }
        }
    }

    if (typeof ctx?.setExtensionPrompt === 'function') {
        for (const key of LEGACY_PROMPT_KEYS) {
            try {
                ctx.setExtensionPrompt(key, '', POSITION_IN_PROMPT, DEPTH, false, ROLE_SYSTEM);
            } catch {
                /* ignore */
            }
        }
    }
    return true;
}

/**
 * Safe soft inject — IN_PROMPT + SYSTEM only; empty value clears the slot.
 */
export function applySoftPrompt() {
    const ctx = getCtx();
    if (typeof ctx?.setExtensionPrompt !== 'function') return false;

    const mode = getInteropMode();
    const value = mode === 'off' ? '' : buildPromptBlock();

    try {
        if (!value) {
            // Fully remove rather than leave an empty IN_CHAT leftover
            const bag = ctx.extensionPrompts;
            if (bag && typeof bag === 'object') {
                delete bag[INTEROP_KEY];
            }
            ctx.setExtensionPrompt(INTEROP_KEY, '', POSITION_IN_PROMPT, DEPTH, false, ROLE_SYSTEM);
            return true;
        }
        ctx.setExtensionPrompt(INTEROP_KEY, value, POSITION_IN_PROMPT, DEPTH, false, ROLE_SYSTEM);
        return true;
    } catch (e) {
        console.warn('[st-momo] setExtensionPrompt failed', e);
        return false;
    }
}

export function clearSoftPrompt() {
    eventLog = [];
    purgeAllMomoPrompts();
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

async function waitForMainIdle(timeoutMs = 90_000) {
    const t0 = Date.now();
    while (isMainChatGenerating()) {
        if (Date.now() - t0 > timeoutMs) return false;
        await new Promise((r) => setTimeout(r, 300));
    }
    return true;
}

async function hardInjectChat(text) {
    const ctx = getCtx();
    if (!ctx || !Array.isArray(ctx.chat)) return false;

    // Never mutate chat UI mid-stream — that detaches streamingProcessor nodes
    // and can leave an empty assistant bubble on screen / in save.
    const idle = await waitForMainIdle();
    if (!idle) {
        console.warn('[st-momo] hard inject skipped: main chat still busy');
        return false;
    }

    const mes = `【陌陌·剧情同步】${text}`;
    try {
        // Prefer ST narrator system message when available
        if (typeof ctx.sendSystemMessage === 'function') {
            try {
                ctx.sendSystemMessage('narrator', mes);
                return true;
            } catch {
                try {
                    ctx.sendSystemMessage('generic', mes);
                    return true;
                } catch {
                    /* fall through to manual push */
                }
            }
        }

        const msg = {
            name: '陌陌',
            is_user: false,
            is_system: true,
            is_name: true,
            send_date: Date.now(),
            mes,
            extra: {
                type: 'narrator',
                isSmallSys: true,
                momoInterop: true,
            },
        };
        ctx.chat.push(msg);
        await ctx.saveChat?.();
        // Only re-render when not generating
        if (!isMainChatGenerating()) {
            try {
                ctx.printMessages?.();
            } catch {
                /* ignore */
            }
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
    if (mode === 'off') {
        clearSoftPrompt();
        return mode;
    }
    if (!eventLog.length) {
        // Keep slot empty but ensure legacy IN_CHAT keys are gone
        purgeAllMomoPrompts();
        return mode;
    }
    applySoftPrompt();
    return mode;
}

export function getInteropEventLog() {
    return [...eventLog];
}
