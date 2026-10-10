/*
 * 生成用于截图预览的「预置棋局」页面。
 *   node tests/make-preview.js          仅生成 _visual-*.html
 *   node tests/make-preview.js --shot   顺便调用本机 Edge/Chrome 截图到 docs/
 *
 * 原理：把 index.html 里 boot() 的 newGame(4) 换成一段预置棋局代码，
 *       这样能一次看到全部数值配色 + 万能块 ✦ + 冰封块 ❄ 的真实渲染。
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repo = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(repo, "index.html"), "utf8");

const needle = "  initDom();\n  bindInput();\n  bindLeaderboard();\n  newGame(4);";
if (src.indexOf(needle) < 0) {
  console.error("找不到 boot() 注入点，index.html 改动过？");
  process.exit(1);
}

const seed = `  initDom();
  bindInput();
  newGame(4);
  /* === 预置棋局（仅用于截图预览）=== */
  tiles.length = 0;
  elMap.forEach(function(e){ e.remove(); });
  elMap.clear();
  rebuildGrid();
  [[0,0,2],[0,1,4],[0,2,8],[0,3,16],
   [1,0,32],[1,1,64],[1,2,128],[1,3,256],
   [2,0,512],[2,1,1024],[2,2,2048],[2,3,4096],
   [3,0,8],[3,1,16]].forEach(function(p){ addTile(p[0], p[1], p[2], "normal"); });
  addTile(3, 2, 0, "wild");
  var fz = addTile(3, 3, 64, "frozen"); fz.thaw = 2;
  score = 128460; energy = 95; moves = 372; streak = 4; eventCountdown = 6;
  syncDOM(); updateHUD();`;

const boardPage = src.replace(needle, seed);
const helpPage = src.replace(needle, seed + "\n  $('help').hidden = false;");

const boardFile = path.join(repo, "_visual-board.html");
const helpFile = path.join(repo, "_visual-help.html");
fs.writeFileSync(boardFile, boardPage);
/* 排行榜面板预览：预置本机榜数据（不联网，避免截图依赖 Supabase） */
const lbSeed = seed + `
  /* === 预置排行榜数据（仅截图用）=== */
  lbNameSet("霓虹玩家");
  [["霓虹玩家",128460,3450,372],["夜行者",98230,2810,401],["小明",76400,2210,346],
   ["卡密",61250,1980,298],["阿丙",45120,1520,297],["tester",33800,1204,281],
   ["无名玩家",21400,860,249],["新手上路",9800,410,180]].forEach(function(d, i){
    lbLocalAdd({ name: d[0], score: d[1], skill: d[2], tile: 2048, moves: d[3], size: 4, at: Date.now() - i * 3600000 });
  });
  lbOpen();`;
const lbFile = path.join(repo, "_visual-lb.html");
fs.writeFileSync(lbFile, src.replace(needle, lbSeed));

fs.writeFileSync(helpFile, helpPage);
console.log("已生成 _visual-board.html、_visual-help.html 和 _visual-lb.html");

if (!process.argv.includes("--shot")) {
  console.log("\n手动截图示例：");
  console.log('  msedge --headless=new --disable-gpu --window-size=560,1180 --hide-scrollbars \\');
  console.log('         --screenshot=docs/preview-board.png _visual-board.html');
  process.exit(0);
}

/* ---- 自动截图（尽力而为，失败不影响主流程）---- */
const candidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].filter(Boolean);

const browser = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
if (!browser) {
  console.warn("\n没找到 Edge/Chrome，跳过自动截图。请手动执行上面的命令。");
  process.exit(0);
}

const shots = [
  [boardFile, path.join(repo, "docs", "preview-board.png"), "560,1180"],
  [helpFile, path.join(repo, "docs", "preview-help.png"), "560,1250"],
  [lbFile, path.join(repo, "docs", "preview-leaderboard.png"), "560,920"]
];
for (const [page, out, size] of shots) {
  try {
    execFileSync(browser, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--hide-scrollbars", "--virtual-time-budget=2500",
      "--user-data-dir=" + path.join(repo, "_browser-profile"),
      "--window-size=" + size,
      "--screenshot=" + out,
      "file:///" + page.replace(/\\/g, "/")
    ], { stdio: "ignore" });
    console.log("已截图 " + path.relative(repo, out));
  } catch (e) {
    console.warn("截图失败（" + path.relative(repo, out) + "）：" + e.message);
  }
}
fs.rmSync(path.join(repo, "_browser-profile"), { recursive: true, force: true });
