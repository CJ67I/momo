import { MomoApp } from './src/app.js';

const EXTENSION_NAME = 'st-momo';
const EXTENSION_FOLDER = `scripts/extensions/third-party/${EXTENSION_NAME}`;

let app = null;

function injectToolbarButton() {
    if (document.getElementById('st-momo-toolbar-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'st-momo-toolbar-btn';
    btn.className = 'menu_button menu_button_icon';
    btn.title = '陌陌虚拟社交';
    btn.innerHTML = '<span style="font-weight:800;color:#ff2d7b;">陌</span>';
    btn.addEventListener('click', () => app?.toggle(true));

    const topBar = document.getElementById('top-settings-holder')
        || document.getElementById('leftSendForm')
        || document.getElementById('extensionsMenu');

    if (topBar) {
        topBar.appendChild(btn);
    }
}

async function loadSettingsPanel() {
    try {
        const html = await $.get(`${EXTENSION_FOLDER}/settings.html`);
        const host = $('#extensions_settings2').length
            ? $('#extensions_settings2')
            : $('#extensions_settings');
        host.append(html);

        $('#st-momo-open-btn').on('click', () => app?.toggle(true));
        $('#st-momo-reset-btn').on('click', () => {
            if (!confirm('确定清空陌陌扩展数据？')) return;
            app?.store.resetAll();
            app?.chatView && (app.chatView.activePeerId = null);
            app?.matchView && (app.matchView.candidate = null);
            toastr?.warning?.('陌陌数据已清空');
            if (app?.open) app.render('me');
        });
    } catch (e) {
        console.warn('[st-momo] settings panel skipped', e);
    }
}

jQuery(async () => {
    console.log('[st-momo] loading…');
    app = new MomoApp();
    app.mount();
    window.StMomo = app;

    injectToolbarButton();
    await loadSettingsPanel();

    console.log('[st-momo] ready');
});
