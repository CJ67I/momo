import { MomoStore } from './storage.js';
import { createPostsForUsers, createStrangerPool } from './npc-factory.js';
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
    }

    mount() {
        if (document.getElementById('st-momo-root')) return;
        const root = document.createElement('div');
        root.id = 'st-momo-root';
        root.innerHTML = `
            <button type="button" id="st-momo-launcher" class="mm-launcher" title="打开陌陌">陌</button>
            <div id="st-momo-overlay" class="mm-overlay" hidden>
                <div class="mm-phone" role="dialog" aria-label="陌陌虚拟社交">
                    <div class="mm-status">
                        <span class="mm-status-time" id="mm-clock">12:00</span>
                        <span class="mm-status-dots">•••</span>
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
        this.root.querySelector('#st-momo-launcher')?.addEventListener('click', () => this.toggle(true));
        this.root.querySelector('#st-momo-overlay')?.addEventListener('click', (e) => {
            if (e.target?.id === 'st-momo-overlay') this.toggle(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.open) this.toggle(false);
        });
    }

    _tickClock() {
        const el = this.root?.querySelector('#mm-clock');
        const paint = () => {
            if (!el) return;
            const d = new Date();
            el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        };
        paint();
        setInterval(paint, 30000);
    }

    toggle(force) {
        this.open = typeof force === 'boolean' ? force : !this.open;
        const overlay = this.root?.querySelector('#st-momo-overlay');
        if (!overlay) return;
        if (this.open) {
            overlay.hidden = false;
            requestAnimationFrame(() => overlay.classList.add('is-visible'));
            this.render(this.tab);
        } else {
            overlay.classList.remove('is-visible');
            setTimeout(() => {
                if (!this.open) overlay.hidden = true;
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
