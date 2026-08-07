// ============================================================
// charge_inject_zeekr.js
// 极氪家充桩H5 响应注入：把银河API的真实响应（由 charge_capture_galaxy.js
// 缓存在 persistentStore）替换到极氪H5对应接口的响应里。
// 只处理极氪WebView(H5)请求，原生App请求自动放行。
// ============================================================

var NOTIFY = String(($argument || [])[0]) !== "false";

// 极氪H5接口路径 -> 银河接口缓存key
var MAP = {
  "/app/equipment/v2/manage/getMyEquipments": "getMyEquipments",
  "/app/equipment/v2/manage/getMyEquipmentDetail": "getMyEquipmentDetail",
  "/app/equipment/v2/manage/getMyEquipmentCards": "getMyEquipmentCards",
  "/app/equipment/v2/manage/getMyEquipmentShares": "getMyEquipmentShares",
  "/app/equipment/v2/manage/getEquipmentVersions": "getEquipmentVersions",
  "/app/equipment/v2/manage/getEquipmentBindVins": "getEquipmentBindVins",
  "/app/equipment/v2/manage/getEquipmentChargeOrders": "getEquipmentChargeOrders",
  "/app/equipment/v2/manage/getEquipmentChargeOrderCalc": "getEquipmentChargeOrderCalc",
  "/app/sim/v1/netflow/generateRenewUrl": "generateRenewUrl"
};

// 内置种子：设备列表（来自吉利银河App 2026-08-07 真实抓包，equipmentName 取详情页值）
var SEED = {
  "getMyEquipments": '{"code":"0","message":"SUCCESS","data":{"pager":null,"resultList":[{"equipmentId":"70260227463","providerNo":"DIRECT_WDZ","equipmentName":"我的家桩","isOwner":1,"bindTime":"2026-08-02 17:46:44","isAuth":1,"showAuth":1,"warrantyStartTime":null,"warrantyEndTime":null}]}}'
};

try {
  var reqHeaders = $request.headers || {};
  var ua = String(reqHeaders["user-agent"] || reqHeaders["User-Agent"] || "");
  var reqOrigin = String(reqHeaders["request-original"] || "");
  var isH5 = (ua.indexOf("Mozilla") >= 0) || (reqOrigin.indexOf("zeekr") >= 0);
  if (!isH5) {
    console.log("[charge] 原生请求，放行");
    $done({});
    return;
  }

  var url = $request.url || "";
  var path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  var key = MAP[path];
  if (!key) {
    console.log("[charge] 未映射极氪接口: " + path);
    if (NOTIFY) {
      $notification.post("充电桩修改：未映射接口", path + "（把这条发给我，我来加映射）", "");
    }
    $done({});
    return;
  }

  var cached = $persistentStore.read("gx_" + key);
  var body = cached || SEED[key] || "";
  if (!body) {
    console.log("[charge] 无数据可注入: " + path);
    $done({});
    return;
  }

  var headers = $response.headers || {};
  headers["content-type"] = "application/json";
  console.log("[charge] 注入 " + key + " <- " + (cached ? "缓存" : "种子"));
  if (NOTIFY) {
    $notification.post("充电桩修改：已注入", key + "（" + (cached ? "缓存数据" : "种子数据") + "）", "");
  }
  $done({ statusCode: 200, headers: headers, body: body });
} catch (e) {
  console.log("[charge] 错误: " + (e && e.message ? e.message : String(e)));
  $notification.post("充电桩修改 脚本错误", e && e.message ? e.message : String(e), "");
  $done({});
}
