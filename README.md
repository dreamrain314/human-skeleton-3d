# 人体骨骼 3D 交互模型 🦴

一个在浏览器中运行的本地 3D 骨骼浏览程序：**自由旋转 / 缩放 / 移动视角，点击任意一块骨头即显示中文名称与说明**。

- **200 块**可独立点击交互的骨骼（教科书标准 206 块，差 6 块听小骨，见 [ATTRIBUTION.md](ATTRIBUTION.md)）
- 数据来自权威开源解剖数据库 **BodyParts3D 4.0**（DBCLS，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)）
- 基于 **Three.js r160**（MIT，已本地化），**纯静态、零构建、零联网、零依赖**

## 🌐 在线体验

**无需安装任何东西，直接打开：[https://dreamrain314.github.io/human-skeleton-3d/](https://dreamrain314.github.io/human-skeleton-3d/)**

（由 GitHub Pages 自动部署 main 分支；首次加载需下载约 9MB 模型，请耐心等待）

## 快速开始

任选一种方式在本目录起一个静态服务器，然后用浏览器打开提示的地址：

```bash
python -m http.server 8765     # Python（标准库，推荐）
npx serve -l 8765              # 或 Node.js
php -S localhost:8765          # 或 PHP
```

Windows 直接双击 `start.bat`；macOS 双击 `start.command`。

> 必须通过 `http://` 访问（ES Module 限制），直接双击 index.html 用 `file://` 打开会因 CORS 失败。

## 文件结构

| 路径 | 说明 |
|---|---|
| `index.html` / `app.js` | 页面与交互逻辑（拾取、高亮、信息面板） |
| `models/skeleton.glb` | 骨骼模型（203 个网格 → 200 个骨骼节点，约 50 万三角面） |
| `data/bones.json` | 骨骼中文名称与说明数据 |
| `lib/`、`utils/` | Three.js r160 及其 addon（本地化副本） |
| [使用与技术说明.md](使用与技术说明.md) | 详细使用说明与技术实现（含常见问题） |
| [ATTRIBUTION.md](ATTRIBUTION.md) | 数据来源、许可证与改编说明 |

## 许可

- 骨骼几何数据：BodyParts3D 4.0，CC BY 4.0 © The Database Center for Life Science
- 代码与中文文案：同仓库根许可（见 ATTRIBUTION.md）
- 仅供教育科普用途，不得用于临床诊断或手术
