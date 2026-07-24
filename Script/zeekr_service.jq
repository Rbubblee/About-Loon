# 我的页面推广入口过滤
# 基于抓包: container/page 响应中 data.records[] 结构:
#   tag="HAIBAO" type="banner" name="个人页" → 我的页面推广入口容器
#     places[] 中包含:
#       - "主题专区限时开放" → 营销活动入口(中间部分广告)
#       - "达人招募" → KOL招募推广(中间部分广告)
#       - "邀请好友" / "服务大厅" / "zgreen" / "卡包" / "极值" → 功能入口(保留)
#
# 策略:
#   1. 对 HAIBAO 记录，过滤 places 中的纯广告条目
#   2. 移除独立的营销容器记录

# 移除 HAIBAO 中的推广条目 (基于名称匹配)
if .data.records then
  .data.records |= map(
    if .tag == "HAIBAO" then
      .places |= map(select(
        .name != "主题专区限时开放" and
        .name != "达人招募"
      ))
    else . end
  )
else . end

# 移除纯营销/活动H5入口 (如果container/page中有独立的营销记录)
| if .data.records then
    .data.records |= map(select(
      .path? | (
        test("pagesActivity/tenMillionReg") or
        test("activity-h5\\.zeekrlife\\.com/activity/index")
      ) | not
    ))
  else . end

# 如果 HAIBAO 的 places 全部被清空，保留容器壳(避免UI异常)
| .
