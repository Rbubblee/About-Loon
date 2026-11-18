// ============================================================
// zeekr_universal.js  v1.0 (2026-11-18)
// 【通用广告清洗引擎】—— 不依赖任何具体接口路径。
//
// 设计思路：
//   极氪的接口地址经常改版（v7.7 就是因为 userInfo/home 换路径失效）。
//   本脚本反过来：用一条通配规则覆盖 api-gw-toc.zeekrlife.com 下所有响应，
//   对响应体做递归遍历，靠「字段名 + 推广文案 + 营销链接 + 卡片结构」
//   四重特征识别广告并就地清除。接口怎么换都不影响。
//
//   同时支持请求级（$response 不存在）：命中社区/商城/浮窗接口时
//   直接合成空 JSON 响应，连请求都不发给上游。
//
// 安全策略：
//   - 只对「判定为广告」的数组元素做删除；对对象属性一律「清空值、
//     保留 key」，避免 App 取不到字段而崩溃。
//   - nickName / 极分 / 积分 / 头像 / 订单 / 车辆 等正常字段白名单保护。
//   - 无广告信号时原样放行（$done({})），零改动。
//
// argument: [blockAll, blockCommunity, blockMall, debugNotify]
//   blockAll       = 通用响应清洗总开关
//   blockCommunity = 社区整页接口（请求级不发送）
//   blockMall      = 商城整页接口（请求级不发送）
//   debugNotify    = 调试通知
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

var BLOCK_ALL = argBool(0);
var BLOCK_COMMUNITY = argBool(1);
var BLOCK_MALL = argBool(2);
var DEBUG = argBool(3);

function notify(title, sub) {
  try { if (DEBUG) $notification.post("ZEEKR NOAD", title, sub || ""); } catch (e) {}
}

function cleanHeaders(h) {
  h = Object.assign({}, h || {});
  ["content-encoding", "Content-Encoding", "content-length", "Content-Length",
   "transfer-encoding", "Transfer-Encoding"].forEach(function (k) { delete h[k]; });
  h["content-type"] = "application/json; charset=utf-8";
  return h;
}

// ------------------------------------------------------------
// 一、请求级：整页 / 浮窗接口直接合成空响应
// ------------------------------------------------------------
var REQ_COMMUNITY = /zeekrlife-bbs-theme\/|zeekrlife-search-api\/search\/api\/new\/getTopicList|zeekrlife-dod-search\/v2\/open\/search\/shading/i;
var REQ_MALL = /zeekrlife-mp-cmall\/|\/pub\/v[0-9]+\/(article|category|combItem|comment|evaluation|goods|index|search|sts)\/|\/recommend\/v1\/goods\/|\/v[0-9]+\/(activity|goods|shoppingCart)\//i;
var REQ_FLOAT = /getBrandCare|queryPopupForSdk|haohan-base-front\/(banner|popup)|bannerDeploy\/action\/queryPopup/i;

function emptyResp() {
  return { status: 200, headers: { "content-type": "application/json; charset=utf-8" },
           body: "{\"success\":true,\"code\":\"000000\",\"data\":{}}" };
}

// ------------------------------------------------------------
// 二、响应级：广告识别词典
// ------------------------------------------------------------

// 强广告字段名（归一化后按词匹配）——命中即清空该字段值
var AD_KEY = /(^|_)(ad|ads|adv|advert|advertise|advertisement|banner|banners|popup|popups|float|floating|floaticon|guidebanner|marketing|marketingmaterial|marketingmateriallist|promo|promotion|recommend|recommendation|recommendtext|copywriting|splash|launch|activitybanner|topicbanner|popwindow|dialog)(_|$)/;

// 正常数据白名单（字段名）——绝不改动其值
var SAFE_KEY = /^(nickname|nickName|realname|realName|username|userName|userid|userId|mobile|phone|avatar|headimg|headImg|headimage|headImage|integral|integralLeft|point|points|score|balance|vin|carid|carId|carinfo|carInfo|orderid|orderId|orderno|orderNo|mileage|energy|electricity|level|vip|viplevel|vipLevel|memberlevel|memberLevel|birthday|gender|city|province|plateNo|carNumber|carModel|vehicle)$/;

// 强推广文案（极氪实测的推广语，命中即判广告）——这些词几乎不会出现在正常功能名里
var STRONG_TEXT = /邀好友|邀请好友|邀约好友|得好礼|邀试驾|邀请试驾|试驾有礼|邀请有礼|邀新|宝藏精选|作品上传|作品征集|达人招募|加入联盟|限时开放|领好礼|免费领|领福利|抽奖|领奖|赢取|立即领取|马上领取|创作有礼|分享有礼|好友助力|拼团|砍价/i;

// 弱推广文案——需要配合营销链接或图片才判广告
var SOFT_TEXT = /福利|优惠|特权|好礼|限时|领券|红包|返现|积分兑换|了解详情|立即参与|去看看|查看更多|广告|推广/i;

// 营销落地页链接特征
var AD_LINK = /invite|activity|promo|marketing|advert|\/(ad|ads|adv)\/|lottery|draw-prize|signup/i;

// 广告型 tag/type（作为卡片时判广告的加权信号；不单独整块删除，保留正常功能）
var AD_TYPE = /^(HAIBAO|BBS_MSG|PARTNERLEAGUE|popup|open|splash|launch|float)$/i;

function normKey(k) {
  return String(k).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
function isAdKey(k) { return AD_KEY.test(normKey(k)); }
function isSafeKey(k) { return SAFE_KEY.test(String(k)); }

function blank(v) {
  if (Array.isArray(v)) return [];
  if (v && typeof v === "object") return {};
  if (typeof v === "string") return "";
  if (typeof v === "number") return 0;
  if (typeof v === "boolean") return false;
  return v;
}

// 只取对象「自身」的展示字段文本（不递归子树）——避免把 data/records 这类
// 容器连同里面的正常功能一起误判成广告。
function ownText(obj) {
  return ["name", "title", "subTitle", "subtitle", "desc", "description",
          "text", "label", "content", "copy", "copyWriting"]
    .map(function (k) { return String(obj[k] || ""); }).join(" ");
}

// 只取对象「自身」的直接跳转链接
function ownLinks(obj) {
  return ["linkUrl", "url", "jumpUrl", "targetUrl", "link", "h5Url", "scheme",
          "actionUrl", "route", "jumpLink", "forwardUrl"]
    .map(function (k) { return String(obj[k] || ""); })
    .filter(function (s) { return /^(https?:|zeekrlife:|\/\/)/i.test(s); }).join(" ");
}

function hasImage(node) {
  if (!node || typeof node !== "object") return false;
  return Object.keys(node).some(function (k) {
    return /img|image|pic|picture|icon|cover|thumb/i.test(k) &&
           typeof node[k] === "string" && node[k].length > 0;
  });
}

var POPUP_TYPE = /^(popup|open|splash|launch|float)$/i;

// 给一个对象打「广告分」：>=3 判定为广告卡片。
// 只看自身字段；没有展示字段、也不是明确弹窗类型的容器对象一律 0 分（安全放行）。
function adScore(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return 0;
  var tg = String(obj.tag || obj.type || obj.bizType || obj.category || "");
  var hasDisplay = ["name", "title", "desc", "description", "text", "label"]
    .some(function (k) { return !!obj[k]; });
  var isPopup = POPUP_TYPE.test(tg);
  // 容器对象（既无展示字段、又非弹窗类型）不参与广告判定
  if (!hasDisplay && !isPopup) return 0;

  var s = 0;
  var t = ownText(obj);
  var l = ownLinks(obj);
  if (STRONG_TEXT.test(t)) s += 3;
  if (AD_LINK.test(l)) s += 2;
  if (SOFT_TEXT.test(t) && (l || hasImage(obj))) s += 2;
  if (isPopup) s += 3; // 弹窗/开屏类型本身就是广告
  // 纯图片推广位：有图 + 营销跳转 + 无实质功能 id
  if (hasImage(obj) && AD_LINK.test(l) && !obj.id && !obj.serviceCode) s += 1;
  return s;
}

var hits = [];
var nodeBudget = 20000; // 节点处理上限，防止超大响应卡住

// 递归清洗。返回 true 表示当前节点应被父级删除（仅用于数组元素）。
function scrub(node, key, depth) {
  if (nodeBudget-- <= 0 || depth > 40 || node === null || node === undefined) return false;
  if (isSafeKey(key)) return false; // 白名单字段整体保护

  if (typeof node === "string") {
    if (isAdKey(key)) {
      if (node) hits.push(key + "=" + node.slice(0, 24));
      return true;
    }
    if (STRONG_TEXT.test(node)) { hits.push("文案:" + node.slice(0, 24)); return true; }
    return false;
  }
  if (typeof node === "number" || typeof node === "boolean") {
    return isAdKey(key);
  }
  if (Array.isArray(node)) {
    for (var i = node.length - 1; i >= 0; i--) {
      var item = node[i];
      // 数组元素：广告分达标 或 字段名是广告 或 元素自身是广告文案字符串
      if ((item && typeof item === "object" && !Array.isArray(item) && adScore(item) >= 3) ||
          (typeof item === "string" && STRONG_TEXT.test(item)) ||
          (isAdKey(key) && item && typeof item === "object")) {
        hits.push("删除卡片:" + (item && item.name || item && item.title || key || "item").toString().slice(0, 22));
        node.splice(i, 1);
        continue;
      }
      scrub(item, key, depth + 1);
    }
    return false;
  }
  if (typeof node === "object") {
    // 对象属性：广告分达标的子对象 → 清空；否则逐字段清洗
    Object.keys(node).forEach(function (k) {
      var v = node[k];
      if (isSafeKey(k)) return;
      if (isAdKey(k)) {
        if (v !== "" && v !== null && v !== undefined && v !== 0 && v !== false) {
          var nonEmpty = Array.isArray(v) ? v.length : (typeof v === "object" ? Object.keys(v).length : 1);
          if (nonEmpty) hits.push("清字段:" + k);
        }
        node[k] = blank(v);
        return;
      }
      if (v && typeof v === "object" && !Array.isArray(v) && adScore(v) >= 3) {
        hits.push("清广告块:" + k);
        node[k] = blank(v);
        return;
      }
      var drop = scrub(v, k, depth + 1);
      if (drop) {
        if (typeof v === "string") node[k] = "";
      }
    });
    return false;
  }
  return false;
}

(function () {
  var url = "";
  try { url = ($request && $request.url) || ""; } catch (e) {}

  // ---- 请求级 ----
  if (typeof $response === "undefined") {
    if (BLOCK_COMMUNITY && REQ_COMMUNITY.test(url)) {
      notify("社区整页已拦截", url.slice(0, 80));
      $done(emptyResp()); return;
    }
    if (BLOCK_MALL && REQ_MALL.test(url)) {
      notify("商城整页已拦截", url.slice(0, 80));
      $done(emptyResp()); return;
    }
    if (BLOCK_ALL && REQ_FLOAT.test(url)) {
      notify("浮窗/弹窗已拦截", url.slice(0, 80));
      $done(emptyResp()); return;
    }
    $done({}); return;
  }

  // ---- 响应级 ----
  if (!BLOCK_ALL) { $done({}); return; }
  var raw = $response.body || "";
  if (!raw || raw.length < 2) { $done({}); return; }

  // 快速放行：整段响应里没有任何推广信号，不做递归
  if (!STRONG_TEXT.test(raw) && !SOFT_TEXT.test(raw) && !/advert|banner|popup|marketing|promotion|recommend|floaticon|guidebanner/i.test(raw)) {
    $done({}); return;
  }

  try {
    var body = JSON.parse(raw);
    hits = [];
    nodeBudget = 20000;
    scrub(body, "", 0);
    if (hits.length) {
      notify("已清理 " + hits.length + " 处广告", hits.slice(0, 14).join(" / "));
    }
    $done({ status: $response.status || 200,
            headers: cleanHeaders($response.headers),
            body: JSON.stringify(body) });
  } catch (e) {
    notify("通用清洗异常(放行)", String((e && e.message) || e));
    $done({});
  }
})();
