import { canUseTavernApi, generateModernNickname, localModernNickname } from './ai-names.js';
import { resolvePostTexts } from './feed-content.js';
import { getVirtualNow } from './time.js';
import { normalizeGender, oppositeGender, uid } from './utils.js';

function randomAge() {
    return 18 + Math.floor(Math.random() * 14);
}

function nearbyDistance() {
    const n = (Math.random() * 4.8 + 0.2).toFixed(1);
    return `${n}km`;
}

function stubHomepage(seedName) {
    return {
        job: '',
        relationship: '',
        about: '',
        moments: [],
        note: `${seedName} 的陌陌主页`,
    };
}

function resolveCity(profileOrCity, opts = {}) {
    if (opts.city) return String(opts.city).trim();
    if (typeof profileOrCity === 'string' && profileOrCity.trim()) return profileOrCity.trim();
    if (profileOrCity?.city) return String(profileOrCity.city).trim();
    return '同城';
}

export function ensureHomepage(user) {
    if (!user) return user;
    if (user.homepage) return user;
    return {
        ...user,
        homepage: stubHomepage(user.nickname || 'TA'),
    };
}

/**
 * @param {'male'|'female'|string} gender
 * @param {string} [nickname]
 * @param {{ city?: string, nearby?: boolean }} [opts]
 */
export function createNpc(gender, nickname, opts = {}) {
    const g = normalizeGender(gender);
    const name = String(nickname || '').trim()
        || `路过的${g === 'female' ? '她' : '他'}${Math.floor(Math.random() * 9000 + 1000)}`;
    const id = uid(g === 'female' ? 'f' : 'm');
    const city = resolveCity(opts.city, opts);
    return {
        id,
        nickname: name,
        gender: g,
        age: randomAge(),
        city,
        bio: '',
        tags: [],
        distance: nearbyDistance(),
        avatarText: name.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 1) || (g === 'female' ? '她' : '他'),
        isFriend: false,
        online: Math.random() > 0.35,
        homepage: stubHomepage(name),
        linkedCharacter: null,
        persona: '',
        speechStyle: '',
        personaReady: false,
        sameCity: true,
    };
}

/**
 * @param {'male'|'female'|string} gender
 * @param {{ useAiNames?: boolean, city?: string, nearby?: boolean }} [opts]
 */
export async function createNpcAsync(gender, opts = {}) {
    const g = normalizeGender(gender);
    let nickname = '';
    const useAiNames = opts.useAiNames !== false;
    try {
        nickname = useAiNames
            ? await generateModernNickname(g)
            : localModernNickname(g);
    } catch (e) {
        console.warn('[st-momo] nickname gen failed', e);
        nickname = localModernNickname(g);
    }
    return createNpc(g, nickname, opts);
}

export function createNpcFromCharacter(character, extras = {}) {
    if (!character?.name) return null;
    const nickname = character.name;
    const id = `stchar_${nickname}`.replace(/\s+/g, '_');
    const about = [character.personality, character.description].filter(Boolean).join('\n').slice(0, 280);
    const g = normalizeGender(extras.gender || 'female');
    const city = resolveCity(extras.city || extras.profile?.city, extras);
    return {
        id,
        nickname,
        gender: g,
        age: extras.age || randomAge(),
        city,
        bio: (character.personality || character.description || '').slice(0, 40),
        tags: ['角色卡', '酒馆联动'].concat((extras.tags || []).slice(0, 2)),
        distance: '剧情中',
        avatarText: nickname.slice(0, 1),
        avatarUrl: extras.avatarUrl || '',
        isFriend: false,
        online: true,
        homepage: {
            job: extras.job || '角色卡',
            relationship: '剧情相关',
            about,
            moments: character.firstMes
                ? [{ id: uid('mom'), text: String(character.firstMes).slice(0, 60), createdAt: Date.now() - 3600_000 }]
                : [],
            note: '来自酒馆角色卡',
        },
        linkedCharacter: {
            name: character.name,
            source: character.source,
        },
        persona: about,
        speechStyle: character.personality ? String(character.personality).slice(0, 120) : '',
        personaReady: Boolean(about),
    };
}

/**
 * Opposite-gender strangers in the user's city (for 附近).
 * @param {{gender?: string, city?: string}} profile
 * @param {number} count
 * @param {{ parallel?: boolean, preferFast?: boolean, city?: string }} opts
 */
export async function createStrangerPool(profile, count = 8, opts = {}) {
    const myGender = normalizeGender(profile?.gender);
    const target = oppositeGender(myGender);
    const city = resolveCity(opts.city || profile?.city, opts);
    let useAiNames = true;
    try {
        useAiNames = window.SillyTavern?.getContext?.()?.extensionSettings?.['st-momo']?.settings?.useAiNames !== false;
    } catch {
        useAiNames = true;
    }
    // Home feed prefers unique AI names when API is up; preferFast only skips AI names.
    const allowAi = !opts.preferFast && useAiNames && canUseTavernApi();
    const makeOne = () => createNpcAsync(target, { useAiNames: allowAi, city, nearby: true });
    const tasks = Array.from({ length: count }, () => makeOne());
    const list = opts.parallel === false
        ? await (async () => {
            const out = [];
            for (const t of tasks) out.push(await t);
            return out;
        })()
        : (await Promise.all(tasks));
    return list
        .filter((u) => normalizeGender(u.gender) === target)
        .map((u) => ({ ...u, city, sameCity: true, distance: nearbyDistance() }));
}

/**
 * @param {object[]} users
 * @param {boolean|{ asFriend?: boolean, channel?: 'recommend'|'nearby'|'friends' }} [opts]
 */
export async function createPostsForUsers(users, opts = false) {
    const options = typeof opts === 'boolean' ? { asFriend: opts } : (opts || {});
    const asFriend = Boolean(options.asFriend);
    const channel = options.channel || (asFriend ? 'friends' : 'nearby');
    const list = users || [];
    let settings = null;
    try {
        settings = window.SillyTavern?.getContext?.()?.extensionSettings?.['st-momo']?.settings || null;
    } catch {
        settings = null;
    }
    const now = getVirtualNow(settings || {});
    const texts = await resolvePostTexts(list, settings, { channel });

    return list.map((user, i) => {
        const text = texts[i];
        const failed = !text;
        return {
            id: uid('post'),
            channel,
            authorId: user.id,
            authorName: user.nickname,
            authorAge: user.age,
            authorCity: user.city,
            authorGender: user.gender,
            avatarText: user.avatarText,
            distance: user.distance,
            text: failed
                ? `（${user.nickname} 的动态生成失败 #${i + 1}：请确认酒馆 API 在线）`
                : text,
            genFailed: failed,
            likes: Math.floor(Math.random() * 40),
            comments: Math.floor(Math.random() * 12),
            createdAt: now - Math.floor(Math.random() * 1000 * 60 * 60 * 18),
            isFriend: Boolean(asFriend || user.isFriend),
        };
    });
}

export async function createMatchCandidate(profile) {
    let useAiNames = true;
    try {
        useAiNames = window.SillyTavern?.getContext?.()?.extensionSettings?.['st-momo']?.settings?.useAiNames !== false;
    } catch {
        useAiNames = true;
    }
    return createNpcAsync(oppositeGender(profile?.gender), {
        useAiNames: useAiNames && canUseTavernApi(),
        city: profile?.city,
        nearby: true,
    });
}

export { normalizeGender, oppositeGender };
