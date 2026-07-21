import { pick } from './utils.js';

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
 * Try SillyTavern generateRaw; fall back to local template replies.
 * @param {{peer: object, history: Array, userText: string, myProfile: object}} opts
 */
export async function generateNpcReply(opts) {
    const { peer, history, userText, myProfile, useAi = true } = opts;

    if (useAi) {
        try {
            const ctx = window.SillyTavern?.getContext?.();
            const generateRaw = ctx?.generateRaw;
            if (typeof generateRaw === 'function') {
                const recent = (history || [])
                    .slice(-8)
                    .map((m) => `${m.from === 'me' ? myProfile.nickname : peer.nickname}: ${m.text}`)
                    .join('\n');

                const systemPrompt = [
                    '你正在模拟社交软件「陌陌」里的用户，用口语化中文短句回复。',
                    `人设：昵称${peer.nickname}，${peer.age}岁，${peer.city}，${peer.gender === 'female' ? '女' : '男'}。`,
                    `简介：${peer.bio || '无'}；标签：${(peer.tags || []).join('、') || '无'}`,
                    '要求：只输出 1-2 句回复正文，不要旁白、引号或角色说明。',
                ].join('\n');

                const prompt = [
                    `对方昵称：${myProfile.nickname}`,
                    '最近对话：',
                    recent || '(无)',
                    `对方刚说：${userText}`,
                ].join('\n');

                let result;
                try {
                    result = await generateRaw({ systemPrompt, prompt });
                } catch {
                    // 兼容旧版 positional API
                    result = await generateRaw(`${systemPrompt}\n${prompt}\n你的回复：`);
                }
                const text = String(result || '').trim().replace(/^["「]|["」]$/g, '');
                if (text) return text.slice(0, 180);
            }
        } catch (e) {
            console.warn('[st-momo] AI reply failed, using fallback', e);
        }
    }

    return pick(FALLBACK_REPLIES);
}
