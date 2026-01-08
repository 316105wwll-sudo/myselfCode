import os
from dotenv import load_dotenv
from openai import OpenAI

# 加载 .env 文件中的 API Key（和你的机器人用同一个 Key）
load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")

# 初始化 OpenAI 客户端
client = OpenAI(api_key=api_key)

try:
    # 调用接口，获取所有可用模型
    models = client.models.list()

    # 打印可用的模型列表（只显示模型 ID，即你代码中用的名称）
    print("✅ 你的 API Key 支持的模型列表：")
    for model in models.data:
        # 重点关注 gpt-3.5 和 gpt-4 系列
        if "gpt-3.5" in model.id or "gpt-4" in model.id:
            print(f"   - {model.id}")

except Exception as e:
    print(f"❌ 查询失败：{str(e)}")
    print("常见原因：1. API Key 错误；2. 无网络；3. 模型权限不足")