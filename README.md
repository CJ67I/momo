# 陌陌虚拟社交（st-momo）

为 [SillyTavern](https://github.com/SillyTavern/SillyTavern)（酒馆）打造的**陌陌风格虚拟社交扩展**。

用手机壳 UI 模拟：

1. **首页**：刷新好友 / 陌生人动态，并可从动态添加好友  
2. **匹配**：随机匹配异性 NPC，喜欢后自动加好友  
3. **消息**：与好友文字聊天（可选调用酒馆 AI 生成回复）  
4. **我**：编辑个人资料，管理本地数据

技术栈：Vanilla JS（ES Module）+ jQuery（酒馆内置）+ CSS3。  
数据通过 `extensionSettings` 持久化到酒馆本地；若上下文不可用则回退到 `localStorage`。

> 架构上参考了虚拟手机类扩展的「壳层 + 多页签 App + 本地存储」思路，但代码与 UI 均为原创实现，不包含第三方受版权保护的源码。

---

## 安装到 SillyTavern

### 方式 A：扩展管理器（上传 GitHub 后）

1. 打开酒馆 → **扩展** → **安装扩展**
2. 粘贴仓库地址：`https://github.com/CJ67I/momo.git`
3. 分支留空（默认 `main` / `master`）
4. 安装后刷新页面，点击右侧粉色 **「陌」** 按钮，或扩展设置里的「打开陌陌」

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
| 首页 | 点右上角 `↻` 刷新附近动态；点「加好友」；好友可点「私聊」 |
| 匹配 | `✕` 跳过，`♥` 喜欢并加好友 |
| 消息 | 与好友聊天；默认自动回复 |
| 我   | 改昵称/性别/城市等；开关 AI 回复；清空数据 |

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
│   ├── storage.js     # 本地存储（好友/资料/聊天）
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
