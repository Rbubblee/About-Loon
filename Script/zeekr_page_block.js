// ============================================================
// zeekr_page_block.js  v7.0 (2026-10-22)
// 社区 / 商城整页请求级屏蔽。
//
// 工作方式：
//   1. API 请求返回结构稳定的空 JSON，不访问上游；
//   2. H5 页面请求返回本地占位页；
//   3. 仅拦截插件中明确配置的 URL，不影响登录、车辆、充电和消息。
//
// argument: [{blockPage},{debugNotify}]
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

var ENABLED = argBool(0);
var DEBUG = argBool(1);
var url = String(($request && $request.url) || "");
var headers = ($request && $request.headers) || {};
var accept = String(headers.Accept || headers.accept || "");

function notify(title) {
  try {
    if (DEBUG) $notification.post("ZEEKR NOAD", title, url.slice(0, 120));
  } catch (e) {}
}

function htmlResponse() {
  return [
    "<!doctype html>",
    "<html><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">",
    "<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;",
    "background:#f5f5f5;color:#666;font:16px -apple-system,BlinkMacSystemFont,sans-serif}",
    ".card{padding:28px 36px;border-radius:18px;background:#fff;text-align:center;",
    "box-shadow:0 8px 30px rgba(0,0,0,.06)}h1{margin:0 0 8px;font-size:18px;color:#222}",
    "p{margin:0;font-size:13px}</style></head><body>",
    "<div class=\"card\"><h1>页面已屏蔽</h1><p>ZEEKR NOAD</p></div>",
    "</body></html>"
  ].join("");
}

function emptyJson() {
  return JSON.stringify({
    success: true,
    code: "000000",
    msg: "页面已屏蔽",
    data: {
      records: [],
      list: [],
      total: 0,
      hasMore: false
    },
    date: Date.now()
  });
}

if (!ENABLED) {
  $done({});
} else {
  notify("已屏蔽社区/商城请求");
  var isHtml = accept.indexOf("text/html") >= 0;
  if (isHtml) {
    $done({
      response: {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        },
        body: htmlResponse()
      }
    });
  } else {
    $done({
      response: {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        },
        body: emptyJson()
      }
    });
  }
}
