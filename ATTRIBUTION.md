# 人体骨骼 3D 交互模型 · 署名与数据来源

## 3D 模型数据

本程序的骨骼几何数据来自 **BodyParts3D 4.0**。

| 项目 | 内容 |
|---|---|
| 来源 | BodyParts3D 4.0 — The Database Center for Life Science (DBCLS), Japan |
| 作者 | Mitsuhashi N., Fujieda K., Tamura T., Kawamoto S., Takagi T., Okubo K. |
| 原始数据集 | `isa_BP3D_4.0_obj_99.zip`（2,234 个独立 OBJ 网格） |
| 下载 | https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html |
| 许可证 | **CC BY 4.0**（官方现行许可）<br>https://creativecommons.org/licenses/by/4.0/ |
| 论文 | Mitsuhashi et al. (2009), *BodyParts3D: 3D structure database for anatomical concepts*<br>https://doi.org/10.1093/nar/gkn613 |

> 说明：原始 OBJ 文件内的注释提及较早的 CC BY-SA 2.1 Japan 许可，
> 以上述官方数据库现行许可页面为准，明确允许在 CC BY 4.0 下再分发与改编。

### 本项目的改编

- 从 2,234 个源网格中筛选出骨骼相关的 **203 个网格**，按 FMA 概念合并为 **200 个骨骼节点**
- 坐标系由 **毫米 / Z-up** 转换为 **米 / Y-up**（烘焙进顶点）
- 几何进行了适度简化，合并后约 **505,532 个三角面**
- 每个网格节点以 **FMA ID** 命名，用于点击拾取
- 中文名称与说明文字由本项目编写（基于 FMA 英文术语 + 解剖学常识）

## 3D 引擎

| 组件 | 版本 | 许可证 |
|---|---|---|
| Three.js | r160 | MIT (Copyright 2010-2023 Three.js Authors) |
| OrbitControls.js | r160 addon | MIT |
| GLTFLoader.js | r160 addon | MIT |
| BufferGeometryUtils.js | r160 addon | MIT |

## 骨骼数量口径说明

- 教科书标准：人体骨骼 **206 块**
- 本模型提供 **200 块**可独立点击交互的骨
- 差异来源：埋藏于颞骨内的 **6 块听小骨**（锤骨、砧骨、镫骨各 2 块）在源数据中未作为独立网格分离

## 免责声明

BodyParts3D 基于成年男性 MRI（TARO）参考数据并经解剖学绘图标定，
不涵盖全部人体结构或个体变异。本程序仅供**教育科普用途**，不得用于临床诊断或手术。
