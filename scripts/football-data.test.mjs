import { readFile } from "node:fs/promises";
import { applyResults, FootballDataError } from "./football-data.mjs";

const DATA = new URL("../data/matches.json", import.meta.url);
let pass = 0, fail = 0;
function ok(cond, label) { (cond ? (pass++, console.log("  ✓ " + label)) : (fail++, console.error("  ✗ " + label))); }

function stub(body, status = 200, headers = {}) {
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k] ?? null },
    json: async () => body,
  });
}
const fresh = async () => JSON.parse(await readFile(DATA, "utf8"));
const team = (tla, name) => ({ tla, name, shortName: name });
const quiet = () => {};

// ── 1. 主客顛倒：API 以比利時為主隊，比分必須對調回西班牙視角
console.log("主客顛倒");
{
  const db = await fresh();
  stub({ matches: [{
    id: 1, stage: "QUARTER_FINALS", status: "FINISHED", utcDate: "2026-07-11T02:00:00Z",
    homeTeam: team("BEL", "Belgium"), awayTeam: team("ESP", "Spain"),
    score: { winner: "AWAY_TEAM", duration: "REGULAR", fullTime: { home: 0, away: 3 } },
  }]});
  await applyResults(db, "tok", quiet);
  const qf2 = db.matches.find((m) => m.id === "QF2");
  ok(qf2.status === "finished", "狀態 → finished");
  ok(qf2.score.home === 3 && qf2.score.away === 0, `西班牙 3:0 比利時（實得 ${qf2.score.home}:${qf2.score.away}）`);
  ok(db.matches.find((m) => m.id === "QF1").score.home === 2, "未配對到的 QF1 保持原樣");
}

// ── 2. PK 大戰：fullTime 是延長賽後比分，penalties 另存
console.log("PK 大戰");
{
  const db = await fresh();
  stub({ matches: [{
    id: 2, stage: "QUARTER_FINALS", status: "FINISHED", utcDate: "2026-07-12T02:00:00Z",
    homeTeam: team("ARG", "Argentina"), awayTeam: team("SUI", "Switzerland"),
    score: { duration: "PENALTY_SHOOTOUT", fullTime: { home: 1, away: 1 }, penalties: { home: 4, away: 2 } },
  }]});
  await applyResults(db, "tok", quiet);
  const qf4 = db.matches.find((m) => m.id === "QF4");
  ok(qf4.score.duration === "PENALTY_SHOOTOUT", "duration = PENALTY_SHOOTOUT");
  ok(qf4.score.home === 1 && qf4.score.away === 1, "正規時間 1:1");
  ok(qf4.score.penalties.home === 4 && qf4.score.penalties.away === 2, "PK 4:2");
}

// ── 3. PK + 主客顛倒：penalties 也必須跟著對調
console.log("PK + 主客顛倒");
{
  const db = await fresh();
  stub({ matches: [{
    id: 3, stage: "QUARTER_FINALS", status: "FINISHED", utcDate: "2026-07-12T02:00:00Z",
    homeTeam: team("SUI", "Switzerland"), awayTeam: team("ARG", "Argentina"),
    score: { duration: "PENALTY_SHOOTOUT", fullTime: { home: 1, away: 1 }, penalties: { home: 2, away: 4 } },
  }]});
  await applyResults(db, "tok", quiet);
  const qf4 = db.matches.find((m) => m.id === "QF4");
  ok(qf4.score.penalties.home === 4 && qf4.score.penalties.away === 2, `阿根廷 PK 4:2（實得 ${qf4.score.penalties.home}:${qf4.score.penalties.away}）`);
}

// ── 4. TBD 隊伍解析：四強對手確定後填入中文名與代表色
console.log("TBD 隊伍解析");
{
  const db = await fresh();
  stub({ matches: [{
    id: 4, stage: "SEMI_FINALS", status: "TIMED", utcDate: "2026-07-14T23:00:00Z",
    homeTeam: team("FRA", "France"), awayTeam: team("ESP", "Spain"),
    score: { duration: "REGULAR", fullTime: { home: null, away: null } },
  }]});
  const changes = await applyResults(db, "tok", quiet);
  const sf1 = db.matches.find((m) => m.id === "SF1");
  ok(sf1.away.code === "ESP" && sf1.away.name === "西班牙", "客隊 TBD → 西班牙");
  ok(sf1.away.color === "#dc2626", "帶入代表色");
  ok(sf1.home.name === "法國", "已知的主隊未被覆蓋");
  ok(sf1.kickoff === "2026-07-14T23:00:00Z" && sf1.timeConfirmed === true, "開球時間更新且標為已確定");
  ok(sf1.status === "scheduled" && sf1.score === null, "TIMED → scheduled，無比分");
  ok(changes.length > 0, `回報了 ${changes.length} 項異動`);
}

// ── 4b. 只有一邊已知 + 主客顛倒：法國在 API 是客隊，比分仍須以法國為主隊
console.log("單邊已知 + 主客顛倒");
{
  const db = await fresh();
  stub({ matches: [{
    id: 41, stage: "SEMI_FINALS", status: "FINISHED", utcDate: "2026-07-14T23:00:00Z",
    homeTeam: team("ESP", "Spain"), awayTeam: team("FRA", "France"),
    score: { duration: "REGULAR", fullTime: { home: 0, away: 2 } },
  }]});
  await applyResults(db, "tok", quiet);
  const sf1 = db.matches.find((m) => m.id === "SF1");
  ok(sf1.home.code === "FRA" && sf1.away.code === "ESP", "本地主客順序維持 FRA vs ESP");
  ok(sf1.score.home === 2 && sf1.score.away === 0, `法國 2:0（實得 ${sf1.score.home}:${sf1.score.away}）`);
}

// ── 4c. 同輪多個候選：寧可不配，也不錯配
console.log("多候選防呆");
{
  const db = await fresh();
  stub({ matches: [
    { id: 42, stage: "SEMI_FINALS", status: "TIMED", utcDate: "2026-07-14T23:00:00Z",
      homeTeam: team("FRA", "France"), awayTeam: team("ESP", "Spain"),
      score: { duration: "REGULAR", fullTime: { home: null, away: null } } },
    { id: 43, stage: "SEMI_FINALS", status: "TIMED", utcDate: "2026-07-15T23:00:00Z",
      homeTeam: team("FRA", "France"), awayTeam: team("ARG", "Argentina"),
      score: { duration: "REGULAR", fullTime: { home: null, away: null } } },
  ]});
  const logs = [];
  await applyResults(db, "tok", (m) => logs.push(m));
  const sf1 = db.matches.find((m) => m.id === "SF1");
  ok(sf1.away.code === "TBD", "FRA 對應到 2 場，SF1 未被錯配");
  ok(logs.some((l) => /跳過以免錯配/.test(l)), "有記錄跳過原因");
}

// ── 5. 進行中：IN_PLAY 應為 live 且帶當下比分
console.log("進行中");
{
  const db = await fresh();
  stub({ matches: [{
    id: 5, stage: "QUARTER_FINALS", status: "IN_PLAY", utcDate: "2026-07-12T00:00:00Z",
    homeTeam: team("NOR", "Norway"), awayTeam: team("ENG", "England"),
    score: { duration: "REGULAR", fullTime: { home: 1, away: 0 } },
  }]});
  await applyResults(db, "tok", quiet);
  const qf3 = db.matches.find((m) => m.id === "QF3");
  ok(qf3.status === "live" && qf3.score.home === 1, "IN_PLAY → live 1:0");
}

// ── 6. 延賽：未知狀態不得污染本地資料
console.log("延賽");
{
  const db = await fresh();
  stub({ matches: [{
    id: 6, stage: "QUARTER_FINALS", status: "POSTPONED", utcDate: "2026-07-12T00:00:00Z",
    homeTeam: team("NOR", "Norway"), awayTeam: team("ENG", "England"),
    score: { duration: "REGULAR", fullTime: { home: null, away: null } },
  }]});
  await applyResults(db, "tok", quiet);
  const qf3 = db.matches.find((m) => m.id === "QF3");
  ok(qf3.status === "scheduled" && qf3.score === null, "POSTPONED 保留本地 scheduled");
}

// ── 7. 位置配對：雙方皆 TBD 時，數量不符就不該亂配
console.log("位置配對防呆");
{
  const db = await fresh();
  stub({ matches: [
    { id: 7, stage: "SEMI_FINALS", status: "TIMED", utcDate: "2026-07-14T23:00:00Z",
      homeTeam: team("FRA", "France"), awayTeam: team("BEL", "Belgium"),
      score: { duration: "REGULAR", fullTime: { home: null, away: null } } },
  ]});
  const logs = [];
  await applyResults(db, "tok", (m) => logs.push(m));
  const sf2 = db.matches.find((m) => m.id === "SF2");
  ok(sf2.home.code === "TBD" && sf2.away.code === "TBD", "SF2 未被錯配（API 沒有這場）");
}

// ── 8. 403：方案不含 WC
console.log("錯誤處理");
{
  stub({}, 403);
  let caught = null;
  try { await applyResults(await fresh(), "tok", quiet); } catch (e) { caught = e; }
  ok(caught instanceof FootballDataError && /403/.test(caught.message), "403 拋出 FootballDataError");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
