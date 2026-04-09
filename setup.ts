#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";
import { scanForBackup } from "./src/backup-scanner.js";

const HOME = process.env.HOME || "~";
const PROJECT_DIR = resolve(import.meta.dirname || ".");
const ENTRY_POINT = join(PROJECT_DIR, "src/index.ts");

// ─── Helpers ─────────────────────────────────────
function print(msg: string) {
  console.log(msg);
}

function printHeader(msg: string) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  ${msg}`);
  console.log(`${"=".repeat(50)}`);
}

function prompt(question: string): string {
  process.stdout.write(question);
  const buf = Buffer.alloc(1024);
  const fd = require("fs").openSync("/dev/stdin", "rs");
  const n = require("fs").readSync(fd, buf, 0, 1024, null);
  require("fs").closeSync(fd);
  return buf.toString("utf-8", 0, n).trim();
}

function selectFolder(): string | null {
  try {
    const result = execSync(
      `osascript -e 'set chosenFolder to choose folder with prompt "选择 iPhone 备份目录"' -e 'POSIX path of chosenFolder'`,
      { encoding: "utf-8", timeout: 60000 }
    ).trim();
    return result;
  } catch {
    return null;
  }
}

// ─── Step 1: Find backup ─────────────────────────
printHeader("wx-memory 配置向导");
print("");

let backupPath = process.argv[2] || process.env.WX_BACKUP_PATH || "";
let backupInfo;

print("[*] 正在扫描 iPhone 备份...");
try {
  backupInfo = scanForBackup(backupPath || undefined);
  print(`[+] 找到备份: ${backupInfo.path}`);
  print(`    设备ID:     ${backupInfo.deviceId}`);
  print(`    微信用户:   ${backupInfo.wechatUserHash}`);
  print(`    消息数据库: ${backupInfo.messageDbs.length} 个`);
} catch (err: any) {
  print("[!] 自动扫描未找到备份");
  print("");
  print("    即将弹出文件选择窗口，请手动选择备份目录...");
  const selected = selectFolder();
  if (!selected) {
    print("[x] 未选择目录，退出");
    process.exit(1);
  }
  try {
    backupInfo = scanForBackup(selected);
    backupPath = backupInfo.path;
    print(`[+] 找到备份: ${backupInfo.path}`);
  } catch (e: any) {
    print(`[x] 选择的目录中未找到微信备份: ${e.message}`);
    process.exit(1);
  }
}

const finalBackupPath = backupInfo.path;

// ─── Step 2: Choose AI tools ─────────────────────
printHeader("配置 AI 工具");
print("");
print("支持的工具:");
print("  1. Cursor");
print("  2. Claude Code");
print("  3. Codex (OpenAI)");
print("  4. Droid (Factory)");
print("  5. 全部配置");
print("  6. 仅显示配置 (手动复制)");
print("");

const choice = prompt("选择要配置的工具 (1-6, 默认5): ") || "5";

interface ToolConfig {
  name: string;
  configPath: string;
  configure: () => void;
}

const mcpConfig = {
  command: "bun",
  args: ["run", ENTRY_POINT],
  env: { WX_BACKUP_PATH: finalBackupPath },
};

const tools: ToolConfig[] = [
  {
    name: "Cursor",
    configPath: join(HOME, ".cursor/mcp.json"),
    configure() {
      const configPath = this.configPath;
      let config: any = {};
      if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, "utf-8"));
      }
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers["wx-memory"] = mcpConfig;
      mkdirSync(join(HOME, ".cursor"), { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      print(`    [+] 已写入: ${configPath}`);
    },
  },
  {
    name: "Claude Code",
    configPath: join(HOME, ".claude/settings.json"),
    configure() {
      const configPath = this.configPath;
      let config: any = {};
      if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, "utf-8"));
      }
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers["wx-memory"] = mcpConfig;
      mkdirSync(join(HOME, ".claude"), { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      print(`    [+] 已写入: ${configPath}`);
    },
  },
  {
    name: "Codex",
    configPath: join(HOME, ".codex/config.toml"),
    configure() {
      const configPath = this.configPath;
      if (!existsSync(configPath)) {
        print(`    [!] 配置文件不存在: ${configPath}`);
        print(`    请手动添加以下内容:`);
        print("");
        printCodexToml();
        return;
      }
      let content = readFileSync(configPath, "utf-8");
      content = content.replace(/\[mcp_servers\.wx-memory\][\s\S]*?(?=\n\[|$)/, "");
      const tomlBlock = buildCodexToml();
      content = content.trimEnd() + "\n\n" + tomlBlock + "\n";
      writeFileSync(configPath, content);
      print(`    [+] 已写入: ${configPath}`);
    },
  },
  {
    name: "Droid (Factory)",
    configPath: "",
    configure() {
      print(`    请运行以下命令配置 Droid:`);
      print("");
      print(`    droid mcp add wx-memory --command "bun" --args "run,${ENTRY_POINT}" --env "WX_BACKUP_PATH=${finalBackupPath}" --type stdio`);
    },
  },
];

function buildCodexToml(): string {
  return `[mcp_servers.wx-memory]
type = "stdio"
command = "bun"
args = ["run", "${ENTRY_POINT}"]

[mcp_servers.wx-memory.env]
WX_BACKUP_PATH = "${finalBackupPath}"`;
}

function printCodexToml() {
  print(buildCodexToml());
}

function printJsonConfig() {
  print(JSON.stringify({ "wx-memory": mcpConfig }, null, 2));
}

const selected = choice.split(",").map((s) => s.trim());

if (selected.includes("6")) {
  printHeader("手动配置");
  print("");
  print("-- JSON 格式 (Cursor / Claude Code / OpenCode) --");
  printJsonConfig();
  print("");
  print("-- TOML 格式 (Codex) --");
  printCodexToml();
} else {
  const indices = selected.includes("5")
    ? [0, 1, 2, 3]
    : selected.map((s) => parseInt(s) - 1).filter((i) => i >= 0 && i < tools.length);

  for (const i of indices) {
    print(`\n  配置 ${tools[i].name}...`);
    try {
      tools[i].configure();
    } catch (err: any) {
      print(`    [x] 失败: ${err.message}`);
    }
  }
}

// ─── Done ────────────────────────────────────────
printHeader("配置完成");
print("");
print("MCP 服务器将在 AI 工具调用时自动启动 (stdio 模式)。");
print("无需手动启动，无需保持后台运行。");
print("");
print(`备份路径: ${finalBackupPath}`);
print(`入口文件: ${ENTRY_POINT}`);
print("");
print("如需重新配置，运行:");
print(`  cd ${PROJECT_DIR} && bun run setup.ts`);
