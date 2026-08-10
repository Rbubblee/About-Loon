// ============================================================
// charge_capture_zeekr.js  v1.0（抓取极氪账号头像/昵称，供注入使用）
// 极氪 App 用户信息接口（api-gw-toc.zeekrlife.com）响应里带真实头像：
//   /zeekrlife-app-user/v1/user/info/query
//   /zeekrlife-app-user/v1/user/info/home
// 抓到后写入 persistentStore：
//   zeekrAvatarUrl  → 注入时优先用作桩主头像（避免银河头像在极氪 App 不显示）
//   zeekrNickname   → 桩主昵称
// 脚本本身不改响应（$done({}) 放行），只做旁路记录。
// ============================================================

function getH(headers, name) {
  if (!headers) return "";
  var lower = name.toLowerCase();
  for (var k in headers) { if (k.toLowerCase() === lower) return headers[k]; }
  return "";
}

try {
  var url = ($request && $request.url) || "";
  var body = ($response && $response.body !== undefined) ? $response.body : "";
  if (!body) { $done({}); return; }
  var obj = null;
  try { obj = JSON.parse(body); } catch (e) {}
  if (!obj) { $done({}); return; }

  var d = obj.data || obj.result || null;
  if (!d || typeof d !== "object") { $done({}); return; }

  // 兼容几种响应结构：data.avatar / data.userInfoDTO.avatar / data.data.userInfoDTO
  var avatar = d.avatar || (d.userInfoDTO && d.userInfoDTO.avatar) || "";
  var nick = d.nickname || (d.userInfoDTO && d.userInfoDTO.nickname) || "";
  if (d.userInfoDTO) {
    if (!avatar) avatar = d.userInfoDTO.avatar || "";
    if (!nick) nick = d.userInfoDTO.nickname || "";
  }
  if (avatar) {
    $persistentStore.write(String(avatar), "zeekrAvatarUrl");
    console.log("[charge] 已缓存极氪头像 " + String(avatar).slice(0, 80));
  }
  if (nick) {
    $persistentStore.write(String(nick), "zeekrNickname");
    console.log("[charge] 已缓存极氪昵称 " + String(nick));
  }
} catch (e) {
  console.log("[charge] 极氪头像捕获异常: " + (e && e.message ? e.message : String(e)));
}

$done({});
