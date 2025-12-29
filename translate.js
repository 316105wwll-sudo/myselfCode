import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

    const content = await fs.readFile(path.join(SRC_DIR, file), "utf-8");

    await Promise.all(TARGET_LANGS.map(async (lang) => {
      const outDir = path.join(lang.code, SRC_DIR);
      await fs.ensureDir(outDir);

      const outPath = path.join(outDir, file);

      // 如果文件存在，先读取旧内容比对
      let oldContent = "";
      if (await fs.pathExists(outPath)) {
        oldContent = await fs.readFile(outPath, "utf-8");
      }

      const translated = await translate(content, lang.systemPrompt);

      // 仅在内容不同才写入
      if (translated.trim() !== oldContent.trim()) {
        await fs.writeFile(outPath, translated, "utf-8");
        console.log(`Translated ${file} → ${lang.code}`);
      } else {
        console.log(`No change for ${file} → ${lang.code}`);
      }
    }));
  }
}

(async () => {
  await run();
})();
