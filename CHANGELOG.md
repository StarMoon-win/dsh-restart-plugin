# Changelog

## 1.0.0

First release.

- Sidebar footer action that restarts the DeepSeek Harness desktop application.
- Host routes `GET /dsh-restart-desktop/status` and `POST /dsh-restart-desktop/restart`, fenced to
  loopback, same-origin requests.
- Detached relauncher that stops the application process tree and starts the same
  executable with a clean environment, then verifies the new instance.
- Chinese and English UI text, plugin-manager display metadata, and an original icon.
