/**
 * Background AI enrichment of friend persona + speech style.
 */

import { canUseTavernApi } from './ai-names.js';
import { normalizeGender, toast, uid } from './utils.js';

const pending = new Set();

function parseJsonBlock(raw) {
    const text = String(raw || '').trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1] : text;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(body.slice(start, end + 1));
    } catch {
        return null;
    }
}

/**
 * @param {object} user
 * @returns {Promise<object|null>} enriched fields
 */
export async function generateFriendPersona(user) {
    if (!user?.id || !canUseTavernApi()) return null;
    try {
        const ctx = window.SillyTavern?.getContext?.();
        const generateRaw = ctx?.generateRaw;
        if (typeof generateRaw !== 'function') return null;

        const gender = normalizeGender(user.gender) === 'female' ? '女' : '男';
        const systemPrompt = [
            '你是角色卡撰写助手。为陌陌社交 App 的 NPC 好友生成完整人设。',
            '只输出一个 JSON 对象，不要 Markdown 说明。字段：',
            '{"persona":"完整人物设定200字内","speechStyle":"对话风格与口癖说明80字内",',
            '"bio":"一句话简介40字内","about":"主页关于我120字内","job":"职业",',
            '"relationship":"情感状态","tags":["标签1","标签2"],',
            '"moments":["动态1","动态2","动态3"]}',
            '要求：现代都市真人感，禁止古风仙侠腔，禁止复读输入信息。',
        ].join('\n');

        const prompt = [
            `昵称：${user.nickname}`,
            `年龄：${user.age}`,
            `城市：${user.city}`,
            `性别：${gender}`,
            `已有简介：${user.bio || '无'}`,
            '请生成完整人设 JSON：',
        ].join('\n');

        let result;
        try {
            result = await generateRaw({ systemPrompt, prompt, responseLength: 520 });
        } catch {
            result = await generateRaw(`${systemPrompt}\n\n${prompt}`);
        }
        const data = parseJsonBlock(result);
        if (!data || typeof data !== 'object') return null;

        const tags = Array.isArray(data.tags)
            ? data.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 4)
            : (user.tags || []);
        const moments = Array.isArray(data.moments)
            ? data.moments.map((t, i) => ({
                id: uid('mom'),
                text: String(t).trim().slice(0, 60),
                createdAt: Date.now() - (i + 1) * 3600_000 * 3,
            })).filter((m) => m.text)
            : (user.homepage?.moments || []);

        return {
            persona: String(data.persona || '').trim().slice(0, 400),
            speechStyle: String(data.speechStyle || '').trim().slice(0, 160),
            bio: String(data.bio || user.bio || '').trim().slice(0, 40) || user.bio,
            tags: tags.length ? tags : user.tags,
            personaReady: true,
            personaGeneratedAt: Date.now(),
            homepage: {
                ...(user.homepage || {}),
                about: String(data.about || user.homepage?.about || '').trim().slice(0, 280),
                job: String(data.job || user.homepage?.job || '').trim().slice(0, 20),
                relationship: String(data.relationship || user.homepage?.relationship || '').trim().slice(0, 20),
                moments: moments.length ? moments : (user.homepage?.moments || []),
                note: `${user.nickname} 的陌陌主页（AI 人设）`,
            },
        };
    } catch (e) {
        console.warn('[st-momo] friend persona gen failed', e);
        return null;
    }
}

/**
 * Fire-and-forget enrichment; safe to call multiple times.
 * @param {import('./app.js').MomoApp} app
 * @param {object} user
 */
export function scheduleFriendPersonaEnrichment(app, user) {
    if (!app?.store || !user?.id) return;
    if (user.personaReady && user.persona && user.speechStyle) return;
    if (pending.has(user.id)) return;
    pending.add(user.id);

    (async () => {
        try {
            toast(`正在为 ${user.nickname} 生成人设…`, 'info');
            const patch = await generateFriendPersona(user);
            if (!patch) {
                toast(`${user.nickname} 人设生成失败（需酒馆 API 在线）`, 'warning');
                return;
            }
            const latest = app.store.getFriend(user.id) || user;
            app.store.updateUser({ ...latest, ...patch });
            toast(`已生成 ${user.nickname} 的完整人设与对话风格`, 'success');
            if (app.open && (app.tab === 'chat' || app.stackPage === 'profile')) {
                app.render(app.stackPage === 'profile' ? 'profile' : app.tab);
            }
        } finally {
            pending.delete(user.id);
        }
    })();
}
