/**
 * Attach pull-to-refresh on a scrollable container.
 * @param {HTMLElement} scrollEl
 * @param {{ onRefresh: () => Promise<void>|void, threshold?: number, indicator?: HTMLElement }} opts
 */
export function bindPullToRefresh(scrollEl, opts = {}) {
    if (!scrollEl) return () => {};
    const threshold = opts.threshold ?? 68;
    const indicator = opts.indicator || scrollEl.querySelector('.mm-ptr');
    let startY = 0;
    let pulling = false;
    let armed = false;
    let refreshing = false;
    let dy = 0;

    const setVisual = (dist, state) => {
        const d = Math.max(0, dist);
        scrollEl.style.transform = d ? `translateY(${Math.min(d * 0.55, 96)}px)` : '';
        if (!indicator) return;
        indicator.classList.toggle('is-visible', d > 8 || refreshing);
        indicator.classList.toggle('is-armed', state === 'armed');
        indicator.classList.toggle('is-refreshing', state === 'refreshing');
        const label = indicator.querySelector('.mm-ptr-label');
        const icon = indicator.querySelector('.mm-ptr-icon');
        if (label) {
            label.textContent = state === 'refreshing'
                ? '刷新中…'
                : state === 'armed'
                    ? '松开立即刷新'
                    : '下拉刷新';
        }
        if (icon) {
            if (state === 'refreshing') {
                icon.style.transform = '';
            } else {
                const rot = Math.min(180, (d / threshold) * 180);
                icon.style.transform = `rotate(${rot}deg)`;
            }
        }
    };

    const onStart = (e) => {
        if (refreshing) return;
        if (scrollEl.scrollTop > 0) return;
        const t = e.touches?.[0] || e;
        startY = t.clientY;
        pulling = true;
        armed = false;
        dy = 0;
    };

    const onMove = (e) => {
        if (!pulling || refreshing) return;
        if (scrollEl.scrollTop > 0) {
            pulling = false;
            setVisual(0, 'idle');
            return;
        }
        const t = e.touches?.[0] || e;
        dy = t.clientY - startY;
        if (dy <= 0) {
            armed = false;
            setVisual(0, 'idle');
            return;
        }
        e.preventDefault?.();
        armed = dy >= threshold;
        setVisual(dy, armed ? 'armed' : 'pulling');
    };

    const onEnd = async () => {
        if (!pulling) return;
        pulling = false;
        if (armed && !refreshing && typeof opts.onRefresh === 'function') {
            refreshing = true;
            setVisual(threshold, 'refreshing');
            try {
                await opts.onRefresh();
            } finally {
                refreshing = false;
                dy = 0;
                armed = false;
                setVisual(0, 'idle');
            }
            return;
        }
        dy = 0;
        armed = false;
        setVisual(0, 'idle');
    };

    scrollEl.addEventListener('touchstart', onStart, { passive: true });
    scrollEl.addEventListener('touchmove', onMove, { passive: false });
    scrollEl.addEventListener('touchend', onEnd);
    scrollEl.addEventListener('touchcancel', onEnd);
    // mouse fallback for desktop ST
    scrollEl.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

    return () => {
        scrollEl.removeEventListener('touchstart', onStart);
        scrollEl.removeEventListener('touchmove', onMove);
        scrollEl.removeEventListener('touchend', onEnd);
        scrollEl.removeEventListener('touchcancel', onEnd);
        scrollEl.removeEventListener('mousedown', onStart);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
        scrollEl.style.transform = '';
    };
}

export function ptrMarkup(extraClass = '') {
    return `
        <div class="mm-ptr ${extraClass}" aria-hidden="true">
            <span class="mm-ptr-icon">↻</span>
            <span class="mm-ptr-label">下拉刷新</span>
        </div>
    `;
}
