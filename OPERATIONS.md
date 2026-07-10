# 維運手冊 — DeepGoal 世足推演板

> 維護者：**Ann**（Team PID 生管專員）
> 上級：Terry
> 網址：https://kobetime520-code.github.io/worldcup-2026/

本手冊供 Ann 執行「進度追蹤」與「品質把關」時查用。所有指令都在本 repo 根目錄執行。

---

## 一、每日巡檢（約 2 分鐘）

排程於台灣時間 **09:00 / 15:00 / 21:00 / 03:00** 各跑一次。建議在 09:00 那班之後巡檢，該班會收進前一晚的賽果。

```bash
# 1. 近期排程是否都成功
gh run list --workflow worldcup-daily.yml --repo kobetime520-code/worldcup-2026 --limit 6

# 2. 線上資料是否新鮮（lastUpdated 應在 6 小時內）
curl -s https://kobetime520-code.github.io/worldcup-2026/data/matches.json | grep lastUpdated

# 3. 資料一致性
node scripts/refresh.mjs --check
```

巡檢回報格式（依 Ann 的工作風格，優先給卡點與數據）：

| 項目 | 數值 |
|---|---|
| 最近一次排程 | success / failure，時間 |
| 資料新鮮度 | lastUpdated 距今幾小時 |
| 已完賽場次 | n / 8 |
| 目前卡點 | 無 / 說明卡在哪一環 |

---

## 二、故障排除

### 症狀：Actions 顯示 failure

```bash
gh run list --workflow worldcup-daily.yml --repo kobetime520-code/worldcup-2026 --limit 1
gh run view <run-id> --repo kobetime520-code/worldcup-2026 --log-failed
```

對照 log 中的訊息：

| Log 訊息 | 原因 | 處置 |
|---|---|---|
| `未設定 FOOTBALL_DATA_TOKEN` | secret 遺失或被刪 | 見「三、Token 更換」 |
| `403：token 無效，或目前方案不含 World Cup` | token 失效，或免費方案取消 WC 授權 | 先換 token；仍 403 則需升級 football-data.org 方案 |
| `觸發速率限制，重試 3 次後放棄` | 免費方案 10 requests/minute | 通常自癒。若持續發生，代表有其他程式共用同一 token |
| `資料驗證失敗` | `data/matches.json` 內容不合法 | 見「四、資料驗證失敗」 |
| `連線失敗` | football-data.org 暫時無法連線 | 不需處置，下一班排程會自動補上 |

**抓取失敗不會導致資料損毀。** 程式設計為「缺欄位就不改」，失敗時沿用現有資料，僅記錄警告。

### 症狀：Actions 全綠，但網頁沒更新

1. 確認 bot 真的有提交：`git log --oneline -3`（找 `github-actions[bot]`）
2. 若無提交且 log 顯示「資料無異動，跳過提交」→ **正常**，代表 API 回傳與現有資料相同
3. 若有提交但網頁是舊的 → Pages 部署延遲，等 2–3 分鐘；或瀏覽器快取，強制重新整理

### 症狀：網頁顯示「待更新賽果」

代表比賽開球已超過 135 分鐘，但資料裡還沒有比分。等下一班排程即可。若連續兩班仍未更新，依「Actions 顯示 failure」排查。

---

## 三、Token 更換

1. 至 https://www.football-data.org/client/register 重新取得 token
2. 更新 secret：

```bash
gh secret set FOOTBALL_DATA_TOKEN --repo kobetime520-code/worldcup-2026 --body "<新 token>"
```

3. 手動觸發驗證：

```bash
gh workflow run worldcup-daily.yml --repo kobetime520-code/worldcup-2026
gh run watch $(gh run list --workflow worldcup-daily.yml --repo kobetime520-code/worldcup-2026 --limit 1 --json databaseId -q '.[0].databaseId') --repo kobetime520-code/worldcup-2026
```

---

## 四、資料驗證失敗

`scripts/refresh.mjs --check` 會擋下五類問題，錯誤訊息已指明場次代碼（QF1、SF2 等）與原因：

- 機率加總不等於 1
- 標為 `finished` / `live` 卻沒有比分
- 有比分卻標為 `scheduled`
- `duration` 不在 `REGULAR` / `EXTRA_TIME` / `PENALTY_SHOOTOUT` 之中
- 有 `penalties` 但 `duration` 不是 `PENALTY_SHOOTOUT`（或反之）

修正 `data/matches.json` 後執行 `node scripts/refresh.mjs`（不加 `--check`），它會重新內嵌快照並更新時間戳，再提交 `data/matches.json` 與 `index.html` 兩個檔案。

---

## 五、手動補賽果

API 若延遲回填，可人工先行更新。以 PK 決勝為例：

```json
"status": "finished",
"score": { "home": 1, "away": 1, "duration": "PENALTY_SHOOTOUT", "penalties": { "home": 4, "away": 2 } }
```

延長賽分勝負則用 `"duration": "EXTRA_TIME"`、`"penalties": null`。改完執行 `node scripts/refresh.mjs` 並提交。

下一班排程若 API 已有正式賽果，會直接覆蓋人工填入的值。

---

## 六、賽事結束後

**不需人工收尾。** 2026-07-21（UTC）之後的第一次排程會自動停用本 workflow。

確認是否已停用：

```bash
gh workflow list --repo kobetime520-code/worldcup-2026 --all
```

若需重新啟用（例如補資料）：

```bash
gh workflow enable worldcup-daily.yml --repo kobetime520-code/worldcup-2026
```

---

## 七、已知限制

- **開球時間以 football-data.org 為準。** 曾與新聞來源出現數小時落差，以 API 為準即可，狀態與比分不受影響。
- **機率與 xG 是人工填寫的啟發式先驗**，API 不提供，排程不會更新這兩欄。若要調整，直接編輯 `data/matches.json` 的 `probs` 與 `xg`。
- **四強以後的隊伍由 API 自動填補。** 程式只填 `TBD`，絕不覆蓋已知隊伍；若配對出現歧義會整輪跳過並在 log 記錄，屬預期行為。
- 本 repo 為**公開**，請勿寫入任何非公開資訊。
