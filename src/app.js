import { MomoStore } from './storage.js';
import { createPostsForUsers, createStrangerPool } from './npc-factory.js';
import { makeDraggable } from './drag.js';
import { HomeView } from './views/home.js';
import { MatchView } from './views/match.js';
import { ChatView } from './views/chat.js';
import { MeView } from './views/me.js';

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
        this.tab = 'home';
        this.open = false;
        this.root = null;
        this._scrollLockY = 0;
    }

    mount() {
        if (document.getElementById('st-momo-root')) return;
        const root = document.createElement('div');
        root.id = 'st-momo-root';
        root.innerHTML = `
            <button type="button" id="st-momo-launcher" class="mm-launcher" title="拖动可移动，点击打开陌陌" aria-label="打开陌陌">陌</button>
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
        this._bindShell();
        this._tickClock();
        this._seedIfNeeded();
    }

    _seedIfNeeded() {
        if (this.store.getPosts().length > 0) return;
        const profile = this.store.getProfile();
        const strangers = createStrangerPool(profile, 6);
        this.store.setStrangers(strangers);
        this.store.upsertPosts(createPostsForUsers(strangers, false));
    }

    _bindShell() {
        const launcher = this.root.querySelector('#st-momo-launcher');
        const overlay = this.root.querySelector('#st-momo-overlay');
        const closeBtn = this.root.querySelector('#mm-close-btn');
        const phone = this.root.querySelector('.mm-phone');

        makeDraggable(launcher, {
            onTap: () => this.toggle(true),
            storage: true,
        });

        closeBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggle(false);
        });

        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) this.toggle(false);
        });

        // Block background scroll / ST gesture bleed on mobile
        overlay?.addEventListener('touchmove', (e) => {
            if (e.target === overlay) e.preventDefault();
        }, { passive: false });

        phone?.addEventListener('click', (e) => e.stopPropagation());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.open) this.toggle(false);
        });

        // Keep panel inside visual viewport on rotate / keyboard
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
        const launcher = this.root?.querySelector('#st-momo-launcher');
        if (!overlay) return;

        if (this.open) {
            overlay.classList.add('is-open');
            overlay.setAttribute('aria-hidden', 'false');
            launcher?.classList.add('is-hidden');
            this._lockBodyScroll(true);
            this._syncViewportClass();
            // next frame for CSS transition
            requestAnimationFrame(() => overlay.classList.add('is-visible'));
            this.render(this.tab);
        } else {
            overlay.classList.remove('is-visible');
            overlay.setAttribute('aria-hidden', 'true');
            launcher?.classList.remove('is-hidden');
            this._lockBodyScroll(false);
            setTimeout(() => {
                if (!this.open) overlay.classList.remove('is-open');
            }, 220);
        }
    }

    openChat(peerId) {
        this.tab = 'chat';
        this.chatView.open(peerId);
    }

    render(tab = this.tab) {
        this.tab = tab;
        const screen = this.root?.querySelector('#mm-screen');
        const tabbar = this.root?.querySelector('#mm-tabbar');
        if (!screen || !tabbar) return;

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
                const next = btn.getAttribute('data-tab');
                if (next !== 'chat') this.chatView.activePeerId = null;
                this.render(next);
            });
        });

        let view;
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

        screen.innerHTML = view.render();
        view.bind(screen);
    }
}
