# DeepGoal — 2026 世界盃淘汰賽推演板

單檔靜態網頁，呈現 2026 世界盃八強到決賽的賽程、已知賽果與模型機率。無框架、無 CDN、無 build step。

```
.
├── index.html                    # 頁面本體（含內嵌資料快照，file:// 直開即可用）
├── data/matches.json             # 唯一真實來源
└── scripts/
    ├── refresh.mjs               # 抓取 + 驗證 + 蓋時間戳 + 把快照內嵌回 index.html
    ├── football-data.mjs         # football-data.org v4 客戶端
    └── football-data.test.mjs    # 客戶端的單元測試（打樁 API 回應，不連外）
```

## 自動抓取賽果

```bash
export FOOTBALL_DATA_TOKEN=<你的 token>   # https://www.football-data.org/client/register
node scripts/refresh.mjs --fetch
```

未設定 token 時 `--fetch` 會印出警告並沿用現有資料，不會失敗。抓取失敗（連線錯誤、速率限制、403）同樣不中斷流程 — 驗證與內嵌照跑，資料維持原狀。

`.github/workflows/worldcup-daily.yml` 於台灣時間 09:00 / 15:00 / 21:00 / 03:00（每 6 小時）跑一次 `--fetch` 並在資料變動時回推。需要在 repo 的 Settings → Secrets → Actions 新增 `FOOTBALL_DATA_TOKEN`。**沒設 secret 也不會讓 workflow 失敗**，只是不會更新賽果。2026-07-21（UTC）之後的第一次排程會自動停用本 workflow，不需人工收尾。

抓取邏輯的幾個要點：

- **主客可能顛倒。** API 若以比利時為主隊而本地以西班牙為主隊，比分（含 PK）會自動對調。
- **配對分三段**，可靠度由高到低：兩隊 TLA 都已知 → 只有一隊已知（如四強的法國）且該輪僅一場含此隊 → 兩隊皆未定時才依開球時間位置對應。任何一段出現歧義就整輪放棄配對，寧可不更新也不錯配。
- **已知隊伍永不被覆蓋**，只填補 `TBD`。萬一配對出錯也不會污染既有資料。
- `POSTPONED` / `CANCELLED` 等無對應狀態會保留本地資料並記錄警告。
- 免費方案限 10 requests/minute，每次刷新只發 1 個請求；遇 429 依 `Retry-After` 重試。

> 撰寫時無法取得 token 對 WC 2026 的真實回應做端對端驗證（`/v4/competitions/WC` 未帶 token 回 403）。所有欄位皆以選擇性存取處理，缺欄位時退回不修改而非寫入猜測值。單元測試以打樁的回應涵蓋主客顛倒、延長賽、PK、TBD 解析、延賽與 403 等路徑。首次接上真實 token 時請檢查一次輸出。

## 手動更新賽果

1. 編輯 `data/matches.json`：`status` 改成 `"finished"`，填入 `score`（含 `duration`；PK 時另填 `penalties`）。
2. 執行 `node scripts/refresh.mjs`。
3. 提交 `data/matches.json` 與 `index.html`。

## 驗證

`node scripts/refresh.mjs --check` 會擋下：機率加總不等於 1、`finished`/`live` 卻沒有比分、有比分卻標成 `scheduled`、`duration` 不在合法集合、有 `penalties` 但 `duration` 不是 `PENALTY_SHOOTOUT`（或反之）。

`node scripts/football-data.test.mjs` 跑客戶端的 21 個斷言，不需要 token，不連外。

## 頁面行為

- 資料裡明確的 `finished` / `live` 優先採用；其餘由「開球時間 vs 現在時刻」即時推導，所以在自動刷新之間頁面仍會自己往前走。開球後 135 分鐘（含延長賽與 PK 緩衝）內顯示「進行中」，超過而尚未回填比分則顯示「待更新賽果」。
- 延長賽分出勝負時比分下方標「延長賽後」；PK 決勝時標「PK 4:2」。
- 每秒重算倒數，每 5 分鐘向伺服器重抓 `data/matches.json`。
- 開場先讀 `index.html` 內嵌的快照，因此 `file://` 直接開啟也能顯示；線上版隨後 fetch 覆蓋成最新資料。
- 隊伍以「代碼色塊」呈現而非國旗 emoji — Windows 版 Chrome 不繪製 regional indicator，國旗會退化成 `FR`、`MA` 這類字母，英格蘭的 `🏴󠁧󠁢󠁥󠁮󠁧󠁿` 更是直接消失。

## 資料誠實性

這是本專案與前一版 `Worldcupsport.tsx` 最大的差異：

- **不收錄博彩公司報價。** 頁面上的「公平賠率」是 `1 ÷ 模型機率` 的推導值，不是任何莊家的盤口。
- **機率是啟發式先驗**（賽前評分 + 本屆走勢 + 傷停資訊），不是回測擬合的模型輸出。不標榜「模型勝率 79.2%」這種無法驗證的數字。
- **未踢的比賽不填比分。** 四強、季軍戰、決賽的對戰組合尚未產生，一律顯示 `?` 與晉級路徑。
- 賽果與場館經 FIFA 賽事中心、ESPN、Olympics.com 交叉查證。查證期間發現 Wikipedia 的 2026 淘汰賽頁面有被寫入未來假賽果（宣稱決賽「比利時 3–2 塞內加爾」，但比利時當時還在八強、塞內加爾不在籤表內），已排除該來源。

## 截至 2026-07-10 的實際狀態

| 賽事 | 台灣時間 | 場館 | 狀態 |
|---|---|---|---|
| 八強 法國 vs 摩洛哥 | 7/10 04:30 | Gillette Stadium | **2:0 已結束** |
| 八強 西班牙 vs 比利時 | 7/11 10:00 | SoFi Stadium | 未開賽 |
| 八強 挪威 vs 英格蘭 | 7/12 08:00 | Hard Rock Stadium | 未開賽 |
| 八強 阿根廷 vs 瑞士 | 7/12 10:00 | BC Place | 未開賽 |
| 四強 法國 vs QF2 勝者 | 7/15 | AT&T Stadium | 開球時間未定 |
| 四強 QF3 勝者 vs QF4 勝者 | 7/16 | Mercedes-Benz Stadium | 開球時間未定 |
| 季軍戰 | 7/19 | Hard Rock Stadium | 開球時間未定 |
| 決賽 | 7/20 03:00 | MetLife Stadium | 未開賽 |

## 免責

僅供足球分析與資料視覺化參考，不構成投注建議。
