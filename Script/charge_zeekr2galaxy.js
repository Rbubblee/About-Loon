// ============================================================
// charge_zeekr2galaxy.js
// 极氪家充桩 H5 (wallbox-sdk-zeekr) API 请求 -> 银河 recharge API 改道
// 用途：让极氪 App 的家充桩页面显示银河账号绑定的家桩（查看/管理类）
//
// 依赖：
//   1. Loon MITM 开启 sea-home-prod.haohanpower.tech / api-recharge.geely.com
//   2. charge_capture_token.js 已把 galaxyRechargeToken / galaxyUserId 写入持久化
//   3. token 约 30 分钟有效，过期后需要重新打开一次银河 App 刷新
//
// 说明：签名协议复刻银河 H5 buildApiSigature（AppKey 204184054），
//       密钥来自公开前端资源，仅限自用验证。
// ============================================================

var GALAXY_TOKEN = $persistentStore.read("galaxyRechargeToken") || "";
var GALAXY_USER_ID = $persistentStore.read("galaxyUserId") || "";

// ---------------- 极氪 -> 银河 接口映射 ----------------
// path: 极氪 H5 请求的路径
// target: 银河 API 路径
// rewriteBody: (极氪body对象) => 银河body对象
var API_MAP = {
  "/app/equipment/v2/manage/getMyEquipments": {
    target: "/gep/v2/home/charge/getMyEquipments",
    rewriteBody: function (b) {
      b.sourceTypeKey = "0010000";
      b.userId = GALAXY_USER_ID;
      return b;
    }
  }
  // 深层接口（绑定桩后抓包补齐，例如）：
  // "/app/equipment/v2/manage/getMyEquipmentDetail": {
  //   target: "/gep/v1/home/charge/getMyEquipmentDetail",
  //   rewriteBody: function (b) {
  //     b.sourceTypeKey = "0010000";
  //     b.userId = GALAXY_USER_ID;
  //     return b;
  //   }
  // }
};

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function signRequest(method, path, nonce, timestamp) {
  // 与银河 H5 buildApiSigature 一致的签名串
  var accept = "application/json";
  var contentType = "application/json";
  var xCaKey = "204184054";
  var secret = "Vxn15X98DNxNkI5UHvmtliqxPDvTeMBV";
  var lines = [
    method.toUpperCase(),
    accept,
    "",              // content-md5 位置（JS 协议为空）
    contentType,
    "",
    "X-Ca-Key:" + xCaKey,
    "X-Ca-Nonce:" + nonce,
    "X-Ca-Signature-Method:HmacSHA256",
    "X-Ca-Timestamp:" + timestamp,
    path
  ];
  var signStr = lines.join("\n");
  var sig = CryptoJS.HmacSHA256(signStr, secret).toString(CryptoJS.enc.Base64);
  return {
    xCaKey: xCaKey,
    xCaSignature: sig
  };
}

// ---------------- 主流程 ----------------
try {
  var url = $request.url || "";
  var path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];

  // 只处理映射表里的接口；未映射的（含 OPTIONS 预检）原样放行
  var rule = API_MAP[path];
  if (!rule) {
    $done({});
    return;
  }

  var method = ($request.method || "POST").toUpperCase();
  if (method === "OPTIONS") {
    $done({});
    return;
  }

  if (!GALAXY_TOKEN || !GALAXY_USER_ID) {
    $notification.post(
      "充电桩修改：缺少银河token",
      "请先打开一次银河App的家充桩页面，再回到极氪App查看",
      ""
    );
    $done({});
    return;
  }

  // 解析并改写请求体
  var bodyObj = {};
  try {
    bodyObj = JSON.parse($request.body || "{}");
  } catch (e) {}
  var newBody = JSON.stringify(rule.rewriteBody(bodyObj) || {});

  var nonce = uuidv4();
  var timestamp = String(Date.now());
  var s = signRequest(method, rule.target, nonce, timestamp);

  var headers = {
    "accept": "application/json",
    "content-type": "application/json; charset=UTF-8",
    "token": GALAXY_TOKEN,
    "channelid": "01701001",
    "x-ca-key": s.xCaKey,
    "x-ca-nonce": nonce,
    "x-ca-signature-method": "HmacSHA256",
    "x-ca-timestamp": timestamp,
    "x-ca-version": "1",
    "x-ca-signature-headers": "X-Ca-Key,X-Ca-Nonce,X-Ca-Signature-Method,X-Ca-Timestamp",
    "x-ca-signature": s.xCaSignature,
    "accept-language": "zh-CN,zh-Hans;q=0.9"
  };

  $done({
    url: "https://api-recharge.geely.com" + rule.target,
    method: method,
    headers: headers,
    body: newBody
  });
} catch (e) {
  $notification.post("充电桩修改 脚本错误", String(e), "");
  $done({});
}
