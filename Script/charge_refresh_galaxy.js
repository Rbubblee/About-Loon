// ============================================================
// charge_refresh_galaxy.js  v1.4（cron 定时刷新，准实时 + token 生命周期）
// 每 30 秒用银河【原生密钥】签名拉取业务接口，把实时数据写入 gx_<key>，
// 供 charge_inject_zeekr.js 直接注入（页面加载读新鲜缓存，秒开）。
//
// v1.2：去掉签名头里的 Host（App 抓包为 HTTP/2，本就不带 Host 头，
//       避免 Loon 客户端对显式 Host 的额外处理）；开头加一次百度连通性自检，
//       用于区分"Loon 网络不可用"与"仅 api-recharge 被拦"。
// v1.3：token 生命周期——authToken 过期提醒（6h 一次）、refreshToken 到期
//       预警（剩余 2 天起每天提醒一次）、刷新端点预留（抓到 App 原生刷新
//       请求后填 REFRESH_ENDPOINT 即可启用自动续期）。
// v1.4：getEquipmentChargeOrders 补 chargeTime（YYYY.MM.DD）——6704 抓包实测
//       缺该字段网关返回 500（H5 请求带 chargeTime 才 200）；每个接口成功
//       时单独记录 gx_<key>_at 时间戳，避免单个接口失败拖累整体缓存年龄。
// 注意：2026-08-07 实测发现 baidu 连通性自检同样失败（err=null），
// 说明根因是 Loon 脚本网络层在当前设备/版本整体不可用（与 MITM、规则无关）。
// 本脚本的实时刷新能力依赖 Loon 脚本网络恢复正常；在此之前由
// charge_capture_galaxy.js（打开银河App时缓存）保证注入数据可用。
// token 由 charge_capture_galaxy.js 在银河App打开时抓取
// （约 30 分钟有效，过期后本脚本自动停刷并保留旧缓存）。
//
// 密钥来源：开源项目 evse-hub-ha（吉利银河/浩瀚能源 HA 集成），
//           已用抓包真实请求验证：复算签名与抓包 x-ca-signature 逐字节一致。
// ============================================================

var RECHARGE_KEY = "204195485";
var RECHARGE_SECRET = "CqPwP83wzdjesmLeDuzK6SljsYN5PvRM";
var API_HOST = "https://api-recharge.geely.com";
var UA = "GeelyGalaxy/1.54.0 (com.geelygalaxy.customer; build:15400077; iOS 26.6.0) Alamofire/5.11.1";

var FULL_REFRESH_INTERVAL_MS = 180000; // 详情类接口每 3 分钟全量刷一次

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
  var padded = msg + "\x80";
  while ((padded.length % 64) !== 56) padded += "\x00";
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
  while (key.length < 64) key += "\x00";
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
  var sig = b64encode(hmacSha256(RECHARGE_SECRET, lines.join("\n")));
  var headers = {
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

// ---------------- token 生命周期（v1.3）----------------
// refreshToken 换新端点：目前未知——H5 的 tryRefreshToken 走原生桥（SWXUserSessionPlugin），
// 抓包里也没有 HTTP 刷新调用。等抓到银河 App 原生刷新请求后，把完整路径
// （如 "/gep/v2/common/refreshToken"）填到这里，并在 tryRefreshToken 里补实现即可自动续期。
var REFRESH_ENDPOINT = "";
var AUTH_WARN_COOLDOWN_MS = 6 * 3600 * 1000; // authToken 过期提醒最小间隔 6 小时
var REFRESH_WARN_DAYS = 2;                   // refreshToken 剩余天数提醒阈值

function warnOnce(key, cooldownMs, title, body) {
  var last = parseInt($persistentStore.read(key) || "0", 10);
  var now = Date.now();
  if (now - last < cooldownMs) return;
  $persistentStore.write(String(now), key);
  $notification.post(title, body, "");
}

function tryRefreshToken(cb) {
  // 端点确认后实现：用 galaxyRefreshToken 调 REFRESH_ENDPOINT，成功则把
  // 新 authToken/refreshToken/过期时间写回 persistentStore 后 cb(true)。
  if (!REFRESH_ENDPOINT) { cb(false); return; }
  cb(false);
}

// ---------------- 接口清单（与注入脚本 MAP 保持一致） ----------------
var ENDPOINTS = [
  { key: "getMyEquipments", path: "/gep/v2/home/charge/getMyEquipments", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u }; }, always: true },
  { key: "getMyEquipmentDetail", path: "/gep/v1/home/charge/getMyEquipmentDetail", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p }; }, always: false },
  { key: "getMyEquipmentCards", path: "/gep/v2/home/charge/getMyEquipmentCards", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p }; }, always: false },
  { key: "getMyEquipmentShares", path: "/gep/v1/home/charge/getMyEquipmentShares", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p }; }, always: false },
  { key: "getEquipmentVersions", path: "/gep/v1/home/charge/getEquipmentVersions", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p }; }, always: false },
  { key: "getEquipmentBindVins", path: "/gep/v2/home/charge/getEquipmentBindVins", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p }; }, always: false },
  { key: "getEquipmentChargeOrders", path: "/gep/v2/home/charge/getEquipmentChargeOrders", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p, calcType: 1, pageNum: 1, pageSize: 10, chargeTime: todayChargeTime() }; }, always: false },
  { key: "getEquipmentChargeOrderCalc", path: "/gep/v2/home/charge/getEquipmentChargeOrderCalc", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p, calcType: 1 }; }, always: false },
  { key: "generateRenewUrl", path: "/sim/v1/netflow/generateRenewUrl", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, deviceSn: eq, providerNo: p }; }, always: false }
];

function todayChargeTime() {
  var d = new Date(Date.now() + 8 * 3600 * 1000);
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return d.getUTCFullYear() + "." + p(d.getUTCMonth() + 1) + "." + p(d.getUTCDate());
}

// ---------------- 主流程 ----------------
try {
  var token = $persistentStore.read("galaxyRechargeToken") || "";
  var userId = $persistentStore.read("galaxyUserId") || "";
  var expiresAt = parseInt($persistentStore.read("galaxyTokenExpiresAt") || "0", 10);
  var refreshToken = $persistentStore.read("galaxyRefreshToken") || "";
  var refreshExpiresAt = parseInt($persistentStore.read("galaxyRefreshTokenExpiresAt") || "0", 10);
  var nowSec = Math.floor(Date.now() / 1000);
  var tokenValid = !!(token && userId && (!expiresAt || nowSec <= expiresAt - 60));

  // refreshToken 临近过期预警（每天一次）
  if (tokenValid && refreshExpiresAt > nowSec && (refreshExpiresAt - nowSec) < REFRESH_WARN_DAYS * 86400) {
    warnOnce("galaxyRefreshWarnAt", 24 * 3600 * 1000, "充电桩修改：refreshToken 即将过期",
      "剩余 " + ((refreshExpiresAt - nowSec) / 86400).toFixed(1) + " 天，请打开银河 App 家充桩页或网页登录页重新登录");
  }

  if (!tokenValid) {
    if (refreshToken && refreshExpiresAt > nowSec && REFRESH_ENDPOINT) {
      tryRefreshToken(function (ok) {
        if (!ok) {
          warnOnce("galaxyTokenWarnAt", AUTH_WARN_COOLDOWN_MS, "充电桩修改：银河 token 已过期",
            "自动续期失败，请打开银河 App 家充桩页，或浏览器打开 h5-recharge.geely.com/galaxy-login 重新登录（约30秒）");
        }
        $done({});
      });
    } else {
      warnOnce("galaxyTokenWarnAt", AUTH_WARN_COOLDOWN_MS, "充电桩修改：银河 token 已过期",
        "请打开银河 App 家充桩页，或浏览器打开 h5-recharge.geely.com/galaxy-login 重新登录（约30秒）");
      console.log("[charge] cron 跳过：token 缺失或已过期");
      $done({});
      return;
    }
    return;
  }

  var eq = $persistentStore.read("galaxyLastEquipmentId") || "";
  var provider = $persistentStore.read("galaxyLastProviderNo") || "DIRECT_WDZ";
  var now = Date.now();
  var lastFull = parseInt($persistentStore.read("galaxyLastFullRefreshAt") || "0", 10);
  var doFull = (now - lastFull) > FULL_REFRESH_INTERVAL_MS;

  // 连通性自检：确认 cron 上下文能正常发网络请求（目标为不受 MITM 的域名）
  $httpClient.get({
    url: "https://www.baidu.com/",
    timeout: 8000
  }, function (err, resp, data) {
    try {
      if (!err && resp && resp.statusCode === 200) {
        console.log("[charge] 连通性自检 OK（baidu status=200）");
      } else {
        console.log("[charge] 连通性自检失败 err=[" + String(err) + "] status=" + (resp ? resp.statusCode : "无") + " —— Loon 脚本网络可能整体不可用");
      }
    } catch (e) {}
    runRefresh(eq, provider, doFull);
  });

  function runRefresh(eq, provider, doFull) {
  var targets = [];
  for (var i = 0; i < ENDPOINTS.length; i++) {
    var ep = ENDPOINTS[i];
    if (ep.always || doFull) {
      if (!eq && !ep.always) continue; // 详情类接口需要 equipmentId
      targets.push(ep);
    }
  }
  if (targets.length === 0) { $done({}); return; }

  console.log("[charge] cron 开始刷新，目标接口 " + targets.length + " 个（全量=" + doFull + "）");

  var doneCount = 0;
  var failCount = 0;
  var successAny = false;

  function onFinish() {
    doneCount++;
    if (doneCount < targets.length) return;
    if (successAny) {
      $persistentStore.write(String(Date.now()), "galaxyLastUpdatedAt");
      if (doFull) $persistentStore.write(String(Date.now()), "galaxyLastFullRefreshAt");
      console.log("[charge] cron 刷新完成 " + doneCount + " 个接口（失败 " + failCount + "）");
    } else {
      console.log("[charge] cron 本轮全部失败（" + failCount + "/" + targets.length + "），保留旧缓存");
    }
    $done({});
  }

  for (i = 0; i < targets.length; i++) {
    (function (ep) {
      var bodyStr = JSON.stringify(ep.body(userId, eq, provider));
      var headers = signRecharge("POST", ep.path, bodyStr, token);
      $httpClient.post({
        url: API_HOST + ep.path,
        headers: headers,
        body: bodyStr,
        timeout: 10000
      }, function (err, resp, data) {
        try {
          if (!err && resp && resp.statusCode === 200 && data) {
            var j = JSON.parse(data);
            if (j.code === "0" || j.code === 0 || j.code === "success") {
              $persistentStore.write(data, "gx_" + ep.key);
              $persistentStore.write(String(Date.now()), "gx_" + ep.key + "_at");
              successAny = true;
              if (ep.key === "getMyEquipments") {
                var list = (j.data && j.data.resultList) || [];
                if (list.length > 0) {
                  $persistentStore.write(String(list[0].equipmentId || ""), "galaxyLastEquipmentId");
                  $persistentStore.write(String(list[0].providerNo || provider), "galaxyLastProviderNo");
                  eq = String(list[0].equipmentId || eq);
                  provider = String(list[0].providerNo || provider);
                }
              }
              console.log("[charge] cron 刷新 " + ep.key);
            } else {
              failCount++;
              console.log("[charge] cron " + ep.key + " 异常: " + String(data).slice(0, 150));
            }
          } else {
            failCount++;
            console.log("[charge] cron " + ep.key + " 请求失败 err=[" + String(err) + "] status=" + (resp ? resp.statusCode : "无"));
          }
        } catch (e) {
          failCount++;
          console.log("[charge] cron " + ep.key + " 回调异常: " + (e && e.message ? e.message : String(e)));
        }
        onFinish();
      });
    })(targets[i]);
  }
  }
} catch (e) {
  console.log("[charge] cron 错误: " + (e && e.message ? e.message : String(e)));
  $done({});
}
