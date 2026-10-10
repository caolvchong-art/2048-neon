/* 共享测试骨架：用极简 DOM stub 把 index.html 里的游戏脚本加载进 Node。
   logic.test.js 与 leaderboard.test.js 都用它，避免重复维护一份 stub。 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML_PATH = path.join(__dirname, "..", "index.html");

/* ---------- 极简 DOM ---------- */
function makeEl(tag) {
  const el = {
    tagName: tag, children: [], _text: "", _html: "", className: "", dataset: {},
    hidden: false, parentNode: null, disabled: false, value: "",
    style: {
      _p: {},
      setProperty(k, v) { this._p[k] = v; },
      getPropertyValue(k) { return this._p[k]; }
    },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); return f; },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() {
      if (this.parentNode) {
        const i = this.parentNode.children.indexOf(this);
        if (i >= 0) this.parentNode.children.splice(i, 1);
      }
    },
    addEventListener() {}, removeEventListener() {}, focus() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 480, height: 480 }; },
    get offsetWidth() { return 100; },
    closest() { return null; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; },
    set innerHTML(v) {
      this._html = v; this.children = [];
      if (v.indexOf("face") >= 0) {
        const face = makeEl("div"); face.className = "face";
        const val = makeEl("span"); val.className = "val";
        const badge = makeEl("span"); badge.className = "badge";
        face.children = [val, badge]; val.parentNode = face; badge.parentNode = face;
        this.children = [face]; face.parentNode = this;
      }
    },
    get innerHTML() { return this._html; },
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; }
  };
  return el;
}

const IDS = ["board","layer","gridBg","overlay","toast","banner","score","best","energy","moves",
  "streak","evt","streakBox","skillbar","btnNew","btnHint","btnSize","btnSound","btnHelp","btnTheme",
  "help","helpClose","ovTitle","ovText","ovMain","ovAlt","ovSubmitRow","ovSubmit","bannerTitle","bannerSub",
  "btnBoard","lbPanel","lbSource","lbSizeTabs","lbName","lbSaveName","lbList","lbMsg","lbSubmit","lbClose"];

/**
 * 加载游戏脚本。
 * opts.fetch   自定义 fetch 实现（用于排行榜联网逻辑）
 * opts.storage 预置的 localStorage 内容
 */
function loadGame(opts = {}) {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("在 index.html 里找不到 <script>");
  const code = m[1];

  const els = {};
  IDS.forEach(id => { els[id] = makeEl("div"); });

  const store = Object.assign({}, opts.storage || {});
  const fetchCalls = [];
  let fetchImpl = opts.fetch || (() => Promise.reject(new Error("测试未提供 fetch 实现")));

  const document = {
    readyState: "complete",
    documentElement: makeEl("html"),
    body: makeEl("body"),
    getElementById: id => els[id] || (els[id] = makeEl("div")),
    createElement: makeEl,
    querySelectorAll: () => [],
    addEventListener() {}
  };

  const win = {
    document,
    setTimeout, clearTimeout, setInterval, clearInterval,
    addEventListener() {}, confirm: () => true,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    fetch: (url, init) => { fetchCalls.push({ url, init }); return fetchImpl(url, init); }
  };
  win.window = win;

  const module_ = { exports: {} };
  const ctx = vm.createContext({
    window: win, document, module: module_, console,
    setTimeout, clearTimeout, Math, JSON
  });
  vm.runInContext(code, ctx, { filename: "index.html<script>" });

  return {
    M: module_.exports,
    els, store, fetchCalls,
    setFetch(fn) { fetchImpl = fn; },
    document, win
  };
}

/* 造一个 fetch Response 的仿真对象 */
function fakeResponse(status, body, isJson) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(isJson === false ? JSON.parse(text) : JSON.parse(text)),
    text: () => Promise.resolve(text)
  };
}

module.exports = { loadGame, makeEl, fakeResponse };
