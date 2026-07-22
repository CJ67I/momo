import { canUseTavernApi } from '../ai.js';
import { DEFAULT_FEED_PROMPT, DEFAULT_FEED_TEMPLATES } from '../feed-content.js';
import { createNpcFromCharacter } from '../npc-factory.js';
import {
    getApiStatus,
    getCharacterAvatarUrl,
    getCharacterInfo,
    getChatHistory,
    getPersonaInfo,
    getWorldInfoSnippets,
} from '../st-bridge.js';
import { listWorldBooks, loadWorldBook } from '../worldbook.js';
import { avatarGradient, escapeHtml, normalizeGender, oppositeGender, toast } from '../utils.js';

export class MeView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.bridgeInfo = {
            api: getApiStatus(),
            persona: getPersonaInfo(),
            character: getCharacterInfo(),
            chatCount: getChatHistory(50).length,
            worldBooks: [],
            worldSource: '',
            loaded: [],
        };
        this.availableBooks = [];
        this.bookBusy = false;
        this._bridgeHydrated = false;
    }

    async refreshBridge() {
        const wb = this.app.store.getWorldbookSettings();
        const world = await getWorldInfoSnippets('', 500, wb);
        this.availableBooks = await listWorldBooks();
        this.bridgeInfo = {
            api: getApiStatus(),
            persona: getPersonaInfo(),
            character: getCharacterInfo(),
            chatCount: getChatHistory(50).length,
            worldBooks: world.books || [],
            worldSource: world.source,
            loaded: world.loaded || [],
            selected: world.selected || wb.selected,
        };
    }

    render() {
        const p = this.app.store.getProfile();
        const settings = this.app.store.getSettings();
        const wb = this.app.store.getWorldbookSettings();
        const friends = this.app.store.getFriends().length;
        const api = this.bridgeInfo.api;
        const persona = this.bridgeInfo.persona;
        const character = this.bridgeInfo.character;
        const selected = new Set(wb.selected || []);
        const books = this.availableBooks.length
            ? this.availableBooks
            : (this.bridgeInfo.worldBooks || []).map((name) => ({ name, id: `wb:${name}` }));

        const apiOk = canUseTavernApi();
        const apiLine = !api.available
            ? '未检测到酒馆上下文（本地预览模式）'
            : apiOk
                ? `已接入 · ${api.mainApi || 'api'} · ${api.modelHint || api.onlineStatus}`
                : `未在线 · ${api.mainApi || 'api'} · ${api.onlineStatus}（NPC 将用本地话术回复）`;

        const opposite = oppositeGender(p.gender) === 'female' ? '女' : '男';

        const bookListHtml = books.length
            ? books.map((b) => `
                <label class="mm-wb-item">
                    <input type="checkbox" data-wb-name="${escapeHtml(b.name)}" ${selected.has(b.name) ? 'checked' : ''} />
                    <span>${escapeHtml(b.name)}</span>
                </label>
            `).join('')
            : `<div class="mm-muted" style="padding:8px 0">未发现世界书。请先在酒馆「世界书」面板创建/导入，再点下方刷新。</div>`;

        return `
            <section class="mm-page mm-me">
                <header class="mm-topbar">
                    <div class="mm-brand">我</div>
                    <button type="button" class="mm-link" data-action="refresh-bridge">刷新联动</button>
                </header>
                <div class="mm-me-hero">
                    <div class="mm-avatar lg" style="background:${avatarGradient(p.id)}">${escapeHtml(p.avatarText || '我')}</div>
                    <div>
                        <h2>${escapeHtml(p.nickname)} <small>${p.age}</small></h2>
                        <p class="mm-muted">${escapeHtml(p.city)} · ${normalizeGender(p.gender) === 'female' ? '女' : '男'}</p>
                        <p class="mm-me-bio">${escapeHtml(p.bio)}</p>
                        <p class="mm-muted">好友 ${friends} · 匹配对象应为「${opposite}」</p>
                    </div>
                </div>

                <div class="mm-card mm-bridge-card">
                    <h3>酒馆联动状态</h3>
                    <p class="mm-bridge-status ${apiOk ? 'ok' : 'warn'}">${escapeHtml(apiLine)}</p>
                    <ul class="mm-bridge-list">
                        <li>Persona：${escapeHtml(persona.name || '未设置')}${persona.description ? '（已读人设）' : ''}</li>
                        <li>角色卡：${escapeHtml(character?.name || '未选择')}</li>
                        <li>主聊天：${this.bridgeInfo.chatCount} 条可读</li>
                        <li>世界书发现：${books.length} 本 · 已选 ${(wb.selected || []).length} 本</li>
                        <li>注入状态：${escapeHtml(this.bridgeInfo.worldSource || 'none')}</li>
                        <li>generateRaw：${api.hasGenerateRaw ? '可用' : '不可用'}</li>
                    </ul>
                    <button type="button" class="mm-btn mm-btn-ghost mm-btn-block" data-action="sync-persona">从 Persona 同步昵称</button>
                    <button type="button" class="mm-btn mm-btn-block" data-action="import-character">导入当前角色卡为好友</button>
                </div>

                <div class="mm-card mm-bridge-card">
                    <h3>导入 / 选择世界书</h3>
                    <p class="mm-muted" style="margin:0 0 8px;font-size:12px;line-height:1.5">
                        勾选后按当前角色/会话分别保存。当前范围：<strong>${escapeHtml(wb.scopeLabel || '本地')}</strong>
                    </p>
                    <label class="mm-switch" style="margin-bottom:8px">
                        <span>启用世界书注入</span>
                        <input type="checkbox" id="mm-wb-enabled" ${wb.enabled ? 'checked' : ''} />
                    </label>
                    <label class="mm-switch" style="margin-bottom:8px">
                        <span>同时读取角色卡内嵌书</span>
                        <input type="checkbox" id="mm-wb-embedded" ${wb.includeEmbedded ? 'checked' : ''} />
                    </label>
                    <div class="mm-wb-list" id="mm-wb-list">${bookListHtml}</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
                        <button type="button" class="mm-btn" data-action="wb-save">保存选择</button>
                        <button type="button" class="mm-btn mm-btn-ghost" data-action="wb-refresh">刷新列表</button>
                        <button type="button" class="mm-btn mm-btn-ghost" data-action="wb-select-all">全选</button>
                        <button type="button" class="mm-btn mm-btn-ghost" data-action="wb-test">测试读取</button>
                    </div>
                    <div class="mm-muted" id="mm-wb-test-result" style="margin-top:8px;font-size:12px;white-space:pre-wrap"></div>
                </div>

                <div class="mm-card mm-bridge-card">
                    <h3>动态内容生成</h3>
                    <p class="mm-muted" style="margin:0 0 8px;font-size:12px;line-height:1.5">
                        可用占位符：<code>{{nickname}}</code> <code>{{age}}</code> <code>{{city}}</code>
                        <code>{{gender}}</code> <code>{{tag}}</code> <code>{{bio}}</code>
                    </p>
                    <label class="mm-switch" style="margin-bottom:8px">
                        <span>用 AI 按提示词生成动态</span>
                        <input type="checkbox" id="mm-ai-feed" ${settings.useAiFeed ? 'checked' : ''} />
                    </label>
                    <label class="mm-field-label">提示词（AI）
                        <textarea id="mm-feed-prompt" rows="4" placeholder="${escapeHtml(DEFAULT_FEED_PROMPT)}">${escapeHtml(settings.feedPrompt || '')}</textarea>
                    </label>
                    <label class="mm-field-label">模版（每行一条，本地随机 / AI 失败回退）
                        <textarea id="mm-feed-templates" rows="6" placeholder="${escapeHtml(DEFAULT_FEED_TEMPLATES.join('\n'))}">${escapeHtml(settings.feedTemplates || '')}</textarea>
                    </label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
                        <button type="button" class="mm-btn" data-action="feed-save">保存动态设定</button>
                        <button type="button" class="mm-btn mm-btn-ghost" data-action="feed-reset">恢复默认</button>
                    </div>
                </div>

                <form class="mm-form" id="mm-profile-form">
                    <label>昵称<input name="nickname" value="${escapeHtml(p.nickname)}" maxlength="16" required /></label>
                    <label>年龄<input name="age" type="number" min="18" max="60" value="${Number(p.age) || 22}" required /></label>
                    <label>城市<input name="city" value="${escapeHtml(p.city)}" maxlength="20" required /></label>
                    <label>性别
                        <select name="gender">
                            <option value="male" ${normalizeGender(p.gender) === 'male' ? 'selected' : ''}>男</option>
                            <option value="female" ${normalizeGender(p.gender) === 'female' ? 'selected' : ''}>女</option>
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
                        <span>优先使用酒馆 API 回复</span>
                        <input type="checkbox" id="mm-ai-reply" ${settings.useAiReply ? 'checked' : ''} />
                    </label>
                    <label class="mm-switch">
                        <span>AI 生成现代网名</span>
                        <input type="checkbox" id="mm-ai-names" ${settings.useAiNames !== false ? 'checked' : ''} />
                    </label>
                    <label class="mm-switch">
                        <span>线下模式（事件写入主聊天）</span>
                        <input type="checkbox" id="mm-story-inject" ${settings.storyInject ? 'checked' : ''} />
                    </label>
                    <p class="mm-muted" style="margin:0 12px 8px;font-size:11px;line-height:1.45">
                        开启后，匹配成功、加好友、刷动态等会以系统消息注入当前酒馆主聊天。
                    </p>
                    <button type="button" class="mm-btn mm-btn-ghost mm-btn-block" data-action="reset">清空本地数据</button>
                </div>
            </section>
        `;
    }

    _collectCheckedBooks(root) {
        return Array.from(root.querySelectorAll('[data-wb-name]:checked'))
            .map((el) => el.getAttribute('data-wb-name'))
            .filter(Boolean);
    }

    bind(root) {
        if (!this._bridgeHydrated) {
            this.refreshBridge().then(() => {
                this._bridgeHydrated = true;
                if (this.app.tab === 'me' && this.app.stackPage == null && this.app.open) {
                    this.app.render('me');
                }
            });
        }

        root.querySelector('#mm-profile-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const nickname = String(fd.get('nickname') || '').trim();
            const age = Number(fd.get('age')) || 22;
            const city = String(fd.get('city') || '').trim();
            const gender = normalizeGender(fd.get('gender') || 'male');
            const bio = String(fd.get('bio') || '').trim();
            const prevGender = normalizeGender(this.app.store.getProfile().gender);

            this.app.store.updateProfile({
                nickname,
                age,
                city,
                gender,
                bio,
                avatarText: nickname.slice(0, 1) || '我',
            });

            if (prevGender !== gender) {
                toast('性别已更新，正在重配异性池…', 'info');
                try {
                    await this.app.regenerateOppositePool();
                    toast(`已按「${gender === 'female' ? '女' : '男'}」重配异性 NPC`, 'success');
                } catch (err) {
                    console.error(err);
                    toast('重配失败，可到首页手动刷新', 'warning');
                }
            } else {
                toast('资料已保存', 'success');
            }
            this.app.render('me');
        });

        root.querySelector('#mm-auto-reply')?.addEventListener('change', (e) => {
            this.app.store.updateSettings({ autoReply: e.target.checked });
        });
        root.querySelector('#mm-ai-reply')?.addEventListener('change', (e) => {
            this.app.store.updateSettings({ useAiReply: e.target.checked });
        });
        root.querySelector('#mm-ai-names')?.addEventListener('change', (e) => {
            this.app.store.updateSettings({ useAiNames: e.target.checked });
        });
        root.querySelector('#mm-story-inject')?.addEventListener('change', (e) => {
            this.app.store.updateSettings({ storyInject: e.target.checked });
            toast(e.target.checked ? '已开启线下模式' : '已关闭线下模式', 'info');
        });
        root.querySelector('#mm-ai-feed')?.addEventListener('change', (e) => {
            this.app.store.updateSettings({ useAiFeed: e.target.checked });
        });
        root.querySelector('[data-action="feed-save"]')?.addEventListener('click', () => {
            const prompt = String(root.querySelector('#mm-feed-prompt')?.value || '');
            const templates = String(root.querySelector('#mm-feed-templates')?.value || '');
            const useAiFeed = Boolean(root.querySelector('#mm-ai-feed')?.checked);
            this.app.store.updateSettings({ feedPrompt: prompt, feedTemplates: templates, useAiFeed });
            toast('动态生成设定已保存', 'success');
        });
        root.querySelector('[data-action="feed-reset"]')?.addEventListener('click', () => {
            this.app.store.updateSettings({
                feedPrompt: DEFAULT_FEED_PROMPT,
                feedTemplates: DEFAULT_FEED_TEMPLATES.join('\n'),
                useAiFeed: false,
            });
            toast('已恢复默认动态模版', 'info');
            this.app.render('me');
        });
        root.querySelector('#mm-wb-enabled')?.addEventListener('change', (e) => {
            this.app.store.updateSettings({ worldbookEnabled: e.target.checked });
        });
        root.querySelector('#mm-wb-embedded')?.addEventListener('change', (e) => {
            this.app.store.updateSettings({ includeEmbeddedBook: e.target.checked });
        });

        root.querySelector('[data-action="wb-save"]')?.addEventListener('click', () => {
            const names = this._collectCheckedBooks(root);
            this.app.store.setWorldbookSelection(names);
            const scope = this.app.store.getWorldbookSettings().scopeLabel;
            toast(`已保存 ${names.length} 本到「${scope}」`, 'success');
            this.app.render('me');
        });

        root.querySelector('[data-action="wb-refresh"]')?.addEventListener('click', async () => {
            this._bridgeHydrated = false;
            await this.refreshBridge();
            this._bridgeHydrated = true;
            toast(`发现 ${this.availableBooks.length} 本世界书`, 'success');
            this.app.render('me');
        });

        root.querySelector('[data-action="wb-select-all"]')?.addEventListener('click', () => {
            root.querySelectorAll('[data-wb-name]').forEach((el) => { el.checked = true; });
        });

        root.querySelector('[data-action="wb-test"]')?.addEventListener('click', async () => {
            const box = root.querySelector('#mm-wb-test-result');
            const names = this._collectCheckedBooks(root);
            if (!names.length) {
                if (box) box.textContent = '请先勾选至少一本世界书';
                return;
            }
            if (box) box.textContent = '读取中…';
            const lines = [];
            for (const name of names.slice(0, 5)) {
                const book = await loadWorldBook(name);
                lines.push(book
                    ? `✓ ${name} · ${book.entries.length} 条 · via ${book.source}`
                    : `✗ ${name} · 读取失败`);
            }
            if (box) box.textContent = lines.join('\n');
        });

        root.querySelector('[data-action="refresh-bridge"]')?.addEventListener('click', async () => {
            this._bridgeHydrated = false;
            await this.refreshBridge();
            this._bridgeHydrated = true;
            toast('已刷新酒馆联动信息', 'success');
            this.app.render('me');
        });

        root.querySelector('[data-action="sync-persona"]')?.addEventListener('click', () => {
            const persona = getPersonaInfo();
            if (!persona.name) {
                toast('未读取到 Persona 名称', 'warning');
                return;
            }
            this.app.store.updateProfile({
                nickname: persona.name.slice(0, 16),
                avatarText: persona.name.slice(0, 1),
                bio: persona.description ? persona.description.slice(0, 80) : this.app.store.getProfile().bio,
            });
            toast(`已同步：${persona.name}`, 'success');
            this.app.render('me');
        });

        root.querySelector('[data-action="import-character"]')?.addEventListener('click', () => {
            const character = getCharacterInfo();
            if (!character?.name) {
                toast('请先在酒馆选择一个角色卡', 'warning');
                return;
            }
            const profile = this.app.store.getProfile();
            const npc = createNpcFromCharacter(character, {
                gender: oppositeGender(profile.gender),
                city: profile.city,
                avatarUrl: getCharacterAvatarUrl(character.avatar),
            });
            if (!npc) return;
            if (this.app.store.isFriend(npc.id)) {
                this.app.store.updateUser(npc);
                toast('已更新该角色好友资料', 'info');
            } else {
                this.app.store.addFriend(npc);
                toast(`已添加好友：${npc.nickname}`, 'success');
            }
            this.app.openProfile(npc.id, 'me');
        });

        root.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
            if (!confirm('确定清空陌陌扩展的全部本地数据？')) return;
            this.app.store.resetAll();
            this.app.chatView.activePeerId = null;
            this.app.matchView.resetForGenderChange();
            this.app.stackPage = null;
            toast('已清空', 'warning');
            this.app.render('me');
        });
    }
}
