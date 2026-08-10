// ============================================================
// charge_gw_relay.js  v3.0（银河网关转发代理，不依赖 URL 改写）
//
// 为什么不用 [URL Rewrite] / $done({url})：
//   实测在你的 Loon 3.5.0(975) 上，插件里的 URL Rewrite 和 http-request
//   改 URL 都没有生效，请求原样打到 h5-recharge.geely.com 自己的网关
//   （该域名 /api/v1、/gep 本身也是阿里云网关）→ 403 Apache。
//   而 http-response 脚本（登录页）和 store-token 都是正常的。
//
// 本脚本改为“脚本内转发”：
//   - http-request 上下文：收到 h5-recharge 的 /api/v1、/gep 请求后，
//     直接用 $httpClient 请求真实网关，再 $done({response}) 把真实响应
//     返回给页面（浏览器视角仍是同源，无 CORS）。
//   - http-response 上下文（兜底）：若请求已打到 h5-recharge 拿到 403/404，
//     同样转发真实网关并替换响应。
//
// 关键修复（浏览器禁止头）：
//   fetch 会剥离 Date/User-Agent/Host，而网关验签必须用 Date。
//   页面把签名日期随 X-Galaxy-Date 带出，这里补回 Date 并修正 UA/Host，
//   网关才能通过验签（403 Invalid Signature → 200）。
// ============================================================

var GALAXY_UA = "CA_iOS_SDK_2.0";
var RECHARGE_UA = "GeelyGalaxy/1.53.0 (com.geelygalaxy.customer; build:15300087; iOS 26.5.0) Alamofire/5.11.1";
var RELAY_MARKER = "x-relay-proxied";

function httpDateGMT8() {
  var days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function p(n) { return (n < 10 ? "0" : "") + n; }
  var d = new Date(Date.now() + 8 * 3600 * 1000);
  return days[d.getUTCDay()] + ", " + p(d.getUTCDate()) + " " + months[d.getUTCMonth()] + " " +
    d.getUTCFullYear() + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + " GMT+8";
}

// 取头（大小写不敏感）
function getHeader(headers, name) {
  if (!headers) return "";
  var lower = name.toLowerCase();
  for (var k in headers) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return "";
}
function delHeader(headers, name) {
  if (!headers) return;
  var lower = name.toLowerCase();
  for (var k in headers) {
    if (k.toLowerCase() === lower) delete headers[k];
  }
}
function setHeader(headers, name, value) {
  delHeader(headers, name);
  headers[name] = value;
}

function findTarget(url) {
  var afterHost = url.substring(url.indexOf("://") + 3);
  var slash = afterHost.indexOf("/");
  var path = slash < 0 ? "/" : afterHost.substring(slash);
  var host = "";
  if (path.indexOf("/api/v1/") === 0 || path.indexOf("/galaxy-gw/") === 0) {
    host = "https://galaxy-user-api.geely.com";
    if (path.indexOf("/galaxy-gw/") === 0) { path = path.substring("/galaxy-gw".length); }
  } else if (path.indexOf("/gep/") === 0 || path.indexOf("/recharge-gw/") === 0) {
    host = "https://api-recharge.geely.com";
    if (path.indexOf("/recharge-gw/") === 0) { path = path.substring("/recharge-gw".length); }
  } else {
    return null;
  }
  return { host: host, target: host + path, path: path };
}

function buildOutHeaders(requestHeaders, target) {
  var headers = {};
  var hdrs = requestHeaders || {};
  for (var k in hdrs) { headers[k] = hdrs[k]; }
  // 浏览器禁止头修复：Date 必须等于页面签名用的日期（页面经 X-Galaxy-Date 带出）
  var signedDate = getHeader(headers, "X-Galaxy-Date");
  setHeader(headers, "Date", signedDate || httpDateGMT8());
  delHeader(headers, "X-Galaxy-Date");
  setHeader(headers, "User-Agent", target.indexOf("galaxy-user-api") >= 0 ? GALAXY_UA : RECHARGE_UA);
  // 关键：Host 必须指向目标网关，否则网关按 h5-recharge 路由 → 200 空对象 {}
  var targetHost = target.indexOf("galaxy-user-api") >= 0 ? "galaxy-user-api.geely.com" : "api-recharge.geely.com";
  var hostKey = null;
  for (var kk in headers) {
    if (kk.toLowerCase() === "host") { hostKey = kk; }
    else if (kk.toLowerCase() === ":authority") { delete headers[kk]; }
  }
  if (hostKey) { headers[hostKey] = targetHost; }
  else { headers["Host"] = targetHost; }
  // Origin/Referer 是浏览器加的，转发时去掉更稳妥
  delHeader(headers, "Origin");
  delHeader(headers, "Referer");
  return headers;
}

function proxyToGateway(callback) {
  var url = $request.url || "";
  var t = findTarget(url);
  if (!t) { $done({}); return; }
  var signedDate = getHeader($request.headers, "X-Galaxy-Date");
  var headers = buildOutHeaders($request.headers, t.target);
  var method = ($request.method || "GET").toUpperCase();
  var body = $request.body || "";
  var opts = { url: t.target, headers: headers, timeout: 12000 };
  if (method !== "GET" && method !== "HEAD") { opts.body = body; }

  function onResp(err, resp, data) {
    try {
      if (!err && resp) {
        var outH = {};
        var rh = resp.headers || {};
        for (var hk in rh) { outH[hk] = rh[hk]; }
        delHeader(outH, "content-encoding");
        delHeader(outH, "content-length");
        delHeader(outH, "connection");
        setHeader(outH, "content-type", getHeader(outH, "content-type") || "application/json; charset=utf-8");
        setHeader(outH, RELAY_MARKER, "1");
        var debug = "url=" + url + "|target=" + t.target + "|ctx=" + (isResponse ? "resp" : "req") +
          "|status=" + resp.statusCode + "|caErr=" + getHeader(rh, "x-ca-error-message") +
          "|host=" + getHeader(headers, "Host") + "|date=" + getHeader(headers, "Date") +
          "|galDate=" + (signedDate ? "yes" : "no");
        setHeader(outH, "x-relay-debug", debug);
        console.log("[charge] relay " + method + " " + url + " -> " + t.target + " 返回 " + resp.statusCode);
        callback({ status: resp.statusCode || 200, headers: outH, body: data || "" });
      } else {
        console.log("[charge] relay 上游错误: " + String(err));
        callback({ status: 502, headers: { "content-type": "application/json; charset=utf-8", "x-relay-proxied": "1" },
                   body: JSON.stringify({ code: "502", message: "relay upstream error: " + String(err) }) });
      }
    } catch (e) {
      callback(null);
    }
  }

  if (method === "GET") { $httpClient.get(opts, onResp); }
  else if (method === "HEAD") { $httpClient.head(opts, onResp); }
  else if (method === "POST") { $httpClient.post(opts, onResp); }
  else if (method === "PUT") { $httpClient.put(opts, onResp); }
  else if (method === "DELETE") { $httpClient.delete(opts, onResp); }
  else { $httpClient.post(opts, onResp); }
}

// ---------------- 主流程：兼容 http-request / http-response 两种上下文 ----------------
try {
  var isResponse = (typeof $response !== "undefined") && $response;
  if (isResponse) {
    // http-response：先看是否已是我们代理过的响应（避免二次转发）
    var rhdrs = $response.headers || {};
    if (getHeader(rhdrs, RELAY_MARKER)) {
      $done({});
      return;
    }
    proxyToGateway(function (obj) {
      if (!obj) { $done({}); return; }
      $done(obj);
    });
  } else {
    // http-request：直接代理并返回响应（不把请求发往 h5-recharge）
    proxyToGateway(function (obj) {
      if (!obj) { $done({}); return; }
      $done({ response: obj });
    });
  }
} catch (e) {
  console.log("[charge] relay 异常: " + (e && e.message ? e.message : String(e)));
  $done({});
}
