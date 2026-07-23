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

function escapeReg(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip HTML / markdown junk models sometimes leak into IM text.
 */
export function cleanBubbleText(raw) {
    let t = String(raw ?? '');
    t = t
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/?[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#\d+;/g, ' ')
        .replace(/\[([^\]]{1,24})\]\([^)]*\)/g, '$1')
        .replace(/^["「『]|["」』]$/g, '')
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
        .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    return t;
}

/**
 * Drop bubbles that look truncated / unfinished mid-sentence.
 */
function looksTruncated(text) {
    const t = String(text || '').trim();
    if (!t) return true;
    if (/<(br|div|p|span)\b/i.test(t)) return true;
    if (/https?:\/\/\S*$/i.test(t)) return true;
    // Ends with connector / incomplete clause common in cutoffs
    if (/(如何在|怎么在|可以教你|我想说|其实我|比如说|然后就|所以就|不过我|但是我)$/.test(t)) return true;
    if (/[，、：:\-—…]$/.test(t) && t.length < 8) return true;
    // Cut mid-CJK word-ish: ends with lone Latin letter fragment after Chinese
    if (/[\u4e00-\u9fff][A-Za-z]{1,3}$/.test(t)) return true;
    return false;
}

/**
 * Parse model output into short chat bubbles (up to 6).
 * Prefers ||| / newlines (truncation-safe); JSON as fallback.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseReplyBubbles(raw) {
    const s = String(raw || '').trim();
    if (!s) return [];

    /** @type {string[]} */
    let list = [];

    if (s.includes('|||')) {
        list = s.split('|||').map((t) => cleanBubbleText(t)).filter(Boolean);
    }

    if (!list.length) {
        // JSON array (may be truncated — try repair)
        const arrStart = s.indexOf('[');
        if (arrStart >= 0) {
            let body = s.slice(arrStart);
            const arrEnd = body.lastIndexOf(']');
            if (arrEnd > 0) body = body.slice(0, arrEnd + 1);
            else {
                // Truncated JSON: close open string + array best-effort
                body = body.replace(/,\s*$/, '');
                if ((body.match(/"/g) || []).length % 2 === 1) body += '"';
                body += ']';
            }
            try {
                const data = JSON.parse(body);
                if (Array.isArray(data)) {
                    list = data.map((x) => cleanBubbleText(x)).filter(Boolean);
                }
            } catch {
                // Pull complete quoted strings even from broken JSON
                const quoted = [...s.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)]
                    .map((m) => cleanBubbleText(m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ')))
                    .filter((t) => t.length >= 1 && !/^(回复|输出|json)/i.test(t));
                if (quoted.length) list = quoted;
            }
        }
    }

    if (!list.length) {
        list = s
            .split(/[\n\r]+/)
            .map((line) => line.replace(/^\s*[-*]?\s*\d+[\.\)、]\s*/, '').trim())
            .map((t) => cleanBubbleText(t))
            .filter((t) => t.length >= 1 && !/^(回复|输出|json|\[)/i.test(t));
    }

    if (!list.length) {
        const one = cleanBubbleText(
            s.replace(/^(回复|答|作为[^:：]+)[:：]\s*/i, ''),
        );
        if (one) list = [one];
    }

    // Drop truncated tail bubble (common when max_tokens cuts mid-string)
    while (list.length && looksTruncated(list[list.length - 1])) {
        list.pop();
    }

    return list
        .map((t) => t.slice(0, 80))
        .filter(Boolean)
        .slice(0, 6);
}

/**
 * Drop / strip bubbles that clearly speak as the player.
 * @param {string[]} bubbles
 * @param {{ npcName: string, playerName: string }} ids
 */
function sanitizeNpcBubbles(bubbles, ids) {
    const player = String(ids.playerName || '').trim();
    if (!bubbles?.length) return [];

    const out = [];
    for (const raw of bubbles) {
        let t = cleanBubbleText(raw);
        if (!t) continue;

        t = t
            .replace(/^(玩家|user|User)\s*[:：]\s*/i, '')
            .replace(new RegExp(`^${escapeReg(player)}\\s*[:：]\\s*`, 'i'), '')
            .trim();
        if (!t) continue;

        const claimsPlayer = player.length >= 1 && (
            new RegExp(`^(我是|我叫)\\s*${escapeReg(player)}`).test(t)
            || new RegExp(`以\\s*${escapeReg(player)}\\s*的身份`).test(t)
        );
        if (claimsPlayer) continue;
        if (player && (t.startsWith(`${player}：`) || t.startsWith(`${player}:`))) continue;
        if (looksTruncated(t)) continue;

        out.push(t.slice(0, 80));
    }
    return out.slice(0, 6);
}

/**
 * Format Momo DM history (full length, clear speaker labels).
 */
function formatMomoHistory(history, peerName, playerName) {
    const list = Array.isArray(history) ? history : [];
    if (!list.length) return '(尚无聊天记录)';
    return list
        .map((m) => {
            const isPlayer = m.from === 'me';
            const who = isPlayer ? `玩家「${playerName}」` : `你「${peerName}」`;
            return `${who}: ${cleanBubbleText(m.text)}`;
        })
        .filter((line) => !line.endsWith(': '))
        .join('\n');
}

/**
 * Generate NPC reply bubble(s). Throws on failure — no local canned replies.
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
            `你是陌陌用户「${npcName}」（${genderLabel}/${peer?.age ?? '?'}岁/${peer?.city || '未知'}）。`,
            `正在和「${playerName}」私聊。你不是玩家，也不要变成酒馆主线角色。`,
        ].join('');

        // Natural IM style (inspired by multi-bubble WeChat patterns: short, sequential, human)
        const styleRules = [
            '用中国人真人微信/陌陌私聊口吻，像随手打字，不要小说腔、主持人口播、推销话术。',
            '条数自由：可以 1 条，也可以连发多条短消息（跟人聊天一样想到哪发到哪），一般 1–5 条都正常。',
            '每条尽量短（一般不超过 30 字），可残缺句、语气词；用多条拆开说，不要写成一大段。',
            '禁止：HTML/markdown/br标签、旁白、括号内心戏、表情包代码、列点、标题。',
            '禁止：过度彩虹屁、油腻搭讪、每句都用网络热词、整齐对仗的“金句”。',
            '先接住对方上一句再说自己的事；不要连续自我介绍或自我夸耀。',
            peer.speechStyle ? `个人口癖参考：${String(peer.speechStyle).slice(0, 80)}` : '',
        ].filter(Boolean);

        const systemPrompt = [
            identityLock,
            ...styleRules,
            '',
            `【你的资料】简介：${peer.bio || '无'}；标签：${(peer.tags || []).join('、') || '无'}`,
            peer.persona ? `人设提要：${String(peer.persona).slice(0, 160)}` : '',
            '',
            loreBlock,
            '',
            '输出格式：只输出气泡正文，多条用 ||| 分隔。不要 JSON、不要编号、不要引号包裹整段。',
            '示例：真的假的|||我也想去|||周末有空吗',
        ].filter(Boolean).join('\n');

        const prompt = [
            `玩家「${playerName}」刚说：${cleanBubbleText(userText)}`,
            '【陌陌私聊记录】',
            momoHistoryText,
            `以「${npcName}」回复（可用 ||| 连发多条短消息）。写完就停，不要把句子写一半：`,
        ].join('\n');

        // Headroom for multi-bubble natural replies
        const result = await callMomoGenerate(systemPrompt, prompt, 720);
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
            // Human-like gap: longer after longer bubbles
            const lag = 420 + Math.min(900, String(list[i]).length * 28)
                + Math.floor(Math.random() * 380);
            // eslint-disable-next-line no-await-in-loop
            await sleep(lag);
        }
    }
}
