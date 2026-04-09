import type { Message, Contact, ChatSummary } from "./types.js";
import { MSG_TYPES } from "./types.js";

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

function formatTimeShort(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sameDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1 * 1000);
  const d2 = new Date(ts2 * 1000);
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function extractAppMsgTitle(xml: string): string {
  const titleMatch = xml.match(/<title>([^<]*)<\/title>/);
  return titleMatch ? titleMatch[1] : "链接";
}

function compressMessageContent(msg: Message): string {
  switch (msg.type) {
    case 1: // Text
      return msg.message;
    case 3:
      return "[图片]";
    case 34:
      return "[语音]";
    case 42:
      return "[名片]";
    case 43:
      return "[视频]";
    case 47:
      return "[表情]";
    case 48:
      return "[位置]";
    case 49: {
      const title = extractAppMsgTitle(msg.message);
      return `[链接:${title}]`;
    }
    case 50:
      return "[通话]";
    case 10000:
    case 10002:
      return `[系统:${msg.message.substring(0, 30)}]`;
    default:
      return `[${MSG_TYPES[msg.type] || "其他"}]`;
  }
}

export function compressMessages(
  messages: Message[],
  contactName: string
): string {
  if (messages.length === 0) return "(无消息)";

  const lines: string[] = [];
  let prevDay = "";
  let prevSender = "";

  for (const msg of messages) {
    // Skip system messages by default to save tokens
    if (msg.type === 10000 || msg.type === 10002) continue;

    const currentDay = formatDate(msg.createTime);
    const sender = msg.des === 0 ? "我" : contactName;
    const content = compressMessageContent(msg);

    let timeStr: string;
    if (currentDay !== prevDay) {
      timeStr = formatTime(msg.createTime);
      prevDay = currentDay;
      prevSender = ""; // Reset sender on new day
    } else {
      timeStr = formatTimeShort(msg.createTime);
    }

    if (sender === prevSender) {
      lines.push(`[${timeStr}] ${content}`);
    } else {
      lines.push(`[${timeStr}] ${sender}: ${content}`);
      prevSender = sender;
    }
  }

  return lines.join("\n");
}

export function formatContactList(
  contacts: Contact[],
  page: number,
  pageSize: number,
  totalContacts: number
): string {
  const lines: string[] = [];
  const startIdx = (page - 1) * pageSize;
  const totalPages = Math.ceil(totalContacts / pageSize);

  lines.push(`联系人列表 (${totalContacts}人, 第${page}/${totalPages}页)`);
  lines.push("─".repeat(50));

  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    const idx = startIdx + i + 1;
    const displayName = c.remark || c.nickName || c.userName;
    const remarkTag = c.remark && c.nickName && c.remark !== c.nickName ? ` (${c.nickName})` : "";
    const typeTag = c.userName.includes("@chatroom")
      ? " [群]"
      : c.userName.startsWith("gh_")
        ? " [公]"
        : "";

    let lastActive = "";
    if (c.lastMessageTime > 0) {
      lastActive = ` 最近:${formatDate(c.lastMessageTime)}`;
    }

    lines.push(`${idx}. ${displayName}${remarkTag}${typeTag} [${c.messageCount}条]${lastActive}`);
  }

  if (totalPages > 1) {
    lines.push("─".repeat(50));
    lines.push(`翻页: page=${page + 1}`);
  }

  return lines.join("\n");
}

export function formatChatSummary(summary: ChatSummary): string {
  const c = summary.contact;
  const displayName = c.remark || c.nickName || c.userName;
  const lines: string[] = [];

  lines.push(`=== ${displayName} 聊天摘要 ===`);
  lines.push(`总消息: ${summary.totalMessages} | 我发: ${summary.myMessages} | 对方: ${summary.theirMessages}`);
  lines.push(
    `时间跨度: ${formatDate(summary.firstMessageTime)} ~ ${formatDate(summary.lastMessageTime)}`
  );

  // Type distribution (compact)
  const typeStr = Object.entries(summary.typeDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t, cnt]) => `${MSG_TYPES[Number(t)] || "其他"}:${cnt}`)
    .join(" | ");
  lines.push(`类型: ${typeStr}`);

  // Monthly activity (compact sparkline-style)
  if (summary.monthlyActivity.length > 0) {
    lines.push("");
    lines.push("月度活跃:");
    const maxCount = Math.max(...summary.monthlyActivity.map((m) => m.count));
    for (const m of summary.monthlyActivity) {
      const bar = "█".repeat(Math.max(1, Math.round((m.count / maxCount) * 20)));
      lines.push(`  ${m.month} ${bar} ${m.count}`);
    }
  }

  // Recent messages preview
  if (summary.recentMessages.length > 0) {
    lines.push("");
    lines.push("最近消息预览:");
    lines.push(compressMessages(summary.recentMessages, displayName));
  }

  return lines.join("\n");
}

export function formatSearchResults(
  results: Array<{ contact: Contact; messages: Message[] }>
): string {
  if (results.length === 0) return "未找到匹配消息";

  const lines: string[] = [];
  let totalHits = 0;

  for (const { contact, messages } of results) {
    const displayName = contact.remark || contact.nickName || contact.userName;
    totalHits += messages.length;
    lines.push(`── ${displayName} (${messages.length}条匹配) ──`);
    lines.push(compressMessages(messages, displayName));
    lines.push("");
  }

  lines.unshift(`搜索结果: ${results.length}个联系人, ${totalHits}条匹配`);
  return lines.join("\n");
}

export function formatStats(
  contacts: Contact[],
  contactsWithMessages: Contact[]
): string {
  const totalMessages = contactsWithMessages.reduce((sum, c) => sum + c.messageCount, 0);
  const sorted = [...contactsWithMessages].sort((a, b) => b.messageCount - a.messageCount);
  const groups = contactsWithMessages.filter((c) => c.userName.includes("@chatroom"));
  const persons = contactsWithMessages.filter(
    (c) => !c.userName.includes("@chatroom") && !c.userName.startsWith("gh_")
  );

  const lines: string[] = [];
  lines.push("=== 微信数据统计 ===");
  lines.push(`总联系人: ${contacts.length} | 有聊天: ${contactsWithMessages.length}`);
  lines.push(`总消息: ${totalMessages.toLocaleString()}`);
  lines.push(`个人聊天: ${persons.length} | 群聊: ${groups.length}`);
  lines.push("");
  lines.push("Top 15 聊天排行:");
  for (let i = 0; i < Math.min(15, sorted.length); i++) {
    const c = sorted[i];
    const name = c.remark || c.nickName || c.userName;
    const extra = c.remark && c.nickName && c.remark !== c.nickName ? ` (${c.nickName})` : "";
    const tag = c.userName.includes("@chatroom") ? " [群]" : "";
    lines.push(`  ${i + 1}. ${name}${extra}${tag} - ${c.messageCount.toLocaleString()}条`);
  }

  return lines.join("\n");
}
