const WebSocket = require("ws");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

// 確保 uploads 目錄存在
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  }
});

// 靜態檔案
app.use(express.static(path.join(__dirname)));
app.use("/uploads", express.static("uploads"));

// 圖片上傳端點
app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "無效的檔案" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

const httpServer = app.listen(3000, () => {
  console.log("伺服器已啟動：http://localhost:3000");
});

const wss = new WebSocket.Server({ server: httpServer });

/**
 * 偵測語言
 * - 含韓文字元 → ko
 * - 否則視為繁體中文 → zh
 */
function detectLang(text) {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text) ? "ko" : "zh";
}

/**
 * 使用 LibreTranslate 翻譯（免費，不需要金鑰）
 */
async function translate(text, sourceLang, targetLang) {
  // 嘗試多個公開的 LibreTranslate 伺服器，避免單點故障
  const servers = [
    "https://libretranslate.com/translate",
    "https://translate.argosopentech.com/translate",
    "https://translate.terraprint.co/translate"
  ];

  for (const url of servers) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: text,
          source: sourceLang,
          target: targetLang,
          format: "text"
        }),
        signal: AbortSignal.timeout(8000) // 8 秒逾時
      });

      if (!res.ok) continue;
      const data = await res.json();
      if (data.translatedText) return data.translatedText;
    } catch {
      // 這台失敗，試下一台
      continue;
    }
  }

  throw new Error("所有翻譯伺服器都無法連線");
}

/**
 * 廣播訊息給所有連線的客戶端
 */
function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on("connection", (ws) => {
  console.log("新用戶連線");

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "text") {
        const sourceLang = detectLang(data.text);
        const targetLang = sourceLang === "ko" ? "zh" : "ko";
        const translated = await translate(data.text, sourceLang, targetLang);
        broadcast({
          type: "text",
          original: data.text,
          translated,
          lang: sourceLang
        });
      }

      if (data.type === "image") {
        broadcast({
          type: "image",
          imageUrl: data.imageUrl,
          translated: "[圖片]"
        });
      }
    } catch (err) {
      console.error("處理訊息時發生錯誤：", err);
      ws.send(JSON.stringify({
        type: "error",
        message: "翻譯失敗，請稍後再試"
      }));
    }
  });

  ws.on("close", () => {
    console.log("用戶已離線");
  });
});
