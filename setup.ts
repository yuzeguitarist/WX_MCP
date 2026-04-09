#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";
import { scanForBackup } from "./src/backup-scanner.js";
import * as readline from "readline";

const HOME = process.env.HOME || "~";
const PROJECT_DIR = resolve(import.meta.dirname || ".");
const ENTRY_POINT = join(PROJECT_DIR, "src/index.ts");

// ─── Colors ──────────────────────────────────────
const C = {
  red: "\x1b[0;31m",
  green: "\x1b[0;32m",
  yellow: "\x1b[0;33m",
  cyan: "\x1b[0;36m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

function print(msg: string) {
  console.log(msg);
}

function printOk(msg: string) {
  console.log(`${C.green}[+]${C.reset} ${msg}`);
}

function printInfo(msg: string) {
  console.log(`${C.cyan}[*]${C.reset} ${msg}`);
}

function printWarn(msg: string) {
  console.log(`${C.yellow}[!]${C.reset} ${msg}`);
}

function printErr(msg: string) {
  console.log(`${C.red}[x]${C.reset} ${msg}`);
}

function printHeader(msg: string) {
  const line = "=".repeat(50);
  console.log(`\n${C.bold}${line}${C.reset}`);
  console.log(`${C.bold}  ${msg}${C.reset}`);
  console.log(`${C.bold}${line}${C.reset}`);
}

// ─── Async prompt using readline ─────────────────
function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
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

// ─── TOML helpers ────────────────────────────────
function removeTomlSection(content: string, sectionPrefix: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      // Check if this section header matches the prefix we want to remove
      const sectionName = trimmed.replace(/^\[+/, "").replace(/\]+$/, "");
      if (sectionName === sectionPrefix || sectionName.startsWith(sectionPrefix + ".")) {
        skipping = true;
        continue;
      } else {
        skipping = false;
      }
    }
    if (!skipping) {
      result.push(line);
    }
  }

  // Clean up excess blank lines
  return result.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ─── Main (async) ────────────────────────────────
async function main() {
  // ─── Step 1: Find backup ─────────────────────
  printHeader("wx-memory 配置向导");
  print("");

  let backupPath = process.argv[2] || process.env.WX_BACKUP_PATH || "";
  let backupInfo;

  printInfo("正在扫描 iPhone 备份...");
  try {
    backupInfo = scanForBackup(backupPath || undefined);
    printOk(`找到备份: ${backupInfo.path}`);
    print(`    设备ID:     ${backupInfo.deviceId}`);
    print(`    微信用户:   ${backupInfo.wechatUserHash}`);
    print(`    消息数据库: ${backupInfo.messageDbs.length} 个`);
  } catch (err: any) {
    printWarn("自动扫描未找到备份");
    print("");
    print("    即将弹出文件选择窗口，请手动选择备份目录...");
    const selected = selectFolder();
    if (!selected) {
      printErr("未选择目录，退出");
      process.exit(1);
    }
    try {
      backupInfo = scanForBackup(selected);
      backupPath = backupInfo.path;
      printOk(`找到备份: ${backupInfo.path}`);
    } catch (e: any) {
      printErr(`选择的目录中未找到微信备份: ${e.message}`);
      process.exit(1);
    }
  }

  const finalBackupPath = backupInfo.path;

  // ─── Step 2: Choose AI tools ─────────────────
  printHeader("配置 AI 工具");
  print("");
  print("  支持的工具:");
  print(`  ${C.bold}1.${C.reset} Cursor`);
  print(`  ${C.bold}2.${C.reset} Claude Code`);
  print(`  ${C.bold}3.${C.reset} Codex (OpenAI)`);
  print(`  ${C.bold}4.${C.reset} Droid (Factory)`);
  print(`  ${C.bold}5.${C.reset} 全部配置`);
  print(`  ${C.bold}6.${C.reset} 仅显示配置 (手动复制)`);
  print("");

  const choice = (await askQuestion(`  选择要配置的工具 (1-6, 默认5): `)) || "5";

  const mcpConfig = {
    command: "bun",
    args: ["run", ENTRY_POINT],
    env: { WX_BACKUP_PATH: finalBackupPath },
  };

  interface ToolConfig {
    name: string;
    configure: () => void;
  }

  function buildCodexToml(): string {
    return `[mcp_servers.wx-memory]
type = "stdio"
command = "bun"
args = ["run", "${ENTRY_POINT}"]

[mcp_servers.wx-memory.env]
WX_BACKUP_PATH = "${finalBackupPath}"`;
  }

  const tools: ToolConfig[] = [
    {
      name: "Cursor",
      configure() {
        const configPath = join(HOME, ".cursor/mcp.json");
        let config: any = {};
        if (existsSync(configPath)) {
          config = JSON.parse(readFileSync(configPath, "utf-8"));
        }
        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers["wx-memory"] = mcpConfig;
        mkdirSync(join(HOME, ".cursor"), { recursive: true });
        writeFileSync(configPath, JSON.stringify(config, null, 2));
        printOk(`已写入: ${configPath}`);
      },
    },
    {
      name: "Claude Code",
      configure() {
        const configPath = join(HOME, ".claude/settings.json");
        let config: any = {};
        if (existsSync(configPath)) {
          config = JSON.parse(readFileSync(configPath, "utf-8"));
        }
        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers["wx-memory"] = mcpConfig;
        mkdirSync(join(HOME, ".claude"), { recursive: true });
        writeFileSync(configPath, JSON.stringify(config, null, 2));
        printOk(`已写入: ${configPath}`);
      },
    },
    {
      name: "Codex",
      configure() {
        const configPath = join(HOME, ".codex/config.toml");
        if (!existsSync(configPath)) {
          printWarn(`配置文件不存在: ${configPath}`);
          print("    请手动添加以下内容:");
          print("");
          print(buildCodexToml());
          return;
        }
        let content = readFileSync(configPath, "utf-8");
        // Remove ALL existing wx-memory sections (main + sub-tables like .env)
        content = removeTomlSection(content, "mcp_servers.wx-memory");
        // Append fresh config
        content = content.trimEnd() + "\n\n" + buildCodexToml() + "\n";
        writeFileSync(configPath, content);
        printOk(`已写入: ${configPath}`);
      },
    },
    {
      name: "Droid (Factory)",
      configure() {
        print("    请运行以下命令配置 Droid:");
        print("");
        print(
          `    droid mcp add wx-memory --command "bun" --args "run,${ENTRY_POINT}" --env "WX_BACKUP_PATH=${finalBackupPath}" --type stdio`
        );
      },
    },
  ];

  const selected = choice.split(",").map((s) => s.trim());

  if (selected.includes("6")) {
    printHeader("手动配置");
    print("");
    print("-- JSON 格式 (Cursor / Claude Code / OpenCode) --");
    print(JSON.stringify({ "wx-memory": mcpConfig }, null, 2));
    print("");
    print("-- TOML 格式 (Codex) --");
    print(buildCodexToml());
  } else {
    const indices = selected.includes("5")
      ? [0, 1, 2, 3]
      : selected.map((s) => parseInt(s) - 1).filter((i) => i >= 0 && i < tools.length);

    for (const i of indices) {
      print("");
      printInfo(`配置 ${tools[i].name}...`);
      try {
        tools[i].configure();
      } catch (err: any) {
        printErr(`失败: ${err.message}`);
      }
    }
  }

  // ─── Done ──────────────────────────────────────
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
}

main().catch((err) => {
  printErr(err.message);
  process.exit(1);
});
