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
      "请将以下英文 changelog 按中文语境重写一下，要求： 2. 只翻译纯文本部分，忽略任何 HTML 标签、代码块、表格、特殊格式（如代码行、列）等，看着像代码也保留不动。3. 保留原有 HTML 标签和结构，不要修改格式。4. 保证翻译内容准确。5.小标题的单词也要翻译（标题的日期不要翻译）。6.不要直译特定名词，翻译符合中文习惯。",
  },
  {
    code: "ko",
    name: "Korean",
    systemPrompt:
      "다음 영어 changelog 를 한국어 문맥에 맞게 재작성해 주세요. 다음 요구사항을 엄격히 준수하세요: 1. 텍스트 내용만 번역하고, HTML 태그, 코드 블록, 표, 특수 형식(예: 코드 행, 열 등) 등은 무시하고, 코드로 보이는 모든 내용은 그대로 유지하세요. 2. 원본 HTML 태그와 구조를 유지하고, 형식을 수정하지 마세요. 3. 번역 내용의 정확성을 보장하세요. 4. 소제목의 단어도 반드시 번역하세요（소제목의 날짜는 번역하지 마세요）. 5. 특정 명사는 직역하지 않고, 한국어 사용 습관에 맞게 번역하세요.",
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
 * 🔥 双标记截断逻辑（核心修改）
 * 规则：
 * 1. 前标记（markerBefore）及之前 → 不翻译，保留
 * 2. 前标记后 ~ 后标记前 → 翻译
 * 3. 后标记（markerAfter）及之后 → 不翻译，保留
 */
function truncateWithTwoMarkers(text, markerBefore, markerAfter) {
  // 1. 定位前标记（兼容跨多行）
  const markerBeforeIndex = text.indexOf(markerBefore);
  // 2. 定位后标记（从前往后找，且在前标记之后）
  const markerAfterIndex = markerBeforeIndex === -1
    ? -1
    : text.indexOf(markerAfter, markerBeforeIndex + markerBefore.length);

  // 边界情况1：没找到前标记 → 只处理后标记（后标记及之后不翻译）
  if (markerBeforeIndex === -1) {
    if (markerAfterIndex === -1) {
      console.log("⚠️ 未找到任何标记，将翻译全部内容");
      return { translatePart: text, keepBefore: "", keepAfter: "" };
    }
    console.log("⚠️ 未找到前标记，仅保留后标记及之后不翻译");
    return {
      translatePart: text.slice(0, markerAfterIndex).trim(),
      keepBefore: "",
      keepAfter: text.slice(markerAfterIndex)
    };
  }

  // 边界情况2：找到前标记，但没找到后标记 → 仅前标记及之前不翻译，之后全翻译
  if (markerAfterIndex === -1) {
    console.log("⚠️ 未找到后标记，仅保留前标记及之前不翻译");
    return {
      translatePart: text.slice(markerBeforeIndex + markerBefore.length).trim(),
      keepBefore: text.slice(0, markerBeforeIndex + markerBefore.length),
      keepAfter: ""
    };
  }

  // 正常情况：前后标记都找到 → 中间部分翻译
  console.log(`✅ 双标记定位成功：
  - 前标记位置：${markerBeforeIndex}
  - 后标记位置：${markerAfterIndex}`);

  return {
    // 待翻译：前标记后 ~ 后标记前
    translatePart: text.slice(markerBeforeIndex + markerBefore.length, markerAfterIndex).trim(),
    // 保留：前标记及之前
    keepBefore: text.slice(0, markerBeforeIndex + markerBefore.length),
    // 保留：后标记及之后
    keepAfter: text.slice(markerAfterIndex)
  };
}

/**
 * 翻译函数（整合双标记+分块+翻译+拼接）
 */
async function translate(text, systemPrompt) {
  console.log("\n📝 原始文本总长度：", text.length, "字符");

  // 🔥 配置两个标记（原样复制，含换行/缩进/特殊字符）
  // 前标记：};    return <ShowResult />;  })()}</div>
  const markerBefore = `};
    return <ShowResult />;
  })()}
</div>`;
  // 后标记：{/* Component definitions - moved to end of file for cleaner code organization */}
  const markerAfter = `{/* Component definitions - moved to end of file for cleaner code organization */}`;

  // 执行双标记截断
  const { translatePart, keepBefore, keepAfter } = truncateWithTwoMarkers(text, markerBefore, markerAfter);

  // 无待翻译内容 → 直接返回保留的前后部分
  if (!translatePart) {
    return keepBefore + keepAfter;
  }

  // 分块翻译中间内容
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

  // 拼接最终结果：前保留 + 翻译后的中间内容 + 后保留
  const translatedPart = translatedChunks.join("\n\n");
  const finalResult = keepBefore + (translatedPart ? "\n" + translatedPart : "") + keepAfter;

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