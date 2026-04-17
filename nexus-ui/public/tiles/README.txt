map.pmtiles 放此目录后，在 nexus-ui/.env.local 显式配置（样式与二维初始视角等必填项见 nexus-ui/.env.example），例如：

NEXT_PUBLIC_MAP2D_STYLE_URL=/map-styles/offline-map.json
NEXT_PUBLIC_MAP2D_MINI_STYLE_URL=/map-styles/offline-map.json
NEXT_PUBLIC_MAP2D_INITIAL_CENTER=经度,纬度
NEXT_PUBLIC_MAP2D_INITIAL_ZOOM=数字

offline-map.json 内 pmtiles 地址需与当前访问站点的协议/域名/端口一致；改完重启 npm run dev。
