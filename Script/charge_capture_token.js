// ============================================================
// charge_capture_token.js
// 监听银河 App 的 recharge 接口，自动保存 authToken / userId / refreshToken
// 挂载点（script-response-body）：
//   api-recharge.geely.com/gep/v2/common/getTokenByCode
//   api-recharge.geely.com/gep/v2/common/getUserInfoByToken
// 说明：authToken 约 30 分钟有效，过期后需重新打开一次银河 App 家充桩页面。
// ============================================================

try {
  var body = $response.body || "";
  var j = JSON.parse(body);
  if (j.code !== "0" || !j.data) {
    $done({});
    return;
  }
  var d = j.data;
  var updated = false;
  if (d.authToken) {
    $persistentStore.write(d.authToken, "galaxyRechargeToken");
    updated = true;
  }
  if (d.refreshToken) {
    $persistentStore.write(d.refreshToken, "galaxyRefreshToken");
  }
  if (d.userId) {
    $persistentStore.write(String(d.userId), "galaxyUserId");
    updated = true;
  }
  // getUserInfoByToken 的 userId 在 data.userId；部分接口在 detail.accountId
  if (!d.userId && d.detail && d.detail.accountId) {
    $persistentStore.write(String(d.detail.accountId), "galaxyUserId");
    updated = true;
  }
  if (updated) {
    $notification.post("充电桩修改：银河token已更新", "有效期约30分钟，请尽快在极氪App查看", "");
  }
} catch (e) {}

$done({});
