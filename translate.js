import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";

// 配置
const SRC_DIR = "changelog"; // 原始 changelog 目录（英文）
const TARGET_LANGS = [
  {
    code: "cn",
    name: "Chinese",
    systemPrompt: "请将以下英文 changelog 翻译成简体中文，只翻译内容部分，忽略任何代码块、代码、表格等，保留日期和原文格式。",
  },
  {
    code: "ko",
    name: "Korean",
    systemPrompt: "Please translate the following changelog into Korean. Only translate the content part, ignoring code blocks, code, tables, etc. Keep the date and original format.",
  },
  {
    code: "ja",
    name: "Japanese",
    systemPrompt: "Please translate the following changelog into Japanese. Only translate the content part, ignoring code blocks, code, tables, etc. Keep the date and original format.",
  },
  // Add more languages here as needed
];

// OpenAI 客户端
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 翻译函数
 */
async function translate(text, systemPrompt) {
  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ],
  });

  return res.choices[0].message.content.trim();
}

/**
 * 获取文件中的日期，作为插入点
 */
async function getExistingDates(filePath) {
  const dates = [];
  if (await fs.pathExists(filePath)) {
    const content = await fs.readFile(filePath, "utf-8");
    const dateRegex = /\d{4}年\d{2}月\d{2}日|\w+ \d{1,2}, \d{4}/; // 这里支持不同格式的日期
    const matches = content.match(dateRegex);
    if (matches) {
      matches.forEach((date) => {
        if (!dates.includes(date)) dates.push(date);
      });
    }
  }
  return dates;
}

/**
 * 判断翻译内容插入位置（基于日期）
 * 返回日期之前的内容
 */
async function getInsertPosition(content, existingDates) {
  let insertPosition = 0; // 默认插入到文件开头

  // 判断最新日期的后面
  const contentDates = content.match(/\d{4}年\d{2}月\d{2}日|\w+ \d{1,2}, \d{4}/);
  if (contentDates) {
    const latestDate = contentDates[contentDates.length - 1];

    // 找到最新日期的位置，将新内容插入到其前面
    if (existingDates.includes(latestDate)) {
      const index = content.indexOf(latestDate);
      insertPosition = index; // 插入到此日期之前
    }
  }

  return insertPosition;
}

/**
 * 主流程
 */
async function run() {
  // 检查 changelog 目录
  if (!(await fs.pathExists(SRC_DIR))) {
    console.log("No changelog directory found, skip translation.");
    return;
  }

  const files = await fs.readdir(SRC_DIR);

  for (const file of files) {
    // 只处理 md/mdx 文件
    if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;

    const srcPath = path.join(SRC_DIR, file);
    const content = await fs.readFile(srcPath, "utf-8");

    console.log(`Translating ${srcPath}...`);

    // 对每种语言进行翻译并插入到对应的目录
    for (const lang of TARGET_LANGS) {
      const outDir = path.join(lang.code, "changelog");
      const outPath = path.join(outDir, file);
      await fs.ensureDir(outDir); // 创建目录

      // 翻译内容
      const translatedContent = await translate(content, lang.systemPrompt);

      // 获取已翻译文件中的日期
      const existingDates = await getExistingDates(outPath);

      // 获取插入位置
      const insertPosition = await getInsertPosition(translatedContent, existingDates);

      // 将翻译内容插入到文件中
      let updatedContent = translatedContent;
      if (insertPosition > 0) {
        const beforeContent = content.slice(0, insertPosition);
        const afterContent = content.slice(insertPosition);
        updatedContent = beforeContent + "\n" + translatedContent + "\n" + afterContent;
      }

      // 将翻译内容写入文件
      await fs.writeFile(outPath, updatedContent, "utf-8");

      console.log(`Translated and updated ${file} → ${outPath}`);
    }
  }

  console.log("Translation completed.");
}

// 执行
run().catch((err) => {
  console.error("Translation failed:", err);
  process.exit(1);
});
