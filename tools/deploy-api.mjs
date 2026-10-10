#!/usr/bin/env node
/**
 * 用 GitHub REST API 把本仓库部署到 GitHub Pages —— 不需要 gh CLI。
 *
 * 做法：
 *   1. 用公共 DNS 解析 api.github.com（绕开 hosts 黑洞与运营商投毒 IP）
 *   2. 用 token 调 GET /user 拿到用户名和 id
 *   3. 仓库不存在就 POST /user/repos 创建
 *   4. 把提交作者改成你的 GitHub 身份，配置 origin
 *   5. 用**临时凭据文件**推送（token 不进命令行、不进 .git/config）
 *   6. POST /repos/{owner}/{repo}/pages 开启 Pages
 *   7. 删除临时凭据文件
 *
 * 用法：
 *   node tools/deploy-api.mjs            正式部署
 *   node tools/deploy-api.mjs --dry-run  只校验 token 与连通性
 *
 * token 来源（按优先级）：
 *   1. 环境变量 GITHUB_TOKEN / GH_TOKEN
 *   2. 仓库根目录的 .github-token 文件（已在 .gitignore 里忽略）
 * 权限：经典 PAT 勾选 repo 即可；fine-grained 需要 Administration + Repository creation
 *      + Contents + Pages 的读写权限，且 Repository access 要选 All repositories。
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import dns from "node:dns";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_FILE = path.join(REPO_DIR, ".github-token");
const CRED_FILE = path.join(REPO_DIR, ".git-credentials-tmp");
const REPO_NAME = process.env.REPO_NAME || "2048-neon";
const DRY_RUN = process.argv.includes("--dry-run");
const GIT = process.env.GIT_BIN || "git";
const HOST = "api.github.com";
const PUBLIC_DNS = ["223.5.5.5", "119.29.29.29", "1.1.1.1"];

let TOKEN = "";
let CANDIDATES = [];   // 候选 IP，按优先级
let cursor = 0;        // 当前使用到第几个

function log(step, msg) { console.log(`\n[${step}] ${msg}`); }
function ok(msg)   { console.log("   ✓ " + msg); }
function info(msg) { console.log("     " + msg); }
function warn(msg) { console.log("   ! " + msg); }
function die(msg)  { console.error("\n✗ " + msg); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- token ---------------- */
function readToken() {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env && env.trim()) return { token: env.trim(), from: "环境变量" };
  if (fs.existsSync(TOKEN_FILE)) {
    const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();   // JS 的 trim 会去掉 BOM
    if (t) return { token: t, from: TOKEN_FILE };
  }
  return null;
}

/* ---------------- DNS ---------------- */
function resolveViaPublicDns(host) {
  return new Promise((resolve) => {
    (function next(i) {
      if (i >= PUBLIC_DNS.length) return resolve([]);
      const res = new dns.Resolver();
      res.setServers([PUBLIC_DNS[i]]);
      res.resolve4(host, (err, addrs) => {
        if (err || !addrs || !addrs.length) return next(i + 1);
        resolve(addrs);
      });
    })(0);
  });
}

function systemLookupAll(host) {
  return new Promise((resolve) => {
    dns.lookup(host, { all: true }, (err, addrs) => {
      resolve(err || !addrs ? [] : addrs.map((a) => a.address));
    });
  });
}

/**
 * 运营商投毒地址：DNS 有时会掺进一些根本不属于 GitHub 网段的地址
 * （实测见过 198.51.44.x/198.51.45.x），连过去只会挂住，直接排除。
 */
function isBogus(ip) {
  return /^127\./.test(ip) || /^169\.254\./.test(ip) || /^0\./.test(ip) ||
         /^198\.51\./.test(ip) || ip === "::1";
}

async function buildCandidates(host) {
  const out = [];
  const push = (ip) => { if (ip && !isBogus(ip) && !out.includes(ip)) out.push(ip); };

  const pub = await resolveViaPublicDns(host);
  pub.forEach(push);
  if (pub.length) info(`公共 DNS 解析到：${pub.join(", ")}`);

  const sys = await systemLookupAll(host);
  const bogus = sys.filter(isBogus);
  sys.forEach(push);
  if (bogus.length) info(`系统 DNS 掺入了 ${bogus.length} 个可疑地址，已排除：${bogus.join(", ")}`);

  return out;
}

function lookupFor(ip) {
  if (!ip) return undefined;
  return (hostname, options, callback) => {
    if (options && options.all) return callback(null, [{ address: ip, family: 4 }]);
    callback(null, ip, 4);
  };
}

/* ---------------- API ---------------- */
function api(method, urlPath, body, ip) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      host: HOST,
      servername: HOST,
      port: 443,
      path: urlPath,
      method,
      lookup: lookupFor(ip),
      headers: {
        "User-Agent": "2048-neon-deploy",
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + TOKEN,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {})
      }
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch { /* 非 JSON */ }
        resolve({ status: res.statusCode, json, raw: data, headers: res.headers });
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("请求超时(15s)")));
    if (payload) req.write(payload);
    req.end();
  });
}

/** 失败自动切换 IP 重试：这个网络环境下 GitHub 的连通性不稳定 */
async function apiRetry(method, urlPath, body, tries = 4) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    const ip = CANDIDATES.length ? CANDIDATES[cursor % CANDIDATES.length] : null;
    try {
      return await api(method, urlPath, body, ip);
    } catch (e) {
      lastErr = e;
      cursor++;                                  // 换下一个候选 IP
      if (i < tries - 1) {
        const wait = Math.min(800 * 2 ** i, 5000);
        warn(`请求失败（${e.message}），${wait}ms 后换 IP 重试 ${i + 2}/${tries}`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

function git(args, opts = {}) {
  return execFileSync(GIT, args, {
    cwd: REPO_DIR,
    stdio: opts.quiet ? "pipe" : "inherit",
    encoding: "utf8",
    // 禁止 git 弹出凭据输入：否则鉴权失败时会一直卡住直到超时
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" }
  });
}

/**
 * 推送前自检：确认凭据助手真的能吐出账号密码。
 * 不打印密码，只报告是否取到。
 */
function credentialHelperWorks(helperArg) {
  try {
    const out = execFileSync(GIT,
      ["-c", "credential.helper=", "-c", `credential.helper=${helperArg}`, "credential", "fill"],
      {
        cwd: REPO_DIR,
        input: "protocol=https\nhost=github.com\n\n",
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      });
    const hasUser = /^username=.+/m.test(out);
    const hasPass = /^password=.+/m.test(out);
    return { ok: hasUser && hasPass, hasUser, hasPass };
  } catch (e) {
    return { ok: false, error: (e.message || "").split("\n")[0] };
  }
}

/* ---------------- 权限诊断 ---------------- */
function explainPermissions(r) {
  const has  = r.headers?.["x-oauth-scopes"];
  const need = r.headers?.["x-accepted-oauth-scopes"];
  const needPerm = r.headers?.["x-accepted-github-permissions"];
  const lines = [];
  if (has !== undefined) lines.push(`  这个 token 实际拥有 : ${has === "" ? "(空，没有任何 scope)" : has}`);
  if (need) lines.push(`  该接口需要         : ${need}`);
  if (needPerm) lines.push(`  细粒度权限需要     : ${needPerm}`);
  return lines.join("\n");
}

/* ---------------- 主流程 ---------------- */
(async function main() {
  console.log("2048-neon → GitHub Pages（API 部署）");
  console.log("=".repeat(46));

  log("1/6", "读取凭据");
  const found = readToken();
  if (!found) {
    die(`没有找到 token。\n` +
        `  请把 GitHub PAT 写到：${TOKEN_FILE}\n` +
        `  或者设置环境变量 GITHUB_TOKEN。`);
  }
  TOKEN = found.token;
  const kind = TOKEN.startsWith("ghp_") ? "经典 PAT" :
               TOKEN.startsWith("github_pat_") ? "fine-grained PAT" : "未知类型";
  ok(`已读取（来源：${found.from}，类型：${kind}，长度 ${TOKEN.length}）`);

  log("2/6", "解析地址与连通性");
  CANDIDATES = await buildCandidates(HOST);
  if (!CANDIDATES.length) die("无法解析 api.github.com，检查网络。");
  info(`候选 IP：${CANDIDATES.join(", ")}`);
  if (process.env.FORCE_IP) {
    CANDIDATES = [process.env.FORCE_IP];
    info(`已按 FORCE_IP 锁定：${process.env.FORCE_IP}`);
  }

  let me;
  try {
    me = await apiRetry("GET", "/user");
  } catch (e) {
    die(`连不上 api.github.com：${e.message}\n` +
        `  如果在 DSH 沙箱里运行，出网会被拦，需要放宽沙箱权限。`);
  }
  if (me.status === 401) die("token 无效、已过期，或已被吊销（401）。");
  if (me.status !== 200) die(`GET /user 返回 ${me.status}：${me.json?.message || me.raw.slice(0, 200)}`);

  const login = me.json.login;
  const uid = me.json.id;
  ok(`已认证为 ${login}（id ${uid}）`);
  const scopeLine = explainPermissions(me);
  if (scopeLine) console.log(scopeLine);

  const repoPath = `/repos/${login}/${REPO_NAME}`;
  let existing = await apiRetry("GET", repoPath);
  let repoExists = existing.status === 200;
  info(repoExists ? `仓库 ${login}/${REPO_NAME} 已存在` : `仓库 ${login}/${REPO_NAME} 不存在`);

  if (DRY_RUN) {
    console.log("\n--dry-run：检查完成，未做任何修改。\n");
    process.exit(0);
  }

  if (!repoExists) {
    log("3/6", `创建仓库 ${login}/${REPO_NAME}`);
    const created = await apiRetry("POST", "/user/repos", {
      name: REPO_NAME,
      private: false,
      has_issues: true,
      has_wiki: false,
      has_projects: false,
      auto_init: false,
      description: "2048 霓虹进化 —— 带能量技能、连击倍率、万能块、冰封块与随机事件的开源 2048"
    });

    if (created.status === 201) {
      ok("仓库已创建：" + created.json.html_url);
      repoExists = true;
    } else {
      // 网络重试可能已经建成功了，先复查一次再判定失败
      const recheck = await apiRetry("GET", repoPath);
      if (recheck.status === 200) {
        ok("仓库已存在（重试期间创建成功）");
        repoExists = true;
      } else {
        const detail = explainPermissions(created);
        die(`创建仓库失败（${created.status}）：${created.json?.message || created.raw.slice(0, 300)}\n` +
            (detail ? detail + "\n" : "") +
            `\n  按类型对症处理：\n` +
            `  · 经典 PAT：编辑 token 并勾上 repo（缺 scope 时 GitHub 会返回 404）\n` +
            `  · fine-grained：Repository access 选 All repositories，并勾上\n` +
            `    Repository creation: Read and write、Administration: Read and write、\n` +
            `    Contents: Read and write、Pages: Read and write\n` +
            `  · 或者先在 https://github.com/new 手动建好空仓库 ${REPO_NAME}（别勾 README），\n` +
            `    再重跑本脚本，这样只需要 Contents: Read and write。`);
      }
    }
  } else {
    log("3/6", `使用已有仓库 ${login}/${REPO_NAME}`);
  }

  log("4/6", "整理本地提交与远程地址");
  const email = `${uid}+${login}@users.noreply.github.com`;
  try {
    git(["config", "user.name", login], { quiet: true });
    git(["config", "user.email", email], { quiet: true });
    git(["commit", "--amend", "--reset-author", "--no-edit"], { quiet: true });
    ok(`提交作者已设为 ${login} <${email}>`);
  } catch (e) {
    info("改写提交作者失败（不影响推送）：" + e.message);
  }

  // 之后如果又改了文件，这里会自动提交，省得再手工跑一遍
  try {
    git(["add", "-A"], { quiet: true });
    let dirty = true;
    try { git(["diff", "--cached", "--quiet"], { quiet: true }); dirty = false; } catch { dirty = true; }
    if (dirty) {
      git(["commit", "-m", process.env.COMMIT_MSG || "chore: 更新内容"], { quiet: true });
      ok("已提交本地新改动");
    }
  } catch (e) {
    info("提交本地新改动失败： " + e.message);
  }

  const remoteUrl = `https://github.com/${login}/${REPO_NAME}.git`;
  try {
    git(["remote", "get-url", "origin"], { quiet: true });
    git(["remote", "set-url", "origin", remoteUrl], { quiet: true });
    ok("origin 已更新：" + remoteUrl);
  } catch {
    git(["remote", "add", "origin", remoteUrl], { quiet: true });
    ok("origin 已添加：" + remoteUrl);
  }

  log("5/6", "推送代码");
  fs.writeFileSync(CRED_FILE, `https://${login}:${TOKEN}@github.com\n`, { mode: 0o600 });

  // 注意：含空格的 helper 值会被 git 当成 shell 命令执行，Windows 反斜杠会被 sh 吞掉
  // （C:\Users\x 变成 C:Usersx），所以路径必须转成正斜杠再加引号。
  const helper = `store --file="${CRED_FILE.replace(/\\/g, "/")}"`;
  const check = credentialHelperWorks(helper);
  if (check.ok) {
    ok("凭据助手自检通过（已取到账号与密码）");
  } else {
    warn(`凭据助手自检未通过：${check.error || JSON.stringify(check)}`);
  }

  try {
    git(["-c", "credential.helper=", "-c", `credential.helper=${helper}`,
         "push", "-u", "origin", "main"]);
    ok("推送成功");
  } catch (e) {
    die(`推送失败。\n` +
        `  · 网络原因：当前 DNS 可能掺了假 IP，可设 FORCE_IP=<真实IP> 后重跑；\n` +
        `    git 用的是系统解析，如果 hosts 加速工具把 github.com 指向 127.0.0.1，\n` +
        `    请先关掉加速工具再重跑。\n` +
        `  · 鉴权原因：token 需要 repo（经典）或 Contents: Read and write（细粒度）。`);
  } finally {
    try { fs.unlinkSync(CRED_FILE); } catch { /* 已删除 */ }
  }

  log("6/6", "开启 GitHub Pages");
  const pages = await apiRetry("POST", `${repoPath}/pages`, { source: { branch: "main", path: "/" } });
  if (pages.status === 201) {
    ok("Pages 已开启，正在构建");
  } else if (pages.status === 409) {
    ok("Pages 之前已经开启过");
  } else {
    info(`自动开启失败（${pages.status}）：${pages.json?.message || ""}`);
    info(`请到 https://github.com/${login}/${REPO_NAME}/settings/pages 手动选择 ` +
         `Deploy from a branch → main → / (root)`);
  }

  console.log("\n" + "=".repeat(46));
  console.log("完成！构建约需一分钟，之后访问：");
  console.log(`  https://${login}.github.io/${REPO_NAME}/`);
  console.log(`仓库：https://github.com/${login}/${REPO_NAME}`);
  console.log("");
})().catch((e) => die(e.stack || e.message));
