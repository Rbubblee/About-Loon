// ============================================================
// charge_galaxy_login.js  v1.0（银河账号网页登录页，替代银河App）
//
// 挂在 https://h5-recharge.geely.com/galaxy-login 下；两个网关的请求都走
// charge_gw_relay.js 同源代理（/galaxy-gw、/recharge-gw），绕开网关对
// 带 Origin 浏览器请求的 403 拒绝。
//
// 完整链路（移植自 evse-hub-ha 的 SMS 登录）：
//   security config → Geetest v4 滑块 → sendSms → mobileCodeLogin
//   → oauth2/code → api-recharge getTokenByCode → authToken+refreshToken
//
// 登录成功后：
//   1. 页面把会话（centerToken/userId/authToken/refreshToken）存 localStorage
//      （key=galaxySession，与 charge_live_relay.js 共享，供自动续期）；
//   2. getTokenByCode 的响应经过 Loon MITM，charge_capture_galaxy.js 会自动
//      写入 galaxyRechargeToken/galaxyRefreshToken/galaxyUserId——
//      即 Loon 侧拿到的 token 与银河App打开时完全一致。
//
// 密钥来源：evse-hub-ha（吉利银河/浩瀚能源 HA 集成，客户端固定 AppSecret）。
// ============================================================

var NOTIFY = String(($argument || [])[0]) !== "false";

function buildHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>银河账号登录</title>
<style>
body{font-family:-apple-system,system-ui,sans-serif;background:#0f1420;color:#e6e9f0;margin:0;padding:20px;max-width:420px}
h1{font-size:18px;margin:4px 0 6px}
.meta{font-size:12px;color:#9aa4b8;margin:4px 0}
input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #2a3550;border-radius:8px;background:#161d2e;color:#e6e9f0;font-size:15px;margin:6px 0}
button{width:100%;padding:12px;border:none;border-radius:8px;background:#2f6fed;color:#fff;font-size:15px;margin:8px 0}
button:disabled{opacity:.5}
.msg{font-size:13px;margin:8px 0;padding:8px 10px;border-radius:8px;display:none}
.ok{background:#1d5c3a;color:#7ee2a8;display:block}
.err{background:#6b1f2a;color:#ff9aa8;display:block}
.warn{background:#6b4d12;color:#f5d78e;display:block}
pre{white-space:pre-wrap;word-break:break-all;font-size:11px;background:#0b1019;border-radius:8px;padding:8px;max-height:220px;overflow:auto}
#geetest-wrap{margin:8px 0}
</style>
</head>
<body>
<h1>银河账号登录（替代银河App）</h1>
<div class="meta">页面来源：<span id="origin"></span>（必须为 https://h5-recharge.geely.com）</div>
<div class="meta" id="sessionInfo">尚未登录</div>
<input id="mobile" type="tel" placeholder="手机号" inputmode="numeric">
<button id="btnGetCode">获取短信验证码（先滑块验证）</button>
<div id="geetest-wrap"></div>
<input id="code" type="tel" placeholder="6位短信验证码" inputmode="numeric" style="display:none">
<button id="btnLogin" style="display:none">登录并写入Loon</button>
<div class="msg" id="msg"></div>
<div id="out"></div>
<script>
// ---- 签名参数 ----
var GALAXY_KEY = "204925390";
var GALAXY_SECRET = "bVy52qsT6U5ElPOZN4vTkhnMdzedMjx6";
var GALAXY_HOST = "https://h5-recharge.geely.com/galaxy-gw";
var RECHARGE_KEY = "204195485";
var RECHARGE_SECRET = "CqPwP83wzdjesmLeDuzK6SljsYN5PvRM";
var API_HOST = "https://h5-recharge.geely.com/recharge-gw";
var UA = "GeelyGalaxy/1.53.0 (com.geelygalaxy.customer; build:15300087; iOS 26.5.0) Alamofire/5.11.1";
var OAUTH_CLIENT_ID = "30000023";

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
    "Content-MD5": md5,
    "X-Ca-Signature": sig,
    "X-Ca-Signature-Headers": sigHdrs
  };
  for (i = 0; i < hdrs.length; i++) headers[hdrs[i][0]] = hdrs[i][1];
  return headers;
}



// ---- galaxy-user-api 签名（与 evse-hub-ha sms_auth.py 一致） ----
function galaxySign(method, path, bodyStr, glUserId, token) {
  var accept = "application/json";
  var ct = "application/json; charset=UTF-8";
  var md5 = bodyStr ? b64encode(md5bytes(bodyStr)) : "1B2M2Y8AsgTpgAmY7PhCfg==";
  var nonce = uuidv4();
  var ts = String(Date.now());
  var date = httpDateGMT8();
  var hdrs = [
    ["X-Ca-Key", GALAXY_KEY],
    ["X-Ca-Nonce", nonce],
    ["X-Ca-Signature-Method", "HmacSHA256"],
    ["X-Ca-Timestamp", ts],
    ["X-Ca-Version", "1"],
    ["gl_user_id", glUserId || ""]
  ];
  if (token) { hdrs.push(["token", token]); }
  var sigHdrs = "";
  for (var i = 0; i < hdrs.length; i++) { sigHdrs += (i ? "," : "") + hdrs[i][0]; }
  var lines = [method, accept, md5, ct, date];
  for (i = 0; i < hdrs.length; i++) { lines.push(hdrs[i][0] + ":" + hdrs[i][1]); }
  lines.push(path);
  var sig = b64encode(hmacSha256(GALAXY_SECRET, lines.join("\\n")));
  var headers = {
    "User-Agent": "CA_iOS_SDK_2.0",
    "Accept": accept,
    "Content-Type": ct,
    "Date": date,
    "Content-MD5": md5,
    "X-Ca-Signature": sig,
    "X-Ca-Signature-Headers": sigHdrs,
    "appId": "galaxy-app",
    "appVersion": "1.53.0",
    "gl_app_version": "1.53.0",
    "gl_app_build": "15300087",
    "platform": "IOS",
    "deviceType": "IOS",
    "gl_dev_platform": "iOS",
    "gl_dev_brand": "Apple",
    "gl_dev_model": "iPhone 14 Pro",
    "gl_os_version": "26.5",
    "tenantId": "569001701001",
    "Accept-Language": "zh-CN,zh-Hans;q=0.9"
  };
  for (i = 0; i < hdrs.length; i++) { headers[hdrs[i][0]] = hdrs[i][1]; }
  return headers;
}

// ---- 工具 ----
function $(id) { return document.getElementById(id); }
function showMsg(text, cls) {
  var m = $("msg");
  m.className = "msg " + (cls || "warn");
  m.textContent = text;
}
function setBtn(id, disabled) { $(id).disabled = !!disabled; }

async function galaxyGet(path, glUserId, token) {
  var res = await fetch(GALAXY_HOST + path, { method: "GET", headers: galaxySign("GET", path, "", glUserId, token) });
  var text = await res.text();
  try { return JSON.parse(text); } catch (e) { return { code: String(res.status), message: text }; }
}
async function galaxyPost(path, bodyObj, glUserId, token) {
  var bodyStr = bodyObj == null ? "" : JSON.stringify(bodyObj);
  var res = await fetch(GALAXY_HOST + path, { method: "POST", headers: galaxySign("POST", path, bodyStr, glUserId, token), body: bodyStr });
  var text = await res.text();
  try { return JSON.parse(text); } catch (e) { return { code: String(res.status), message: text }; }
}

// ---- 登录状态 ----
var SESSION_KEY = "galaxySession";
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; } }
function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }

var session = loadSession();
if (session && session.authToken) {
  $("sessionInfo").textContent = "已登录（user_id=" + (session.glUserId || "?") + "，authToken 有效至 " + new Date(session.authExpiresAt).toLocaleString("zh-CN") + "）";
}

// ---- 步骤1：安全配置 ----
var CAPTCHA_ID = "";
var geetestReady = false;

async function loadGeetest() {
  showMsg("正在加载滑块配置…", "warn");
  var cfg = await galaxyGet("/api/v1/security/config?type=GEE_TEST_V4");
  if (cfg.code !== "success" || !cfg.data) { showMsg("获取安全配置失败：" + JSON.stringify(cfg).slice(0, 200), "err"); return; }
  CAPTCHA_ID = cfg.data.captchaId;
  var apiServers = [cfg.data.apiServer || "https://captcha4.geely.com"];
  var staticServers = [cfg.data.staticServer || "https://captcha4.geely.com/www/js/"];
  await loadGeetestSdk(apiServers[0]);
  if (typeof window.initGeetest !== "function") { showMsg("滑块SDK加载失败", "err"); return; }
  window.initGeetest({
    captchaId: CAPTCHA_ID,
    product: "bind",
    protocol: "https://",
    apiServers: apiServers,
    staticServers: staticServers,
    clientType: "h5",
    hideBar: []
  }, function (captchaObj) {
    geetestReady = true;
    try { captchaObj.appendTo(document.body); } catch (e) {}
    // bind 模式下必须手动触发 verify()/showBox() 滑块才会弹出
    var triggered = false;
    var doVerify = function () {
      if (triggered) { return; }
      triggered = true;
      try {
        if (typeof captchaObj.verify === "function") { captchaObj.verify(); }
        else if (typeof captchaObj.showBox === "function") { captchaObj.showBox(); }
        else if (typeof captchaObj.showCaptcha === "function") { captchaObj.showCaptcha(); }
      } catch (e) { showMsg("触发滑块异常：" + (e && e.message ? e.message : String(e)), "err"); }
    };
    if (typeof captchaObj.onReady === "function") { captchaObj.onReady(doVerify); }
    // 兜底：部分 SDK 版本不触发 onReady
    setTimeout(doVerify, 1200);
    captchaObj.onSuccess(function () {
      var r = captchaObj.getValidate();
      if (!r) { showMsg("滑块未返回验证结果", "err"); return; }
      doValidateAndSend(r);
    });
    captchaObj.onError(function (e) { showMsg("滑块异常：" + JSON.stringify(e).slice(0, 150), "err"); });
    captchaObj.onClose(function () {});
  });
}

function loadGeetestSdk(apiServer) {
  return new Promise(function (resolve) {
    if (typeof window.initGeetest === "function") { resolve(); return; }
    var s = document.createElement("script");
    s.src = apiServer + "/www/gt4.js";
    s.onload = function () { resolve(); };
    s.onerror = function () { resolve(); };
    document.head.appendChild(s);
  });
}

// ---- 步骤2-3：滑块验证 + 发短信 ----
async function doValidateAndSend(r) {
  setBtn("btnGetCode", true);
  showMsg("滑块验证中…", "warn");
  var v = await galaxyPost("/api/v1/security/geeTestV4/validate", {
    captchaOutput: r.captcha_output,
    passToken: r.pass_token,
    genTime: r.gen_time,
    lotNumber: r.lot_number,
    captchaId: CAPTCHA_ID,
    clientType: "ios"
  });
  if (v.code !== "success" || !v.data || !v.data.pass) { showMsg("滑块验证失败：" + JSON.stringify(v).slice(0, 180), "err"); setBtn("btnGetCode", false); return; }
  var certifyId = v.data.certifyId;
  var mobile = $("mobile").value.trim();
  showMsg("正在发送短信…", "warn");
  var sms = await galaxyPost("/api/v1/login/sendSms", { mobile: mobile, certifyId: certifyId });
  if (sms.code !== "success") { showMsg("发送短信失败：" + (sms.message || JSON.stringify(sms)).slice(0, 180), "err"); setBtn("btnGetCode", false); return; }
  $("code").style.display = "block";
  $("btnLogin").style.display = "block";
  showMsg("短信已发送，请输入验证码", "ok");
  setBtn("btnGetCode", false);
}

// ---- 步骤4-6：登录 + 换token ----
$("btnLogin").onclick = async function () {
  var mobile = $("mobile").value.trim();
  var code = $("code").value.trim();
  if (!mobile || code.length < 4) { showMsg("请输入手机号和验证码", "err"); return; }
  setBtn("btnLogin", true);
  showMsg("登录中…", "warn");

  // 4. mobileCodeLogin → centerToken
  var loginPath = "/api/v1/login/mobileCodeLogin?mobile=" + encodeURIComponent(mobile) + "&verificationCode=" + encodeURIComponent(code);
  var login = await galaxyPost(loginPath, null);
  if (login.code !== "success") { showMsg("登录失败：" + JSON.stringify(login).slice(0, 200), "err"); setBtn("btnLogin", false); return; }
  var centerToken = login.data.centerTokenDto.token;
  var glUserId = String(login.data.centerUserInfoDto.id || "");

  // 5. oauth2/code（query 按字母序，scope 逗号不编码）
  var oauthPath = "/api/v1/oauth2/code?client_id=" + OAUTH_CLIENT_ID + "&response_type=code&scope=snsapiUserinfo,snsapiMobile";
  var oauth = await galaxyGet(oauthPath, glUserId, centerToken);
  if (oauth.code !== "success") { showMsg("换取授权码失败：" + JSON.stringify(oauth).slice(0, 200), "err"); setBtn("btnLogin", false); return; }
  var authCode = oauth.data.code;

  // 6. getTokenByCode → authToken + refreshToken
  var tok = await galaxyRechargeToken(authCode);
  if (tok.code !== "0") { showMsg("换token失败：" + JSON.stringify(tok).slice(0, 200), "err"); setBtn("btnLogin", false); return; }
  var d = tok.data;
  var now = Date.now();
  var authExp = now + (typeof d.expireAt === "number" && d.expireAt < 1000000000 ? d.expireAt * 1000 : 1799 * 1000);
  var refreshExp = typeof d.refreshExpireAt === "number" && d.refreshExpireAt > 1000000000000 ? d.refreshExpireAt : now + 7 * 86400 * 1000;
  saveSession({
    mobile: mobile,
    glUserId: glUserId,
    centerToken: centerToken,
    authToken: d.authToken,
    refreshToken: d.refreshToken || "",
    authExpiresAt: authExp,
    refreshExpiresAt: refreshExp
  });
  // 同步写入中继/调试页读取的键
  try {
    localStorage.setItem("dbg_token", d.authToken);
    localStorage.setItem("dbg_user_id", glUserId);
  } catch (e) {}
  // 把 token 写入 Loon（与打开银河App等效）
  try {
    await fetch("https://h5-recharge.geely.com/store-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authToken: d.authToken, refreshToken: d.refreshToken || "", userId: glUserId, expiresAt: Math.floor(authExp / 1000) })
    });
  } catch (e) {}
  $("sessionInfo").textContent = "登录成功：user_id=" + glUserId;
  showMsg("登录成功！token 已写入 Loon（约30分钟有效），现在可以关闭本页", "ok");
  var pre = document.createElement("pre");
  pre.textContent = JSON.stringify({ code: "0", message: "SUCCESS", data: { authToken: d.authToken, expireAt: d.expireAt, refreshToken: d.refreshToken, refreshExpireAt: d.refreshExpireAt, userId: glUserId, centerToken: centerToken } }, null, 2);
  $("out").appendChild(pre);
  setBtn("btnLogin", false);
};

async function galaxyRechargeToken(authCode) {
  var bodyStr = JSON.stringify({ code: authCode, sourceTypeKey: "0010000" });
  var headers = signRecharge("POST", "/gep/v2/common/getTokenByCode", bodyStr, "");
  // 注意：这里不能带 x-debug-page 标记——getTokenByCode 必须被
  // charge_capture_galaxy.js 正常捕获，把 authToken/refreshToken 写入 Loon
  var res = await fetch(API_HOST + "/gep/v2/common/getTokenByCode", { method: "POST", headers: headers, body: bodyStr });
  var text = await res.text();
  try { return JSON.parse(text); } catch (e) { return { code: String(res.status), message: text }; }
}

$("btnGetCode").onclick = function () { loadGeetest(); };
document.getElementById("origin").textContent = location.origin;
</script>
</body>
</html>`;
}

// ---------------- 主流程 ----------------
try {
  var html = buildHtml();
  var headers = $response.headers || {};
  headers["content-type"] = "text/html; charset=utf-8";
  delete headers["content-encoding"];
  delete headers["Content-Encoding"];
  delete headers["content-length"];
  delete headers["Content-Length"];
  if (NOTIFY) $notification.post("充电桩修改：银河登录页已生成", "浏览器打开 h5-recharge.geely.com/galaxy-login", "");
  $done({ status: 200, headers: headers, body: html });
} catch (e) {
  console.log("[charge] 登录页生成失败: " + (e && e.message ? e.message : String(e)));
  $done({});
}
