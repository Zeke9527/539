# 539 DATA LAB｜三模型即時預測版

這份部署包是給 `Zeke9527/539` 使用的 GitHub Pages 網站檔案。請將 ZIP 解壓後的**所有內容**上傳到 repository 的 `main` 分支根目錄，並允許覆蓋同名 `index.html`；新增 `assets/model.js`、`assets/app.js`、`assets/styles.css`。保留既有 `assets/history-data.js`，新版本不會將它當成即時資料來源。

## 功能
- 開啟首頁自動連線取得台灣彩券今彩539資料，直接預測下一期 D5。
- 同時顯示三模型每期兩碼：v7.8.1 全歷史/Prior10、v7.8.1 T49/Prior10、v7.9-shadow Average Count T49/Prior50。
- 三模型固定五個 D0 觸發號碼等權、TOP15、排除 D1～D4、保留前兩碼，同分小號優先。
- 顯示最新一期、D0～D4、共同排除號碼、39碼排名、TOP15、排除結果及模型重複號碼。
- 在同一瀏覽器 localStorage 首次封存每個目標期預測；可匯出 CSV。
- 即時資料介面失敗時，只允許使用有時間戳的本機快取，並清楚警示；沒有有效資料就不輸出預測。

## 部署
1. 開啟 `https://github.com/Zeke9527/539`。
2. 點選 **Add file → Upload files**。
3. 將此 ZIP 解壓後，把 `index.html`、`.nojekyll`、`assets/`、`tests/`、`README.md` 的內容上傳到 repository 根目錄。
4. 同名檔案選擇覆蓋；特別確認 `assets/model.js`、`assets/app.js`、`assets/styles.css` 有上傳成功。
5. Commit 到 `main`。
6. 到 **Settings → Pages** 確認來源為 `Deploy from a branch`、`main`、`/(root)`。
7. 網站網址為 `https://zeke9527.github.io/539/`。

## 本機測試
需要 Node.js 18+：

```bash
node tests/model.test.cjs
```

測試以封存的201期資料確認三模型在目標115000271的結果為：
- v7.8.1 全歷史/Prior10：25、30
- v7.8.1 T49/Prior10：30、17
- v7.9-shadow Average Count T49/Prior50：30、15

## 資料源注意事項
網站呼叫台灣彩券網站目前使用的 `Daily539Result` 月資料介面。此介面不是具長期版本相容承諾的開發者 API；若資料介面或 CORS 政策更動，網站會顯示錯誤或快取警告。模型輸出僅為歷史資料排序，不保證中獎或獲利。
