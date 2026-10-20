# dsh-restart-desktop

**A restart button for the [DeepSeek Harness](https://github.com/deepseek-ai) Desktop sidebar.**
One click fully quits the Electron application and opens it again — no tray menu, no terminal, no hunting for the window.

![dsh-restart-desktop icon](icon.svg)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20desktop-0078d4.svg)](#requirements)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4d6bfe.svg)](#)
[![dsh](https://img.shields.io/badge/dsh-%E2%89%A50.2.0--rc.1-4d6bfe.svg)](#requirements)
[![node](https://img.shields.io/badge/node-%E2%89%A520-339933.svg)](package.json)

> 中文说明：[README.zh.md](README.zh.md)

---

## Features

- **One click, real restart.** The whole desktop app exits and starts again — the same thing as closing it from the tray and reopening it, but in one action.
- **Lives where you expect it.** A row in the sidebar footer, directly above **Settings**; in the collapsed 56px rail it becomes a round icon button.
- **Stays out of the way.** The button only renders when the Host reports that this is a Windows desktop app; in `dsh web` or on unsupported platforms it hides itself.
- **No shell windows.** The relauncher is a detached Node process and a hidden PowerShell child; nothing flashes on screen.
- **Evidence when it fails.** Every attempt appends to `%TEMP%\dsh-restart-desktop\restart.log`, and the launch is verified with a retry.
- **Localized.** English and Simplified Chinese UI text, display metadata for the plugin manager, and its own original icon.

## Requirements

| | |
| --- | --- |
| DeepSeek Harness | Desktop build (Electron), `dsh >= 0.2.0-rc.1` |
| OS | Windows 10/11 |
| Node | 20+ (only for development) |

The plugin is a DSH **bundle**: a Host half plus a browser half. It is not an npm dependency of your project; it installs into a DSH profile.

## Install

### From the repository URL

Add the bundle to your profile (`~/.dsh/profiles/<profile>/package.json`) and restart the app — keep your existing entries and add one line in each list:

```jsonc
{
  "dependencies": {
    // ...your existing entries
    "dsh-restart-desktop": "github:StarMoon-win/dsh-restart-plugin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...your existing entries
        "dsh-restart-desktop"
      ]
    }
  }
}
```

Or use your build's plugin manager (Settings → Plugins) to install from the GitHub source. New bundles activate live; refresh the page if the sidebar does not show the button yet.

### From a local checkout

```bash
git clone https://github.com/StarMoon-win/dsh-restart-plugin.git
```

Then point the profile at the checkout:

```jsonc
"dependencies": {
  "dsh-restart-desktop": "link:/absolute/path/to/dsh-restart-plugin"
}
```

and add `"dsh-restart-desktop"` to `dsh.profile.bundles`, or install the directory through the plugin manager.

### Uninstall

Remove `dsh-restart-desktop` from `dsh.profile.bundles` (and from `dependencies`), then restart the app.

## Usage

1. Find **Restart** in the sidebar footer, above **Settings**.
   - Expanded sidebar: icon + `Restart` / `重启`.
   - Collapsed rail: a round icon button with a native tooltip.
2. Click it. The page shows `Restarting…`, the app exits after about a second, and a fresh instance opens.
3. **Running tasks are interrupted.** There is no confirmation dialog — the click is the confirmation.

If the button shows `Restart failed`, wait a few seconds and try again, then read the log:

```
%TEMP%\dsh-restart-desktop\restart.log
```

## How it works

```
Sidebar button (client.js)
   │  GET  /dsh-restart-desktop/status    → render only when supported
   │  POST /dsh-restart-desktop/restart   → 202, then the page dies with the app
   ▼
Host routes (index.js)
   │  write  %TEMP%\dsh-restart-desktop\request.json
   │  spawn  helper.mjs  (detached, ELECTRON_RUN_AS_NODE=1)
   ▼
Relauncher (helper.mjs)
   1. wait 1.2 s so the HTTP response can leave the Host
   2. compute the application process tree by image name
      (Windows PowerShell; excludes the helper and the PowerShell child)
   3. terminate the tree: main process, renderers, GPU, Host,
      and the tool processes those started
   4. start the same executable with a clean environment
   5. verify after 4 s; retry up to three times; log everything
```

### Why force-terminate?

The desktop shell turns a window close into **hide to tray**, and quitting asks the Host whether tasks are active before showing a confirmation dialog. `app.asar` exposes no `app.quit()` / `app.relaunch()` channel to plugins — the only Host-facing control messages are `quit-inspection` and `update-tasks`, both initiated by the Electron main process.

So the only way a plugin can produce a *complete* restart is to end the application tree from **outside** it and start the executable again. That is exactly what the detached helper does.

### Security

The two routes are reachable only from the same machine and the same page:

- loopback peer only (`127.0.0.1` / `::1`);
- requests carrying `Forwarded`, `X-Forwarded-For`, or `X-Real-IP` are rejected;
- `Host` must be a loopback authority (`127.0.0.1`, `localhost`, `[::1]`), which also refuses DNS rebinding;
- when `Origin` is present it must match `Host`;
- the headerless “loopback, no Host, no Origin” shape of the desktop document proxy is accepted;
- restart requires `POST`; `GET /dsh-restart-desktop/restart` answers `405`.

## Development

```bash
git clone https://github.com/StarMoon-win/dsh-restart-plugin.git
cd dsh-restart-plugin

node --check index.js
node --check client.js
node --check helper.mjs
node scripts/validate.mjs
```

`scripts/validate.mjs` checks the manifest exports, the locale files, the icon, and the patch file without activating the plugin.

To exercise the relauncher without touching the app, point a request file at a harmless program (for example `notepad.exe`, image `notepad`, a 200 ms delay) and run `node helper.mjs <request.json>`; the log shows the stop, launch, and verification steps.

### Reloading a linked checkout

A profile installed with `link:` points at your working tree. Host code is not hot-reloaded across that junction, so after editing `index.js` or `helper.mjs`:

1. disable and re-enable `dsh-restart-desktop` in Settings → Plugins (or via the plugin manager), or
2. restart the app with the new button.

The browser half (`client.js`) is picked up on the next page load.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No button in the sidebar | Is the profile the desktop one and the bundle in `dsh.profile.bundles`? Open `/dsh-restart-desktop/status` on the app origin; `supported` must be `true`. |
| Button always says “Restart failed” | Read `%TEMP%\dsh-restart-desktop\restart.log`. A missing `launched pid=…` line means the helper could not start the executable. |
| Install fails with `timed out waiting for the writer lock` | A stale `package.json.lock` in the profile; restart the app so the recorded holder PID is gone, then install again. |
| App exits but does not reopen | The log ends with `FAILED: the application did not come back`. Start the app manually and report the log. |

## License

[MIT](LICENSE) © Star_Moon_win

## GitHub topics

This repository is tagged:

`deepseek-harness` · `dsh` · `dsh-plugin` · `deepseek` · `cordis` · `cordis-plugin` · `electron` · `desktop` · `restart` · `windows`

They are also mirrored in `package.json` → `keywords` for npm and search.
