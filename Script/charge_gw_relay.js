// ============================================================
// charge_gw_relay.js  v1.0（银河网关同源代理）
//
// 背景：galaxy-user-api / api-recharge 对携带 Origin 的浏览器请求一律 403
// （实测），而浏览器跨域请求必然带 Origin + 预检，所以页面无法直连网关。
//
// 方案：页面统一请求 https://h5-recharge.geely.com/galaxy-gw/<真实路径>
// 或 https://h5-recharge.geely.com/recharge-gw/<真实路径>——同源请求不带
// Origin、无预检；Loon 在这里把 URL 改写为真实网关地址发出，网关收到的是
// 无 Origin 的原生请求（签名 path 不变，签名仍然有效），响应按同源返回，
// 浏览器无需任何 CORS 头。
// ============================================================

// ---------------- 主流程 ----------------
try {
  var url = $request.url || "";
  var host = "";
  var prefix = "";
  if (url.indexOf("/galaxy-gw/") >= 0) {
    prefix = "/galaxy-gw/";
    host = "https://galaxy-user-api.geely.com";
  } else if (url.indexOf("/recharge-gw/") >= 0) {
    prefix = "/recharge-gw/";
    host = "https://api-recharge.geely.com";
  } else {
    $done({});
    return;
  }

  var path = url.substring(url.indexOf(prefix) + prefix.length - 1); // 保留前导 /
  var target = host + path;
  console.log("[charge] 同源代理 " + url + " -> " + target);
  $done({
    url: target,
    headers: $request.headers || {},
    body: $request.body || ""
  });
} catch (e) {
  console.log("[charge] 同源代理错误: " + (e && e.message ? e.message : String(e)));
  $done({});
}
