// ============================================================
// charge_capture_galaxy.js
// 缓存银河App家充桩接口的真实响应（银河App自带有效签名，直接透传）
// 挂载点（script-response-body）：
//   api-recharge.geely.com/gep/v[12]/.*
// 打开银河App家充桩页面时自动刷新缓存，供 charge_inject_zeekr.js 注入用。
// ============================================================

var NOTIFY = String(($argument || [])[0]) !== "false";

var MAP = {
  "/gep/v2/home/charge/getMyEquipments": "getMyEquipments",
  "/gep/v1/home/charge/getMyEquipmentDetail": "getMyEquipmentDetail",
  "/gep/v2/home/charge/getMyEquipmentCards": "getMyEquipmentCards",
  "/gep/v1/home/charge/getMyEquipmentShares": "getMyEquipmentShares",
  "/gep/v1/home/charge/getEquipmentVersions": "getEquipmentVersions",
  "/gep/v2/home/charge/getEquipmentBindVins": "getEquipmentBindVins",
  "/gep/v2/home/charge/getEquipmentChargeOrders": "getEquipmentChargeOrders",
  "/gep/v2/home/charge/getEquipmentChargeOrderCalc": "getEquipmentChargeOrderCalc",
  "/sim/v1/netflow/generateRenewUrl": "generateRenewUrl"
};

try {
  var url = $request.url || "";
  var path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  var key = MAP[path];
  if (!key) {
    $done({});
    return;
  }
  var body = $response.body || "";
  try {
    var j = JSON.parse(body);
    if (j.code === "0" || j.code === 0) {
      $persistentStore.write(body, "gx_" + key);
      console.log("[charge] 缓存银河数据 " + key);
      if (NOTIFY) {
        $notification.post("充电桩修改：银河数据已缓存", key, "");
      }
    }
  } catch (e) {}
} catch (e) {}

$done({});
