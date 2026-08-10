// ============================================================
// charge_store_token.js  v1.2（网页登录后把 token 写入 Loon）
//
// v1.1（2026-08-10）：同时持久化 refreshToken 过期时间
//（galaxyRefreshTokenExpiresAt，秒），供 cron 做到期预警/自动续期。
// v1.2（2026-08-10）：持久化 galaxyCenterToken / galaxyCenterRefreshToken，
// 供 cron 常态化刷新（/api/v1/login/refresh 换新 centerToken → 换 recharge token）。
//
// 银河网页登录页（charge_galaxy_login.js）完成 getTokenByCode 后，
// 把 token 信息 POST 到 https://h5-recharge.geely.com/store-token
// （同源请求；h5-recharge 返回 404，本 http-response 脚本接管）。
// 脚本读取请求体写入 persistentStore，与打开银河App 时
// charge_capture_galaxy.js 写入的键完全一致。
// ============================================================

// ---------------- 主流程 ----------------
try {
  var body = $request.body || "";
  var j = null;
  try { j = JSON.parse(body); } catch (e) {}
  if (j && j.authToken) {
    $persistentStore.write(String(j.authToken), "galaxyRechargeToken");
    if (j.refreshToken) $persistentStore.write(String(j.refreshToken), "galaxyRefreshToken");
    if (j.userId) $persistentStore.write(String(j.userId), "galaxyUserId");
    var exp = parseInt(j.expiresAt, 10);
    if (!isNaN(exp)) {
      $persistentStore.write(String(exp), "galaxyTokenExpiresAt");
    }
    var rExp = parseInt(j.refreshExpiresAt, 10);
    if (!isNaN(rExp)) {
      if (rExp > 1000000000000) rExp = Math.floor(rExp / 1000); // 毫秒转秒
      $persistentStore.write(String(rExp), "galaxyRefreshTokenExpiresAt");
    }
    if (j.centerToken) $persistentStore.write(String(j.centerToken), "galaxyCenterToken");
    if (j.centerRefreshToken) $persistentStore.write(String(j.centerRefreshToken), "galaxyCenterRefreshToken");
    if (j.deviceSN) $persistentStore.write(String(j.deviceSN), "galaxyDeviceSN");
    console.log("[charge] 网页登录 token 已写入 Loon");
    $notification.post("充电桩修改：银河token已更新", "来自网页登录（约30分钟有效）", "");
  } else {
    console.log("[charge] store-token 请求体无效: " + String(body).slice(0, 120));
  }
  var headers0 = $response.headers || {};
  headers0["content-type"] = "application/json; charset=utf-8";
  delete headers0["content-encoding"];
  delete headers0["Content-Encoding"];
  delete headers0["content-length"];
  delete headers0["Content-Length"];
  $done({ status: 200, headers: headers0, body: '{"ok":true}' });
} catch (e) {
  console.log("[charge] store-token 错误: " + (e && e.message ? e.message : String(e)));
  $done({});
}
