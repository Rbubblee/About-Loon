// ============================================================
// charge_debug_page.js  v1.0（银河接口调试页，验证数据链路）
//
// 用法：Loon MITM 勾选 h5-recharge.geely.com 后，用浏览器打开
//   https://h5-recharge.geely.com/debug-galaxy
// 页面会把 api-recharge.geely.com 的设备类接口逐个请求一遍并把响应展示出来，
// 用于确认「改道/签名/token」这条链路能返回合理的银河数据。
//
// 为什么挂在 h5-recharge.geely.com 下：
//   银河网关对携带 Origin 的浏览器请求一律 403。页面通过 charge_gw_relay.js
//   的同源代理访问：API_HOST 实际是 h5-recharge.geely.com/recharge-gw，
//   Loon 在 http-request 阶段改写为 api-recharge.geely.com（无 Origin），
//   响应按同源返回，浏览器不需要任何 CORS 头。
//
// token：从 persistentStore 读取 galaxyRechargeToken/galaxyUserId 注入页面；
// 过期或想换号时，页面里可以手动粘贴 token（存 localStorage）。
// ============================================================

var NOTIFY = String(($argument || [])[0]) !== "false";

function buildHtml(token, userId, expiresText, expired) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>银河充电桩数据调试页</title>
<style>
body{font-family:-apple-system,system-ui,sans-serif;background:#0f1420;color:#e6e9f0;margin:0;padding:16px}
h1{font-size:18px;margin:4px 0 10px}
.meta{font-size:12px;color:#9aa4b8;margin:6px 0}
.badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:12px;margin-left:6px}
.ok{background:#1d5c3a;color:#7ee2a8}
.warn{background:#6b4d12;color:#f5d78e}
.err{background:#6b1f2a;color:#ff9aa8}
input{width:100%;box-sizing:border-box;padding:8px;border:1px solid #2a3550;border-radius:8px;background:#161d2e;color:#e6e9f0;font-size:13px}
button{padding:8px 14px;border:none;border-radius:8px;background:#2f6fed;color:#fff;font-size:14px;margin:10px 6px 0 0}
button:disabled{opacity:.5}
.card{border:1px solid #2a3550;border-radius:10px;margin:12px 0;padding:10px 12px;background:#131a29}
.card.ok{border-color:#1d5c3a}
.card.err{border-color:#6b1f2a}
.card h2{font-size:14px;margin:0 0 4px}
.card .path{font-size:11px;color:#8fa0bc;word-break:break-all}
.card .status{font-size:12px;margin:4px 0}
pre{white-space:pre-wrap;word-break:break-all;font-size:11px;background:#0b1019;border-radius:8px;padding:8px;max-height:340px;overflow:auto;margin:6px 0 0}
.tip{font-size:12px;color:#f5d78e;background:#241d0d;border:1px solid #6b4d12;border-radius:8px;padding:8px 10px;margin:10px 0}
</style>
</head>
<body>
<h1>银河充电桩数据调试页 <span class="badge" id="tokenBadge">检测中…</span></h1>
<div class="meta">页面来源：<span id="origin"></span>（必须为 https://h5-recharge.geely.com，网关才放行）</div>
<div class="meta">当前 token 有效至：<span id="expires"></span>（约30分钟；过期请打开一次银河 App 家充桩页刷新）</div>
<div class="meta">user_id：<span id="uid"></span></div>
<input id="tokenInput" placeholder="粘贴 rechargeToken（可选，覆盖注入值，存 localStorage）">
<div>
<button id="btnSave">保存 token</button>
<button id="btnList">只测设备列表</button>
<button id="btnRun">全部测试</button>
</div>
<div id="results"></div>
<script>
// ---- 注入值（由 Loon 脚本替换） ----
var INJECTED_TOKEN = "__TOKEN__";
var INJECTED_USER_ID = "__USER_ID__";

// ---- 签名参数（与 charge_inject_zeekr.js / evse-hub-ha 一致） ----
var RECHARGE_KEY = "204195485";
var RECHARGE_SECRET = "CqPwP83wzdjesmLeDuzK6SljsYN5PvRM";
var API_HOST = "https://h5-recharge.geely.com";
var UA = "GeelyGalaxy/1.54.0 (com.geelygalaxy.customer; build:15400077; iOS 26.6.0) Alamofire/5.11.1";

// ---------------- 纯 JS：MD5 / SHA-256 / HMAC-SHA256 / Base64 ----------------
function md5hex(input) {
  function safeAdd(x, y) { var lsw = (x & 0xffff) + (y & 0xffff); var msw = (x >> 16) + (y >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
  function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
  function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }
  function md5cycle(x, k) {
    var a = x[0], b = x[1], c = x[2], d = x[3];
    a = md5ff(a, b, c, d, k[0], 7, -680876936); d = md5ff(d, a, b, c, k[1], 12, -389564586); c = md5ff(c, d, a, b, k[2], 17, 606105819); b = md5ff(b, c, d, a, k[3], 22, -1044525330);
    a = md5ff(a, b, c, d, k[4], 7, -176418897); d = md5ff(d, a, b, c, k[5], 12, 1200080426); c = md5ff(c, d, a, b, k[6], 17, -1473231341); b = md5ff(b, c, d, a, k[7], 22, -45705983);
    a = md5ff(a, b, c, d, k[8], 7, 1770035416); d = md5ff(d, a, b, c, k[9], 12, -1958414417); c = md5ff(c, d, a, b, k[10], 17, -42063); b = md5ff(b, c, d, a, k[11], 22, -1990404162);
    a = md5ff(a, b, c, d, k[12], 7, 1804603682); d = md5ff(d, a, b, c, k[13], 12, -40341101); c = md5ff(c, d, a, b, k[14], 17, -1502002290); b = md5ff(b, c, d, a, k[15], 22, 1236535329);
    a = md5gg(a, b, c, d, k[1], 5, -165796510); d = md5gg(d, a, b, c, k[6], 9, -1069501632); c = md5gg(c, d, a, b, k[11], 14, 643717713); b = md5gg(b, c, d, a, k[0], 20, -373897302);
    a = md5gg(a, b, c, d, k[5], 5, -701558691); d = md5gg(d, a, b, c, k[10], 9, 38016083); c = md5gg(c, d, a, b, k[15], 14, -660478335); b = md5gg(b, c, d, a, k[4], 20, -405537848);
    a = md5gg(a, b, c, d, k[9], 5, 568446438); d = md5gg(d, a, b, c, k[14], 9, -1019803690); c = md5gg(c, d, a, b, k[3], 14, -187363961); b = md5gg(b, c, d, a, k[8], 20, 1163531501);
    a = md5gg(a, b, c, d, k[13], 5, -1444681467); d = md5gg(d, a, b, c, k[2], 9, -51403784); c = md5gg(c, d, a, b, k[7], 14, 1735328473); b = md5gg(b, c, d, a, k[12], 20, -1926607734);
    a = md5hh(a, b, c, d, k[5], 4, -378558); d = md5hh(d, a, b, c, k[8], 11, -2022574463); c = md5hh(c, d, a, b, k[11], 16, 1839030562); b = md5hh(b, c, d, a, k[14], 23, -35309556);
    a = md5hh(a, b, c, d, k[1], 4, -1530992060); d = md5hh(d, a, b, c, k[4], 11, 1272893353); c = md5hh(c, d, a, b, k[7], 16, -155497632); b = md5hh(b, c, d, a, k[10], 23, -1094730640);
    a = md5hh(a, b, c, d, k[13], 4, 681279174); d = md5hh(d, a, b, c, k[0], 11, -358537222); c = md5hh(c, d, a, b, k[3], 16, -722521979); b = md5hh(b, c, d, a, k[6], 23, 76029189);
    a = md5hh(a, b, c, d, k[9], 4, -640364487); d = md5hh(d, a, b, c, k[12], 11, -421815835); c = md5hh(c, d, a, b, k[15], 16, 530742520); b = md5hh(b, c, d, a, k[2], 23, -995338651);
    a = md5ii(a, b, c, d, k[0], 6, -198630844); d = md5ii(d, a, b, c, k[7], 10, 1126891415); c = md5ii(c, d, a, b, k[14], 15, -1416354905); b = md5ii(b, c, d, a, k[5], 21, -57434055);
    a = md5ii(a, b, c, d, k[12], 6, 1700485571); d = md5ii(d, a, b, c, k[3], 10, -1894986606); c = md5ii(c, d, a, b, k[10], 15, -1051523); b = md5ii(b, c, d, a, k[1], 21, -2054922799);
    a = md5ii(a, b, c, d, k[8], 6, 1873313359); d = md5ii(d, a, b, c, k[15], 10, -30611744); c = md5ii(c, d, a, b, k[6], 15, -1560198380); b = md5ii(b, c, d, a, k[13], 21, 1309151649);
    a = md5ii(a, b, c, d, k[4], 6, -145523070); d = md5ii(d, a, b, c, k[11], 10, -1120210379); c = md5ii(c, d, a, b, k[2], 15, 718787259); b = md5ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = safeAdd(a, x[0]); x[1] = safeAdd(b, x[1]); x[2] = safeAdd(c, x[2]); x[3] = safeAdd(d, x[3]);
  }
  function md5blk(s) {
    var md5blks = [], i;
    for (i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }
  function md51(s) {
    var n = s.length, state = [1732584193, -271733879, -1732584194, 271733878], i, tail;
    for (i = 64; i <= s.length; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
    s = s.substring(i - 64);
    tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) { md5cycle(state, tail); tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }
  function rhex(n) { var s = "", j; for (j = 0; j < 4; j++) s += ((n >> (j * 8 + 4)) & 0x0f).toString(16) + ((n >> (j * 8)) & 0x0f).toString(16); return s; }
  function hex(x) { var s = "", i; for (i = 0; i < x.length; i++) s += rhex(x[i]); return s; }
  return hex(md51(input));
}

function sha256Bytes(msg) {
  var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
           0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
           0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
           0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
           0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
           0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
           0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
           0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  function rotr(v, n) { return (v >>> n) | (v << (32 - n)); }
  function w32(n) { return String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); }
  var l = msg.length, bitLenLo = (l * 8) >>> 0, bitLenHi = Math.floor(l / 0x20000000) >>> 0;
  var padded = msg + "\\x80";
  while ((padded.length % 64) !== 56) padded += "\\x00";
  padded += w32(bitLenHi) + w32(bitLenLo);
  for (var i = 0; i < padded.length; i += 64) {
    var w = new Array(64), t;
    for (t = 0; t < 16; t++) {
      var o = i + t * 4;
      w[t] = ((padded.charCodeAt(o) & 255) << 24) | ((padded.charCodeAt(o + 1) & 255) << 16) |
             ((padded.charCodeAt(o + 2) & 255) << 8) | (padded.charCodeAt(o + 3) & 255);
    }
    for (t = 16; t < 64; t++) {
      var s0 = rotr(w[t-15], 7) ^ rotr(w[t-15], 18) ^ (w[t-15] >>> 3);
      var s1 = rotr(w[t-2], 17) ^ rotr(w[t-2], 19) ^ (w[t-2] >>> 10);
      w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (t = 0; t < 64; t++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ ((~e) & g);
      var temp1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  var out = "";
  for (i = 0; i < 8; i++) out += w32(h[i]);
  return out;
}

function hmacSha256(key, msg) {
  if (key.length > 64) key = sha256Bytes(key);
  while (key.length < 64) key += "\\x00";
  var oPad = "", iPad = "";
  for (var i = 0; i < 64; i++) {
    var kc = key.charCodeAt(i);
    oPad += String.fromCharCode(kc ^ 0x5c);
    iPad += String.fromCharCode(kc ^ 0x36);
  }
  return sha256Bytes(oPad + sha256Bytes(iPad + msg));
}

var B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64encode(bytes) {
  var out = "", i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    var n = (bytes.charCodeAt(i) << 16) | (bytes.charCodeAt(i + 1) << 8) | bytes.charCodeAt(i + 2);
    out += B64C[(n >> 18) & 63] + B64C[(n >> 12) & 63] + B64C[(n >> 6) & 63] + B64C[n & 63];
  }
  var rem = bytes.length - i;
  if (rem === 1) {
    var n1 = bytes.charCodeAt(i) << 16;
    out += B64C[(n1 >> 18) & 63] + B64C[(n1 >> 12) & 63] + "==";
  } else if (rem === 2) {
    var n2 = (bytes.charCodeAt(i) << 16) | (bytes.charCodeAt(i + 1) << 8);
    out += B64C[(n2 >> 18) & 63] + B64C[(n2 >> 12) & 63] + B64C[(n2 >> 6) & 63] + "=";
  }
  return out;
}

function md5bytes(str) {
  var hex = md5hex(str), out = "";
  for (var i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return out;
}

function httpDateGMT8() {
  var days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function p(n) { return (n < 10 ? "0" : "") + n; }
  var d = new Date(Date.now() + 8 * 3600 * 1000);
  return days[d.getUTCDay()] + ", " + p(d.getUTCDate()) + " " + months[d.getUTCMonth()] + " " +
    d.getUTCFullYear() + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + " GMT+8";
}

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  }).toUpperCase();
}

// ---------------- 原生签名（与抓包/api.py 一致） ----------------
function signRecharge(method, path, bodyStr, token) {
  var accept = "application/json";
  var ct = "application/json; charset=UTF-8";
  var md5 = bodyStr ? b64encode(md5bytes(bodyStr)) : "1B2M2Y8AsgTpgAmY7PhCfg==";
  var nonce = uuidv4();
  var ts = String(Date.now());
  var date = httpDateGMT8();
  var hdrs = [
    ["X-Ca-Key", RECHARGE_KEY],
    ["X-Ca-Nonce", nonce],
    ["X-Ca-Signature-Method", "HmacSHA256"],
    ["X-Ca-Timestamp", ts],
    ["X-Ca-Version", "1"]
  ];
  if (token) hdrs.push(["token", token]);
  var sigHdrs = "X-Ca-Key,X-Ca-Nonce,X-Ca-Signature-Method,X-Ca-Timestamp,X-Ca-Version" + (token ? ",token" : "");
  var lines = [method, accept, md5, ct, date];
  for (var i = 0; i < hdrs.length; i++) lines.push(hdrs[i][0] + ":" + hdrs[i][1]);
  lines.push(path);
  var sig = b64encode(hmacSha256(RECHARGE_SECRET, lines.join("\\n")));
  var headers = {
    "Host": "api-recharge.geely.com",
    "User-Agent": UA,
    "Accept": accept,
    "Content-Type": ct,
    "Date": date,
    "X-Galaxy-Date": date,
    "Content-MD5": md5,
    "X-Ca-Signature": sig,
    "X-Ca-Signature-Headers": sigHdrs
  };
  for (i = 0; i < hdrs.length; i++) headers[hdrs[i][0]] = hdrs[i][1];
  return headers;
}



// ---- 状态 ----
var token = localStorage.getItem("dbg_token") || INJECTED_TOKEN;
var userId = localStorage.getItem("dbg_user_id") || INJECTED_USER_ID;
var EQUIPMENT = { id: "", providerNo: "DIRECT_WDZ" };

function badgeEl() { return document.getElementById("tokenBadge"); }
function expiresEl() { return document.getElementById("expires"); }

function renderMeta() {
  document.getElementById("origin").textContent = location.origin;
  document.getElementById("uid").textContent = userId || "（无）";
  document.getElementById("tokenInput").value = token;
  if (!token) { badgeEl().className = "badge err"; badgeEl().textContent = "无 token"; expiresEl().textContent = "请先打开一次银河App家充桩页"; }
  else { badgeEl().className = "badge ok"; badgeEl().textContent = "token 已注入"; expiresEl().textContent = "__EXPIRES_TEXT__"; }
}

document.getElementById("btnSave").onclick = function () {
  var v = document.getElementById("tokenInput").value.trim();
  if (!v) { alert("token 为空"); return; }
  token = v;
  localStorage.setItem("dbg_token", v);
  localStorage.setItem("dbg_user_id", userId);
  badgeEl().className = "badge ok"; badgeEl().textContent = "token 已保存";
};

// ---- 接口清单 ----
function needEq(ep) { return !!ep.needEq; }

var ENDPOINTS = [
  { name: "用户信息", path: "/gep/v2/common/getUserInfoByToken", body: function () { return { sourceTypeKey: "0010000", token: token }; } },
  { name: "设备列表", path: "/gep/v2/home/charge/getMyEquipments", body: function () { return { sourceTypeKey: "0010000", userId: userId }; },
    after: function (j) { var l = (j && j.data && j.data.resultList) || []; if (l.length > 0) { EQUIPMENT.id = String(l[0].equipmentId || ""); EQUIPMENT.providerNo = String(l[0].providerNo || "DIRECT_WDZ"); } } },
  { name: "设备详情", path: "/gep/v1/home/charge/getMyEquipmentDetail", needEq: true, body: function () { return { sourceTypeKey: "0010000", userId: userId, equipmentId: EQUIPMENT.id, providerNo: EQUIPMENT.providerNo }; } },
  { name: "设备卡片", path: "/gep/v2/home/charge/getMyEquipmentCards", needEq: true, body: function () { return { sourceTypeKey: "0010000", userId: userId, equipmentId: EQUIPMENT.id, providerNo: EQUIPMENT.providerNo }; } },
  { name: "设备分享", path: "/gep/v1/home/charge/getMyEquipmentShares", needEq: true, body: function () { return { sourceTypeKey: "0010000", userId: userId, equipmentId: EQUIPMENT.id, providerNo: EQUIPMENT.providerNo }; } },
  { name: "设备版本", path: "/gep/v1/home/charge/getEquipmentVersions", needEq: true, body: function () { return { sourceTypeKey: "0010000", userId: userId, equipmentId: EQUIPMENT.id, providerNo: EQUIPMENT.providerNo }; } },
  { name: "即插即充绑定VIN", path: "/gep/v2/home/charge/getEquipmentBindVins", needEq: true, body: function () { return { sourceTypeKey: "0010000", userId: userId, equipmentId: EQUIPMENT.id, providerNo: EQUIPMENT.providerNo }; } },
  { name: "充电记录统计", path: "/gep/v2/home/charge/getEquipmentChargeOrderCalc", needEq: true, body: function () { return { sourceTypeKey: "0010000", userId: userId, equipmentId: EQUIPMENT.id, providerNo: EQUIPMENT.providerNo, calcType: 1 }; } },
  { name: "充电记录明细", path: "/gep/v2/home/charge/getEquipmentChargeOrders", needEq: true, body: function () { return { sourceTypeKey: "0010000", userId: userId, equipmentId: EQUIPMENT.id, providerNo: EQUIPMENT.providerNo, calcType: 1, pageNum: 1, pageSize: 10 }; } }
];

// ---- 请求与渲染 ----
function addCard(ep, statusText, bodyText, isOk) {
  var div = document.createElement("div");
  div.className = "card " + (isOk ? "ok" : "err");
  var h = "<h2>" + ep.name + "</h2><div class='path'>POST " + API_HOST + ep.path + "</div>";
  h += "<div class='status'>" + statusText + "</div>";
  if (bodyText) h += "<pre>" + escapeHtml(bodyText) + "</pre>";
  div.innerHTML = h;
  document.getElementById("results").appendChild(div);
}

function addTip(text) {
  var tip = document.createElement("div");
  tip.className = "tip";
  tip.textContent = text;
  var results = document.getElementById("results");
  results.insertBefore(tip, results.firstChild);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function callOne(ep) {
  if (needEq(ep) && !EQUIPMENT.id) {
    addCard(ep, "跳过：设备列表为空，无 equipmentId", "", false);
    return;
  }
  var bodyStr = JSON.stringify(ep.body());
  var headers = signRecharge("POST", ep.path, bodyStr, token);
  headers["x-debug-page"] = "1";
  var t0 = Date.now();
  try {
    var res = await fetch(API_HOST + ep.path, { method: "POST", headers: headers, body: bodyStr });
    var text = await res.text();
    var ms = Date.now() - t0;
    var j = null;
    try { j = JSON.parse(text); } catch (e) {}
    var isOk = res.status === 200 && j && (j.code === "0" || j.code === 0 || j.code === "success");
    if (j && (j.code === "999" || j.code === 999)) {
      addTip("检测到 token 失效（code 999）：请打开银河 App 家充桩页刷新 token，然后重新加载本页。");
    }
    if (ep.after && j) { try { ep.after(j); } catch (e) {} }
    addCard(ep, "HTTP " + res.status + " · " + ms + "ms · " + (isOk ? "SUCCESS" : "FAIL"), text, isOk);
    return isOk;
  } catch (e) {
    addCard(ep, "请求异常：" + e.message, "", false);
    return false;
  }
}

async function runAll(filter) {
  document.getElementById("results").innerHTML = "";
  var list = filter ? ENDPOINTS.filter(filter) : ENDPOINTS.slice();
  for (var i = 0; i < list.length; i++) {
    await callOne(list[i]);
  }
}

document.getElementById("btnRun").onclick = function () { runAll(null); };
document.getElementById("btnList").onclick = function () { runAll(function (ep) { return ep.path.indexOf("getMyEquipments") >= 0; }); };

renderMeta();
if (token) { runAll(null); } else {
  var tip = document.createElement("div");
  tip.className = "tip";
  tip.textContent = "未获取到 token：请先打开一次银河 App 家充桩页（让 charge_capture_galaxy.js 缓存 token），再刷新本页；或在上面手动粘贴 token。";
  document.getElementById("results").appendChild(tip);
}
</script>
</body>
</html>`;
}

// ---------------- 主流程 ----------------
try {
  var token = $persistentStore.read("galaxyRechargeToken") || "";
  var userId = $persistentStore.read("galaxyUserId") || "";
  var expiresAt = parseInt($persistentStore.read("galaxyTokenExpiresAt") || "0", 10);
  var nowSec = Math.floor(Date.now() / 1000);
  var expired = !!token && !!expiresAt && nowSec > expiresAt - 60;
  var expiresText = expiresAt > 1000000000 ? new Date(expiresAt * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未知";

  var html = buildHtml(token, userId, expiresText, expired);
  html = html.replace("__TOKEN__", token).replace("__USER_ID__", userId).replace("__EXPIRES_TEXT__", expiresText + (expired ? "（已过期）" : ""));

  var headers = $response.headers || {};
  headers["content-type"] = "text/html; charset=utf-8";
  delete headers["content-encoding"];
  delete headers["Content-Encoding"];
  delete headers["content-length"];
  delete headers["Content-Length"];
  if (NOTIFY) $notification.post("充电桩修改：调试页已生成", "请在浏览器打开 h5-recharge.geely.com/debug-galaxy", "");
  $done({ status: 200, headers: headers, body: html });
} catch (e) {
  console.log("[charge] 调试页生成失败: " + (e && e.message ? e.message : String(e)));
  $done({});
}
