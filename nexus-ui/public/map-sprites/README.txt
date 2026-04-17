雪碧图（sprite = sprite.json + sprite.png，可选 @2x）

- 用途：样式里使用 icon-image、图案填充等时，MapLibre 会请求 `${sprite}.json` / `.png`。
- 纯文字地名/路名：只依赖样式里的 glyphs，不依赖 sprite。
- 离线：把雪碧图放在 public 下，样式里写同源路径，例如 offline-map.json 中的：
  "sprite": "/map-sprites/dark-matter/sprite"
  （不要写 .json / .png 后缀）

dark-matter/ 目录内为从 Carto Dark Matter 样式拉取的同名文件，与矢量瓦片无关，体积很小，可随项目一起部署。
