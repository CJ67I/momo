const POS_KEY = 'st_momo_launcher_pos';

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function loadPos() {
    try {
        const raw = localStorage.getItem(POS_KEY);
        if (!raw) return null;
        const pos = JSON.parse(raw);
        if (typeof pos?.x !== 'number' || typeof pos?.y !== 'number') return null;
        return pos;
    } catch {
        return null;
    }
}

function savePos(x, y) {
    localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
}

/**
 * Make a fixed-position element draggable (pointer events).
 * Click without meaningful move still fires onTap.
 */
export function makeDraggable(el, { onTap, storage = true, margin = 8 } = {}) {
    if (!el) return () => {};

    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let dragging = false;
    let moved = false;
    let pointerId = null;

    const applySaved = () => {
        if (!storage) return;
        const pos = loadPos();
        if (!pos) return;
        const maxX = window.innerWidth - el.offsetWidth - margin;
        const maxY = window.innerHeight - el.offsetHeight - margin;
        const x = clamp(pos.x, margin, Math.max(margin, maxX));
        const y = clamp(pos.y, margin, Math.max(margin, maxY));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    };

    applySaved();

    const onPointerDown = (e) => {
        if (e.button != null && e.button !== 0) return;
        pointerId = e.pointerId;
        el.setPointerCapture?.(pointerId);
        const rect = el.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        originLeft = rect.left;
        originTop = rect.top;
        dragging = true;
        moved = false;
        el.classList.add('is-dragging');
        e.preventDefault();
    };

    const onPointerMove = (e) => {
        if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        if (!moved) return;

        const maxX = window.innerWidth - el.offsetWidth - margin;
        const maxY = window.innerHeight - el.offsetHeight - margin;
        const x = clamp(originLeft + dx, margin, Math.max(margin, maxX));
        const y = clamp(originTop + dy, margin, Math.max(margin, maxY));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    };

    const endDrag = (e) => {
        if (!dragging) return;
        if (pointerId != null && e?.pointerId != null && e.pointerId !== pointerId) return;
        dragging = false;
        el.classList.remove('is-dragging');
        try {
            if (pointerId != null) el.releasePointerCapture?.(pointerId);
        } catch {
            /* ignore */
        }
        pointerId = null;

        if (moved) {
            const rect = el.getBoundingClientRect();
            if (storage) savePos(rect.left, rect.top);
            return;
        }
        onTap?.(e);
    };

    const onResize = () => applySaved();

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    // Avoid synthetic click after drag on some mobile browsers
    el.addEventListener('click', (e) => {
        if (moved) {
            e.preventDefault();
            e.stopPropagation();
        }
    });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    return () => {
        el.removeEventListener('pointerdown', onPointerDown);
        el.removeEventListener('pointermove', onPointerMove);
        el.removeEventListener('pointerup', endDrag);
        el.removeEventListener('pointercancel', endDrag);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', onResize);
    };
}
