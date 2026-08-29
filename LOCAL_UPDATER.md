# BMS 名額更新

網站從 `availability.json` 讀取官網全部班級的 BMS 名額，並以 `skuId` 對應原本的班級卡片。

- 可報名名額：`max(0, capacity + 2 - registered)`
- 當講可試聽名額：`max(0, capacity + 3 - inClass)`
- `inClass` 必須使用 BMS「In-class / Capacity」的分子；它已包含 Bound Lesson。
- 沒有當週課次的已結課班級，`currentLesson`、`inClass`、`trialRemaining`、`trialFull` 均為 `null`。
- 公開資料不得包含學生姓名、學生 ID、電話、Email 或 Student List 內容。
- 每筆資料使用 `checkedAt` 保存該班最後實際查詢時間；增量更新不會假裝其他班也在同一時間完成查詢。

## 依目前 Filter 增量更新

把 BMS 抓到的篩選結果存成只含公開容量欄位的 JSON，然後合併：

```bash
python3 scripts/merge_availability.py --partial /path/to/filter-result.json
python3 scripts/validate_availability.py
```

合併只覆蓋 partial JSON 中出現的 `skuId`，其他班保留上次結果，因此不需要為一次手動查詢重跑全部課程。

每次更新後先執行：

```bash
python3 scripts/validate_availability.py
```

驗證通過後才可提交並推送到 GitHub Pages。頁面的「重新載入名額」按鈕會略過瀏覽器快取，重新讀取已發布的 `availability.json`；純 GitHub Pages 無法直接登入 BMS 或喚醒本機程式，BMS 抓取本身由本機每四小時的排程工作負責。
