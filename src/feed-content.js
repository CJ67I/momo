/**
 * Feed post text generation: user templates + optional AI prompt.
 */

import { canUseTavernApi } from './ai-names.js';
import { normalizeGender, pick } from './utils.js';

export const DEFAULT_FEED_TEMPLATES = [
    '今天路过的晚霞也太会了',
    '一个人吃火锅也挺幸福的，就是辣椒有点叛逆',
    '新开的咖啡店拉花意外地稳',
    '加班到现在，月亮都比我清醒',
    '周末计划：睡到自然醒，然后继续睡',
    '刷到一只超像我家猫的流浪猫，心动了三秒',
    '刚结束一场很舒服的散步',
    '突然很想听雨，于是打开白噪音假装下雨',
    '有没有人推荐附近不踩雷的小馆？',
    '今日份情绪：轻微兴奋，持续观望',
    '{{city}}的夜风有点甜，适合乱逛',
    '{{age}}岁了还是会为路边小狗停下脚步',
    '和「{{tag}}」同频的人在哪',
    '{{nickname}}说今天也想好好吃饭',
];

export const DEFAULT_FEED_PROMPT = [
    '你是中文社交 App 动态文案助手。',
    '只输出一条动态正文，口语自然，像真实用户随手发的，20-48 字。',
    '不要引号、不要标签、不要话题符号、不要解释。',
    '人物信息：昵称 {{nickname}}，年龄 {{age}}，城市 {{city}}，性别 {{gender}}，简介 {{bio}}，标签 {{tag}}。',
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
    const rawTpl = String(s.feedTemplates ?? '').trim();
    const templates = rawTpl
        ? rawTpl.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        : [...DEFAULT_FEED_TEMPLATES];
    const prompt = String(s.feedPrompt ?? '').trim() || DEFAULT_FEED_PROMPT;
    return {
        templates,
        prompt,
        useAiFeed: s.useAiFeed === true,
    };
}

/**
 * @param {string} tpl
 * @param {object} user
 */
export function fillFeedTemplate(tpl, user) {
    const gender = normalizeGender(user?.gender) === 'female' ? '女' : '男';
    const tag = (user?.tags && user.tags[0]) || '日常';
    return String(tpl || '')
        .replaceAll('{{nickname}}', String(user?.nickname || 'TA'))
        .replaceAll('{{city}}', String(user?.city || '这座城'))
        .replaceAll('{{age}}', String(user?.age ?? ''))
        .replaceAll('{{tag}}', String(tag))
        .replaceAll('{{bio}}', String(user?.bio || ''))
        .replaceAll('{{gender}}', gender)
        .trim();
}

function fromTemplates(user, templates) {
    const pool = templates?.length ? templates : DEFAULT_FEED_TEMPLATES;
    return fillFeedTemplate(pick(pool), user) || pick(DEFAULT_FEED_TEMPLATES);
}

async function fromAi(user, promptTpl) {
    if (!canUseTavernApi()) return null;
    try {
        const ctx = window.SillyTavern?.getContext?.();
        const generateRaw = ctx?.generateRaw;
        if (typeof generateRaw !== 'function') return null;

        const filled = fillFeedTemplate(promptTpl || DEFAULT_FEED_PROMPT, user);
        const systemPrompt = '只输出一条短动态，不要解释。';
        const prompt = filled;

        let result;
        try {
            result = await generateRaw({ systemPrompt, prompt, responseLength: 80 });
        } catch {
            result = await generateRaw(`${systemPrompt}\n${prompt}`);
        }
        const text = String(result || '')
            .replace(/^["'「」]|["'「」]$/g, '')
            .split(/[\n\r]/)[0]
            .replace(/^动态[:：]\s*/, '')
            .trim()
            .slice(0, 80);
        return text.length >= 4 ? text : null;
    } catch (e) {
        console.warn('[st-momo] AI feed text failed', e);
        return null;
    }
}

/**
 * Resolve one post text for a user.
 * @param {object} user
 * @param {ReturnType<typeof getFeedContentSettings>} [cfg]
 */
export async function resolvePostText(user, cfg = null) {
    const settings = cfg || getFeedContentSettings();
    if (settings.useAiFeed) {
        const ai = await fromAi(user, settings.prompt);
        if (ai) return ai;
    }
    return fromTemplates(user, settings.templates);
}

/**
 * Generate texts for many users (parallel when AI on).
 * @param {object[]} users
 * @param {object} [settings]
 */
export async function resolvePostTexts(users, settings = null) {
    const cfg = getFeedContentSettings(settings);
    return Promise.all((users || []).map((u) => resolvePostText(u, cfg)));
}
