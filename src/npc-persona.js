/**
 * Background AI enrichment of friend persona + speech style.
 * Kept small/fast: only persona + speechStyle (+ short bio), with one retry.
 */

import { canUseTavernApi } from './ai.js';
import { callMomoGenerate, ensureGenerationGuard } from './api-client.js';
import { normalizeGender, toast } from './utils.js';

const pending = new Set();

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Prefer `|||` lines; fall back to tiny JSON.
 * @param {string} raw
 * @returns {{ persona: string, speechStyle: string, bio: string }|null}
 */
function parsePersonaResult(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;

    if (text.includes('|||')) {
        const parts = text.split('|||').map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
            return {
                persona: parts[0].slice(0, 220),
                speechStyle: parts[1].slice(0, 100),
                bio: String(parts[2] || '').slice(0, 40),
            };
        }
    }

    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1] : text;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            const data = JSON.parse(body.slice(start, end + 1));
            if (data && typeof data === 'object') {
                const persona = String(data.persona || data.人设 || '').trim();
                const speechStyle = String(data.speechStyle || data.style || data.说话风格 || '').trim();
                if (persona && speechStyle) {
                    return {
                        persona: persona.slice(0, 220),
                        speechStyle: speechStyle.slice(0, 100),
                        bio: String(data.bio || data.简介 || '').trim().slice(0, 40),
                    };
                }
            }
        } catch {
            /* fall through */
        }
    }

    // Loose: first paragraph = persona, second = style
    const lines = text
        .split(/\n+/)
        .map((l) => l.replace(/^(人设|风格|简介)\s*[:：]\s*/, '').trim())
        .filter((l) => l && !/^[{[]/.test(l));
    if (lines.length >= 2) {
        return {
            persona: lines[0].slice(0, 220),
            speechStyle: lines[1].slice(0, 100),
            bio: String(lines[2] || '').slice(0, 40),
        };
    }
    return null;
}

async function requestPersonaOnce(user, opts = {}) {
    const gender = normalizeGender(user.gender) === 'female' ? '女' : '男';
    const systemPrompt = [
        '为陌陌 NPC 写短人设。只输出三行，用 ||| 分隔，不要 JSON、不要解释：',
        '人设正文(≤120字)|||说话风格口癖(≤50字)|||一句话简介(≤30字)',
        '要求：现代都市真人感，禁止古风仙侠，禁止复读输入。',
        opts.force ? '请给出与旧设定不同的新版本。' : '',
    ].filter(Boolean).join('\n');

    const prompt = [
        `${user.nickname}，${gender}，${user.age}岁，${user.city}`,
        user.bio ? `简介参考：${String(user.bio).slice(0, 40)}` : '',
        '直接输出：',
    ].filter(Boolean).join('\n');

    // Small budget = faster + fewer truncations
    const result = await callMomoGenerate(systemPrompt, prompt, 220);
    return parsePersonaResult(result);
}

/**
 * @param {object} user
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<object|null>}
 */
export async function generateFriendPersona(user, opts = {}) {
    if (!user?.id || !canUseTavernApi()) return null;
    try {
        ensureGenerationGuard();

        let data = await requestPersonaOnce(user, opts);
        if (!data?.persona || !data?.speechStyle) {
            await sleep(350);
            data = await requestPersonaOnce(user, { ...opts, force: true });
        }
        if (!data?.persona || !data?.speechStyle) return null;

        return {
            persona: data.persona,
            speechStyle: data.speechStyle,
            bio: data.bio || user.bio || '',
            personaReady: true,
            personaGeneratedAt: Date.now(),
            homepage: {
                ...(user.homepage || {}),
                about: data.persona.slice(0, 160),
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
 * @param {{ force?: boolean }} [opts]
 */
export function scheduleFriendPersonaEnrichment(app, user, opts = {}) {
    if (!app?.store || !user?.id) return;
    if (!opts.force && user.personaReady && user.persona && user.speechStyle) return;
    if (pending.has(user.id)) return;
    pending.add(user.id);

    (async () => {
        try {
            toast(`正在为 ${user.nickname} 生成人设…`, 'info');
            const patch = await generateFriendPersona(user, opts);
            if (!patch) {
                toast(`${user.nickname} 人设生成失败（需酒馆 API 在线，可点重新生成）`, 'warning');
                return;
            }
            const latest = app.store.getFriend(user.id) || user;
            app.store.updateUser({ ...latest, ...patch });
            toast(`已生成 ${user.nickname} 的人设与对话风格`, 'success');
            if (app.open && (app.tab === 'chat' || app.stackPage === 'profile')) {
                app.render(app.stackPage === 'profile' ? 'profile' : app.tab);
            }
        } finally {
            pending.delete(user.id);
        }
    })();
}
