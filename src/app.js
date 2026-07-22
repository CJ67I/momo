import { MomoStore } from './storage.js';
import { createStrangerPool } from './npc-factory.js';
import { scheduleFriendPersonaEnrichment } from './npc-persona.js';
import { startProactiveLoop } from './proactive.js';
import { formatClockHm, getVirtualNow } from './time.js';
import { makeDraggable } from './drag.js';
import { HomeView } from './views/home.js';
import { MatchView } from './views/match.js';
import { ChatView } from './views/chat.js';
import { MeView } from './views/me.js';
import { ProfileView } from './views/profile.js';
import { canUseTavernApi } from './ai.js';
import { ensureGenerationGuard } from './api-client.js';
import { toast } from './utils.js';

const TABS = [
    { id: 'home', label: '首页', icon: '⌂' },
    { id: 'match', label: '匹配', icon: '♡' },
    { id: 'chat', label: '消息', icon: '✎' },
    { id: 'me', label: '我', icon: '☺' },
];

export class MomoApp {
    constructor() {
        this.store = new MomoStore();
        this.homeView = new HomeView(this);
        this.matchView = new MatchView(this);
        this.chatView = new ChatView(this);
        this.meView = new MeView(this);
        this.profileView = new ProfileView(this);
        this.tab = 'home';
        this.stackPage = null; // 'profile' | null
        this.open = false;
        this.root = null;
        this.fab = null;
        this._scrollLockY = 0;
        this._dragDispose = null;
        this._clockTimer = null;
    }

    /**
     * @param {HTMLElement | null} fab external floating action button
     */
    mount(fab = null) {
        if (document.getElementById('st-momo-root')) {
            this.root = document.getElementById('st-momo-root');
            this.fab = fab || document.getElementById('st-momo-fab');
            this._bindFab();
            return;
        }

        const root = document.createElement('div');
        root.id = 'st-momo-root';
        root.innerHTML = `
            <div id="st-momo-overlay" class="mm-overlay" aria-hidden="true">
                <div class="mm-phone" role="dialog" aria-modal="true" aria-label="陌陌虚拟社交">
                    <div class="mm-status" id="mm-status-bar">
                        <span class="mm-status-time" id="mm-clock">12:00</span>
                        <span class="mm-status-title">陌陌</span>
                        <button type="button" class="mm-close-btn" id="mm-close-btn" title="关闭" aria-label="关闭">✕</button>
                    </div>
                    <div class="mm-screen" id="mm-screen"></div>
                    <nav class="mm-tabbar" id="mm-tabbar"></nav>
                </div>
            </div>
        `;
        document.body.appendChild(root);
        this.root = root;
        this.fab = fab || document.getElementById('st-momo-fab');
        this._bindShell();
        this._bindFab();
        this._tickClock();
        this._seedIfNeeded();
        this._syncFabState();
        startProactiveLoop(this);
        ensureGenerationGuard();
        // Purge legacy IN_CHAT / broken slots that can empty main-chat replies
        import('./interop.js').then((m) => {
            m.purgeAllMomoPrompts();
            m.clearSoftPrompt();
            m.syncInteropFromSettings();
        }).catch(() => {});
    }

    /**
     * Add friend and kick off background AI persona/style generation.
     * @param {object} user
     */
    addFriendAndEnrich(user) {
        const friend = this.store.addFriend(user);
        if (friend) scheduleFriendPersonaEnrichment(this, friend);
        return friend;
    }

    async _seedIfNeeded() {
        // Home feeds are generated per-tab via API on first visit / pull-to-refresh.
        // Only warm up a small stranger pool for Match when empty.
        if (this.store.getStrangers().length > 0) return;
        if (!canUseTavernApi()) return;
        const profile = this.store.getProfile();
        try {
            const strangers = await createStrangerPool(profile, 4, {
                city: profile.city,
                preferFast: true,
                parallel: true,
            });
            this.store.setStrangers(strangers);
        } catch (e) {
            console.warn('[st-momo] seed strangers failed', e);
        }
    }

    /** Rebuild stranger pool after gender change — do not wipe recommend/friends feeds. */
    async regenerateOppositePool() {
        this.matchView?.resetForGenderChange?.();
        const profile = this.store.getProfile();
        if (!canUseTavernApi()) {
            toast('酒馆 API 未在线，异性池稍后可在匹配页重试', 'warning');
            this.store.replaceChannelPosts('nearby', []);
            return;
        }
        const strangers = await createStrangerPool(profile, 6, {
            city: profile.city,
            preferFast: false,
            parallel: true,
        });
        this.store.setStrangers(strangers);
        // Nearby must rebuild with new opposite-gender locals; leave other channels alone
        this.store.replaceChannelPosts('nearby', []);
        if (this.homeView) this.homeView._autoTried.nearby = false;
    }

    _tickClock() {
        const el = this.root?.querySelector('#mm-clock');
        const paint = () => {
            if (!el) return;
            el.textContent = formatClockHm(getVirtualNow(this.store.getSettings()));
            el.title = `陌陌时间 ×${this.store.getSettings().timeScale || 1}`;
        };
        paint();
        if (this._clockTimer) clearInterval(this._clockTimer);
        this._clockTimer = setInterval(paint, 1000);
    }

    _bindFab() {
        if (!this.fab) return;
        this._dragDispose?.();
        this._dragDispose = makeDraggable(this.fab, {
            onTap: () => this.toggle(),
            storage: true,
        });
        this._syncFabState();
    }

    _syncFabState() {
        if (!this.fab) return;
        let label = this.fab.querySelector('.mm-fab-label');
        if (!label) {
            this.fab.innerHTML = '<span class="mm-fab-label"></span>';
            label = this.fab.querySelector('.mm-fab-label');
        }
        if (this.open) {
            this.fab.classList.add('is-open');
            this.fab.setAttribute('aria-label', '关闭陌陌');
            this.fab.title = '拖动移动 · 点击关闭陌陌';
            label.textContent = '✕';
        } else {
            this.fab.classList.remove('is-open');
            this.fab.setAttribute('aria-label', '打开陌陌');
            this.fab.title = '拖动移动 · 点击打开陌陌';
            label.textContent = '陌';
        }
    }

    _bindShell() {
        const overlay = this.root.querySelector('#st-momo-overlay');
        const closeBtn = this.root.querySelector('#mm-close-btn');
        const phone = this.root.querySelector('.mm-phone');

        closeBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggle(false);
        });

        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) this.toggle(false);
        });

        overlay?.addEventListener('touchmove', (e) => {
            if (e.target === overlay) e.preventDefault();
        }, { passive: false });

        phone?.addEventListener('click', (e) => e.stopPropagation());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.open) this.toggle(false);
        });

        window.addEventListener('resize', () => {
            if (this.open) this._syncViewportClass();
        });
        window.visualViewport?.addEventListener('resize', () => {
            if (this.open) this._syncViewportClass();
        });
    }

    _syncViewportClass() {
        const overlay = this.root?.querySelector('#st-momo-overlay');
        const phone = this.root?.querySelector('.mm-phone');
        if (!overlay || !phone) return;
        const h = window.visualViewport?.height || window.innerHeight;
        phone.style.maxHeight = `${Math.round(h)}px`;
        overlay.style.height = `${Math.round(h)}px`;
    }

    _lockBodyScroll(lock) {
        const body = document.body;
        if (lock) {
            this._scrollLockY = window.scrollY || 0;
            body.classList.add('st-momo-scroll-lock');
            body.style.top = `-${this._scrollLockY}px`;
        } else {
            body.classList.remove('st-momo-scroll-lock');
            body.style.top = '';
            window.scrollTo(0, this._scrollLockY || 0);
        }
    }

    toggle(force) {
        this.open = typeof force === 'boolean' ? force : !this.open;
        const overlay = this.root?.querySelector('#st-momo-overlay');
        if (!overlay) return;

        if (this.open) {
            overlay.classList.add('is-open');
            overlay.setAttribute('aria-hidden', 'false');
            this._lockBodyScroll(true);
            this._syncViewportClass();
            requestAnimationFrame(() => overlay.classList.add('is-visible'));
            this.render(this.stackPage === 'profile' ? 'profile' : this.tab);
        } else {
            overlay.classList.remove('is-visible');
            overlay.setAttribute('aria-hidden', 'true');
            this._lockBodyScroll(false);
            setTimeout(() => {
                if (!this.open) overlay.classList.remove('is-open');
            }, 220);
        }

        this._syncFabState();
    }

    openChat(peerId) {
        this.stackPage = null;
        this.tab = 'chat';
        this.chatView.open(peerId);
    }

    openProfile(userId, returnTab = this.tab) {
        this.profileView.open(userId, returnTab);
    }

    render(tab = this.tab) {
        if (tab !== 'profile') {
            this.tab = tab;
            if (tab !== 'chat') this.chatView.activePeerId = null;
        }

        const screen = this.root?.querySelector('#mm-screen');
        const tabbar = this.root?.querySelector('#mm-tabbar');
        if (!screen || !tabbar) return;

        const showProfile = this.stackPage === 'profile' || tab === 'profile';
        tabbar.style.display = showProfile ? 'none' : '';

        if (!showProfile) {
            const unread = this.store.getChatList().reduce((n, c) => n + (c.unread || 0), 0);
            tabbar.innerHTML = TABS.map((t) => {
                const badge = t.id === 'chat' && unread > 0 ? `<i>${unread > 99 ? '99+' : unread}</i>` : '';
                return `
                    <button type="button" class="mm-tab ${this.tab === t.id ? 'is-active' : ''}" data-tab="${t.id}">
                        <span class="mm-tab-icon">${t.icon}</span>
                        <span>${t.label}</span>
                        ${badge}
                    </button>
                `;
            }).join('');

            tabbar.querySelectorAll('[data-tab]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this.stackPage = null;
                    const next = btn.getAttribute('data-tab');
                    this.render(next);
                });
            });
        }

        let view;
        if (showProfile) {
            view = this.profileView;
        } else {
            switch (this.tab) {
                case 'match':
                    view = this.matchView;
                    break;
                case 'chat':
                    view = this.chatView;
                    break;
                case 'me':
                    view = this.meView;
                    break;
                default:
                    view = this.homeView;
            }
        }

        screen.innerHTML = view.render();
        view.bind(screen);
    }
}
