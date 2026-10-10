<#
.SYNOPSIS
    部署前置检查：一次性告诉你「现在能不能把 2048-neon 推到 GitHub」，以及还差什么。

.DESCRIPTION
    检查 6 项：git / gh / 凭据 / git 身份 / hosts 屏蔽 / 网络可达性。
    建议在**你自己的 PowerShell 窗口**里运行（不受 DSH 沙箱限制）：
    在 DSH 里运行时，网络那两项会显示为受限，那是沙箱行为，不代表你机器的真实情况。

.EXAMPLE
    .\check-env.ps1
#>
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot

$script:bad = 0

function Head ($t) { Write-Host "`n$t" -ForegroundColor Cyan }
function Good ($t) { Write-Host "  [OK]   " -ForegroundColor Green  -NoNewline; Write-Host $t }
function Bad  ($t) { Write-Host "  [缺失] " -ForegroundColor Red    -NoNewline; Write-Host $t; $script:bad++ }
function Warn2($t) { Write-Host "  [注意] " -ForegroundColor Yellow -NoNewline; Write-Host $t }
function Note ($t) { Write-Host "         $t" -ForegroundColor DarkGray }

function Test-Port($target, $port, $timeoutMs = 6000) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $ok = $c.ConnectAsync($target, $port).Wait($timeoutMs)
        return ($ok -and $c.Connected)
    } catch { return $false } finally { $c.Close() }
}

function Test-Https($url, $timeoutSec = 12) {
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $r = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec $timeoutSec -UseBasicParsing `
                               -Headers @{ "User-Agent" = "2048-neon-check-env" }
        return @{ ok = $true; code = [int]$r.StatusCode; msg = "" }
    } catch {
        $code = 0
        try { $code = [int]$_.Exception.Response.StatusCode } catch { }
        $first = ($_.Exception.Message -split "`n")[0].Trim()
        return @{ ok = $false; code = $code; msg = $first }
    }
}

Write-Host ""
Write-Host "2048-neon 部署前置检查" -ForegroundColor White
Write-Host ("=" * 46) -ForegroundColor DarkGray

# ---------- 1. 工具 ----------
Head "1. 命令行工具"
$hasGit = $false
if (Get-Command git -ErrorAction SilentlyContinue) {
    $hasGit = $true
    $v = (& git --version 2>&1 | Out-String).Trim()
    Good "git 已安装：$v"
} else {
    Bad "没有找到 git"
    Note "安装：winget install --id Git.Git -e"
    Note "注意：Git for Windows 的安装包全部托管在 github.com 上，"
    Note "      所以 hosts 屏蔽没解除之前，winget 和官网下载都会失败。"
}

if (Get-Command gh -ErrorAction SilentlyContinue) {
    $gv = ((& gh --version 2>&1 | Select-Object -First 1) | Out-String).Trim()
    & gh auth status *> $null
    if ($LASTEXITCODE -eq 0) { Good "gh CLI 已登录（$gv）" }
    else { Warn2 "gh CLI 已安装但未登录 —— 执行 gh auth login 后可全自动建仓" }
} else {
    Warn2 "未安装 gh CLI（可选；装了 deploy.ps1 才能全自动建仓）"
    Note "安装：winget install --id GitHub.cli -e"
}

# ---------- 2. 凭据 ----------
Head "2. GitHub 凭据"
$tokenPath = Join-Path $PSScriptRoot ".github-token"
if ($env:GITHUB_TOKEN -or $env:GH_TOKEN) {
    Good "环境变量里已有 GitHub token"
} elseif (Test-Path $tokenPath) {
    $len = (Get-Content $tokenPath -Raw -ErrorAction SilentlyContinue).Trim().Length
    if ($len -gt 20) { Good ".github-token 文件存在（长度 $len）" }
    else { Bad ".github-token 内容太短，可能不是有效 token" }
} else {
    Warn2 "没有发现 token（只有走 API 部署时才需要）"
    Note ("如需要：把 PAT 写到 " + $tokenPath)
    Note "记得别把它提交进仓库（已在 .gitignore 里忽略）"
}

# ---------- 3. git 身份 ----------
Head "3. git 提交身份"
if (-not $hasGit) {
    Warn2 "跳过（还没装 git）"
} else {
    $name  = (& git config user.name  2>$null | Out-String).Trim()
    $email = (& git config user.email 2>$null | Out-String).Trim()
    if ($name)  { Good "user.name  = $name" }  else { Warn2 "未设置 user.name（deploy.ps1 会临时用 $env:USERNAME）" }
    if ($email) { Good "user.email = $email" } else { Warn2 "未设置 user.email（deploy.ps1 会临时补一个）" }
}

# ---------- 4. hosts 屏蔽 ----------
Head "4. hosts 屏蔽检查"
$hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
$blocked = @()
if (Test-Path $hostsPath) {
    $blocked = @(Get-Content $hostsPath -ErrorAction SilentlyContinue |
                 Where-Object { $_ -match '^\s*127\.0\.0\.1\s+\S*github' })
}
$hostsHijacked = ($blocked.Count -gt 0)
if (-not $hostsHijacked) {
    Good "hosts 文件里没有 GitHub 屏蔽记录"
} else {
    Bad ("hosts 文件里有 " + $blocked.Count + " 条 GitHub 屏蔽记录（指向 127.0.0.1）")
    Note ("例如：" + $blocked[0].Trim())
    Note "这会让 git push / 浏览器 / winget 全部连不上 GitHub。"
    Note ("文件：" + $hostsPath + "（修改需要管理员权限）")
}

# ---------- 5. DNS ----------
Head "5. DNS 解析"
$sysIp = ""
try {
    $sysIp = (Resolve-DnsName github.com -Type A -ErrorAction SilentlyContinue |
              Where-Object { $_.IPAddress } | Select-Object -First 1).IPAddress
} catch { }
if ($sysIp -eq "127.0.0.1") {
    Bad "本机把 github.com 解析到 127.0.0.1（被 hosts 劫持）"
} elseif ($sysIp) {
    Good "github.com -> $sysIp"
} else {
    Bad "无法解析 github.com（DNS 不可用）"
}

$realIp = ""
try {
    $realIp = (Resolve-DnsName api.github.com -Server 223.5.5.5 -Type A -ErrorAction SilentlyContinue |
               Where-Object { $_.IPAddress } | Select-Object -First 1).IPAddress
} catch { }
if ($realIp) { Note "绕过 hosts、用公共 DNS 查到的 api.github.com 真实 IP：$realIp" }
else { Warn2 "公共 DNS（223.5.5.5）查询失败，可能整个网络都不通" }

# ---------- 6. 连通性 ----------
Head "6. 网络可达性"
if ($realIp) {
    # 只用真实 IP 做 TCP 探测：github.com 被劫持到 127.0.0.1 时，探测那个地址毫无意义
    if (Test-Port $realIp 443) { Good "TCP $realIp`:443 可建立连接" }
    else { Warn2 "TCP $realIp`:443 连不上（该 IP 可能被墙或已失效）" }
    Note "TCP 能建连只是弱信号，真正能用的判据是下面的 HTTPS 结果。"
}

$https = Test-Https "https://api.github.com/rate_limit"
if ($https.ok) {
    Good ("HTTPS api.github.com 可用（HTTP " + $https.code + "）")
} else {
    $why = if ($hostsHijacked) { "（hosts 劫持到 127.0.0.1，必然失败）" } else { "" }
    Bad ("HTTPS api.github.com 不可用 " + $why)
    if ($https.msg) { Note $https.msg }
    Note "若你正在 DSH 沙箱内运行本脚本，出网被拦属正常；"
    Note "请在你自己的 PowerShell 窗口里再跑一次以获得真实结论。"
}

# ---------- 结论 ----------
Write-Host ""
Write-Host ("=" * 46) -ForegroundColor DarkGray
if ($script:bad -eq 0) {
    Write-Host "结论：环境就绪，直接运行 .\deploy.ps1 即可。" -ForegroundColor Green
} else {
    Write-Host ("结论：还有 " + $script:bad + " 项硬阻碍，先解决上面标 [缺失] 的再试。") -ForegroundColor Yellow
    if ($hostsHijacked) {
        Write-Host "建议顺序：先解除 hosts 屏蔽（这是根因，连 git 都因此装不上），" -ForegroundColor Yellow
        Write-Host "          再装 git，最后跑 .\deploy.ps1。" -ForegroundColor Yellow
    }
}
Write-Host ""
