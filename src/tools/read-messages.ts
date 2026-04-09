import type { ContactResolver } from "../contact-resolver.js";
import type { MessageReader } from "../message-reader.js";
import { compressMessages } from "../token-compressor.js";

export function readMessages(
  resolver: ContactResolver,
  reader: MessageReader,
  args: {
    contact: string;
    page?: number;
    page_size?: number;
    date_from?: string;
    date_to?: string;
    keyword?: string;
    type?: string;
  }
) {
  const contact = resolver.findContact(args.contact);
  if (!contact) {
    return `未找到联系人: "${args.contact}"\n提示: 请使用 list_contacts 查看可用联系人`;
  }

  const result = reader.readMessages(contact, {
    page: args.page,
    pageSize: args.page_size,
    dateFrom: args.date_from,
    dateTo: args.date_to,
    keyword: args.keyword,
    type: args.type,
  });

  if (result.messages.length === 0) {
    return `没有找到匹配的消息`;
  }

  const displayName = contact.remark || contact.nickName || contact.userName;
  const header = `与 ${displayName} 的聊天 (${result.total}条, 第${result.page}/${result.totalPages}页)`;
  const body = compressMessages(result.messages, displayName);

  const lines = [header, "─".repeat(40), body];

  if (result.totalPages > result.page) {
    lines.push("─".repeat(40));
    lines.push(`下一页: page=${result.page + 1}`);
  }

  return lines.join("\n");
}
