# 社区页面容器过滤
# 基于抓包: container/page 响应中 data.records[] 结构:
#   tag=BBS          → 社区顶部广告Banner + APP开屏弹窗 + 首页启动弹窗
#   tag=BBS_MSG      → 社区内容区(美图/极速时氪/极氪出发/九宫格)
#   tag=PARTNERLEAGUE → 极氪电台/合作伙伴
#   tag=OVSERVICE    → 用车服务(保留)
#   tag=HAIBAO       → 个人页(由 zeekr_service.jq 处理)
#
# 策略: 移除所有社区和广告相关tag, 只保留 OVSERVICE 和 HAIBAO

.data.records |= map(select(
  .tag != "BBS" and
  .tag != "BBS_MSG" and
  .tag != "PARTNERLEAGUE"
))
