// ============================================================
// zeekr_marketing.js  v3.0 (2026-11-18)
// 【营销接口统一处理】
//   · zeekrlife-mp-mkt/*                → 返回空数据（原有行为）
//   · phone/bannerDeploy/action/queryHomeBannerAndCopyWriting → 深度清洗营销字段
//   · phone/bannerDeploy/action/queryTravelLifeByPage         → 深度清洗营销字段
//   · phone/bannerDeploy/action/queryPopupForSdk              → 合成空响应（请求级）
//   · haohan-base-front/banner/get、/popup/get                → 合成空响应（请求级）
//   · api/mpbnr/v1/open/toc/apple/adTrace/receive             → 合成空响应（请求级）
//   · zeekrlife-mp-bnr/toc/v1/popup/record/create             → 合成空响应（请求级）
//
// v3.0 变化：合并此前独立的 zeekr_ads_scrubber.js 逻辑，避免插件新增远程脚本
//            资源导致 Loon 加载转圈（v7.1 已遇到该问题）。
//            归一化 camelCase 后按词匹配广告字段，避免误伤 addTime / readStatus。
//
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
var URL = String(($request && $request.url) || "");

var EMPTY_BODY = JSON.stringify({
  success: true,
  code: "000000",
  msg: "成功",
  data: null,
  date: Date.now()
});

// 纯广告 / 上报接口：整包合成空响应
var PURE_AD = /\/queryPopupForSdk|\/haohan-base-front\/(banner|popup)\/get|\/adTrace\/receive|\/popup\/record\/create/i;
// 混合内容接口：响应级清洗
var MIXED_AD = /\/queryHomeBannerAndCopyWriting|\/queryTravelLifeByPage/i;

function notify(title, sub) {
  try {
    if (DEBUG) $notification.post("ZEEKR NOAD", title, sub || "");
  } catch (e) {}
}

function finish(bodyText) {
  if (typeof $response === "undefined") {
    $done({ response: { status: 200, headers: { "content-type": "application/json" }, body: bodyText } });
  } else {
    var h = Object.assign({}, $response.headers || {});
    ["content-encoding", "Content-Encoding", "content-length", "Content-Length",
     "transfer-encoding", "Transfer-Encoding"].forEach(function (k) { delete h[k]; });
    h["content-type"] = "application/json";
    $done({ status: 200, headers: h, body: bodyText });
  }
}

// 归一化键名：homeBannerAd → home_banner_ad，marketingMaterialList → marketing_material_list
var AD_KEY = /(^|_)(ad|ads|advert|advertisement|banner|popup|promotion|promo|marketing|marketing_material|copywriting|float_icon|floating|guide_banner)(_|$)/;

function isAdKey(k) {
  var n = String(k).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return AD_KEY.test(n);
}

function blank(v) {
  if (typeof v === "string") return "";
  if (typeof v === "number") return 0;
  if (typeof v === "boolean") return false;
  if (Array.isArray(v)) return [];
  if (v && typeof v === "object") return {};
  return v;
}

function scrub(node, hits, depth) {
  if (!node || typeof node !== "object" || depth > 30) return;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) scrub(node[i], hits, depth + 1);
    return;
  }
  Object.keys(node).forEach(function (k) {
    var v = node[k];
    if (isAdKey(k)) {
      if (v !== null && v !== undefined && v !== "" && v !== 0 && v !== false) hits.push(k);
      node[k] = blank(v);
    } else if (v && typeof v === "object") {
      scrub(v, hits, depth + 1);
    }
  });
}

(function () {
  // 纯广告接口：请求 / 响应阶段都返回空，双保险
  if (PURE_AD.test(URL)) {
    notify("已屏蔽 首方弹窗/广告上报", URL.split("?")[0].slice(-70));
    finish(EMPTY_BODY);
    return;
  }

  // 混合内容接口：只清广告字段，保留正常业务数据
  if (MIXED_AD.test(URL)) {
    if (typeof $response === "undefined") { $done({}); return; }
    try {
      var body = JSON.parse($response.body || "{}");
      var hits = [];
      scrub(body && body.data, hits, 0);
      notify(hits.length ? "已清洗 营销/Banner 字段" : "营销接口未发现广告字段",
             hits.length ? hits.slice(0, 12).join(" / ") : URL.split("?")[0].slice(-70));
      finish(JSON.stringify(body));
    } catch (e) {
      notify("营销清洗脚本异常（放行原响应）", String((e && e.message) || e));
      $done({});
    }
    return;
  }

  // 原有行为：zeekrlife-mp-mkt/* 一律返回空
  if (typeof $response === "undefined") { $done({}); return; }
  try {
    if (DEBUG) $notification.post("ZEEKR NOAD", "已屏蔽营销接口", URL);
  } catch (e) {}
  finish(EMPTY_BODY);
})();
