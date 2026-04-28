# DDS 代码重新构建指南

## 前提条件

- 已安装 `fastddsgen` 工具
- 已安装 `cmake`、`make`、`g++` 等编译工具
- 已安装 `swig`（用于生成 Python 绑定）

## 重新构建步骤

### 1. 修改 IDL 文件

编辑 `TrackRealTimeStatus.idl`，修改需要更改的字段类型（例如将 `unsigned long` 改为 `unsigned long long`）。

### 2. 从 IDL 生成 C++ 代码和 Python 绑定

```bash
cd /workspace/backend/app/dds
fastddsgen -replace -python TrackRealTimeStatus.idl
```

**重要**：必须使用 `-python` 参数来生成 `TrackRealTimeStatus.i` SWIG 接口文件。

这会生成以下文件：
- `TrackRealTimeStatus.hpp`
- `TrackRealTimeStatusPubSubTypes.cxx`
- `TrackRealTimeStatusPubSubTypes.hpp`
- `TrackRealTimeStatusTypeObjectSupport.cxx`
- `TrackRealTimeStatusTypeObjectSupport.hpp`
- `TrackRealTimeStatus.i`（SWIG 接口文件，使用 `-python` 参数生成）

### 3. 清理旧的构建文件

```bash
cd /workspace/backend/app/dds
rm -rf build CMakeCache.txt cmake_install.cmake Makefile
mkdir -p build
```

### 4. 编译生成库和 Python 绑定

```bash
cd build
cmake ..
make
```

### 5. 复制生成的文件

编译完成后，将生成的文件复制到 `dds` 目录：

```bash
cd /workspace/backend/app/dds
cp build/_TrackRealTimeStatusWrapper.so .
cp build/libTrackRealTimeStatus.so .
cp build/TrackRealTimeStatus.py .
```

### 6. 验证生成结果

检查头文件中的类型是否正确：

```bash
grep -A 2 "m_trackId\|m_uniqueId" TrackRealTimeStatus.hpp
```

应该看到 `uint64_t` 而不是 `uint32_t`。

### 7. 重启应用

重启 Python 应用以加载新的 `.so` 文件。

## 注意事项

- 如果修改了 IDL 文件，必须重新执行步骤 2-6
- **必须使用 `-python` 参数**来生成 `.i` 文件，否则 CMake 编译会报错找不到 `TrackRealTimeStatus.i`
- 如果 IDL 中的类型从 32 位改为 64 位，使用 `-python` 参数生成的 `.i` 文件应该会自动更新类型，但建议验证一下类型是否正确
- 如果编译失败，检查：
  1. `fastddsgen` 是否成功生成了所有必需的文件（包括 `.i` 文件）
  2. `.i` 文件中的类型是否与 `.hpp` 文件中的类型一致

