import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";
import type { BackupInfo } from "./types.js";

const DEFAULT_BACKUP_DIR = join(
  process.env.HOME || "~",
  "Library/Application Support/MobileSync/Backup"
);

function findBackupDirs(basePath: string): string[] {
  if (!existsSync(basePath)) return [];
  return readdirSync(basePath, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => join(basePath, d.name));
}

function isValidBackup(dir: string): boolean {
  return existsSync(join(dir, "Manifest.db")) && existsSync(join(dir, "Info.plist"));
}

interface WeChatUserCandidate {
  userHash: string;
  messageCount: number;
  chatTableCount: number;
}

function countUserMessages(backupDir: string, userHash: string, msgDbPaths: string[]): Omit<WeChatUserCandidate, "userHash"> {
  let messageCount = 0;
  let chatTableCount = 0;

  for (const dbPath of msgDbPaths) {
    let db: Database | null = null;
    try {
      db = new Database(dbPath);
      db.exec("PRAGMA query_only = ON");
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Chat_%' AND name NOT LIKE 'ChatExt2_%'"
        )
        .all() as Array<{ name: string }>;

      chatTableCount += tables.length;
      for (const { name } of tables) {
        try {
          const row = db.query(`SELECT COUNT(*) as cnt FROM [${name}]`).get() as { cnt: number };
          messageCount += row.cnt;
        } catch {}
      }
    } catch {
      // Skip unreadable databases
    } finally {
      db?.close();
    }
  }

  return { messageCount, chatTableCount };
}

function pickWeChatUserHash(
  db: Database,
  backupDir: string,
  userDirs: Array<{ dirName: string }>
): string {
  const override = process.env.WX_USER_HASH?.trim();
  if (override && userDirs.some((d) => d.dirName === override)) {
    return override;
  }

  let bestHash = userDirs[0].dirName;
  let bestScore = -1;

  for (const { dirName } of userDirs) {
    const msgDbRows = db
      .query(
        `SELECT fileID FROM Files
         WHERE domain = 'AppDomain-com.tencent.xin'
           AND relativePath LIKE ?
           AND relativePath NOT LIKE '%.material'
         ORDER BY relativePath`
      )
      .all(`Documents/${dirName}/DB/message_%.sqlite`) as Array<{ fileID: string }>;

    const msgDbPaths = msgDbRows.map((r) => join(backupDir, r.fileID.substring(0, 2), r.fileID));
    const stats = countUserMessages(backupDir, dirName, msgDbPaths);
    const score = stats.messageCount;

    if (score > bestScore) {
      bestScore = score;
      bestHash = dirName;
    }
  }

  return bestHash;
}

function findWeChatData(backupDir: string): BackupInfo | null {
  const manifestPath = join(backupDir, "Manifest.db");
  const db = new Database(manifestPath);
  db.exec("PRAGMA query_only = ON");

  try {
    const domains = db
      .query(
        "SELECT DISTINCT domain FROM Files WHERE domain IN ('AppDomain-com.tencent.xin', 'AppDomainGroup-group.com.tencent.xin')"
      )
      .all() as Array<{ domain: string }>;

    if (domains.length === 0) return null;

    const userDirs = db
      .query(
        `SELECT DISTINCT
          CASE
            WHEN INSTR(SUBSTR(relativePath, LENGTH('Documents/') + 1), '/') > 0
            THEN SUBSTR(relativePath, LENGTH('Documents/') + 1, INSTR(SUBSTR(relativePath, LENGTH('Documents/') + 1), '/') - 1)
            ELSE SUBSTR(relativePath, LENGTH('Documents/') + 1)
          END AS dirName
        FROM Files
        WHERE domain = 'AppDomain-com.tencent.xin'
          AND relativePath LIKE 'Documents/%/DB/MM.sqlite'`
      )
      .all() as Array<{ dirName: string }>;

    if (userDirs.length === 0) return null;

    const userHash = pickWeChatUserHash(db, backupDir, userDirs);

    const resolveFile = (relativePath: string): string => {
      const row = db
        .query(
          "SELECT fileID FROM Files WHERE domain = 'AppDomain-com.tencent.xin' AND relativePath = ?"
        )
        .get(relativePath) as { fileID: string } | null;
      if (!row) throw new Error(`File not found in manifest: ${relativePath}`);
      const hash = row.fileID;
      return join(backupDir, hash.substring(0, 2), hash);
    };

    const contactDbPath = resolveFile(`Documents/${userHash}/DB/WCDB_Contact.sqlite`);
    const mmDbPath = resolveFile(`Documents/${userHash}/DB/MM.sqlite`);

    const msgDbRows = db
      .query(
        `SELECT relativePath, fileID FROM Files
         WHERE domain = 'AppDomain-com.tencent.xin'
           AND relativePath LIKE ?
           AND relativePath NOT LIKE '%.material'
         ORDER BY relativePath`
      )
      .all(`Documents/${userHash}/DB/message_%.sqlite`) as Array<{
      relativePath: string;
      fileID: string;
    }>;

    const messageDbs = msgDbRows.map((r) => join(backupDir, r.fileID.substring(0, 2), r.fileID));

    return {
      path: backupDir,
      deviceId: backupDir.split("/").pop() || "",
      manifestDb: manifestPath,
      wechatUserHash: userHash,
      contactDb: contactDbPath,
      mmDb: mmDbPath,
      messageDbs,
    };
  } finally {
    db.close();
  }
}

export function scanForBackup(customPath?: string): BackupInfo {
  const searchPaths: string[] = [];

  if (customPath) {
    if (isValidBackup(customPath)) {
      searchPaths.push(customPath);
    } else {
      searchPaths.push(...findBackupDirs(customPath));
    }
  }

  searchPaths.push(...findBackupDirs(DEFAULT_BACKUP_DIR));

  const envPath = process.env.WX_BACKUP_PATH;
  if (envPath && isValidBackup(envPath)) {
    searchPaths.unshift(envPath);
  }

  for (const dir of searchPaths) {
    if (!isValidBackup(dir)) continue;
    const info = findWeChatData(dir);
    if (info) return info;
  }

  throw new Error(
    `未找到包含微信数据的 iPhone 备份。\n已搜索路径:\n${searchPaths.join("\n")}\n\n请通过 WX_BACKUP_PATH 环境变量指定备份路径。`
  );
}
