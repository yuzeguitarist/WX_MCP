import type { Database } from "bun:sqlite";
import type { Message, ChatSummary, Contact } from "./types.js";

interface MessageRow {
  MesLocalID: number;
  CreateTime: number;
  Des: number;
  Type: number;
  Message: string | Uint8Array | null;
}

function safeString(val: string | Uint8Array | null): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  try {
    return new TextDecoder().decode(val);
  } catch {
    return "";
  }
}

function findChatTable(
  messageDbs: Database[],
  chatTableHash: string
): { db: Database; tableName: string; dbIndex: number } | null {
  const tableName = `Chat_${chatTableHash}`;
  for (let i = 0; i < messageDbs.length; i++) {
    try {
      const check = messageDbs[i]
        .query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(tableName) as { name: string } | null;
      if (check) return { db: messageDbs[i], tableName, dbIndex: i };
    } catch {}
  }
  return null;
}

export class MessageReader {
  private messageDbs: Database[];

  constructor(messageDbs: Database[]) {
    this.messageDbs = messageDbs;
  }

  readMessages(
    contact: Contact,
    options: {
      page?: number;
      pageSize?: number;
      dateFrom?: string;
      dateTo?: string;
      keyword?: string;
      type?: string;
    } = {}
  ): {
    messages: Message[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(200, Math.max(1, options.pageSize || 50));
    const offset = (page - 1) * pageSize;

    const found = findChatTable(this.messageDbs, contact.chatTableHash);
    if (!found) return { messages: [], total: 0, page, pageSize, totalPages: 0 };

    const { db, tableName, dbIndex } = found;
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.dateFrom) {
      const ts = Math.floor(new Date(options.dateFrom).getTime() / 1000);
      conditions.push("CreateTime >= ?");
      params.push(ts);
    }
    if (options.dateTo) {
      const ts = Math.floor(new Date(options.dateTo + "T23:59:59").getTime() / 1000);
      conditions.push("CreateTime <= ?");
      params.push(ts);
    }
    if (options.keyword) {
      conditions.push("Message LIKE ?");
      params.push(`%${options.keyword}%`);
    }
    if (options.type && options.type !== "all") {
      const typeMap: Record<string, number[]> = {
        text: [1],
        image: [3],
        voice: [34],
        video: [43],
        emoji: [47],
        link: [49],
        location: [48],
        call: [50],
        card: [42],
      };
      const types = typeMap[options.type];
      if (types) {
        conditions.push(`Type IN (${types.join(",")})`);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRow = db
      .query(`SELECT COUNT(*) as cnt FROM [${tableName}] ${where}`)
      .get(...params) as { cnt: number };
    const total = countRow.cnt;

    const rows = db
      .query(
        `SELECT MesLocalID, CreateTime, Des, Type, Message FROM [${tableName}] ${where} ORDER BY CreateTime ASC LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, offset) as MessageRow[];

    const messages: Message[] = rows.map((r) => ({
      localId: r.MesLocalID,
      createTime: r.CreateTime,
      des: r.Des,
      type: r.Type,
      message: safeString(r.Message),
      dbIndex,
    }));

    return { messages, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  getChatSummary(contact: Contact): ChatSummary | null {
    const found = findChatTable(this.messageDbs, contact.chatTableHash);
    if (!found) return null;

    const { db, tableName } = found;

    const stats = db
      .query(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN Des = 0 THEN 1 ELSE 0 END) as myMsgs,
          SUM(CASE WHEN Des = 1 THEN 1 ELSE 0 END) as theirMsgs,
          MIN(CreateTime) as firstTime,
          MAX(CreateTime) as lastTime
        FROM [${tableName}]`
      )
      .get() as {
      total: number;
      myMsgs: number;
      theirMsgs: number;
      firstTime: number;
      lastTime: number;
    };

    const typeRows = db
      .query(`SELECT Type, COUNT(*) as cnt FROM [${tableName}] GROUP BY Type ORDER BY cnt DESC`)
      .all() as Array<{ Type: number; cnt: number }>;

    const typeDistribution: Record<string, number> = {};
    for (const r of typeRows) {
      typeDistribution[String(r.Type)] = r.cnt;
    }

    const monthRows = db
      .query(
        `SELECT
          strftime('%Y-%m', CreateTime, 'unixepoch', 'localtime') as month,
          COUNT(*) as cnt
        FROM [${tableName}]
        GROUP BY month
        ORDER BY month`
      )
      .all() as Array<{ month: string; cnt: number }>;

    const monthlyActivity = monthRows.map((r) => ({ month: r.month, count: r.cnt }));

    const recentRows = db
      .query(
        `SELECT MesLocalID, CreateTime, Des, Type, Message
         FROM [${tableName}]
         ORDER BY CreateTime DESC LIMIT 10`
      )
      .all() as MessageRow[];

    const recentMessages: Message[] = recentRows.reverse().map((r) => ({
      localId: r.MesLocalID,
      createTime: r.CreateTime,
      des: r.Des,
      type: r.Type,
      message: safeString(r.Message),
      dbIndex: 0,
    }));

    return {
      contact,
      totalMessages: stats.total,
      myMessages: stats.myMsgs,
      theirMessages: stats.theirMsgs,
      firstMessageTime: stats.firstTime,
      lastMessageTime: stats.lastTime,
      typeDistribution,
      monthlyActivity,
      recentMessages,
    };
  }

  searchGlobal(
    keyword: string,
    contacts: Map<string, Contact>,
    limit: number = 50
  ): Array<{ contact: Contact; messages: Message[] }> {
    const results: Array<{ contact: Contact; messages: Message[] }> = [];
    let remaining = limit;

    for (const db of this.messageDbs) {
      if (remaining <= 0) break;

      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Chat_%' AND name NOT LIKE 'ChatExt2_%'"
        )
        .all() as Array<{ name: string }>;

      for (const { name } of tables) {
        if (remaining <= 0) break;
        const hash = name.replace("Chat_", "");

        let matchedContact: Contact | null = null;
        for (const c of contacts.values()) {
          if (c.chatTableHash === hash) {
            matchedContact = c;
            break;
          }
        }
        if (!matchedContact) continue;

        try {
          const rows = db
            .query(
              `SELECT MesLocalID, CreateTime, Des, Type, Message
               FROM [${name}]
               WHERE Message LIKE ? AND Type = 1
               ORDER BY CreateTime DESC
               LIMIT ?`
            )
            .all(`%${keyword}%`, Math.min(remaining, 5)) as MessageRow[];

          if (rows.length > 0) {
            results.push({
              contact: matchedContact,
              messages: rows.map((r) => ({
                localId: r.MesLocalID,
                createTime: r.CreateTime,
                des: r.Des,
                type: r.Type,
                message: safeString(r.Message),
                dbIndex: 0,
              })),
            });
            remaining -= rows.length;
          }
        } catch {}
      }
    }

    return results;
  }
}
