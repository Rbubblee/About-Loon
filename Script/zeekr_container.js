// ============================================================
// ZEEKR NOAD  v9.0  (2026-11-18)
// 极致精简：只处理 container/page 一条接口，聚焦用户要去掉的两类广告：
//   1) 我的页「宝藏精选·作品上传」等推广位（tag=HAIBAO 的 places[]）
//   2) 社区顶部banner / 悬浮推广 / 开屏启动弹窗（tag=BBS）
// 抗改版：靠文案特征识别，不依赖固定下标。
// 诊断：脚本一加载就弹通知（不依赖任何开关），一眼确认脚本是否执行。
// ============================================================

// —— 脚本只要被执行，就一定弹这条。没弹 = 脚本没被加载（地址/缓存/MitM/未导入）——
try { $notification.post("ZEEKR NOAD v9", "脚本已加载运行", "看到此条=脚本执行正常"); } catch (e) {}

function post(t, s, b) {
  try { $notification.post(String(t), String(s || ""), String(b || "")); } catch (e) {}
}

function cleanHeaders(h) {
  h = Object.assign({}, h || {});
  ["content-encoding", "Content-Encoding", "content-length", "Content-Length",
   "transfer-encoding", "Transfer-Encoding"].forEach(function (k) { delete h[k]; });
  h["content-type"] = "application/json; charset=utf-8";
  return h;
}

// 推广文案特征（认字不认位置，抗改版）
var PROMO = /宝藏精选|作品上传|作品征集|邀请好友|邀好友|邀约|得好礼|邀试驾|试驾有礼|邀请有礼|达人招募|加入联盟|马拉松|招募|抽奖|领奖|领好礼|免费领|好礼|福利|极氪联盟|极物|创作征集|工业游/;
// 正常功能位白名单：绝不能删
var KEEP = /^(服务大厅|卡包|极分|我的活动|订单|车辆|首页|消息|我的|充电地图|用车服务|用车无忧|更多服务|搜索|门店|充电服务|APP全系新车|APP购车权益|APP极氪门店|APP充电服务|极氪门店|购车权益)$/;

function nameOf(x) {
  if (!x || typeof x !== "object") return "";
  return String(x.name || x.title || x.subTitle || x.desc || x.text || x.copywriting || "");
}

function isPromo(x) {
  var n = nameOf(x).trim();
  if (!n) return false;
  if (KEEP.test(n)) return false;
  if (PROMO.test(n)) return true;
  var link = String(x.linkUrl || x.url || x.jumpUrl || x.link || "");
  if (/invite|activity|promo|marketing|advert|recruit/i.test(link)) return true;
  return false;
}

(function () {
  // 请求阶段：放行
  if (typeof $response === "undefined") { $done({}); return; }

  var body;
  try { body = JSON.parse($response.body || "{}"); } catch (e) { $done({}); return; }
  var data = body && body.data;
  if (!data || !Array.isArray(data.records)) { $done({}); return; }

  var removed = [];

  data.records = data.records.filter(function (r) {
    if (!r || typeof r !== "object") return true;
    var tag = String(r.tag || "");
    var type = String(r.type || "");
    var nm = String(r.name || "");
    // 顺手清掉 record 级描述里的广告字样（如"用于个人页设置邀请好友…链接"）
    if (r.description && PROMO.test(String(r.description))) {
      r.description = String(r.description).replace(PROMO, "");
    }

    // 开屏弹窗 / 首页启动弹窗 —— 整块删
    if (type === "popup" || type === "open") {
      removed.push("弹窗:" + nm); return false;
    }
    // 社区顶部banner / 悬浮推广 —— 整块删（保留"新金刚位"等功能banner）
    if (tag === "BBS" && type === "banner" && /推荐顶部banner|顶部banner|悬浮|轮播图|广告推广/.test(nm)) {
      removed.push("社区banner:" + nm); return false;
    }
    // 逐 places 删推广位（含我的页 HAIBAO 的「宝藏精选·作品上传」）
    if (Array.isArray(r.places)) {
      r.places = r.places.filter(function (p) {
        if (isPromo(p)) { removed.push(nameOf(p)); return false; }
        return true;
      });
    }
    return true; // 保留 record 块本身，只掏空其中的推广位
  });

  if (removed.length) {
    post("ZEEKR NOAD", "已清理 " + removed.length + " 处", removed.slice(0, 12).join(" / "));
  }
  $done({ status: 200, headers: cleanHeaders($response.headers), body: JSON.stringify(body) });
})();
