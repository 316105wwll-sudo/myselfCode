import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * ===============================
 * 【你只改这里】
 * ===============================
 */

// 原始文件所在目录（英文）
const SRC_DIR = "changelog";

// 要翻译成哪些语言
const TARGET_LANGS = [
  {
    code: "zh",
    name: "Chinese",
    systemPrompt: "请将英文 changelog 翻译成自然、专业的简体中文，保留 Markdown 结构、列表、版本号。",
  },
  {
    code: "ko",
    name: "Korean",
    systemPrompt: "Please translate the English changelog into natural, professional Korean. Keep Markdown structure, lists, and version numbers.",
  },
];

/**
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

  return res.choices[0].message.content;
}

async function run() {
  if (!(await fs.pathExists(SRC_DIR))) {
    console.log("No changelog directory, skip");
    return;
  }

  const files = await fs.readdir(SRC_DIR);

  for (const file of files) {
   if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;


    const srcPath = path.join(SRC_DIR, file);
    const content = await fs.readFile(srcPath, "utf-8");

    for (const lang of TARGET_LANGS) {
      const outDir = path.join(SRC_DIR, lang.code);
      const outPath = path.join(outDir, file);

      await fs.ensureDir(outDir);

      const translated = await translate(content, lang.systemPrompt);
      await fs.writeFile(outPath, translated, "utf-8");
      console.log(`Translated ${file} → ${outPath}`);
      console.log(`Translated ${file} → ${lang.code}`);
    }
  }
}

run();
