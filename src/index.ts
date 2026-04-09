import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { scanForBackup } from "./backup-scanner.js";
import { DbReader } from "./db-reader.js";
import { ContactResolver } from "./contact-resolver.js";
import { MessageReader } from "./message-reader.js";
import { listContacts } from "./tools/list-contacts.js";
import { getChatSummary } from "./tools/get-chat-summary.js";
import { readMessages } from "./tools/read-messages.js";
import { searchMessages } from "./tools/search-messages.js";
import { getStats } from "./tools/get-stats.js";

const backupInfo = scanForBackup(process.env.WX_BACKUP_PATH);
const dbReader = new DbReader(backupInfo);
const contactResolver = new ContactResolver(dbReader.getContactDb(), dbReader.getMessageDbs());
const messageReader = new MessageReader(dbReader.getMessageDbs());

const server = new McpServer(
  { name: "wx-memory", version: "1.0.0" },
  {
    instructions: `你是用户的"数字记忆"助手，可以读取用户的微信聊天记录。

使用策略 (重要 - 省Token):
1. 先调用 get_stats 了解整体情况
2. 用 list_contacts 浏览联系人列表
3. 对感兴趣的联系人先用 get_chat_summary 看摘要 (极省Token)
4. 只在需要具体内容时才用 read_messages 读取详情
5. 用 search_messages 跨联系人搜索关键词

绝对不要一次性读取所有消息，按需渐进式加载。`,
  }
);

server.registerTool(
  "list_contacts",
  {
    title: "联系人列表",
    description:
      "列出所有有聊天记录的联系人，按消息数量排序。支持按类型过滤 (个人/群聊/公众号) 和分页。",
    inputSchema: z.object({
      page: z.number().optional().describe("页码，从1开始"),
      page_size: z.number().optional().describe("每页数量，默认100，最大500"),
      filter: z
        .enum(["全部", "个人", "群聊", "公众号"])
        .optional()
        .describe("过滤类型"),
    }),
    annotations: { readOnlyHint: true },
  },
  async (args) => ({
    content: [{ type: "text", text: listContacts(contactResolver, args) }],
  })
);

server.registerTool(
  "get_chat_summary",
  {
    title: "聊天摘要",
    description:
      "获取与某联系人的聊天摘要：消息总数、时间跨度、月度活跃度、消息类型分布、最近10条预览。极省Token，建议在读取详细消息前先调用。",
    inputSchema: z.object({
      contact: z.string().describe("联系人昵称、备注名或wxid，支持模糊匹配"),
    }),
    annotations: { readOnlyHint: true },
  },
  async (args) => ({
    content: [{ type: "text", text: getChatSummary(contactResolver, messageReader, args) }],
  })
);

server.registerTool(
  "read_messages",
  {
    title: "读取聊天记录",
    description:
      "读取与某联系人的具体聊天内容。支持时间范围、关键词过滤、消息类型过滤和分页。输出为极度压缩的格式以节省Token。",
    inputSchema: z.object({
      contact: z.string().describe("联系人昵称、备注名或wxid"),
      page: z.number().optional().describe("页码，从1开始"),
      page_size: z.number().optional().describe("每页条数，默认50，最大200"),
      date_from: z.string().optional().describe("起始日期 YYYY-MM-DD"),
      date_to: z.string().optional().describe("截止日期 YYYY-MM-DD"),
      keyword: z.string().optional().describe("消息内容关键词过滤"),
      type: z
        .enum(["all", "text", "image", "voice", "video", "emoji", "link", "location", "call", "card"])
        .optional()
        .describe("消息类型过滤"),
    }),
    annotations: { readOnlyHint: true },
  },
  async (args) => ({
    content: [{ type: "text", text: readMessages(contactResolver, messageReader, args) }],
  })
);

server.registerTool(
  "search_messages",
  {
    title: "全局搜索",
    description:
      "跨所有联系人搜索包含关键词的消息。结果按联系人分组，每人最多返回5条匹配。",
    inputSchema: z.object({
      keyword: z.string().describe("搜索关键词"),
      limit: z.number().optional().describe("最大返回条数，默认50，最大100"),
    }),
    annotations: { readOnlyHint: true },
  },
  async (args) => ({
    content: [{ type: "text", text: searchMessages(contactResolver, messageReader, args) }],
  })
);

server.registerTool(
  "get_stats",
  {
    title: "数据统计",
    description: "获取微信备份的整体统计：总联系人数、总消息数、Top 15聊天排行等。",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [{ type: "text", text: getStats(contactResolver) }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", async () => {
  dbReader.close();
  await server.close();
  process.exit(0);
});
