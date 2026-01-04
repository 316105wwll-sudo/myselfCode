import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";

/**
 * ===============================
 * 配置区
 * ===============================
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

// 初始化客户端（增加日志）
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60000,
  maxRetries: 2,
});

/**
 * 自定义重试函数（简化版，无第三方依赖）
 */
async function withRetry(fn, maxRetries = 3) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      retries++;
      if (retries >= maxRetries) throw err;
      const delay = 1000 * Math.pow(2, retries); // 指数退避：2s → 4s → 8s
      console.log(`请求失败，${delay}ms 后重试（第 ${retries}/${maxRetries} 次）：`, err.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * 翻译函数（修复核心问题 + 详细日志）
 */
async function translate(text, systemPrompt) {
  // 先打印关键信息，排查参数
  console.log("API Key 配置：", process.env.OPENAI_API_KEY ? "已配置（长度：" + process.env.OPENAI_API_KEY.length + "）" : "未配置");
  console.log("待翻译文本长度：", text.length, "字符");

  // 调用 API（带重试）
  const res = await withRetry(async () => {
    const response = await client.chat.completions.create({
      // 先降级用 gpt-4o-mini 测试（绝大多数账户都有权限），确认通了再换 gpt-4.1-nano
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 4096, // gpt-4o-mini 最大输出 4096
    });
    return response;
  });

  // 验证返回值
  if (!res || !res.choices || res.choices.length === 0) {
    throw new Error(`API 返回异常：${JSON.stringify(res)}`);
  }
  return res.choices[0].message.content.trim();
}

/**
 * 主流程（增加错误详情打印）
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
        // 打印完整错误栈，方便排查
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