// #18 我的页面 → 移除HAIBAO中"主题专区限时开放"
const body = JSON.parse($response.body);
if (body.data && body.data.records) {
    body.data.records = body.data.records.map(r => {
        if (r.tag === "HAIBAO" && r.places) {
            r.places = r.places.filter(p => p.name !== "主题专区限时开放");
        }
        return r;
    });
}
$done({ body: JSON.stringify(body) });
