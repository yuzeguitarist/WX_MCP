# wx-memory

WeChat Memory MCP Server -- 让 AI 读取你的微信聊天记录。

通过 MCP (Model Context Protocol) 将 iPhone 备份中的微信数据暴露给 AI 工具，
使 AI 能够搜索、浏览和理解你的聊天历史，成为你的「数字记忆」助手。

支持 Cursor / Claude Code / Codex / Droid 等所有兼容 MCP 的 AI 工具。

---

## 安装

一行命令，自动完成所有配置：

```bash
curl -fsSL https://raw.githubusercontent.com/yuzeguitarist/WX_MCP/main/install.sh | bash
```

安装脚本会依次完成：

1. 检测并安装 Bun 运行时（如果尚未安装）
2. 克隆项目到 `~/.wx-memory`
3. 安装依赖
4. 启动配置向导：自动扫描 iPhone 备份 -> 选择要对接的 AI 工具 -> 写入配置

无需手动启动服务。配置完成后，AI 工具调用时会自动拉起 MCP 进程。

---

## 前置条件

- macOS（当前仅支持 macOS 上的 iTunes/Finder iPhone 备份）
- 一份**未加密**的 iPhone 本地备份（通过 Finder 或 iTunes 备份到 Mac）

备份方法：iPhone 连接 Mac -> 打开 Finder -> 选择设备 -> 勾选「将备份存储到这台 Mac」 -> 取消「加密本地备份」-> 点击「立即备份」。

---

## 工具列表

安装后 AI 可调用以下 5 个工具：

| 工具 | 用途 | Token 消耗 |
|------|------|-----------|
| `get_stats` | 备份整体统计：联系人数、消息总量、Top 15 排行 | 极低 (~300) |
| `list_contacts` | 联系人列表，按消息数排序，支持分页和过滤 | 低 (~500) |
| `get_chat_summary` | 单个联系人的聊天摘要：月度活跃、类型分布、最近预览 | 低 (~2K) |
| `read_messages` | 读取具体聊天内容，支持时间/关键词/类型过滤 + 分页 | 按需 |
| `search_messages` | 跨所有联系人的全局关键词搜索 | 按需 |

### 设计原则：省 Token

所有输出均经过压缩，AI 不需要一次性加载所有聊天记录：

```
传统格式 (浪费):
{"sender":"张三","time":"2024-01-15T10:30:00","type":"text","content":"下午开会吗"}
{"sender":"我","time":"2024-01-15T10:31:00","type":"text","content":"对，3点"}

wx-memory 格式 (压缩):
[01/15 10:30] 张三: 下午开会吗
[10:31] 我: 对，3点
```

- 同一天内省略重复日期
- 连续同一发送者省略名字
- 非文本消息用标记代替：`[图片]` `[语音]` `[视频]` `[链接:标题]`
- 系统消息和撤回消息默认跳过
- XML 格式的应用消息只提取标题

推荐的调用顺序：`get_stats` -> `list_contacts` -> `get_chat_summary` -> `read_messages`，逐层深入，按需加载。

---

## 手动安装

如果不想用一键脚本，也可以手动安装：

```bash
git clone https://github.com/yuzeguitarist/WX_MCP.git ~/.wx-memory
cd ~/.wx-memory
bun install
bun run setup.ts
```

---

## 手动配置

如果不想用配置向导，可以手动将以下内容添加到对应工具的配置文件中。

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "wx-memory": {
      "command": "bun",
      "args": ["run", "~/.wx-memory/src/index.ts"],
      "env": {
        "WX_BACKUP_PATH": "/path/to/your/backup"
      }
    }
  }
}
```

### Claude Code (`~/.claude/settings.json`)

同上格式，添加到 `mcpServers` 字段中。

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.wx-memory]
type = "stdio"
command = "bun"
args = ["run", "~/.wx-memory/src/index.ts"]

[mcp_servers.wx-memory.env]
WX_BACKUP_PATH = "/path/to/your/backup"
```

将 `/path/to/your/backup` 替换为实际的 iPhone 备份路径，例如：
`~/Library/Application Support/MobileSync/Backup/00008150-XXXX`

---

## 数据安全

- 所有数据库以 `PRAGMA query_only = ON` 模式打开，不会修改任何备份数据
- MCP 运行在本地 stdio 模式，数据不经过网络
- 不收集、不上传任何用户数据

---

## 技术细节

- 运行时：Bun（内置 SQLite，零原生依赖）
- 传输协议：MCP stdio（AI 工具调用时自动拉起，退出时自动关闭）
- 运行时依赖：仅 `@modelcontextprotocol/sdk`
- 联系人解析：解码 WCDB_Contact.sqlite 中的 protobuf 格式 `dbContactRemark` 字段
- 消息定位：通过 `MD5(userName)` 映射到 `Chat_{hash}` 表，跨 4 个分片数据库查找

---

## 许可

MIT
