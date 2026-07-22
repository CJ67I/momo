/**
 * AI-only feed post generation by channel.
 * No local content template library — every post body comes from the tavern API.
 */

import { canUseTavernApi } from './ai.js';
import { normalizeGender, uid } from './utils.js';

export const FEED_CHANNELS = Object.freeze(['recommend', 'nearby', 'friends']);
export const FEED_PAGE_SIZE = 8;

export const DEFAULT_FEED_PROMPT = [
    '你是中文社交 App「陌陌」动态文案生成器。',
    '必须严格按人物信息与栏目约束创作一条全新短动态，像真人随手发出。',
    '只输出动态正文：口语自然，18-48 字。',
    '禁止引号、禁止解释、禁止复述设定、禁止鸡汤口号、禁止模板腔。',
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
        .replaceAll('{{persona}}', String(user?.persona || user?.homepage?.about || '无'))
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
        .slice(0, 96);
}

function tooSimilar(a, b) {
    const x = String(a || '').replace(/\s+/g, '');
    const y = String(b || '').replace(/\s+/g, '');
    if (!x || !y) return false;
    if (x === y) return true;
    if (x.length >= 8 && y.includes(x.slice(0, 8))) return true;
    if (y.length >= 8 && x.includes(y.slice(0, 8))) return true;
    const grams = (s) => {
        const set = new Set();
        for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
        return set;
    };
    const A = grams(x);
    const B = grams(y);
    let hit = 0;
    A.forEach((g) => { if (B.has(g)) hit += 1; });
    return hit / Math.max(A.size, 1) > 0.55;
}

function channelRules(channel, user) {
    const city = String(user?.city || '').trim() || '同城';
    if (channel === 'nearby') {
        return [
            `栏目：附近 / 同城。城市必须是「${city}」。`,
            `正文必须自然带出「${city}」同城生活感，并嵌入一个同城话题钩子（本地店、街区、活动、通勤槽点等），方便别人筛人。`,
            '可以带一个短 #同城话题（不超过 8 字），不要写成旅游攻略。',
        ].join('\n');
    }
    if (channel === 'friends') {
        return [
            '栏目：好友动态。你就是这位已加好友的用户本人在发动态。',
            '语气、兴趣要贴合其简介/人设；像熟人刷到的更新，不要像广告。',
            '不要提「附近」「同城推荐」等产品词。',
        ].join('\n');
    }
    return [
        '栏目：推荐。生成一条「可能与浏览者发生互动」的趣味动态。',
        '要有互动钩子：提问、邀约、吐槽求接话、找搭子等，让人想点赞或私聊。',
        '不要强调同城；城市可自然出现也可不出现。禁止鸡汤与空洞招呼。',
    ].join('\n');
}

function buildSpice(channel, user, index, avoid) {
    return [
        `唯一编号 ${uid('postseed').slice(-6)}`,
        `序号 ${index + 1}`,
        channelRules(channel, user),
        avoid.length
            ? `绝对不要与下列已生成动态雷同或改写：\n- ${avoid.slice(-8).join('\n- ')}`
            : '这是本批第一条，请写得具体、有画面、有互动感',
    ].join('\n');
}

async function callGenerateRaw(systemPrompt, userPrompt) {
    const ctx = window.SillyTavern?.getContext?.();
    const generateRaw = ctx?.generateRaw;
    if (typeof generateRaw !== 'function') return null;
    try {
        return await generateRaw({ systemPrompt, prompt: userPrompt, responseLength: 120 });
    } catch {
        return generateRaw(`${systemPrompt}\n\n${userPrompt}`);
    }
}

/**
 * @param {object} user
 * @param {ReturnType<typeof getFeedContentSettings>} [cfg]
 * @param {{ avoid?: string[], index?: number, channel?: string }} [opts]
 */
export async function resolvePostText(user, cfg = null, opts = {}) {
    const settings = cfg || getFeedContentSettings();
    const avoid = opts.avoid || [];
    const index = opts.index || 0;
    const channel = FEED_CHANNELS.includes(opts.channel) ? opts.channel : 'nearby';

    if (!canUseTavernApi()) {
        console.warn('[st-momo] feed requires online ST API');
        return null;
    }

    try {
        const spice = buildSpice(channel, user, index, avoid);
        const userPrompt = fillFeedPlaceholders(
            `${settings.prompt || DEFAULT_FEED_PROMPT}\n\n【本条约束】\n{{spice}}\n\n人物：昵称 {{nickname}}；年龄 {{age}}；城市 {{city}}；性别 {{gender}}；简介 {{bio}}；标签 {{tag}}；人设摘要 {{persona}}。\n请直接输出一条动态：`,
            user,
            { spice },
        );

        const systemPrompt = [
            '你只输出一条陌陌动态正文。',
            '严禁输出多条、编号列表、解释、前后缀。',
            '严禁套用万能模板；每条必须有不可替换的具体细节。',
            '若提示词与「本条约束」冲突，以本条约束的栏目要求优先。',
        ].join('\n');

        let text = sanitizeFeedText(await callGenerateRaw(systemPrompt, userPrompt));
        if (!text || text.length < 4) return null;

        if (avoid.some((prev) => tooSimilar(text, prev))) {
            const retryPrompt = `${userPrompt}\n\n上一条候选「${text}」与已有内容过像，请彻底换场景重写一条：`;
            const alt = sanitizeFeedText(await callGenerateRaw(systemPrompt, retryPrompt));
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
 * Recommend tab: one API call invents author + interactive post (no local content pool).
 * @returns {Promise<{ nickname: string, age: number, city: string, bio: string, text: string, gender: string }|null>}
 */
export async function resolveRecommendCard(profile, opts = {}) {
    if (!canUseTavernApi()) return null;

    const myGender = normalizeGender(profile?.gender);
    const targetGender = myGender === 'female' ? 'male' : 'female';
    const avoid = opts.avoid || [];
    const index = opts.index || 0;
    const myCity = String(profile?.city || '').trim();

    const systemPrompt = [
        '你是陌陌「推荐」信息流生成器。',
        '只输出一行 JSON，不要 markdown，不要解释。',
        '字段：nickname, age, city, bio, text。',
        'text 是动态正文（18-48 字），必须有互动钩子，像真人想找人聊天。',
        '禁止本地模板腔、鸡汤、空洞招呼。',
    ].join('\n');

    const userPrompt = [
        `浏览者：${profile?.nickname || '旅人'}，${myGender === 'female' ? '女' : '男'}，城市 ${myCity || '未知'}。`,
        `请生成一名异性（${targetGender === 'female' ? '女' : '男'}）用户的推荐卡片。`,
        `唯一编号 ${uid('rec').slice(-6)}；序号 ${index + 1}。`,
        avoid.length ? `text 不要与下列雷同：\n- ${avoid.slice(-6).join('\n- ')}` : '',
        'JSON 示例：{"nickname":"晚风不回消息","age":24,"city":"杭州","bio":"徒步爱好者","text":"有没有人周末想去爬附近小山，别只回哈哈"}',
    ].filter(Boolean).join('\n');

    try {
        const raw = String(await callGenerateRaw(systemPrompt, userPrompt) || '').trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        const data = JSON.parse(jsonMatch[0]);
        const text = sanitizeFeedText(data.text);
        const nickname = String(data.nickname || '').trim().slice(0, 16);
        if (!text || text.length < 4 || !nickname) return null;
        if (avoid.some((prev) => tooSimilar(text, prev))) return null;

        const age = Number(data.age);
        return {
            nickname,
            age: Number.isFinite(age) && age >= 18 && age <= 45 ? Math.floor(age) : 18 + Math.floor(Math.random() * 14),
            city: String(data.city || myCity || '未知').trim().slice(0, 12) || '未知',
            bio: String(data.bio || '').trim().slice(0, 40),
            text,
            gender: targetGender,
        };
    } catch (e) {
        console.warn('[st-momo] recommend card failed', e);
        return null;
    }
}

/**
 * Sequential generation so later posts can avoid earlier ones.
 * @param {object[]} users
 * @param {object} [settings]
 * @param {{ channel?: string }} [opts]
 * @returns {Promise<(string|null)[]>}
 */
export async function resolvePostTexts(users, settings = null, opts = {}) {
    const cfg = getFeedContentSettings(settings);
    const list = users || [];
    const out = [];
    const avoid = [];
    const channel = opts.channel || 'nearby';

    for (let i = 0; i < list.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        const text = await resolvePostText(list[i], cfg, { avoid, index: i, channel });
        out.push(text);
        if (text) avoid.push(text);
    }
    return out;
}
