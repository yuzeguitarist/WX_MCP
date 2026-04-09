import { Database } from "bun:sqlite";
import type { BackupInfo } from "./types.js";

function openReadOnly(path: string): Database {
  const db = new Database(path);
  db.exec("PRAGMA query_only = ON");
  return db;
}

export class DbReader {
  private backupInfo: BackupInfo;
  private contactDb: Database;
  private mmDb: Database;
  private messageDbs: Database[];

  constructor(info: BackupInfo) {
    this.backupInfo = info;
    this.contactDb = openReadOnly(info.contactDb);
    this.mmDb = openReadOnly(info.mmDb);
    this.messageDbs = info.messageDbs.map((p) => openReadOnly(p));
  }

  getContactDb(): Database {
    return this.contactDb;
  }

  getMmDb(): Database {
    return this.mmDb;
  }

  getMessageDbs(): Database[] {
    return this.messageDbs;
  }

  getBackupInfo(): BackupInfo {
    return this.backupInfo;
  }

  close(): void {
    this.contactDb.close();
    this.mmDb.close();
    this.messageDbs.forEach((db) => db.close());
  }
}
