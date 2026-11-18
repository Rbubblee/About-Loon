// ============================================================
// ZEEKR NOAD v11.0  —— 响应阶段清洗脚本（独立文件，不与请求探针共用）
// 目标：container/page 的
//   1) 我的页「宝藏精选·作品上传」等推广位
//   2) 社区顶部banner / 悬浮推广 / 开屏启动弹窗
//
// v11 相对 v10 的关键变化：
//   a) 拆成独立文件（v10 请求/响应共用同一 script-path，Loon 复用实例，
//      导致响应阶段实际没执行 —— 这正是"只有命中提示、没有清理完成"的原因）
//   b) 通用递归清扫：不再只认 data.records[].places，任何层级里
//      命中推广文案的卡片对象都会被剔除，抗结构改版
//   c) 每一步都有通知，能直接看到卡在哪
// ============================================================

function post(t, s, b) {
  try { $notification.post(String(t), String(s || ""), String(b || "")); } catch (e) {}
}

// —— 响应脚本被真正执行时才会弹这条 ——
post("ZEEKR NOAD v11", "响应脚本已执行", "开始清洗 container/page");

function isBytes(b) {
  if (!b || typeof b !== "object") return false;
  var c = b.constructor && b.constructor.name;
  if (c === "Uint8Array" || c === "Buffer" || c === "ArrayBuffer") return true;
  return typeof b.byteLength === "number" && typeof b.length !== "number";
}

function toStr(b) {
  if (b === null || b === undefined) return "";
  if (typeof b === "string") return b;
  try {
    if (isBytes(b)) {
      var u8 = (b.buffer && typeof b.byteLength === "number")
        ? new Uint8Array(b.buffer, b.byteOffset || 0, b.byteLength)
        : new Uint8Array(b);
      if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(u8);
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

// 推广文案特征（认字不认位置）
var PROMO = /宝藏精选|作品上传|作品征集|邀请好友|邀好友|邀约|得好礼|邀试驾|试驾有礼|邀请有礼|达人招募|加入联盟|马拉松|招募|抽奖|领奖|领好礼|免费领|好礼|福利|极氪联盟|极物|创作征集|工业游/;
// 正常功能位白名单
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

// 结构自检用：把 data 的顶层 key 提出来
function shapeOf(v) {
  try {
    if (Array.isArray(v)) return "array(" + v.length + ")";
    if (v && typeof v === "object") return "obj{" + Object.keys(v).slice(0, 8).join(",") + "}";
    return typeof v;
  } catch (e) { return "?"; }
}

var removed = [];

// 通用递归清扫：任何数组里命中推广文案的对象都剔除
function sweep(node, depth) {
  if (!node || typeof node !== "object" || depth > 8) return;
  if (Array.isArray(node)) {
    for (var i = node.length - 1; i >= 0; i--) {
      var it = node[i];
      if (it && typeof it === "object" && !Array.isArray(it)) {
        var ty = String(it.type || "");
        var nm = String(it.name || it.title || "");
        // 弹窗/开屏整块删
        if (ty === "popup" || ty === "open") {
          removed.push("弹窗:" + nm); node.splice(i, 1); continue;
        }
        // 社区顶部banner/悬浮推广整块删
        if (ty === "banner" && /推荐顶部banner|顶部banner|悬浮|轮播图|广告推广/.test(nm)) {
          removed.push("banner:" + nm); node.splice(i, 1); continue;
        }
        // 推广卡片删除（nameOf 命中或链接命中）
        if (isPromo(it)) {
          removed.push(nameOf(it) || "(未命名推广位)");
          node.splice(i, 1);
          continue;
        }
        sweep(it, depth + 1);
      } else if (it && typeof it === "object") {
        sweep(it, depth + 1);
      }
    }
    return;
  }
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    var v = node[k];
    if (v && typeof v === "object") sweep(v, depth + 1);
    else if (typeof v === "string" && PROMO.test(v) && /description|desc|copywriting|subTitle/i.test(k)) {
      node[k] = "";
    }
  }
}

(function () {
  // 请求阶段（本脚本只挂在 http-response，正常不会走到这里）
  if (typeof $response === "undefined") { $done({}); return; }

  var raw = toStr($response.body);
  if (!raw) { post("ZEEKR NOAD v11", "响应为空", "没拿到 body"); $done({}); return; }

  var body;
  try { body = JSON.parse(raw); }
  catch (e) {
    post("ZEEKR NOAD v11", "解析失败(放行)", String(raw).slice(0, 50));
    $done({}); return;
  }

  var data = body && body.data;
  if (!data) {
    post("ZEEKR NOAD v11", "无 data", "顶层:" + shapeOf(body));
    $done({}); return;
  }

  sweep(data, 0);

  post("ZEEKR NOAD v11", "清理完成 · " + removed.length + " 处",
       removed.length ? removed.slice(0, 9).join(" / ") : ("未命中推广位 · data结构:" + shapeOf(data)));

  $done({ status: 200, headers: cleanHeaders($response.headers), body: JSON.stringify(body) });
})();
