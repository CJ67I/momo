import { oppositeGender, pick, uid } from './utils.js';

const FEMALE_NAMES = ['小夏', '晚晚', '阿璃', '糯米', '清清', '柚子', '安安', '苏苏', '眠眠', '桃桃', '七七', '软软'];
const MALE_NAMES = ['阿辰', '北野', '小川', '顾言', '林深', '周屿', '陆行', '谢予', '江白', '韩弈', '陈序', '沈辞'];

const CITIES = ['上海', '北京', '杭州', '成都', '深圳', '广州', '南京', '武汉', '重庆', '苏州', '厦门', '长沙'];
const TAGS = ['夜猫子', '咖啡成瘾', '健身打卡', '爱看展', '猫奴', '游戏搭子', '徒步', '摄影', '美食探店', '追剧', '听播客', '学外语'];
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
const JOBS = ['设计师', '程序员', '咖啡师', '自由撰稿', '摄影师', '学生', '运营', '音乐人', '实习中', '健身教练'];
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

/**
 * Ensure user object has homepage fields (for older saved friends).
 */
export function ensureHomepage(user) {
    if (!user) return user;
    if (user.homepage?.about) return user;
    return {
        ...user,
        homepage: buildHomepage(user.nickname || 'TA'),
    };
}

/**
 * @param {'male'|'female'} gender
 */
export function createNpc(gender) {
    const names = gender === 'female' ? FEMALE_NAMES : MALE_NAMES;
    const nickname = `${pick(names)}${Math.floor(Math.random() * 90 + 10)}`;
    const id = uid(gender === 'female' ? 'f' : 'm');
    return {
        id,
        nickname,
        gender,
        age: randomAge(),
        city: pick(CITIES),
        bio: pick(BIOS),
        tags: [pick(TAGS), pick(TAGS)].filter((v, i, a) => a.indexOf(v) === i),
        distance: randomDistance(),
        avatarText: nickname.slice(0, 1),
        isFriend: false,
        online: Math.random() > 0.35,
        homepage: buildHomepage(nickname),
        linkedCharacter: null,
    };
}

/**
 * Build an NPC from current SillyTavern character card.
 * @param {object|null} character from st-bridge.getCharacterInfo()
 * @param {{gender?: string, city?: string}} extras
 */
export function createNpcFromCharacter(character, extras = {}) {
    if (!character?.name) return null;
    const nickname = character.name;
    const id = `stchar_${nickname}`.replace(/\s+/g, '_');
    const about = [character.personality, character.description].filter(Boolean).join('\n').slice(0, 280)
        || pick(ABOUTS);
    return {
        id,
        nickname,
        gender: extras.gender || 'female',
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
 * @param {{gender:'male'|'female'}} profile
 * @param {number} count
 */
export function createStrangerPool(profile, count = 8) {
    const target = oppositeGender(profile.gender || 'male');
    return Array.from({ length: count }, () => createNpc(target));
}

/**
 * @param {Array} users
 * @param {boolean} asFriend
 */
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

/**
 * @param {{gender:'male'|'female'}} profile
 */
export function createMatchCandidate(profile) {
    return createNpc(oppositeGender(profile.gender || 'male'));
}
