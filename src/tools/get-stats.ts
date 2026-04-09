import type { ContactResolver } from "../contact-resolver.js";
import { formatStats } from "../token-compressor.js";

export function getStats(resolver: ContactResolver) {
  return formatStats(resolver.getAllContacts(), resolver.getContactsWithMessages());
}
