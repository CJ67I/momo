import { pick } from './utils.js';
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
    return Boolean(s.available && s.hasGenerateRaw && s.online);
}

/**
 * Generate NPC reply via SillyTavern generateRaw, injecting
 * persona / character / world info / main chat history.
 */
export async function generateNpcReply(opts) {
    const { peer, history, userText, myProfile, useAi = true } = opts;

    if (useAi) {
        try {
            const ctx = window.SillyTavern?.getContext?.();
            const generateRaw = ctx?.generateRaw;
            const status = getApiStatus();

            if (typeof generateRaw === 'function' && status.online) {
                const bundle = await buildInteractionContext({
                    peer,
                    userText,
                    momoHistory: history,
                });
                const loreBlock = formatContextForPrompt(bundle);

                const momoRecent = (history || [])
                    .slice(-10)
                    .map((m) => `${m.from === 'me' ? (myProfile.nickname || bundle.persona.name || '玩家') : peer.nickname}: ${m.text}`)
                    .join('\n');

                const systemPrompt = [
                    '你正在「陌陌」社交 App 里扮演一位真实用户，与玩家私聊。',
                    '用口语化中文回复，1-3 句，像真人发消息，不要旁白、不要引号、不要 OOC 说明。',
                    '可以自然地引用世界书与角色设定中的信息，但不要生硬背设定。',
                    '',
                    `【你的陌陌资料】`,
                    `昵称：${peer.nickname}；年龄：${peer.age}；城市：${peer.city}；性别：${peer.gender === 'female' ? '女' : '男'}`,
                    `简介：${peer.bio || '无'}`,
                    `标签：${(peer.tags || []).join('、') || '无'}`,
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
                    '请以陌陌用户身份回复：',
                ].join('\n');

                let result;
                try {
                    result = await generateRaw({
                        systemPrompt,
                        prompt,
                        responseLength: 180,
                    });
                } catch {
                    result = await generateRaw(`${systemPrompt}\n\n${prompt}`);
                }

                const text = String(result || '')
                    .trim()
                    .replace(/^["「『]|["」』]$/g, '')
                    .replace(/^(回复|答|作为[^:：]+)[:：]\s*/i, '');

                if (text) return text.slice(0, 240);
            } else if (typeof generateRaw === 'function' && !status.online) {
                console.warn('[st-momo] ST API offline, using fallback reply');
            }
        } catch (e) {
            console.warn('[st-momo] AI reply failed, using fallback', e);
        }
    }

    return pick(FALLBACK_REPLIES);
}
