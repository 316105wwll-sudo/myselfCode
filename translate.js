import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 配置
const SRC_DIR = "changelog";
const TARGET_LANGS = [
  {
    code: "cn",
    name: "Chinese",
    systemPrompt: "请将英文 changelog 翻译成自然、专业的简体中文，保留 Markdown 结构、列表、版本号。",
  },
  {
    code: "ko",
    name: "Korean",
    systemPrompt: "Please translate the English changelog into natural, professional Korean. Keep Markdown structure, lists, and version numbers.",
  },
];

// 翻译函数
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

// 主执行函数
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

    // 使用 Promise.all + await 并行翻译每个语言，确保翻译完成
    await Promise.all(TARGET_LANGS.map(async (lang) => {
      const outDir = path.join(lang.code, SRC_DIR);
      await fs.ensureDir(outDir);

      const translated = await translate(content, lang.systemPrompt);
      const outPath = path.join(outDir, file);
      await fs.writeFile(outPath, translated, "utf-8");

      console.log(`Translated ${file} → ${lang.code}`);
    }));
  }
}

// 顶层 IIFE 确保 Node 步骤阻塞
(async () => {
  await run();
})();
