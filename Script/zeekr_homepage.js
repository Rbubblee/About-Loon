// #13-15 首页模块 → 清空components
const body = JSON.parse($response.body);
if (body.data) {
    body.data.components = [];
}
$done({ body: JSON.stringify(body) });