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
├─ cloudflare.config.ts  # Worker 名称、compatibilityDate、assets、triggers、绑定
├─ src/index.js          # Worker 入口：/collect 事件端点，其余透传给 assets
└─ public/
   ├─ index.html         # 默认语言入口（构建产物）
   ├─ en/index.html      # 英文版（构建产物）
   ├─ ja/index.html      # 日文版（构建产物）
   ├─ de/index.html      # 德文版（构建产物）
   ├─ nl/index.html      # 荷兰文版（构建产物）
   ├─ robots.txt
   ├─ sitemap.xml        # 由 LANGS 生成：每条语言 URL + 整组 hreflang alternate
   ├─ 404.html           # 未匹配路径的降级页（配合 notFoundHandling）
   ├─ google<id>.html    # GSC 所有权验证文件，验证后不可删除
   ├─ og-<locale>.png    # 1200×630 分享卡图
   └─ favicon.svg
```

`public/` 下的 HTML 全是构建产物，不要手改；源是仓库根目录的单文件页面加构建脚本里的语言表。
`src/index.js` 的 `/collect` 只接受白名单事件名与语言码，其余请求一律 `env.ASSETS.fetch(request)`
透传，所以 404 降级仍由 assets 的 `notFoundHandling` 决定。

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
import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.js" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "xiaomi-logo-studio",
    entrypoint,
    compatibilityDate: "2026-10-01",
    observability: { enabled: true },
    assets: {
      notFoundHandling: "404-page", // 未命中资产时返回 public/404.html，状态码仍为 404
    },
    workersDev: true, // 一旦声明 triggers，必须显式保留 workers.dev 访问
    triggers: [triggers.fetch({ pattern: "logo.<your-domain.com>/*", zone: "<your-domain.com>" })],
    env: {
      ASSETS: bindings.assets(),
      // 账号开通 Analytics Engine 后再放开：
      // LOGO_EVENTS: bindings.analyticsEngineDataset({ name: "logo_events" }),
    },
  },
});
```

`cf/config` 的 `assets` 段没有 `binding` 字段，资产绑定要写在 `env` 里，键名即绑定名。另外
`worker.domains?: string[]` 是声明式自定义域名，比「路由 + 占位 DNS 记录」更干净。

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

cd "$SRC" && node build-i18n.mjs        # 产出 dist/：五种语言的 HTML + sitemap.xml

cp "$SRC/dist/index.html" "$DST/index.html"
cp -r "$SRC"/dist/{en,ja,de,nl} "$DST/"
cp "$SRC/dist/sitemap.xml" "$DST/sitemap.xml"
cp "$SRC"/og-*.png "$DST/"
cp "$SRC/robots.txt" "$SRC/404.html" "$SRC/favicon.svg" "$DST/"
cp "$SRC"/google*.html "$DST/"    # GSC 验证文件，重建部署工程时也要带上

cd <deploy-project> && cf deploy
```

`sitemap.xml` 的 `<lastmod>` 由 `build-i18n.mjs` 按构建日期生成，不要手改；仓库根目录那份是构建时
从 `dist/` 复制过来的快照，只为让仓库里有一份可读的产物记录。

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
# 1. 建一条代理记录，内容用 TEST-NET-1 的 192.0.2.1 作占位源站
cf dns records create -z <your-domain.com> --body '{
  "type": "A", "name": "logo.<your-domain.com>", "content": "192.0.2.1",
  "proxied": true, "ttl": 1, "comment": "Worker route origin"
}'

# 2. cloudflare.config.ts 里补上带 zone 的 fetch trigger（见上方配置示例）

# 3. 重新部署，triggers 一并下发
cf deploy
```

占位记录写成 A 还是 AAAA **不影响客户端解析结果**。只要 zone 的 `ipv6` 设置是 `on`
（`cf zones settings get ipv6 -z <your-domain.com>` 可查），Cloudflare 就会为该 zone 内所有代理记录
统一发布 A + AAAA 任播地址。想让某个子域名不返回 IPv6，只能关 zone 级 `ipv6`，代价是该 zone 下所有
代理记录一起失去 AAAA。

部署成功的输出会同时列出两个访问目标：

```
Deployed xiaomi-logo-studio triggers
  https://xiaomi-logo-studio.<your-workers-subdomain>.workers.dev
  logo.<your-domain.com>/* (zone name: <your-domain.com>)
```

回滚：删掉配置里的 `triggers` 再 `cf deploy`，随后
`cf dns records delete <record-id> -z <your-domain.com> --force`。记录 id 用
`cf dns records list -z <your-domain.com> --name logo.<your-domain.com>` 查。不带 `--force` 时，
非交互终端下删除会直接打印 `Aborted.` 而不执行。

## 验证部署结果

```bash
U=https://logo.<your-domain.com>
for p in / /en/ /ja/ /de/ /nl/ /robots.txt /sitemap.xml /favicon.svg /no-such-page; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' $U$p)"
done
for p in / /en/ /ja/ /de/ /nl/; do
  echo "$p  $(curl -s $U$p | grep -oE '<link rel="alternate" hreflang="[a-zA-Z-]+"' | grep -oE 'hreflang="[a-zA-Z-]+"' | tr '\n' ' ')"
done
curl -s $U/ | grep -oE '<title>[^<]*</title>|<meta name="description"|<link rel="canonical"|<noscript><svg'
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$U/collect?e=download_svg&l=en"   # 204
```

预期：所有语言 URL 与资源均 200，`/no-such-page` 返回 404 且内容是降级页；页面里能看到 title、
description、canonical 和 `<noscript>` 内的预渲染 SVG。每条语言的 `hreflang` 组必须完全相同且包含
自己 —— 少一条就是集群不互指，Google 会忽略整组。`/index.html` 返回 307 跳转到 `/` 属于 Workers
静态资源的标准行为，只有一跳。`/collect` 一律 204，白名单内与白名单外的取值都看不出差别，这是刻意的。

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
- **多语言**：每种语言一条独立 URL，各自 canonical 指向自己，并用一组 `hreflang`
  （各语言 + `x-default`）互相完整声明 —— 缺任一方 Google 会忽略整组标签。浏览器语言只用于
  顶部建议横幅，**不做自动跳转**：Googlebot 的 `navigator.language` 通常是 `en-US`，自动跳转
  会把它从默认语言首页赶到英文版，破坏既有收录。
- **规范链接**：`<link rel="canonical">`、`og:url` 和 JSON-LD 的 `url` 统一写成自定义域名根路径。
  `workers.dev` 地址仍在同一版本 Worker 上提供完全相同的资产，属于重复内容，靠 canonical 收敛。
- **Google Search Console**（本项目已完成，步骤如下）：
  1. <https://search.google.com/search-console> → 添加资源。**域名资源**需要在 apex 加一条 TXT
     验证记录；只想覆盖单个子域名就选**网址前缀** `https://logo.<your-domain.com>/`；
  2. 验证方式选 GSC 推荐的 **HTML 文件**：把 `google<随机串>.html` 放进 `public/` 一起部署。
     验证通过后**不能删除该文件**，否则失去验证状态。Workers 静态资源会把 `/xxx.html` 307 跳转到
     `/xxx`，GSC 跟随跳转，验证仍然通过；也可改用 HTML 元标记，但会往页面里多塞一行；
  3. 左侧「站点地图」提交 `https://logo.<your-domain.com>/sitemap.xml`（`robots.txt` 已声明同一地址），
     提交后列表状态应为「成功」；
  4. 用「网址检查」（顶部「检查任何网址」输入框）填入首页，点「请求编入索引」，成功提示是
     「已请求编入索引 · 已将网址添加到优先抓取队列中」。
  新站首次收录通常要几天，期间「网址检查」会显示「网址尚未收录到 Google」，属正常。

## 多语言维护

单文件页面是唯一的默认语言源，`build-i18n.mjs` 读 `i18n.mjs` 里的三张表产出其余语言：

- `LANGS` / `X_DEFAULT`：语言表（`hreflang`、目录标签、URL 路径）。head 里的整组 `hreflang`
  与 `sitemap.xml` 都由它生成，构建时会覆盖源文件里手写的那组，所以新增语言只改这一处。
- `HEAD[locale]`：随语言变化的整块 head（title、description、canonical、og:\*、twitter:\*、
  JSON-LD），构建时替换源文件里 `<!-- i18n:head:start -->` 与 `<!-- i18n:head:end -->` 之间的内容。
- `TEXT[locale]`：源文字符串 → 译文，按长度倒序做全文替换，因此 markup 与 JS 字符串字面量一次覆盖。

新增一种语言要动五处，缺一处就出现「页面能打开但语言集群不完整」：

1. `i18n.mjs` 的 `LANGS` 加一条；
2. `HEAD` 加该语言的整块元数据（`og:image` 走 `og-<tag>.png` 约定，图要另生成）；
3. `TEXT` 加字典，键集必须与 `en` 完全一致；
4. 源文件 `#lang-banner` 里加一条语言链接；
5. `src/index.js` 的 `LOCALES` 白名单加该语言码，否则 `/collect` 会静默丢掉事件。

改动默认语言文案后，必须给每份 `TEXT` 同步加键，否则构建失败。三类报错的含义：

| 报错 | 含义 |
|------|------|
| `字典键在源文件中找不到` | 该源文被改名或删除，删掉这条键 |
| `仍有未翻译中文` | 新增的源文串缺少对应译文 |
| `残留源文字串` | 某串在目标语言输出里仍存在；若译文与原文写法相同，把该键的值原样写出即可 |

构建脚本先校验各份字典的键集完全一致，再做替换 —— 否则「A 语言通过」不代表「B 语言完整」。
译文本身含汉字的语言（如日文）不能用「残留汉字」做校验，脚本改为检查每个源文键是否已消失；
这类语言在 `CJK_OUTPUT` 里登记，语言名（`日本語` 等）在 `ALLOWED_CJK` 里放行。

页面不自动跳转语言：Googlebot 的 `navigator.language` 是 `en-US`，自动重定向会让中文页抓不到。
做法是每语言一条静态 URL + `hreflang` 互指，另在页面顶部放一条可关闭的语言建议条，
判断依据是 `navigator.language` 与 `document.documentElement.lang` 是否同族，选择记在
`localStorage` 的 `lang-suggestion-off`。

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
| 带 `analyticsEngineDataset` 绑定的部署报 `[10089] You need to enable Analytics Engine`（403） | 账号级 Analytics Engine 未开通，绑定校验发生在上传阶段 | 到 dashboard 开通后再放开绑定；未开通期间注释掉该绑定，Worker 里用 `if (env.LOGO_EVENTS)` 兜底 |
| 想用 Cloudflare Web Analytics 统计按钮点击 | 官方 FAQ：「Does Web Analytics support custom events? Not yet」 | Web Analytics 只到页面级；要事件级就自建 `/collect` + Analytics Engine |
| Worker 返回的 HTML 里找不到 Web Analytics beacon | `auto_install: true` 不改写 Worker 产出的 HTML | 需要页面统计时在 HTML 里显式放 beacon snippet |
| `cf rum site-info create` 没新建站点，反而把原 zone 级站点的 `auto_install` / `lite` 改了 | 该 API 按 zone 归并，create 实为 upsert | 改前先 `get` 留档，用 `cf rum site-info update <site_tag> --auto-install true --lite true` 复原 |
| 加了新语言后，只有默认语言页的 `hreflang` 少一条，Google 忽略整组 | 默认语言页的 head 手写在源文件里，其余语言由构建生成，两边各改各的 | `build-i18n.mjs` 用 `LANGS` 生成的整组 alternate 覆盖包括默认语言在内的每个产物，源文件里那组只是占位 |
| 新语言的导出事件全部记成 `l=en` | 语言码从 `navigator.language` 推断，未识别的语言回落到 `en` | 语言码取 `document.documentElement.lang` 的字母前缀，构建产物里它是权威值 |
| headless Chrome `--screenshot=相对路径` 报 `Failed to write file ... 拒绝访问 (0x5)` | 截图路径按 Chrome 自己的工作目录解析，不受 shell `cd` 影响 | 输出路径写绝对路径 |

补充：`cf` 在需要交互确认时若没有 TTY，会打印一行错误后触发
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 并退出。看到该断言，说明是缺参数，不是网络
或权限问题。

## 可选优化

- 页脚指向知乎原文的外链，对 `curl` / 部分爬虫返回 403（知乎反爬），浏览器访问正常。
