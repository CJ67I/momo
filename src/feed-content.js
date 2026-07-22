/**
 * AI-only feed post generation.
 * No local content template library — each post is a fresh API call with diversity constraints.
 */

import { canUseTavernApi } from './ai-names.js';
import { normalizeGender, uid } from './utils.js';

export const DEFAULT_FEED_PROMPT = [
    '你是中文社交 App「陌陌」动态文案生成器。',
    '必须严格按人物信息创作一条全新短动态，像真人随手发出。',
    '只输出动态正文：口语自然，18-42 字。',
    '禁止引号、禁止 #话题、禁止解释、禁止复述设定、禁止鸡汤口号、禁止模板腔。',
    '内容要具体到场景细节，避免空泛的「今天天气真好」「又是普通的一天」。',
].join('\n');

function getSettingsBucket() {
    try {
        return window.SillyTavern?.getContext?.()?.extensionSettings?.['st-momo']?.settings || {};
    } catch {
        return {};
    }
}

export function getFeedContentSettings(settings = null) {
    const s = settings || getSettingsBucket();
    const prompt = String(s.feedPrompt ?? '').trim() || DEFAULT_FEED_PROMPT;
    return { prompt };
}

/**
 * @param {string} tpl
 * @param {object} user
 * @param {{ spice?: string }} [extra]
 */
export function fillFeedPlaceholders(tpl, user, extra = {}) {
    const gender = normalizeGender(user?.gender) === 'female' ? '女' : '男';
    const tag = (user?.tags && user.tags[0]) || '';
    return String(tpl || '')
        .replaceAll('{{nickname}}', String(user?.nickname || 'TA'))
        .replaceAll('{{city}}', String(user?.city || '这座城'))
        .replaceAll('{{age}}', String(user?.age ?? ''))
        .replaceAll('{{tag}}', String(tag || '无'))
        .replaceAll('{{bio}}', String(user?.bio || '无'))
        .replaceAll('{{gender}}', gender)
        .replaceAll('{{spice}}', String(extra.spice || ''))
        .trim();
}

function sanitizeFeedText(raw) {
    return String(raw || '')
        .replace(/^["'「」]|["'「」]$/g, '')
        .replace(/^\d+[\.\)、]\s*/, '')
        .split(/[\n\r]/)[0]
        .replace(/^(动态|正文|内容)[:：]\s*/i, '')
        .trim()
        .slice(0, 80);
}

function tooSimilar(a, b) {
    const x = String(a || '').replace(/\s+/g, '');
    const y = String(b || '').replace(/\s+/g, '');
    if (!x || !y) return false;
    if (x === y) return true;
    if (x.length >= 8 && y.includes(x.slice(0, 8))) return true;
    if (y.length >= 8 && x.includes(y.slice(0, 8))) return true;
    // simple bigram overlap
    const grams = (s) => {
        const set = new Set();
        for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
        return set;
    };
    const A = grams(x);
    const B = grams(y);
    let hit = 0;
    A.forEach((g) => { if (B.has(g)) hit += 1; });
    const score = hit / Math.max(A.size, 1);
    return score > 0.55;
}

function buildSpice(user, index, avoid) {
    const roll = Math.floor(Math.random() * 100000);
    const hour = new Date().getHours();
    const slots = ['清晨出门', '午间空隙', '下班路上', '夜里刷手机', '周末游荡', '等人时分', '刚吃完饭', '地铁里'];
    const slot = slots[(index + roll) % slots.length];
    return [
        `唯一编号 ${uid('postseed').slice(-6)}`,
        `序号 ${index + 1}`,
        `时间感 ${slot}（现实钟点约 ${hour} 点，仅作氛围，勿写钟点数字）`,
        `必须出现或暗示城市「${user?.city || ''}」的同城生活碎片，但不要写成旅游攻略`,
        avoid.length
            ? `绝对不要与下列已生成动态雷同或改写：\n- ${avoid.slice(-8).join('\n- ')}`
            : '这是本批第一条，请写得具体、有画面',
    ].join('\n');
}

/**
 * @param {object} user
 * @param {ReturnType<typeof getFeedContentSettings>} [cfg]
 * @param {{ avoid?: string[], index?: number }} [opts]
 */
export async function resolvePostText(user, cfg = null, opts = {}) {
    const settings = cfg || getFeedContentSettings();
    const avoid = opts.avoid || [];
    const index = opts.index || 0;

    if (!canUseTavernApi()) {
        console.warn('[st-momo] feed requires online ST API');
        return null;
    }

    try {
        const ctx = window.SillyTavern?.getContext?.();
        const generateRaw = ctx?.generateRaw;
        if (typeof generateRaw !== 'function') return null;

        const spice = buildSpice(user, index, avoid);
        const userPrompt = fillFeedPlaceholders(
            `${settings.prompt || DEFAULT_FEED_PROMPT}\n\n【本条约束】\n{{spice}}\n\n人物：昵称 {{nickname}}；年龄 {{age}}；城市 {{city}}；性别 {{gender}}；简介 {{bio}}；标签 {{tag}}。\n请直接输出一条动态：`,
            user,
            { spice },
        );

        const systemPrompt = [
            '你只输出一条陌陌动态正文。',
            '严禁输出多条、编号列表、解释、前后缀。',
            '严禁套用万能模板；每条必须有不可替换的具体细节。',
            '若提示词与「本条约束」冲突，以本条约束的差异化要求优先。',
        ].join('\n');

        let result;
        try {
            result = await generateRaw({ systemPrompt, prompt: userPrompt, responseLength: 90 });
        } catch {
            result = await generateRaw(`${systemPrompt}\n\n${userPrompt}`);
        }

        let text = sanitizeFeedText(result);
        if (!text || text.length < 4) return null;

        // one retry if too similar to previous
        if (avoid.some((prev) => tooSimilar(text, prev))) {
            const retryPrompt = `${userPrompt}\n\n上一条候选「${text}」与已有内容过像，请彻底换场景重写一条：`;
            let retry;
            try {
                retry = await generateRaw({ systemPrompt, prompt: retryPrompt, responseLength: 90 });
            } catch {
                retry = await generateRaw(`${systemPrompt}\n\n${retryPrompt}`);
            }
            const alt = sanitizeFeedText(retry);
            if (alt && alt.length >= 4 && !avoid.some((prev) => tooSimilar(alt, prev))) {
                text = alt;
            }
        }

        return text;
    } catch (e) {
        console.warn('[st-momo] AI feed text failed', e);
        return null;
    }
}

/**
 * Sequential generation so later posts can avoid earlier ones (reduces homogenization).
 * @param {object[]} users
 * @param {object} [settings]
 * @returns {Promise<(string|null)[]>}
 */
export async function resolvePostTexts(users, settings = null) {
    const cfg = getFeedContentSettings(settings);
    const list = users || [];
    const out = [];
    const avoid = [];

    for (let i = 0; i < list.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        const text = await resolvePostText(list[i], cfg, { avoid, index: i });
        out.push(text);
        if (text) avoid.push(text);
    }
    return out;
}
