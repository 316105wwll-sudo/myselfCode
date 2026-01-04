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
      "请将以下英文 changelog 翻译成简体中文，要求：1. 语言简洁、专业，适合开发人员和技术文档阅读。2. 只翻译纯文本部分，忽略任何 HTML 标签、代码块、表格、特殊格式（如代码行、列）等，看着像代码也保留不动。3. 保留原有 HTML 标签和结构，不要修改格式。4. 保证翻译内容准确，语言简洁。5.日期等保持原样，不要翻译。",
  },
  {
    code: "ko",
    name: "Korean",
    systemPrompt:
      "다음 영어 changelog 를 전문적인 한국어로 번역해 주세요. 다음 요구사항을 엄격히 준수하세요: 1. 언어는 간결하고 전문적이며, 개발자와 기술 문서 읽는 사람에게 적합해야 합니다. 2. 텍스트 내용만 번역하고, HTML 태그, 코드 블록, 표, 특수 형식(예: 코드 행, 열 등) 등은 무시하고, 코드로 보이는 모든 내용은 그대로 유지하세요. 3. 원본 HTML 태그와 구조를 유지하고, 형식을 수정하지 마세요. 4. 번역 내용의 정확성을 보장하고, 언어는 간결하게 유지하세요. 5. 날짜, 제목 등은 원본 그대로 유지하고 번역하지 마세요.",
  },
];

// 初始化客户端
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000,
  maxRetries: 0,
});

/**
 * 重试策略
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
 * 分块函数（仅处理待翻译部分）
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
  console.log(`✅ 待翻译部分拆分为 ${chunks.length} 块，单块最大${maxChars}字符`);
  return chunks;
}

/**
 * 核心：截断文本，保留目标注释行之前的内容
 */
function truncateBeforeComment(text, commentMarker) {
  const lines = text.split('\n');
  let splitIndex = -1;

  // 模糊匹配目标注释行（兼容缩进/空格）
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(commentMarker)) {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex === -1) {
    console.log("⚠️ 未找到目标注释行：'Component definitions - moved to end of file for cleaner code organization'，将翻译全部内容");
    return { translatePart: text, keepPart: "" };
  }

  const translateLines = lines.slice(0, splitIndex);
  const keepLines = lines.slice(splitIndex);

  const translatePart = translateLines.join('\n').trim();
  const keepPart = keepLines.join('\n');

  console.log(`✅ 文本截断完成：
  - 待翻译部分：${translatePart.length} 字符
  - 保留部分（不翻译）：${keepPart.length} 字符`);
  return { translatePart, keepPart };
}

/**
 * 翻译函数（整合截断+分块+翻译+拼接）
 */
async function translate(text, systemPrompt) {
  console.log("\n📝 原始文本总长度：", text.length, "字符");

  // 1. 截断文本（关键：只翻译目标行之前的内容）
  const commentMarker = "Component definitions - moved to end of file for cleaner code organization";
  const { translatePart, keepPart } = truncateBeforeComment(text, commentMarker);

  // 2. 无待翻译内容：直接返回保留部分
  if (!translatePart) {
    return keepPart;
  }

  // 3. 分块翻译待翻译部分
  const chunks = splitTextByParagraphs(translatePart);
  const translatedChunks = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`🔄 翻译第 ${i+1}/${chunks.length} 块（字符数：${chunks[i].length}）`);
    const res = await withRetry(async () => {
      return await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `请翻译以下文本，严格遵循系统指令：\n${chunks[i]}` },
        ],
        temperature: 0.0,
        max_tokens: 4096,
        stream: false,
      });
    });

    if (!res || !res.choices || res.choices.length === 0) {
      throw new Error(`第${i+1}块翻译失败：API返回异常`);
    }
    translatedChunks.push(res.choices[0].message.content.trim());
  }

  // 4. 合并翻译结果 + 拼接保留部分（原样）
  const translatedPart = translatedChunks.join("\n\n");
  const finalResult = translatedPart + (keepPart ? "\n" + keepPart : "");

  return finalResult;
}

/**
 * 主流程
 */
async function run() {
  if (!(await fs.pathExists(SRC_DIR))) {
    console.log("❌ 未找到 changelog 目录，跳过翻译");
    return;
  }

  const files = await fs.readdir(SRC_DIR);
  for (const file of files) {
    if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;

    const srcPath = path.join(SRC_DIR, file);
    const content = await fs.readFile(srcPath, "utf-8");

    console.log(`\n========== 开始处理 ${srcPath} ==========`);

    for (const lang of TARGET_LANGS) {
      const outDir = path.join(lang.code, "changelog");
      const outPath = path.join(outDir, file);
      await fs.ensureDir(outDir);

      try {
        const translated = await translate(content, lang.systemPrompt);
        await fs.writeFile(outPath, translated, "utf-8");
        console.log(`✅ 成功：${file} → ${lang.code}/changelog/${file}`);
      } catch (err) {
        console.error(`❌ 失败：${file} → ${lang.code}`, err.stack);
        continue;
      }
    }
  }

  console.log("\n🎉 所有文件处理完成！");
}

// 执行主流程
run().catch((err) => {
  console.error("💥 全局执行失败：", err.stack);
  process.exit(1);
});