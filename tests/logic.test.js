/* 无头测试：验证 2048 核心游戏逻辑（DOM 骨架见 harness.js） */
const { loadGame } = require("./harness.js");
const { M } = loadGame();

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function setBoard(cells, n) {
  M.newGame(n || 4);
  M.tiles.length = 0;
  M.rebuildGrid();
  for (const [r, c, v, t] of cells) M.addTile(r, c, v, t);
  M.rebuildGrid();
  M._setBusy(false);
  M.energy = 0;
}
function at(v) { // 找值为 v 的存活方块
  return M.tiles.filter(t => t.value === v && !t.dead);
}
function invariant(tag) {
  const g = M.grid;
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) {
    const t = g[r][c];
    if (t && (t.r !== r || t.c !== c)) return tag + " grid 失配 @" + r + "," + c;
  }
  for (const t of M.tiles) {
    if (t.dead) continue;
    if (!g[t.r] || g[t.r][t.c] !== t) return tag + " 方块不在 grid 里 id=" + t.id;
  }
  const seen = new Set();
  for (const t of M.tiles) { if (seen.has(t.id)) return tag + " id 重复"; seen.add(t.id); }
  if (M.score < 0) return tag + " 分数为负";
  if (M.energy < 0) return tag + " 能量为负";
  return null;
}

(async function run() {
  console.log("\n=== 1. 基础合并 ===");
  setBoard([[0, 0, 2], [0, 1, 2], [3, 3, 8]]);
  M.move("left"); await sleep(180);
  ok("2+2=4 落在最左", M.grid[0][0] && M.grid[0][0].value === 4, M.grid[0].map(t => t && t.value));
  ok("得分 > 0", M.score > 0, M.score);
  ok("能量 > 0", M.energy > 0, M.energy);
  ok("不变量", !invariant("合并后"), invariant("合并后"));

  console.log("\n=== 2. 一条线两次合并 / 连击 ===");
  setBoard([[0, 0, 2], [0, 1, 2], [0, 2, 4], [0, 3, 4]]);
  M.move("left"); await sleep(180);
  const row0 = M.grid[0].map(t => t && t.value);
  ok("左滑得到 [4,8]", row0[0] === 4 && row0[1] === 8, row0);
  ok("连击使分数翻倍（>= 24）", M.score >= 24, M.score);

  console.log("\n=== 3. 万能块 ✦ ===");
  setBoard([[0, 0, 64], [0, 1, 0, "wild"]]);
  M.move("left"); await sleep(180);
  ok("✦ + 64 = 128", M.grid[0][0] && M.grid[0][0].value === 128, M.grid[0].map(t => t && t.value));
  ok("合并后不再是万能块", M.grid[0][0].type === "normal", M.grid[0][0].type);

  setBoard([[0, 0, 0, "wild"], [0, 1, 0, "wild"]]);
  M.move("left"); await sleep(180);
  ok("✦ + ✦ = 4", M.grid[0][0] && M.grid[0][0].value === 4, M.grid[0].map(t => t && t.value));

  console.log("\n=== 4. 冰封块当墙 ===");
  setBoard([[0, 0, 2], [0, 1, 0, "frozen"], [0, 2, 2], [0, 3, 2]]);
  M.grid[0][1].thaw = 3;
  M.move("left"); await sleep(180);
  ok("冰块不动，仍是 frozen", M.grid[0][1] && M.grid[0][1].type === "frozen", M.grid[0].map(t => t && t.type));
  ok("左侧 2 仍在 0,0（被墙挡住）", M.grid[0][0] && M.grid[0][0].value === 2, M.grid[0].map(t => t && t.value));
  ok("右侧 2+2 在冰块后面合并成 4", M.grid[0][2] && M.grid[0][2].value === 4, M.grid[0].map(t => t && t.value));

  console.log("\n=== 5. 冰块解冻（相邻 3 次合并）===");
  // 冰块在 (0,1) 堵路，(1,1)+(2,1) 上滑后正好在 (1,1) 合并 → 紧贴冰块
  setBoard([[0, 1, 8, "frozen"], [1, 1, 4], [2, 1, 4]]);
  M.grid[0][1].thaw = 2;
  M.move("up"); await sleep(180);
  let ice = M.tiles.find(t => t.type === "frozen");
  ok("合并点在 (1,1) 且值为 8", M.grid[1][1] && M.grid[1][1].value === 8, M.grid[1][1] && M.grid[1][1].value);
  ok("相邻合并使 thaw 2 → 1", ice && ice.thaw === 1, ice ? ice.thaw : "已解冻");

  setBoard([[0, 1, 8, "frozen"], [1, 1, 4], [2, 1, 4]]);
  M.grid[0][1].thaw = 1;
  M.move("up"); await sleep(180);
  ice = M.tiles.find(t => t.type === "frozen");
  ok("thaw 归零时解冻成普通块", !ice, ice ? ice.thaw : "已解冻");
  ok("解冻后保留原数值", M.grid[0][1] && M.grid[0][1].type === "normal" && M.grid[0][1].value === 8,
     M.grid[0][1] && M.grid[0][1].value);

  console.log("\n=== 6. 无效移动不消耗步数 ===");
  setBoard([[0, 0, 2], [0, 1, 4]]);   // 已经贴左边且无法合并
  const mv0 = M.moves, sc0 = M.score;
  M.move("left"); await sleep(180);
  ok("左滑无变化 → 步数不变", M.moves === mv0, { before: mv0, after: M.moves });
  ok("左滑无变化 → 分数不变", M.score === sc0, { sc0, now: M.score });

  console.log("\n=== 7. 技能：强化 / 爆破 / 重排 / 回溯 ===");
  setBoard([[0, 0, 4], [1, 1, 8]]);
  M.energy = 100;
  M.doBoost(M.grid[0][0]);
  ok("强化 4 → 8", M.grid[0][0].value === 8, M.grid[0][0].value);
  ok("能量扣 30", M.energy === 70, M.energy);
  M.doBomb(M.grid[1][1]);
  ok("爆破移除方块", M.grid[1][1] === null, M.grid[1][1]);
  ok("能量扣 45", M.energy === 25, M.energy);
  const before = M.grid[0][0].value;
  M.doShuffle();
  ok("重排后场上仍有 8", at(8).length >= 1);
  ok("重排扣除 35 能量后不足则拒绝", M.energy === 25, M.energy);
  ok("不变量", !invariant("技能后"), invariant("技能后"));

  console.log("\n=== 8. 回溯 ===");
  setBoard([[0, 0, 2], [0, 1, 2]]);
  M.energy = 100;
  M.move("left"); await sleep(180);
  const sAfter = M.score, mAfter = M.moves;
  ok("滑动后分数上升", sAfter > 0);
  M.doUndo(); await sleep(30);
  ok("回溯后步数还原", M.moves === mAfter - 1, { mAfter, now: M.moves });
  ok("回溯后分数还原为 0", M.score === 0, M.score);
  ok("回溯后 2 回来了", at(2).length === 2, at(2).map(t => t.value));
  ok("回溯收取 15 能量（且不退步数所得）", M.energy === 85, M.energy);

  console.log("\n=== 9. 随机事件 ===");
  M.newGame(4); M._setBusy(false);
  for (let i = 0; i < 40; i++) {
    M.triggerEvent();
    const err = invariant("事件 " + i);
    if (err) { ok("事件不变量", false, err); break; }
  }
  ok("连续 40 次事件无异常", true);
  ok("事件不变量", !invariant("事件后"), invariant("事件后"));

  console.log("\n=== 10. 5×5 棋盘 ===");
  M.newGame(5); M._setBusy(false);
  ok("5×5 初始 2 块", M.tiles.length === 2, M.tiles.length);
  M.move("left"); await sleep(180);
  ok("5×5 可以移动", !invariant("5x5"), invariant("5x5"));

  console.log("\n=== 11. 随机长对局压力测试 ===");
  for (const size of [4, 5]) {
    M.newGame(size); M._setBusy(false);
    const dirs = ["up", "down", "left", "right"];
    let err = null, applied = 0, games = 1;
    for (let i = 0; i < 800 && !err; i++) {
      if (!M.isPlayable()) { M.newGame(size); M._setBusy(false); games++; continue; }
      const before = M.moves;
      M.move(dirs[Math.floor(Math.random() * 4)]);
      await sleep(0);
      M._setBusy(false);           // 跳过动画等待
      if (M.moves !== before) applied++;
      if (i % 50 === 0) {
        if (Math.random() < 0.4) M.triggerEvent();
        if (Math.random() < 0.3) M.energy = 100;
        if (Math.random() < 0.3) M.doUndo();
        if (Math.random() < 0.2 && M.tiles.length) M.doBoost(M.tiles[Math.floor(Math.random() * M.tiles.length)]);
        if (Math.random() < 0.2 && M.tiles.length) M.doBomb(M.tiles[Math.floor(Math.random() * M.tiles.length)]);
        if (Math.random() < 0.2) M.doShuffle();
        M._setBusy(false);
      }
      const t = M.tiles.filter(x => !x.dead).length;
      if (t > size * size) { err = "方块数超过格子数: " + t; break; }
      if (M.energy < 0) { err = "能量为负: " + M.energy; break; }
      err = invariant("size" + size + " 第" + i + "步");
    }
    ok(size + "×" + size + " 800 步随机对局（含 " + applied + " 次有效移动 / " + games + " 局）",
       !err && applied > 150, err || ("有效移动仅 " + applied));
    if (err) break;
  }

  console.log("\n=== 12. 提示算法 ===");
  M.newGame(4); M._setBusy(false);
  M.move("left");
  await sleep(180); M._setBusy(false);
  let hintErr = null;
  try { M.hint(); } catch (e) { hintErr = e.message; }
  ok("hint() 不抛异常", !hintErr, hintErr);

  console.log("\n=== 结果 ===");
  console.log("  通过 " + pass + " / 失败 " + fail);
  process.exit(fail ? 1 : 0);
})();
