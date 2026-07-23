import { canUseTavernApi } from '../ai.js';
import { createNpcFromCharacter } from '../npc-factory.js';
import {
    getApiStatus,
    getCharacterAvatarUrl,
    getCharacterInfo,
    getChatHistory,
    getPersonaInfo,
    getWorldInfoSnippets,
} from '../st-bridge.js';
import { formatClockHm, getVirtualNow, toDatetimeLocalValue } from '../time.js';
import { listWorldBooks, loadWorldBook } from '../worldbook.js';
import {
    avatarGradient,
    confirmSettingSave,
    escapeHtml,
    normalizeGender,
    notifySettingSaved,
    oppositeGender,
    toast,
} from '../utils.js';

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
                : `未在线 · ${api.mainApi || 'api'} · ${api.onlineStatus}（私聊/动态生成将提示失败）`;

        const opposite = oppositeGender(p.gender) === 'female' ? '女' : '男';
        const vNow = getVirtualNow(settings);
        const timeLocal = toDatetimeLocalValue(vNow);
        const scale = Number(settings.timeScale) || 1;
        const proactiveMin = Number(settings.proactiveIntervalMin) || 30;

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
                <div class="mm-save-banner" aria-live="polite"></div>
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
                        <p class="mm-muted">陌陌时间 ${formatClockHm(vNow)} · 流速 ×${scale}</p>
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
                    <h3>动态内容生成（纯 AI）</h3>
                    <p class="mm-muted" style="margin:0 0 8px;font-size:12px;line-height:1.5">
                        默认<strong>不加固定风格</strong>，只按频道约束（推荐城市 / 同城 / 好友）批量生成。
                        若填写下方提示词，刷新时会附加进生成请求。
                    </p>
                    <label class="mm-field-label">可选提示词（留空 = 无固定风格）
                        <textarea id="mm-feed-prompt" rows="6" placeholder="例如：更短、更吐槽、带本地梗……">${escapeHtml(settings.feedPrompt || '')}</textarea>
                    </label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
                        <button type="button" class="mm-btn" data-action="feed-save">保存动态提示词</button>
                        <button type="button" class="mm-btn mm-btn-ghost" data-action="feed-reset">清空提示词</button>
                    </div>
                </div>

                <div class="mm-card mm-bridge-card">
                    <h3>时间模块</h3>
                    <p class="mm-muted" style="margin:0 0 8px;font-size:12px;line-height:1.5">
                        可设定陌陌内当前时间；之后按「真实经过时间 × 流速」推进。顶栏时钟显示虚拟时间。
                    </p>
                    <label class="mm-field-label">当前陌陌时间
                        <input type="datetime-local" id="mm-virtual-time" value="${escapeHtml(timeLocal)}" />
                    </label>
                    <label class="mm-field-label">时间流速（1=与现实同步，60=现实1分钟≈陌陌1小时）
                        <input type="number" id="mm-time-scale" min="0.1" max="1440" step="0.1" value="${scale}" />
                    </label>
                    <button type="button" class="mm-btn mm-btn-block" data-action="time-save">保存时间设定</button>
                </div>

                <div class="mm-card mm-bridge-card">
                    <h3>好友主动私聊</h3>
                    <label class="mm-switch" style="margin-bottom:8px">
                        <span>允许好友按间隔主动发消息</span>
                        <input type="checkbox" id="mm-proactive" ${settings.proactiveEnabled ? 'checked' : ''} />
                    </label>
                    <label class="mm-field-label">主动消息间隔（陌陌分钟）
                        <input type="number" id="mm-proactive-min" min="1" max="10080" step="1" value="${proactiveMin}" />
                    </label>
                    <p class="mm-muted" style="margin:0 0 8px;font-size:11px;line-height:1.45">
                        间隔按陌陌虚拟时间计算；需酒馆 API 在线，并建议先为人设生成完成。
                    </p>
                    <button type="button" class="mm-btn mm-btn-block" data-action="proactive-save">保存主动私聊设定</button>
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
                        <span>启用 AI 私聊回复</span>
                        <input type="checkbox" id="mm-ai-reply" ${settings.useAiReply ? 'checked' : ''} />
                    </label>
                    <label class="mm-switch">
                        <span>AI 生成现代网名</span>
                        <input type="checkbox" id="mm-ai-names" ${settings.useAiNames !== false ? 'checked' : ''} />
                    </label>
                    <div class="mm-settings-block" style="padding:8px 12px 4px">
                        <div style="font-weight:600;margin-bottom:6px">互通模式（主聊天 ↔ 陌陌）</div>
                        <label class="mm-radio-row" style="display:flex;gap:8px;align-items:flex-start;margin:6px 0">
                            <input type="radio" name="mm-interop" value="off" ${(settings.interopMode || 'soft') === 'off' ? 'checked' : ''} />
                            <span><strong>关闭</strong> — 线上静默：陌陌私聊不注入主线，主线最稳</span>
                        </label>
                        <label class="mm-radio-row" style="display:flex;gap:8px;align-items:flex-start;margin:6px 0">
                            <input type="radio" name="mm-interop" value="soft" ${(settings.interopMode || 'soft') === 'soft' ? 'checked' : ''} />
                            <span><strong>软互通</strong>（默认）— 线下感知：匹配/加好友近况 + 近期私聊摘要写入扩展提示槽，主线生成可感知，不写气泡</span>
                        </label>
                        <label class="mm-radio-row" style="display:flex;gap:8px;align-items:flex-start;margin:6px 0">
                            <input type="radio" name="mm-interop" value="hard" ${(settings.interopMode || 'soft') === 'hard' ? 'checked' : ''} />
                            <span><strong>硬注入</strong> — 软互通 + 匹配/加好友时写一条「剧情同步」系统气泡</span>
                        </label>
                        <p class="mm-muted" style="margin:4px 0 8px;font-size:11px;line-height:1.45">
                            私聊正文不会逐条写入主聊天。刷动态永不注入。请保存后到主线再生成一次以验证感知。
                        </p>
                        <button type="button" class="mm-btn mm-btn-block" data-action="interop-save">保存互通模式</button>
                    </div>
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

        const saveToggle = (key, checked, label) => {
            if (!confirmSettingSave(label)) {
                // revert checkbox UI
                const map = {
                    autoReply: '#mm-auto-reply',
                    useAiReply: '#mm-ai-reply',
                    useAiNames: '#mm-ai-names',
                    worldbookEnabled: '#mm-wb-enabled',
                    includeEmbeddedBook: '#mm-wb-embedded',
                };
                const el = root.querySelector(map[key]);
                if (el) el.checked = !checked;
                return;
            }
            this.app.store.updateSettings({ [key]: checked });
            notifySettingSaved(root, `已保存：${label}（${checked ? '开' : '关'}）`);
        };

        root.querySelector('#mm-profile-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!confirmSettingSave('个人资料')) return;
            const fd = new FormData(e.target);
            const nickname = String(fd.get('nickname') || '').trim();
            const age = Number(fd.get('age')) || 22;
            const city = String(fd.get('city') || '').trim();
            const gender = normalizeGender(fd.get('gender') || 'male');
            const bio = String(fd.get('bio') || '').trim();
            const prev = this.app.store.getProfile();
            const prevGender = normalizeGender(prev.gender);
            const prevCity = String(prev.city || '').trim();

            this.app.store.updateProfile({
                nickname,
                age,
                city,
                gender,
                bio,
                avatarText: nickname.slice(0, 1) || '我',
            });

            if (prevCity !== city) {
                this.app.store.replaceChannelPosts('nearby', []);
                if (this.app.homeView) this.app.homeView._autoTried.nearby = false;
            }

            if (prevGender !== gender) {
                try {
                    await this.app.regenerateOppositePool();
                    this.app.render('me');
                    notifySettingSaved(
                        this.app.root?.querySelector('#mm-screen'),
                        `资料已保存，并按「${gender === 'female' ? '女' : '男'}」重配异性 NPC`,
                    );
                } catch (err) {
                    console.error(err);
                    this.app.render('me');
                    toast('资料已保存，但异性池重配失败，可到首页手动刷新', 'warning');
                }
            } else {
                this.app.render('me');
                const tip = prevCity !== city
                    ? '资料已保存；城市已变，「附近」需重新下拉刷新'
                    : '个人资料已保存并生效';
                notifySettingSaved(this.app.root?.querySelector('#mm-screen'), tip);
            }
        });

        root.querySelector('#mm-auto-reply')?.addEventListener('change', (e) => {
            saveToggle('autoReply', e.target.checked, '好友自动回复');
        });
        root.querySelector('#mm-ai-reply')?.addEventListener('change', (e) => {
            saveToggle('useAiReply', e.target.checked, '启用 AI 私聊回复');
        });
        root.querySelector('#mm-ai-names')?.addEventListener('change', (e) => {
            saveToggle('useAiNames', e.target.checked, 'AI 生成现代网名');
        });
        root.querySelector('[data-action="interop-save"]')?.addEventListener('click', async () => {
            if (!confirmSettingSave('互通模式')) return;
            const picked = root.querySelector('input[name="mm-interop"]:checked')?.value || 'soft';
            const mode = ['off', 'soft', 'hard'].includes(picked) ? picked : 'soft';
            this.app.store.updateSettings({ interopMode: mode, storyInject: mode === 'hard' });
            const { purgeAllMomoPrompts, syncInteropFromSettings } = await import('../interop.js');
            purgeAllMomoPrompts();
            syncInteropFromSettings(this.app.store);
            const label = mode === 'off' ? '关闭' : mode === 'hard' ? '硬注入' : '软互通';
            notifySettingSaved(root, `互通模式已设为「${label}」`);
        });

        root.querySelector('[data-action="feed-save"]')?.addEventListener('click', () => {
            if (!confirmSettingSave('动态提示词')) return;
            const prompt = String(root.querySelector('#mm-feed-prompt')?.value || '');
            this.app.store.updateSettings({ feedPrompt: prompt });
            notifySettingSaved(root, prompt ? '动态提示词已保存' : '已清空：刷新将不加固定风格');
        });
        root.querySelector('[data-action="feed-reset"]')?.addEventListener('click', () => {
            if (!confirmSettingSave('清空动态提示词')) return;
            this.app.store.updateSettings({ feedPrompt: '' });
            this.app.render('me');
            notifySettingSaved(this.app.root?.querySelector('#mm-screen'), '已清空动态提示词');
        });

        root.querySelector('[data-action="time-save"]')?.addEventListener('click', () => {
            if (!confirmSettingSave('时间设定')) return;
            const raw = root.querySelector('#mm-virtual-time')?.value;
            const scale = Math.max(0.1, Number(root.querySelector('#mm-time-scale')?.value) || 1);
            const when = raw ? new Date(raw).getTime() : getVirtualNow(this.app.store.getSettings());
            this.app.store.setVirtualClock(Number.isFinite(when) ? when : Date.now());
            this.app.store.updateSettings({ timeScale: scale });
            const msg = `时间已更新：${formatClockHm(this.app.store.now())} · 流速 ×${scale}`;
            this.app.render('me');
            notifySettingSaved(this.app.root?.querySelector('#mm-screen'), msg);
        });

        root.querySelector('[data-action="proactive-save"]')?.addEventListener('click', () => {
            if (!confirmSettingSave('主动私聊设定')) return;
            const proactiveEnabled = Boolean(root.querySelector('#mm-proactive')?.checked);
            const proactiveIntervalMin = Math.max(1, Number(root.querySelector('#mm-proactive-min')?.value) || 30);
            this.app.store.updateSettings({ proactiveEnabled, proactiveIntervalMin });
            notifySettingSaved(
                root,
                proactiveEnabled
                    ? `已开启主动私聊：每 ${proactiveIntervalMin} 陌陌分钟`
                    : '已关闭好友主动私聊',
            );
        });

        root.querySelector('#mm-wb-enabled')?.addEventListener('change', (e) => {
            saveToggle('worldbookEnabled', e.target.checked, '启用世界书注入');
        });
        root.querySelector('#mm-wb-embedded')?.addEventListener('change', (e) => {
            saveToggle('includeEmbeddedBook', e.target.checked, '读取角色卡内嵌书');
        });

        root.querySelector('[data-action="wb-save"]')?.addEventListener('click', () => {
            if (!confirmSettingSave('世界书选择')) return;
            const names = this._collectCheckedBooks(root);
            this.app.store.setWorldbookSelection(names);
            const scope = this.app.store.getWorldbookSettings().scopeLabel;
            this.app.render('me');
            notifySettingSaved(this.app.root?.querySelector('#mm-screen'), `世界书已保存：${names.length} 本 →「${scope}」`);
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
            if (!confirmSettingSave('从 Persona 同步昵称')) return;
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
            notifySettingSaved(root, `已同步 Persona：${persona.name}`);
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
                notifySettingSaved(root, `已更新好友：${npc.nickname}`);
            } else {
                this.app.addFriendAndEnrich(npc);
                notifySettingSaved(root, `已添加好友：${npc.nickname}（后台生成人设中）`);
            }
            this.app.openProfile(npc.id, 'me');
        });

        root.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
            if (!confirm('确定清空陌陌扩展的全部本地数据？')) return;
            this.app.store.resetAll();
            this.app.chatView.activePeerId = null;
            this.app.matchView.resetForGenderChange();
            this.app.stackPage = null;
            notifySettingSaved(root, '本地数据已清空');
            this.app.render('me');
        });
    }
}
