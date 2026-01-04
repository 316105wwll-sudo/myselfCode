import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";

/**
 * 配置区
 */
const SRC_DIR = "changelog";
const TARGET_LANGS = [
  {
    code: "cn",
    name: "Chinese",
    systemPrompt:
      "请将以下英文 changelog 翻译成简体中文，要求：1. 语言简洁、专业，适合开发人员和技术文档阅读。2. 只翻译纯文本部分，忽略任何 HTML 标签、代码块、表格、特殊格式（如代码行、列）等，看着像代码也保留不动。3. 保留原有 HTML 标签和结构，不要修改格式。4. 保证翻译内容准确，语言简洁。",
  },
  {
    code: "ko",
    name: "Korean",
    systemPrompt:
      "Please translate the following English changelog into professional Korean, ensuring that: 1. The language is concise and suitable for technical documentation. 2. Only translate the text content, ignore code blocks, JavaScript code, tables, and special formatting (such as code lines, columns, components, etc.). 3. Preserve the original paragraph and heading (#) formats. 4. Do not translate or display any code or dynamic content.",
  },
];

// 简化客户端配置（移除代理）
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000, // 延长超时到120秒
  maxRetries: 0,
});

/**
 * 强化重试策略
 */
async function withRetry(fn, maxRetries = 5) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      retries++;
      if (retries >= maxRetries) {
        throw new Error(`重试${maxRetries}次后仍失败：${err.message}`);
      }
      const delay = 1000 * Math.pow(2, retries);
      console.log(`请求失败，${delay}ms 后重试（第 ${retries}/${maxRetries} 次）：`, err.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * 分块翻译（核心优化）
 */
function splitTextByParagraphs(text, maxChars = 8000) {
  const paragraphs = text.split("\n\n");
  const chunks = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      const subPara = para.split("\n");
      let subCurrent = "";
      for (const sub of subPara) {
        if (subCurrent.length + sub.length <= maxChars) {
          subCurrent += sub + "\n";
        } else {
          chunks.push(subCurrent.trim());
          subCurrent = sub + "\n";
        }
      }
      if (subCurrent.trim()) chunks.push(subCurrent.trim());
      continue;
    }

    if (currentChunk.length + para.length <= maxChars) {
      currentChunk += para + "\n\n";
    } else {
      chunks.push(currentChunk.trim());
      currentChunk = para + "\n\n";
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  console.log(`✅ 文本已拆分为 ${chunks.length} 块，单块最大${maxChars}字符`);
  return chunks;
}

/**
 * 翻译函数
 */
async function translate(text, systemPrompt) {
  console.log("API Key 配置：", process.env.OPENAI_API_KEY ? "已配置（长度：" + process.env.OPENAI_API_KEY.length + "）" : "未配置");
  console.log("待翻译文本原始长度：", text.length, "字符");

  const chunks = splitTextByParagraphs(text);
  const translatedChunks = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`🔄 翻译第 ${i+1}/${chunks.length} 块（字符数：${chunks[i].length}）`);
    const res = await withRetry(async () => {
      return await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `${systemPrompt}\n注意：这是文本的第${i+1}块，共${chunks.length}块，请保持翻译风格统一。` },
          { role: "user", content: chunks[i] },
        ],
        temperature: 0.1,
        max_tokens: 4096,
        stream: false,
      });
    });

    if (!res || !res.choices || res.choices.length === 0) {
      throw new Error(`第${i+1}块API返回异常：${JSON.stringify(res)}`);
    }
    translatedChunks.push(res.choices[0].message.content.trim());
  }

  return translatedChunks.join("\n\n");
}

/**
 * 主流程
 */
async function run() {
  if (!(await fs.pathExists(SRC_DIR))) {
    console.log("No changelog directory found, skip translation.");
    return;
  }

  const files = await fs.readdir(SRC_DIR);
  for (const file of files) {
    if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;

    const srcPath = path.join(SRC_DIR, file);
    const content = await fs.readFile(srcPath, "utf-8");

    console.log(`\n========== 开始翻译 ${srcPath} ==========`);

    for (const lang of TARGET_LANGS) {
      const outDir = path.join(lang.code, "changelog");
      const outPath = path.join(outDir, file);
      await fs.ensureDir(outDir);

      try {
        const translated = await translate(content, lang.systemPrompt);
        await fs.writeFile(outPath, translated, "utf-8");
        console.log(`✓ 成功：${file} → ${lang.code}/changelog/${file}`);
      } catch (err) {
        console.error(`✗ 失败：${file} → ${lang.code}`, err.stack);
        continue;
      }
    }
  }
  console.log("\nTranslation completed (部分失败请查看日志)");
}

// 执行
run().catch((err) => {
  console.error("全局执行失败：", err.stack);
  process.exit(1);
});