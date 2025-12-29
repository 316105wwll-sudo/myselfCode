import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ====== 你只需要关心这两行 ======
const SRC_DIR = "changelog";      // 原始中文 changelog
const DEST_DIR = "changelog/en";  // 翻译后的英文 changelog
// =================================

async function translate(text) {
  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "你是专业发布说明翻译助手，请将中文 changelog 翻译成自然、准确的英文，保留 Markdown 结构、列表和版本号。",
      },
      {
        role: "user",
        content: text,
      },
    ],
  });

  return res.choices[0].message.content;
}

async function run() {
  // 如果没有 changelog 目录，直接退出
  if (!(await fs.pathExists(SRC_DIR))) {
    console.log("No changelog directory found, skip translation.");
    return;
  }

  // 创建 changelog/en 目录
  await fs.ensureDir(DEST_DIR);

  const files = await fs.readdir(SRC_DIR);

  for (const file of files) {
    // 只翻译 .md 文件
    if (!file.endsWith(".md")) continue;

    const srcPath = path.join(SRC_DIR, file);
    const destPath = path.join(DEST_DIR, file);

    const content = await fs.readFile(srcPath, "utf-8");
    const translated = await translate(content);

    await fs.writeFile(destPath, translated, "utf-8");
    console.log(`Translated: ${file}`);
  }
}

run();
