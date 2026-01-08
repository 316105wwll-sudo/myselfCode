# -*- coding: utf-8 -*-
"""
Telegram群聊AI机器人（最终稳定版）
核心特性：
1. 加载docs目录下所有TXT文档（无按需筛选，保证AI能使用全部信息）
2. 适配Windows+Python 3.14+PTB v20+，无事件循环冲突
3. 完整的错误处理+数据持久化+对话历史管理
4. 所有核心逻辑带详细注释，便于维护和修改
环境依赖：
- python-telegram-bot>=20.0
- python-dotenv>=1.0.0
- openai>=1.0.0
"""

# ==================== 模块导入区（详细注释每个模块的作用） ====================
# 系统内置模块：用于文件/路径操作、JSON处理、日志记录
import os  # 操作系统交互（创建目录、读写文件、路径拼接等）
import json  # JSON数据的序列化/反序列化（配置文件、数据持久化）
import re  # 正则表达式（提取文档名称等）
import logging  # 日志记录（调试、错误追踪、运行状态记录）

# 第三方模块：需提前安装（pip install python-dotenv python-telegram-bot openai）
from dotenv import load_dotenv  # 加载.env文件中的敏感信息（避免硬编码密钥）
from telegram import Update  # Telegram更新对象（包含消息、用户、群聊等信息）
# Telegram机器人核心处理器：应用创建、命令/消息处理、过滤器
from telegram.ext import (
    Application,  # 机器人主应用对象（管理所有处理器和运行）
    CommandHandler,  # 命令处理器（处理/start、/reloadall等指令）
    MessageHandler,  # 消息处理器（处理文本、文件等消息）
    filters,  # 消息过滤器（筛选文本、文档、排除命令等）
    ContextTypes,  # 上下文类型（定义回调上下文的类型）
    CallbackContext  # 回调上下文（传递额外数据、Bot实例等）
)
from openai import OpenAI  # OpenAI API客户端（调用GPT模型）
from openai import OpenAIError  # OpenAI API异常类（捕获API调用错误）


# ==================== 日志配置区（详细配置日志格式和存储） ====================
def init_logger():
    """
    初始化日志系统（详细配置）
    作用：
    1. 同时输出日志到控制台和bot.log文件
    2. 日志格式包含：时间、模块名、日志级别、具体信息
    3. 日志编码为UTF-8，避免中文乱码
    """
    # 定义日志格式：[时间] - [模块名] - [级别] - [消息]
    log_format = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    # 配置日志基础设置
    logging.basicConfig(
        format=log_format,  # 应用上面定义的格式
        level=logging.INFO,  # 日志级别：INFO（普通信息）、WARNING（警告）、ERROR（错误）
        handlers=[
            # 日志处理器1：写入文件（bot.log），编码UTF-8
            logging.FileHandler("bot.log", encoding="utf-8"),
            # 日志处理器2：输出到控制台
            logging.StreamHandler()
        ]
    )
    # 返回日志实例（供其他函数调用）
    return logging.getLogger(__name__)


# 初始化日志（全局可用）
logger = init_logger()


# ==================== 配置文件加载区（加载机器人核心配置） ====================
def load_config():
    """
    加载配置文件（config.json），若文件不存在/格式错误则使用默认配置
    返回值：
        dict: 包含机器人配置的字典，结构如下：
        {
            "bot_config": 机器人核心配置（模型、文件大小限制等）,
            "path_config": 路径配置（文档目录、历史文件路径等）,
            "prompt_config": 提示词配置（系统提示、错误提示等）
        }
    异常处理：
        1. FileNotFoundError: 配置文件不存在 → 使用默认配置
        2. JSONDecodeError: 配置文件格式错误 → 使用默认配置
    """
    # 默认配置（当config.json不存在/错误时使用）
    default_config = {
        # 机器人核心配置
        "bot_config": {
            "model": "gpt-4o-mini",  # OpenAI使用的模型（可改为gpt-3.5-turbo）
            "max_file_size": 5242880,  # 上传文件最大限制（5MB）
            "max_context_msg": 20,  # 最大对话上下文数量（避免Token超限）
            "poll_interval": 1  # 轮询间隔（秒）：检查新消息的频率
        },
        # 路径配置（所有路径基于脚本所在目录）
        "path_config": {
            "docs_dir": "docs",  # 文档存储目录
            "chat_history_file": "docs/chat_history.txt",  # 对话历史文件
            "data_file": "tg_single_group_data.json"  # 数据持久化文件（知识库+上下文）
        },
        # 提示词配置（可根据需求修改，无按需筛选逻辑）
        "prompt_config": {
            # 默认系统提示：让AI参考所有文档回答，保持完整、友好
            "default_system_prompt": "你是本群组的智能助手，核心规则：\n1. 优先且精准参考docs文件夹中的所有txt文件内容回答问题；\n2. 结合历史对话上下文，回答完整、准确，不要遗漏关键信息；\n3. 保持友好的交流语气，语言自然，符合日常聊天习惯。",
            # 天气查询专用提示：强制参考天气.txt，不编造数据
            "weather_system_prompt": "你必须严格按照docs文件夹中“天气.txt”的内容回答今天的天气，如果没有天气.txt文件，直接回复“未找到今天的天气信息，请检查天气.txt文件”，绝对不要编造任何天气数据。",
            # 通用错误提示（用户操作/系统错误时展示）
            "error_tip": "😥 抱歉，处理你的请求时出错了！\n可能的原因：\n1. 发送了非文本消息（如图片、语音）@我，请发送文字问题；\n2. 网络/OpenAI API Key异常，请稍后再试；\n3. 文档格式错误，请检查后执行/reloadall重新加载。",
            # 非文本消息提示（用户发图片/语音@机器人时）
            "non_text_tip": "🙅 抱歉，我暂时只支持文字消息哦！请@我并发送文字问题，我会尽力解答。",
            # 空问题提示（用户@机器人但没说问题时）
            "no_question_tip": "@{user_name} 你@我啦，但没说具体问题哦～请输入想咨询的内容，我会参考所有文档尽力解答！"
        }
    }

    # 获取脚本所在目录（确保配置文件路径正确，不受运行目录影响）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # 拼接config.json的绝对路径
    config_path = os.path.join(script_dir, "config.json")
    logger.info(f"📌 开始加载配置文件，路径：{config_path}")

    try:
        # 读取配置文件（UTF-8编码，避免中文乱码）
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        logger.info("✅ 配置文件加载成功（使用自定义配置）")
        return config
    except FileNotFoundError:
        # 配置文件不存在 → 使用默认配置
        logger.error(f"❌ 未找到config.json文件（路径：{config_path}），将使用默认配置")
        return default_config
    except json.JSONDecodeError:
        # 配置文件格式错误（如中文引号、//注释等）→ 使用默认配置
        logger.error(f"❌ config.json格式错误（JSON语法错误），请检查文件内容，将使用默认配置")
        return default_config


# 加载配置（全局变量，所有函数均可调用）
CONFIG = load_config()

# ==================== 敏感信息加载区（从.env文件加载，避免硬编码） ====================
# 加载.env文件（需在脚本同目录创建.env，写入TG_BOT_TOKEN和OPENAI_API_KEY）
load_dotenv()
# 从环境变量读取Telegram机器人Token（向@BotFather申请）
TG_BOT_TOKEN = os.getenv("TG_BOT_TOKEN")
# 从环境变量读取OpenAI API Key（从OpenAI官网获取）
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# ==================== 全局变量定义区（跨函数共享的数据） ====================
BOT_USERNAME = None  # 机器人用户名（运行时自动获取，用于识别@机器人的消息）
# 初始化OpenAI客户端（若API Key为空则为None，后续会做校验）
client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
# 机器人核心数据（内存中存储，定期持久化到JSON文件）
bot_data = {
    "conversation_context": [],  # 对话上下文（用户+助手的消息列表，用于上下文对话）
    "knowledge_base": "",  # 知识库：存储docs目录下所有TXT文件的内容
    "custom_prompt": CONFIG["prompt_config"]["default_system_prompt"]  # 自定义系统提示词
}


# ==================== 数据处理核心函数区（加载/保存所有文档、对话历史） ====================
def load_all_docs(notify: bool = False) -> str | None:
    """
    加载docs目录下所有TXT文档到知识库（核心函数，无按需筛选）
    参数：
        notify (bool): 是否返回格式化的提示信息（True：返回给用户；False：仅日志记录）
    返回值：
        str | None: notify=True时返回提示字符串，False时返回None
    核心逻辑：
        1. 清空现有知识库 → 重新加载所有TXT文件
        2. 跳过超过10MB的超大文件（避免内存溢出）
        3. 加载对话历史 → 限制上下文数量（避免Token超限）
        4. 持久化数据到JSON文件
    """
    # 从配置中读取关键路径/参数
    docs_dir = CONFIG["path_config"]["docs_dir"]  # 文档目录
    chat_history_file = CONFIG["path_config"]["chat_history_file"]  # 对话历史文件
    max_context_msg = CONFIG["bot_config"]["max_context_msg"]  # 最大上下文数量
    MAX_SINGLE_FILE_SIZE = 10 * 1024 * 1024  # 单文件最大大小：10MB（避免加载超大文件）

    # 第一步：清空现有知识库（重新加载所有文件，避免重复）
    bot_data["knowledge_base"] = ""
    total_files = 0  # 统计成功加载的文件数量

    # 确保docs目录存在（不存在则创建）
    os.makedirs(docs_dir, exist_ok=True)
    logger.info(f"📂 开始加载文档，目录：{docs_dir}，单文件最大限制：10MB")

    # 第二步：遍历docs目录下所有文件，加载所有TXT文件
    for filename in os.listdir(docs_dir):
        # 仅处理TXT文件（忽略大小写，如.txt、.TXT）
        if not filename.lower().endswith(".txt"):
            logger.debug(f"🔍 跳过非TXT文件：{filename}")
            continue

        # 拼接文件绝对路径
        file_path = os.path.join(docs_dir, filename)

        # 检查文件大小：跳过超过10MB的文件
        if os.path.getsize(file_path) > MAX_SINGLE_FILE_SIZE:
            logger.warning(f"⚠️ 跳过超大文件：{filename}（大小超过10MB）")
            continue

        # 读取文件内容（UTF-8编码，避免中文乱码）
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read().strip()  # 读取并去除首尾空白字符

            # 仅当文件内容非空时，添加到知识库
            if content:
                # 拼接格式：【文档：文件名】+ 内容（便于AI识别不同文档）
                bot_data["knowledge_base"] += f"\n\n===== 【文档：{filename}】 =====\n{content}"
                total_files += 1  # 统计成功加载的文件数
            logger.info(f"✅ 成功加载文档：{filename}")
        except Exception as e:
            # 捕获文件读取异常（如权限不足、文件损坏等）
            logger.error(f"❌ 加载文档失败：{filename}，错误信息：{str(e)}")

    # 第三步：加载对话历史（从chat_history_file读取）
    chat_count = 0  # 统计加载的对话轮数（1轮=用户消息+助手消息）
    # 若对话历史文件不存在 → 创建空文件
    if not os.path.exists(chat_history_file):
        with open(chat_history_file, "w", encoding="utf-8") as f:
            f.write("# 群聊对话历史\n\n")  # 写入文件头
        logger.info(f"📄 对话历史文件不存在，已创建：{chat_history_file}")
    else:
        # 读取对话历史文件
        try:
            with open(chat_history_file, "r", encoding="utf-8") as f:
                lines = f.readlines()  # 按行读取

            # 解析对话历史：格式为【用户】xxx\n【助手】xxx
            bot_data["conversation_context"] = []
            user_msg, assistant_msg = "", ""  # 临时存储单轮对话
            for line in lines:
                line = line.strip()  # 去除行首尾空白
                # 匹配用户消息行
                if line.startswith("【用户】"):
                    user_msg = line.replace("【用户】", "").strip()
                # 匹配助手消息行
                elif line.startswith("【助手】"):
                    assistant_msg = line.replace("【助手】", "").strip()
                    # 仅当用户和助手消息都存在时，添加到上下文
                    if user_msg and assistant_msg:
                        bot_data["conversation_context"].append({"role": "user", "content": user_msg})
                        bot_data["conversation_context"].append({"role": "assistant", "content": assistant_msg})
                        # 重置临时变量，准备解析下一轮
                        user_msg, assistant_msg = "", ""

            # 限制上下文数量（避免Token超限）：只保留最后max_context_msg条消息
            if len(bot_data["conversation_context"]) > max_context_msg:
                bot_data["conversation_context"] = bot_data["conversation_context"][-max_context_msg:]

            # 计算对话轮数（每2条消息=1轮）
            chat_count = len(bot_data["conversation_context"]) // 2
            logger.info(f"📝 成功加载对话历史，共{chat_count}轮，上下文数量：{len(bot_data['conversation_context'])}")
        except Exception as e:
            # 捕获对话历史加载异常
            logger.error(f"❌ 加载对话历史失败，错误信息：{str(e)}")

    # 第四步：持久化数据到JSON文件（避免程序重启后数据丢失）
    save_data()

    # 第五步：构建返回提示信息（根据notify参数决定是否返回）
    result = (
        f"✅ 文档加载完成！\n"
        f"📚 成功加载{total_files}个TXT文档（所有文档均已加载，无筛选）\n"
        f"💬 加载{chat_count}轮历史对话（最大保留{max_context_msg}条消息）\n"
        f"💡 提示：修改docs目录下的文件后，需发送/reloadall重新加载"
    )
    if notify:
        return result  # 返回给用户（如/start、/reloadall命令）
    logger.info(result)  # 仅记录日志
    return None


def save_data():
    """
    持久化机器人数据到JSON文件（核心数据：知识库+上下文+提示词）
    作用：避免程序重启后，已加载的知识库和对话上下文丢失
    异常处理：捕获文件写入异常，记录错误日志
    """
    # 从配置中读取数据文件路径
    data_file = CONFIG["path_config"]["data_file"]
    try:
        # 写入JSON文件（ensure_ascii=False：保留中文；indent=2：格式化输出，便于查看）
        with open(data_file, "w", encoding="utf-8") as f:
            json.dump(bot_data, f, ensure_ascii=False, indent=2)
        logger.debug(f"✅ 数据已成功保存到文件：{data_file}")  # debug级别：仅调试时显示
    except Exception as e:
        # 捕获文件写入异常（如权限不足、磁盘满等）
        logger.error(f"❌ 保存数据失败，错误信息：{str(e)}，文件路径：{data_file}")


def load_data():
    """
    从JSON文件恢复机器人数据（程序启动时调用）
    作用：重启程序后，恢复之前加载的知识库和对话上下文
    异常处理：
        1. JSONDecodeError：文件格式错误 → 初始化空数据
        2. 其他异常：记录错误 → 初始化空数据
    """
    global bot_data  # 声明使用全局变量（否则会创建局部变量）
    data_file = CONFIG["path_config"]["data_file"]

    # 检查数据文件是否存在
    if os.path.exists(data_file):
        try:
            # 读取数据文件
            with open(data_file, "r", encoding="utf-8") as f:
                bot_data = json.load(f)
            logger.info("✅ 成功从文件恢复数据（知识库+上下文+提示词）")
        except json.JSONDecodeError:
            # JSON格式错误 → 初始化空数据
            logger.error(f"❌ 数据文件格式错误（JSON语法错误），将初始化空数据，文件路径：{data_file}")
            bot_data = {
                "conversation_context": [],
                "knowledge_base": "",
                "custom_prompt": CONFIG["prompt_config"]["default_system_prompt"]
            }
            save_data()  # 重新写入空数据文件
        except Exception as e:
            # 其他异常 → 初始化空数据
            logger.error(f"❌ 加载数据失败，错误信息：{str(e)}，将初始化空数据")
            bot_data = {
                "conversation_context": [],
                "knowledge_base": "",
                "custom_prompt": CONFIG["prompt_config"]["default_system_prompt"]
            }
            save_data()
    else:
        # 数据文件不存在 → 初始化空数据并创建文件
        bot_data = {
            "conversation_context": [],
            "knowledge_base": "",
            "custom_prompt": CONFIG["prompt_config"]["default_system_prompt"]
        }
        save_data()
        logger.info(f"✅ 数据文件不存在，已创建空数据文件：{data_file}")


# ==================== 全局错误处理器（捕获所有未处理的异常） ====================
async def error_handler(update: Update, context: CallbackContext) -> None:
    """
    全局错误处理器（捕获机器人运行中所有未处理的异常）
    作用：避免单个错误导致整个机器人崩溃，同时给用户反馈错误信息
    参数：
        update (Update): Telegram更新对象（包含出错的消息/用户信息）
        context (CallbackContext): 回调上下文（包含错误信息）
    """
    # 记录错误日志（exc_info=context.error：记录完整的异常堆栈）
    logger.error(msg="❌ 机器人处理请求时发生未捕获异常", exc_info=context.error)
    # 仅当有有效消息时，给用户发送错误提示（避免无消息时报错）
    if update and update.effective_message:
        await update.effective_message.reply_text(CONFIG["prompt_config"]["error_tip"])


# ==================== 命令处理器（处理/start、/reloadall等指令） ====================
async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    处理/start命令（机器人启动后，用户发送该命令初始化）
    作用：
        1. 加载所有文档到知识库
        2. 向用户发送使用指南
    参数：
        update (Update): 包含用户发送的/start命令信息
        context (ContextTypes.DEFAULT_TYPE): 机器人上下文（包含Bot实例等）
    """
    # 加载所有文档，并获取格式化提示信息
    load_result = load_all_docs(notify=True)
    # 构建使用指南（清晰说明所有可用命令）
    guide = (
        f"🎉 群智能助手已成功激活！\n{load_result}\n\n"
        "📌 核心指令说明（所有指令均需在群里发送）：\n"
        " 1. /reloadall → 重新加载docs目录下所有TXT文档（修改文件后必用）\n"
        " 2. /weather → 查询今天的天气（优先参考weather.txt）\n"
        " 3. /showkb → 查看已加载的所有知识库内容（预览）\n"
        " 4. /setprompt → 自定义AI回答风格（示例：/setprompt 你是专业的客服助手）\n"
        " 5. /clearall → 清空所有数据（知识库+上下文+提示词，谨慎使用）\n"
        " 6. @机器人 + 文字问题 → 参考所有文档+历史上下文回答你的问题\n"
        "\n💡 重要提示：所有docs目录下的TXT文档都会被加载，AI会参考全部内容回答！"
    )
    # 向用户发送使用指南
    await update.message.reply_text(guide)
    # 记录日志（包含用户ID，便于追踪）
    logger.info(f"🚀 /start命令执行成功，用户ID：{update.effective_user.id}")


async def reload_all_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    处理/reloadall命令（重新加载所有文档）
    场景：用户修改了docs目录下的文件后，发送该命令更新知识库
    参数：
        update (Update): 包含用户发送的/reloadall命令信息
        context (ContextTypes.DEFAULT_TYPE): 机器人上下文
    """
    # 重新加载所有文档，并获取提示信息
    result = load_all_docs(notify=True)
    # 向用户反馈加载结果
    await update.message.reply_text(result)
    logger.info(f"🔄 /reloadall命令执行成功，用户ID：{update.effective_user.id}")


async def weather_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    处理/weather命令（查询今天的天气）
    核心逻辑：
        1. 使用天气专用提示词（强制参考weather.txt）
        2. 调用OpenAI API获取天气回答
        3. 向用户返回结果
    参数：
        update (Update): 包含/weather命令信息
        context (ContextTypes.DEFAULT_TYPE): 机器人上下文
    """
    # 构建调用OpenAI的消息列表
    messages = []
    # 添加天气专用系统提示词
    system_msg = CONFIG["prompt_config"]["weather_system_prompt"]
    messages.append({"role": "system", "content": system_msg})
    # 添加用户问题（固定问“今天的天气是什么？”）
    messages.append({"role": "user", "content": "今天的天气是什么？"})

    try:
        # 校验OpenAI客户端是否初始化（API Key是否配置）
        if not client:
            await update.message.reply_text("❌ 未配置OpenAI API Key！请检查.env文件中的OPENAI_API_KEY是否正确")
            return

        # 调用OpenAI API（temperature=0.0：回答固定，不随机；max_tokens=500：限制回答长度）
        response = client.chat.completions.create(
            model=CONFIG["bot_config"]["model"],  # 使用配置中的模型（如gpt-4o-mini）
            messages=messages,  # 消息列表（系统提示+用户问题）
            temperature=0.0,  # 随机性：0=完全固定，1=最大随机
            max_tokens=500  # 最大生成Token数（避免回答过长）
        )
        # 提取AI回答（去除首尾空白）
        weather_reply = response.choices[0].message.content.strip()
        # 向用户发送天气信息
        await update.message.reply_text(f"🌤️ 今天的天气：\n{weather_reply}")
        logger.info(f"🌡️ /weather命令执行成功，用户ID：{update.effective_user.id}")

    except OpenAIError as e:
        # 捕获OpenAI API异常（如API Key无效、额度不足、网络问题等）
        await update.message.reply_text(f"❌ OpenAI API调用失败：{str(e)}")
        logger.error(f"❌ /weather命令OpenAI错误，用户ID：{update.effective_user.id}，错误信息：{str(e)}")
    except Exception as e:
        # 捕获其他异常（如消息发送失败等）
        await update.message.reply_text(f"❌ 天气查询失败：{str(e)}")
        logger.error(f"❌ /weather命令其他错误，用户ID：{update.effective_user.id}，错误信息：{str(e)}")


async def show_kb_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    处理/showkb命令（查看已加载的所有知识库内容）
    作用：让用户确认文档是否已正确加载，查看知识库预览
    参数：
        update (Update): 包含/showkb命令信息
        context (ContextTypes.DEFAULT_TYPE): 机器人上下文
    """
    # 获取内存中的知识库内容
    kb_content = bot_data["knowledge_base"]

    # 若知识库为空 → 提示用户加载文档
    if not kb_content:
        await update.message.reply_text(
            "📚 知识库为空！请按以下步骤操作：\n1. 将TXT文件放入docs目录\n2. 在群里发送 /reloadall 加载所有文档")
        return

    # 提取已加载的文档名称（通过正则匹配【文档：xxx】中的xxx）
    doc_names = re.findall(r"【文档：(.*?)】", kb_content)
    # 格式化文档列表（无文档则显示“无”）
    doc_list_text = "\n- " + "\n- ".join(doc_names) if doc_names else "无"

    # 知识库内容预览（仅展示前1500字符，避免消息过长）
    preview = kb_content[:1500]
    if len(kb_content) > 1500:
        preview += "\n\n...（内容过长，仅展示前1500字符，完整内容已加载到AI知识库）"

    # 构建回复信息
    reply = (
        f"📚 已加载的所有文档列表：\n{doc_list_text}\n\n"
        f"📝 知识库内容预览（所有文档均已完整加载）：\n{preview}\n\n"
        f"💡 提示：若修改了文档内容，请发送/reloadall重新加载"
    )
    # 发送预览信息给用户
    await update.message.reply_text(reply)
    logger.info(f"📖 /showkb命令执行成功，用户ID：{update.effective_user.id}，已加载文档数：{len(doc_names)}")


async def set_prompt_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    处理/setprompt命令（自定义AI的系统提示词）
    场景：用户想修改AI的回答风格（如“你是专业的技术顾问”“你是可爱的客服小姐姐”）
    参数：
        update (Update): 包含/setprompt命令及参数信息
        context (ContextTypes.DEFAULT_TYPE): 机器人上下文
    使用示例：
        /setprompt 你是本群的专业顾问，回答问题时要详细、准确，使用专业术语
    """
    # 获取用户输入的新提示词（context.args：命令后的所有参数拼接）
    new_prompt = " ".join(context.args).strip() if context.args else ""

    # 若用户未输入新提示词 → 显示当前提示词
    if not new_prompt:
        current_prompt = bot_data["custom_prompt"]
        await update.message.reply_text(
            f"📝 当前使用的系统提示词：\n{current_prompt}\n\n💡 用法示例：/setprompt 你是专业的天气顾问，回答简洁明了")
        return

    # 更新自定义提示词（全局变量）
    bot_data["custom_prompt"] = new_prompt
    # 持久化数据（避免重启后丢失）
    save_data()
    # 向用户反馈更新结果
    await update.message.reply_text(f"✅ AI回答风格已成功更新！\n新的系统提示词：\n{new_prompt}")
    logger.info(f"✏️ /setprompt命令执行成功，用户ID：{update.effective_user.id}，新提示词：{new_prompt[:50]}...")


async def clear_all_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    处理/clearall命令（清空所有数据，谨慎使用）
    清空内容：
        1. 内存中的知识库、对话上下文、自定义提示词
        2. 对话历史文件（chat_history.txt）
        3. 数据持久化文件（tg_single_group_data.json）
    参数：
        update (Update): 包含/clearall命令信息
        context (ContextTypes.DEFAULT_TYPE): 机器人上下文
    """
    # 清空内存中的核心数据（恢复默认值）
    bot_data["conversation_context"] = []
    bot_data["knowledge_base"] = ""
    bot_data["custom_prompt"] = CONFIG["prompt_config"]["default_system_prompt"]
    # 持久化清空后的数据（覆盖原有文件）
    save_data()

    # 清空对话历史文件（写入文件头，内容清空）
    chat_history_file = CONFIG["path_config"]["chat_history_file"]
    with open(chat_history_file, "w", encoding="utf-8") as f:
        f.write("# 群聊对话历史\n\n")

    # 向用户反馈清空结果
    await update.message.reply_text(
        "🆘 所有数据已成功清空！\n"
        "- 内存数据：知识库、对话上下文、自定义提示词（已恢复默认）\n"
        "- 文件数据：对话历史.txt、数据JSON文件\n"
        "\n💡 提示：发送 /reloadall 可重新加载docs目录下的所有文档"
    )
    # 记录警告日志（清空数据属于高危操作）
    logger.warning(f"🗑️ /clearall命令执行成功（高危操作），用户ID：{update.effective_user.id}")


# ==================== 消息处理器（处理文件上传、@机器人的文字消息） ====================
async def handle_file_upload(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    处理用户上传的TXT文件（仅支持TXT，且大小不超过配置的max_file_size）
    核心逻辑：
        1. 校验文件类型（仅TXT）和大小（不超限）
        2. 保存文件到docs目录
        3. 自动重新加载所有文档
    参数：
        update (Update): 包含用户上传的文件信息
        context (ContextTypes.DEFAULT_TYPE): 机器人上下文（包含Bot实例，用于下载文件）
    """
    # 获取上传的文件对象
    document = update.message.document
    # 从配置中读取文件大小限制
    max_file_size = CONFIG["bot_config"]["max_file_size"]
    # 文档存储目录
    docs_dir = CONFIG["path_config"]["docs_dir"]

    # 校验1：仅支持TXT文件（忽略大小写）
    if not document.file_name.lower().endswith(".txt"):
        await update.message.reply_text("❌ 仅支持上传TXT格式的文件！请将内容保存为.txt后再上传")
        return

    # 校验2：文件大小不超过限制（转换为MB显示，更友好）
    if document.file_size > max_file_size:
        max_mb = max_file_size // 1024 // 1024  # 字节转MB
        await update.message.reply_text(
            f"❌ 文件大小超过限制！最大支持 {max_mb}MB，当前文件大小：{document.file_size // 1024 // 1024}MB")
        return

    try:
        # 拼接文件保存路径（docs目录+原文件名）
        save_path = os.path.join(docs_dir, document.file_name)
        # 获取文件的临时下载链接（Telegram服务器）
        temp_file = await context.bot.get_file(document.file_id)
        # 下载文件到本地指定路径
        await temp_file.download_to_drive(save_path)

        # 自动重新加载所有文档（确保新上传的文件被加入知识库）
        load_all_docs()

        # 向用户反馈上传结果
        await update.message.reply_text(
            f"✅ 文件上传成功！\n保存路径：{save_path}\n已自动重新加载所有文档，AI可立即使用该文件内容")
        logger.info(f"📤 文件上传成功，用户ID：{update.effective_user.id}，文件路径：{save_path}")

    except Exception as e:
        # 捕获文件下载/保存异常
        await update.message.reply_text(f"❌ 文件上传失败：{str(e)}")
        logger.error(f"❌ 文件上传错误，用户ID：{update.effective_user.id}，错误信息：{str(e)}")


async def handle_mention(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    处理@机器人的文字消息（核心功能：参考所有文档+上下文回答用户问题）
    核心逻辑：
        1. 识别是否@了本机器人
        2. 提取用户的问题（去除@机器人的部分）
        3. 构建包含“所有知识库+上下文+用户问题”的消息列表
        4. 调用OpenAI API获取回答
        5. 更新上下文+保存对话历史
    参数：
        update (Update): 包含用户@机器人的消息信息
        context (ContextTypes.DEFAULT_TYPE): 机器人上下文
    """
    # 第一步：获取消息对象，判空（避免非文本消息导致报错）
    message = update.message
    if not message or not message.text:
        # 非文本消息（如图片、语音）→ 提示用户发送文字
        await update.effective_message.reply_text(CONFIG["prompt_config"]["non_text_tip"])
        return

    # 全局变量：机器人用户名（首次调用时自动获取）
    global BOT_USERNAME
    # 获取用户昵称（用于空问题提示）
    user_name = update.effective_user.first_name or "用户"
    # 原始用户消息（去除首尾空白）
    user_question = message.text.strip()
    # 标记：是否@了本机器人
    is_mention_me = False

    # 第二步：获取机器人用户名（首次调用时）
    if not BOT_USERNAME:
        # 获取机器人的基本信息（包含用户名）
        bot_info = await context.bot.get_me()
        # 转换为小写（避免大小写敏感）
        BOT_USERNAME = bot_info.username.lower()
        logger.info(f"🤖 成功获取机器人用户名：{BOT_USERNAME}")

    # 第三步：解析消息中的@实体，判断是否@了本机器人
    if message.entities:  # entities：消息中的特殊实体（@、链接、命令等）
        for entity in message.entities:
            # 仅处理@类型的实体
            if entity.type == "mention":
                # 提取@的内容（转换为小写）
                mention_text = message.text[entity.offset:entity.offset + entity.length].lower()
                # 检查是否@了本机器人（去除@符号后匹配）
                if mention_text.replace("@", "") == BOT_USERNAME:
                    is_mention_me = True
                    # 提取用户的真实问题（去除@机器人的部分）
                    user_question = message.text[:entity.offset] + message.text[entity.offset + entity.length:]
                    # 去除首尾空白（避免只剩空格）
                    user_question = user_question.strip()
                    break  # 找到本机器人的@，退出循环

    # 若未@本机器人 → 不处理
    if not is_mention_me:
        return

    # 若用户只@了机器人，但没说问题 → 提示用户输入问题
    if not user_question:
        await message.reply_text(CONFIG["prompt_config"]["no_question_tip"].format(user_name=user_name))
        return

    # 第四步：构建调用OpenAI的消息列表（核心：包含所有知识库+上下文）
    messages = []
    # 系统提示词：自定义提示词 + 所有知识库内容
    system_msg = bot_data["custom_prompt"]
    # 拼接所有知识库内容（核心：无按需筛选，全部加载）
    if bot_data["knowledge_base"]:
        system_msg += f"\n\n===== 【所有参考文档】 =====\n{bot_data['knowledge_base']}"
    # 添加系统提示词（AI的行为准则+所有文档）
    messages.append({"role": "system", "content": system_msg})

    # 添加对话上下文（历史消息，用于上下文对话）
    messages.extend(bot_data["conversation_context"])

    # 添加用户的当前问题
    messages.append({"role": "user", "content": user_question})

    try:
        # 校验OpenAI客户端是否初始化
        if not client:
            await message.reply_text("❌ 未配置OpenAI API Key！请检查.env文件中的OPENAI_API_KEY是否正确")
            return

        # 第五步：调用OpenAI API获取回答
        response = client.chat.completions.create(
            model=CONFIG["bot_config"]["model"],  # 使用配置中的模型
            messages=messages,  # 完整消息列表（系统+上下文+用户问题）
            temperature=0.7,  # 随机性：0.7（平衡准确和自然）
            max_tokens=2000  # 最大生成Token数（足够回答大部分问题）
        )
        # 提取AI回答（去除首尾空白）
        ai_reply = response.choices[0].message.content.strip()

        # 第六步：更新对话上下文（避免超限）
        # 添加用户问题到上下文
        bot_data["conversation_context"].append({"role": "user", "content": user_question})
        # 添加AI回答到上下文
        bot_data["conversation_context"].append({"role": "assistant", "content": ai_reply})
        # 限制上下文数量（仅保留最后max_context_msg条）
        if len(bot_data["conversation_context"]) > CONFIG["bot_config"]["max_context_msg"]:
            bot_data["conversation_context"] = bot_data["conversation_context"][
                -CONFIG["bot_config"]["max_context_msg"]:]
        # 持久化更新后的上下文
        save_data()

        # 第七步：保存对话历史到文件（自动截断超大文件）
        chat_history_file = CONFIG["path_config"]["chat_history_file"]
        MAX_CHAT_FILE_SIZE = 100 * 1024 * 1024  # 对话文件最大100MB
        TRIM_TO_SIZE = 50 * 1024 * 1024  # 超过后保留最后50MB
        # 检查文件大小，超过则截断
        if os.path.exists(chat_history_file) and os.path.getsize(chat_history_file) > MAX_CHAT_FILE_SIZE:
            with open(chat_history_file, "rb") as f:
                # 移动到文件末尾前50MB的位置
                f.seek(-TRIM_TO_SIZE, os.SEEK_END)
                # 读取剩余内容（UTF-8编码，忽略错误）
                content = f.read().decode("utf-8", errors="ignore")
            # 重新写入文件（保留最后50MB）
            with open(chat_history_file, "w", encoding="utf-8") as f:
                f.write("# 群聊对话历史（自动截断，仅保留最后50MB）\n\n" + content)

        # 追加新的对话到历史文件
        with open(chat_history_file, "a", encoding="utf-8") as f:
            f.write(f"【用户】{user_question}\n【助手】{ai_reply}\n\n")

        # 第八步：向用户发送AI回答
        await message.reply_text(ai_reply)
        logger.info(f"💬 @机器人回答成功，用户ID：{update.effective_user.id}，问题：{user_question[:50]}...")

    except OpenAIError as e:
        # OpenAI API异常 → 反馈给用户
        await message.reply_text(f"❌ 回答失败：{str(e)}")
        logger.error(f"❌ @机器人OpenAI错误，用户ID：{update.effective_user.id}，错误信息：{str(e)}")
    except Exception as e:
        # 其他异常 → 通用错误提示
        await message.reply_text(CONFIG["prompt_config"]["error_tip"])
        logger.error(f"❌ @机器人其他错误，用户ID：{update.effective_user.id}，错误信息：{str(e)}")


# ==================== 主函数（机器人启动入口） ====================
def main():
    """
    机器人主函数（程序入口）
    核心流程：
        1. 校验敏感信息（Token/API Key）
        2. 加载历史数据（知识库+上下文）
        3. 创建机器人应用
        4. 注册所有处理器（命令/消息/错误）
        5. 启动机器人（轮询模式，适配Windows）
    """
    # 第一步：前置校验（必须的敏感信息）
    if not TG_BOT_TOKEN:
        # 无Telegram Token → 无法启动，记录致命错误并退出
        logger.critical("❌ 致命错误：未配置TG_BOT_TOKEN！请在.env文件中添加该参数（向@BotFather申请）")
        return
    if not OPENAI_API_KEY:
        # 无OpenAI API Key → 警告（仍可启动，但无法回答问题）
        logger.warning("⚠️ 警告：未配置OPENAI_API_KEY！机器人可启动，但无法调用OpenAI API回答问题")

    # 第二步：加载历史数据（重启后恢复知识库+上下文）
    load_data()
    # 第三步：加载所有文档（首次启动时）
    load_all_docs()

    # 第四步：创建机器人应用（核心对象）
    application = Application.builder().token(TG_BOT_TOKEN).build()

    # 第五步：注册所有处理器（按功能分类）
    # 1. 命令处理器（处理/开头的指令）
    application.add_handler(CommandHandler("start", start_cmd))  # /start：初始化
    application.add_handler(CommandHandler("reloadall", reload_all_cmd))  # /reloadall：重新加载文档
    application.add_handler(CommandHandler("weather", weather_cmd))  # /weather：查天气
    application.add_handler(CommandHandler("showkb", show_kb_cmd))  # /showkb：查看知识库
    application.add_handler(CommandHandler("setprompt", set_prompt_cmd))  # /setprompt：自定义提示词
    application.add_handler(CommandHandler("clearall", clear_all_cmd))  # /clearall：清空数据

    # 2. 消息处理器（处理文件上传、@机器人的文字消息）
    # 文件上传处理器：仅处理文档，排除命令
    application.add_handler(MessageHandler(filters.Document.ALL & ~filters.COMMAND, handle_file_upload))
    # @机器人消息处理器：仅处理文字，排除命令
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_mention))

    # 3. 全局错误处理器（捕获所有未处理的异常）
    application.add_error_handler(error_handler)

    # 第六步：启动机器人（轮询模式，适配Windows，无事件循环冲突）
    logger.info(f"\n🤖 群聊AI机器人启动成功！")
    logger.info(f"📌 使用模型：{CONFIG['bot_config']['model']}")
    logger.info(f"📂 文档目录：{CONFIG['path_config']['docs_dir']}")
    logger.info(f"💡 提示：启动后在群里发送 /start 查看使用指南")
    # 启动轮询（poll_interval：检查新消息的间隔，单位秒）
    application.run_polling(poll_interval=CONFIG["bot_config"]["poll_interval"])


# ==================== 程序入口（仅当直接运行脚本时执行） ====================
if __name__ == "__main__":
    # 切换工作目录到脚本所在目录（确保路径正确）
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    # 执行主函数
    main()