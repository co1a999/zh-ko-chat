const WebSocket = require("ws");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.use(express.static(path.join(__dirname)));
app.use("/uploads", express.static("uploads"));

app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "無效的檔案" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

const httpServer = app.listen(3000, () => {
  console.log("伺服器已啟動：http://localhost:3000");
});

const wss = new WebSocket.Server({ server: httpServer });

function detectLang(text) {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text) ? "ko" : "zh-TW";
}

/**
 * 使用 MyMemory API 翻譯（完全免費，不需要金鑰）
 * 每天免費 5000 字
 */
async function translate(text, sourceLang, targetLang) {
  const langPair = `${sourceLang}|${targetLang}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000)
  });

  if (!res.ok) throw new Error("翻譯請求失敗");
  const data = await res.json();

  if (data.responseStatus !== 200) throw new Error("翻譯失敗");
  return data.responseData.translatedText;
}

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
        const targetLang = sourceLang === "ko" ? "zh-TW" : "ko";
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
