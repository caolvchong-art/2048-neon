<#
.SYNOPSIS
    把「2048 · 霓虹进化」一键部署到 GitHub Pages。

.DESCRIPTION
    自动完成：git 初始化 -> 提交 -> 创建远程仓库 -> 推送 -> 开启 Pages。
    没装 gh CLI 时会打印手动操作步骤。

.EXAMPLE
    .\deploy.ps1
    .\deploy.ps1 -RepoName my-2048
    .\deploy.ps1 -RepoName my-2048 -Private
#>
[CmdletBinding()]
param(
    [string]$RepoName = "2048-neon",
    [switch]$Private,
    [string]$CommitMessage = "feat: 2048 霓虹进化 —— 能量技能 / 连击 / 万能块 / 冰封块 / 随机事件"
)

# 让中文提示在 Windows PowerShell 5.1 的控制台里正常显示
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Say  ($m) { Write-Host "`n>> $m" -ForegroundColor Cyan }
function Info ($m) { Write-Host "   $m" -ForegroundColor Gray }
function Warn ($m) { Write-Host "   $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "`nXX $m" -ForegroundColor Red; exit 1 }

# 执行原生命令，把输出和退出码存到 $script:NativeOut / $script:NativeCode。
# 原生命令往 stderr 写东西是常态（git 的 hint、push 的进度条），
# 这里必须临时把 ErrorActionPreference 调回 Continue，
# 否则 PowerShell 5.1 会把 stderr 当成终止错误，脚本会中途崩掉。
function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    $eap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $script:NativeOut  = @(& $Exe @Arguments 2>&1)
        $script:NativeCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $eap
    }
}
function Show-Native {
    foreach ($line in $script:NativeOut) { Info ([string]$line) }
}

# ---------- 1. 环境检查 ----------
Say "检查环境"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Die "没有找到 git。请先安装：winget install --id Git.Git -e   或   https://git-scm.com/downloads"
}
Invoke-Native git @("--version")
Info (($script:NativeOut | Out-String).Trim())

$hasGh = $false
if (Get-Command gh -ErrorAction SilentlyContinue) {
    Invoke-Native gh @("auth", "status")
    if ($script:NativeCode -eq 0) {
        $hasGh = $true
        Info "gh CLI 已安装且已登录"
    } else {
        Warn "gh 已安装但未登录，请先执行 gh auth login（本次将走手动建仓流程）"
    }
} else {
    Warn "未安装 gh CLI（本次将走手动建仓流程）"
}

# ---------- 2. 本地仓库 ----------
Say "初始化本地仓库"
if (Test-Path ".git") {
    Info "已存在 .git，跳过初始化"
} else {
    Invoke-Native git @("init")
    if ($script:NativeCode -ne 0) { Show-Native; Die "git init 失败" }
    Info "已初始化"
}

Invoke-Native git @("symbolic-ref", "--short", "HEAD")
$branch = if ($script:NativeCode -eq 0 -and $script:NativeOut.Count) {
    ([string]$script:NativeOut[0]).Trim()
} else { "" }

if ($branch -ne "main") {
    Invoke-Native git @("checkout", "-b", "main")
    if ($script:NativeCode -ne 0) { Invoke-Native git @("branch", "-M", "main") }
    $branch = "main"
}
Info "当前分支：$branch"

Invoke-Native git @("config", "user.name")
if (-not (($script:NativeOut | Out-String).Trim())) {
    Invoke-Native git @("config", "user.name", $env:USERNAME)
    Warn "未设置 git 用户名，暂时使用 '$env:USERNAME'（可用 git config --global user.name 修改）"
}
Invoke-Native git @("config", "user.email")
if (-not (($script:NativeOut | Out-String).Trim())) {
    Invoke-Native git @("config", "user.email", "$env:USERNAME@users.noreply.github.com")
    Warn "未设置 git 邮箱，暂时使用 '$env:USERNAME@users.noreply.github.com'"
}

# ---------- 3. 提交 ----------
Say "提交改动"
Invoke-Native git @("add", "-A")
if ($script:NativeCode -ne 0) { Show-Native; Die "git add 失败" }

Invoke-Native git @("diff", "--cached", "--quiet")
if ($script:NativeCode -eq 0) {
    Info "没有需要提交的新改动"
} else {
    Invoke-Native git @("commit", "-m", $CommitMessage)
    if ($script:NativeCode -ne 0) { Show-Native; Die "git commit 失败" }
    Info "已提交"
}

# ---------- 4. 远程仓库 ----------
Invoke-Native git @("remote", "get-url", "origin")
$hasRemote = ($script:NativeCode -eq 0)

if (-not $hasRemote -and -not $hasGh) {
    Say "下一步：手动创建仓库并推送"
    Write-Host @"

  1) 打开 https://github.com/new
     仓库名填：$RepoName
     不要勾选 "Add a README"（否则会产生冲突）

  2) 回到这里执行：

     git remote add origin https://github.com/<你的用户名>/$RepoName.git
     git push -u origin main

  3) 推送完成后，在仓库 Settings -> Pages 里：
     Source 选择 "Deploy from a branch"
     Branch 选择 main，目录选择 / (root)，然后 Save

  4) 等约一分钟，访问：
     https://<你的用户名>.github.io/$RepoName/

  提示：安装 gh CLI（winget install --id GitHub.cli -e）后重新运行本脚本可全自动完成。
"@ -ForegroundColor White
    exit 0
}

if (-not $hasRemote) {
    Say "创建远程仓库 $RepoName"
    $visibility = if ($Private) { "--private" } else { "--public" }
    Invoke-Native gh @("repo", "create", $RepoName, $visibility, "--source=.", "--remote=origin", "--push")
    if ($script:NativeCode -ne 0) { Show-Native; Die "gh repo create 失败（仓库名可能已被占用，换个 -RepoName 试试）" }
} else {
    Say "推送到远程"
    Invoke-Native git @("push", "-u", "origin", $branch)
    if ($script:NativeCode -ne 0) { Show-Native; Die "git push 失败，请检查凭据与网络" }
}

# ---------- 5. 开启 Pages ----------
Say "开启 GitHub Pages"
Invoke-Native gh @("api", "user", "--jq", ".login")
$owner = if ($script:NativeCode -eq 0 -and $script:NativeOut.Count) {
    ([string]$script:NativeOut[0]).Trim()
} else { "" }
if (-not $owner) { $owner = "<你的用户名>" }

Invoke-Native gh @("api", "-X", "POST", "repos/$owner/$RepoName/pages",
                   "-f", "source[branch]=$branch", "-f", "source[path]=/")

if ($script:NativeCode -eq 0) {
    Info "Pages 已开启"
} else {
    Warn "自动开启 Pages 失败（可能已经开过，或私有仓库需要付费计划）"
    Info "请到 Settings -> Pages 手动选择 Deploy from a branch -> $branch -> / (root)"
}

Write-Host ""
Write-Host "完成！稍等约一分钟，访问：" -ForegroundColor Green
Write-Host "  https://$owner.github.io/$RepoName/" -ForegroundColor Green
Write-Host ""
