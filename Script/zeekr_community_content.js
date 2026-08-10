// #6-10 社区内容区 → 移除 tag=BBS_MSG 和 tag=PARTNERLEAGUE 的记录
const body = JSON.parse($response.body);
if (body.data && body.data.records) {
    body.data.records = body.data.records.filter(r => r.tag !== "BBS_MSG" && r.tag !== "PARTNERLEAGUE");
}
$done({ body: JSON.stringify(body) });
