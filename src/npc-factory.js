import { canUseTavernApi, generateModernNickname, localModernNickname } from './ai-names.js';
import { normalizeGender, oppositeGender, pick, uid } from './utils.js';

const CITIES = ['上海', '北京', '杭州', '成都', '深圳', '广州', '南京', '武汉', '重庆', '苏州', '厦门', '长沙', '西安', '青岛'];
const TAGS = ['夜猫子', '咖啡成瘾', '健身打卡', '爱看展', '猫奴', '游戏搭子', '徒步', '摄影', '美食探店', '追剧', '听播客', '学外语', '周末宅', '城市漫游'];
const BIOS = [
    '最近沉迷夜跑，求同频搭子',
    '城市游荡中，欢迎偶遇',
    '喜欢安静也喜欢热闹',
    '周末只想躺平或去看海',
    '认真生活，偶尔发疯',
    '想认识会聊天的人',
    '摄影/咖啡/独立书店',
    '别聊天气，聊点有意思的',
];
const JOBS = ['设计师', '程序员', '咖啡师', '自由撰稿', '摄影师', '学生', '运营', '音乐人', '实习中', '健身教练', '产品经理', '插画师'];
const STATUS = ['单身', '保密', '恋爱中', '先处着看看'];
const ABOUTS = [
    '相信见面比网聊有意思，但前提是聊得来。',
    '工作日社畜，周末城市漫游者。',
    '不擅长自我介绍，但很擅长听别人说话。',
    '收藏夹塞满了想去却还没去的店。',
    '把日子过成自己喜欢的样子就好。',
];

const POST_TEXTS = [
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
];

const MOMENT_TEXTS = [
    '打卡一家安静的小店',
    '夜跑 5km，心情回血',
    '新书看到一半，已经想安利',
    '窗外下雨，适合发呆',
    '和朋友约了周末看展',
];

function randomAge() {
    return 18 + Math.floor(Math.random() * 14);
}

function randomDistance() {
    const n = (Math.random() * 12 + 0.3).toFixed(1);
    return `${n}km`;
}

function buildHomepage(seedName) {
    return {
        job: pick(JOBS),
        relationship: pick(STATUS),
        about: pick(ABOUTS),
        moments: Array.from({ length: 3 }, (_, i) => ({
            id: uid('mom'),
            text: pick(MOMENT_TEXTS),
            createdAt: Date.now() - (i + 1) * 3600_000 * (2 + Math.floor(Math.random() * 20)),
        })),
        note: `${seedName} 的陌陌主页`,
    };
}

export function ensureHomepage(user) {
    if (!user) return user;
    if (user.homepage?.about) return user;
    return {
        ...user,
        homepage: buildHomepage(user.nickname || 'TA'),
    };
}

/**
 * Sync create with local modern nickname (instant).
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
        bio: pick(BIOS),
        tags: [pick(TAGS), pick(TAGS)].filter((v, i, a) => a.indexOf(v) === i),
        distance: randomDistance(),
        avatarText: name.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 1) || (g === 'female' ? '她' : '他'),
        isFriend: false,
        online: Math.random() > 0.35,
        homepage: buildHomepage(name),
        linkedCharacter: null,
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
    const about = [character.personality, character.description].filter(Boolean).join('\n').slice(0, 280)
        || pick(ABOUTS);
    const g = normalizeGender(extras.gender || 'female');
    return {
        id,
        nickname,
        gender: g,
        age: extras.age || randomAge(),
        city: extras.city || pick(CITIES),
        bio: (character.personality || character.description || pick(BIOS)).slice(0, 40),
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
            moments: [
                {
                    id: uid('mom'),
                    text: (character.firstMes || '想和你多聊聊').slice(0, 60),
                    createdAt: Date.now() - 3600_000,
                },
            ],
            note: '来自酒馆角色卡',
        },
        linkedCharacter: {
            name: character.name,
            source: character.source,
        },
    };
}

/**
 * @param {{gender?: string}} profile
 * @param {number} count
 */
/**
 * @param {{gender?: string}} profile
 * @param {number} count
 * @param {{ parallel?: boolean, preferFast?: boolean }} opts
 *  preferFast: skip AI names for instant batch (match queue)
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

export function createPostsForUsers(users, asFriend = false) {
    return users.map((user) => ({
        id: uid('post'),
        authorId: user.id,
        authorName: user.nickname,
        authorAge: user.age,
        authorCity: user.city,
        authorGender: user.gender,
        avatarText: user.avatarText,
        distance: user.distance,
        text: pick(POST_TEXTS),
        likes: Math.floor(Math.random() * 40),
        comments: Math.floor(Math.random() * 12),
        createdAt: Date.now() - Math.floor(Math.random() * 1000 * 60 * 60 * 36),
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
