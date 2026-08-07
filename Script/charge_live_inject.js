// ============================================================
// charge_live_inject.js  v1.0（往极氪H5页面注入实时客户端）
//
// 拦截 c-h5-prod.haohanpower.tech/wallbox-sdk/zeekr/* 的 HTML 响应，
// 在 </body> 前注入：
//   <script src="https://h5-recharge.geely.com/wallbox-client.js"></script>
// 由 charge_live_client.js 拦截设备类请求并实时拉取银河数据。
// 非 HTML 响应（js/css/图片）直接放行。
// ============================================================

var NOTIFY = String(($argument || [])[0]) !== "false";

var SNIPPET = "<script>!function(){var s=document.createElement('script');s.src='https://h5-recharge.geely.com/wallbox-client.js';document.head.appendChild(s);}();<\/script>";

// ---------------- 主流程 ----------------
try {
  var body = $response.body || "";
  var ct = String(($response.headers || {})["content-type"] || "");
  var isHtml = ct.indexOf("text/html") >= 0 || body.indexOf("<!doctype html") >= 0 || body.indexOf("<div id=\"app\"") >= 0;
  if (!isHtml) {
    $done({});
    return;
  }

  var injected = false;
  if (body.indexOf("</body>") >= 0) {
    body = body.replace("</body>", SNIPPET + "</body>");
    injected = true;
  } else if (body.indexOf("</head>") >= 0) {
    body = body.replace("</head>", SNIPPET + "</head>");
    injected = true;
  }
  if (!injected) {
    console.log("[charge] 实时客户端注入失败：HTML 无 </body>/</head>");
    $done({});
    return;
  }

  var headers = $response.headers || {};
  delete headers["content-encoding"];
  delete headers["Content-Encoding"];
  delete headers["content-length"];
  delete headers["Content-Length"];
  console.log("[charge] 已注入实时客户端");
  if (NOTIFY) $notification.post("充电桩修改：实时模式已注入", "极氪H5页面已启用实时拉取（token 有效期内）", "");
  $done({ status: 200, headers: headers, body: body });
} catch (e) {
  console.log("[charge] 实时客户端注入错误: " + (e && e.message ? e.message : String(e)));
  $done({});
}
