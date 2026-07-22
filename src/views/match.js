import { createStrangerPool } from '../npc-factory.js';
import { bindPullToRefresh, ptrMarkup } from '../pull-refresh.js';
import { injectMatchSuccess } from '../story-inject.js';
import { avatarGradient, escapeHtml, normalizeGender, oppositeGender, toast } from '../utils.js';

const QUEUE_SIZE = 8;
const LOW_WATER = 3;
const SWIPE_MS = 360;

export class MatchView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.queue = [];
        this.animating = false;
        this.loading = false;
        this._ptrDispose = null;
        this._cardSwipeDispose = null;
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
        if (!this.queue.length && this.app.tab === 'match' && this.app.stackPage == null) {
            this.app.render('match');
        }
        try {
            const batch = await createStrangerPool(this.app.store.getProfile(), QUEUE_SIZE, {
                preferFast: true,
                parallel: true,
            });
            const valid = batch.filter((u) => this._isValid(u));
            this.queue = replace ? valid : [...this.queue, ...valid];
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
                        <span class="mm-muted">下拉刷新</span>
                    </header>
                    <div class="mm-match-scroll mm-scroll" id="mm-match-scroll">
                        ${ptrMarkup()}
                        <div class="mm-empty">
                            ${this.loading ? '正在一次生成多位异性…' : '下拉刷新，一次加载多人'}
                            <div class="mm-loading-dots" aria-hidden="true"><i></i><i></i><i></i></div>
                        </div>
                    </div>
                </section>
            `;
        }

        const tags = (c.tags || []).map((t) => `<span class="mm-tag">${escapeHtml(t)}</span>`).join('');
        const genderLabel = normalizeGender(c.gender) === 'female' ? '女' : '男';
        const ageClass = normalizeGender(c.gender) === 'female' ? 'is-female' : 'is-male';
        const stackPreview = this.queue.slice(1, 4);

        return `
            <section class="mm-page mm-match mm-page-enter">
                <header class="mm-topbar">
                    <div class="mm-brand">匹配</div>
                    <span class="mm-muted">队列 ${this.queue.length}</span>
                </header>
                <div class="mm-match-scroll mm-scroll" id="mm-match-scroll">
                    ${ptrMarkup()}
                    <div class="mm-match-stage">
                        ${stackPreview.map((_, i) => `<div class="mm-match-stack s${i + 1}"></div>`).join('')}
                        <div class="mm-match-card mm-card-pop" id="mm-match-card">
                            <div class="mm-swipe-stamp mm-stamp-like">喜欢</div>
                            <div class="mm-swipe-stamp mm-stamp-nope">跳过</div>
                            <div class="mm-match-cover" style="background:${avatarGradient(c.id)}">
                                <div class="mm-match-avatar">${escapeHtml(c.avatarText)}</div>
                                <div class="mm-match-online ${c.online ? 'is-on' : ''}">${c.online ? '在线' : '刚刚来过'}</div>
                            </div>
                            <div class="mm-match-body">
                                <h2>${escapeHtml(c.nickname)} <span class="mm-chip mm-age ${ageClass}">${c.age}</span></h2>
                                <p class="mm-muted">${escapeHtml(c.city)} · ${escapeHtml(genderLabel)} · ${escapeHtml(c.distance || '')}</p>
                                <p class="mm-match-bio">${escapeHtml(c.bio)}</p>
                                <div class="mm-tags">${tags}</div>
                                <button type="button" class="mm-link" data-action="view-profile" style="margin-top:10px">查看主页</button>
                            </div>
                        </div>
                    </div>
                    <p class="mm-match-hint">左右滑卡片 · 下拉刷新 · 还可滑 ${remain} 人${this.loading ? ' · 补充中' : ''}</p>
                    <div class="mm-match-actions">
                        <button type="button" class="mm-round-btn mm-pass" data-action="pass" title="跳过">✕</button>
                        <button type="button" class="mm-round-btn mm-like" data-action="like" title="喜欢并加好友">♥</button>
                    </div>
                </div>
            </section>
        `;
    }

    bind(root) {
        this._ptrDispose?.();
        this._cardSwipeDispose?.();

        const scroll = root.querySelector('#mm-match-scroll');
        this._ptrDispose = bindPullToRefresh(scroll, {
            onRefresh: () => this.refillQueue({ replace: true }),
        });

        root.querySelector('[data-action="pass"]')?.addEventListener('click', () => {
            if (this.animating || !this.candidate) return;
            this._swipe('left', () => this.advance());
        });

        root.querySelector('[data-action="like"]')?.addEventListener('click', () => {
            if (this.animating || !this.candidate) return;
            this._likeCurrent();
        });

        root.querySelector('[data-action="view-profile"]')?.addEventListener('click', () => {
            const c = this.candidate;
            if (!c) return;
            this.app.openProfile(c.id, 'match');
        });

        this._cardSwipeDispose = this._bindCardSwipe(root.querySelector('#mm-match-card'));
    }

    _likeCurrent() {
        const c = this.candidate;
        this._swipe('right', async () => {
            if (c) {
                this.app.store.pushMatch(c);
                this.app.store.addFriend(c);
                await injectMatchSuccess(c);
                toast(`匹配成功！已添加 ${c.nickname}`, 'success');
            }
            this.advance();
        });
    }

    _bindCardSwipe(card) {
        if (!card) return () => {};
        let startX = 0;
        let startY = 0;
        let dx = 0;
        let active = false;
        let locked = false;

        const likeStamp = card.querySelector('.mm-stamp-like');
        const nopeStamp = card.querySelector('.mm-stamp-nope');
        const stage = card.closest('.mm-match-stage');

        const reset = () => {
            card.style.transition = 'transform .22s ease, opacity .22s ease, filter .22s ease';
            card.style.transform = '';
            card.style.opacity = '';
            card.style.filter = '';
            card.classList.remove('is-dragging');
            if (likeStamp) likeStamp.style.opacity = '0';
            if (nopeStamp) nopeStamp.style.opacity = '0';
            stage?.classList.remove('is-swiping');
        };

        const paint = (x) => {
            const rot = x / 16;
            const fade = Math.max(0.28, 1 - Math.abs(x) / 240);
            const blur = Math.min(2.2, Math.abs(x) / 140);
            card.style.transform = `translateX(${x}px) rotate(${rot}deg) scale(${1 - Math.abs(x) / 1800})`;
            card.style.opacity = String(fade);
            card.style.filter = blur > 0.35 ? `blur(${blur}px)` : '';
            if (likeStamp) likeStamp.style.opacity = String(Math.min(1, Math.max(0, x / 80)));
            if (nopeStamp) nopeStamp.style.opacity = String(Math.min(1, Math.max(0, -x / 80)));
        };

        const onDown = (e) => {
            if (this.animating) return;
            const t = e.touches?.[0] || e;
            startX = t.clientX;
            startY = t.clientY;
            dx = 0;
            active = true;
            locked = false;
            card.style.transition = 'none';
            card.classList.add('is-dragging');
        };

        const onMove = (e) => {
            if (!active || this.animating) return;
            const t = e.touches?.[0] || e;
            const mx = t.clientX - startX;
            const my = t.clientY - startY;
            if (!locked) {
                if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 10) {
                    active = false;
                    reset();
                    return;
                }
                if (Math.abs(mx) > 8) {
                    locked = true;
                    stage?.classList.add('is-swiping');
                }
            }
            dx = mx;
            paint(dx);
            if (locked) e.preventDefault?.();
        };

        const onUp = () => {
            if (!active) return;
            active = false;
            if (dx > 88) {
                this._likeCurrent();
                return;
            }
            if (dx < -88) {
                this._swipe('left', () => this.advance());
                return;
            }
            reset();
        };

        card.addEventListener('touchstart', onDown, { passive: true });
        card.addEventListener('touchmove', onMove, { passive: false });
        card.addEventListener('touchend', onUp);
        card.addEventListener('touchcancel', onUp);
        card.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);

        return () => {
            card.removeEventListener('touchstart', onDown);
            card.removeEventListener('touchmove', onMove);
            card.removeEventListener('touchend', onUp);
            card.removeEventListener('touchcancel', onUp);
            card.removeEventListener('mousedown', onDown);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }

    _swipe(dir, done) {
        const card = document.getElementById('mm-match-card');
        const stage = card?.closest('.mm-match-stage');
        if (!card) {
            done();
            return;
        }
        this.animating = true;
        stage?.classList.add('is-swiping');
        card.classList.add('is-leaving');
        card.style.transition = `transform ${SWIPE_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity ${SWIPE_MS}ms ease, filter ${SWIPE_MS}ms ease`;
        // force paint then apply exit
        void card.offsetWidth;
        card.classList.add(dir === 'left' ? 'swipe-left' : 'swipe-right');
        setTimeout(() => {
            this.animating = false;
            done();
        }, SWIPE_MS);
    }
}
