// ============================================================
// zeekr_homepage.js  v2.0 (2026-09-17)
// 【首页】低代码首页模块（官方资讯 / 分类模块 / banner位）
// 接口: https://api-gw-toc.zeekrlife.com/zeekrlife-mp-bnr/toc/v1/lowPage/open/getView
//   请求体 {"code":"index"}，响应 data.components[] 为首页各模块。
//   注意：首页浮窗（邀请好友试驾/邀好友得好礼）不在这个接口，而在
//   zeekrlife-app-user/anniversary/2022/open/getBrandCare415Info（见 zeekr_brandcare.js）。
//
// argument: [{blockHomepage},{debugNotify}]
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

function notify(title, sub) {
  try {
    if (DEBUG) $notification.post("ZEEKR NOAD", title, sub || "");
  } catch (e) {}
}

function cleanHeaders(h) {
  h = Object.assign({}, h || {});
  ["content-encoding", "Content-Encoding", "content-length", "Content-Length",
   "transfer-encoding", "Transfer-Encoding"].forEach(function (k) { delete h[k]; });
  h["content-type"] = "application/json";
  return h;
}

(function () {
  if (typeof $response === "undefined") { $done({}); return; }
  try {
    var body = JSON.parse($response.body || "{}");
    if (body && body.data && Array.isArray(body.data.components)) {
      var n = body.data.components.length;
      body.data.components = [];
      notify("已清空首页低代码模块", "components: " + n + " → 0");
    }
    $done({ status: 200, headers: cleanHeaders($response.headers), body: JSON.stringify(body) });
  } catch (e) {
    notify("首页脚本异常（放行原响应）", String((e && e.message) || e));
    $done({});
  }
})();
