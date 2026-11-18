// 请求阶段：只做两件事
//  1) 把 Accept-Encoding 里的 br 去掉（brotli 有时会让 Loon 解不开响应体，
//     导致 http-response 脚本拿不到 body 甚至不执行）
//  2) 弹一条探针通知，确认链路
try { $notification.post("ZEEKR PING", "请求命中", "container/page 已被捕获"); } catch (e) {}

try {
  if ($request && $request.headers) {
    var h = Object.assign({}, $request.headers);
    var aeKey = null;
    for (var k in h) {
      if (String(k).toLowerCase() === "accept-encoding") { aeKey = k; break; }
    }
    if (aeKey) {
      var ae = String(h[aeKey]).replace(/,\s*br\b/gi, "").replace(/^br\b\s*,?\s*/gi, "").trim();
      if (!ae || ae === "br") ae = "gzip, deflate";
      h[aeKey] = ae;
    } else {
      h["Accept-Encoding"] = "gzip, deflate";
    }
    $done({ headers: h });
    return;
  }
} catch (e) {}

$done({});
