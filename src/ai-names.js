import { pick } from './utils.js';

export { canUseTavernApi } from './ai.js';

const PREFIX = [
    '不想', '今天也', '半颗', '路过', '在逃', '深夜', '周末', '北城', '南岛', '雾里',
    '外卖', '早八', '地铁', '阳台', '云端', '汽水', '晚风', '橘子', '草莓', '月亮',
];

const CORES = [
    '打工人', '干饭人', '夜跑选手', '咖啡精', '猫控', '躺平侠', '社恐患者',
    '追剧搭子', '摄影爱好者', '城市漂流', '便利店常客', '早八战士',
];

const FEMALE_POOL = [
    '不想上班的猫', '汽水配炸鸡', '晚风吹过0号线', '半颗草莓糖', 'Kiki在逃中',
    '柚子味气泡水', '周末只睡觉', '月亮不营业', '今天也想躺', '南岛有雨',
    '小熊软糖yo', '雾里看花茶', '阳台晒太阳', '草莓牛奶加冰', '阿梨不熬夜',
    'meow不回消息', '晚八点咖啡', '云朵收纳员', '橘子海的风', '在逃班味',
];

const MALE_POOL = [
    '北城夜跑选手', '加班续命中', '地铁末班车', '干饭不加班', '阿Q不吃糖',
    'moonlit_xx', '周末修bug', '深夜便利店', '城市漂流瓶', '早八战士',
    '路人甲pro', '外卖到达啦', '山海之间', '蓝调通勤', '不想起床君',
    '夜航船船长', '豆浆配油条', '代码写到饱', '风停了再走', '半夏有风',
];

const SUFFIX_NUM = () => {
    const styles = [
        () => String(Math.floor(Math.random() * 90 + 10)),
        () => String(Math.floor(Math.random() * 900 + 100)),
        () => '',
        () => `_${Math.floor(Math.random() * 9)}`,
        () => ['x', 'z', 'q', 'v'][Math.floor(Math.random() * 4)],
    ];
    return pick(styles)();
};

/**
 * Local modern-style nickname generator (no AI).
 * @param {'male'|'female'} gender
 */
export function localModernNickname(gender) {
    const pool = gender === 'female' ? FEMALE_POOL : MALE_POOL;
    if (Math.random() < 0.55) {
        const base = pick(pool);
        if (Math.random() < 0.35) return `${base}${SUFFIX_NUM()}`.slice(0, 16);
        return base;
    }
    const name = `${pick(PREFIX)}${pick(CORES)}${SUFFIX_NUM()}`.replace(/\s+/g, '');
    return name.slice(0, 16);
}

function sanitizeNickname(raw, gender) {
    let name = String(raw || '')
        .replace(/["'「」『』【】\[\]()（）]/g, '')
        .replace(/^(昵称|网名|名字|name)\s*[:：]\s*/i, '')
        .split(/[\n\r|,，]/)[0]
        .trim();
    name = name.replace(/\s+/g, '').slice(0, 16);
    if (!name || name.length < 2) return localModernNickname(gender);
    // reject old-style pattern like 小夏23 / 阿辰88
    if (/^[\u4e00-\u9fa5]{1,3}\d{2,3}$/.test(name)) return localModernNickname(gender);
    return name;
}

/**
 * Ask ST API for a modern net nickname; fallback to local.
 * @param {'male'|'female'} gender
 */
export async function generateModernNickname(gender) {
    const g = gender === 'female' ? 'female' : 'male';
    if (!canUseTavernApi()) return localModernNickname(g);

    try {
        const ctx = window.SillyTavern?.getContext?.();
        const generateRaw = ctx?.generateRaw;
        if (typeof generateRaw !== 'function') return localModernNickname(g);

        const systemPrompt = [
            '你是中文社交软件网名生成器。',
            '只输出一个网名，不要解释、不要引号、不要编号。',
            '风格：2020年代真实陌陌/微信网名，生活化、口语、可带英文或数字，但不要古风仙侠腔，不要“小X+数字”模板。',
            `性别倾向：${g === 'female' ? '偏女性用户常用风格' : '偏男性用户常用风格'}。`,
            '长度 2-12 个汉字或等价字符。',
        ].join('\n');

        const prompt = `请生成一个独特的现代网名（${g === 'female' ? '女' : '男'}）：`;

        let result;
        try {
            result = await generateRaw({ systemPrompt, prompt, responseLength: 40 });
        } catch {
            result = await generateRaw(`${systemPrompt}\n${prompt}`);
        }
        return sanitizeNickname(result, g);
    } catch (e) {
        console.warn('[st-momo] AI nickname failed', e);
        return localModernNickname(g);
    }
}
