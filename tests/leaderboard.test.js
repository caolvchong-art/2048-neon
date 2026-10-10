/* 排行榜专项测试：清洗、效率分、本机榜、Supabase 请求构造、错误处理、XSS 防护 */
const { loadGame, fakeResponse } = require("./harness.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async function run() {

  /* ---------- 1. 昵称清洗 ---------- */
  console.log("\n=== 1. 昵称清洗 lbSanitizeName ===");
  {
    const { M } = loadGame();
    ok("去掉首尾空白", M.lbSanitizeName("  小明  ") === "小明");
    ok("空字符串 → 空", M.lbSanitizeName("") === "");
    ok("纯空白 → 空", M.lbSanitizeName("   \t\n ") === "");
    ok("null → 空", M.lbSanitizeName(null) === "");
    ok("undefined → 空", M.lbSanitizeName(undefined) === "");
    ok("内部换行被压平", M.lbSanitizeName("a\nb\tc") === "a b c");
    ok("控制字符被剔除", M.lbSanitizeName("a\u0000\u0007b") === "a b");
    ok("超长截断到 16", M.lbSanitizeName("一二三四五六七八九十一二三四五六七八").length === 16);
    ok("恰好 16 不截断", M.lbSanitizeName("1234567890123456") === "1234567890123456");
    // 数据库约束是 char_length <= 16（按码点），JS 按 UTF-16 截断，不会超
    const emoji = M.lbSanitizeName("😀".repeat(20));
    ok("emoji 昵称不超过数据库上限", [...emoji].length <= 16, { 码点: [...emoji].length, 串: emoji });
    ok("数字也能当昵称", M.lbSanitizeName(12345) === "12345");
  }

  /* ---------- 2. 效率分 ---------- */
  console.log("\n=== 2. 效率分 lbEfficiency ===");
  {
    const { M } = loadGame();
    ok("1000 分 / 100 步 = 100", M.lbEfficiency(1000, 100) === 100);
    ok("366 分 / 200 步 = 18", M.lbEfficiency(366, 200) === 18);
    ok("0 步 → 0（不产生 Infinity）", M.lbEfficiency(500, 0) === 0);
    ok("步数为负 → 0", M.lbEfficiency(500, -3) === 0);
    ok("分数为 0 → 0", M.lbEfficiency(0, 50) === 0);
    ok("NaN 输入 → 0", M.lbEfficiency(NaN, 10) === 0);
    ok("Infinity 分数 → 0", M.lbEfficiency(Infinity, 10) === 0);
    ok("结果有上限 999999", M.lbEfficiency(1e12, 1) === 999999);
    ok("结果是整数", Number.isInteger(M.lbEfficiency(1234, 77)));
  }

  /* ---------- 3. 本机榜 ---------- */
  console.log("\n=== 3. 本机榜 lbLocalAdd / lbLocalTop ===");
  {
    const { M } = loadGame();
    ok("初始为空", eq(M.lbLocalTop(4), []));
    M.lbLocalAdd({ name: "a", score: 100, skill: 1, size: 4, at: 1 });
    M.lbLocalAdd({ name: "b", score: 900, skill: 2, size: 4, at: 2 });
    M.lbLocalAdd({ name: "c", score: 500, skill: 3, size: 4, at: 3 });
    const top = M.lbLocalTop(4);
    ok("按分数降序", eq(top.map(x => x.score), [900, 500, 100]), top.map(x => x.score));
    ok("只返回前 N 条", M.lbLocalTop(4, 2).length === 2);
    ok("4×4 与 5×5 互不干扰", M.lbLocalTop(5).length === 0);

    M.lbLocalAdd({ name: "d", score: 700, skill: 4, size: 5, at: 4 });
    ok("5×5 独立记录", M.lbLocalTop(5).length === 1);

    for (let i = 0; i < 40; i++) M.lbLocalAdd({ name: "x" + i, score: i, skill: 0, size: 4, at: i });
    ok("本机榜上限 20 条", M.lbLocalAll(4).length === 20, M.lbLocalAll(4).length);
    ok("截断后仍保留最高分", M.lbLocalTop(4)[0].score === 900);
  }

  /* ---------- 4. 全球榜 URL 构造 ---------- */
  console.log("\n=== 4. 全球榜请求 URL ===");
  {
    const { M } = loadGame();
    const u = M.lbGlobalUrl(4);
    ok("指向正确的表", u.indexOf("/rest/v1/" + M._sbTable) >= 0, u);
    ok("按 board_size 过滤", u.indexOf("board_size=eq.4") >= 0);
    ok("按分数降序 + 时间升序", u.indexOf("order=rank_score.desc,created_at.asc") >= 0);
    ok("限制条数", u.indexOf("limit=10") >= 0);
    ok("只取需要的列", u.indexOf("select=player_name,rank_score,skill_points,board_size,created_at") >= 0);
    ok("5×5 参数正确", M.lbGlobalUrl(5).indexOf("board_size=eq.5") >= 0);
    ok("所有 URL 都是 https", u.startsWith("https://"));
    ok("没有把 token/key 写进 URL", u.indexOf("sb_publishable") < 0);
  }

  /* ---------- 5. 鉴权头 ---------- */
  console.log("\n=== 5. 请求头 ===");
  {
    const { M } = loadGame();
    const h = M.lbHeaders({ "Content-Type": "application/json" });
    ok("带 apikey", typeof h["apikey"] === "string" && h["apikey"].length > 10);
    ok("带 Bearer 授权", h["Authorization"] === "Bearer " + h["apikey"]);
    ok("保留了额外头", h["Content-Type"] === "application/json");
    ok("apikey 用的是 publishable key", h["apikey"].startsWith("sb_publishable_"));
    ok("绝不包含 service_role", JSON.stringify(h).indexOf("service_role") < 0);
  }

  /* ---------- 6. 读取全球榜（含错误处理） ---------- */
  console.log("\n=== 6. 读取全球榜 lbLoadGlobal ===");
  {
    const { M, fetchCalls, setFetch } = loadGame();
    setFetch(() => Promise.resolve(fakeResponse(200, [
      { player_name: "甲", rank_score: 900, skill_points: 30, created_at: "2026-10-10T12:00:00Z" },
      { player_name: "乙", rank_score: 300, skill_points: 12, created_at: "2026-10-09T12:00:00Z" }
    ])));
    const rows = await M.lbLoadGlobal(4);
    ok("解析出 2 行", rows.length === 2, rows.length);
    ok("字段映射正确", rows[0].name === "甲" && rows[0].score === 900 && rows[0].skill === 30, rows[0]);
    ok("时间被解析成数字", typeof rows[0].at === "number" && rows[0].at > 0);
    ok("请求带了 GET 方式（无 method 即 GET）", !fetchCalls[0].init || !fetchCalls[0].init.method);
    ok("请求带上了 apikey 头", !!fetchCalls[0].init.headers["apikey"]);

    // 空表
    setFetch(() => Promise.resolve(fakeResponse(200, [])));
    ok("空数组返回空", (await M.lbLoadGlobal(4)).length === 0);

    // 非数组响应（被中间层改成对象）
    setFetch(() => Promise.resolve(fakeResponse(200, { message: "nope" })));
    ok("非数组响应不崩溃", (await M.lbLoadGlobal(4)).length === 0);

    // 字段缺失
    setFetch(() => Promise.resolve(fakeResponse(200, [{}])));
    const messy = await M.lbLoadGlobal(4);
    ok("字段缺失时给出安全的默认值",
       messy[0].name === "" && messy[0].score === 0 && messy[0].skill === 0, messy[0]);

    // 401
    setFetch(() => Promise.resolve(fakeResponse(401, { message: "Invalid API key" })));
    let err1 = null;
    try { await M.lbLoadGlobal(4); } catch (e) { err1 = e.message; }
    ok("401 会抛出可读错误", !!err1 && err1.indexOf("401") >= 0, err1);

    // 项目被暂停（Supabase 免费版闲置会返回 5xx）
    setFetch(() => Promise.resolve(fakeResponse(503, "project paused")));
    let err2 = null;
    try { await M.lbLoadGlobal(4); } catch (e) { err2 = e.message; }
    ok("503 会抛出可读错误", !!err2 && err2.indexOf("503") >= 0, err2);

    // 网络层直接失败
    setFetch(() => Promise.reject(new Error("Failed to fetch")));
    let err3 = null;
    try { await M.lbLoadGlobal(4); } catch (e) { err3 = e.message; }
    ok("断网时抛出错误而不是静默", err3 === "Failed to fetch", err3);
  }

  /* ---------- 7. 提交成绩 ---------- */
  console.log("\n=== 7. 提交成绩 lbSubmitGlobal ===");
  {
    const { M, fetchCalls, setFetch } = loadGame();
    setFetch(() => Promise.resolve(fakeResponse(201, "")));
    await M.lbSubmitGlobal({ name: "小明", score: 1234, skill: 56, size: 5 });
    const call = fetchCalls[0];
    ok("用 POST", call.init.method === "POST");
    ok("打到正确的表端点", call.url === M._sbUrl + "/" + M._sbTable, call.url);
    ok("要求最小返回体", call.init.headers["Prefer"] === "return=minimal");
    const body = JSON.parse(call.init.body);
    ok("字段名映射到现有表结构",
       body.player_name === "小明" && body.rank_score === 1234 &&
       body.skill_points === 56 && body.board_size === 5, body);
    ok("不发送 id / created_at（交给数据库）", !("id" in body) && !("created_at" in body));

    setFetch(() => Promise.resolve(fakeResponse(400, { message: "violates check constraint" })));
    let e1 = null;
    try { await M.lbSubmitGlobal({ name: "x", score: 1, skill: 1, size: 4 }); } catch (e) { e1 = e.message; }
    ok("400 会抛出且带上服务端信息", !!e1 && e1.indexOf("check constraint") >= 0, e1);

    setFetch(() => Promise.resolve(fakeResponse(403, "denied")));
    let e2 = null;
    try { await M.lbSubmitGlobal({ name: "x", score: 1, skill: 1, size: 4 }); } catch (e) { e2 = e.message; }
    ok("403 会抛出", !!e2 && e2.indexOf("403") >= 0, e2);
  }

  /* ---------- 8. XSS 防护 ---------- */
  console.log("\n=== 8. 昵称渲染的 XSS 防护 ===");
  {
    const { M } = loadGame();
    const evil = '<img src=x onerror="alert(1)">';
    const el = M.lbRowEl(1, { name: evil, score: 10, skill: 1 });
    const nameCell = el.children[1];
    ok("昵称用 textContent 写入（不解析 HTML）", nameCell.textContent === evil);
    ok("单元格的 innerHTML 始终为空", nameCell.innerHTML === "", nameCell.innerHTML);
    ok("整行没有未转义的 HTML", el.innerHTML === "");
    const script = M.lbRowEl(2, { name: "<script>alert(1)</script>", score: 1, skill: 1 });
    ok("<script> 同样只当文本", script.children[1].textContent === "<script>alert(1)</script>");
    ok("名次列正常", el.children[0].textContent === "1");
    ok("分数列是字符串", el.children[2].textContent === "10");
  }

  /* ---------- 9. 提交流程 ---------- */
  console.log("\n=== 9. 提交流程 lbSubmit ===");
  {
    // 没有昵称 → 拒绝提交，不发请求
    const a = loadGame({ fetch: () => Promise.resolve(fakeResponse(201, "")) });
    a.M.newGame(4);
    a.M.lbSubmit();
    await new Promise(r => setTimeout(r, 10));
    ok("没昵称时不发请求", a.fetchCalls.length === 0, a.fetchCalls.length);
    ok("并给出提示", a.els.lbMsg.textContent.indexOf("昵称") >= 0, a.els.lbMsg.textContent);

    // 有昵称但分数为 0 → 拒绝
    const b = loadGame({ fetch: () => Promise.resolve(fakeResponse(201, "")) });
    b.M.lbName = "小明";
    b.M.newGame(4);
    b.M.lbSubmit();
    await new Promise(r => setTimeout(r, 10));
    ok("分数为 0 时不发请求", b.fetchCalls.length === 0, b.fetchCalls.length);

    // 正常提交：本机榜 + 全球榜都要记录
    const c = loadGame({ fetch: () => Promise.resolve(fakeResponse(201, "")) });
    c.M.lbName = "小明";
    c.M.newGame(4);
    c.M.tiles.length = 0; c.M.rebuildGrid();
    c.M.addTile(0, 0, 64); c.M.addTile(0, 1, 64); c.M.rebuildGrid();
    c.M.move("left");
    await new Promise(r => setTimeout(r, 200));
    c.M._setBusy(false);
    const sc = c.M.score;
    c.M.lbSubmit();
    await new Promise(r => setTimeout(r, 50));
    ok("提交时发出了 POST", c.fetchCalls.length === 1, c.fetchCalls.length);
    ok("成绩已记入本机榜", c.M.lbLocalTop(4).length === 1, c.M.lbLocalTop(4));
    ok("本机榜分数与当前分数一致", c.M.lbLocalTop(4)[0].score === sc, { lb: c.M.lbLocalTop(4)[0].score, sc });
    ok("本机榜昵称正确", c.M.lbLocalTop(4)[0].name === "小明");
    ok("提示为成功", c.els.lbMsg.textContent.indexOf("已提交") >= 0, c.els.lbMsg.textContent);

    // 提交失败时仍然进本机榜
    const d = loadGame({ fetch: () => Promise.resolve(fakeResponse(503, "paused")) });
    d.M.lbName = "小红";
    d.M.newGame(4);
    d.M.tiles.length = 0; d.M.rebuildGrid();
    d.M.addTile(0, 0, 64); d.M.addTile(0, 1, 64); d.M.rebuildGrid();
    d.M.move("left");
    await new Promise(r => setTimeout(r, 200));
    d.M._setBusy(false);
    d.M.lbSubmit();
    await new Promise(r => setTimeout(r, 50));
    ok("上传失败时成绩仍留在本机榜", d.M.lbLocalTop(4).length === 1, d.M.lbLocalTop(4));
    ok("并提示失败原因", d.els.lbMsg.textContent.indexOf("提交失败") >= 0, d.els.lbMsg.textContent);
  }

  /* ---------- 10. 结束自动记录 ---------- */
  console.log("\n=== 10. 一局结束自动记入本机榜 ===");
  {
    const { M } = loadGame();
    M.lbName = "阿丙";
    M.newGame(4);
    ok("开局时未标记已记录", M.lbRecorded === false);
    M.tiles.length = 0; M.rebuildGrid();
    M.addTile(0, 0, 64); M.addTile(0, 1, 64); M.rebuildGrid();
    M.move("left");
    await new Promise(r => setTimeout(r, 200));
    M._setBusy(false);
    M.lbRecordLocal();
    ok("记录后标记为已记录", M.lbRecorded === true);
    ok("本机榜多了一条", M.lbLocalTop(4).length === 1);
    ok("名字来自已保存的昵称", M.lbLocalTop(4)[0].name === "阿丙");
    M.newGame(4);
    ok("重开一局后标记被重置", M.lbRecorded === false);
  }

  console.log("\n=== 结果 ===");
  console.log("  通过 " + pass + " / 失败 " + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试自身抛异常:", e); process.exit(1); });
