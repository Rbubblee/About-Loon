// ============================================================
// charge_galaxy_cors.js
// 给 api-recharge.geely.com 的响应补 CORS 头，
// 让改道后的极氪 H5（origin: https://c-h5-prod.haohanpower.tech）能读到响应。
// 挂载点：script-response-header（requires-body=false）
//   ^https://api-recharge\.geely\.com/.*$ url script-response-header charge_galaxy_cors.js
// ============================================================

var headers = $response.headers || {};
headers["Access-Control-Allow-Origin"] = "*";
headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,OPTIONS";
headers["Access-Control-Allow-Headers"] = "token,channelid,content-type,accept,x-ca-key,x-ca-nonce,x-ca-signature-method,x-ca-timestamp,x-ca-version,x-ca-signature-headers,x-ca-signature";
headers["Access-Control-Max-Age"] = "86400";

$done({ headers: headers });
