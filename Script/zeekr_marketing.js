// ============================================================
// zeekr_marketing.js  v2.0 (2026-09-17)
// 【营销消息】zeekrlife-mp-mkt/* → 返回空数据
// 注意：v1 用 $done({status:200,body:"{}"})，在 http-response 里改写不生效，
//       现改成官方顶层 {status,headers,body} 并清 content-length/encoding。
// argument: [{blockMarketing},{debugNotify}]
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

if (typeof $response === "undefined") {
  $done({});
} else {
  try {
    if (DEBUG) $notification.post("ZEEKR NOAD", "已屏蔽营销接口", String($request && $request.url || ""));
  } catch (e) {}
  var headers = Object.assign({}, $response.headers || {});
  ["content-encoding", "Content-Encoding", "content-length", "Content-Length",
   "transfer-encoding", "Transfer-Encoding"].forEach(function (k) { delete headers[k]; });
  headers["content-type"] = "application/json";
  $done({
    status: 200,
    headers: headers,
    body: JSON.stringify({ success: true, code: "000000", msg: "成功", data: null, date: Date.now() })
  });
}
