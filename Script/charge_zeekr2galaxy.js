// ============================================================
// charge_zeekr2galaxy.js
// 极氪家充桩 H5 (wallbox-sdk-zeekr) API 请求 -> 银河 recharge API 改道
// 用途：让极氪 App 的家充桩页面显示银河账号绑定的家桩（查看/管理类）
//
// 依赖：
//   1. Loon MITM 开启 sea-home-prod.haohanpower.tech / api-recharge.geely.com
//   2. charge_capture_token.js 已把 galaxyRechargeToken / galaxyUserId 写入持久化
//   3. token 约 30 分钟有效，过期后需要重新打开一次银河 App 刷新
//
// 说明：签名协议复刻银河 H5 buildApiSigature（AppKey 204184054），
//       密钥来自公开前端资源，仅限自用验证。
//       脚本内置 SHA-256/HMAC/Base64 纯 JS 实现，不依赖 Loon 运行时的 CryptoJS。
// ============================================================

// ---------------- 纯 JS 实现 SHA-256 / HMAC-SHA256 / Base64 ----------------
function sha256Bytes(msg) {
  // msg: 二进制字符串（ASCII 安全）；返回 32 字节二进制字符串
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
  function w32(n) {
    return String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  }
  var l = msg.length;
  var bitLenLo = (l * 8) >>> 0;
  var bitLenHi = Math.floor(l / 0x20000000) >>> 0; // 消息 < 2^32 bit 时通常为 0
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
      hh = g; g = f; f = e;
      e = (d + temp1) | 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) | 0;
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

// ---------------- 配置 ----------------
var GALAXY_TOKEN = $persistentStore.read("galaxyRechargeToken") || "";
var GALAXY_USER_ID = $persistentStore.read("galaxyUserId") || "";
var XCA_KEY = "204184054";
var XCA_SECRET = "Vxn15X98DNxNkI5UHvmtliqxPDvTeMBV";

// ---------------- 极氪 -> 银河 接口映射 ----------------
// path: 极氪 H5 请求的路径
// target: 银河 API 路径
// rewriteBody: (极氪body对象) => 银河body对象
var API_MAP = {
  "/app/equipment/v2/manage/getMyEquipments": {
    target: "/gep/v2/home/charge/getMyEquipments",
    rewriteBody: function (b) {
      b.sourceTypeKey = "0010000";
      b.userId = GALAXY_USER_ID;
      return b;
    }
  }
  // 深层接口（绑定桩后抓包补齐，例如）：
  // "/app/equipment/v2/manage/getMyEquipmentDetail": {
  //   target: "/gep/v1/home/charge/getMyEquipmentDetail",
  //   rewriteBody: function (b) {
  //     b.sourceTypeKey = "0010000";
  //     b.userId = GALAXY_USER_ID;
  //     return b;
  //   }
  // }
};

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function signRequest(method, path, nonce, timestamp) {
  // 与银河 H5 buildApiSigature 一致的签名串
  // 注意：签名串里的 Accept / Content-Type 必须与实际发送的请求头完全一致
  var accept = "application/json";
  var contentType = "application/json; charset=UTF-8";
  var lines = [
    method.toUpperCase(),
    accept,
    "",              // content-md5 位置（JS 协议为空）
    contentType,
    "",
    "X-Ca-Key:" + XCA_KEY,
    "X-Ca-Nonce:" + nonce,
    "X-Ca-Signature-Method:HmacSHA256",
    "X-Ca-Timestamp:" + timestamp,
    path
  ];
  var signStr = lines.join("\n");
  var digest = hmacSha256(XCA_SECRET, signStr);
  return {
    xCaKey: XCA_KEY,
    xCaSignature: b64encode(digest)
  };
}

// ---------------- 主流程 ----------------
try {
  var url = $request.url || "";
  var path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  console.log("[charge] match " + ($request.method || "") + " " + path);

  // 只处理映射表里的接口；未映射的（含 OPTIONS 预检）原样放行
  var rule = API_MAP[path];
  if (!rule) {
    console.log("[charge] 未映射，原样放行");
    $done({});
    return;
  }

  var method = ($request.method || "POST").toUpperCase();
  if (method === "OPTIONS") {
    console.log("[charge] OPTIONS 预检放行");
    $done({});
    return;
  }

  if (!GALAXY_TOKEN || !GALAXY_USER_ID) {
    console.log("[charge] 缺少银河token/userId: token=" + (GALAXY_TOKEN ? "有" : "无") + " userId=" + (GALAXY_USER_ID ? "有" : "无"));
    $notification.post(
      "充电桩修改：缺少银河token",
      "请先在银河App打开家充桩页面一次（会弹「银河token已更新」通知），再到极氪App查看",
      ""
    );
    $done({});
    return;
  }

  // 解析并改写请求体
  var bodyObj = {};
  try {
    bodyObj = JSON.parse($request.body || "{}");
  } catch (e) {}
  var newBody = JSON.stringify(rule.rewriteBody(bodyObj) || {});

  var nonce = uuidv4();
  var timestamp = String(Date.now());
  var s = signRequest(method, rule.target, nonce, timestamp);

  var headers = {
    "accept": "application/json",
    "content-type": "application/json; charset=UTF-8",
    "token": GALAXY_TOKEN,
    "channelid": "01701001",
    "x-ca-key": s.xCaKey,
    "x-ca-nonce": nonce,
    "x-ca-signature-method": "HmacSHA256",
    "x-ca-timestamp": timestamp,
    "x-ca-version": "1",
    "x-ca-signature-headers": "X-Ca-Key,X-Ca-Nonce,X-Ca-Signature-Method,X-Ca-Timestamp",
    "x-ca-signature": s.xCaSignature,
    "accept-language": "zh-CN,zh-Hans;q=0.9"
  };

  console.log("[charge] 改道 " + path + " -> " + rule.target + " 签名=" + s.xCaSignature);
  $done({
    url: "https://api-recharge.geely.com" + rule.target,
    method: method,
    headers: headers,
    body: newBody
  });
} catch (e) {
  console.log("[charge] 脚本错误: " + (e && e.message ? e.message : String(e)));
  $notification.post("充电桩修改 脚本错误", e && e.message ? e.message : String(e), "");
  $done({});
}
