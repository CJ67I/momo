/**
 * AI-only feed generation — batch-first (1 API call ≈ 8 posts).
 * No local post-text libraries.
 */

import { callMomoGenerate, ensureGenerationGuard } from './api-client.js';
import { canUseTavernApi } from './ai.js';
import { normalizeGender, shuffle, uid } from './utils.js';

export const FEED_CHANNELS = Object.freeze(['recommend', 'nearby', 'friends']);
export const FEED_PAGE_SIZE = 8;

/** City labels for recommend diversification (not post content). */
export const CITY_POOL = Object.freeze([
    '北京', '上海', '广州', '深圳', '杭州', '成都', '重庆', '武汉',
    '南京', '苏州', '西安', '长沙', '郑州', '天津', '青岛', '厦门',
    '宁波', '无锡', '合肥', '福州', '济南', '大连', '昆明', '沈阳',
    '长春', '哈尔滨', '石家庄', '南昌', '贵阳', '南宁', '海口', '兰州',
]);

export const DEFAULT_FEED_PROMPT = [
    '你是中文社交 App「陌陌」动态文案生成器。',
    '必须严格按人物信息与栏目约束创作全新短动态，像真人随手发出。',
    '口语自然，每条 18-48 字。',
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
        .replace(/^(动态|正文|内容|text)\s*[:：]\s*/i, '')
        .trim()
        .slice(0, 96);
}

function sanitizeNickname(raw) {
    return String(raw || '')
        .replace(/["'「」『』【】\[\]()（）]/g, '')
        .replace(/^(昵称|网名|名字|nickname)\s*[:：]\s*/i, '')
        .split(/[\n\r|,，]/)[0]
        .replace(/\s+/g, '')
        .trim()
        .slice(0, 16);
}

function clampAge(n) {
    const age = Number(n);
    if (Number.isFinite(age) && age >= 18 && age <= 45) return Math.floor(age);
    return 18 + Math.floor(Math.random() * 14);
}

/**
 * Pick `count` distinct cities, optionally avoiding the user's city first.
 * @param {number} count
 * @param {string} [avoidCity]
 */
export function pickDistinctCities(count, avoidCity = '') {
    const avoid = String(avoidCity || '').trim();
    const pool = shuffle(CITY_POOL.filter((c) => c !== avoid));
    const extra = avoid ? shuffle(CITY_POOL.filter((c) => c === avoid)) : [];
    const merged = [...pool, ...extra];
    const out = [];
    for (const c of merged) {
        if (out.length >= count) break;
        if (!out.includes(c)) out.push(c);
    }
    while (out.length < count) out.push(CITY_POOL[out.length % CITY_POOL.length]);
    return out;
}

async function callGenerateRaw(systemPrompt, userPrompt, responseLength = 900) {
    ensureGenerationGuard();
    try {
        return await callMomoGenerate(systemPrompt, userPrompt, responseLength);
    } catch (e) {
        console.warn('[st-momo] feed generate failed', e);
        return null;
    }
}

function extractJsonArray(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1].trim() : s;
    const start = body.indexOf('[');
    const end = body.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    try {
        const data = JSON.parse(body.slice(start, end + 1));
        return Array.isArray(data) ? data : null;
    } catch {
        return null;
    }
}

/**
 * Batch: recommend feed (random cities pre-assigned).
 * @returns {Promise<object[]>}
 */
export async function generateRecommendBatch(profile, count = FEED_PAGE_SIZE) {
    if (!canUseTavernApi()) return [];

    const myGender = normalizeGender(profile?.gender);
    const targetGender = myGender === 'female' ? 'male' : 'female';
    const myCity = String(profile?.city || '').trim();
    const cities = pickDistinctCities(count, myCity);
    const cfg = getFeedContentSettings();

    const systemPrompt = [
        '你是陌陌「推荐」信息流批量生成器。',
        '只输出一个 JSON 数组，不要 markdown，不要解释。',
        `必须正好 ${count} 个对象，字段：nickname, age, city, bio, text。`,
        'text：18-48 字动态，必须有互动钩子（提问/邀约/吐槽求接话）。',
        '每条 city 必须严格使用给定城市，禁止全部写成同一城，禁止抄浏览者城市除非名单里有。',
        'nickname 要像真实网名，彼此不要雷同。',
    ].join('\n');

    const slots = cities.map((city, i) => `${i + 1}. city 必须是「${city}」`).join('\n');
    const userPrompt = [
        cfg.prompt,
        '',
        `浏览者：${profile?.nickname || '旅人'}（${myGender === 'female' ? '女' : '男'}，住在 ${myCity || '未知'}）。`,
        `生成 ${count} 名异性（${targetGender === 'female' ? '女' : '男'}）推荐卡片。`,
        `唯一批次 ${uid('rec').slice(-6)}`,
        '城市分配（必须遵守）：',
        slots,
        '输出示例：[{"nickname":"晚风不回消息","age":24,"city":"杭州","bio":"徒步","text":"周末有人想去爬山吗，别只回哈哈"}]',
    ].join('\n');

    let rows = extractJsonArray(await callGenerateRaw(systemPrompt, userPrompt, 1200));
    if (!rows?.length) {
        rows = extractJsonArray(await callGenerateRaw(systemPrompt, `${userPrompt}\n\n上次未得到合法 JSON 数组，请重新只输出 JSON 数组：`, 1200));
    }
    if (!rows?.length) return [];

    const out = [];
    const usedNames = new Set();
    for (let i = 0; i < count; i++) {
        const row = rows[i] || {};
        const nickname = sanitizeNickname(row.nickname) || `推荐用户${i + 1}`;
        if (usedNames.has(nickname) && sanitizeNickname(row.nickname)) {
            // keep anyway with suffix
        }
        usedNames.add(nickname);
        const text = sanitizeFeedText(row.text);
        if (!text || text.length < 4) continue;
        out.push({
            nickname,
            age: clampAge(row.age),
            city: cities[i] || sanitizeNickname(row.city) || '未知',
            bio: String(row.bio || '').trim().slice(0, 40),
            text,
            gender: targetGender,
        });
    }
    return out;
}

/**
 * Batch: nearby feed — all authors locked to profile city.
 * @returns {Promise<object[]>}
 */
export async function generateNearbyBatch(profile, count = FEED_PAGE_SIZE) {
    if (!canUseTavernApi()) return [];

    const myGender = normalizeGender(profile?.gender);
    const targetGender = myGender === 'female' ? 'male' : 'female';
    const city = String(profile?.city || '').trim() || '同城';
    const cfg = getFeedContentSettings();

    const systemPrompt = [
        '你是陌陌「附近/同城」信息流批量生成器。',
        '只输出一个 JSON 数组，不要 markdown，不要解释。',
        `必须正好 ${count} 个对象，字段：nickname, age, bio, text。`,
        `所有人城市都是「${city}」，不要输出 city 字段。`,
        `text 必须带「${city}」同城生活感，并含同城话题钩子（本地店/街区/通勤/活动），可带短 #话题。`,
        'nickname 彼此不同，像真实网名。',
    ].join('\n');

    const userPrompt = [
        cfg.prompt,
        '',
        `浏览者住在「${city}」，要看同城附近动态。`,
        `生成 ${count} 名异性（${targetGender === 'female' ? '女' : '男'}）同城用户动态。`,
        `唯一批次 ${uid('near').slice(-6)}`,
        `输出示例：[{"nickname":"地铁末班车","age":26,"bio":"设计师","text":"${city}这雨也太大了 #同城吐槽 有伞的路过吗"}]`,
    ].join('\n');

    let rows = extractJsonArray(await callGenerateRaw(systemPrompt, userPrompt, 1200));
    if (!rows?.length) {
        rows = extractJsonArray(await callGenerateRaw(systemPrompt, `${userPrompt}\n\n请只输出合法 JSON 数组：`, 1200));
    }
    if (!rows?.length) return [];

    const out = [];
    for (let i = 0; i < Math.min(count, rows.length); i++) {
        const row = rows[i] || {};
        const nickname = sanitizeNickname(row.nickname) || `同城${i + 1}`;
        const text = sanitizeFeedText(row.text);
        if (!text || text.length < 4) continue;
        out.push({
            nickname,
            age: clampAge(row.age),
            city,
            bio: String(row.bio || '').trim().slice(0, 40),
            text,
            gender: targetGender,
        });
    }
    return out;
}

/**
 * Batch: friend posts for sampled friends.
 * @param {object[]} friends
 * @returns {Promise<{id:string,text:string}[]>}
 */
export async function generateFriendsBatch(friends) {
    if (!canUseTavernApi() || !friends?.length) return [];

    const cfg = getFeedContentSettings();
    const list = friends.slice(0, FEED_PAGE_SIZE);

    const systemPrompt = [
        '你是陌陌「好友动态」批量生成器。',
        '只输出一个 JSON 数组，不要 markdown，不要解释。',
        '每个对象字段：id, text。id 必须原样使用给定好友 id。',
        'text：该好友会发的 18-48 字动态，贴合其人设，不要广告腔。',
    ].join('\n');

    const roster = list.map((f, i) => {
        const bits = [
            `${i + 1}. id=${f.id}`,
            `昵称=${f.nickname}`,
            `城=${f.city || ''}`,
            `简介=${(f.bio || '').slice(0, 40)}`,
            f.persona ? `人设=${String(f.persona).slice(0, 80)}` : '',
        ].filter(Boolean);
        return bits.join('；');
    }).join('\n');

    const userPrompt = [
        cfg.prompt,
        '',
        `为下列 ${list.length} 位好友各写一条动态：`,
        roster,
        `唯一批次 ${uid('fr').slice(-6)}`,
        '输出示例：[{"id":"abc","text":"加班到现在，谁还没睡出来冒个泡"}]',
    ].join('\n');

    let rows = extractJsonArray(await callGenerateRaw(systemPrompt, userPrompt, 1000));
    if (!rows?.length) {
        rows = extractJsonArray(await callGenerateRaw(systemPrompt, `${userPrompt}\n\n请只输出合法 JSON 数组：`, 1000));
    }
    if (!rows?.length) return [];

    const byId = new Map(list.map((f) => [f.id, f]));
    const out = [];
    for (const row of rows) {
        const id = String(row?.id || '').trim();
        if (!byId.has(id)) continue;
        const text = sanitizeFeedText(row.text);
        if (!text || text.length < 4) continue;
        out.push({ id, text });
    }

    // Align missing friends by index fallback once
    if (out.length < list.length) {
        const got = new Set(out.map((x) => x.id));
        for (let i = 0; i < list.length; i++) {
            const f = list[i];
            if (got.has(f.id)) continue;
            const row = rows[i];
            const text = sanitizeFeedText(row?.text);
            if (text && text.length >= 4) out.push({ id: f.id, text });
        }
    }

    return out;
}

/**
 * Batch: match candidates — unique people via one API call (no local nickname pool).
 * @param {object} profile
 * @param {number} [count]
 * @param {{ avoidNames?: string[] }} [opts]
 * @returns {Promise<object[]>}
 */
export async function generateMatchBatch(profile, count = FEED_PAGE_SIZE, opts = {}) {
    if (!canUseTavernApi()) return [];

    const myGender = normalizeGender(profile?.gender);
    const targetGender = myGender === 'female' ? 'male' : 'female';
    const city = String(profile?.city || '').trim() || '同城';
    const avoid = (opts.avoidNames || []).filter(Boolean).slice(-24);

    const systemPrompt = [
        '你是陌陌「匹配」候选人批量生成器。',
        '只输出一个 JSON 数组，不要 markdown，不要解释。',
        `必须正好 ${count} 个对象，字段：nickname, age, bio, tags, job。`,
        'tags 为 1-3 个短标签字符串数组；job 为短职业。',
        'nickname 必须彼此不同，像 2020 年代真实网名，禁止古风、禁止「小X+数字」。',
        'bio 一句口语简介（12-28 字），每人气质不同。',
        `城市统一为「${city}」（不要输出 city 字段）。`,
    ].join('\n');

    const userPrompt = [
        `浏览者：${profile?.nickname || '旅人'}（${myGender === 'female' ? '女' : '男'}），想匹配异性。`,
        `生成 ${count} 名异性（${targetGender === 'female' ? '女' : '男'}）候选人，住在「${city}」。`,
        `唯一批次 ${uid('match').slice(-6)}`,
        avoid.length ? `禁止使用这些已出现过的昵称：${avoid.join('、')}` : '',
        '输出示例：[{"nickname":"晚风不回消息","age":24,"bio":"周末只想徒步和吃火锅","tags":["徒步","火锅"],"job":"设计师"}]',
    ].filter(Boolean).join('\n');

    let rows = extractJsonArray(await callGenerateRaw(systemPrompt, userPrompt, 1100));
    if (!rows?.length) {
        rows = extractJsonArray(await callGenerateRaw(systemPrompt, `${userPrompt}\n\n请只输出合法 JSON 数组：`, 1100));
    }
    if (!rows?.length) return [];

    const out = [];
    const seen = new Set(avoid.map((n) => String(n).toLowerCase()));
    for (let i = 0; i < Math.min(count, rows.length); i++) {
        const row = rows[i] || {};
        let nickname = sanitizeNickname(row.nickname);
        if (!nickname || nickname.length < 2) continue;
        const key = nickname.toLowerCase();
        if (seen.has(key)) {
            nickname = `${nickname}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 16);
            if (seen.has(nickname.toLowerCase())) continue;
        }
        seen.add(nickname.toLowerCase());

        const tags = Array.isArray(row.tags)
            ? row.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 3)
            : [];
        const bio = String(row.bio || '').trim().slice(0, 40);
        const job = String(row.job || '').trim().slice(0, 20);

        out.push({
            nickname,
            age: clampAge(row.age),
            city,
            bio: bio || (job ? `${job} · 在${city}` : `在${city}生活`),
            tags: tags.length ? tags : (job ? [job] : ['同城']),
            job,
            gender: targetGender,
        });
    }
    return out;
}

/** @deprecated single-card path kept unused; batch APIs preferred */
export async function resolveRecommendCard() {
    return null;
}

export async function resolvePostText() {
    return null;
}

export async function resolvePostTexts() {
    return [];
}
