/**
 * Virtual clock: editable in-app time that advances with real elapsed time × flow rate.
 */

function readSettings() {
    try {
        return window.SillyTavern?.getContext?.()?.extensionSettings?.['st-momo']?.settings || {};
    } catch {
        return {};
    }
}

/**
 * @param {object} [settings]
 * @returns {number} unix ms
 */
export function getVirtualNow(settings = null) {
    const s = settings || readSettings();
    const rate = Math.max(0, Number(s.timeScale));
    const scale = Number.isFinite(rate) && rate > 0 ? rate : 1;
    const base = Number(s.virtualTimeMs);
    const anchor = Number(s.virtualAnchorReal);
    if (!Number.isFinite(base) || !Number.isFinite(anchor)) return Date.now();
    return Math.floor(base + (Date.now() - anchor) * scale);
}

/**
 * Patch to set virtual clock to an absolute moment (keeps flowing from now).
 * @param {number|Date|string} when
 */
export function patchSetVirtualTime(when) {
    const ms = when instanceof Date ? when.getTime() : new Date(when).getTime();
    const t = Number.isFinite(ms) ? ms : Date.now();
    return {
        virtualTimeMs: t,
        virtualAnchorReal: Date.now(),
    };
}

/**
 * Format datetime-local value from ms.
 * @param {number} ms
 */
export function toDatetimeLocalValue(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * @param {number} [ms]
 */
export function formatClockHm(ms) {
    const d = new Date(ms ?? getVirtualNow());
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
