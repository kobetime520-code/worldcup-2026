// football-data.org v4 客戶端：抓 World Cup 淘汰賽賽果，回寫進 matches.json 的結構。
//
// 需要環境變數 FOOTBALL_DATA_TOKEN（免費方案即可申請）。未設定時呼叫端應跳過抓取。
// 免費方案限制 10 requests/minute，本模組只發 1 個請求。
//
// 注意：撰寫當下無法取得 token 對 WC 2026 的真實回應做驗證，故所有欄位皆以
// 選擇性存取處理，缺欄位時退回不修改，而非寫入猜測值。

const BASE = "https://api.football-data.org/v4";
const TIMEOUT_MS = 15000;

// 我方 roundLabel ←→ API stage
const STAGE_BY_ROUND = {
  "quarter-final": "QUARTER_FINALS",
  "semi-final": "SEMI_FINALS",
  "third-place": "THIRD_PLACE",
  final: "FINAL",
};

// API 只給 TLA，中文名與代表色在本地維護。涵蓋所有仍可能晉級的隊伍。
const TEAMS = {
  FRA: { name: "法國", color: "#1e3a8a" },
  MAR: { name: "摩洛哥", color: "#b91c1c" },
  ESP: { name: "西班牙", color: "#dc2626" },
  BEL: { name: "比利時", color: "#eab308" },
  NOR: { name: "挪威", color: "#be123c" },
  ENG: { name: "英格蘭", color: "#334155" },
  ARG: { name: "阿根廷", color: "#38bdf8" },
  SUI: { name: "瑞士", color: "#dc2626" },
};

const FALLBACK_COLOR = "#64748b";

// API status → 我方 status
const STATUS_MAP = {
  SCHEDULED: "scheduled",
  TIMED: "scheduled",
  IN_PLAY: "live",
  PAUSED: "live",
  EXTRA_TIME: "live",
  PENALTY_SHOOTOUT: "live",
  FINISHED: "finished",
  AWARDED: "finished",
};

class FootballDataError extends Error {}

async function request(path, token) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(BASE + path, {
        headers: { "X-Auth-Token": token },
        signal: ctrl.signal,
      });
    } catch (err) {
      if (attempt === 3) throw new FootballDataError(`連線失敗：${err.message}`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      // 免費方案 10 req/min。Retry-After 以秒為單位，缺漏時退回 60 秒。
      const wait = Number(res.headers.get("Retry-After")) || 60;
      if (attempt === 3) throw new FootballDataError("觸發速率限制，重試 3 次後放棄");
      console.warn(`  ! 速率限制，${wait} 秒後重試`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }

    if (res.status === 403) {
      throw new FootballDataError(
        "403：token 無效，或目前方案不含 World Cup (WC) 這個 competition"
      );
    }
    if (!res.ok) throw new FootballDataError(`HTTP ${res.status}`);
    return res.json();
  }
}

function tlaOf(team) {
  return team?.tla ?? null;
}

function readScore(api, swapped) {
  const ft = api.score?.fullTime;
  if (ft == null || ft.home == null || ft.away == null) return null;

  const pens = api.score?.penalties;
  const hasPens = pens != null && pens.home != null && pens.away != null;

  return {
    home: swapped ? ft.away : ft.home,
    away: swapped ? ft.home : ft.away,
    duration: api.score?.duration ?? "REGULAR",
    penalties: hasPens
      ? { home: swapped ? pens.away : pens.home, away: swapped ? pens.home : pens.away }
      : null,
  };
}

// API 的主客可能與我方相反。以任一已知的 TLA 落在 API 的哪一側來判斷；
// 雙方皆未定時無從得知，視為不顛倒。
function isSwapped(our, api) {
  if (our.home.code !== "TBD") return tlaOf(api.awayTeam) === our.home.code;
  if (our.away.code !== "TBD") return tlaOf(api.homeTeam) === our.away.code;
  return false;
}

// 三段式配對，可靠度由高到低：
//   1. 兩隊 TLA 都已知 —— 直接對上
//   2. 只有一隊已知（如四強的法國）—— 該 stage 內若僅一場含此隊，即可安全對上
//   3. 兩隊皆未定 —— 退回「同 stage 內依開球時間排序後的位置」
function pair(ourMatches, apiMatches, log) {
  const pairs = new Map();
  const usedApi = new Set();

  const candidates = (our, tlas) => {
    const stage = STAGE_BY_ROUND[our.round];
    return apiMatches.filter((api) => {
      if (api.stage !== stage || usedApi.has(api.id)) return false;
      const set = [tlaOf(api.homeTeam), tlaOf(api.awayTeam)];
      return tlas.every((t) => set.includes(t));
    });
  };

  const link = (our, api) => {
    usedApi.add(api.id);
    pairs.set(our.id, { api, swapped: isSwapped(our, api) });
  };

  for (const wanted of [2, 1]) {
    for (const our of ourMatches) {
      if (pairs.has(our.id)) continue;
      const tlas = [our.home.code, our.away.code].filter((c) => c !== "TBD");
      if (tlas.length !== wanted) continue;

      const hits = candidates(our, tlas);
      if (hits.length === 1) link(our, hits[0]);
      else if (hits.length > 1) {
        log(`  ! ${our.id}：${tlas.join("/")} 在該輪對應到 ${hits.length} 場，跳過以免錯配`);
      }
    }
  }

  // 位置配對只處理雙方皆未定的場次。若該輪還有「帶已知隊伍卻配不到」的場次，
  // 代表 TLA 配對階段出了狀況（API 缺該場，或候選不只一個而被跳過）——
  // 此時整輪的位置對應都不可信，寧可不配。
  for (const stage of new Set(ourMatches.map((m) => STAGE_BY_ROUND[m.round]))) {
    const unpaired = ourMatches.filter(
      (m) => STAGE_BY_ROUND[m.round] === stage && !pairs.has(m.id)
    );
    if (unpaired.length === 0) continue;

    const blocked = unpaired.filter((m) => m.home.code !== "TBD" || m.away.code !== "TBD");
    if (blocked.length) {
      log(`  ! ${stage}：${blocked.map((m) => m.id).join("、")} 帶已知隊伍卻未配對，跳過整輪位置配對`);
      continue;
    }

    const apiLeft = apiMatches
      .filter((m) => m.stage === stage && !usedApi.has(m.id))
      .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
    if (unpaired.length !== apiLeft.length) {
      log(`  ! ${stage}：我方 ${unpaired.length} 場、API 剩 ${apiLeft.length} 場，跳過位置配對`);
      continue;
    }

    unpaired
      .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))
      .forEach((our, i) => link(our, apiLeft[i]));
  }

  return pairs;
}

function resolveTeam(slot, apiTeam) {
  // 只填補未定隊伍，絕不覆蓋已知隊伍 —— 配對萬一出錯時不會污染既有資料。
  if (slot.code !== "TBD") return false;
  const tla = tlaOf(apiTeam);
  if (!tla) return false;

  const known = TEAMS[tla];
  slot.code = tla;
  slot.en = apiTeam.name ?? tla;
  slot.name = known?.name ?? apiTeam.shortName ?? apiTeam.name ?? tla;
  slot.color = known?.color ?? FALLBACK_COLOR;
  return true;
}

/**
 * 就地更新 db.matches，回傳異動描述的陣列（空陣列代表無變化）。
 */
export async function applyResults(db, token, log = console.log) {
  const payload = await request("/competitions/WC/matches", token);
  const apiMatches = (payload.matches ?? []).filter((m) =>
    Object.values(STAGE_BY_ROUND).includes(m.stage)
  );
  log(`  取得 ${apiMatches.length} 場淘汰賽資料`);
  if (apiMatches.length === 0) return [];

  const pairs = pair(db.matches, apiMatches, log);
  const changes = [];

  for (const our of db.matches) {
    const found = pairs.get(our.id);
    if (!found) {
      log(`  · ${our.id} 未配對到 API 賽事`);
      continue;
    }
    const { api, swapped } = found;

    if (swapped) log(`  · ${our.id} API 主客與本地相反，比分已對調`);

    const home = swapped ? api.awayTeam : api.homeTeam;
    const away = swapped ? api.homeTeam : api.awayTeam;
    if (resolveTeam(our.home, home)) changes.push(`${our.id} 主隊確定為 ${our.home.name}`);
    if (resolveTeam(our.away, away)) changes.push(`${our.id} 客隊確定為 ${our.away.name}`);

    if (api.utcDate) {
      const iso = new Date(api.utcDate).toISOString().replace(/\.\d{3}Z$/, "Z");
      if (iso !== our.kickoff) {
        changes.push(`${our.id} 開球時間 ${our.kickoff} → ${iso}`);
        our.kickoff = iso;
      }
      if (!our.timeConfirmed) {
        our.timeConfirmed = true;
        changes.push(`${our.id} 開球時間已確定`);
      }
    }

    const mapped = STATUS_MAP[api.status];
    if (!mapped) {
      log(`  ! ${our.id} API 狀態 ${api.status} 無對應（延賽／取消？），保留本地資料`);
      continue;
    }

    const score = readScore(api, swapped);
    if (mapped !== "scheduled" && score == null) {
      log(`  ! ${our.id} 狀態為 ${api.status} 但無比分，保留本地資料`);
      continue;
    }

    const nextScore = mapped === "scheduled" ? null : score;
    if (JSON.stringify(our.score) !== JSON.stringify(nextScore) || our.status !== mapped) {
      const from = our.score ? `${our.score.home}:${our.score.away}` : "—";
      const to = nextScore ? `${nextScore.home}:${nextScore.away}` : "—";
      changes.push(`${our.id} ${our.status}/${from} → ${mapped}/${to}`);
      our.status = mapped;
      our.score = nextScore;
    }
  }

  return changes;
}

export { FootballDataError };
