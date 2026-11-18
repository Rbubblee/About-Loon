// ============================================================
// ZEEKR NOAD v10.0  (2026-11-18)
// 只处理 container/page 一条接口：
//   1) 我的页「宝藏精选·作品上传」等推广位（tag=HAIBAO 的 places[]）
//   2) 社区顶部banner / 悬浮推广 / 开屏启动弹窗（tag=BBS）
//
// v10 相比 v9 的三处关键修复：
//   a) body 兼容 Uint8Array / 二进制（服务器返回 gzip/br，Loon 可能给的是字节流，
//      旧版直接 JSON.parse 会失败并静默放行 —— 这就是"广告还在"的直接原因之一）
//   b) 请求阶段也弹通知：进"我的"页只要规则命中就弹，不必等响应脚本
//   c) 脚本加载即弹，任何开关都不依赖
// ============================================================

function post(t, s, b) {
  try { $notification.post(String(t), String(s || ""), String(b || "")); } catch (e) {}
}

// —— 脚本被加载就弹，确认执行链路 ——
post("ZEEKR NOAD v10", "脚本已加载运行", "看到此条=脚本下载并执行成功");

// 把 Loon 可能给出的各种 body 形态统一成字符串
function isBytes(b) {
  if (!b || typeof b !== "object") return false;
  var ctor = b.constructor && b.constructor.name;
  if (ctor === "Uint8Array" || ctor === "Buffer" || ctor === "ArrayBuffer") return true;
  return typeof b.byteLength === "number" && typeof b.length !== "number" || (b.buffer && typeof b.byteLength === "number");
}

function toStr(b) {
  if (b === null || b === undefined) return "";
  if (typeof b === "string") return b;
  try {
    if (isBytes(b)) {
      var u8;
      if (typeof b.buffer !== "undefined" && b.buffer) {
        u8 = new Uint8Array(b.buffer, b.byteOffset || 0, b.byteLength);
      } else {
        u8 = new Uint8Array(b);
      }
      if (typeof TextDecoder !== "undefined") {
        return new TextDecoder("utf-8").decode(u8);
      }
      var arr = [];
      for (var i = 0; i < u8.length; i++) arr.push(u8[i]);
      return decodeURIComponent(escape(String.fromCharCode.apply(null, arr)));
    }
  } catch (e) {}
  try { return String(b); } catch (e2) { return ""; }
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
  // ---------- 请求阶段 ----------
  if (typeof $response === "undefined") {
    post("ZEEKR NOAD v10", "请求命中", "container/page 已被规则捕获");
    $done({});
    return;
  }

  // ---------- 响应阶段 ----------
  var raw = toStr($response.body);
  if (!raw) { post("ZEEKR NOAD v10", "响应为空", "未拿到 body"); $done({}); return; }

  var body;
  try { body = JSON.parse(raw); }
  catch (e) {
    post("ZEEKR NOAD v10", "解析失败(放行)", String(raw).slice(0, 40));
    $done({}); return;
  }

  var data = body && body.data;
  if (!data || !Array.isArray(data.records)) {
    post("ZEEKR NOAD v10", "无 records 字段", "该响应无容器数据");
    $done({}); return;
  }

  var removed = [];

  data.records = data.records.filter(function (r) {
    if (!r || typeof r !== "object") return true;
    var tag = String(r.tag || "");
    var type = String(r.type || "");
    var nm = String(r.name || "");

    if (r.description && PROMO.test(String(r.description))) {
      r.description = String(r.description).replace(PROMO, "");
    }
    // 开屏 / 启动弹窗
    if (type === "popup" || type === "open") { removed.push("弹窗:" + nm); return false; }
    // 社区顶部banner / 悬浮推广
    if (tag === "BBS" && type === "banner" && /推荐顶部banner|顶部banner|悬浮|轮播图|广告推广/.test(nm)) {
      removed.push("社区banner:" + nm); return false;
    }
    // 逐 places 删推广位
    if (Array.isArray(r.places)) {
      r.places = r.places.filter(function (p) {
        if (isPromo(p)) { removed.push(nameOf(p)); return false; }
        return true;
      });
    }
    return true;
  });

  post("ZEEKR NOAD v10", "清理完成 · " + removed.length + " 处",
       removed.length ? removed.slice(0, 10).join(" / ") : "未发现需要删除的推广位");

  $done({ status: 200, headers: cleanHeaders($response.headers), body: JSON.stringify(body) });
})();
