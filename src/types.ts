export interface BackupInfo {
  path: string;
  deviceId: string;
  manifestDb: string;
  wechatUserHash: string;
  contactDb: string;
  mmDb: string;
  messageDbs: string[];
}

export interface Contact {
  userName: string;
  nickName: string;
  remark: string;
  alias: string;
  type: number;
  chatTableHash: string;
  messageCount: number;
  lastMessageTime: number;
}

export interface Message {
  localId: number;
  createTime: number;
  des: number; // 0=我发的, 1=对方发的
  type: number;
  message: string;
  dbIndex: number;
}

export interface ChatSummary {
  contact: Contact;
  totalMessages: number;
  myMessages: number;
  theirMessages: number;
  firstMessageTime: number;
  lastMessageTime: number;
  typeDistribution: Record<string, number>;
  monthlyActivity: Array<{ month: string; count: number }>;
  recentMessages: Message[];
}

export const MSG_TYPES: Record<number, string> = {
  1: "文本",
  3: "图片",
  34: "语音",
  42: "名片",
  43: "视频",
  47: "表情",
  48: "位置",
  49: "链接",
  50: "通话",
  64: "群通知",
  10000: "系统",
  10002: "撤回",
};
