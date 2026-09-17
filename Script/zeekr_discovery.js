// ============================================================
// zeekr_discovery.js  v2.0 (2026-09-17)
// 【社区】发现页活动推荐 / 卡片推荐 → 返回空列表
// 接口: zeekrlife-bbs-theme/v1/discovery/pub/list/activitySessionListWithRecommendationsV2
//       zeekrlife-bbs-theme/toc/v1/srv/card/list
// v1 返回 "{}"，App 侧解析 data 会拿到 undefined；这里返回结构完整的空 data，
// 同时用官方顶层 $done 并清 content-length/encoding。
// argument: [{blockCommunityDiscovery},{debugNotify}]
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
    if (DEBUG) $notification.post("ZEEKR NOAD", "已屏蔽社区发现页/卡片", String($request && $request.url || ""));
  } catch (e) {}
  var headers = Object.assign({}, $response.headers || {});
  ["content-encoding", "Content-Encoding", "content-length", "Content-Length",
   "transfer-encoding", "Transfer-Encoding"].forEach(function (k) { delete headers[k]; });
  headers["content-type"] = "application/json";
  $done({
    status: 200,
    headers: headers,
    body: JSON.stringify({ success: true, code: "000000", msg: "成功", data: [], date: Date.now() })
  });
}
