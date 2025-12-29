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
  if (!(await fs.pathExists(SRC_FILE))) {
    console.log("No changelog file, skip");
    return;
  }

  const content = await fs.readFile(SRC_FILE, "utf-8");

  for (const lang of TARGET_LANGS) {
    const outDir = path.join(lang.code, "changelog");
    const outPath = path.join(outDir, path.basename(SRC_FILE));

    await fs.ensureDir(outDir);

    const translated = await translate(content, lang.systemPrompt);
    await fs.writeFile(outPath, translated, "utf-8");

    console.log(`Translated ${SRC_FILE} → ${outPath}`);
  }
}

run();
