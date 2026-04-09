import type { ContactResolver } from "../contact-resolver.js";
import { formatContactList } from "../token-compressor.js";

export function listContacts(
  resolver: ContactResolver,
  args: { page?: number; page_size?: number; filter?: string }
) {
  const page = Math.max(1, args.page || 1);
  const pageSize = Math.min(500, Math.max(1, args.page_size || 100));

  let contacts = resolver.getContactsWithMessages();

  // Filter
  const filter = args.filter || "全部";
  if (filter === "个人") {
    contacts = contacts.filter(
      (c) => !c.userName.includes("@chatroom") && !c.userName.startsWith("gh_")
    );
  } else if (filter === "群聊") {
    contacts = contacts.filter((c) => c.userName.includes("@chatroom"));
  } else if (filter === "公众号") {
    contacts = contacts.filter((c) => c.userName.startsWith("gh_"));
  }

  // Sort by message count descending
  contacts.sort((a, b) => b.messageCount - a.messageCount);

  const totalContacts = contacts.length;
  const start = (page - 1) * pageSize;
  const pageContacts = contacts.slice(start, start + pageSize);

  return formatContactList(pageContacts, page, pageSize, totalContacts);
}
