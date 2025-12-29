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
      "请将以下英文 changelog 翻译成自然、专业的简体中文，保留 Markdown 结构、标题、列表、代码块和版本号，不要添加多余说明。",
  },
  {
    code: "ko",
    name: "Korean",
    systemPrompt:
      "Please translate the following English changelog into natural, professional Korean. Keep all Markdown structure, headings, lists, code blocks, and version numbers. Do not add explanations.",
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
    // 只处理 md / mdx
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

      // 写入文件
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
