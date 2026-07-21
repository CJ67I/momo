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

const POST_TEXTS = [
    '今天 ind 路过的晚霞也太会了',
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

function randomAge() {
    return 18 + Math.floor(Math.random() * 14);
}

function randomDistance() {
    const n = (Math.random() * 12 + 0.3).toFixed(1);
    return `${n}km`;
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
