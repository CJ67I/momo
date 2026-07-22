import { MomoApp } from './src/app.js';

const EXTENSION_NAME = detectExtensionFolderName();

let app = null;
let bootstrapped = false;

function detectExtensionFolderName() {
    try {
        const parts = String(import.meta.url || '').split('/');
        const idx = parts.lastIndexOf('third-party');
        if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]);
    } catch {
        /* ignore */
    }
    return 'momo';
}

function ensureFloatingButton() {
    let btn = document.getElementById('st-momo-fab');
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = 'st-momo-fab';
    btn.type = 'button';
    btn.className = 'mm-fab';
    btn.title = '拖动移动 · 点击打开/关闭陌陌';
    btn.setAttribute('aria-label', '打开或关闭陌陌');
    btn.innerHTML = '<span class="mm-fab-label">陌</span>';

    // Mount on body so it is never clipped by ST containers
    document.body.appendChild(btn);
    return btn;
}

function injectToolbarButton() {
    if (document.getElementById('st-momo-toolbar-btn')) return;

    const hosts = [
        document.getElementById('top-settings-holder'),
        document.getElementById('leftSendForm'),
        document.getElementById('rightSendForm'),
        document.getElementById('extensionsMenu'),
        document.querySelector('#form_sheld'),
    ].filter(Boolean);

    if (!hosts.length) return;

    const btn = document.createElement('div');
    btn.id = 'st-momo-toolbar-btn';
    btn.className = 'menu_button menu_button_icon';
    btn.title = '陌陌虚拟社交';
    btn.innerHTML = '<span style="font-weight:800;color:#ff2d7b;">陌</span>';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        app?.toggle();
    });
    hosts[0].appendChild(btn);
}

async function loadSettingsPanel() {
    const folder = `scripts/extensions/third-party/${EXTENSION_NAME}`;
    try {
        const html = await $.get(`${folder}/settings.html`);
        const host = $('#extensions_settings2').length
            ? $('#extensions_settings2')
            : $('#extensions_settings');
        if (!host.length) return;
        if (document.querySelector('.st-momo-settings')) return;

        host.append(html);
        $('#st-momo-open-btn').on('click', () => app?.toggle(true));
        $('#st-momo-close-btn').on('click', () => app?.toggle(false));
        $('#st-momo-reset-btn').on('click', () => {
            if (!confirm('确定清空陌陌扩展数据？')) return;
            app?.store.resetAll();
            if (app?.chatView) app.chatView.activePeerId = null;
            if (app?.matchView) app.matchView.candidate = null;
            toastr?.warning?.('陌陌数据已清空');
            if (app?.open) app.render('me');
        });
    } catch (e) {
        console.warn('[st-momo] settings panel skipped', e);
    }
}

async function bootstrap() {
    if (bootstrapped) return;
    bootstrapped = true;

    console.log(`[st-momo] boot folder=${EXTENSION_NAME}`);

    // Create FAB immediately so users always see an entry point
    ensureFloatingButton();

    app = new MomoApp();
    app.mount(ensureFloatingButton());
    window.StMomo = app;

    injectToolbarButton();
    await loadSettingsPanel();

    // Retry toolbar injection — ST mobile DOM mounts late
    setTimeout(injectToolbarButton, 1500);
    setTimeout(injectToolbarButton, 4000);

    console.log('[st-momo] ready — use the pink floating button to open/close');
}

function start() {
    const run = () => {
        bootstrap().catch((err) => {
            console.error('[st-momo] bootstrap failed', err);
            bootstrapped = false;
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
        run();
    }

    // SillyTavern lifecycle (if available)
    try {
        const ctx = window.SillyTavern?.getContext?.();
        const eventSource = ctx?.eventSource;
        const event_types = ctx?.eventTypes || ctx?.event_types;
        if (eventSource?.once && event_types?.APP_READY) {
            eventSource.once(event_types.APP_READY, () => {
                ensureFloatingButton();
                injectToolbarButton();
            });
        }
    } catch {
        /* ignore */
    }
}

if (typeof jQuery !== 'undefined') {
    jQuery(start);
} else {
    start();
}
