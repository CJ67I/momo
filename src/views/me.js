import { avatarGradient, escapeHtml, toast } from '../utils.js';

export class MeView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
    }

    render() {
        const p = this.app.store.getProfile();
        const settings = this.app.store.getSettings();
        const friends = this.app.store.getFriends().length;

        return `
            <section class="mm-page mm-me">
                <header class="mm-topbar">
                    <div class="mm-brand">我</div>
                </header>
                <div class="mm-me-hero">
                    <div class="mm-avatar lg" style="background:${avatarGradient(p.id)}">${escapeHtml(p.avatarText || '我')}</div>
                    <div>
                        <h2>${escapeHtml(p.nickname)} <small>${p.age}</small></h2>
                        <p class="mm-muted">${escapeHtml(p.city)} · ${p.gender === 'female' ? '女' : '男'}</p>
                        <p class="mm-me-bio">${escapeHtml(p.bio)}</p>
                        <p class="mm-muted">好友 ${friends}</p>
                    </div>
                </div>

                <form class="mm-form" id="mm-profile-form">
                    <label>昵称<input name="nickname" value="${escapeHtml(p.nickname)}" maxlength="16" required /></label>
                    <label>年龄<input name="age" type="number" min="18" max="60" value="${Number(p.age) || 22}" required /></label>
                    <label>城市<input name="city" value="${escapeHtml(p.city)}" maxlength="20" required /></label>
                    <label>性别
                        <select name="gender">
                            <option value="male" ${p.gender === 'male' ? 'selected' : ''}>男</option>
                            <option value="female" ${p.gender === 'female' ? 'selected' : ''}>女</option>
                        </select>
                    </label>
                    <label>简介<textarea name="bio" rows="3" maxlength="80">${escapeHtml(p.bio)}</textarea></label>
                    <button type="submit" class="mm-btn mm-btn-block">保存资料</button>
                </form>

                <div class="mm-settings">
                    <label class="mm-switch">
                        <span>好友自动回复</span>
                        <input type="checkbox" id="mm-auto-reply" ${settings.autoReply ? 'checked' : ''} />
                    </label>
                    <label class="mm-switch">
                        <span>优先使用酒馆 AI 回复</span>
                        <input type="checkbox" id="mm-ai-reply" ${settings.useAiReply ? 'checked' : ''} />
                    </label>
                    <button type="button" class="mm-btn mm-btn-ghost mm-btn-block" data-action="reset">清空本地数据</button>
                </div>
            </section>
        `;
    }

    bind(root) {
        root.querySelector('#mm-profile-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const nickname = String(fd.get('nickname') || '').trim();
            const age = Number(fd.get('age')) || 22;
            const city = String(fd.get('city') || '').trim();
            const gender = String(fd.get('gender') || 'male');
            const bio = String(fd.get('bio') || '').trim();
            this.app.store.updateProfile({
                nickname,
                age,
                city,
                gender,
                bio,
                avatarText: nickname.slice(0, 1) || '我',
            });
            toast('资料已保存', 'success');
            this.app.render('me');
        });

        root.querySelector('#mm-auto-reply')?.addEventListener('change', (e) => {
            this.app.store.updateSettings({ autoReply: e.target.checked });
        });
        root.querySelector('#mm-ai-reply')?.addEventListener('change', (e) => {
            this.app.store.updateSettings({ useAiReply: e.target.checked });
        });
        root.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
            if (!confirm('确定清空陌陌扩展的全部本地数据？')) return;
            this.app.store.resetAll();
            this.app.chatView.activePeerId = null;
            this.app.matchView.candidate = null;
            toast('已清空', 'warning');
            this.app.render('me');
        });
    }
}
