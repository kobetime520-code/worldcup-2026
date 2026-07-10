// 每日刷新：可選地向 football-data.org 抓賽果，驗證 data/matches.json，
// 蓋上時間戳，並把快照內嵌回 index.html。
//
// 內嵌快照讓 index.html 用 file:// 直接開啟也能顯示；線上版仍會 fetch 最新 JSON。
//
// 用法：
//   node scripts/refresh.mjs            驗證 + 內嵌（不連外）
//   node scripts/refresh.mjs --fetch    先抓 football-data.org 再驗證 + 內嵌
//   node scripts/refresh.mjs --check    只驗證不寫檔（給 CI 用）
//
// --fetch 需要環境變數 FOOTBALL_DATA_TOKEN。

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyResults, FootballDataError } from "./football-data.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data", "matches.json");
const HTML = join(ROOT, "index.html");

const CHECK_ONLY = process.argv.includes("--check");
const DO_FETCH = process.argv.includes("--fetch");

const BOOTSTRAP_RE =
  /(<script type="application\/json" id="bootstrap">)([\s\S]*?)(<\/script>)/;

const DURATIONS = ["REGULAR", "EXTRA_TIME", "PENALTY_SHOOTOUT"];

function validate(db) {
  const errors = [];
  const seen = new Set();

  for (const m of db.matches) {
    const at = `match ${m.id}`;
    if (seen.has(m.id)) errors.push(`${at}: 重複的 id`);
    seen.add(m.id);

    if (Number.isNaN(Date.parse(m.kickoff))) errors.push(`${at}: kickoff 不是合法時間`);

    if (m.probs) {
      const sum = m.probs.home + m.probs.draw + m.probs.away;
      if (Math.abs(sum - 1) > 0.005) errors.push(`${at}: probs 加總為 ${sum.toFixed(3)}，應為 1`);
    }

    const shouldHaveScore = m.status === "finished" || m.status === "live";
    if (shouldHaveScore && !m.score) errors.push(`${at}: 狀態為 ${m.status} 卻沒有比分`);
    if (!shouldHaveScore && m.score) errors.push(`${at}: 有比分卻標為 ${m.status}`);

    if (m.score) {
      if (!DURATIONS.includes(m.score.duration)) {
        errors.push(`${at}: score.duration「${m.score.duration}」不在 ${DURATIONS.join("/")} 之中`);
      }
      // PK 分數只在真的踢了 PK 時才該存在，否則會在頁面上憑空多出一行。
      if (m.score.penalties && m.score.duration !== "PENALTY_SHOOTOUT") {
        errors.push(`${at}: 有 penalties 但 duration 不是 PENALTY_SHOOTOUT`);
      }
      if (m.score.duration === "PENALTY_SHOOTOUT" && !m.score.penalties) {
        errors.push(`${at}: duration 為 PENALTY_SHOOTOUT 但缺 penalties`);
      }
    }
  }
  return errors;
}

// 只有內容真的變動才寫檔，避免每日 workflow 產生純時間戳的空 commit。
async function writeIfChanged(path, next) {
  const prev = await readFile(path, "utf8").catch(() => null);
  if (prev === next) return false;
  await writeFile(path, next, "utf8");
  return true;
}

const db = JSON.parse(await readFile(DATA, "utf8"));

// lastUpdated 要反映「已發布的資料上次何時改變」，所以拿 index.html 裡的既有快照當基準，
// 而不是本次執行前的 matches.json —— 否則人工編輯賽果時時間戳不會動。
const published = await readFile(HTML, "utf8")
  .then((h) => h.match(BOOTSTRAP_RE)?.[2])
  .then((json) => {
    try {
      return JSON.stringify(JSON.parse(json).matches);
    } catch {
      return null; // 尚未內嵌過，或內容毀損
    }
  });

if (DO_FETCH && !CHECK_ONLY) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) {
    console.warn("! 未設定 FOOTBALL_DATA_TOKEN，跳過抓取，沿用現有資料");
  } else {
    console.log("→ 向 football-data.org 抓取 WC 淘汰賽賽果");
    try {
      const changes = await applyResults(db, token);
      if (changes.length === 0) console.log("  無異動");
      else for (const c of changes) console.log("  ✎ " + c);
    } catch (err) {
      // 抓取失敗不該讓整個刷新掛掉 —— 驗證與內嵌仍要跑完。
      const why = err instanceof FootballDataError ? err.message : err.stack;
      console.warn("! 抓取失敗，沿用現有資料：" + why);
      process.exitCode = 0;
    }
  }
}

const errors = validate(db);
if (errors.length) {
  console.error("資料驗證失敗：");
  for (const e of errors) console.error("  ✗ " + e);
  process.exit(1);
}

const finished = db.matches.filter((m) => m.status === "finished").length;
const live = db.matches.filter((m) => m.status === "live").length;
console.log(`✓ ${db.matches.length} 場賽事通過驗證（已完賽 ${finished} 場、進行中 ${live} 場）`);

if (CHECK_ONLY) process.exit(0);

if (JSON.stringify(db.matches) !== published) {
  db.meta.lastUpdated = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const dataChanged = await writeIfChanged(DATA, JSON.stringify(db, null, 2) + "\n");

const html = await readFile(HTML, "utf8");
if (!BOOTSTRAP_RE.test(html)) {
  console.error("✗ index.html 找不到 bootstrap script 標籤");
  process.exit(1);
}

// </script> 出現在 JSON 字串內會提前關閉標籤，需先跳脫。
const inline = JSON.stringify(db).replace(/<\//g, "<\\/");
const htmlChanged = await writeIfChanged(HTML, html.replace(BOOTSTRAP_RE, `$1${inline}$3`));

if (!dataChanged && !htmlChanged) console.log("✓ 檔案內容未變動，未寫檔");
else console.log(`✓ 已更新（時間戳 ${db.meta.lastUpdated}）`);
