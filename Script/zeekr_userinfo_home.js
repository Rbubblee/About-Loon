// ============================================================
// zeekr_userhome.js  v1.1 (2026-10-22)
// 【我的页】用户卡片推荐位文案
// 接口: https://api-gw-toc.zeekrlife.com/zeekrlife-app-user/v1/user/info/home
//   响应里的 data.recommendText 实测为推广文案（抓包值："邀试驾[得好礼]"），
//   对应「我的」页/首页的邀好友试驾推广位。
//   ⚠️ 该接口同时提供昵称/头像/极分/勋章等正常数据，只清推广字段，不动其它内容。
//
// argument: [{blockUserRecommend},{debugNotify}]
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

// 推广字段：recommendText / recommendUrl / recommendLink / adText / adUrl / promotion*
var PROMO_KEY = /^(recommend|ad|promotion|promo|marketing)/i;
var PROFILE_PROMO = /宝藏精选|作品上传/;

function promoText(value) {
  if (!value || typeof value !== "object") return "";
  return ["name", "title", "subTitle", "subtitle", "desc", "description", "text", "label"]
    .map(function (k) { return String(value[k] || ""); })
    .join(" ");
}

function stripPromo(node, hits) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (var i = node.length - 1; i >= 0; i--) {
      var item = node[i];
      if (item && typeof item === "object" && PROFILE_PROMO.test(promoText(item))) {
        hits.push("推广卡片:" + promoText(item).trim().slice(0, 40));
        node.splice(i, 1);
      } else {
        stripPromo(item, hits);
      }
    }
    return;
  }
  Object.keys(node).forEach(function (k) {
    var v = node[k];
    if (PROMO_KEY.test(k)) {
      if (typeof v === "string") {
        if (v) hits.push(k + "=" + v);
        node[k] = "";
      } else if (typeof v === "number") {
        hits.push(k + "=" + v);
        node[k] = 0;
      } else if (v && typeof v === "object") {
        hits.push(k + "={...}");
        node[k] = Array.isArray(v) ? [] : {};
      }
    } else if (v && typeof v === "object" && PROFILE_PROMO.test(promoText(v))) {
      hits.push("推广卡片:" + promoText(v).trim().slice(0, 40));
      delete node[k];
    } else if (v && typeof v === "object") {
      stripPromo(v, hits);
    }
  });
}

(function () {
  // 该接口承载正常用户数据，请求阶段一律放行
  if (typeof $response === "undefined") { $done({}); return; }

  try {
    var body = JSON.parse($response.body || "{}");
    var hits = [];
    stripPromo(body && body.data, hits);
    if (hits.length) {
      notify("已屏蔽 我的页推荐位", hits.join(" / "));
    }
    $done({ status: 200, headers: cleanHeaders($response.headers), body: JSON.stringify(body) });
  } catch (e) {
    notify("我的页推荐位脚本异常（放行原响应）", String((e && e.message) || e));
    $done({});
  }
})();
