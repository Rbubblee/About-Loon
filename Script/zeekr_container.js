// ============================================================
// zeekr_container.js  v2.3 (2026-11-18)
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
// v2.3 变化（在 v2.2 基础上叠加，保留 HAIBAO 整块移除与推广卡片清理）：
//   1) 我的页 places[] 黑名单扩充（邀好友/试驾/福利/抽奖/好礼/限时/邀请有礼等）；
//   2) 推广位按跳转链接判定：指向邀请/活动/营销 H5 的一律剔除；
//   3) 新增深度广告字段清洗（banner/popup/promo/marketing/marketingMaterialList 等），
//      不再只靠文字字段匹配。
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
var PROMO_PLACE = /主题专区|限时开放|限时|得好礼|好礼|邀好友|邀请好友|邀请有礼|邀约|试驾|福利|优惠|抽奖|领奖|红包|宝藏精选|作品上传|了解详情|广告|推广|promo|invite|activity/i;
// 推广位跳转链接黑名单（命中即认为是广告落地页）
var PROMO_LINK = /invite|activity|promo|advert|marketing/i;
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
function stripPromoObjects(node, hits, depth) {
  if (!node || typeof node !== "object" || depth > 30) return;
  if (Array.isArray(node)) {
    for (var i = node.length - 1; i >= 0; i--) {
      var item = node[i];
      if (item && typeof item === "object" && PROFILE_PROMO.test(promoText(item))) {
        hits.push("推广卡片:" + promoText(item).trim().slice(0, 40));
        node.splice(i, 1);
      } else {
        stripPromoObjects(item, hits, depth + 1);
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
      stripPromoObjects(child, hits, depth + 1);
    }
  });
}

// ---- 深度广告字段清洗（与 zeekr_marketing.js 同口径） ----
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

function scrubAdFields(node, hits, depth) {
  if (!node || typeof node !== "object" || depth > 30) return;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) scrubAdFields(node[i], hits, depth + 1);
    return;
  }
  Object.keys(node).forEach(function (k) {
    var v = node[k];
    if (isAdKey(k)) {
      if (v !== null && v !== undefined && v !== "" && v !== 0 && v !== false) hits.push(k);
      node[k] = blank(v);
    } else if (v && typeof v === "object") {
      scrubAdFields(v, hits, depth + 1);
    }
  });
}

function isPromoPlace(p) {
  if (!p || typeof p !== "object") return false;
  var text = promoText(p);
  var link = String(p.linkUrl || p.url || p.jumpUrl || p.link || p.targetUrl || "");
  if (text && PROMO_PLACE.test(text)) return true;
  if (link && PROMO_LINK.test(link)) return true;
  return false;
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
    var fieldHits = [];
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
      // 我的页推广位是一整块 Banner，标题可能写在图片中，无法靠文字字段识别。
      if (BLOCK_PROFILE && tag === "HAIBAO") {
        removed.push("我的页推广Banner:" + name);
        return false;
      }
      if (BLOCK_PROFILE && Array.isArray(r.places)) {
        var before = r.places.length;
        r.places = r.places.filter(function (p) { return !isPromoPlace(p); });
        if (r.places.length !== before) removed.push("我的页:" + name + "(-" + (before - r.places.length) + ")");
      }
      if (BLOCK_PROFILE) stripPromoObjects(r, removed, 0);
      if (BLOCK_PROFILE || BLOCK_BANNER) scrubAdFields(r, fieldHits, 0);
      return true;
    });

    if (removed.length) notify("容器接口已清理", removed.join(" / "));
    if (fieldHits.length) notify("容器接口已清营销字段", fieldHits.slice(0, 12).join(" / "));
    $done({ status: 200, headers: cleanHeaders($response.headers), body: JSON.stringify(body) });
  } catch (e) {
    notify("容器脚本异常（放行原响应）", String((e && e.message) || e));
    $done({});
  }
})();
