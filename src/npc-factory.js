import { canUseTavernApi, generateModernNickname, localModernNickname } from './ai-names.js';
import { resolvePostTexts } from './feed-content.js';
import { getVirtualNow } from './time.js';
import { normalizeGender, oppositeGender, pick, uid } from './utils.js';

/** Lightweight location seeds only — not content templates */
const CITIES = ['上海', '北京', '杭州', '成都', '深圳', '广州', '南京', '武汉', '重庆', '苏州', '厦门', '长沙', '西安', '青岛'];

function randomAge() {
    return 18 + Math.floor(Math.random() * 14);
}

function randomDistance() {
    const n = (Math.random() * 12 + 0.3).toFixed(1);
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

export function ensureHomepage(user) {
    if (!user) return user;
    if (user.homepage) return user;
    return {
        ...user,
        homepage: stubHomepage(user.nickname || 'TA'),
    };
}

/**
 * Sync create with local modern nickname (instant).
 * Bio/tags stay minimal; full persona is AI-filled after add-friend.
 * @param {'male'|'female'|string} gender
 * @param {string} [nickname]
 */
export function createNpc(gender, nickname) {
    const g = normalizeGender(gender);
    const name = String(nickname || '').trim() || `路过的${g === 'female' ? '她' : '他'}${Math.floor(Math.random() * 90 + 10)}`;
    const id = uid(g === 'female' ? 'f' : 'm');
    return {
        id,
        nickname: name,
        gender: g,
        age: randomAge(),
        city: pick(CITIES),
        bio: '',
        tags: [],
        distance: randomDistance(),
        avatarText: name.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 1) || (g === 'female' ? '她' : '他'),
        isFriend: false,
        online: Math.random() > 0.35,
        homepage: stubHomepage(name),
        linkedCharacter: null,
        persona: '',
        speechStyle: '',
        personaReady: false,
    };
}

/**
 * Create NPC with AI (or local modern) nickname.
 * @param {'male'|'female'|string} gender
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
    return createNpc(g, nickname);
}

export function createNpcFromCharacter(character, extras = {}) {
    if (!character?.name) return null;
    const nickname = character.name;
    const id = `stchar_${nickname}`.replace(/\s+/g, '_');
    const about = [character.personality, character.description].filter(Boolean).join('\n').slice(0, 280);
    const g = normalizeGender(extras.gender || 'female');
    return {
        id,
        nickname,
        gender: g,
        age: extras.age || randomAge(),
        city: extras.city || pick(CITIES),
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
 * @param {{gender?: string}} profile
 * @param {number} count
 * @param {{ parallel?: boolean, preferFast?: boolean }} opts
 */
export async function createStrangerPool(profile, count = 8, opts = {}) {
    const myGender = normalizeGender(profile?.gender);
    const target = oppositeGender(myGender);
    let useAiNames = true;
    try {
        useAiNames = window.SillyTavern?.getContext?.()?.extensionSettings?.['st-momo']?.settings?.useAiNames !== false;
    } catch {
        useAiNames = true;
    }
    const allowAi = !opts.preferFast && useAiNames && canUseTavernApi();
    const tasks = Array.from({ length: count }, () => createNpcAsync(target, { useAiNames: allowAi }));
    const list = opts.parallel === false
        ? await (async () => {
            const out = [];
            for (const t of tasks) out.push(await t);
            return out;
        })()
        : (await Promise.all(tasks));
    return list.filter((u) => normalizeGender(u.gender) === target);
}

export async function createPostsForUsers(users, asFriend = false) {
    const list = users || [];
    let settings = null;
    try {
        settings = window.SillyTavern?.getContext?.()?.extensionSettings?.['st-momo']?.settings || null;
    } catch {
        settings = null;
    }
    const now = getVirtualNow(settings || {});
    const texts = await resolvePostTexts(list, settings);
    return list.map((user, i) => ({
        id: uid('post'),
        authorId: user.id,
        authorName: user.nickname,
        authorAge: user.age,
        authorCity: user.city,
        authorGender: user.gender,
        avatarText: user.avatarText,
        distance: user.distance,
        text: texts[i] || '（动态生成失败：请检查酒馆 API 是否在线，并确认已保存动态提示词）',
        likes: Math.floor(Math.random() * 40),
        comments: Math.floor(Math.random() * 12),
        createdAt: now - Math.floor(Math.random() * 1000 * 60 * 60 * 36),
        isFriend: Boolean(asFriend || user.isFriend),
    }));
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
    });
}

export { normalizeGender, oppositeGender };
