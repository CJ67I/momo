/**
 * AI-only feed post generation. No local templates.
 */

import { canUseTavernApi } from './ai-names.js';
import { normalizeGender } from './utils.js';

export const DEFAULT_FEED_PROMPT = [
    '你是中文社交 App「陌陌」动态文案生成器。',
    '必须严格按下列人物信息与风格要求，随机创作一条全新短动态。',
    '只输出动态正文本身：口语自然，像真人随手发，20-48 字。',
    '禁止引号、禁止标签/话题符号、禁止解释、禁止复述设定、禁止模板腔。',
    '每次内容都要不同，可围绕近况、心情、城市碎片、兴趣随手写。',
    '',
    '人物：昵称 {{nickname}}；年龄 {{age}}；城市 {{city}}；性别 {{gender}}；简介 {{bio}}；标签 {{tag}}。',
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
 */
export function fillFeedPlaceholders(tpl, user) {
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

function sanitizeFeedText(raw) {
    return String(raw || '')
        .replace(/^["'「」]|["'「」]$/g, '')
        .split(/[\n\r]/)[0]
        .replace(/^(动态|正文|内容)[:：]\s*/i, '')
        .trim()
        .slice(0, 80);
}

/**
 * Strict AI generation for one post. Throws / returns null if API unavailable.
 * @param {object} user
 * @param {ReturnType<typeof getFeedContentSettings>} [cfg]
 */
export async function resolvePostText(user, cfg = null) {
    const settings = cfg || getFeedContentSettings();
    if (!canUseTavernApi()) {
        console.warn('[st-momo] feed requires online ST API');
        return null;
    }
    try {
        const ctx = window.SillyTavern?.getContext?.();
        const generateRaw = ctx?.generateRaw;
        if (typeof generateRaw !== 'function') return null;

        const filled = fillFeedPlaceholders(settings.prompt || DEFAULT_FEED_PROMPT, user);
        const systemPrompt = [
            '严格遵守用户提示词。',
            '只输出一条动态正文，不要解释，不要列表，不要前后缀。',
            '内容必须是新写的，禁止照搬提示词原文。',
        ].join('\n');

        let result;
        try {
            result = await generateRaw({ systemPrompt, prompt: filled, responseLength: 100 });
        } catch {
            result = await generateRaw(`${systemPrompt}\n\n${filled}`);
        }
        const text = sanitizeFeedText(result);
        return text.length >= 4 ? text : null;
    } catch (e) {
        console.warn('[st-momo] AI feed text failed', e);
        return null;
    }
}

/**
 * @param {object[]} users
 * @param {object} [settings]
 */
export async function resolvePostTexts(users, settings = null) {
    const cfg = getFeedContentSettings(settings);
    const list = users || [];
    // sequential-ish batches to reduce API stampede; still parallel within small chunks
    const out = [];
    const chunk = 3;
    for (let i = 0; i < list.length; i += chunk) {
        const part = list.slice(i, i + chunk);
        // eslint-disable-next-line no-await-in-loop
        const texts = await Promise.all(part.map((u) => resolvePostText(u, cfg)));
        out.push(...texts);
    }
    return out;
}
