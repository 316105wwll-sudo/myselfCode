import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";
import { retry } from "@octokit/plugin-retry"; // 用于错误重试（需安装）
import { Octokit } from "@octokit/core"; // 仅借用重试逻辑，也可自定义

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
      "请将以下英文 changelog 翻译成简体中文，要求：1. 语言简洁、专业，适合开发人员和技术文档阅读。2. 只翻译纯文本部分，忽略任何 HTML 标签、代码块、表格、特殊格式（如代码行、列）等，看着像代码也保留不动。3. 保留原有 HTML 标签和结构，不要修改格式。4. 保证翻译内容准确，语言简洁。",
  },
  {
    code: "ko",
    name: "Korean",
    systemPrompt:
      "Please translate the following English changelog into professional Korean, ensuring that: 1. The language is concise and suitable for technical documentation. 2. Only translate the text content, ignore code blocks, JavaScript code, tables, and special formatting (such as code lines, columns, components, etc.). 3. Preserve the original paragraph and heading (#) formats. 4. Do not translate or display any code or dynamic content.",
  },
];

// OpenAI 客户端（添加超时、默认参数）
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 300000, // GPT-4.1 nano 处理大文本稍慢，超时设为300秒
  maxRetries: 2, // 客户端内置重试（基础）
});

// 自定义重试逻辑（针对翻译请求，更灵活）
const withRetry = async (fn) => {
  const OctokitWithRetry = Octokit.plugin(retry);
  const octokit = new OctokitWithRetry({
    request: { retries: 3, retryDelay: (retryCount) => 1000 * Math.pow(2, retryCount) },
  });
  return await octokit.request("POST /dummy", {
    request: { hook: async () => await fn() },
  }).then((res) => res.data);
};

/**
 * ===============================
 * 辅助函数：长文本分块（适配超大 changelog 文件）
 * ===============================
 */
// 按段落分块（保留语义，GPT-4.1 nano 虽支持大窗口，分块更稳定）
function splitTextByParagraphs(text, maxChars = 50000) {
  const paragraphs = text.split("\n\n"); // 按空行分割段落
  const chunks = [];
  let currentChunk = "";

  for (const para of paragraphs) {
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
  return chunks;
}

/**
 * ===============================
 * 翻译函数（适配 GPT-4.1 nano）
 * ===============================
 */
async function translate(text, systemPrompt) {
  // 步骤1：长文本分块（可选，根据文件大小调整）
  const chunks = splitTextByParagraphs(text);
  if (chunks.length === 1) {
    // 单块直接翻译
    const res = await withRetry(async () =>
      client.chat.completions.create({
        model: "gpt-4.1-nano", // 核心：改为 GPT-4.1 nano 模型
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.1, // 翻译精准优先，低温度
        max_tokens: 32768, // GPT-4.1 nano 最大输出 token（按需调整）
        top_p: 0.9, // 控制随机性
      })
    );
    return res.choices[0].message.content.trim();
  }

  // 多块翻译后合并
  const translatedChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`  翻译分块 ${i+1}/${chunks.length}...`);
    const res = await withRetry(async () =>
      client.chat.completions.create({
        model: "gpt-4.1-nano",
        messages: [
          { role: "system", content: `${systemPrompt}\n注意：这是文本的第${i+1}块，共${chunks.length}块，请保持翻译风格统一。` },
          { role: "user", content: chunks[i] },
        ],
        temperature: 0.1,
        max_tokens: 32768,
      })
    );
    translatedChunks.push(res.choices[0].message.content.trim());
  }

  // 合并分块结果
  return translatedChunks.join("\n\n");
}

/**
 * ===============================
 * 主流程
 * ===============================
 */
async function run() {
  // 检查源目录
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

    console.log(`\nTranslating ${srcPath} ...`);

    for (const lang of TARGET_LANGS) {
      const outDir = path.join(lang.code, "changelog");
      const outPath = path.join(outDir, file);

      // 确保目录存在
      await fs.ensureDir(outDir);

      try {
        // 调用翻译
        const translated = await translate(content, lang.systemPrompt);
        // 写入翻译后的文件
        await fs.writeFile(outPath, translated, "utf-8");
        console.log(`✓ ${file} → ${lang.code}/changelog/${file}`);
      } catch (err) {
        console.error(`✗ 翻译失败 ${file} → ${lang.code}:`, err.message);
        continue; // 单个语言失败不终止整体流程
      }
    }
  }

  console.log("\nTranslation completed.");
}

// 执行主流程
run().catch((err) => {
  console.error("Translation failed (global):", err);
  process.exit(1);
});