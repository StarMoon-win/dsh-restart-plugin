# dsh-restart-desktop

**给 DeepSeek Harness 桌面版侧边栏加一个「重启」按钮。**
点一下，整个 Electron 应用完全退出，然后自动重新打开——不用去托盘菜单，也不用开终端。

![dsh-restart-desktop 图标](icon.svg)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20desktop-0078d4.svg)](#环境要求)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4d6bfe.svg)](#)
[![dsh](https://img.shields.io/badge/dsh-%E2%89%A50.2.0--rc.1-4d6bfe.svg)](#环境要求)

> English: [README.md](README.md)

---

## 功能

- **一键真重启**：整个桌面应用退出后重新拉起，效果等同「托盘退出 + 重新打开」，但只需要点一次。
- **位置自然**：侧边栏底部、**设置**上方多一行「重启」；侧边栏收起成 56px 导轨时变成圆形图标按钮。
- **不该出现时不出现**：只有 Host 确认当前是 Windows 桌面版时才渲染；`dsh web` 或其它平台下按钮自动隐藏。
- **不闪黑框**：重启助手是脱离应用进程树的 Node 进程，外加隐藏窗口的 PowerShell 子进程，屏幕上不会闪命令行。
- **失败留证据**：每次尝试都追加写入 `%TEMP%\dsh-restart-desktop\restart.log`，启动后还会校验并在失败时重试。
- **中英双语**：界面文案、插件管理器显示用的标题/描述、以及原创图标都已就绪。

## 环境要求

| | |
| --- | --- |
| DeepSeek Harness | 桌面版（Electron），`dsh >= 0.2.0-rc.1` |
| 操作系统 | Windows 10/11 |
| Node | 20+（仅开发时需要） |

这是一个 DSH **bundle**：一半跑在 Host，一半跑在浏览器。它不是普通 npm 依赖，而是装进 DSH profile 的插件。

## 安装

### 从仓库地址安装

把 bundle 写进 profile 的 `~/.dsh/profiles/<profile>/package.json`，然后重启应用——保留原有条目，两个列表各加一行即可：

```jsonc
{
  "dependencies": {
    // ……你原有的条目
    "dsh-restart-desktop": "github:StarMoon-win/dsh-restart-plugin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ……你原有的条目
        "dsh-restart-desktop"
      ]
    }
  }
}
```

也可以在你的构建里用插件管理器（设置 → 插件）从 GitHub 源安装。新 bundle 会热生效；如果侧边栏还没出现按钮，刷新一下页面。

### 从本地 checkout 安装

```bash
git clone https://github.com/StarMoon-win/dsh-restart-plugin.git
```

然后把 profile 指向该目录：

```jsonc
"dependencies": {
  "dsh-restart-desktop": "link:/absolute/path/to/dsh-restart-plugin"
}
```

并把 `"dsh-restart-desktop"` 加进 `dsh.profile.bundles`，或者用插件管理器安装这个目录。

### 卸载

从 `dsh.profile.bundles`（以及 `dependencies`）里移除 `dsh-restart-desktop`，重启应用即可。

## 使用

1. 在侧边栏底部、**设置**上方找到「重启」。
   - 展开状态：图标 + `重启` / `Restart`。
   - 收起状态：圆形图标按钮，悬停有原生提示。
2. 点它。页面显示「正在重启…」，约 1 秒后应用退出，随后新实例自动打开。
3. **正在运行的任务会被中断。** 没有二次确认——点击本身就是确认。

如果按钮显示「重启失败」，等几秒再试，并查看日志：

```
%TEMP%\dsh-restart-desktop\restart.log
```

## 工作原理

```
侧边栏按钮 (client.js)
   │  GET  /dsh-restart-desktop/status    → 只有支持时才渲染
   │  POST /dsh-restart-desktop/restart   → 返回 202，页面随应用一起退出
   ▼
Host 路由 (index.js)
   │  写 %TEMP%\dsh-restart-desktop\request.json
   │  以 detached 方式启动 helper.mjs（ELECTRON_RUN_AS_NODE=1）
   ▼
重启助手 (helper.mjs)
   1. 等 1.2 秒，让 HTTP 响应先离开 Host
   2. 用 Windows PowerShell 按镜像名算出应用进程树
      （排除助手自己和 PowerShell 自己）
   3. 结束整棵树：主进程、渲染器、GPU、Host，
      以及它们启动的工具进程
   4. 用干净环境启动同一个可执行文件
   5. 4 秒后校验，失败最多重试三次；全程写日志
```

### 为什么必须强制结束

桌面外壳把「关闭主窗口」改成了**隐藏到托盘**，退出前还会向 Host 查询任务并弹确认框；`app.asar` 里没有任何给插件用的 `app.quit()` / `app.relaunch()` 通道（Host 与 Electron 主进程之间只有主进程发起的 `quit-inspection` / `update-tasks` 两个消息）。

所以插件能做出的「完全重启」，只能是由**应用进程树之外**的助手结束整棵树，再重新拉起可执行文件。上面的 helper 做的就是这件事。

### 安全边界

两条路由只接受本机、本页面的请求：

- 只接受回环地址（`127.0.0.1` / `::1`）；
- 带 `Forwarded`、`X-Forwarded-For`、`X-Real-IP` 的转发请求一律拒绝；
- `Host` 必须是本机地址（`127.0.0.1`、`localhost`、`[::1]`），顺带挡住 DNS rebinding；
- 带 `Origin` 时必须与 `Host` 同源；
- 桌面文档代理的「回环、无 Host、无 Origin」形态被认可；
- 重启只接受 `POST`，`GET /dsh-restart-desktop/restart` 固定返回 `405`。

## 开发

```bash
git clone https://github.com/StarMoon-win/dsh-restart-plugin.git
cd dsh-restart-plugin

node --check index.js
node --check client.js
node --check helper.mjs
node scripts/validate.mjs
```

`scripts/validate.mjs` 会在不激活插件的前提下检查清单 exports、语言文件、图标和 patch 文件。

想在不碰应用的情况下试重启助手：写一个请求文件指向无害程序（例如 `notepad.exe`、镜像名 `notepad`、延迟 200ms），然后 `node helper.mjs <request.json>`，日志会显示停止、启动和校验的过程。

### 修改后如何重新加载

用 `link:` 装进 profile 的包直接指向你的工作区。Host 代码跨 junction 不会热更新，所以改完 `index.js` 或 `helper.mjs` 后：

1. 在设置 → 插件里把 `dsh-restart-desktop` 关掉再打开，或者
2. 用新的按钮重启应用。

浏览器侧（`client.js`）会在下一次页面加载时生效。

## 排错

| 现象 | 检查 |
| --- | --- |
| 侧边栏没有按钮 | 确认是 desktop profile 且 bundle 在 `dsh.profile.bundles` 里；在应用源上打开 `/dsh-restart-desktop/status`，`supported` 必须为 `true`。 |
| 一直显示「重启失败」 | 看 `%TEMP%\dsh-restart-desktop\restart.log`。没有 `launched pid=…` 说明助手没能启动可执行文件。 |
| 安装报 `timed out waiting for the writer lock` | profile 里有残留的 `package.json.lock`；重启应用让记录的 PID 消失，再装一次。 |
| 应用退出了但没重开 | 日志以 `FAILED: the application did not come back` 结尾。手动打开应用后把日志发出来。 |

## 许可证

[MIT](LICENSE) © Star_Moon_win

## GitHub Topics

本仓库已经打上这些 Topics：

`deepseek-harness` · `dsh` · `dsh-plugin` · `deepseek` · `cordis` · `cordis-plugin` · `electron` · `desktop` · `restart` · `windows`

这些词也同步写进了 `package.json` 的 `keywords`，方便 npm 和搜索。
