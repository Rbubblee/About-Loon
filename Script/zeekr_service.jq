# 移除我的页面HAIBAO容器中"主题专区限时开放"推广条目 (图片来自3692管理号)
if .data.records then
  .data.records |= map(
    if .tag == "HAIBAO" then
      .places |= map(select(.name != "主题专区限时开放"))
    else . end
  )
else . end