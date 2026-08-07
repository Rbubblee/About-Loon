// ============================================================
// charge_capture_galaxy.js  v2
// 监听银河App的 api-recharge 流量：
//   1. getTokenByCode  → 保存 authToken / refreshToken / 过期时间
//   2. getUserInfoByToken → 保存 userId
//   3. 家充桩业务接口   → 缓存响应（gx_<key>，供实时失败时降级）
// 打开银河App家充桩页面时自动刷新，供 charge_inject_zeekr.js 使用。
// ============================================================

var NOTIFY = String(($argument || [])[0]) !== "false";

var MAP = {
  "/gep/v2/common/getTokenByCode": "getTokenByCode",
  "/gep/v2/common/getUserInfoByToken": "getUserInfoByToken",
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
  var body = $response.body || "";
  var j = null;
  try {
    j = JSON.parse(body);
  } catch (e) {}
  if (!j || (j.code !== "0" && j.code !== 0 && j.code !== "success")) {
    $done({});
    return;
  }

  var d = j.data || {};
  if (key === "getTokenByCode") {
    if (d.authToken) {
      $persistentStore.write(d.authToken, "galaxyRechargeToken");
      var expire = d.expireAt;
      var now = Math.floor(Date.now() / 1000);
      var expiresAt = (typeof expire === "number" && expire > 1000000000) ? expire : now + (typeof expire === "number" ? expire : 1799);
      $persistentStore.write(String(expiresAt), "galaxyTokenExpiresAt");
      if (d.refreshToken) $persistentStore.write(d.refreshToken, "galaxyRefreshToken");
      console.log("[charge] 已保存 rechargeToken，约 " + Math.round((expiresAt - now) / 60) + " 分钟有效");
      if (NOTIFY) $notification.post("充电桩修改：银河token已更新", "约 " + Math.round((expiresAt - now) / 60) + " 分钟有效", "");
    }
  } else if (key === "getUserInfoByToken") {
    if (d.userId) $persistentStore.write(String(d.userId), "galaxyUserId");
  } else if (key) {
    $persistentStore.write(body, "gx_" + key);
    if (key === "getMyEquipments") {
      var list = d.resultList || [];
      if (list.length > 0) {
        $persistentStore.write(String(list[0].equipmentId || ""), "galaxyLastEquipmentId");
        $persistentStore.write(String(list[0].providerNo || "DIRECT_WDZ"), "galaxyLastProviderNo");
      }
    }
    console.log("[charge] 缓存银河数据 " + key);
    if (NOTIFY) $notification.post("充电桩修改：银河数据已缓存", key, "");
  }
} catch (e) {}

$done({});
