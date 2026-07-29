// container/page 统一过滤
// argument: [blockCommunityBanner, blockCommunityContent, blockProfileAds]
const args = (typeof $argument === 'string' ? JSON.parse($argument) : $argument) || [];
const blockBanner   = args[0] === 'true' || args[0] === true;
const blockContent  = args[1] === 'true' || args[1] === true;
const blockProfile  = args[2] === 'true' || args[2] === true;

const body = JSON.parse($response.body);
if (!body.data || !body.data.records) {
    $done({ body: JSON.stringify(body) });
    return;
}

body.data.records = body.data.records.filter(r => {
    if (blockBanner && (r.tag === 'BBS')) return false;
    if (blockContent && (r.tag === 'BBS_MSG' || r.tag === 'PARTNERLEAGUE')) return false;
    return true;
});

if (blockProfile) {
    body.data.records = body.data.records.map(r => {
        if (r.tag === 'HAIBAO' && r.places) {
            r.places = r.places.filter(p => p.name !== '主题专区限时开放');
        }
        return r;
    });
}

$done({ body: JSON.stringify(body) });