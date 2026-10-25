# 部署说明（Cloudflare）

站点是一个零依赖的单文件页面 `xiaomi-logo-studio.html`，部署目标是 Cloudflare 新版 Pages on Workers（静态资源 Worker），使用 Cloudflare 官方 `cf` CLI。

线上地址：<https://xiaomi-logo-studio.youhe.workers.dev>

## 环境要求

- Node.js 22 以上（实测 v24.19.0）
- 已安装 `cf` CLI：`npm i -g cf`（实测 v1.0.0-beta.12）
- 已登录 Cloudflare：`cf auth whoami` 返回 `"authenticated": true`
  - 未登录时执行 `cf auth login`，或设置 `CLOUDFLARE_API_TOKEN`

## 部署工程结构

`cf deploy` 需要一个可构建的项目目录，当前使用的目录是
`C:\Users\heshui\AppData\Local\Temp\cf-deploy\xiaomi-logo-studio`：

```
xiaomi-logo-studio/
├─ package.json          # "type": "module" + devDependencies
├─ vite.config.ts        # 注册 @cloudflare/vite-plugin
├─ cloudflare.config.ts  # Worker 名称与 compatibilityDate（纯静态，无 entrypoint）
└─ public/
   └─ index.html         # 站点入口，内容就是仓库里的 xiaomi-logo-studio.html
```

`package.json` 关键内容：

```json
{
  "name": "xiaomi-logo-studio",
  "private": true,
  "type": "module",
  "devDependencies": {
    "@cloudflare/vite-plugin": "^2.0.0-beta.v.4",
    "vite": "^8.3.5"
  }
}
```

`vite.config.ts`：

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare()],
});
```

`cloudflare.config.ts`：

```ts
import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "xiaomi-logo-studio",
    compatibilityDate: "2026-10-01",
    observability: { enabled: true },
  },
});
```

## 首次部署

```bash
mkdir -p cf-deploy/xiaomi-logo-studio/public
cd cf-deploy/xiaomi-logo-studio
# 按上面的结构写好 package.json / vite.config.ts / cloudflare.config.ts
npm install --no-audit --no-fund
cp <仓库路径>/xiaomi-logo-studio.html public/index.html
cf deploy
```

成功输出示例：

```
Uploaded xiaomi-logo-studio
Deployed xiaomi-logo-studio triggers
  https://xiaomi-logo-studio.youhe.workers.dev
```

`cf deploy` 会自动创建同名 Worker，无需提前 `cf pages create`。

## 日常更新

```bash
cd /c/Users/heshui/AppData/Local/Temp/cf-deploy/xiaomi-logo-studio
cp /c/Users/heshui/Documents/Qoder/2026-10-26/daf0e881/xiaomi-logo-studio.html public/index.html
cf deploy
```

## 验证部署结果

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}B\n" https://xiaomi-logo-studio.youhe.workers.dev/
curl -s https://xiaomi-logo-studio.youhe.workers.dev/ | grep -o '<title>[^<]*</title>'
```

预期：`200`、约 39 KB、标题 `小米 Logo 几何工坊`。访问 `/index.html` 返回 307 跳转到 `/` 属于正常行为。

## 已知坑（均实测复现）

| 现象 | 原因 | 处理 |
|------|------|------|
| `cf pages deploy` 报 `Legacy Pages is not supported in cf` | 旧版 Pages 直传已被 cf 取消 | 改用 `cf deploy`（新版 Pages on Workers） |
| `cf deploy` 报 `Build → Delegating to Wrangler` 后 `spawn EFTYPE` | cf 委托 wrangler 构建时在 Windows 上解析二进制失败 | 项目改声明 `@cloudflare/vite-plugin` + `vite`，让它走 `npx vite build` 路径 |
| `Failed to resolve "@cloudflare/vite-plugin". This package is ESM only but it was tried to load by require` | 配置文件按 CJS 加载 | `package.json` 加 `"type": "module"` |
| npm 提示 `install-scripts ... blocked`（workerd / esbuild） | 本机 npm 启用了 allowScripts 白名单策略 | 走 Vite 构建路径不需要 workerd；确需时执行 `npm install-scripts approve workerd esbuild` |
| `cf pages create` 报 `--production-branch is required` 并崩溃 | 非交互终端无法回答提示 | 显式补齐必填参数，如 `--production-branch main`；删除类命令加 `-f` |

补充：`cf` 在需要交互确认时若没有 TTY，会打印一行错误后触发
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 并退出。看到该断言，说明是缺参数，不是网络或权限问题。

## 待办建议

当前部署工程在系统 Temp 目录下，可能被系统清理。建议把 `package.json`、`vite.config.ts`、`cloudflare.config.ts`、`.gitignore`（忽略 `node_modules`、`.cloudflare`、`dist`）并入本仓库，并把页面移到 `public/index.html`，这样仓库本身就是可部署工程。
