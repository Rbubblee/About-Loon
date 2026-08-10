// ============================================================
// charge_live_client.js  v1.0（极氪H5页面内实时拉取银河数据的客户端脚本）
//
// 由 charge_live_inject.js 以 <script src="https://h5-recharge.geely.com/
// wallbox-client.js"> 注入极氪H5页面。本脚本：
//   1. 拦截页面里发往 sea-home-prod /app/equipment/* 的 POST（fetch + XHR）；
//   2. 映射到的接口：转发给隐藏 iframe（charge_live_relay.js，白名单域名），
//      由中继页现场签名实时调银河接口，结果喂回页面——每次请求都是实时数据；
//   3. 未映射/中继失败/token失效：回退原请求（走 Loon 响应注入的缓存兜底）。
//
// 注意：本文件代码会被 Loon 原样作为 JS 返回，代码里不要出现反斜杠（避免
// 模板字符串转义问题）；__USER_ID__ 由脚本在响应时替换为 persistentStore 值。
// ============================================================

var CLIENT = `(function () {
  if (window.__chargeLive) { return; }
  window.__chargeLive = 1;

  var USER_ID = "__USER_ID__";
  var RELAY_URL = "https://h5-recharge.geely.com/wallbox-relay";
  var TIMEOUT = 8000;

  var MAP = {
    "/app/equipment/v2/manage/getMyEquipments": { path: "/gep/v2/home/charge/getMyEquipments", build: function (b) { return { sourceTypeKey: "0010000", userId: USER_ID }; } },
    "/app/equipment/v2/manage/getMyEquipmentDetail": { path: "/gep/v1/home/charge/getMyEquipmentDetail", build: function (b) { return { sourceTypeKey: "0010000", userId: USER_ID, equipmentId: b.equipmentId || "", providerNo: b.providerNo || "DIRECT_WDZ" }; } },
    "/app/equipment/v2/manage/getMyEquipmentCards": { path: "/gep/v2/home/charge/getMyEquipmentCards", build: function (b) { return { sourceTypeKey: "0010000", userId: USER_ID, equipmentId: b.equipmentId || "", providerNo: b.providerNo || "DIRECT_WDZ" }; } },
    "/app/equipment/v2/manage/getMyEquipmentShares": { path: "/gep/v1/home/charge/getMyEquipmentShares", build: function (b) { return { sourceTypeKey: "0010000", userId: USER_ID, equipmentId: b.equipmentId || "", providerNo: b.providerNo || "DIRECT_WDZ" }; } },
    "/app/equipment/v2/manage/getEquipmentVersions": { path: "/gep/v1/home/charge/getEquipmentVersions", build: function (b) { return { sourceTypeKey: "0010000", userId: USER_ID, equipmentId: b.equipmentId || "", providerNo: b.providerNo || "DIRECT_WDZ" }; } },
    "/app/equipment/v2/manage/getEquipmentBindVins": { path: "/gep/v2/home/charge/getEquipmentBindVins", build: function (b) { return { sourceTypeKey: "0010000", userId: USER_ID, equipmentId: b.equipmentId || "", providerNo: b.providerNo || "DIRECT_WDZ" }; } },
    "/app/equipment/v2/manage/getEquipmentChargeOrders": { path: "/gep/v2/home/charge/getEquipmentChargeOrders", build: function (b) { return { sourceTypeKey: "0010000", userId: USER_ID, equipmentId: b.equipmentId || "", providerNo: b.providerNo || "DIRECT_WDZ", calcType: 1, pageNum: 1, pageSize: 10 }; } },
    "/app/equipment/v2/manage/getEquipmentChargeOrderCalc": { path: "/gep/v2/home/charge/getEquipmentChargeOrderCalc", build: function (b) { return { sourceTypeKey: "0010000", userId: USER_ID, equipmentId: b.equipmentId || "", providerNo: b.providerNo || "DIRECT_WDZ", calcType: 1 }; } },
    "/app/sim/v1/netflow/generateRenewUrl": { path: "/sim/v1/netflow/generateRenewUrl", build: function (b) { return { sourceTypeKey: "0010000", userId: USER_ID, deviceSn: b.deviceSn || b.equipmentId || "", providerNo: b.providerNo || "DIRECT_WDZ" }; } },
    "/app/equipment/v2/manage/getEquipmentExt": { synth: function (b) { return JSON.stringify({ code: "0", message: "SUCCESS", data: { equipmentId: b.equipmentId || "", equipmentName: "我的家桩", hardwareVersion: "", softwareVersion: "", activeDate: "", warrantyRestDays: null, iccId: "", sim: "", simRestDays: null, isNetworkService: 0, isShowSetEquipmentName: 1, isShowNetworkService: 1, manufacturerPhone: "4001876000" } }); } },
    "/app/equipment/v2/manage/checkBindMyEquipment": { synth: function () { return JSON.stringify({ code: "0", message: "SUCCESS", data: { isNeedBlueSk: 0 } }); } }
  };

  var iframe = null;
  var pending = {};
  var seq = 0;

  function ensureIframe() {
    if (iframe && iframe.contentWindow) { return; }
    iframe = document.createElement("iframe");
    iframe.src = RELAY_URL;
    iframe.style.cssText = "display:none;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(iframe);
  }

  window.addEventListener("message", function (e) {
    var d = e.data || {};
    var p = pending[d.id];
    if (!p) { return; }
    delete pending[d.id];
    p(d);
  });

  function liveCall(path, body) {
    return new Promise(function (resolve) {
      try { ensureIframe(); } catch (e) { resolve(null); return; }
      var id = "z" + (++seq);
      pending[id] = resolve;
      try {
        iframe.contentWindow.postMessage({ id: id, path: path, body: body }, "*");
      } catch (e) { delete pending[id]; resolve(null); return; }
      setTimeout(function () { if (pending[id]) { delete pending[id]; resolve(null); } }, TIMEOUT);
    });
  }

  function pathOf(url) {
    try { return new URL(url, location.href).pathname; } catch (e) { return ""; }
  }

  function isTarget(url, method) {
    if ((method || "").toUpperCase() !== "POST") { return false; }
    if (url.indexOf("sea-home-prod.haohanpower.tech") < 0) { return false; }
    return url.indexOf("/app/equipment/") >= 0;
  }

  function parseBody(t) {
    try { return JSON.parse(t || "{}"); } catch (e) { return {}; }
  }

  function okResult(res) {
    return !!(res && res.code !== undefined && String(res.code) === "0");
  }

  // ---- fetch 拦截 ----
  var of = window.fetch;
  if (of) {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
      var self = this;
      var args = arguments;
      if (isTarget(url, method)) {
        var rule = MAP[pathOf(url)];
        if (rule) {
          var b = parseBody(init && init.body);
          if (rule.synth) {
            return Promise.resolve(new Response(rule.synth(b), { status: 200, headers: { "content-type": "application/json" } }));
          }
          return liveCall(rule.path, JSON.stringify(rule.build(b))).then(function (res) {
            if (okResult(res)) {
              return new Response(res.text, { status: 200, headers: { "content-type": "application/json" } });
            }
            return of.apply(self, args);
          });
        }
      }
      return of.apply(self, args);
    };
  }

  // ---- XHR 拦截 ----
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__chm = (m || "GET").toUpperCase();
    this.__chu = u || "";
    return _open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var self = this;
    if (isTarget(this.__chu, this.__chm)) {
      var rule = MAP[pathOf(this.__chu)];
      if (rule) {
        var b = parseBody(body);
        function finish(text) {
          try {
            self.status = 200;
            self.statusText = "OK";
            self.response = text;
            self.responseText = text;
            self.readyState = 4;
            var ev = new Event("readystatechange");
            self.dispatchEvent(ev);
            if (self.onreadystatechange) { self.onreadystatechange.call(self, ev); }
            var ev2 = new Event("load");
            self.dispatchEvent(ev2);
            if (self.onload) { self.onload.call(self, ev2); }
            if (self.onloadend) { self.onloadend.call(self, ev2); }
          } catch (e) {}
        }
        if (rule.synth) { finish(rule.synth(b)); return; }
        liveCall(rule.path, JSON.stringify(rule.build(b))).then(function (res) {
          if (okResult(res)) { finish(res.text); } else { _send.call(self, body); }
        });
        return;
      }
    }
    return _send.apply(this, arguments);
  };
})();`;

// ---------------- 主流程 ----------------
try {
  var userId = $persistentStore.read("galaxyUserId") || "";
  var body = CLIENT.replace("__USER_ID__", userId);
  var headers = $response.headers || {};
  headers["content-type"] = "application/javascript; charset=utf-8";
  delete headers["content-encoding"];
  delete headers["Content-Encoding"];
  delete headers["content-length"];
  delete headers["Content-Length"];
  $done({ status: 200, headers: headers, body: body });
} catch (e) {
  console.log("[charge] 客户端脚本生成失败: " + (e && e.message ? e.message : String(e)));
  $done({});
}
