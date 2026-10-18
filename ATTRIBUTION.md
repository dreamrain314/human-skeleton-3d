# 人体骨骼 3D 交互模型 · 署名与数据来源

## 3D 模型数据

### 当前模型（v1.3 起）：AnatomyTOOL 开放解剖模型

本程序的骨骼几何数据来自荷兰莱顿大学医学中心（LUMC）等五所大学解剖学系联合制作的
**AnatomyTOOL「Open 3D Anatomical Model for Education」**（基于 Z-Anatomy 项目重拓扑，
每块骨经 1–3 位解剖学家审核，含新增建模的表面细节）。

| 项目 | 内容 |
|---|---|
| 来源 | AnatomyTOOL — Open 3D Anatomical Model（skeleton selection model） |
| 网址 | https://anatomytool.org/open3dmodel |
| 基础项目 | Z-Anatomy（https://github.com/LluisV/Z-Anatomy ，CC BY-SA 4.0） |
| 许可证 | **CC BY-SA 4.0**<br>https://creativecommons.org/licenses/by-sa/4.0/ |
| 本仓库改编 | 剔除牙齿/肋软骨/手部籽骨；右侧骨镜像生成左侧（scale −1 节点）；
胸骨柄与胸骨体合并计入胸骨；**舌骨来自下述 BodyParts3D 模型**（Umeyama 局部拟合对位移植）；
节点以 FMA ID 命名用于点击拾取；保留原法线贴图 |

> ShareAlike 说明：模型文件 `models/skeleton.glb` 以 CC BY-SA 4.0 提供；
> 本项目的页面代码不基于该模型源码，不受其传染条款影响。

### 历史模型（v1.2 及之前）：BodyParts3D 4.0

舌骨网格仍取自 BodyParts3D，特此署名。

| 项目 | 内容 |
|---|---|
| 来源 | BodyParts3D 4.0 — The Database Center for Life Science (DBCLS), Japan |
| 原始数据集 | `isa_BP3D_4.0_obj_99.zip`（2,234 个独立 OBJ 网格） |
| 下载 | https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html |
| 许可证 | **CC BY 4.0**（官方现行许可）<br>https://creativecommons.org/licenses/by/4.0/ |
| 论文 | Mitsuhashi et al. (2009), *BodyParts3D: 3D structure database for anatomical concepts*<br>https://doi.org/10.1093/nar/gkn613 |

## 3D 引擎

| 组件 | 版本 | 许可证 |
|---|---|---|
| Three.js | r160 | MIT (Copyright 2010-2023 Three.js Authors) |
| OrbitControls.js | r160 addon | MIT |
| GLTFLoader.js | r160 addon | MIT |
| DRACOLoader.js | r160 addon | MIT |
| Draco 解码器 | Google Draco | Apache 2.0 |
| BufferGeometryUtils.js | r160 addon | MIT |

## 骨骼数量口径说明

- 教科书标准：人体骨骼 **206 块**
- 本模型提供 **202 块**可独立点击交互的骨
- 差异来源：埋藏于颞骨内的 **6 块听小骨**（锤骨、砧骨、镫骨各 2 块）未单独分离建模（−6）；
  含 **2 块第一跖骨籽骨**（+2，教科书一般不计入）
- 牙齿（32 颗）与肋软骨不属于 206 块骨范畴，未建模计入
- 骶骨与尾骨为两块独立骨骼，可分别点选与隔离查看

## 免责声明

模型基于欧洲成人参考体型并经解剖学家审核，不涵盖全部人体结构或个体变异。
本程序仅供**教育科普用途**，不得用于临床诊断或手术。
