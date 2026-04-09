import type { ContactResolver } from "../contact-resolver.js";
import type { MessageReader } from "../message-reader.js";
import { formatChatSummary } from "../token-compressor.js";

export function getChatSummary(
  resolver: ContactResolver,
  reader: MessageReader,
  args: { contact: string }
) {
  const contact = resolver.findContact(args.contact);
  if (!contact) {
    return `未找到联系人: "${args.contact}"\n提示: 请使用 list_contacts 查看可用联系人`;
  }

  const summary = reader.getChatSummary(contact);
  if (!summary) {
    const name = contact.remark || contact.nickName || contact.userName;
    return `联系人 "${name}" 没有聊天记录`;
  }

  return formatChatSummary(summary);
}
