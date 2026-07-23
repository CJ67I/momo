/**
 * AI-only feed generation — compact line format (fast + cheap tokens).
 * One API call ≈ one channel page. No local post-text libraries.
 */

import { callMomoGenerate, ensureGenerationGuard } from './api-client.js';
import { canUseTavernApi } from './ai.js';
import { normalizeGender, shuffle, uid } from './utils.js';

export const FEED_CHANNELS = Object.freeze(['recommend', 'nearby', 'friends']);
/** Slightly fewer cards → less output tokens, faster refresh. */
export const FEED_PAGE_SIZE = 6;

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

/** Short style hint — avoid pasting the full DEFAULT_FEED_PROMPT every call. */
const STYLE_HINT = '口语短动态18-48字，有互动钩子；禁鸡汤/模板腔/引号/解释。';

function getSettingsBucket() {
    try {
        return window.SillyTavern?.getContext?.()?.extensionSettings?.['st-momo']?.settings || {};
    } catch {
        return {};
    }
}

export function getFeedContentSettings(settings = null) {
    const s = settings || getSettingsBucket();
    const custom = String(s.feedPrompt ?? '').trim();
    // Only inject custom prompt when user changed it; default stays as STYLE_HINT
    const prompt = custom && custom !== DEFAULT_FEED_PROMPT ? custom.slice(0, 280) : STYLE_HINT;
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

async function callFeedModel(systemPrompt, userPrompt, responseLength = 520) {
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
 * Parse compact pipe lines: field1|field2|...
 * Also accepts JSON array fallback.
 * @param {string} raw
 * @param {number} fieldCount
 * @returns {string[][]}
 */
function parsePipeOrJson(raw, fieldCount) {
    const text = String(raw || '').trim();
    if (!text) return [];

    const lines = text
        .split(/[\n\r]+/)
        .map((l) => l.replace(/^\s*\d+[\.\)、]\s*/, '').trim())
        .filter((l) => l && !l.startsWith('```') && !/^输出|示例|格式/i.test(l));

    const pipeRows = [];
    for (const line of lines) {
        if (!line.includes('|')) continue;
        const parts = line.split('|').map((p) => p.trim());
        if (parts.length >= fieldCount) {
            pipeRows.push(parts.slice(0, fieldCount));
        } else if (parts.length >= 2) {
            // pad short rows
            while (parts.length < fieldCount) parts.push('');
            pipeRows.push(parts);
        }
    }
    if (pipeRows.length) return pipeRows;

    const json = extractJsonArray(text);
    if (!json?.length) return [];

    // Map common JSON shapes into ordered fields by caller
    return json.map((row) => {
        if (Array.isArray(row)) {
            const parts = row.map((x) => String(x ?? '').trim());
            while (parts.length < fieldCount) parts.push('');
            return parts.slice(0, fieldCount);
        }
        if (row && typeof row === 'object') {
            // Prefer known keys in a stable order when present
            const keys = Object.keys(row);
            if (keys.includes('nickname') || keys.includes('text') || keys.includes('id')) {
                return null; // signal: use object mapper in caller
            }
            return keys.map((k) => String(row[k] ?? '').trim()).slice(0, fieldCount);
        }
        return null;
    }).filter(Boolean);
}

/**
 * Batch: recommend feed (random cities pre-assigned).
 * Output format: nickname|age|city|bio|text  (one per line)
 * @returns {Promise<object[]>}
 */
export async function generateRecommendBatch(profile, count = FEED_PAGE_SIZE) {
    if (!canUseTavernApi()) return [];

    const myGender = normalizeGender(profile?.gender);
    const targetGender = myGender === 'female' ? 'male' : 'female';
    const myCity = String(profile?.city || '').trim();
    const cities = pickDistinctCities(count, myCity);
    const cfg = getFeedContentSettings();
    const genderLabel = targetGender === 'female' ? '女' : '男';

    const systemPrompt = [
        '陌陌推荐流生成器。只输出多行，每行格式：',
        '昵称|年龄|城市|简介|动态',
        `正好 ${count} 行。不要 JSON、不要 markdown、不要解释。`,
        STYLE_HINT,
        '城市必须用给定名单，勿全写成同一城。昵称彼此不同。',
    ].join('\n');

    const slots = cities.map((city, i) => `${i + 1}.${city}`).join(' ');
    const userPrompt = [
        cfg.prompt,
        `浏览者${profile?.nickname || '旅人'}（${myGender === 'female' ? '女' : '男'}·${myCity || '?'}）`,
        `生成${count}名异性（${genderLabel}）`,
        `城市顺序：${slots}`,
        `批次${uid('r').slice(-5)}`,
        '例：晚风不回消息|24|杭州|徒步|周末有人爬山吗别只回哈哈',
    ].join('\n');

    let raw = await callFeedModel(systemPrompt, userPrompt, 560);
    let rows = parsePipeOrJson(raw, 5);

    // JSON object fallback
    if (!rows.length) {
        const arr = extractJsonArray(raw);
        if (arr?.length) {
            rows = arr.map((row) => [
                String(row?.nickname || ''),
                String(row?.age ?? ''),
                String(row?.city || ''),
                String(row?.bio || ''),
                String(row?.text || ''),
            ]);
        }
    }

    if (!rows.length) {
        raw = await callFeedModel(systemPrompt, `${userPrompt}\n只输出${count}行 昵称|年龄|城市|简介|动态`, 560);
        rows = parsePipeOrJson(raw, 5);
        if (!rows.length) {
            const arr = extractJsonArray(raw);
            if (arr?.length) {
                rows = arr.map((row) => [
                    String(row?.nickname || ''),
                    String(row?.age ?? ''),
                    String(row?.city || ''),
                    String(row?.bio || ''),
                    String(row?.text || ''),
                ]);
            }
        }
    }
    if (!rows.length) return [];

    const out = [];
    for (let i = 0; i < count; i++) {
        const row = rows[i] || [];
        const nickname = sanitizeNickname(row[0]) || `推荐用户${i + 1}`;
        const text = sanitizeFeedText(row[4]);
        if (!text || text.length < 4) continue;
        out.push({
            nickname,
            age: clampAge(row[1]),
            city: cities[i] || sanitizeNickname(row[2]) || '未知',
            bio: String(row[3] || '').trim().slice(0, 40),
            text,
            gender: targetGender,
        });
    }
    return out;
}

/**
 * Batch: nearby feed — all authors locked to profile city.
 * Format: nickname|age|bio|text
 * @returns {Promise<object[]>}
 */
export async function generateNearbyBatch(profile, count = FEED_PAGE_SIZE) {
    if (!canUseTavernApi()) return [];

    const myGender = normalizeGender(profile?.gender);
    const targetGender = myGender === 'female' ? 'male' : 'female';
    const city = String(profile?.city || '').trim() || '同城';
    const cfg = getFeedContentSettings();
    const genderLabel = targetGender === 'female' ? '女' : '男';

    const systemPrompt = [
        '陌陌附近/同城流生成器。只输出多行，每行：',
        '昵称|年龄|简介|动态',
        `正好 ${count} 行。不要 JSON/markdown/解释。`,
        STYLE_HINT,
        `动态要有「${city}」同城感（店/街区/通勤/活动），可带短#话题。`,
    ].join('\n');

    const userPrompt = [
        cfg.prompt,
        `同城「${city}」，${count}名异性（${genderLabel}）`,
        `批次${uid('n').slice(-5)}`,
        `例：地铁末班车|26|设计师|${city}这雨也太大了 #同城吐槽`,
    ].join('\n');

    let raw = await callFeedModel(systemPrompt, userPrompt, 520);
    let rows = parsePipeOrJson(raw, 4);
    if (!rows.length) {
        const arr = extractJsonArray(raw);
        if (arr?.length) {
            rows = arr.map((row) => [
                String(row?.nickname || ''),
                String(row?.age ?? ''),
                String(row?.bio || ''),
                String(row?.text || ''),
            ]);
        }
    }
    if (!rows.length) {
        raw = await callFeedModel(systemPrompt, `${userPrompt}\n只输出${count}行 昵称|年龄|简介|动态`, 520);
        rows = parsePipeOrJson(raw, 4);
        if (!rows.length) {
            const arr = extractJsonArray(raw);
            if (arr?.length) {
                rows = arr.map((row) => [
                    String(row?.nickname || ''),
                    String(row?.age ?? ''),
                    String(row?.bio || ''),
                    String(row?.text || ''),
                ]);
            }
        }
    }
    if (!rows.length) return [];

    const out = [];
    for (let i = 0; i < Math.min(count, rows.length); i++) {
        const row = rows[i] || [];
        const nickname = sanitizeNickname(row[0]) || `同城${i + 1}`;
        const text = sanitizeFeedText(row[3]);
        if (!text || text.length < 4) continue;
        out.push({
            nickname,
            age: clampAge(row[1]),
            city,
            bio: String(row[2] || '').trim().slice(0, 40),
            text,
            gender: targetGender,
        });
    }
    return out;
}

/**
 * Batch: friend posts.
 * Format: id|text
 * @param {object[]} friends
 * @returns {Promise<{id:string,text:string}[]>}
 */
export async function generateFriendsBatch(friends) {
    if (!canUseTavernApi() || !friends?.length) return [];

    const cfg = getFeedContentSettings();
    const list = friends.slice(0, FEED_PAGE_SIZE);

    const systemPrompt = [
        '陌陌好友动态生成器。只输出多行，每行：',
        'id|动态',
        'id 必须原样使用给定 id。不要 JSON/markdown/解释。',
        STYLE_HINT,
    ].join('\n');

    const roster = list.map((f) => {
        const tip = [
            f.nickname,
            f.city || '',
            (f.bio || '').slice(0, 24),
            f.persona ? String(f.persona).slice(0, 40) : '',
        ].filter(Boolean).join('/');
        return `${f.id}（${tip}）`;
    }).join('\n');

    const userPrompt = [
        cfg.prompt,
        `为以下${list.length}位好友各写1条：`,
        roster,
        `批次${uid('f').slice(-5)}`,
        '例：abc123|加班到现在谁还没睡冒个泡',
    ].join('\n');

    let raw = await callFeedModel(systemPrompt, userPrompt, 420);
    let rows = parsePipeOrJson(raw, 2);
    if (!rows.length) {
        const arr = extractJsonArray(raw);
        if (arr?.length) {
            rows = arr.map((row) => [String(row?.id || ''), String(row?.text || '')]);
        }
    }
    if (!rows.length) {
        raw = await callFeedModel(systemPrompt, `${userPrompt}\n只输出 id|动态`, 420);
        rows = parsePipeOrJson(raw, 2);
        if (!rows.length) {
            const arr = extractJsonArray(raw);
            if (arr?.length) {
                rows = arr.map((row) => [String(row?.id || ''), String(row?.text || '')]);
            }
        }
    }
    if (!rows.length) return [];

    const byId = new Map(list.map((f) => [f.id, f]));
    const out = [];
    for (const row of rows) {
        const id = String(row[0] || '').trim();
        if (!byId.has(id)) continue;
        const text = sanitizeFeedText(row[1]);
        if (!text || text.length < 4) continue;
        out.push({ id, text });
    }

    if (out.length < list.length) {
        const got = new Set(out.map((x) => x.id));
        for (let i = 0; i < list.length; i++) {
            const f = list[i];
            if (got.has(f.id)) continue;
            const text = sanitizeFeedText(rows[i]?.[1]);
            if (text && text.length >= 4) out.push({ id: f.id, text });
        }
    }

    return out;
}

/**
 * Batch: match candidates — unique people via one API call.
 * Format: nickname|age|bio|tag1/tag2|job
 * @returns {Promise<object[]>}
 */
export async function generateMatchBatch(profile, count = FEED_PAGE_SIZE, opts = {}) {
    if (!canUseTavernApi()) return [];

    const myGender = normalizeGender(profile?.gender);
    const targetGender = myGender === 'female' ? 'male' : 'female';
    const city = String(profile?.city || '').trim() || '同城';
    const avoid = (opts.avoidNames || []).filter(Boolean).slice(-16);
    const genderLabel = targetGender === 'female' ? '女' : '男';

    const systemPrompt = [
        '陌陌匹配候选人生成器。只输出多行，每行：',
        '昵称|年龄|简介|标签|职业',
        '标签用/分隔1-3个。不要 JSON/markdown/解释。',
        '昵称像当代网名，彼此不同；禁古风、禁小X+数字。',
    ].join('\n');

    const userPrompt = [
        `浏览者${profile?.nickname || '旅人'}，匹配${count}名异性（${genderLabel}）住「${city}」`,
        avoid.length ? `禁用昵称：${avoid.join('、')}` : '',
        `批次${uid('m').slice(-5)}`,
        '例：晚风不回消息|24|周末徒步吃火锅|徒步/火锅|设计师',
    ].filter(Boolean).join('\n');

    let raw = await callFeedModel(systemPrompt, userPrompt, 480);
    let rows = parsePipeOrJson(raw, 5);
    if (!rows.length) {
        const arr = extractJsonArray(raw);
        if (arr?.length) {
            rows = arr.map((row) => [
                String(row?.nickname || ''),
                String(row?.age ?? ''),
                String(row?.bio || ''),
                Array.isArray(row?.tags) ? row.tags.join('/') : String(row?.tags || ''),
                String(row?.job || ''),
            ]);
        }
    }
    if (!rows.length) {
        raw = await callFeedModel(systemPrompt, `${userPrompt}\n只输出 昵称|年龄|简介|标签|职业`, 480);
        rows = parsePipeOrJson(raw, 5);
    }
    if (!rows.length) return [];

    const out = [];
    const seen = new Set(avoid.map((n) => String(n).toLowerCase()));
    for (let i = 0; i < Math.min(count, rows.length); i++) {
        const row = rows[i] || [];
        let nickname = sanitizeNickname(row[0]);
        if (!nickname || nickname.length < 2) continue;
        const key = nickname.toLowerCase();
        if (seen.has(key)) {
            nickname = `${nickname}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 16);
            if (seen.has(nickname.toLowerCase())) continue;
        }
        seen.add(nickname.toLowerCase());

        const tags = String(row[3] || '')
            .split(/[/|,，、]/)
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 3);
        const bio = String(row[2] || '').trim().slice(0, 40);
        const job = String(row[4] || '').trim().slice(0, 20);

        out.push({
            nickname,
            age: clampAge(row[1]),
            city,
            bio: bio || (job ? `${job} · 在${city}` : `在${city}生活`),
            tags: tags.length ? tags : (job ? [job] : ['同城']),
            job,
            gender: targetGender,
        });
    }
    return out;
}

/** @deprecated */
export async function resolveRecommendCard() {
    return null;
}

export async function resolvePostText() {
    return null;
}

export async function resolvePostTexts() {
    return [];
}
