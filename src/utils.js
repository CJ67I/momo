/** @param {unknown} text */
export function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function readNow() {
    try {
        const s = window.SillyTavern?.getContext?.()?.extensionSettings?.['st-momo']?.settings;
        if (!s) return Date.now();
        const rate = Math.max(0, Number(s.timeScale));
        const scale = Number.isFinite(rate) && rate > 0 ? rate : 1;
        const base = Number(s.virtualTimeMs);
        const anchor = Number(s.virtualAnchorReal);
        if (!Number.isFinite(base) || !Number.isFinite(anchor)) return Date.now();
        return Math.floor(base + (Date.now() - anchor) * scale);
    } catch {
        return Date.now();
    }
}

export function formatTime(ts) {
    const d = new Date(ts || readNow());
    const now = new Date(readNow());
    const sameDay = d.toDateString() === now.toDateString();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (sameDay) return `${hh}:${mm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export function relativeTime(ts) {
    const diff = readNow() - Number(ts || 0);
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min}分钟前`;
    const hour = Math.floor(min / 60);
    if (hour < 24) return `${hour}小时前`;
    const day = Math.floor(hour / 24);
    if (day < 7) return `${day}天前`;
    return formatTime(ts);
}

/**
 * Ask before applying a setting change. Returns true if user confirms.
 * @param {string} label
 */
export function confirmSettingSave(label) {
    return window.confirm(`确认保存「${label}」？\n保存后立即生效。`);
}

/**
 * Prominent in-app reminder + toast after a setting is saved.
 * @param {HTMLElement|null} root
 * @param {string} message
 */
export function notifySettingSaved(root, message) {
    toast(message, 'success');
    if (!root) return;
    let bar = root.querySelector('.mm-save-banner');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'mm-save-banner';
        const page = root.querySelector('.mm-page') || root;
        page.prepend(bar);
    }
    bar.textContent = `✓ ${message}`;
    bar.classList.add('is-show');
    clearTimeout(bar._hideTimer);
    bar._hideTimer = setTimeout(() => bar.classList.remove('is-show'), 3600);
}

/**
 * Normalize various gender inputs to 'male' | 'female'.
 * @param {unknown} gender
 * @returns {'male'|'female'}
 */
export function normalizeGender(gender) {
    const s = String(gender ?? '').trim().toLowerCase();
    if (['female', 'f', '女', '女生', '女人', 'woman', 'girl', 'lady'].includes(s)) return 'female';
    if (['male', 'm', '男', '男生', '男人', 'man', 'boy', 'guy'].includes(s)) return 'male';
    return 'male';
}

export function oppositeGender(gender) {
    return normalizeGender(gender) === 'female' ? 'male' : 'female';
}

export function avatarGradient(seed = '') {
    const palettes = [
        ['#5BB8FF', '#2F8CFF'],
        ['#7CC4FF', '#1A6FE0'],
        ['#4ECDC4', '#2F8CFF'],
        ['#74B9FF', '#0984E3'],
        ['#81ECEC', '#00B4D8'],
        ['#A0C4FF', '#3A86FF'],
    ];
    let hash = 0;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    const [a, b] = palettes[hash % palettes.length];
    return `linear-gradient(135deg, ${a}, ${b})`;
}

export function toast(message, type = 'info') {
    if (typeof toastr !== 'undefined') {
        toastr[type]?.(message) || toastr.info(message);
        return;
    }
    console.log(`[st-momo] ${message}`);
}
