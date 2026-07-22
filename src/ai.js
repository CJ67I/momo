import { pick } from './utils.js';
import { callMomoGenerate, ensureGenerationGuard } from './api-client.js';
import { buildInteractionContext, formatContextForPrompt, getApiStatus } from './st-bridge.js';

const FALLBACK_REPLIES = [
    '哈哈哈好有趣，再说详细一点？',
    '我也这么觉得～',
    '今天过得怎么样？',
    '听起来不错诶',
    '那我们下次见一面？先聊聊也行',
    '你平时喜欢做什么？',
    '笑死，这个点我也在刷手机',
    '可以呀，我挺感兴趣的',
    '嗯嗯，我在听',
    '你说话好温柔',
];

/**
 * Check whether ST API is ready for generation.
 */
export function canUseTavernApi() {
    const s = getApiStatus();
    // Online + either generateRaw OR we can hit backend with credentials in-browser
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
 * Generate NPC reply bubble(s) via SillyTavern generateRaw.
 * Returns an array of 1–4 message strings.
 * @returns {Promise<string[]>}
 */
export async function generateNpcReplies(opts) {
    const { peer, history, userText, myProfile, useAi = true } = opts;

    if (useAi) {
        try {
            ensureGenerationGuard();
            const status = getApiStatus();

            if (status.online) {
                const bundle = await buildInteractionContext({
                    peer,
                    userText,
                    momoHistory: history,
                });
                const loreBlock = formatContextForPrompt(bundle);

                const momoRecent = (history || [])
                    .slice(-12)
                    .map((m) => `${m.from === 'me' ? (myProfile.nickname || bundle.persona.name || '玩家') : peer.nickname}: ${m.text}`)
                    .join('\n');

                const systemPrompt = [
                    '你正在「陌陌」社交 App 里扮演一位真实用户，与玩家私聊。',
                    '像真人微信/陌陌聊天：可一次回 1 条，也可连发 2–4 条短消息（拆开更自然）。',
                    '规则：',
                    '- 只输出 JSON 字符串数组，例如 ["哈哈哈","你明天有空吗"]',
                    '- 每条很短口语，不要旁白、不要引号包裹整段、不要 OOC 说明',
                    '- 简单招呼 → 通常 1 条；兴奋/解释/追问 → 2–3 条；少用 4 条',
                    '- 可以自然引用世界书与角色设定，但不要生硬背设定',
                    '',
                    `【你的陌陌资料】`,
                    `昵称：${peer.nickname}；年龄：${peer.age}；城市：${peer.city}；性别：${peer.gender === 'female' ? '女' : '男'}`,
                    `简介：${peer.bio || '无'}`,
                    `标签：${(peer.tags || []).join('、') || '无'}`,
                    peer.persona ? `完整人设：${peer.persona}` : '',
                    peer.speechStyle ? `对话风格：${peer.speechStyle}` : '',
                    peer.homepage?.about ? `主页关于我：${peer.homepage.about}` : '',
                    peer.homepage?.job ? `职业：${peer.homepage.job}` : '',
                    '',
                    loreBlock,
                ].filter(Boolean).join('\n');

                const prompt = [
                    `玩家陌陌昵称：${myProfile.nickname || bundle.persona.name || '旅人'}`,
                    '【陌陌私聊最近记录】',
                    momoRecent || '(无)',
                    `玩家刚说：${userText}`,
                    '请输出 JSON 字符串数组作为回复（1–4 条）：',
                ].join('\n');

                const result = await callMomoGenerate(systemPrompt, prompt, 280);
                const bubbles = parseReplyBubbles(result);
                if (bubbles.length) return bubbles;
            } else {
                console.warn('[st-momo] ST API offline, using fallback reply');
            }
        } catch (e) {
            console.warn('[st-momo] AI reply failed, using fallback', e);
        }
    }

    return [pick(FALLBACK_REPLIES)];
}

/**
 * Backward-compatible single-string reply (joins bubbles with space if needed).
 * Prefer generateNpcReplies for chat UI.
 */
export async function generateNpcReply(opts) {
    const list = await generateNpcReplies(opts);
    return list[0] || pick(FALLBACK_REPLIES);
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
