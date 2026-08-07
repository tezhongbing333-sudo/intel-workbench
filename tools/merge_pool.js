/**
 * AI 情报工作台 · 滚动累积池合并器 (v3)
 *
 * 作用：
 *   1. 读取既有母库 pool.json（跨日累积，首次不存在则从 data.js 提取种子）
 *   2. 读取本次采集产出 <collectDir>/collect_*.json
 *   3. 按 url + 标题指纹去重
 *   4. 按类目分组，按重要性(high>mid>low) + 时间新鲜度排序
 *   5. 每类目保留最多 MAX_PER_CAT 条（目标 ≥100 条）
 *   6. 写回 pool.json + 生成前端 data.js
 *
 * 用法：
 *   node tools/merge_pool.js [collectDir] [YYYY-MM-DD] [edition]
 *   例：node tools/merge_pool.js A:/tmp 2026-08-07 "早览"
 *
 * 铁律：绝不编造条目。所有条目必须来自采集文件或既有母库。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const COLLECT_DIR = process.argv[2] || path.join(ROOT, 'collect');
const TODAY = process.argv[3] || new Date().toISOString().slice(0, 10);
const EDITION = process.argv[4] || '每日双版 · 早览 + 详报';

const CATS = ["金融", "AI行业", "母婴", "政治/政策", "军事/地缘", "经济", "科技", "社会/生活", "娱乐/文娱"];
const RANK = { high: 0, mid: 1, low: 2 };
const MAX_PER_CAT = 220;   // 单类目上限，防止母库无限膨胀
const TARGET_PER_CAT = 100; // 目标下限，用于体检报告

// 采集文件名 → 类目（兜底用，条目自带 cat 优先）
const FILE_CAT = {
  'collect_fin.json': '金融',
  'collect_ai.json': 'AI行业',
  'collect_baby.json': '母婴',
  'collect_pol.json': '政治/政策',
  'collect_mil.json': '军事/地缘',
  'collect_eco.json': '经济',
  'collect_tec.json': '科技',
  'collect_soc.json': '社会/生活',
  'collect_ent.json': '娱乐/文娱'
};

// ---------- 工具 ----------
function norm(s) {
  return String(s || '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[""''《》「」【】（）()\[\]，。、,.!！?？:：;；\-—_|]/g, '')
    .toLowerCase();
}
// 指纹以「标题」为主键：同一原文常衍生多条不同要点，URL 会重复，
// 用 URL 去重会误伤内容。宁可少去重，不可丢条目。
function fingerprint(it) {
  return 't:' + norm(it.title).slice(0, 30);
}
function clean(it, fallbackCat) {
  const cat = CATS.includes(it.cat) ? it.cat : fallbackCat;
  if (!cat || !it.title) return null;
  return {
    cat,
    time: String(it.time || TODAY).slice(0, 16),
    impact: ['high', 'mid', 'low'].includes(it.impact) ? it.impact : 'mid',
    related: !!it.related,
    overseas: !!it.overseas,
    title: String(it.title).trim(),
    summary: String(it.summary || '').trim(),
    decision: String(it.decision || '').trim(),
    source: String(it.source || '').trim(),
    url: String(it.url || '').trim(),
    firstSeen: it.firstSeen || TODAY
  };
}

// ---------- 1. 载入既有母库 ----------
let pool = [];
const POOL_PATH = path.join(ROOT, 'pool.json');
if (fs.existsSync(POOL_PATH)) {
  try {
    const p = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
    pool = Array.isArray(p) ? p : (p.items || []);
    console.log(`[母库] 载入历史条目 ${pool.length} 条`);
  } catch (e) { console.log('[母库] 解析失败，忽略：' + e.message); }
} else {
  // 首次：从现有 data.js 提取种子
  const dataPath = path.join(ROOT, 'data.js');
  if (fs.existsSync(dataPath)) {
    try {
      const txt = fs.readFileSync(dataPath, 'utf8');
      const m = txt.match(/window\.BRIEFING\s*=\s*([\s\S]*);\s*$/);
      if (m) {
        const seed = JSON.parse(m[1].trim().replace(/;$/, ''));
        pool = seed.items || [];
        console.log(`[母库] 首次构建，从 data.js 提取种子 ${pool.length} 条`);
      }
    } catch (e) { console.log('[母库] 种子提取失败：' + e.message); }
  }
}

// ---------- 2. 载入本次采集 ----------
let fresh = [];
if (fs.existsSync(COLLECT_DIR)) {
  const files = fs.readdirSync(COLLECT_DIR).filter(f => /^collect_.*\.json$/.test(f));
  for (const f of files) {
    const full = path.join(COLLECT_DIR, f);
    try {
      const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      const arr = Array.isArray(raw) ? raw : (raw.items || []);
      let ok = 0;
      arr.forEach(it => {
        const c = clean(it, FILE_CAT[f]);
        if (c) { fresh.push(c); ok++; }
      });
      console.log(`[采集] ${f.padEnd(22)} → ${ok} 条`);
    } catch (e) {
      console.log(`[采集] ${f} 解析失败：${e.message}`);
    }
  }
} else {
  console.log('[采集] 目录不存在：' + COLLECT_DIR);
}

// ---------- 3. 合并去重（新条目优先覆盖旧条目的字段） ----------
const map = new Map();
pool.forEach(it => { const c = clean(it, it.cat); if (c) map.set(fingerprint(c), c); });
let added = 0;
fresh.forEach(it => {
  const k = fingerprint(it);
  if (map.has(k)) {
    const old = map.get(k);
    it.firstSeen = old.firstSeen || it.firstSeen; // 保留首次出现日
    map.set(k, it);
  } else {
    map.set(k, it);
    added++;
  }
});
const merged = Array.from(map.values());
console.log(`\n[合并] 历史 ${pool.length} + 本次 ${fresh.length} → 去重后 ${merged.length} 条（新增 ${added} 条）`);

// ---------- 4. 分组排序 + 截断 ----------
const byCat = {};
merged.forEach(it => { (byCat[it.cat] = byCat[it.cat] || []).push(it); });

let out = [];
let id = 1;
const health = [];
for (const cat of CATS) {
  let arr = byCat[cat] || [];
  arr.sort((a, b) => {
    const r = (RANK[a.impact] ?? 3) - (RANK[b.impact] ?? 3);
    if (r !== 0) return r;
    if (a.related !== b.related) return a.related ? -1 : 1; // 与我相关的靠前
    return String(b.time).localeCompare(String(a.time));    // 新的靠前
  });
  if (arr.length > MAX_PER_CAT) arr = arr.slice(0, MAX_PER_CAT);
  arr.forEach(it => { it.id = id++; out.push(it); });
  health.push({ cat, n: arr.length, ok: arr.length >= TARGET_PER_CAT });
}

// ---------- 5. 输出 ----------
const briefing = {
  date: TODAY,
  edition: EDITION,
  generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
  scope: '中国优先 + 全球要闻（金融 · AI行业 · 母婴 · 政治 · 军事 · 经济 · 科技 · 社会 · 娱乐），海外条目标注「海外」',
  poolMode: true,
  kpi: {
    total: out.length,
    high: out.filter(x => x.impact === 'high').length,
    related: out.filter(x => x.related).length,
    todayNew: added
  },
  catCounts: health.reduce((o, h) => (o[h.cat] = h.n, o), {}),
  items: out
};

fs.writeFileSync(path.join(ROOT, 'data.js'),
  '// AI 情报工作台 · 每日简报数据层（v3 滚动累积池）\n' +
  '// cat 分类 / time 时间 / title 标题 / summary 摘要 / impact 重要性(high|mid|low)\n' +
  '// related 是否与我相关 / decision 决策提示 / source 来源 / url 原文链接 / overseas 海外源\n' +
  '// 本文件由 tools/merge_pool.js 自动生成，勿手改\n' +
  'window.BRIEFING = ' + JSON.stringify(briefing, null, 1) + ';\n', 'utf8');

fs.writeFileSync(POOL_PATH,
  JSON.stringify({ updatedAt: briefing.generatedAt, count: out.length, items: out }, null, 1), 'utf8');

console.log('\n===== 各类目体检 =====');
health.forEach(h => console.log(`${h.ok ? '✅' : '⚠️ '} ${h.cat.padEnd(8)} ${String(h.n).padStart(4)} 条 ${h.ok ? '' : '(距100条还差 ' + (TARGET_PER_CAT - h.n) + ')'}`));
console.log(`\n总计 ${out.length} 条 | 高优 ${briefing.kpi.high} | 与我相关 ${briefing.kpi.related} | 本次新增 ${added}`);
console.log('已写出：data.js / pool.json');
