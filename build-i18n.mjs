import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { HEAD, TEXT, LANGS, X_DEFAULT } from "./i18n.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, "xiaomi-logo-studio.html");
const OUT = path.join(here, "dist");
const ORIGIN = "https://logo.aiwz.de";
const HEAD_START = "<!-- i18n:head:start -->";
const HEAD_END = "<!-- i18n:head:end -->";
const CJK = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

// 译文本身含汉字的目标语言无法用「残留汉字」判据，改用「源文键是否已消失」
const CJK_OUTPUT = new Set(["ja"]);
// 语言名保持原文，不参与翻译
const ALLOWED_CJK = ["日本語", "Deutsch", "Nederlands"];

const byTag = new Map(LANGS.map((l) => [l.tag, l]));

// hreflang 组由 LANGS 生成并写回每个产物（含中文源页），源文件里手写的语言表会被覆盖
const ALTERNATES = LANGS.map(
  (l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${ORIGIN}${l.path}">`
).concat(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}${X_DEFAULT}">`);

const ALTERNATES_RUN = /^<link rel="alternate" hreflang="[^"]*" href="[^"]*">(?:\n^<link rel="alternate" hreflang="[^"]*" href="[^"]*">)*$/m;

function syncAlternates(html) {
  if (!ALTERNATES_RUN.test(html)) {
    console.error("源文件里找不到连续的 hreflang alternate 组，无法同步语言表");
    process.exit(1);
  }
  return html.replace(ALTERNATES_RUN, ALTERNATES.join("\n"));
}

function headHtml(locale) {
  const h = HEAD[locale];
  const url = ORIGIN + byTag.get(locale).path;
  const jsonld = JSON.stringify(
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "SoftwareApplication",
          name: h.appName,
          url,
          applicationCategory: "DesignApplication",
          operatingSystem: "Web browser",
          inLanguage: h.lang,
          isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          description: h.appDescription,
          featureList: h.features,
        },
        {
          "@type": "FAQPage",
          mainEntity: h.faq.map(([q, a]) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        },
      ],
    },
    null,
    2
  );

  return [
    `<title>${h.title}</title>`,
    `<meta name="description" content="${h.description}">`,
    `<link rel="canonical" href="${url}">`,
    ...ALTERNATES,
    `<meta property="og:site_name" content="${h.siteName}">`,
    `<meta property="og:title" content="${h.title}">`,
    `<meta property="og:description" content="${h.ogDescription}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${ORIGIN}/og-${locale}.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${h.imageAlt}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${h.title}">`,
    `<meta name="twitter:description" content="${h.twitterDescription}">`,
    `<meta name="twitter:image" content="${ORIGIN}/og-${locale}.png">`,
    '<script type="application/ld+json">',
    jsonld,
    "<\/script>",
  ].join("\n");
}

function findUntranslated(html, locale, table) {
  if (CJK_OUTPUT.has(locale)) {
    return Object.keys(TEXT.en)
      .filter((key) => table[key] !== key && !ALLOWED_CJK.includes(key) && html.includes(key))
      .map((key) => `残留源文字串: ${key.slice(0, 80)}`);
  }

  return html
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => {
      const stripped = ALLOWED_CJK.reduce((acc, a) => acc.split(a).join(""), line);
      return CJK.test(stripped);
    })
    .map(({ line, n }) => `${n}: ${line.trim().slice(0, 140)}`);
}

function build(locale) {
  const source = readFileSync(SOURCE, "utf8");
  const table = TEXT[locale];
  const keys = Object.keys(table).sort((x, y) => y.length - x.length);

  let out = source
    .replace('<html lang="zh-CN">', `<html lang="${HEAD[locale].lang}">`)
    .replace(
      new RegExp(`${HEAD_START}[\\s\\S]*?${HEAD_END}`),
      HEAD_START + "\n" + headHtml(locale) + "\n" + HEAD_END
    );

  const unused = [];
  for (const key of keys) {
    if (!out.includes(key)) {
      unused.push(key);
      continue;
    }
    out = out.split(key).join(table[key]);
  }

  return { html: out, unused, leftover: findUntranslated(out, locale, table) };
}

const locales = Object.keys(TEXT).filter((l) => l !== "zh");
const enKeys = Object.keys(TEXT.en);

for (const locale of locales) {
  if (!HEAD[locale]) {
    console.error(`[${locale}] 缺少 HEAD 条目`);
    process.exit(1);
  }
  const other = Object.keys(TEXT[locale]);
  const missing = enKeys.filter((k) => !other.includes(k));
  const extra = other.filter((k) => !enKeys.includes(k));
  if (missing.length || extra.length) {
    console.error(`[${locale}] 字典键与 en 不一致`);
    console.error("  缺少:", missing);
    console.error("  多余:", extra);
    process.exit(1);
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "index.html"), syncAlternates(readFileSync(SOURCE, "utf8")));

for (const locale of locales) {
  mkdirSync(path.join(OUT, locale), { recursive: true });
  const { html, unused, leftover } = build(locale);
  if (unused.length) {
    console.error(`[${locale}] 字典键在源文件中找不到（可能已改名）：\n  ${unused.join("\n  ")}`);
    process.exitCode = 1;
  }
  if (leftover.length) {
    console.error(`[${locale}] 仍有未翻译内容：\n  ${leftover.join("\n  ")}`);
    process.exitCode = 1;
    continue;
  }
  writeFileSync(path.join(OUT, locale, "index.html"), html);
  console.log(`[${locale}] ok · ${html.length} chars`);
}

// sitemap 由语言表生成，新增语言不需要手改 XML，避免 URL 与 hreflang 漂移
const today = new Date().toISOString().slice(0, 10);
const alternatesFor = (l) =>
  LANGS.map(
    (x) => `    <xhtml:link rel="alternate" hreflang="${x.hreflang}" href="${ORIGIN}${x.path}"/>`
  )
    .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}${X_DEFAULT}"/>`)
    .join("\n");

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
  '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ...LANGS.map((l, i) =>
    [
      "  <url>",
      `    <loc>${ORIGIN}${l.path}</loc>`,
      alternatesFor(l),
      `    <lastmod>${today}</lastmod>`,
      "    <changefreq>monthly</changefreq>",
      `    <priority>${i === 0 ? "1.0" : "0.9"}</priority>`,
      "  </url>",
    ].join("\n")
  ),
  "</urlset>",
  "",
].join("\n");

writeFileSync(path.join(OUT, "sitemap.xml"), sitemap);
console.log(`sitemap ok · ${LANGS.length} urls · lastmod ${today}`);
