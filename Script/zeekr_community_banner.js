// #4#5 社区BBS广告Banner → 移除 tag=BBS 的记录
const body = JSON.parse($response.body);
if (body.data && body.data.records) {
    body.data.records = body.data.records.filter(r => r.tag !== "BBS");
}
$done({ body: JSON.stringify(body) });