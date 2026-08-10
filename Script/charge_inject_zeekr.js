// ============================================================
// charge_inject_zeekr.js  v9.2（实时转发 + 控制转发 + 兜底注入，上下文自适应）
// 极氪家充桩的设备类接口（sea-home-prod /app/equipment/*）无论原生还是
// WebView 发出：
//   - http-request 上下文（主通道）：直接转发到银河 api-recharge，返回实时数据
//     （响应头 x-zeekr-live: 1），不再读历史缓存；
//   - 控制类（startCharge/stopCharge）：同样在 http-request 转发到银河真实控制接口，
//     让极氪页面的「开始/停止充电」按钮真正操作银河桩（6704 抓包确认契约：
//     POST /gep/v1/home/charge/startCharge，body 含 equipmentId/sourceTypeKey=0010000/
//     userId/providerNo，响应与极氪侧结构一致）；转发失败才放行极氪原生后端；
//   - http-response 上下文（兜底）：仅当实时转发失败/未映射/合成接口时，
//     用缓存 gx_<key> / 种子 / 合成响应填充，保证极氪App不因无数据报错。
//
// v9.1 变更（2026-08-10，依据 6704/6705 操作抓包）：
//   1) 新增控制转发：/app/equipment/v2/charge/startCharge → /gep/v1/home/charge/startCharge，
//      /app/equipment/v2/charge/stopCharge → /gep/v1/home/charge/stopCharge；
//      请求体把 sourceTypeKey 换成银河 0010000 并补 userId（来自登录存储），
//      其余字段（orderId 等）原样保留。控制响应直接返回（x-zeekr-live: 1），
//      失败时放行极氪原生后端（至少能建极氪侧订单，不报错）。
//   2) 读接口实时转发失败/无 token 时，http-request 阶段直接回退缓存/种子
//      （不再依赖 http-response 是否触发），响应头带 x-inject-source；
//   3) 修复 getEquipmentChargeOrders 缺 chargeTime 导致网关 500
//      （6704 实测：H5 请求带 chargeTime:"2026.08.10" 返回 200，cron 不带则 500）；
//   4) 缓存年龄按接口分别记录（gx_<key>_at），不再被单个失败接口拖累。
//
// v9.2 变更（2026-08-10，依据用户 Loon 日志）：
//   Loon 3.5.0(975) 上 sea-home-prod 的原生请求只触发 http-response，
//   http-request 不触发（登录页 relay 的 http-request 能跑，但极氪原生
//   设备类请求不跑）。因此把实时转发/控制转发同时实现到 http-response
//   上下文：
//   1) http-response 收到映射读接口 → 现场 $httpClient 转发银河并返回实时
//      数据（x-zeekr-live: 1）；失败/无 token → 缓存/种子兜底（x-inject-source）；
//   2) http-response 收到 startCharge/stopCharge → 转发银河真实控制接口，
//      成功返回银河结果；失败放行原始响应（极氪原生建单）；
//   3) getEquipmentConfigCenter（设备配置中心）新增合成响应（暂无真实样本，
//      用详情数据 + getEquipmentExt 结构填充，字段齐全避免原生解析报错）；
//   4) 头像注入：列表/详情响应补全多种头像字段（avatarUrl/avatar/userAvatar/
//      headImgUrl + userName/nickname），保留真实 URL（公网可达），兼容
//      极氪原生/WebView 不同字段名；列表项从详情缓存带出 owner 信息。
//
// v9.2.1 变更（2026-08-10，依据用户 Loon 日志）：
//   新增 setEquipmentConfigCenter（设备配置中心“保存”）→ 银河
//   /gep/v2/home/charge/updateMyEquipmentInfo 控制转发：极氪配置中心改
//   设备名/联网服务等提交时，真实写入银河（body 复制极氪字段，sourceTypeKey
//   换 0010000 并补 userId）；失败放行原生后端并弹通知，便于抓包校准字段。
//
// v9.2.2 变更（2026-08-10，依据用户反馈）：
//   1) 按钮可点击性：详情响应里 equipFuncInfoList 各项补 enable/support/
//      status/auth 启用标记，设备级补 funcEnable/bindStatus/isNeedBlueSk/
//      supportNewLinkEquipment 等字段，避免极氪页面因缺启用标记而禁用
//      「设备充电/蓝牙连接/充电记录」按钮；
//   2) 头像：优先用极氪账号头像（charge_capture_zeekr.js 从 user/info/query
//      抓取存入 zeekrAvatarUrl），没有才用银河头像；
//   3) 控制路径别名：/app/equipment/v2/manage/(startCharge|stopCharge) 也转发
//      银河（部分 H5 页面可能走 manage 前缀）；
//   4) 活跃标记：每次处理极氪设备请求写 galaxyLastZeekrActiveAt，供
//      charge_refresh_galaxy.js 做“活跃时 30s 刷新、空闲 10 分钟轻刷新”。
//
// v9.2.4 变更（2026-08-10，依据用户 Loon 日志）：
//   1) 控制请求体兜底：极氪原生 setEquipmentConfigCenter 等请求体可能为空
//      （6705 抓包里 getMyEquipments 也有空 body），equipmentId/providerNo
//      缺省时从 persistentStore（galaxyLastEquipmentId/galaxyLastProviderNo）
//      补齐，避免转发 body 只有 sourceTypeKey+userId 被网关拒绝；
//   2) 转发失败诊断：日志带 resp status + MITM 提示——若 $httpClient 到
//      api-recharge 持续 err=null，说明被 Loon 拦截（脚本发往 MITM 域名），
//      需把 api-recharge.geely.com 从插件 [MitM] 列表移除（v10.4 已移除，
//      改为直连，web 登录/cron 不受影响）。
//
// v7.0 变更（修复"点击充电桩进入绑定页"）：
//   1. 去掉 isH5 过滤：原生 ZeekrLife（Alamofire）请求同样注入——原生家充桩
//      首页（hh_energy://page/wallbox/homeCharge）的设备列表就是原生 getMyEquipments，
//      之前放行导致原生页永远拿到空列表。
//   2. 新增 checkBindMyEquipment 合成响应：极氪/浩瀚服务端不知道银河桩，点击桩时
//      返回 isNeedBlueSk=1（需要绑桩）→ 跳 /link-equipment/*。这里固定返回
//      isNeedBlueSk=0，让前端认为"无需绑桩"，从而进入设备页而不是绑定页。
//   3. 新增 getEquipmentExt 合成响应：设备信息页（/equipment-info/center）依赖它，
//      之前未映射会弹"未映射接口"且页面空白。
//   4. 关闭 http-request 改道后，响应脚本正常执行（Loon 对改道后的响应不再跑
//      http-response，v6 实测注入失效 + 银河网关 403），本脚本恢复为主通道。
//
// 依赖：charge_capture_galaxy.js 保存 token/userId/业务数据（打开银河App时刷新）；
//       charge_refresh_galaxy.js 每 30s 用原生签名刷新 gx_<key>。
// 降级：无缓存时回退内置种子数据；无映射接口弹通知（把路径发回补映射）。
//
// v8.0（2026-08-10 重构）：移除实验模式（enableMinimal）——实验模式只注入
// 列表+绑定判断、其余放行真实后端，导致 8.10 实测详情 403 页面空白。
// 重构后无条件注入全部已映射接口（详情/卡片/记录/扩展信息…），
// 与插件开关精简（10→5）配套。
//
// v8.1（2026-08-10 实时）：进入极氪家充桩页面时，每个被映射的接口请求都
// 现场用银河 token 实时拉取 api-recharge 对应接口再注入（数据即开即新，
// 不再等 30 秒 cron）；实时失败/无 token 时回退缓存 gx_<key>，再回退种子。
// 注：startCharge/stopCharge 等控制接口不做绑定校验，原生框架可用，
// 读接口的"账号-设备绑定"校验在服务端 DB，只能靠本注入绕过（见文档 C.12）。
//
// v9.0（2026-08-10 方案切换）：放弃"http-response 读缓存"作为主通道，
// 改为 http-request 阶段脚本内转发银河接口（与登录页 relay 同机制，
// $httpClient 在 http-request 上下文已验证可用；脚本内转发无 Origin/CORS 问题）。
//   1) 已映射读接口 → 实时转发银河，成功即返回（x-zeekr-live: 1）；
//   2) 转发失败/无token/未映射/合成/控制类 → 放行，由 http-response 兜底
//      （缓存/种子/合成），极氪App不会显示错误；
//   3) 兜底注入响应头仍带 x-inject-source: 缓存 Ns|种子|合成，来源可辨。
// ============================================================

var NOTIFY = String(($argument || [])[0]) !== "false";

var RECHARGE_KEY = "204195485";
var RECHARGE_SECRET = "CqPwP83wzdjesmLeDuzK6SljsYN5PvRM";
var API_HOST = "https://api-recharge.geely.com";
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

// ---------------- 按需刷新 recharge token（v9.2.3）----------------
// galaxy-user-api 签名（iOS key，与网页登录页一致）。与 charge_refresh_galaxy.js
// v1.5 常态化刷新同一链路：/api/v1/login/refresh → oauth2/code → getTokenByCode。
// 若 /login/refresh 被拒（Android key 场景），Loon 日志会打失败原因，
// 届时再切 suyunkai/geely-galaxy-assistant 的安卓 key(204179735)+deviceSN 参数。
var GALAXY_KEY = "204925390";
var GALAXY_SECRET = "bVy52qsT6U5ElPOZN4vTkhnMdzedMjx6";
var GALAXY_HOST = "https://galaxy-user-api.geely.com";

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
  if (token) hdrs.push(["token", token]);
  var sigHdrs = "";
  for (var i = 0; i < hdrs.length; i++) sigHdrs += (i ? "," : "") + hdrs[i][0];
  var lines = [method, accept, md5, ct, date];
  for (i = 0; i < hdrs.length; i++) lines.push(hdrs[i][0] + ":" + hdrs[i][1]);
  lines.push(path);
  var sig = b64encode(hmacSha256(GALAXY_SECRET, lines.join("\n")));
  var headers = {
    "User-Agent": "CA_iOS_SDK_2.0",
    "Accept": accept,
    "Content-Type": ct,
    "Date": date,
    "X-Galaxy-Date": date,
    "Content-MD5": md5,
    "X-Ca-Signature": sig,
    "X-Ca-Signature-Headers": sigHdrs,
    "appId": "galaxy-app",
    "appVersion": "1.53.0",
    "platform": "IOS",
    "tenantId": "569001701001"
  };
  for (i = 0; i < hdrs.length; i++) headers[hdrs[i][0]] = hdrs[i][1];
  return headers;
}

function refreshTokensOnDemand(cb) {
  // 1 分钟冷却，避免刷新失败时每个请求都触发慢请求
  var lastAttempt = parseInt($persistentStore.read("galaxyRefreshAttemptAt") || "0", 10);
  if (Date.now() - lastAttempt < 60000) { cb(false, "刷新冷却中（1分钟内已尝试）"); return; }
  $persistentStore.write(String(Date.now()), "galaxyRefreshAttemptAt");

  var rt = $persistentStore.read("galaxyCenterRefreshToken") || "";
  var ct = $persistentStore.read("galaxyCenterToken") || "";
  var uid = $persistentStore.read("galaxyUserId") || "";
  if (!rt || !uid) {
    console.log("[charge] 按需刷新：无 centerRefreshToken/userId，请先网页登录");
    cb(false, "无centerRefreshToken，请打开 h5-recharge.geely.com/galaxy-login 登录一次");
    return;
  }
  var refreshPath = "/api/v1/login/refresh?refreshToken=" + encodeURIComponent(rt);
  var h1 = galaxySign("GET", refreshPath, "", uid, ct);
  $httpClient.get({ url: GALAXY_HOST + refreshPath, headers: h1, timeout: 8000 }, function (err, resp, data) {
    try {
      if (!err && resp && resp.statusCode === 200 && data) {
        var j = JSON.parse(data);
        if (j.code === "success" && j.data && j.data.centerTokenDto && j.data.centerTokenDto.token) {
          var d = j.data.centerTokenDto;
          $persistentStore.write(d.token, "galaxyCenterToken");
          if (d.refreshToken) $persistentStore.write(d.refreshToken, "galaxyCenterRefreshToken");
          console.log("[charge] 按需刷新 centerToken 成功");
          var oauthPath = "/api/v1/oauth2/code?client_id=30000023&response_type=code&scope=snsapiUserinfo,snsapiMobile";
          var h2 = galaxySign("GET", oauthPath, "", uid, d.token);
          $httpClient.get({ url: GALAXY_HOST + oauthPath, headers: h2, timeout: 8000 }, function (err2, resp2, data2) {
            var code = "";
            try {
              var o = JSON.parse(data2);
              if (o.code === "success" && o.data && o.data.code) code = o.data.code;
            } catch (e) {}
            if (!code) {
              console.log("[charge] 按需刷新 oauth2/code 失败: " + String(data2).slice(0, 240));
              cb(false, "oauth2/code 失败");
              return;
            }
            var bodyStr = JSON.stringify({ code: code, sourceTypeKey: "0010000" });
            var h3 = signRecharge("POST", "/gep/v2/common/getTokenByCode", bodyStr, "");
            $httpClient.post({ url: API_HOST + "/gep/v2/common/getTokenByCode", headers: h3, body: bodyStr, timeout: 8000 }, function (err3, resp3, data3) {
              try {
                var t = JSON.parse(data3);
                if (t.code === "0" || t.code === 0) {
                  var td = t.data;
                  var nowSec = Math.floor(Date.now() / 1000);
                  $persistentStore.write(td.authToken, "galaxyRechargeToken");
                  $persistentStore.write(String(nowSec + (typeof td.expireAt === "number" && td.expireAt < 1000000000 ? td.expireAt : 1799)), "galaxyTokenExpiresAt");
                  if (td.refreshToken) $persistentStore.write(td.refreshToken, "galaxyRefreshToken");
                  console.log("[charge] 按需刷新 recharge token 成功");
                  cb(true, "");
                  return;
                }
                console.log("[charge] 按需刷新 getTokenByCode 失败: " + String(data3).slice(0, 240));
              } catch (e3) {}
              cb(false, "getTokenByCode 失败");
            });
          });
          return;
        }
        console.log("[charge] 按需刷新 centerToken 失败: " + String(data).slice(0, 240));
      } else {
        console.log("[charge] 按需刷新请求失败 err=" + String(err) + " status=" + (resp ? resp.statusCode : "无"));
      }
    } catch (e) {}
    cb(false, "login/refresh 失败");
  });
}

// ---------------- 接口映射与请求体构建 ----------------
function buildEquipmentExt() {
  // 设备信息页依赖 /app/equipment/v2/manage/getEquipmentExt；
  // 有 gx_getMyEquipmentDetail 缓存时尽量带出真实字段，否则用默认值。
  var d = null;
  try { d = (JSON.parse($persistentStore.read("gx_getMyEquipmentDetail") || "null") || {}).data || null; } catch (e) {}
  var eqId = (d && d.equipmentId) || $persistentStore.read("galaxyLastEquipmentId") || "";
  return JSON.stringify({
    code: "0",
    message: "SUCCESS",
    data: {
      equipmentId: eqId,
      equipmentName: (d && d.equipmentName) || "我的家桩",
      hardwareVersion: "",
      softwareVersion: "",
      activeDate: "",
      warrantyRestDays: null,
      iccId: "",
      sim: "",
      simRestDays: null,
      isNetworkService: 0,
      isShowSetEquipmentName: 1,
      isShowNetworkService: 1,
      manufacturerPhone: (d && d.manufacturerPhone) || "4001876000"
    }
  });
}

// 设备配置中心：暂无真实响应样本（极氪原生返回 403），用详情缓存合成
// 保守结构（与 getEquipmentExt 同源字段），保证原生解析不报错。
function buildConfigCenter() {
  var d = null;
  try { d = (JSON.parse($persistentStore.read("gx_getMyEquipmentDetail") || "null") || {}).data || null; } catch (e) {}
  var eqId = (d && d.equipmentId) || $persistentStore.read("galaxyLastEquipmentId") || "";
  return JSON.stringify({
    code: "0",
    message: "SUCCESS",
    data: {
      equipmentId: eqId,
      equipmentName: (d && d.equipmentName) || "我的家桩",
      providerNo: (d && d.providerNo) || "DIRECT_WDZ",
      sn: (d && d.blueName) || "",
      blueSk: (d && d.blueSk) || "",
      hardwareVersion: "",
      softwareVersion: "",
      activeDate: "",
      warrantyStartTime: (d && d.warrantyStartTime) || null,
      warrantyEndTime: (d && d.warrantyEndTime) || null,
      warrantyRestDays: null,
      iccId: "",
      sim: "",
      simRestDays: null,
      isNetworkService: 0,
      isShowSetEquipmentName: 1,
      isShowNetworkService: 1,
      manufacturerPhone: (d && d.manufacturerPhone) || "4001876000",
      isOta: (d && d.isOta) || 0
    }
  });
}

// ---------------- 头像注入（v9.2）----------------
// 极氪页面可能读 avatarUrl / avatar / userAvatar / headImgUrl 等不同字段，
// 注入时全部补齐（保留真实 URL：galaxy-oss 公网可达），列表项也带出 owner
// 信息，避免页面头像空白。
function enrichAvatar(bodyStr) {
  try {
    var obj = JSON.parse(bodyStr || "{}");
    var d = obj.data || null;
    if (!d) return bodyStr;
    var detail = null;
    try { detail = (JSON.parse($persistentStore.read("gx_getMyEquipmentDetail") || "null") || {}).data || null; } catch (e2) {}
    // 优先用极氪账号头像（charge_capture_zeekr.js 抓取），没有才用银河头像
    var zAvatar = $persistentStore.read("zeekrAvatarUrl") || "";
    var zName = $persistentStore.read("zeekrNickname") || "";
    var avatar = zAvatar ||
                 (detail && detail.equipOwnerInfo && detail.equipOwnerInfo.avatarUrl) ||
                 (d.equipOwnerInfo && d.equipOwnerInfo.avatarUrl) || "";
    var uname = zName ||
                (detail && detail.equipOwnerInfo && detail.equipOwnerInfo.userName) ||
                (d.equipOwnerInfo && d.equipOwnerInfo.userName) || "";
    function fillOwner(o) {
      if (!o || typeof o !== "object") return;
      if (avatar) {
        o.avatarUrl = avatar;
        o.avatar = avatar;
        o.userAvatar = avatar;
        o.headImgUrl = avatar;
      }
      if (uname) {
        o.userName = uname;
        o.nickname = uname;
      }
    }
    if (Array.isArray(d.resultList)) {
      for (var i = 0; i < d.resultList.length; i++) {
        var item = d.resultList[i];
        if (!item || typeof item !== "object") continue;
        fillOwner(item);
        if (!item.equipOwnerInfo) item.equipOwnerInfo = {};
        fillOwner(item.equipOwnerInfo);
        if (avatar && !item.avatarUrl) item.avatarUrl = avatar;
      }
    }
    if (d.equipOwnerInfo) fillOwner(d.equipOwnerInfo);
    fillOwner(d);
    // 按钮启用标记（v9.2.2）：极氪页面可能读 enable/support/status 决定按钮是否可点
    if (Array.isArray(d.equipFuncInfoList)) {
      for (var j = 0; j < d.equipFuncInfoList.length; j++) {
        var fn = d.equipFuncInfoList[j];
        if (!fn || typeof fn !== "object") continue;
        if (fn.enable === undefined) fn.enable = 1;
        if (fn.support === undefined) fn.support = 1;
        if (fn.status === undefined) fn.status = 1;
        if (fn.auth === undefined) fn.auth = 1;
        if (fn.isAuth === undefined) fn.isAuth = 1;
      }
    }
    // 设备级状态/绑定开关，避免页面禁用全部功能
    if (d.funcEnable === undefined) d.funcEnable = 1;
    if (d.bindStatus === undefined) d.bindStatus = 1;
    if (d.isBound === undefined) d.isBound = 1;
    if (d.isNeedBlueSk === undefined) d.isNeedBlueSk = 0;
    if (d.supportNewLinkEquipment === undefined) d.supportNewLinkEquipment = 0;
    if (d.isAuth === undefined) d.isAuth = 1;
    if (d.isOwner === undefined) d.isOwner = 1;
    // 状态兼容字段：地图/首页按钮通常读 equipStatusInfo.status（101=空闲）
    if (d.equipStatusInfo && d.equipStatusInfo.statusText === undefined) {
      d.equipStatusInfo.statusText = d.equipStatusInfo.desc || "";
    }
    if (d.equipStatusInfo && d.equipStatusInfo.chargeState === undefined) {
      var st = d.equipStatusInfo.status;
      d.equipStatusInfo.chargeState = (st === 101) ? 0 : (st ? 1 : 0);
    }
    return JSON.stringify(obj);
  } catch (e) {
    return bodyStr;
  }
}

var MAP = {
  "/app/equipment/v2/manage/getMyEquipments": { key: "getMyEquipments", target: "/gep/v2/home/charge/getMyEquipments", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u }; } },
  "/app/equipment/v2/manage/getMyEquipmentDetail": { key: "getMyEquipmentDetail", target: "/gep/v1/home/charge/getMyEquipmentDetail", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p }; } },
  "/app/equipment/v2/manage/getMyEquipmentCards": { key: "getMyEquipmentCards", target: "/gep/v2/home/charge/getMyEquipmentCards", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p }; } },
  "/app/equipment/v2/manage/getMyEquipmentShares": { key: "getMyEquipmentShares", target: "/gep/v1/home/charge/getMyEquipmentShares", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p }; } },
  "/app/equipment/v2/manage/getEquipmentVersions": { key: "getEquipmentVersions", target: "/gep/v1/home/charge/getEquipmentVersions", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p }; } },
  "/app/equipment/v2/manage/getEquipmentBindVins": { key: "getEquipmentBindVins", target: "/gep/v2/home/charge/getEquipmentBindVins", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p }; } },
  "/app/equipment/v2/manage/getEquipmentChargeOrders": { key: "getEquipmentChargeOrders", target: "/gep/v2/home/charge/getEquipmentChargeOrders", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p, calcType: 1, pageNum: 1, pageSize: 10 }; } },
  "/app/equipment/v2/manage/getEquipmentChargeOrderCalc": { key: "getEquipmentChargeOrderCalc", target: "/gep/v2/home/charge/getEquipmentChargeOrderCalc", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p, calcType: 1 }; } },
  "/app/equipment/v2/manage/equipmentCheck": { key: "equipmentCheck", target: "/gep/v1/home/charge/equipmentCheck", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p }; } },
  "/app/equipment/v2/charge/equipmentCheck": { key: "equipmentCheck", target: "/gep/v1/home/charge/equipmentCheck", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, equipmentId: eq, providerNo: p }; } },
  "/app/sim/v1/netflow/generateRenewUrl": { key: "generateRenewUrl", target: "/sim/v1/netflow/generateRenewUrl", body: function (u, eq, p) { return { sourceTypeKey: "0010000", userId: u, deviceSn: eq, providerNo: p }; } },
  // 合成接口：浩瀚服务端不认银河桩，直接返回"已绑定/无需绑桩"，避免进入绑定页
  "/app/equipment/v2/manage/checkBindMyEquipment": { key: "checkBindMyEquipment", target: "synthetic", synthetic: true, synth: function () { return '{"code":"0","message":"SUCCESS","data":{"isNeedBlueSk":0}}'; } },
  // 合成接口：设备信息页（/equipment-info/center）
  "/app/equipment/v2/manage/getEquipmentExt": { key: "getEquipmentExt", target: "synthetic", synthetic: true, synth: buildEquipmentExt }
};

// 设备配置中心：极氪原生未映射 → 合成响应（暂无真实样本，字段齐全防原生报错）
MAP["/app/equipment/v2/manage/getEquipmentConfigCenter"] = {
  key: "getEquipmentConfigCenter", target: "synthetic", synthetic: true, synth: buildConfigCenter
};

// ---------------- 控制接口映射（v9.1：极氪页面真正操作银河桩） ----------------
// 契约来自 6704（银河 App 原生）：POST /gep/v1/home/charge/startCharge
//   body {"equipmentId":"00000000000","sourceTypeKey":"0010000","userId":"9000000000000000000","providerNo":"DIRECT_WDZ"}
//   resp {"code":"0","message":"SUCCESS","data":{"equipmentId":..,"providerNo":"DIRECT_WDZ","orderId":"..","status":0,"failCode":null,"failReason":null}}
// stopCharge 端点未见抓包（桩空闲未启动），按同构约定 /gep/v1/home/charge/stopCharge，
// 请求体同 startCharge（可带 orderId）；首次使用后请核对银河 App 日志/抓包校准。
var CONTROL_MAP = {
  "/app/equipment/v2/charge/startCharge": { key: "startCharge", target: "/gep/v1/home/charge/startCharge" },
  "/app/equipment/v2/charge/stopCharge": { key: "stopCharge", target: "/gep/v1/home/charge/stopCharge" },
  "/app/equipment/v2/manage/startCharge": { key: "startCharge", target: "/gep/v1/home/charge/startCharge" },
  "/app/equipment/v2/manage/stopCharge": { key: "stopCharge", target: "/gep/v1/home/charge/stopCharge" },
  "/app/equipment/v2/manage/setEquipmentConfigCenter": { key: "setEquipmentConfigCenter", target: "/gep/v2/home/charge/updateMyEquipmentInfo" }
};

function buildControlBody(incomingBodyStr, userId) {
  // 极氪请求体 {"equipmentId":..,"sourceTypeKey":"0100000","providerNo":"DIRECT_WDZ"}
  // → 银河 {"equipmentId":..,"sourceTypeKey":"0010000","userId":..,"providerNo":"DIRECT_WDZ",[orderId]}
  var out = {};
  try {
    var src = JSON.parse(incomingBodyStr || "{}");
    for (var k in src) {
      if (k === "sourceTypeKey") continue;
      out[k] = src[k];
    }
  } catch (e) {}
  out.sourceTypeKey = "0010000";
  out.userId = userId;
  // 极氪原生请求体可能为空：equipmentId/providerNo 从存储补齐（v9.2.4）
  if (!out.equipmentId) out.equipmentId = $persistentStore.read("galaxyLastEquipmentId") || "";
  if (!out.providerNo) out.providerNo = $persistentStore.read("galaxyLastProviderNo") || "DIRECT_WDZ";
  return out;
}

function todayChargeTime() {
  var d = new Date(Date.now() + 8 * 3600 * 1000);
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return d.getUTCFullYear() + "." + p(d.getUTCMonth() + 1) + "." + p(d.getUTCDate());
}

function cacheAge(key) {
  var at = parseInt($persistentStore.read("gx_" + key + "_at") || $persistentStore.read("galaxyLastUpdatedAt") || "0", 10);
  if (!at) return -1;
  return Math.max(0, Math.round((Date.now() - at) / 1000));
}

// 种子：2026-08-07 真实抓包（银河 App）
var SEED = {
  "getMyEquipments": '{"code":"0","message":"SUCCESS","data":{"pager":null,"resultList":[{"equipmentId":"00000000000","providerNo":"DIRECT_WDZ","equipmentName":"我的家桩","isOwner":1,"bindTime":"2026-08-02 17:46:44","isAuth":1,"showAuth":1,"warrantyStartTime":null,"warrantyEndTime":null}]}}',
  "getMyEquipmentDetail": '{"code":"0","message":"SUCCESS","data":{"equipmentId":"00000000000","equipmentName":"我的家桩","providerNo":"DIRECT_WDZ","isOta":0,"isOwner":1,"isAuth":1,"blueSk":"00000000000000000000","blueName":"00000000000","equipFuncInfoList":[{"code":"0","desc":"设备充电"},{"code":"1","desc":"蓝牙连接"},{"code":"5","desc":"充电记录"},{"code":"6","desc":"家桩自检"},{"code":"7","desc":"家桩分享"},{"code":"4","desc":"设备升级"},{"code":"8","desc":"身份验证"},{"code":"9","desc":"即插即充"},{"code":"2","desc":"卡片管理"},{"code":"17","desc":"联网服务"}],"equipOwnerInfo":{"userId":"9000000000000000000","userName":"桩主","avatarUrl":"https://galaxy-oss.geely.com/app/galaxy-default.jpg","bindTime":"2026-08-02 17:46:44","shareTime":null},"equipSharedInfo":null,"equipStatusInfo":{"status":101,"desc":"设备空闲","displayMsgList":["桩侧未检测到插枪"]},"warrantyStartTime":null,"warrantyEndTime":null,"manufacturerPhone":"4001876000","otaRemindInfo":{"remindTypeList":null,"pictureUrl":null}}}',
  "checkBindMyEquipment": '{"code":"0","message":"SUCCESS","data":{"isNeedBlueSk":0}}',
  "getEquipmentExt": '{"code":"0","message":"SUCCESS","data":{"equipmentId":"00000000000","equipmentName":"我的家桩","hardwareVersion":"","softwareVersion":"","activeDate":"","warrantyRestDays":null,"iccId":"","sim":"","simRestDays":null,"isNetworkService":0,"isShowSetEquipmentName":1,"isShowNetworkService":1,"manufacturerPhone":"4001876000"}}'
};

// ---------------- 工具 ----------------
function getHeader(headers, name) {
  if (!headers) return "";
  var lower = name.toLowerCase();
  for (var k in headers) { if (k.toLowerCase() === lower) return headers[k]; }
  return "";
}

// ---------------- http-request 主通道：实时转发银河接口 ----------------
function respond(status, headers, body, isResponse) {
  if (isResponse) {
    // Loon 3.5.0 官方格式：http-response 修改响应用顶层 {status,headers,body}
    $done({ status: status, headers: headers, body: body });
  } else {
    $done({ response: { status: status, headers: headers, body: body } });
  }
}

function serveFallback(key, isResponse) {
  var cached = $persistentStore.read("gx_" + key);
  if (cached) {
    respond(200, { "content-type": "application/json", "x-inject-source": "缓存 " + cacheAge(key) + "s" }, enrichAvatar(cached), isResponse);
    return true;
  }
  if (SEED[key]) {
    respond(200, { "content-type": "application/json", "x-inject-source": "种子" }, enrichAvatar(SEED[key]), isResponse);
    return true;
  }
  return false;
}

function relayLive() {
  var method = String($request.method || "POST").toUpperCase();
  if (method !== "POST") { $done({}); return; } // OPTIONS 预检等放行
  var url = $request.url || "";
  var path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  // 活跃标记：极氪在充电桩页面活动时，cron 才保持 30s 刷新（v9.2.2）
  if (path.indexOf("/app/equipment/") === 0) {
    try { $persistentStore.write(String(Date.now()), "galaxyLastZeekrActiveAt"); } catch (e4) {}
  }
  var control = CONTROL_MAP[path];
  if (control) {
    relayControl(path, control);
    return;
  }
  var rule = MAP[path];
  if (!rule) { $done({}); return; } // 未映射放行
  if (rule.synthetic) {
    // 合成接口在 http-request 直接返回，不再让请求打到真实后端
    var synthBody = rule.synth();
    if (synthBody) {
      console.log("[charge] 合成注入 " + path + " -> " + rule.key);
      $done({ response: { status: 200, headers: { "content-type": "application/json", "x-inject-source": "合成" }, body: synthBody } });
      return;
    }
    $done({});
    return;
  }
  var token = $persistentStore.read("galaxyRechargeToken") || "";
  var userId = $persistentStore.read("galaxyUserId") || "";
  var expiresAt = parseInt($persistentStore.read("galaxyTokenExpiresAt") || "0", 10);
  var nowSec = Math.floor(Date.now() / 1000);
  if (!token || !userId || (expiresAt && nowSec > expiresAt - 60)) {
    // 无有效 token：http-request 直接回退缓存/种子，保证页面有数据
    console.log("[charge] 实时转发跳过（无token/过期），http-request 直接回退 " + rule.key);
    if (serveFallback(rule.key, false)) return;
    $done({});
    return;
  }
  var eq = $persistentStore.read("galaxyLastEquipmentId") || "";
  var provider = $persistentStore.read("galaxyLastProviderNo") || "DIRECT_WDZ";
  try {
    var bodyObj = rule.body(userId, eq, provider);
    // 充电记录分页/时间参数优先取极氪请求体（6704：chargeTime 必填，缺了网关 500）
    if (rule.key === "getEquipmentChargeOrders") {
      try {
        var zBody = JSON.parse($request.body || "{}");
        if (zBody.pageNum) bodyObj.pageNum = zBody.pageNum;
        if (zBody.pageSize) bodyObj.pageSize = zBody.pageSize;
        if (zBody.chargeTime) bodyObj.chargeTime = zBody.chargeTime;
        if (zBody.calcType !== undefined) bodyObj.calcType = zBody.calcType;
      } catch (e2) {}
      if (!bodyObj.chargeTime) bodyObj.chargeTime = todayChargeTime();
    }
    var bodyStr = JSON.stringify(bodyObj);
    var headers = signRecharge("POST", rule.target, bodyStr, token);
    $httpClient.post({
      url: API_HOST + rule.target,
      headers: headers,
      body: bodyStr,
      timeout: 5000
    }, function (err, resp, data) {
      try {
        if (!err && resp && resp.statusCode === 200 && data) {
          var j = JSON.parse(data);
          if (j.code === "0" || j.code === 0 || j.code === "success") {
            $persistentStore.write(data, "gx_" + rule.key);
            $persistentStore.write(String(Date.now()), "gx_" + rule.key + "_at");
            $persistentStore.write(String(Date.now()), "galaxyLastUpdatedAt");
            if (rule.key === "getMyEquipments") {
              var list = (j.data && j.data.resultList) || [];
              if (list.length > 0) {
                $persistentStore.write(String(list[0].equipmentId || ""), "galaxyLastEquipmentId");
                $persistentStore.write(String(list[0].providerNo || provider), "galaxyLastProviderNo");
              }
            }
            var outH = { "content-type": "application/json", "x-zeekr-live": "1" };
            console.log("[charge] 实时转发 " + path + " -> " + rule.target);
            respond(200, outH, enrichAvatar(data), false);
            return;
          }
        }
      } catch (e) {}
      console.log("[charge] 实时转发失败，http-request 直接回退缓存/种子: " + rule.key + " err=" + String(err));
      if (serveFallback(rule.key, false)) return;
      $done({});
    });
  } catch (e) {
    console.log("[charge] 实时转发异常，http-request 直接回退: " + rule.key);
    if (serveFallback(rule.key, false)) return;
    $done({});
  }
}

// ---------------- 控制接口转发：极氪按钮 → 银河真实操作 ----------------
function relayControl(path, control, isResponse) {
  var token = $persistentStore.read("galaxyRechargeToken") || "";
  var userId = $persistentStore.read("galaxyUserId") || "";
  var expiresAt = parseInt($persistentStore.read("galaxyTokenExpiresAt") || "0", 10);
  var nowSec = Math.floor(Date.now() / 1000);
  if (!token || !userId || (expiresAt && nowSec > expiresAt - 60)) {
    console.log("[charge] 控制转发跳过（无token/过期），尝试按需刷新: " + control.key);
    refreshTokensOnDemand(function (ok, why) {
      if (ok) {
        relayControl(path, control, isResponse); // 递归重试（token 已刷新，只进一层）
        return;
      }
      console.log("[charge] 控制转发跳过（刷新失败），放行极氪原生后端: " + control.key + " " + why);
      if (NOTIFY) $notification.post("充电桩修改：控制未转发", control.key + " 银河token刷新失败（" + why + "），已放行原生后端", "");
      $done({});
    });
    return;
  }
  try {
    var bodyObj = buildControlBody($request.body, userId);
    var bodyStr = JSON.stringify(bodyObj);
    var headers = signRecharge("POST", control.target, bodyStr, token);
    console.log("[charge] 控制转发 " + path + " -> " + control.target + " body=" + bodyStr);
    $httpClient.post({
      url: API_HOST + control.target,
      headers: headers,
      body: bodyStr,
      timeout: 8000
    }, function (err, resp, data) {
      try {
        if (!err && resp && resp.statusCode === 200 && data) {
          var j = JSON.parse(data);
          if (j.code === "0" || j.code === 0 || j.code === "success") {
            respond(200, { "content-type": "application/json", "x-zeekr-live": "1" }, data, isResponse);
            var oid = (j.data && j.data.orderId) || "";
            if (NOTIFY) $notification.post("充电桩修改：操作已下发", control.key + " 成功" + (oid ? "（银河 orderId=" + oid + "）" : ""), "");
            return;
          }
          // 银河返回业务错误（如桩离线/未插枪）：把真实结果回给极氪页面显示
          console.log("[charge] 控制转发业务失败: " + control.key + " " + String(data).slice(0, 200));
          respond(200, { "content-type": "application/json", "x-zeekr-live": "1" }, data, isResponse);
          if (NOTIFY) $notification.post("充电桩修改：操作失败", control.key + " " + String((j && j.message) || ""), "");
          return;
        }
      } catch (e3) {}
      console.log("[charge] 控制转发请求失败，放行极氪原生后端: " + control.key + " err=" + String(err) + " status=" + (resp ? resp.statusCode : "无") + "（若持续err=null：确认插件MITM已移除api-recharge.geely.com）");
      if (NOTIFY) $notification.post("充电桩修改：控制转发失败", control.key + " 已放行原生后端（err=" + String(err) + "），见Loon日志", "");
      $done({});
    });
  } catch (e) {
    console.log("[charge] 控制转发异常，放行极氪原生后端: " + control.key);
    $done({});
  }
}

// ---------------- http-response 主通道（v9.2）----------------
// Loon 3.5.0(975) 实测：sea-home-prod 原生请求只触发 http-response，
// http-request 不触发。因此在这里同样做实时转发 + 控制转发，
// 失败/无 token 再兜底缓存/种子；控制失败放行原始响应（极氪原生建单）。
function relayInResponse() {
  var method = String($request.method || "POST").toUpperCase();
  if (method !== "POST") {
    console.log("[charge] 非POST（CORS预检等），放行: " + method);
    $done({});
    return;
  }
  var url = $request.url || "";
  var path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  // 活跃标记：极氪在充电桩页面活动时，cron 才保持 30s 刷新（v9.2.2）
  if (path.indexOf("/app/equipment/") === 0) {
    try { $persistentStore.write(String(Date.now()), "galaxyLastZeekrActiveAt"); } catch (e4) {}
  }
  var control = CONTROL_MAP[path];
  if (control) {
    relayControl(path, control, true);
    return;
  }
  var rule = MAP[path];
  if (!rule) {
    console.log("[charge] 未映射极氪接口: " + path);
    if (NOTIFY) $notification.post("充电桩修改：未映射接口", path + "（把这条发给我，我来加映射）", "");
    $done({});
    return;
  }
  if (rule.synthetic) {
    var synthBody = rule.synth();
    if (synthBody) {
      console.log("[charge] 合成注入 " + path + " -> " + rule.key);
      respond(200, { "content-type": "application/json", "x-inject-source": "合成" }, synthBody, true);
      return;
    }
    $done({});
    return;
  }

  var token = $persistentStore.read("galaxyRechargeToken") || "";
  var userId = $persistentStore.read("galaxyUserId") || "";
  var expiresAt = parseInt($persistentStore.read("galaxyTokenExpiresAt") || "0", 10);
  var nowSec = Math.floor(Date.now() / 1000);
  if (!token || !userId || (expiresAt && nowSec > expiresAt - 60)) {
    console.log("[charge] http-response 转发跳过（无token/过期），尝试按需刷新 " + rule.key);
    refreshTokensOnDemand(function (ok, why) {
      if (ok) {
        relayInResponse(); // 递归重试（token 已刷新，只进一层）
        return;
      }
      console.log("[charge] 刷新失败，直接兜底 " + rule.key + " " + why);
      if (serveFallback(rule.key, true)) return;
      $done({});
    });
    return;
  }

  var eq = $persistentStore.read("galaxyLastEquipmentId") || "";
  var provider = $persistentStore.read("galaxyLastProviderNo") || "DIRECT_WDZ";
  try {
    var bodyObj = rule.body(userId, eq, provider);
    if (rule.key === "getEquipmentChargeOrders") {
      try {
        var zBody = JSON.parse($request.body || "{}");
        if (zBody.pageNum) bodyObj.pageNum = zBody.pageNum;
        if (zBody.pageSize) bodyObj.pageSize = zBody.pageSize;
        if (zBody.chargeTime) bodyObj.chargeTime = zBody.chargeTime;
        if (zBody.calcType !== undefined) bodyObj.calcType = zBody.calcType;
      } catch (e2) {}
      if (!bodyObj.chargeTime) bodyObj.chargeTime = todayChargeTime();
    }
    var bodyStr = JSON.stringify(bodyObj);
    var headers = signRecharge("POST", rule.target, bodyStr, token);
    $httpClient.post({
      url: API_HOST + rule.target,
      headers: headers,
      body: bodyStr,
      timeout: 5000
    }, function (err, resp, data) {
      try {
        if (!err && resp && resp.statusCode === 200 && data) {
          var j = JSON.parse(data);
          if (j.code === "0" || j.code === 0 || j.code === "success") {
            $persistentStore.write(data, "gx_" + rule.key);
            $persistentStore.write(String(Date.now()), "gx_" + rule.key + "_at");
            $persistentStore.write(String(Date.now()), "galaxyLastUpdatedAt");
            if (rule.key === "getMyEquipments") {
              var list = (j.data && j.data.resultList) || [];
              if (list.length > 0) {
                $persistentStore.write(String(list[0].equipmentId || ""), "galaxyLastEquipmentId");
                $persistentStore.write(String(list[0].providerNo || provider), "galaxyLastProviderNo");
              }
            }
            console.log("[charge] http-response 实时转发 " + path + " -> " + rule.target);
            respond(200, { "content-type": "application/json", "x-zeekr-live": "1" }, enrichAvatar(data), true);
            return;
          }
        }
      } catch (e3) {}
      console.log("[charge] http-response 实时转发失败，兜底缓存/种子: " + rule.key + " err=" + String(err));
      if (serveFallback(rule.key, true)) return;
      $done({});
    });
  } catch (e) {
    console.log("[charge] http-response 实时转发异常，兜底缓存/种子: " + rule.key);
    if (serveFallback(rule.key, true)) return;
    $done({});
  }
}

// ---------------- 主流程 ----------------
try {
  var isResponse = (typeof $response !== "undefined") && $response;
  if (!isResponse) {
    relayLive();
    return;
  }
  // http-request 已实时转发并返回（x-zeekr-live），http-response 不再处理
  if (getHeader(($response && $response.headers) || {}, "x-zeekr-live")) {
    $done({});
    return;
  }
  // v9.2：http-response 也做实时转发/控制转发，失败再兜底
  relayInResponse();
} catch (e) {
  console.log("[charge] 错误: " + (e && e.message ? e.message : String(e)));
  $notification.post("充电桩修改 脚本错误", e && e.message ? e.message : String(e), "");
  $done({});
}
