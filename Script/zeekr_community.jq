# 社区页面容器过滤
# 基于抓包: container/page 响应中 data.records[] 结构:
#   tag="BBS" + type="banner"  → 社区顶部广告Banner (推荐顶部banner/金刚位)
#   tag="YYJHY" + type="bbs"   → 社区UGC内容区 (千万UGC专区)
#   tag="OVSERVICE"            → 用车服务模块 (保留)
#   tag="HAIBAO"               → 个人页推广入口
#
# 策略: 移除 tag="BBS" 的记录(社区广告Banner),
#       保留 tag="OVSERVICE" 和 tag="HAIBAO" (由 zeekr_service.jq 进一步处理)

.data.records |= map(select(.tag != "BBS"))
