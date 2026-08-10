// ============================================================
// charge_store_token.js  v1.0（网页登录后把 token 写入 Loon）
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
