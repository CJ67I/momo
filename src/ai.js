import { callMomoGenerate, ensureGenerationGuard } from './api-client.js';
import { buildInteractionContext, formatContextForPrompt, getApiStatus } from './st-bridge.js';

/**
 * Check whether ST API is ready for generation.
 */
export function canUseTavernApi() {
    const s = getApiStatus();
    return Boolean(s.available && s.online);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse model output into 1–4 short chat bubbles.
 * Accepts JSON array, ||| separators, or numbered lines.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseReplyBubbles(raw) {
    const s = String(raw || '').trim();
    if (!s) return [];

    // JSON array
    const arrStart = s.indexOf('[');
    const arrEnd = s.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
        try {
            const data = JSON.parse(s.slice(arrStart, arrEnd + 1));
            if (Array.isArray(data)) {
                const list = data
                    .map((x) => String(x ?? '').trim())
                    .map((t) => t.replace(/^["「『]|["」』]$/g, ''))
                    .filter((t) => t.length >= 1)
                    .slice(0, 4);
                if (list.length) return list.map((t) => t.slice(0, 120));
            }
        } catch {
            /* fall through */
        }
    }

    if (s.includes('|||')) {
        const list = s.split('|||').map((t) => t.trim()).filter(Boolean).slice(0, 4);
        if (list.length) return list.map((t) => t.slice(0, 120));
    }

    // Numbered / multi-line short bubbles
    const lines = s
        .split(/[\n\r]+/)
        .map((line) => line.replace(/^\s*[-*]?\s*\d+[\.\)、]\s*/, '').trim())
        .map((t) => t.replace(/^["「『]|["」』]$/g, ''))
        .filter((t) => t.length >= 1 && !/^(回复|输出|json)/i.test(t));

    if (lines.length >= 2 && lines.every((t) => t.length <= 80)) {
        return lines.slice(0, 4).map((t) => t.slice(0, 120));
    }

    const one = s
        .replace(/^["「『]|["」』]$/g, '')
        .replace(/^(回复|答|作为[^:：]+)[:：]\s*/i, '')
        .trim();
    return one ? [one.slice(0, 240)] : [];
}

/**
 * Drop / strip bubbles that clearly speak as the player.
 * @param {string[]} bubbles
 * @param {{ npcName: string, playerName: string }} ids
 */
function sanitizeNpcBubbles(bubbles, ids) {
    const npc = String(ids.npcName || '').trim();
    const player = String(ids.playerName || '').trim();
    if (!bubbles?.length) return [];

    const out = [];
    for (const raw of bubbles) {
        let t = String(raw || '').trim();
        if (!t) continue;

        // Strip roleplay prefixes like "玩家：" / "旅人：" / "我（玩家）"
        t = t
            .replace(/^(玩家|user|User)\s*[:：]\s*/i, '')
            .replace(new RegExp(`^${escapeReg(player)}\\s*[:：]\\s*`, 'i'), '')
            .trim();

        if (!t) continue;

        // Reject if it claims to be the player
        const claimsPlayer = player.length >= 1 && (
            new RegExp(`^(我是|我叫)\\s*${escapeReg(player)}`).test(t)
            || new RegExp(`以\\s*${escapeReg(player)}\\s*的身份`).test(t)
        );
        if (claimsPlayer) continue;

        // Reject leftover "玩家名:" role prefixes
        if (player && (t.startsWith(`${player}：`) || t.startsWith(`${player}:`))) continue;

        out.push(t);
    }
    return out.length ? out : bubbles.map((b) => String(b || '').trim()).filter(Boolean);
}

function escapeReg(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Format full Momo DM history for the model (no message-count cap).
 * Labels are explicit so the model does not swap player / NPC identity.
 */
function formatMomoHistory(history, peerName, playerName) {
    const list = Array.isArray(history) ? history : [];
    if (!list.length) return '(尚无聊天记录)';
    return list
        .map((m) => {
            const isPlayer = m.from === 'me';
            const who = isPlayer ? `玩家「${playerName}」` : `你「${peerName}」`;
            return `${who}: ${String(m.text || '').trim()}`;
        })
        .filter((line) => !line.endsWith(': '))
        .join('\n');
}

/**
 * Generate NPC reply bubble(s) via ApiClient (isolated from main chat).
 * Returns 1–4 message strings. Never uses local canned replies —
 * throws with a stable code when generation fails.
 * @returns {Promise<string[]>}
 */
export async function generateNpcReplies(opts) {
    const { peer, history, userText, myProfile, useAi = true } = opts;

    if (!useAi) {
        throw Object.assign(new Error('已关闭 AI 回复'), { code: 'ai_disabled' });
    }

    ensureGenerationGuard();
    const status = getApiStatus();
    if (!status.online) {
        throw Object.assign(new Error('酒馆 API 未在线'), { code: 'api_offline' });
    }

    try {
        const bundle = await buildInteractionContext({
            peer,
            userText,
            momoHistory: history,
        });
        const loreBlock = formatContextForPrompt(bundle, { forNpcChat: true });

        const npcName = String(peer?.nickname || '对方').trim() || '对方';
        const playerName = String(
            myProfile?.nickname || bundle.persona?.name || '旅人',
        ).trim() || '旅人';
        const genderLabel = peer?.gender === 'female' ? '女' : '男';

        const momoHistoryText = formatMomoHistory(history, npcName, playerName);

        const identityLock = [
            `【身份锁定｜必须遵守】`,
            `你的名字是「${npcName}」，性别${genderLabel}，年龄${peer?.age ?? '?'}，城市${peer?.city || '未知'}。`,
            `你正在陌陌里以「${npcName}」的身份与玩家「${playerName}」私聊。`,
            `你 ≠ 玩家「${playerName}」，也 ≠ 酒馆主线角色卡里的角色（除非资料明确写你就是）。`,
            `- 只用第一人称说「${npcName}」会说的话；禁止自称「${playerName}」或扮演玩家`,
            `- 禁止替玩家说话、禁止续写玩家台词、禁止输出玩家视角旁白`,
            `- 历史里「玩家「${playerName}」:」是对方说的；「你「${npcName}」:」才是你说过的`,
        ].join('\n');

        const systemPrompt = [
            identityLock,
            '',
            '你正在「陌陌」社交 App 私聊。像真人微信/陌陌：可回 1 条，也可连发 2–4 条短消息。',
            '规则：',
            '- 只输出 JSON 字符串数组，例如 ["哈哈哈","你明天有空吗"]',
            '- 每条很短口语，不要旁白、不要引号包裹整段、不要 OOC 说明',
            '- 简单招呼 → 通常 1 条；兴奋/解释/追问 → 2–3 条；少用 4 条',
            '- 可自然呼应下方背景设定，但不要生硬背设定，更不要变成别人',
            '',
            `【你（${npcName}）的陌陌资料】`,
            `昵称：${npcName}；年龄：${peer.age}；城市：${peer.city}；性别：${genderLabel}`,
            `简介：${peer.bio || '无'}`,
            `标签：${(peer.tags || []).join('、') || '无'}`,
            peer.persona ? `完整人设：${peer.persona}` : '',
            peer.speechStyle ? `对话风格：${peer.speechStyle}` : '',
            peer.homepage?.about ? `主页关于我：${peer.homepage.about}` : '',
            peer.homepage?.job ? `职业：${peer.homepage.job}` : '',
            '',
            loreBlock,
            '',
            identityLock,
        ].filter(Boolean).join('\n');

        const prompt = [
            `对方（玩家）陌陌昵称：${playerName}`,
            `你（NPC）陌陌昵称：${npcName}`,
            '【陌陌私聊完整记录】（从早到晚；按身份标签区分说话人）',
            momoHistoryText,
            `玩家「${playerName}」刚说：${userText}`,
            `请以「${npcName}」的身份回复，只输出 JSON 字符串数组（1–4 条），不要输出玩家的话：`,
        ].join('\n');

        const result = await callMomoGenerate(systemPrompt, prompt, 280);
        const bubbles = sanitizeNpcBubbles(parseReplyBubbles(result), {
            npcName,
            playerName,
        });
        if (bubbles.length) return bubbles;

        throw Object.assign(new Error('AI 未返回有效内容'), { code: 'gen_empty' });
    } catch (e) {
        if (e?.code) throw e;
        console.warn('[st-momo] AI reply failed', e);
        throw Object.assign(new Error(e?.message || '回复生成失败'), {
            code: 'gen_failed',
            cause: e,
        });
    }
}

/**
 * Single-string reply. Throws on failure (no local canned text).
 */
export async function generateNpcReply(opts) {
    const list = await generateNpcReplies(opts);
    if (!list?.[0]) {
        throw Object.assign(new Error('AI 未返回有效内容'), { code: 'gen_empty' });
    }
    return list[0];
}

/**
 * Append NPC bubbles one-by-one with light delay (natural multi-message).
 * @param {(text: string, index: number) => void|Promise<void>} onBubble
 * @param {string[]} bubbles
 */
export async function deliverBubbles(bubbles, onBubble) {
    const list = (bubbles || []).filter(Boolean);
    for (let i = 0; i < list.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await onBubble(list[i], i);
        if (i < list.length - 1) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(380 + Math.floor(Math.random() * 420));
        }
    }
}
