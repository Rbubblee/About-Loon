# 我的页面推广入口过滤
# 基于抓包: container/page 响应中 data.records[]:
#   tag=HAIBAO type=banner name="个人页" → 我的页面推广容器
#     places[] 中的推广条目:
#       - "主题专区限时开放" → 千万注册营销活动(中间部分广告)
#       - "达人招募" → KOL招募推广(中间部分广告)
#       - "邀请好友" → 社交裂变推广
#       - "服务大厅" → 客服入口(非必要中间模块)
#       - "zgreen" → 环保积分推广
#       - "卡包" → 优惠券推广
#       - "极值" → 积分推广
#
# 策略: 移除所有推广性质的places, 保留功能性入口(如有)

if .data.records then
  .data.records |= map(
    if .tag == "HAIBAO" then
      .places |= map(select(
        .name != "主题专区限时开放" and
        .name != "达人招募" and
        .name != "邀请好友" and
        .name != "服务大厅" and
        .name != "zgreen" and
        .name != "卡包" and
        .name != "极值"
      ))
    else . end
  )
else . end

# 移除通过 activity-h5 链接的推广记录
| if .data.records then
    .data.records |= map(select(
      (.path? // "" | test("activity-h5\\.zeekrlife\\.com") | not)
    ))
  else . end
