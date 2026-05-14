MapLibre 字形（.pbf）目录：每个字体一个子文件夹，名字须与样式里 text-font 完全一致。

当前 offline-map.json 使用：
  "glyphs": "../fonts/{fontstack}/{range}.pbf"
故浏览器请求：/fonts/Noto Sans Regular/0-255.pbf → 即本目录下 Noto Sans Regular/*.pbf

换字体时：改 offline-map.json 里对应图层的 text-font，并保证本目录下有同名子文件夹及 .pbf。

整包可从 GitHub Release 解压对应字体文件夹至此：
https://github.com/openmaptiles/fonts/releases/tag/v2.0
