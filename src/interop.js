/**
 * Interop between Momo and SillyTavern main chat.
 *
 * Dual-track (aligned with public virtual-phone capability model):
 * - off:  online silence — no cross-injection into main generation
 * - soft: offline sense — extension prompt slot with events + DM digests (no chat bubbles)
 * - hard: soft + rare curated system lines for key RP events (match / add-friend)
 *
 * Soft inject uses ONLY IN_PROMPT + SYSTEM role.
 * Never use IN_CHAT + ASSISTANT (causes empty main replies on many CC backends).
 * Never push raw Momo DM bubbles into ctx.chat.
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

const DIGEST_MAX_PEERS = 3;
const DIGEST_MSGS_PER_PEER = 5;
const DIGEST_LINE_MAX = 72;
const DIGEST_TOTAL_MAX = 1000;

/** @type {string[]} */
let eventLog = [];

/** @type {import('./storage.js').MomoStore|null} */
let digestStore = null;

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
    return 'soft';
}

export function isInteropOn(settings = null) {
    return getInteropMode(settings) !== 'off';
}

function clipLine(text, max = 120) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, max)}…`;
}

/**
 * Build a compact DM digest from store chats for the soft prompt slot.
 * @param {import('./storage.js').MomoStore|null|undefined} store
 * @returns {string}
 */
export function buildChatDigest(store) {
    if (!store?.getChatList || !store?.getMessages) return '';

    const list = store.getChatList()
        .filter((item) => (item?.updatedAt || 0) > 0)
        .slice(0, DIGEST_MAX_PEERS);

    if (!list.length) return '';

    const lines = ['【陌陌私聊摘要】主线生成时可自然感知，勿复读系统公告或逐条复述：'];
    let total = lines[0].length;

    for (const item of list) {
        const friend = item.friend;
        const name = friend?.nickname || '好友';
        const msgs = (store.getMessages(friend.id) || []).slice(-DIGEST_MSGS_PER_PEER);
        if (!msgs.length) continue;

        const header = `· 与「${name}」：`;
        if (total + header.length > DIGEST_TOTAL_MAX) break;
        lines.push(header);
        total += header.length;

        for (const m of msgs) {
            const who = m.from === 'me' ? '我' : 'TA';
            const body = clipLine(m.text, DIGEST_LINE_MAX);
            if (!body) continue;
            const row = `  ${who}：${body}`;
            if (total + row.length > DIGEST_TOTAL_MAX) break;
            lines.push(row);
            total += row.length;
        }
    }

    return lines.length > 1 ? lines.join('\n') : '';
}

function buildPromptBlock(store = digestStore) {
    const parts = [];
    if (eventLog.length) {
        parts.push([
            '【陌陌近况｜扩展提示，非聊天气泡】',
            '以下为玩家在陌陌 App 中的近期重要动态，生成主线回复时可自然感知，不要复读系统公告口吻：',
            ...eventLog.map((line, i) => `${i + 1}. ${line}`),
        ].join('\n'));
    }
    const digest = buildChatDigest(store);
    if (digest) parts.push(digest);
    return parts.join('\n\n');
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
export function applySoftPrompt(store = digestStore) {
    const ctx = getCtx();
    if (typeof ctx?.setExtensionPrompt !== 'function') return false;

    const mode = getInteropMode();
    const value = mode === 'off' ? '' : buildPromptBlock(store);

    try {
        if (!value) {
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
 * Refresh soft prompt from store digests + in-memory events.
 * Call after DM send/reply, clearChat, deleteFriend, mount, settings save.
 * @param {import('./storage.js').MomoStore|null|undefined} store
 */
export function syncInteropDigest(store = null) {
    if (store) digestStore = store;
    const mode = getInteropMode();
    if (mode === 'off') {
        purgeAllMomoPrompts();
        return false;
    }
    return applySoftPrompt(digestStore);
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
    applySoftPrompt(digestStore);

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

/**
 * @param {import('./storage.js').MomoStore|null|undefined} [store]
 */
export function syncInteropFromSettings(store = null) {
    if (store) digestStore = store;
    const mode = getInteropMode();
    if (mode === 'off') {
        clearSoftPrompt();
        return mode;
    }
    purgeAllMomoPrompts();
    applySoftPrompt(digestStore);
    return mode;
}

export function getInteropEventLog() {
    return [...eventLog];
}
