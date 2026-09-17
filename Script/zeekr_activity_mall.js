// ============================================================
// zeekr_activity_mall.js  v2.0 (2026-09-17)
// 【活动H5 / 极物商城】请求级拦截 → 直接合成空响应，不发往上游
// v1 在 http-request 上下文里用 $done({status:200,body:"{}"})，这不是 Loon 认可的
// 合成响应写法（应为 $done({response:{...}})），实际没有生效；
// 现按 Loon 官方写法返回 response，并保留 $done({}) 兜底。
// argument: [{block},{debugNotify}]
// ============================================================

function argBool(idx) {
  try {
    var a = $argument;
    if (typeof a === "string" && a) a = JSON.parse(a);
    if (Array.isArray(a)) {
      var v = a[idx];
      return v === true || v === "true" || v === 1 || v === "1";
    }
  } catch (e) {}
  return false;
}

var DEBUG = argBool(1);
var url = String(($request && $request.url) || "");
var body = JSON.stringify({ success: true, code: "000000", msg: "成功", data: null, date: Date.now() });

try {
  if (DEBUG) $notification.post("ZEEKR NOAD", "已拦截活动H5/商城请求", url.slice(0, 80));
} catch (e) {}

if (typeof $response === "undefined") {
  $done({
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: body
    }
  });
} else {
  var headers = Object.assign({}, $response.headers || {});
  ["content-encoding", "Content-Encoding", "content-length", "Content-Length",
   "transfer-encoding", "Transfer-Encoding"].forEach(function (k) { delete headers[k]; });
  headers["content-type"] = "application/json";
  $done({ status: 200, headers: headers, body: body });
}
