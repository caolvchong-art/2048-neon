#!/usr/bin/env bash
# 把「2048 · 霓虹进化」一键部署到 GitHub Pages。
#   ./deploy.sh
#   REPO_NAME=my-2048 ./deploy.sh
#   VISIBILITY=--private ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

REPO_NAME="${REPO_NAME:-2048-neon}"
VISIBILITY="${VISIBILITY:---public}"
COMMIT_MESSAGE="${COMMIT_MESSAGE:-feat: 2048 霓虹进化 —— 能量技能 / 连击 / 万能块 / 冰封块 / 随机事件}"

say()  { printf '\n\033[36m>> %s\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }
warn() { printf '\033[33m   %s\033[0m\n' "$1"; }
die()  { printf '\n\033[31mXX %s\033[0m\n' "$1"; exit 1; }

say "检查环境"
command -v git >/dev/null 2>&1 || die "没有找到 git，请先安装：https://git-scm.com/downloads"
info "$(git --version)"

HAS_GH=false
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then HAS_GH=true; info "gh CLI 已登录"
  else warn "gh 已安装但未登录，请先执行 gh auth login"; fi
else
  warn "未安装 gh CLI，将走手动建仓流程"
fi

say "初始化本地仓库"
[ -d .git ] && info "已存在 .git" || { git init -q; info "已初始化"; }

if git symbolic-ref --short HEAD >/dev/null 2>&1; then
  branch="$(git symbolic-ref --short HEAD)"
else
  branch=main
fi
[ "$branch" = "main" ] || { git checkout -b main >/dev/null 2>&1 || git branch -M main; branch=main; }
info "当前分支：$branch"

[ -n "$(git config user.name || true)" ]  || { git config user.name "${USER:-user}"; warn "未设置 git 用户名，暂用默认值"; }
[ -n "$(git config user.email || true)" ] || { git config user.email "${USER:-user}@users.noreply.github.com"; warn "未设置 git 邮箱，暂用默认值"; }

say "提交改动"
git add -A
if git diff --cached --quiet; then
  info "没有需要提交的新改动"
else
  git commit -q -m "$COMMIT_MESSAGE"
  info "已提交"
fi

if ! git remote get-url origin >/dev/null 2>&1 && [ "$HAS_GH" = false ]; then
  say "下一步：手动创建仓库并推送"
  cat <<EOF

  1) 打开 https://github.com/new ，仓库名填：$REPO_NAME
     不要勾选 "Add a README"

  2) 执行：
     git remote add origin https://github.com/<你的用户名>/$REPO_NAME.git
     git push -u origin main

  3) 仓库 Settings -> Pages：Source 选 "Deploy from a branch"，
     Branch 选 main，目录选 / (root)，Save

  4) 等约一分钟访问 https://<你的用户名>.github.io/$REPO_NAME/

  提示：安装 gh CLI 后重新运行本脚本可全自动完成。
EOF
  exit 0
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  say "创建远程仓库 $REPO_NAME"
  gh repo create "$REPO_NAME" "$VISIBILITY" --source=. --remote=origin --push \
    || die "gh repo create 失败（仓库名可能已被占用）"
else
  say "推送到远程"
  git push -u origin "$branch" || die "git push 失败，请检查凭据与网络"
fi

say "开启 GitHub Pages"
owner="$(gh api user --jq .login 2>/dev/null || echo '<你的用户名>')"
if gh api -X POST "repos/$owner/$REPO_NAME/pages" \
     -f "source[branch]=$branch" -f "source[path]=/" >/dev/null 2>&1; then
  info "Pages 已开启"
else
  warn "自动开启失败，请到 Settings -> Pages 手动设置"
fi

printf '\n\033[32m完成！稍等约一分钟访问：\033[0m\n  https://%s.github.io/%s/\n\n' "$owner" "$REPO_NAME"
