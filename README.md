# 陌陌虚拟社交（st-momo）

为 [SillyTavern](https://github.com/SillyTavern/SillyTavern)（酒馆）打造的**陌陌风格虚拟社交扩展**。

用手机壳 UI 模拟：

1. **首页**：推荐 / 附近 / 好友 三栏动态（全部由酒馆 API 生成，无本地文案库）  
2. **匹配**：随机匹配异性 NPC，喜欢后自动加好友  
3. **消息**：与好友文字聊天（可选调用酒馆 AI 生成回复）  
4. **我**：编辑个人资料，管理本地数据

技术栈：Vanilla JS（ES Module）+ jQuery（酒馆内置）+ CSS3。  
数据通过 `extensionSettings` 持久化到酒馆本地；若上下文不可用则回退到 `localStorage`。

> 架构上参考了虚拟手机类扩展的「壳层 + 多页签 App + 本地存储」思路，但代码与 UI 均为原创实现，不包含第三方受版权保护的源码。

### 首页三栏说明

| 栏 | 规则 |
|----|------|
| **推荐** | 每次约 8 条；**一次 API 批量**生成跨城趣味互动动态 |
| **附近** | 强制绑定资料城市；一次批量生成同城用户 + 话题 |
| **好友** | 随机抽最多 8 人；一次批量生成动态 |

私聊支持按情境 **连发 1–4 条**短消息（JSON 数组解析，气泡间隔出现）。

加好友后，该人会从推荐/附近消失；到「好友」下拉刷新后才会出现其新动态。

---

## 安装到 SillyTavern

### 方式 A：扩展管理器（上传 GitHub 后）

1. 打开酒馆 → **扩展** → **安装扩展**
2. 粘贴仓库地址：`https://github.com/CJ67I/momo.git`
3. 分支留空（默认 `main` / `master`）
4. 安装后刷新页面，点击右下角粉色圆形悬浮按钮 **「陌」** 打开；再次点击（或变成 **「✕」**）关闭。按钮可拖动。

### 方式 B：手动安装

1. 将本仓库文件夹命名为 `st-momo`
2. 放到：

```text
SillyTavern/public/scripts/extensions/third-party/st-momo/
```

3. 确认该目录下直接包含 `manifest.json`、`index.js`、`style.css`
4. 重启 / 刷新 SillyTavern，并在扩展面板中启用

---

## 使用说明

| 页面 | 作用 |
|------|------|
| 首页 · 推荐 | 下拉刷新趣味互动动态（API） |
| 首页 · 附近 | 按选定城市生成同城 NPC / 话题动态 |
| 首页 · 好友 | 随机抽好友生成动态；无私友则空态引导 |
| 匹配 | `✕` 跳过，`♥` 喜欢并加好友；可查看主页 |
| 消息 | 与好友聊天；点头像/「主页」查看资料 |
| NPC主页 | 关于我、职业情感、瞬间、动态；加好友/发消息 |
| 我   | 资料编辑；查看酒馆 API / 世界书 / Persona / 聊天记录联动状态 |

### 酒馆联动（自动接入）

扩展会通过 `SillyTavern.getContext()` **自动使用当前已配置的酒馆 API**（`generateRaw`），无需单独填写 Key：

- 读取 **Persona 人设**、**当前角色卡**、**主聊天记录**
- **世界书**：在「我 → 导入/选择世界书」勾选后保存；支持 `loadWorldInfo`、前端模块与 `/api/worldinfo/get` 多路径读取
- 私聊回复时注入已选世界书 + 人设/角色卡/主聊天
- NPC 网名优先由 AI 生成现代风格；匹配严格按资料性别取**异性**
- API 离线时回退本地话术 / 本地网名库

**主入口：粉色圆形悬浮按钮**（始终显示在最上层）。点击切换打开/关闭；按住拖动可改位置（会记住）。面板内右上角 ✕ 也可关闭。

**提示：** 匹配与陌生人默认生成**与你性别相反**的 NPC。请先在「我」里设置自己的性别。

若已配置酒馆主 API，聊天会优先调用 `generateRaw`；失败时使用本地模板回复。

---

## 项目结构

```text
st-momo/
├── manifest.json      # 酒馆扩展清单
├── index.js           # 入口：挂载 UI / 设置面板
├── style.css          # 陌陌风格样式
├── settings.html      # 扩展设置抽屉
├── src/
│   ├── app.js         # 手机壳与路由
│   ├── feed-content.js # 分栏 AI 动态文案
│   ├── feed-refresh.js # 推荐 / 附近 / 好友刷新管线
│   ├── storage.js     # 本地存储（好友/资料/聊天/分栏动态）
│   ├── npc-factory.js # NPC / 动态生成
│   ├── ai.js          # AI / 回落回复
│   ├── utils.js
│   └── views/
│       ├── home.js
│       ├── match.js
│       ├── chat.js
│       └── me.js
└── README.md
```

---

## 如何上传到 GitHub

下面以 Windows + 浏览器为例。

### 1. 注册 / 登录 GitHub

打开 [https://github.com](https://github.com) 并登录。

### 2. 新建仓库

1. 点击右上角 **+** → **New repository**
2. Repository name 填：`momo`
3. 选 **Public**
4. **不要**勾选 “Add a README”（本地已有）
5. 点击 **Create repository**

### 3. 安装 Git（若尚未安装）

从 [https://git-scm.com/download/win](https://git-scm.com/download/win) 安装，安装完成后重新打开终端。

首次使用请设置身份（只需一次）：

```powershell
git config --global user.name "你的GitHub用户名"
git config --global user.email "你的邮箱@example.com"
```

### 4. 在本地提交并推送

在项目目录 `st-momo` 中执行：

```powershell
cd "C:\Users\20976\Desktop\助手\st-momo"

git status
git add .
git commit -m "feat: initial SillyTavern Momo-style social extension"

# 若默认分支是 master，可改名为 main（可选）
git branch -M main

git remote add origin https://github.com/CJ67I/momo.git
git push -u origin main
```

浏览器登录 GitHub 授权后，刷新仓库页面即可看到代码。

### 5.（可选）使用 GitHub Desktop

若不想敲命令：

1. 安装 [GitHub Desktop](https://desktop.github.com/)
2. **File → Add Local Repository**，选择 `st-momo` 文件夹
3. 填写 commit 说明并 **Commit**
4. **Publish repository** 发布到你的账号

### 6. 把仓库装进酒馆

扩展安装地址即为：

```text
https://github.com/CJ67I/momo.git
```

---

## 本地预览（可选）

不装酒馆时，可在项目目录启动静态服务后打开 `preview.html`：

```powershell
cd "C:\Users\20976\Desktop\助手\st-momo"
npx --yes serve -p 5173
```

浏览器访问提示的地址，打开 `preview.html`。

## 自定义 UI

当前界面按经典陌陌粉（`#ff2d7b`）与信息流/匹配卡片风格实现。  
若你有设计稿截图，发我后可继续对齐细节；也可自行改：

- `style.css` 中的颜色变量（`--mm-pink` 等）
- `src/views/*.js` 中的文案与结构

---

## License

MIT — 可自由学习、修改与分享。请勿用于欺诈或骚扰用途。
