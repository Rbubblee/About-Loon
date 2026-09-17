// ============================================================
// zeekr_brandcare.js  v2.0 (2026-09-17)
// 【首页浮窗】品牌关怀浮窗（当前创意：9月邀请好友试驾 / 邀好友得好礼）
// 接口: POST https://api-gw-toc.zeekrlife.com/zeekrlife-app-user/anniversary/2022/open/getBrandCare415Info
//       请求体 {"bubbleType":"1"}
//       响应体 {"success":true,"code":"000000","data":{"needLogin":0,"iconUrl":"...","isShow":1,
//                "linkUrl":"https://zeekrlife-h5.zeekrlife.com/pagesBannerActivity/inviteDrivePrize/index?...",
//                "title":"9月邀请好友试驾"},"date":...}
//
// 为什么改（旧版只做 body.data.isShow = 0，广告换创意后失效）：
//   1) 旧版用 $done({body})，网关返回 transfer-encoding: chunked / br 时改写不生效，
//      改用 Loon 官方顶层 $done({status,headers,body}) 并清掉 content-length / content-encoding
//      （同「充电桩修改 v6.3」已验证的修法）；transfer-encoding 头也一并清掉。
//   2) 新版 App 即使 isShow=0 仍可能凭 iconUrl/linkUrl 渲染浮窗，故把可渲染字段一起清空。
//   3) 再加一层请求级兜底：http-request 上下文直接合成「无浮窗」响应，根本不让上游下发广告，
//      不依赖任何响应改写能力（$done({response}) 在 Loon 3.5.x 已验证可用）。
//   4) 解析失败时回吐固定的空浮窗体，保证一定屏蔽。
//
// argument: [{blockBrandCare},{debugNotify}]
// ============================================================

var EMPTY_FLOAT = {
  needLogin: 0,
  iconUrl: "",
  isShow: 0,
  linkUrl: "",
  title: ""
};

var EMPTY_BODY = JSON.stringify({
  success: true,
  code: "000000",
  msg: "成功",
  data: EMPTY_FLOAT,
  date: Date.now()
});

function argBool(idx) {
  try {
    var a = $argument;
    if (typeof a === "string" && a) a = JSON.parse(a);
    if (Array.isArray(a)) {
      var v = a[idx];
      return v === true || v === "true" || v === 1 || v === "1";
    }
    if (a && typeof a === "object") {
      var v2 = a[idx];
      return v2 === true || v2 === "true" || v2 === 1 || v2 === "1";
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

function reply(text) {
  if (typeof $response === "undefined") {
    // http-request 上下文：合成响应，上游不再被请求
    $done({ response: { status: 200, headers: { "content-type": "application/json" }, body: text } });
  } else {
    $done({ status: 200, headers: cleanHeaders($response.headers), body: text });
  }
}

function wipeFloat(d) {
  if (!d || typeof d !== "object") return false;
  d.isShow = 0;
  d.needLogin = 0;
  ["iconUrl", "imgUrl", "imageUrl", "picUrl", "bannerUrl", "linkUrl", "url", "jumpUrl", "title"]
    .forEach(function (k) { if (typeof d[k] === "string") d[k] = ""; });
  return true;
}

(function () {
  // 请求阶段：直接返回空浮窗（最彻底，且省一次网络请求）
  if (typeof $response === "undefined") {
    notify("已屏蔽 首页浮窗（请求级合成）", "getBrandCare415Info 未请求上游");
    reply(EMPTY_BODY);
    return;
  }

  // 响应阶段：兜底改写（万一请求级规则未生效）
  try {
    var body = JSON.parse($response.body || "{}");
    if (wipeFloat(body && body.data)) {
      notify("已屏蔽 首页浮窗（响应级改写）", "isShow→0 且清空 iconUrl/linkUrl/title");
      reply(JSON.stringify(body));
      return;
    }
    body = body && typeof body === "object" ? body : {};
    body.success = true;
    body.code = "000000";
    body.data = Object.assign({}, EMPTY_FLOAT);
    notify("已屏蔽 首页浮窗（无 data 字段，已补空）", "");
    reply(JSON.stringify(body));
  } catch (e) {
    notify("浮窗脚本异常，已回吐空浮窗", String((e && e.message) || e));
    reply(EMPTY_BODY);
  }
})();
