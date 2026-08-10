// #3 品牌关怀浮窗 → isShow改为0
const body = JSON.parse($response.body);
body.data.isShow = 0;
$done({ body: JSON.stringify(body) });