/* 静态检查：JS 引用的 DOM id 必须在 HTML 中真实存在；顺带检查 CSS 大括号平衡 */
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];

let fail = 0;
function ok(name, cond, extra) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + name + (!cond && extra !== undefined ? "  -> " + JSON.stringify(extra) : ""));
  if (!cond) fail++;
}

/* HTML 中定义的 id */
const defined = new Set();
for (const m of html.matchAll(/\sid="([^"]+)"/g)) defined.add(m[1]);

/* JS 中引用的 id：$("x") 和 getElementById("x") */
const used = new Set();
for (const m of script.matchAll(/\$\("([^"]+)"\)/g)) used.add(m[1]);
for (const m of script.matchAll(/getElementById\("([^"]+)"\)/g)) used.add(m[1]);
for (const m of script.matchAll(/querySelector(?:All)?\("([^"]+)"\)/g)) {
  if (m[1].startsWith("#")) used.add(m[1].slice(1));
}

const missing = [...used].filter(id => !defined.has(id));
ok("JS 引用的 id 全部存在于 HTML 中", missing.length === 0, missing);

const unused = [...defined].filter(id => !used.has(id));
console.log("  INFO  定义但 JS 未引用的 id: " + (unused.length ? unused.join(", ") : "无"));

/* CSS 括号平衡 */
const open = (style.match(/{/g) || []).length;
const close = (style.match(/}/g) || []).length;
ok("CSS 大括号平衡 (" + open + "/" + close + ")", open === close);

/* 变量的 setProperty / var() 一致性 */
const cssVars = new Set([...style.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]));
const jsVars = new Set([...script.matchAll(/setProperty\("(--[a-z0-9-]+)"/g)].map(m => m[1]));
const rootVars = new Set([...style.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const undef = [...cssVars].filter(v => !rootVars.has(v) && !jsVars.has(v));
ok("CSS 使用的自定义属性都有来源", undef.length === 0, undef);
console.log("  INFO  CSS var: " + [...cssVars].join(" "));
console.log("  INFO  JS 设置: " + [...jsVars].join(" "));

/* 标签平衡（粗略） */
for (const tag of ["div", "span", "button", "script", "style", "ul", "p", "h1", "h2", "h3"]) {
  const o = (html.match(new RegExp("<" + tag + "[\\s>]", "g")) || []).length;
  const c = (html.match(new RegExp("</" + tag + ">", "g")) || []).length;
  if (o !== c) ok("<" + tag + "> 标签配对", false, { open: o, close: c });
}
ok("<div>/<span>/<button> 等标签配对检查完成", true);

/* 输出的 HTML 不应包含未转义的 </script> */
ok("script 内无非法 </script>", (script.match(/<\/script>/g) || []).length === 0);

console.log(fail ? "\n静态检查失败 " + fail + " 项" : "\n静态检查全部通过");
process.exit(fail ? 1 : 0);
