import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";

/**
 * ===============================
 * 配置区
 * ===============================
 */

// 原始 changelog 目录（英文）
const SRC_DIR = "changelog";

// 输出语言配置
const TARGET_LANGS = [
  {
    code: "cn",
    name: "Chinese",
    systemPrompt:
      "请将以下英文 changelog 翻译成简体中文，要求：1. 语言简洁、专业，适合开发人员和技术文档阅读。2. 只翻译纯文本部分，忽略任何 HTML 标签、代码块、表格、特殊格式（如代码行、列）等。3. 保留原有 HTML 标签和结构，不要修改格式。4. 保证翻译内容准确，语言简洁。",
  },
  {
    code: "ko",
    name: "Korean",
    systemPrompt:
      "Please translate the following English changelog into professional Korean, ensuring that: 1. The language is concise and suitable for technical documentation. 2. Only translate the text content, ignore HTML tags, code blocks, tables, and special formatting (such as code lines, columns). 3. Preserve the original HTML tags and structure, do not modify the format. 4. Ensure the translation is accurate and concise.",
  },
];

// OpenAI 客户端
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * ===============================
 * 翻译函数
 * ===============================
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
 * ===============================
 * 主流程
 * ===============================
 */
async function run() {
  // 没有 changelog 目录就直接退出
  if (!(await fs.pathExists(SRC_DIR))) {
    console.log("No changelog directory found, skip translation.");
    return;
  }

  const files = await fs.readdir(SRC_DIR);

  for (const file of files) {
    // 只处理 md / mdx 文件
    if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;

    const srcPath = path.join(SRC_DIR, file);
    const content = await fs.readFile(srcPath, "utf-8");

    console.log(`Translating ${srcPath} ...`);

    for (const lang of TARGET_LANGS) {
      const outDir = path.join(lang.code, "changelog");
      const outPath = path.join(outDir, file);

      // 确保目录存在
      await fs.ensureDir(outDir);

      // 调用翻译
      const translated = await translate(content, lang.systemPrompt);

      // 写入翻译后的文件
      await fs.writeFile(outPath, translated, "utf-8");

      console.log(`✓ ${file} → ${lang.code}/changelog/${file}`);
    }
  }

  console.log("Translation completed.");
}

// 执行
run().catch((err) => {
  console.error("Translation failed:", err);
  process.exit(1);
});
