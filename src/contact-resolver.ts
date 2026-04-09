import { createHash } from "crypto";
import type { Database } from "bun:sqlite";
import type { Contact } from "./types.js";

interface RawContact {
  userName: string;
  type: number;
  dbContactRemark: Uint8Array | null;
}

function decodeRemarkProtobuf(blob: Uint8Array | null): {
  nickName: string;
  remark: string;
  alias: string;
} {
  const result = { nickName: "", remark: "", alias: "" };
  if (!blob || blob.length < 3) return result;

  let i = 0;
  while (i < blob.length) {
    if (i >= blob.length) break;
    const tag = blob[i];
    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;
    i++;

    if (wireType === 2) {
      if (i >= blob.length) break;
      let length = 0;
      let shift = 0;
      while (i < blob.length) {
        const b = blob[i];
        length |= (b & 0x7f) << shift;
        i++;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      const value = blob.subarray(i, i + length);
      try {
        const str = new TextDecoder().decode(value);
        if (fieldNum === 1) result.nickName = str;
        else if (fieldNum === 2) result.remark = str;
        else if (fieldNum === 6) result.alias = str;
      } catch {}
      i += length;
    } else if (wireType === 0) {
      while (i < blob.length && blob[i] & 0x80) i++;
      i++;
    } else {
      break;
    }
  }
  return result;
}

export class ContactResolver {
  private contacts: Map<string, Contact> = new Map();
  private hashToUserName: Map<string, string> = new Map();
  private nameIndex: Map<string, string[]> = new Map();

  constructor(contactDb: Database, messageDbs: Database[]) {
    this.loadContacts(contactDb);
    this.countMessages(messageDbs);
  }

  private loadContacts(db: Database): void {
    const rows = db
      .query("SELECT userName, type, dbContactRemark FROM Friend")
      .all() as RawContact[];

    for (const row of rows) {
      const decoded = decodeRemarkProtobuf(row.dbContactRemark);
      const hash = createHash("md5").update(row.userName).digest("hex");

      const contact: Contact = {
        userName: row.userName,
        nickName: decoded.nickName,
        remark: decoded.remark,
        alias: decoded.alias,
        type: row.type,
        chatTableHash: hash,
        messageCount: 0,
        lastMessageTime: 0,
      };

      this.contacts.set(row.userName, contact);
      this.hashToUserName.set(hash, row.userName);

      const names = [decoded.nickName, decoded.remark, decoded.alias, row.userName].filter(Boolean);
      for (const name of names) {
        const key = name.toLowerCase();
        const existing = this.nameIndex.get(key) || [];
        existing.push(row.userName);
        this.nameIndex.set(key, existing);
      }
    }
  }

  private countMessages(messageDbs: Database[]): void {
    for (const db of messageDbs) {
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Chat_%' AND name NOT LIKE 'ChatExt2_%'"
        )
        .all() as Array<{ name: string }>;

      for (const { name } of tables) {
        const hash = name.replace("Chat_", "");
        const userName = this.hashToUserName.get(hash);
        if (!userName) continue;

        const contact = this.contacts.get(userName);
        if (!contact) continue;

        try {
          const row = db
            .query(`SELECT COUNT(*) as cnt, MAX(CreateTime) as lastTime FROM [${name}]`)
            .get() as { cnt: number; lastTime: number | null };
          contact.messageCount += row.cnt;
          if (row.lastTime && row.lastTime > contact.lastMessageTime) {
            contact.lastMessageTime = row.lastTime;
          }
        } catch {}
      }
    }
  }

  getContact(userName: string): Contact | undefined {
    return this.contacts.get(userName);
  }

  getAllContacts(): Contact[] {
    return Array.from(this.contacts.values());
  }

  getContactsWithMessages(): Contact[] {
    return Array.from(this.contacts.values()).filter((c) => c.messageCount > 0);
  }

  findContact(query: string): Contact | null {
    const exact = this.contacts.get(query);
    if (exact) return exact;

    const lowerQuery = query.toLowerCase();
    const exactNames = this.nameIndex.get(lowerQuery);
    if (exactNames?.length) {
      const c = this.contacts.get(exactNames[0]);
      if (c) return c;
    }

    let best: Contact | null = null;
    let bestScore = 0;

    for (const contact of this.contacts.values()) {
      const fields = [contact.nickName, contact.remark, contact.alias, contact.userName];
      for (const field of fields) {
        if (!field) continue;
        const lowerField = field.toLowerCase();
        if (lowerField === lowerQuery) return contact;
        if (lowerField.includes(lowerQuery)) {
          const score = lowerQuery.length / lowerField.length;
          if (score > bestScore) {
            bestScore = score;
            best = contact;
          }
        }
      }
    }
    return best;
  }

  searchContacts(query: string): Contact[] {
    const lowerQuery = query.toLowerCase();
    const results: Contact[] = [];
    for (const contact of this.contacts.values()) {
      const fields = [contact.nickName, contact.remark, contact.alias, contact.userName];
      for (const field of fields) {
        if (field && field.toLowerCase().includes(lowerQuery)) {
          results.push(contact);
          break;
        }
      }
    }
    return results;
  }
}
