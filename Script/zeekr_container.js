// ============================================================
// zeekr_container.js  v2.1 (2026-10-22)
// 通用容器接口（弹窗 / 社区banner / 我的页推广位都走这里）
// 接口: https://api-gw-toc.zeekrlife.com/zeekrlife-mp-bnr/open/v1/container/page
//
// 抓包实测的 tag/type（2026-09-17）:
//   tag=BBS     name=APP开屏弹窗（新）        type=open   ← 开屏弹窗
//   tag=BBS     name=APP首页启动弹窗          type=popup  ← 首页启动弹窗
//   tag=BBS     name=推荐顶部banner（3.16版本） type=banner ← 社区顶部banner
//   tag=BBS     name=0307新金刚位             type=banner ← 社区金刚位
//   tag=BBS_MSG name=...                      type=...    ← 社区内容区
//   tag=PARTNERLEAGUE ...                                 ← 合作伙伴
//   tag=HAIBAO  name=个人页                    type=banner ← 我的页（推广位在 places[]）
//   tag=OVSERVICE name=充电地图/用车服务/...              ← 用车服务（保留）
//
// v2.0 变化:
//   1) 弹窗(type=popup/open)与社区banner分开控制，开关互不影响；
//   2) 我的页 places[] 推广位按名称黑名单清理（原规则写死"主题专区限时开放"，广告换名即失效）；
//   3) 规则不再用 enable={blockCommunityBanner} 单开关门控 —— 那样关掉社区banner就会连我的页过滤一起失效；
//   4) 改用官方顶层 $done({status,headers,body}) 并清 content-length/content-encoding。
//
// argument: [{blockPopup},{blockCommunityBanner},{blockCommunityContent},{blockProfileAds},{debugNotify}]
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

var BLOCK_POPUP = argBool(0);
var BLOCK_BANNER = argBool(1);
var BLOCK_CONTENT = argBool(2);
var BLOCK_PROFILE = argBool(3);
var DEBUG = argBool(4);

// 我的页 places[] 推广位名称黑名单（可继续追加）
var PROMO_PLACE = /主题专区|限时开放|得好礼|邀好友得好礼|宝藏精选|作品上传|了解详情|广告|推广/;
var PROFILE_PROMO = /宝藏精选|作品上传/;

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

function promoText(value) {
  if (!value || typeof value !== "object") return "";
  return ["name", "title", "subTitle", "subtitle", "desc", "description", "text", "label"]
    .map(function (k) { return String(value[k] || ""); })
    .join(" ");
}

// 推广卡片不一定只出现在 places[]，也可能藏在 content/cards/items 等数组。
function stripPromoObjects(node, hits) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (var i = node.length - 1; i >= 0; i--) {
      var item = node[i];
      if (item && typeof item === "object" && PROFILE_PROMO.test(promoText(item))) {
        hits.push("推广卡片:" + promoText(item).trim().slice(0, 40));
        node.splice(i, 1);
      } else {
        stripPromoObjects(item, hits);
      }
    }
    return;
  }
  Object.keys(node).forEach(function (k) {
    var child = node[k];
    if (child && typeof child === "object" && PROFILE_PROMO.test(promoText(child))) {
      hits.push("推广卡片:" + promoText(child).trim().slice(0, 40));
      delete node[k];
    } else {
      stripPromoObjects(child, hits);
    }
  });
}

(function () {
  if (typeof $response === "undefined") { $done({}); return; }

  // 全关时零改动放行
  if (!BLOCK_POPUP && !BLOCK_BANNER && !BLOCK_CONTENT && !BLOCK_PROFILE) { $done({}); return; }

  try {
    var body = JSON.parse($response.body || "{}");
    var data = body && body.data;
    if (!data || !Array.isArray(data.records)) {
      $done({ status: 200, headers: cleanHeaders($response.headers), body: JSON.stringify(body) });
      return;
    }

    var removed = [];
    data.records = data.records.filter(function (r) {
      if (!r || typeof r !== "object") return true;
      var tag = String(r.tag || "");
      var type = String(r.type || "");
      var name = String(r.name || "");

      if (BLOCK_POPUP && (type === "popup" || type === "open" || name.indexOf("弹窗") >= 0)) {
        removed.push("弹窗:" + name);
        return false;
      }
      if (BLOCK_BANNER && tag === "BBS") { removed.push("banner:" + name); return false; }
      if (BLOCK_CONTENT && (tag === "BBS_MSG" || tag === "PARTNERLEAGUE")) {
        removed.push("内容:" + name);
        return false;
      }
      if (BLOCK_PROFILE && Array.isArray(r.places)) {
        var before = r.places.length;
        r.places = r.places.filter(function (p) {
          return !(p && PROMO_PLACE.test(promoText(p)));
        });
        if (r.places.length !== before) removed.push("我的页:" + name + "(-" + (before - r.places.length) + ")");
      }
      if (BLOCK_PROFILE) stripPromoObjects(r, removed);
      return true;
    });

    if (removed.length) notify("容器接口已清理", removed.join(" / "));
    $done({ status: 200, headers: cleanHeaders($response.headers), body: JSON.stringify(body) });
  } catch (e) {
    notify("容器脚本异常（放行原响应）", String((e && e.message) || e));
    $done({});
  }
})();
