#!/usr/bin/env bash
set -e

INSTALL_DIR="$HOME/.wx-memory"
REPO="https://github.com/yuzeguitarist/WX_MCP.git"

# ─── Colors ───────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

print_step() { echo -e "${CYAN}[*]${RESET} $1"; }
print_ok()   { echo -e "${GREEN}[+]${RESET} $1"; }
print_warn() { echo -e "${YELLOW}[!]${RESET} $1"; }
print_err()  { echo -e "${RED}[-]${RESET} $1"; }

echo ""
echo -e "${BOLD}  wx-memory -- WeChat Memory MCP Server${RESET}"
echo -e "  让 AI 读取你的微信聊天记录"
echo "  ──────────────────────────────────────"
echo ""

# ─── Check Bun ────────────────────────────────────
if ! command -v bun &>/dev/null; then
  print_warn "未检测到 Bun 运行时，正在安装..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! command -v bun &>/dev/null; then
    print_err "Bun 安装失败，请手动安装: https://bun.sh"
    exit 1
  fi
  print_ok "Bun $(bun --version) 已安装"
else
  print_ok "Bun $(bun --version) 已就绪"
fi

# ─── Clone / Update ──────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  print_step "检测到已有安装，正在更新..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || true
else
  if [ -d "$INSTALL_DIR" ]; then
    print_warn "目录 $INSTALL_DIR 已存在但不是 git 仓库，备份后重新克隆"
    mv "$INSTALL_DIR" "${INSTALL_DIR}.bak.$(date +%s)"
  fi
  print_step "正在克隆到 $INSTALL_DIR ..."
  git clone --depth 1 "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ─── Install dependencies ────────────────────────
print_step "安装依赖..."
bun install --no-progress 2>/dev/null

print_ok "安装完成"
echo ""

# ─── Run setup wizard ────────────────────────────
print_step "启动配置向导..."
echo ""
bun run setup.ts </dev/tty
