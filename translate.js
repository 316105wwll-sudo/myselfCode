import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 原始文件
const SRC_FILE = "changelog/2025.mdx";

// 目标语言配置
const TARGET_LANGS = [
  {
    code: "cn",
    systemPrompt: "请将英文 changelog 翻译成自然、专业的简体中文，保留 Markdown 结构、列表、版本号。",
  },
  {
    code: "ko",
    systemPrompt: "Please translate the English changelog into natural, professional Korean. Keep Markdown structure, lists, and version numbers.",
  },
];

/**
 * 调用 OpenAI API 翻译
 */
async function translate(text, systemPrompt) {
  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ],
  });

  return res.choices[0].message.content;
}

/**
 * 主函数
 */
async function run() {
  try {
    // 检查原始文件是否存在
    if (!(await fs.pathExists(SRC_FILE))) {
      console.log(`Source file "${SRC_FILE}" not found. Skipping translation.`);
      return;
    }

    const content = await fs.readFile(SRC_FILE, "utf-8");

    for (const lang of TARGET_LANGS) {
      // 生成输出目录，例如 cn/changelog
      const outDir = path.join(lang.code, "changelog");
      const outPath = path.join(outDir, path.basename(SRC_FILE));

      await fs.ensureDir(outDir); // 确保目录存在

      console.log(`Translating ${SRC_FILE} → ${outPath} ...`);
      const translated = await translate(content, lang.systemPrompt);
      await fs.writeFile(outPath, translated, "utf-8");
      console.log(`✅ Translated ${SRC_FILE} → ${outPath}`);
    }
  } catch (err) {
    console.error("Translation failed:", err);
    process.exit(1);
  }
}

// 执行
run();
