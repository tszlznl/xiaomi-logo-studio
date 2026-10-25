# 部署说明（Cloudflare `cf` CLI）

站点是一个零依赖的单文件页面 `xiaomi-logo-studio.html`，部署目标是 Cloudflare 新版 Pages on Workers
（静态资源 Worker），使用 Cloudflare 官方 `cf` CLI。

线上地址：<https://logo.aiwz.de>
备用地址：<https://xiaomi-logo-studio.youhe.workers.dev>（同一份资产，canonical 收敛到自定义域名）

本文档中的 `<...>` 都需要换成你自己的值：`<your-domain.com>` 是托管在 Cloudflare 的域名，
`<deploy-project>` 是本地部署工程目录。

## 环境要求

- Node.js 22 以上（实测 v24.19.0）
- 已安装 `cf` CLI：`npm i -g cf`（实测 v1.0.0-beta.12）
- 已登录 Cloudflare：`cf auth whoami` 返回 `"authenticated": true`
  - 未登录时执行 `cf auth login`，或设置 `CLOUDFLARE_API_TOKEN`

## 部署工程结构

`cf deploy` 需要一个可构建的项目目录，不能直接对单个 HTML 文件部署：

```
<deploy-project>/
├─ package.json          # "type": "module" + devDependencies
├─ vite.config.ts        # 注册 @cloudflare/vite-plugin
├─ cloudflare.config.ts  # Worker 名称、compatibilityDate、assets 行为、访问 triggers
└─ public/
   ├─ index.html         # 站点入口，内容就是仓库里的 xiaomi-logo-studio.html
   ├─ robots.txt
   ├─ sitemap.xml
   ├─ 404.html           # 未匹配路径的降级页（配合 notFoundHandling）
   └─ favicon.svg
```

仓库根目录保留这些文件的源版本，部署时统一复制进 `public/`。

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
import { defineConfig, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "xiaomi-logo-studio",
    compatibilityDate: "2026-10-01",
    observability: { enabled: true },
    assets: {
      notFoundHandling: "404-page", // 未命中资产时返回 public/404.html，状态码仍为 404
    },
    workersDev: true, // 一旦声明 triggers，必须显式保留 workers.dev 访问
    triggers: [triggers.fetch({ pattern: "logo.<your-domain.com>/*", zone: "<your-domain.com>" })],
  },
});
```

## 首次部署

```bash
mkdir -p <deploy-project>/public
cd <deploy-project>
# 按上面的结构写好 package.json / vite.config.ts / cloudflare.config.ts
npm install --no-audit --no-fund
cf deploy
```

成功输出示例：

```
Uploaded xiaomi-logo-studio
Deployed xiaomi-logo-studio triggers
  https://xiaomi-logo-studio.<your-workers-subdomain>.workers.dev
```

`cf deploy` 会自动创建同名 Worker，无需提前 `cf pages create`。

## 日常更新

```bash
SRC=<repo-dir>
DST=<deploy-project>/public

cp "$SRC/xiaomi-logo-studio.html" "$DST/index.html"
cp "$SRC/robots.txt" "$SRC/sitemap.xml" "$SRC/404.html" "$SRC/favicon.svg" "$DST/"

cd <deploy-project> && cf deploy
```

改了 `sitemap.xml` 的 `<lastmod>` 再部署，保持与页面更新日期一致。

## 绑定自定义域名

先清点账号里可以免费使用的域名：

```bash
cf zones list                    # 所有 zone 的名称、状态、计划、类型
cf registrar registrations list  # 在 Cloudflare 注册的域名；返回 [] 说明一个都没有
cf dns records list -z <your-domain.com>   # 某个 zone 已占用的子域名
```

如果 `registrar registrations list` 返回 `[]`，说明这些域名只是把 DNS 托管在 Cloudflare，注册在
别处，账号内不存在可免费启用的新后缀，想用新域名只能付费注册（`cf registrar registrations check`
查价格与可用性）。选子域名时优先挑记录数为 0 或很少的 zone，避免在承担邮件路由、DKIM、生产服务的
域名上动 DNS。

绑定的方式是「代理 DNS 记录 + Worker 路由」，不是 Workers Custom Domains 产品：`cf` beta.12 没有
暴露 `POST /accounts/:account/workers/domains`（`cf workers` 只有 check/delete/deployments/get/list/
scripts/secrets/triggers/types/versions，`cf cli search` 也只返回 AI Gateway 与 R2 的 custom-domains），
所以只能走路由。好处是一级泛域名的 Universal SSL 证书直接覆盖新子域名，无需单独签发。

```bash
# 1. 建一条代理记录，内容用 RFC 6666 丢弃地址 100:: 作占位源站
cf dns records create -z <your-domain.com> --body '{
  "type": "AAAA", "name": "logo.<your-domain.com>", "content": "100::",
  "proxied": true, "ttl": 1, "comment": "Worker route origin"
}'

# 2. cloudflare.config.ts 里补上带 zone 的 fetch trigger（见上方配置示例）

# 3. 重新部署，triggers 一并下发
cf deploy
```

部署成功的输出会同时列出两个访问目标：

```
Deployed xiaomi-logo-studio triggers
  https://xiaomi-logo-studio.<your-workers-subdomain>.workers.dev
  logo.<your-domain.com>/* (zone name: <your-domain.com>)
```

回滚：删掉配置里的 `triggers` 再 `cf deploy`，随后
`cf dns records delete <record-id> -z <your-domain.com>`。记录 id 用
`cf dns records list -z <your-domain.com> --name logo.<your-domain.com>` 查。

## 验证部署结果

```bash
U=https://logo.<your-domain.com>
for p in / /robots.txt /sitemap.xml /favicon.svg /no-such-page; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' $U$p)"
done
curl -s $U/ | grep -oE '<title>[^<]*</title>|<meta name="description"|<link rel="canonical"|<noscript><svg'
```

预期：`/`、`/robots.txt`、`/sitemap.xml`、`/favicon.svg` 均 200，`/no-such-page` 返回 404 且内容是
降级页；页面里能看到 title、description、canonical 和 `<noscript>` 内的预渲染 SVG。`/index.html`
返回 307 跳转到 `/` 属于 Workers 静态资源的标准行为，只有一跳。

本机如果跑着 Clash/Surge 之类 TUN 代理，新建的子域名可能被分配 `198.18.0.0/15` 的假 IP 且握手失败
（`curl` 表现为 `000` / SSL handshake failed），这不是 Cloudflare 侧故障。用 DoH 复核真实解析，再从
外部视角抓一次内容：

```bash
curl -s "https://dns.google/resolve?name=logo.<your-domain.com>&type=A"   # 应返回 104.16.. / 172.64.. 地址
curl -s "https://r.jina.ai/https://logo.<your-domain.com>/" | head        # 外部抓取，验证内容
```

## 抓取与收录

- **渲染方式**：纯静态单文件，没有框架也没有 SSR。Googlebot 会执行页内 JS；对不执行 JS 的抓取方，
  页面在 `<noscript>` 内置了默认态的预渲染 SVG，标题、参数标签、页脚等文字本身就在静态 HTML 里。
  改成真正的 SSR 需要引入服务端项目结构，对一个本地计算型工具页没有收益。
- **robots.txt**：`User-agent: * / Allow: /` 并声明 Sitemap。`*.workers.dev` 默认由 Cloudflare 返回
  官方 robots.txt，其中不含 `Disallow` 指令，不会挡 Googlebot；绑定自定义域名后由本项目的
  `public/robots.txt` 接管。
- **索引控制**：全站（含 `404.html`）不存在 `noindex` 或 `X-Robots-Tag`。
- **规范链接**：`<link rel="canonical">`、`og:url` 和 JSON-LD 的 `url` 统一写成自定义域名根路径。
  `workers.dev` 地址仍在同一版本 Worker 上提供完全相同的资产，属于重复内容，靠 canonical 收敛。
- **提交 Google Search Console**（需要自己的 Google 账号）：
  1. <https://search.google.com/search-console> → 添加资源。**域名资源**需要在 apex 加一条 TXT 验证
     记录；不想动 DNS 就选**网址前缀** `https://logo.<your-domain.com>/`，改用 HTML 标签验证
     （把 `<meta name="google-site-verification">` 加进页面，无需改 DNS）；
  2. 左侧「站点地图」提交 `https://logo.<your-domain.com>/sitemap.xml`（`robots.txt` 已声明同一地址）；
  3. 用「网址检查」对首页请求编入索引。

## 已知坑（均实测复现）

| 现象 | 原因 | 处理 |
|------|------|------|
| `cf pages deploy` 报 `Legacy Pages is not supported in cf` | 旧版 Pages 直传已被 cf 取消 | 改用 `cf deploy`（新版 Pages on Workers） |
| `cf deploy` 在 `Build → Delegating to Wrangler` 后 `spawn EFTYPE` | cf 委托 wrangler 构建时在 Windows 上解析二进制失败 | 项目改声明 `@cloudflare/vite-plugin` + `vite`，让它走 `npx vite build` 路径 |
| `Failed to resolve "@cloudflare/vite-plugin". This package is ESM only but it was tried to load by require` | 配置文件按 CJS 加载 | `package.json` 加 `"type": "module"` |
| npm 提示 `install-scripts ... blocked`（workerd / esbuild） | 本机 npm 启用了 allowScripts 白名单策略 | 走 Vite 构建路径不需要 workerd；确需时执行 `npm install-scripts approve workerd esbuild` |
| `cf pages create` 报 `--production-branch is required` 并崩溃 | 非交互终端无法回答提示 | 显式补齐必填参数，如 `--production-branch main`；删除类命令加 `-f` |
| 加 `triggers.fetch` 后部署报 `Trigger configuration ... only partially updated`，API 返回 `10082 When using wildcard host ssl for saas entitlement you must specify the zone per route using "zone_id" or "zone_name"` | 路由 pattern 无法自动归属到具体 zone | `triggers.fetch({ pattern, zone: "<your-domain.com>" })` 显式带上 `zone` |
| 声明 `triggers` 后 `https://<name>.<sub>.workers.dev` 变成 404，站点下线 | cf 委托的 Wrangler 规则：配置里出现 routes 而未写 `workers_dev` 时默认关闭 workers.dev | `worker` 里加 `workersDev: true`（预览 URL 对应 `previewUrls`） |

补充：`cf` 在需要交互确认时若没有 TTY，会打印一行错误后触发
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 并退出。看到该断言，说明是缺参数，不是网络
或权限问题。

## 可选优化

- 缺 `og:image`，社交分享无卡片图，可放一张 1200×630 的 PNG；
- 页脚指向知乎原文的外链，对 `curl` / 部分爬虫返回 403（知乎反爬），浏览器访问正常。
