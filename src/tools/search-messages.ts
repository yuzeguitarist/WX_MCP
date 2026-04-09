import type { ContactResolver } from "../contact-resolver.js";
import type { MessageReader } from "../message-reader.js";
import { formatSearchResults } from "../token-compressor.js";

export function searchMessages(
  resolver: ContactResolver,
  reader: MessageReader,
  args: { keyword: string; limit?: number }
) {
  if (!args.keyword || args.keyword.trim().length === 0) {
    return "请提供搜索关键词";
  }

  const contactMap = new Map(
    resolver.getAllContacts().map((c) => [c.userName, c])
  );

  const results = reader.searchGlobal(
    args.keyword,
    contactMap,
    Math.min(args.limit || 50, 100)
  );

  return formatSearchResults(results);
}
