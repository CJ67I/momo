import { createStrangerPool } from '../npc-factory.js';
import { avatarGradient, escapeHtml, normalizeGender, oppositeGender, toast } from '../utils.js';

const QUEUE_SIZE = 8;
const LOW_WATER = 3;

export class MatchView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.queue = [];
        this.animating = false;
        this.loading = false;
    }

    _expectedGender() {
        return oppositeGender(this.app.store.getProfile()?.gender);
    }

    _isValid(user) {
        return user && normalizeGender(user.gender) === this._expectedGender();
    }

    get candidate() {
        return this.queue[0] || null;
    }

    resetForGenderChange() {
        this.queue = [];
        this.loading = false;
    }

    async refillQueue({ replace = false } = {}) {
        if (this.loading) return;
        this.loading = true;
        if (this.app.tab === 'match' && this.app.stackPage == null) {
            this.app.render('match');
        }
        try {
            const batch = await createStrangerPool(this.app.store.getProfile(), QUEUE_SIZE, {
                preferFast: true,
                parallel: true,
            });
            const valid = batch.filter((u) => this._isValid(u));
            this.queue = replace ? valid : [...this.queue, ...valid];
            // stash for profile resolve
            const strangers = this.app.store.getStrangers();
            const merged = [...valid, ...strangers]
                .filter((u, i, arr) => arr.findIndex((x) => x.id === u.id) === i)
                .slice(0, 30);
            this.app.store.setStrangers(merged);
            toast(replace ? `已刷新 ${valid.length} 位异性` : `已补充 ${valid.length} 位`, 'success');
        } catch (e) {
            console.error(e);
            toast('匹配池刷新失败', 'error');
        } finally {
            this.loading = false;
            if (this.app.tab === 'match' && this.app.stackPage == null) {
                this.app.render('match');
            }
        }
    }

    ensureQueue() {
        if (this.queue.length > 0 || this.loading) return;
        this.refillQueue({ replace: true });
    }

    advance() {
        if (this.queue.length) this.queue.shift();
        if (this.queue.length < LOW_WATER && !this.loading) {
            // background refill, keep browsing remaining
            this.refillQueue({ replace: false });
        }
        this.app.render('match');
    }

    render() {
        this.ensureQueue();
        const c = this.candidate;
        const remain = Math.max(0, this.queue.length - (c ? 1 : 0));

        if (!c) {
            return `
                <section class="mm-page mm-match mm-page-enter">
                    <header class="mm-topbar">
                        <div class="mm-brand">匹配</div>
                        <button type="button" class="mm-icon-btn ${this.loading ? 'is-spinning' : ''}" data-action="refresh-queue" title="刷新一批">
                            <span class="mm-refresh-icon">↻</span>
                        </button>
                    </header>
                    <div class="mm-empty">
                        ${this.loading ? '正在一次生成多位异性…' : '点右上角刷新，一次加载多人'}
                        <div class="mm-loading-dots" aria-hidden="true"><i></i><i></i><i></i></div>
                    </div>
                </section>
            `;
        }

        const tags = (c.tags || []).map((t) => `<span class="mm-tag">${escapeHtml(t)}</span>`).join('');
        const genderLabel = normalizeGender(c.gender) === 'female' ? '女' : '男';
        const stackPreview = this.queue.slice(1, 4);

        return `
            <section class="mm-page mm-match mm-page-enter">
                <header class="mm-topbar">
                    <div class="mm-brand">匹配</div>
                    <div class="mm-match-meta">
                        <span class="mm-muted">队列 ${this.queue.length} 人</span>
                        <button type="button" class="mm-icon-btn ${this.loading ? 'is-spinning' : ''}" data-action="refresh-queue" title="刷新一批（${QUEUE_SIZE}人）">
                            <span class="mm-refresh-icon">↻</span>
                        </button>
                    </div>
                </header>
                <div class="mm-match-stage">
                    ${stackPreview.map((_, i) => `<div class="mm-match-stack s${i + 1}"></div>`).join('')}
                    <div class="mm-match-card mm-card-pop" id="mm-match-card">
                        <div class="mm-match-cover" style="background:${avatarGradient(c.id)}">
                            <div class="mm-match-avatar">${escapeHtml(c.avatarText)}</div>
                            <div class="mm-match-online ${c.online ? 'is-on' : ''}">${c.online ? '在线' : '刚刚来过'}</div>
                        </div>
                        <div class="mm-match-body">
                            <h2>${escapeHtml(c.nickname)} <small>${c.age}</small></h2>
                            <p class="mm-muted">${escapeHtml(c.city)} · ${escapeHtml(genderLabel)} · ${escapeHtml(c.distance || '')}</p>
                            <p class="mm-match-bio">${escapeHtml(c.bio)}</p>
                            <div class="mm-tags">${tags}</div>
                            <button type="button" class="mm-link" data-action="view-profile" style="margin-top:10px">查看主页</button>
                        </div>
                    </div>
                </div>
                <p class="mm-match-hint">还可继续滑 ${remain} 人${this.loading ? ' · 后台补充中' : ''}</p>
                <div class="mm-match-actions">
                    <button type="button" class="mm-round-btn mm-pass" data-action="pass" title="跳过">✕</button>
                    <button type="button" class="mm-round-btn mm-like" data-action="like" title="喜欢并加好友">♥</button>
                </div>
            </section>
        `;
    }

    bind(root) {
        root.querySelector('[data-action="refresh-queue"]')?.addEventListener('click', () => {
            if (this.loading) return;
            this.refillQueue({ replace: true });
        });

        root.querySelector('[data-action="pass"]')?.addEventListener('click', () => {
            if (this.animating || !this.candidate) return;
            this._swipe('left', () => this.advance());
        });

        root.querySelector('[data-action="like"]')?.addEventListener('click', () => {
            if (this.animating || !this.candidate) return;
            const c = this.candidate;
            this._swipe('right', () => {
                if (c) {
                    this.app.store.pushMatch(c);
                    this.app.store.addFriend(c);
                    toast(`匹配成功！已添加 ${c.nickname}`, 'success');
                }
                this.advance();
            });
        });

        root.querySelector('[data-action="view-profile"]')?.addEventListener('click', () => {
            const c = this.candidate;
            if (!c) return;
            this.app.openProfile(c.id, 'match');
        });
    }

    _swipe(dir, done) {
        const card = document.getElementById('mm-match-card');
        if (!card) {
            done();
            return;
        }
        this.animating = true;
        card.classList.add(dir === 'left' ? 'swipe-left' : 'swipe-right');
        setTimeout(() => {
            this.animating = false;
            done();
        }, 280);
    }
}
