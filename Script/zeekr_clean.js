// ============================================================
// zeekr_container.js  v3.0 (2026-11-18)
// 容器接口精确清洗 —— 只处理这一条接口：
//   POST api-gw-toc.zeekrlife.com/zeekrlife-mp-bnr/open/v1/container/page
//
// 抓包实测的 data.records[] 结构（一个 record 是一整块 Banner）：
//   tag=HAIBAO  type=banner  name=个人页       ← 我的页推广位块
//       places[]: 邀请好友 / 服务大厅 / 宝藏精选·作品上传 / zgreen /
//                 达人招募 / 卡包 / 极值 / 极分 / 我的活动 / 订单
//       （推广位和正常功能混在一起，必须逐 places 精准删）
//   tag=BBS     type=banner  name=推荐顶部banner（3.16版本） ← 社区顶部/悬浮推广
//       places[]: 马拉松招募 / 马拉松活动 / 极氪7X / 极氪联盟 / 极物 ... 全推广
//   tag=BBS     type=banner  name=0307新金刚位  ← 首页功能金刚位（保留）
//       places[]: APP全系新车 / 购车权益 / 门店 / 充电服务（正常功能）
//   tag=BBS     type=popup   name=APP首页启动弹窗 ← 邀请试驾弹窗（删）
//   tag=BBS     type=open    name=APP开屏弹窗（新）（删）
//   tag=OVSERVICE ...         ← 用车服务（保留）
//
// 处理策略（用户诉求：去干净，但别把功能删没了）：
//   · type=popup/open → 整块删
//   · name 含"推荐顶部banner" → 整块删（社区悬浮推广）
//   · tag=HAIBAO → 逐 places 删推广位（名单+特征），保留服务大厅/卡包/极分/订单等功能
//   · 兜底：任何 places 元素命中强推广文案 → 删该元素
//
// argument: [{blockPopup},{blockCommunityBanner},{blockProfileAds},{debugNotify}]
//   [0] blockPopup          弹窗/开屏
//   [1] blockCommunityBanner 社区顶部/悬浮推广 banner
//   [2] blockProfileAds     我的页推广位
//   [3] debugNotify         调试通知
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
var BLOCK_PROFILE = argBool(2);
var DEBUG = argBool(3);

function notify(title, sub) {
  try { if (DEBUG) $notification.post("ZEEKR NOAD", title, sub || ""); } catch (e) {}
}
// 诊断：脚本一旦执行就尝试弹一次，用于确认脚本是否真的加载运行
function diag(msg) {
  try { $notification.post("ZEEKR诊断", msg); } catch (e) {}
}
function cleanHeaders(h) {
  h = Object.assign({}, h || {});
  ["content-encoding", "Content-Encoding", "content-length", "Content-Length",
   "transfer-encoding", "Transfer-Encoding"].forEach(function (k) { delete h[k]; });
  h["content-type"] = "application/json; charset=utf-8";
  return h;
}

// 强推广文案：命中即认为是广告位
var PROMO_TEXT = /宝藏精选|作品上传|作品征集|邀请好友|邀好友|邀约|得好礼|邀试驾|试驾有礼|邀请有礼|达人招募|加入联盟|马拉松|招募|限时|抽奖|领奖|领好礼|免费领|好礼|福利|极氪联盟|极物|服务日|创作|新车上市|购车权益|工业游|活动|推广|广告/i;
// 正常功能位白名单：这些绝不能删
var KEEP_TEXT = /^(服务大厅|卡包|极值|极分|我的活动|订单|充电地图|用车服务|用车无忧|更多服务|搜索|APP全系新车|APP购车权益|APP极氪门店|APP充电服务|车辆|首页|消息|我的)$/;

function placeName(p) {
  if (!p || typeof p !== "object") return "";
  return String(p.name || p.title || p.subTitle || p.desc || p.text || "");
}

function isPromoPlace(p) {
  var n = placeName(p).trim();
  if (!n) return false;
  if (KEEP_TEXT.test(n)) return false;      // 白名单优先保留
  if (PROMO_TEXT.test(n)) return true;
  // 带图片+活动链接的功能位也视为推广
  var link = String(p.linkUrl || p.url || p.jumpUrl || p.link || "");
  if (/invite|activity|promo|marketing|advert/i.test(link)) return true;
  return false;
}

(function () {
  var url = "";
  try { url = ($request && $request.url) || ""; } catch (e) {}

  // 请求阶段：社区整页接口直接合成空响应
  if (typeof $response === "undefined") {
    if (/zeekrlife-bbs-theme\/|zeekrlife-search-api\/search\/api\/new\/getTopicList|zeekrlife-dod-search\/(v2\/)?open\/search\/shading/i.test(url)) {
      diag("社区整页已拦截");
      $done({ status: 200, headers: { "content-type": "application/json; charset=utf-8" },
              body: "{\"success\":true,\"code\":\"000000\",\"data\":{}}" });
      return;
    }
    $done({}); return;
  }
  if (!BLOCK_POPUP && !BLOCK_BANNER && !BLOCK_PROFILE) { $done({}); return; }

  diag("clean脚本已运行");

  try {
    var body = JSON.parse($response.body || "{}");
    var data = body && body.data;
    if (!data || !Array.isArray(data.records)) {
      $done({ status: 200, headers: cleanHeaders($response.headers), body: JSON.stringify(body) });
      return;
    }

    var removed = [];
    var kept = [];
    data.records = data.records.filter(function (r) {
      if (!r || typeof r !== "object") return true;
      var tag = String(r.tag || "");
      var type = String(r.type || "");
      var name = String(r.name || "");
      var desc = String(r.description || "");

      // 1) 弹窗 / 开屏 —— 整块删
      if (BLOCK_POPUP && (type === "popup" || type === "open")) {
        removed.push("弹窗:" + name); return false;
      }

      // 2) 社区顶部/悬浮推广 banner —— 整块删（保留"新金刚位"等功能性 banner）
      if (BLOCK_BANNER && tag === "BBS" && type === "banner" && /推荐顶部banner|顶部banner|悬浮|轮播/.test(name)) {
        removed.push("社区推广banner:" + name + "(" + (r.places || []).length + "位)"); return false;
      }

      // 3) 我的页 HAIBAO —— 逐 places 删推广位，保留正常功能
      if (BLOCK_PROFILE && tag === "HAIBAO" && Array.isArray(r.places)) {
        var before = r.places.length;
        var removedNames = [];
        r.places = r.places.filter(function (p) {
          if (isPromoPlace(p)) { removedNames.push(placeName(p)); return false; }
          return true;
        });
        if (r.places.length !== before) {
          removed.push("我的页推广(-" + (before - r.places.length) + "):" + removedNames.join("/").slice(0, 60));
        }
        return true; // 保留 HAIBAO 块本身（里面有正常功能）
      }

      // 4) 兜底：其它 record 里若 places 全是推广，整块删
      if (Array.isArray(r.places) && r.places.length && r.places.every(isPromoPlace)) {
        if (BLOCK_BANNER || BLOCK_PROFILE) {
          removed.push("整块推广:" + name); return false;
        }
      }
      kept.push(name);
      return true;
    });

    if (removed.length) notify("已清理 " + removed.length + " 处", removed.slice(0, 12).join(" / "));
    $done({ status: 200, headers: cleanHeaders($response.headers), body: JSON.stringify(body) });
  } catch (e) {
    notify("脚本异常(放行)", String((e && e.message) || e));
    $done({});
  }
})();
