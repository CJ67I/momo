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

export function formatTime(ts) {
    const d = new Date(ts || Date.now());
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (sameDay) return `${hh}:${mm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export function relativeTime(ts) {
    const diff = Date.now() - Number(ts || 0);
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min}分钟前`;
    const hour = Math.floor(min / 60);
    if (hour < 24) return `${hour}小时前`;
    const day = Math.floor(hour / 24);
    if (day < 7) return `${day}天前`;
    return formatTime(ts);
}

export function oppositeGender(gender) {
    return gender === 'female' ? 'male' : 'female';
}

export function avatarGradient(seed = '') {
    const palettes = [
        ['#ff6b9d', '#c44569'],
        ['#feca57', '#ff9ff3'],
        ['#48dbfb', '#0abde3'],
        ['#1dd1a1', '#10ac84'],
        ['#5f27cd', '#341f97'],
        ['#ff9f43', '#ee5a24'],
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
