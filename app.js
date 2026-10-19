import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { store } from './store.js';

/* ============ 全局状态 ============ */
const state = {
  bones: null,          // FMA -> {cn, latin, desc, region, group, en}
  meshes: [],           // {mesh, fma}
  byFma: new Map(),     // FMA -> [mesh]
  selected: null,
  hovered: null,
  regionVisible: {},    // 区域 -> bool
  showLabel: true,
  xray: false,
  spin: false,
  keyMode: false,       // 标记标红模式：用户标记的骨持久染橙红
  onlyKey: false,       // 仅看标记：隐藏未标记骨（叠加在区域显隐之上）
  keySet: new Set(),    // 用户自定义标记集（来自 store，localStorage 持久化）
  hiddenSet: new Set(), // 会话级：用户手动隐藏的骨（不持久化）
  ann: null,            // FMA -> [结构标注条目]（data/annotations.json）
  annPair: null,        // 成对骨 FMA 映射（右↔左），懒构建
  annSprites: [],       // 当前显示的标注点 {sprite, entry, name, mesh}
  annEdit: null,        // 编辑模式工作副本 {fma: [pts 条目]}
  annSel: null,         // 编辑模式选中的点 {fma, entry, ptIndex, sprite, mesh}
  editMode: false,      // 标注编辑模式（URL ?edit=1）
  isolated: null,       // 单骨隔离模式：仅显示该骨
  detailCache: null,    // bones-detail.json 的加载 Promise（懒加载）
  panY: 0,              // 当前垂直偏移（世界单位），只由右侧滑块驱动
  homeDist: 0,          // 默认视距，重置视角时回到这里
  panRange: 1,          // 滑块满行程对应的世界单位
};
const REGIONS = ['颅骨', '脊柱', '胸廓', '上肢', '下肢'];

/* 骨骼外观：干骨的象牙米黄，而不是纯白或灰蓝 */
const BASE_COLOR = new THREE.Color(0xe8ddc3);
const SEL_COLOR  = new THREE.Color(0xff4d4f);
const HOV_COLOR  = new THREE.Color(0x4da3ff);
const KEY_COLOR  = new THREE.Color(0xff7043);  // 重点标红的橙红，与选中红区分
const XRAY_OPACITY = 0.34;   // X 光模式透明度（统一常量）
const XRAY_TINT  = new THREE.Color(0x9fd8e8);  // X 光下的冷青色
const SEL_EMISSIVE = new THREE.Color(0x551010);
const XRAY_EMISSIVE = new THREE.Color(0x16404d);
const NO_EMISSIVE  = new THREE.Color(0x000000);

/* 所有骨共用同一套 PBR 参数（干骨质感：哑光、微糙、几乎无金属感）。
   不启用 clearcoat / sheen：这两个特性会显著增加片元着色开销，200 块骨很吃帧率 */
const BONE_MAT = {
  roughness: 0.62,
  metalness: 0.0,
  envMapIntensity: 1.0,
  flatShading: false,
};

/* ============ 场景 ============ */
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
/* 雾只在远得多的距离才起作用，避免把模型染成背景色「吞掉」（见 boot 里的二次校准） */
scene.fog = new THREE.Fog(0x0b0e14, 12, 40);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 0.05, 1.9);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.3;   // 0.06 太"滑"，拖动有明显迟滞；0.3 接近跟手且保留一点平滑
controls.minDistance = 0.15;
controls.maxDistance = 6;
controls.target.set(0, 0.05, 0);
controls.autoRotateSpeed = 0.8;

/* 平移全部交给右侧滑块：水平方向永远锁死，右键也不再触发平移
   （浏览器里右键拖动会弹出系统菜单，交互体验很差） */
controls.enablePan = false;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: null,            // 右键不绑定任何操作
};
// 双指手势同样去掉平移，只保留缩放 + 旋转
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_ROTATE,
};

/* ============ 灯光 ============ */
/* 有了环境贴图之后，平行光只负责「方向感」和轮廓，不再承担全部照明。
   正面偏亮会显得扁平，所以主光加强、补光压暗，拉开明暗对比 */
scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x2a2418, 0.32));
const key = new THREE.DirectionalLight(0xfff6e8, 2.35); key.position.set(3, 5, 4); scene.add(key);
const fill = new THREE.DirectionalLight(0xa8c6ff, 0.55); fill.position.set(-4, 1, -3); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 1.0); rim.position.set(0, -3, 2); scene.add(rim);
const rim2 = new THREE.DirectionalLight(0xffe9cf, 0.6); rim2.position.set(-2, 2, -4); scene.add(rim2);

/* ============ 环境光照（IBL） ============
   骨骼の立体感主要来自环境反射，而不是单纯的灯光。
   这里用几张贴出不同颜色的发光面板搭一个简易「摄影棚」，
   交给 PMREMGenerator 烘成环境贴图，骨骼就有了柔和的高光与明暗过渡。 */
function buildStudioEnvScene() {
  const envScene = new THREE.Scene();
  const geo = new THREE.PlaneGeometry(14, 14);
  const panel = (hex, intensity, pos, rot) => {
    const mat = new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide });
    mat.color.multiplyScalar(intensity);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.set(rot[0], rot[1], rot[2]);
    envScene.add(m);
  };
  panel(0xffffff, 3.6, [0, 7, 0], [Math.PI / 2, 0, 0]);        // 顶部主光
  panel(0xfff2df, 1.15, [0, 0.6, 7], [0, 0, 0]);               // 正面柔光（过亮会冲掉正面立体感）
  panel(0xdce8ff, 1.15, [-7, 1, 0], [0, Math.PI / 2, 0]);      // 左侧冷补
  panel(0xffe7d3, 1.05, [7, 1, 0], [0, -Math.PI / 2, 0]);      // 右侧暖补
  panel(0x2b303b, 0.8, [0, -7, 0], [-Math.PI / 2, 0, 0]);      // 地面反弹光
  return { scene: envScene, geo };
}

function setupEnvironment() {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const { scene: envScene, geo } = buildStudioEnvScene();
    const rt = pmrem.fromScene(envScene, 0.04);
    scene.environment = rt.texture;
    pmrem.dispose();
    envScene.traverse(o => { if (o.isMesh) o.material.dispose(); });
    geo.dispose();
  } catch (e) {
    // 环境贴图只是加分项，失败时退回纯灯光照明，不影响正常使用
    console.warn('环境贴图生成失败，已回退到纯灯光照明：', e);
  }
}

/* ============ UI 引用 ============ */
const $ = id => document.getElementById(id);
const infoEl = $('info'), hoverEl = $('hover');
const loaderEl = $('loader'), barEl = $('bar'), loadTxt = $('loadTxt');

/* ============ 加载数据 ============ */
async function boot() {
  try {
    // 先探测 WebGL（无 WebGL 时给出友好提示而不是卡在加载页）
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) {
      loadTxt.innerHTML = '当前浏览器/环境不支持 WebGL，无法显示 3D 模型。<br>' +
        '请使用最新版 Chrome / Edge / Firefox 打开本页面。';
      document.querySelector('#loader .spin').style.display = 'none';
      return;
    }

    // bones.json 带协商缓存：数据更新后普通刷新即可拿到新版
    const bones = await fetch('./data/bones.json', { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error('bones.json 加载失败 HTTP ' + r.status);
      return r.json();
    });
    state.bones = bones;
    store.init();
    state.keySet = new Set(store.getMarked());
    state.ann = await fetch('./data/annotations.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : {}).catch(() => ({}));
    state.editMode = new URLSearchParams(location.search).has('edit');
    if (state.editMode) {
      const eb = document.getElementById('editBar');
      eb.classList.add('show');
      eb.innerHTML = '标注编辑模式 —— 点击骨面：新增 · 点击标注选中后点骨面：移动 · <span id="annExport">导出标注数据</span>';
      document.getElementById('annExport').onclick = exportAnnotations;
    }

    // 模型是 Draco 压缩（3MB 级），解码器本地化，不依赖外网 CDN
    const draco = new DRACOLoader().setDecoderPath('./lib/draco/');
    const gltf = await new Promise((res, rej) => {
      // 正确的回调顺序: load(url, onLoad, onProgress, onError)
      // 版本参数随模型更新手动递增，避免 Pages 缓存导致用户拿到旧模型
      new GLTFLoader().setDRACOLoader(draco).load('./models/skeleton.glb?v=20261019j', res,
        p => {
          if (p.total) {
            // Pages 对 glb 走 gzip 时 loaded 按解压字节计、total 是压缩大小，比值可能 >100%，需截断
            const pct = Math.min(100, p.loaded / p.total * 100).toFixed(0);
            barEl.style.width = pct + '%';
            loadTxt.textContent = `正在加载骨骼模型… ${pct}%`;
          }
        },
        err => rej(new Error('模型加载失败: ' + (err.message || err.type || '未知错误'))));
    });

    setupEnvironment();

    // 模型：每个节点名 = FMA ID（成对骨的左侧是 scale=-1 的镜像节点，与本骨共享几何体）
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    model.traverse(o => {
      if (o.isMesh) {
        // 源 glb 只有顶点坐标、没有法线，不补的话任何光照都算不出明暗 → 渲染成全黑
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
        if (!o.geometry.attributes.uv) {
          // 部分贴图通道需要 uv，缺失时补一组占位，避免 Three.js 告警
          const count = o.geometry.attributes.position.count;
          o.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
        }
        // GLTFLoader 对重名节点追加 _1/_2 后缀（胸骨柄/胸骨体同名 FMA7371）；FMA 本身不含下划线，安全剥除
        const fma = (o.name || o.parent?.name || '').replace(/_\d+$/, '');
        o.userData.fma = fma;
        const srcNormal = o.material && o.material.normalMap;   // 保留解剖细节法线贴图
        const srcScale = o.material && o.material.normalScale;
        o.material = new THREE.MeshPhysicalMaterial(Object.assign({ color: BASE_COLOR.clone() }, BONE_MAT));
        if (srcNormal && o.geometry.attributes.uv.itemSize === 2 && o.geometry.attributes.uv.array.some(v => v !== 0)) {
          o.material.normalMap = srcNormal;
          o.material.normalScale = srcScale ? srcScale.clone() : new THREE.Vector2(1, 1);
        }
        state.meshes.push({ mesh: o, fma });
        if (!state.byFma.has(fma)) state.byFma.set(fma, []);
        state.byFma.get(fma).push(o);
      }
    });

    // 居中到原点 + 适配相机
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    model.position.sub(center);
    scene.add(model);

    const maxDim = Math.max(size.x, size.y, size.z);
    controls.minDistance = maxDim * 0.01;   // 允许凑近到听小骨等毫米级细节（near=0.01 之上留有余量）
    controls.maxDistance = maxDim * 6;
    camera.position.set(0, 0, maxDim * 1.55);
    controls.target.set(0, 0, 0);
    controls.update();
    // 记下「家」视角。用完整模型尺寸，不受当前区域显隐影响；
    // 否则隐藏几个区域后再重置，包围盒变小会导致画面被放大。
    state.homeDist = maxDim * 1.55;
    state.panRange = Math.max(size.y, maxDim) * 0.6;
    // 雾的远端必须远超最大可视距离，否则拉远时模型会被背景色吃掉
    scene.fog.near = controls.maxDistance * 1.5;
    scene.fog.far = controls.maxDistance * 4;

    $('cnt').textContent = state.byFma.size;
    if ($('noteCnt')) $('noteCnt').textContent = state.byFma.size;
    buildRegionUI();
    bindUI();
    animate();
    setTimeout(() => loaderEl.classList.add('hide'), 250);
  } catch (err) {
    console.error(err);
    loadTxt.textContent = '加载失败：' + err.message;
  }
}

/* ============ 区域面板 ============ */
/* 三级结构：区域行（点击切换显隐 / 点箭头展开清单）→ 专业分组（脑颅骨/腕骨/跗骨…）
   → 骨骼项（点击直接选中）。分组解决上肢/下肢几十块骨平铺难以定位的问题。 */
function buildRegionUI() {
  const byRegion = {};
  for (const fma of state.byFma.keys()) {
    const b = state.bones[fma] || { region: '其他', group: '其他' };
    (byRegion[b.region] = byRegion[b.region] || []).push({ fma, group: b.group || '其他' });
  }
  const wrap = $('regions');
  wrap.innerHTML = '';
  REGIONS.forEach(r => {
    state.regionVisible[r] = true;
    const items = byRegion[r] || [];
    // 组按首次出现顺序排列，组内保持数据原始顺序（符合解剖学计数习惯）
    const groups = [];
    for (const it of items) {
      let g = groups.find(x => x.name === it.group);
      if (!g) { g = { name: it.group, bones: [] }; groups.push(g); }
      g.bones.push(it.fma);
    }
    const d = document.createElement('div');
    d.className = 'reg';
    d.innerHTML = `<span class="dot"></span><span class="reg-name">${r}</span>` +
      `<span class="n">${items.length}</span><span class="chev">▸</span>`;
    d.onclick = () => {
      state.regionVisible[r] = !state.regionVisible[r];
      d.classList.toggle('off', !state.regionVisible[r]);
      applyVisibility();
    };
    d.querySelector('.chev').onclick = e => {
      e.stopPropagation();
      d.classList.toggle('open');
    };
    const listBox = document.createElement('div');
    listBox.className = 'reg-list';
    if (items.length > 30) {
      const filter = document.createElement('input');
      filter.className = 'reg-filter';
      filter.type = 'text';
      filter.placeholder = `筛选${r}骨骼…`;
      filter.onclick = e => e.stopPropagation();
      filter.oninput = () => {
        const q = filter.value.trim();
        listBox.classList.toggle('searching', !!q);   // 搜索时强制展开所有分组
        listBox.querySelectorAll('.bone-item').forEach(it => {
          it.style.display = !q || it.textContent.includes(q) ? '' : 'none';
        });
      };
      listBox.appendChild(filter);
    }
    groups.forEach(g => {
      // 分组标题可点击折叠，默认收起，避免一个区域展开后几十行平铺
      const sub = document.createElement('div');
      sub.className = 'reg-sub';
      sub.innerHTML = `<span class="chev">▸</span><span>${g.name}</span>` +
        `<span class="n">${g.bones.length}</span>`;
      const grp = document.createElement('div');
      grp.className = 'reg-group';
      g.bones.forEach(fma => {
        const b = state.bones[fma];
        const item = document.createElement('div');
        item.className = 'bone-item' + (state.hiddenSet.has(fma) ? ' hid' : '');
        item.dataset.fma = fma;
        item.innerHTML = (state.keySet.has(fma) ? '<span class="star">★</span>' : '') +
          `<span>${b?.cn || fma}</span>`;
        item.title = b?.en || fma;
        item.onclick = e => {
          e.stopPropagation();
          selectBone(fma);
        };
        item.ondblclick = e => {
          e.stopPropagation();
          enterIsolate(fma);
        };
        grp.appendChild(item);
      });
      sub.onclick = e => {
        e.stopPropagation();
        sub.classList.toggle('open');
      };
      listBox.appendChild(sub);
      listBox.appendChild(grp);
    });
    wrap.appendChild(d);
    wrap.appendChild(listBox);
  });
}

function applyVisibility() {
  state.meshes.forEach(({ mesh, fma }) => {
    const r = state.bones[fma]?.region || '其他';
    const regionOk = state.regionVisible[r] !== false;
    const markOk = !state.onlyKey || state.keySet.has(fma);
    const notHidden = !state.hiddenSet.has(fma);
    const isolateOk = !state.isolated || state.isolated === fma;
    mesh.visible = regionOk && markOk && notHidden && isolateOk;
  });
}

/* ============ UI 交互 ============ */
function bindUI() {
  $('btnLabel').onclick = e => {
    state.showLabel = !state.showLabel;
    e.currentTarget.classList.toggle('on', state.showLabel);
    if (state.selected) state.showLabel ? placeLabel(state.selected) : removeLabel();
  };
  $('btnXray').onclick = e => {
    state.xray = !state.xray;
    e.currentTarget.classList.toggle('on', state.xray);
    updateMaterials();
  };
  $('btnKey').onclick = e => {
    state.keyMode = !state.keyMode;
    e.currentTarget.classList.toggle('on', state.keyMode);
    if (!state.keyMode && state.onlyKey) {          // 关标记标红时连带退出"仅看标记"
      state.onlyKey = false;
      $('btnOnlyKey').classList.remove('on');
      applyVisibility();
    }
    updateMaterials();
  };
  $('btnOnlyKey').onclick = e => {
    state.onlyKey = !state.onlyKey;
    e.currentTarget.classList.toggle('on', state.onlyKey);
    if (state.onlyKey && !state.keyMode) {          // 仅看标记时自动带上标红更直观
      state.keyMode = true;
      $('btnKey').classList.add('on');
      updateMaterials();
    }
    applyVisibility();
  };
  $('moreBtn').onclick = () => toggleDetail();

  /* 用户动作行：标记 / 隐藏 / 单骨隔离 */
  $('actMark').onclick = () => { if (state.selected) toggleMark(state.selected); };
  $('actHide').onclick = () => { if (state.selected) toggleHideSelected(state.selected); };
  $('actIsolate').onclick = () => {
    if (!state.selected) return;
    state.isolated === state.selected ? exitIsolate() : enterIsolate(state.selected);
  };
  $('isolateBar').onclick = () => exitIsolate();
  addEventListener('keydown', e => { if (e.key === 'Escape' && state.isolated) exitIsolate(); });

  /* 每骨笔记 */
  $('noteSave').onclick = () => {
    if (!state.selected) return;
    const ok = store.setNote(state.selected, $('noteBox').value);
    $('noteSaved').textContent = ok ? '已保存 ✓' : '保存失败';
    setTimeout(() => { $('noteSaved').textContent = ''; }, 2000);
  };

  /* 恢复全部显示（清除会话内手动隐藏） */
  $('btnShowAll').onclick = () => restoreShow();

  /* 我的数据：导出 / 导入（JSON 备份，未来共享格式的雏形） */
  $('btnExport').onclick = () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'skeleton-mydata.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('btnImport').onclick = () => $('importFile').click();
  $('importFile').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const r = store.importJSON(reader.result);
        state.keySet = new Set(store.getMarked());
        updateMaterials();
        const rv = { ...state.regionVisible };
        buildRegionUI();                            // 重建清单刷新 ★/隐藏态
        Object.assign(state.regionVisible, rv);     // 保留区域显隐
        applyVisibility();
        if (state.selected) { refreshActionRow(state.selected); $('noteBox').value = store.getNote(state.selected); }
        $('importStat').textContent = `已导入：标记 ${r.marks} 条、笔记 ${r.notes} 条`;
      } catch (err) {
        $('importStat').textContent = '导入失败：' + err.message;
      }
      setTimeout(() => { $('importStat').textContent = ''; }, 4000);
    };
    reader.readAsText(f);
    e.target.value = '';
  };
  $('btnReset').onclick = () => resetView();
  $('btnSpin').onclick = e => {
    state.spin = !state.spin;
    controls.autoRotate = state.spin;
    e.currentTarget.classList.toggle('on', state.spin);
  };
  $('close').onclick = () => clearSelection();
  $('mobileBtn').onclick = () => $('tools').classList.toggle('open');

  /* 右侧垂直滑块：唯一控制视角上下移动的入口 */
  const vp = $('vpRange');
  const onSlide = () => applyPanY((+vp.value / 100) * state.panRange);
  vp.addEventListener('input', onSlide);
  vp.addEventListener('dblclick', () => { vp.value = 0; onSlide(); });

  /* 画布上屏蔽右键菜单，避免拖拽时弹出浏览器菜单 */
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const el = renderer.domElement;
  let downPos = null;
  el.addEventListener('pointerdown', e => { downPos = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', e => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    if (moved < 5) pick(e.clientX, e.clientY);
    downPos = null;
  });
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', () => { hoverEl.classList.remove('show'); highlightHover(null); });
}

/* ============ 射线拾取 ============ */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pick(clientX, clientY) {
  if (state.annSprites.length) {
    const hitsA = raycastList(state.annSprites.map(a => a.sprite), clientX, clientY);
    if (hitsA.length) {
      if (state.editMode) { selectAnnPoint(hitsA[0].object); return; }
      showAnnInfo(hitsA[0].object); return;
    }
  }
  const hits = raycast(clientX, clientY);
  if (state.editMode) {
    if (!hits.length || hits[0].object.userData.fma !== state.selected) { selectAnnPoint(null); return; }
    if (state.annSel) moveAnnSelTo(hits[0]);
    else createAnnAt(hits[0]);
    return;
  }
  if (!hits.length) { clearSelection(); return; }
  const fma = hits[0].object.userData.fma;
  selectBone(fma);
}

function raycastList(list, clientX, clientY) {
  ndc.x = (clientX / innerWidth) * 2 - 1;
  ndc.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects(list, false);
}
function raycast(clientX, clientY) {
  const targets = state.meshes.filter(m => m.mesh.visible).map(m => m.mesh);
  return raycastList(targets, clientX, clientY);
}

function onMove(e) {
  if (state.annSprites.length) {
    const hitsA = raycastList(state.annSprites.map(a => a.sprite), e.clientX, e.clientY);
    if (hitsA.length) {
      highlightHover(null);
      renderer.domElement.style.cursor = 'pointer';
      hoverEl.textContent = hitsA[0].object.userData.ann.name;
      hoverEl.style.left = (e.clientX + 14) + 'px';
      hoverEl.style.top = (e.clientY + 14) + 'px';
      hoverEl.classList.add('show');
      return;
    }
  }
  const hits = raycast(e.clientX, e.clientY);
  if (!hits.length) {
    hoverEl.classList.remove('show'); highlightHover(null);
    renderer.domElement.style.cursor = 'grab';
    return;
  }
  const fma = hits[0].object.userData.fma;
  const b = state.bones[fma];
  highlightHover(fma);
  renderer.domElement.style.cursor = 'pointer';
  hoverEl.textContent = b ? b.cn : fma;
  hoverEl.style.left = (e.clientX + 14) + 'px';
  hoverEl.style.top = (e.clientY + 14) + 'px';
  hoverEl.classList.add('show');
}

/* ============ 高亮 / 选中 ============ */
function setMeshColor(mesh, color) {
  mesh.material.color.copy(color);
}

const isKey = fma => state.keySet.has(fma);

/* 一块骨在「当前状态下」应该是什么底色。
   三种持久态叠加：重点标红 > X 光冷青 > 普通米黄（选中/悬停色在调用处另行覆盖） */
function baseFor(fma) {
  if (state.keyMode && isKey(fma)) return KEY_COLOR;
  return state.xray ? XRAY_TINT : BASE_COLOR;
}

/* 自发光也跟着状态走，避免 X 光模式下选中态被覆盖 */
function refreshEmissive(mesh, fma) {
  if (fma === state.selected) mesh.material.emissive.copy(SEL_EMISSIVE);
  else if (state.xray) mesh.material.emissive.copy(XRAY_EMISSIVE);
  else mesh.material.emissive.copy(NO_EMISSIVE);
}

/* X 光透明度按骨区分：选中的骨保持不透明，
   这样从列表点选被包住的骨头（如筛骨）开 X 光后能直接看清目标 */
function applyXrayToMesh(mesh, fma) {
  const dim = state.xray && fma !== state.selected;
  // transparent 标志变化会改变着色器编译产物，必须置 needsUpdate，否则透明不生效
  const needRecompile = mesh.material.transparent !== !!dim;
  mesh.material.transparent = !!dim;
  mesh.material.opacity = dim ? XRAY_OPACITY : 1;
  mesh.material.depthWrite = !dim;
  if (needRecompile) mesh.material.needsUpdate = true;
}

function highlightHover(fma) {
  if (state.hovered && state.hovered !== state.selected) {
    state.byFma.get(state.hovered)?.forEach(m => setMeshColor(m, baseFor(state.hovered)));
  }
  state.hovered = fma;
  if (fma && fma !== state.selected) {
    state.byFma.get(fma)?.forEach(m => setMeshColor(m, HOV_COLOR));
  }
}

function selectBone(fma) {
  clearSelection(false);
  state.selected = fma;
  const b = state.bones[fma];
  if (b) {
    $('tag').textContent = b.region;
    $('cn').textContent = (isKey(fma) ? '★ ' : '') + b.cn;
    $('latin').textContent = b.latin;
    $('enName').textContent = b.en ? b.en.replace(/\b\w/g, c => c.toUpperCase()) : '';
    $('enName').style.display = b.en ? '' : 'none';
    $('desc').textContent = b.desc;
    $('fma').textContent = 'FMA ' + fma.replace('FMA', '');
  buildAnnSprites(fma);
  } else {
    $('cn').textContent = fma;
    $('latin').textContent = ''; $('enName').textContent = '';
    $('desc').textContent = '(无描述)';
  }
  resetDetail();
  refreshActionRow(fma);
  $('noteBox').value = store.getNote(fma);
  $('noteSaved').textContent = '';
  updateMaterials();   // 统一刷新：覆盖 X 光下选中骨不透明、标记标红底色等
  infoEl.classList.add('show');
  placeLabel(fma);
}

/* ============ 用户动作：标记 / 隐藏 / 隔离 ============ */
/* 标记：写入 store（localStorage 持久化），标红/★/仅看标记全部读用户标记集 */
function toggleMark(fma) {
  const marked = store.toggleMark(fma);
  state.keySet = new Set(store.getMarked());
  updateMaterials();
  syncListItem(fma);
  if (state.onlyKey) applyVisibility();
  if (state.selected === fma) {
    $('cn').textContent = (marked ? '★ ' : '') + (state.bones[fma]?.cn || fma);
    refreshActionRow(fma);
  }
}

function syncListItem(fma) {
  const el = document.querySelector(`.bone-item[data-fma="${fma}"]`);
  if (!el) return;
  el.classList.toggle('hid', state.hiddenSet.has(fma));
  const star = el.querySelector('.star');
  if (state.keySet.has(fma) && !star) {
    const s = document.createElement('span');
    s.className = 'star'; s.textContent = '★';
    el.prepend(s);
  } else if (!state.keySet.has(fma) && star) {
    star.remove();
  }
}

function refreshActionRow(fma) {
  if (!fma) return;
  const marked = store.isMarked(fma);
  $('actMark').classList.toggle('on', marked);
  $('actMark').querySelector('.act-txt').textContent = marked ? '已标记' : '标记';
  const hidden = state.hiddenSet.has(fma);
  $('actHide').querySelector('.act-txt').textContent = hidden ? '取消隐藏' : '隐藏';
  const iso = state.isolated === fma;
  $('actIsolate').querySelector('.act-txt').textContent = iso ? '退出隔离' : '单独查看';
}

/* 隐藏：会话级视图状态。被隐藏的骨仍可在清单中点选（选后可取消隐藏） */
function toggleHideSelected(fma) {
  if (state.hiddenSet.has(fma)) state.hiddenSet.delete(fma);
  else {
    state.hiddenSet.add(fma);
    if (state.isolated === fma) exitIsolate();
  }
  applyVisibility();
  syncListItem(fma);
  refreshActionRow(fma);
}

function restoreShow() {
  state.hiddenSet.clear();
  applyVisibility();
  document.querySelectorAll('.bone-item.hid').forEach(el => el.classList.remove('hid'));
  if (state.selected) refreshActionRow(state.selected);
}

/* 隔离：只显示这一块骨，相机对准它；退出后恢复 */
function enterIsolate(fma) {
  state.isolated = fma;
  applyVisibility();
  const list = state.byFma.get(fma);
  if (list && list.length) {
    const box = new THREE.Box3();
    list.forEach(m => box.expandByObject(m));
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.02);
    controls.target.copy(c);
    const dir = camera.position.clone().sub(c);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.setLength(Math.max(r * 3.2 + 0.01, 0.016));   // 小骨（听小骨级）也能取得近景特写
    camera.position.copy(c).add(dir);
    controls.update();
  }
  $('isolateBar').textContent = `⤢ 隔离查看：${state.bones[fma]?.cn || fma} —— 点击此处退出`;
  $('isolateBar').classList.add('show');
  if (state.selected === fma) refreshActionRow(fma);
}

function exitIsolate() {
  if (!state.isolated) return;
  state.isolated = null;
  applyVisibility();
  $('isolateBar').classList.remove('show');
  if (state.selected) refreshActionRow(state.selected);
  resetView();
}

function clearSelection(alsoHidePanel = true) {
  state.selected = null;
  clearAnnSprites();
  updateMaterials();   // 统一还原全部骨骼的底色/透明度/自发光
  if (alsoHidePanel) {
    infoEl.classList.remove('show');
    removeLabel();
  }
}

/* ============ 3D 骨骼名称标签（跟随选中的骨） ============
   标签不再压在骨头上：锚点为骨的中心，每帧把标签推到屏幕左右
   空白侧，并用一根蓝色细线把骨和标签连起来（类似专业解剖软件）。 */
let labelSprite = null;
let labelLine = null;
let labelAnchor = null;   // 骨中心（世界坐标）
let labelRadius = 0;      // 骨包围球半径（决定标签推开的距离）

function removeLabel() {
  if (labelSprite) {
    scene.remove(labelSprite);
    labelSprite.material.map?.dispose();
    labelSprite.material.dispose();
    labelSprite.geometry.dispose();
    labelSprite = null;
  }
  if (labelLine) {
    scene.remove(labelLine);
    labelLine.geometry.dispose();
    labelLine.material.dispose();
    labelLine = null;
  }
  labelAnchor = null;
}

/* 标签药丸的屏幕尺寸（CSS 像素）——缩放页面/推拉相机都不改变屏幕大小 */
const PILL_FS = 18, PILL_PAD_X = 12, PILL_PAD_Y = 6;

function makeLabel(text) {
  // 注意：这里不再调用 removeLabel()——旧标签的清理由 placeLabel 开头统一负责，
  // 否则会把 placeLabel 刚算好的 labelAnchor 清空导致空引用
  // 画布按设备像素比绘制（至少 3x），高 DPR 手机上文字才不会发虚
  const dpr = Math.min(3, Math.max(2, devicePixelRatio || 1));
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = `600 ${PILL_FS}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + PILL_PAD_X * 2;
  const h = PILL_FS + PILL_PAD_Y * 2;
  cv.width = w * dpr; cv.height = h * dpr;
  ctx.scale(dpr, dpr);
  // 圆角背景
  const r = h / 2;
  ctx.fillStyle = 'rgba(255,77,79,0.92)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, r); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(0.75, 0.75, w - 1.5, h - 1.5, r); ctx.stroke();
  // 文字
  ctx.font = font; ctx.fillStyle = '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 1);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.renderOrder = 999;
  sp.userData.cssW = w;   // 药丸屏幕尺寸（CSS px），每帧据此换算世界尺寸
  sp.userData.cssH = h;
  return sp;
}

/* ============ 结构标注 ============ */
const ANN_PART_VERTS = { manubrium: 1425, body: 2634, xiphoid: 495 };   // 胸骨三部件按顶点数识别
let annTex = null;
function annTexture() {
  if (annTex) return annTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2);
  g.fillStyle = '#ffb14d'; g.fill();
  g.lineWidth = 5; g.strokeStyle = 'rgba(45,32,10,.85)'; g.stroke();
  annTex = new THREE.CanvasTexture(c);
  return annTex;
}
function annPairOf(fma) {   // 成对骨 右↔左 FMA 映射（cn 配对，与管线同规则）
  if (!state.annPair) {
    state.annPair = {};
    const byBase = {};
    for (const [k, b] of Object.entries(state.bones)) {
      if (!/[（(][左右][)）]/.test(b.cn) && !/^[左右]/.test(b.cn)) continue;
      const base = b.cn.replace(/（[左右]）/g, '').replace(/^[左右]/, '');
      (byBase[base] = byBase[base] || []).push(k);
    }
    for (const g of Object.values(byBase)) {
      if (g.length !== 2) continue;
      const l = g.find(f => state.bones[f].cn.includes('左'));
      const r = g.find(f => !state.bones[f].cn.includes('左'));
      state.annPair[r] = l; state.annPair[l] = r;
    }
  }
  return state.annPair[fma] || null;
}
function annSnap(mesh, p) {   // 吸附到该网格最近顶点，保证标注点贴在骨面上
  const pos = mesh.geometry.attributes.position;
  let best = Infinity, out = p;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - p[0], dy = pos.getY(i) - p[1], dz = pos.getZ(i) - p[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < best) { best = d; out = [pos.getX(i), pos.getY(i), pos.getZ(i)]; }
  }
  return out;
}
function clearAnnSprites() {
  for (const a of state.annSprites) {
    a.sprite.parent.remove(a.sprite);
    a.sprite.material.dispose();
  }
  state.annSprites = [];
}
function buildAnnSprites(fma) {
  clearAnnSprites();
  if (state.editMode) { buildAnnSpritesEdit(fma); return; }
  const entries = (state.ann && (state.ann[fma] || state.ann[annPairOf(fma)])) || [];
  const meshes = state.byFma.get(fma) || [];
  for (const e of entries) {
    let targets = meshes;
    if (e.part && ANN_PART_VERTS[e.part]) {
      const hit = meshes.filter(m => m.geometry.attributes.position.count === ANN_PART_VERTS[e.part]);
      if (hit.length) targets = hit;
    }
    // 两种坐标来源：pts 为精确局部坐标；rel 为包围盒归一化坐标（展开后吸附）
    const variants = e.pts
      ? e.pts.map((p, i) => [{ pts: p }, e.pts.length > 1 ? (i === 0 ? '（右）' : '（左）') : ''])
      : (e.side ? [[e.rel, '（右）'], [[1 - e.rel[0], e.rel[1], e.rel[2]], '（左）']] : [[e.rel, '']]);
    for (const [rv, suffix] of variants) {
      for (const mesh of targets) {
        const geo = mesh.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const p = rv.pts ? rv.pts.slice() : [
          bb.min.x + (bb.max.x - bb.min.x) * rv[0],
          bb.min.y + (bb.max.y - bb.min.y) * rv[1],
          bb.min.z + (bb.max.z - bb.min.z) * rv[2],
        ];
        const sp = rv.pts ? rv.pts.slice() : annSnap(mesh, p);
        const mat = new THREE.SpriteMaterial({ map: annTexture(), transparent: true, depthTest: false, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(sp[0], sp[1], sp[2]);
        sprite.renderOrder = 990;
        sprite.userData.ann = { entry: e, name: e.name + suffix };
        mesh.add(sprite);
        state.annSprites.push({ sprite, entry: e, name: sprite.userData.ann.name, mesh });
      }
    }
  }
  renderAnnList(entries);
}
/* ---- 编辑模式 ---- */
function annEditFor(fma) {   // 把 base 条目懒转换为 pts 格式的工作副本
  if (!state.annEdit) state.annEdit = {};
  if (state.annEdit[fma]) return state.annEdit[fma];
  const srcEntries = state.ann[fma] || state.ann[annPairOf(fma)] || [];
  const meshes = state.byFma.get(fma) || [];
  const out = [];
  let n = 0;
  for (const e of srcEntries) {
    let targets = meshes;
    if (e.part && ANN_PART_VERTS[e.part]) {
      const hit = meshes.filter(m => m.geometry.attributes.position.count === ANN_PART_VERTS[e.part]);
      if (hit.length) targets = hit;
    }
    // 两种坐标来源：pts 为精确局部坐标；rel 为包围盒归一化坐标（展开后吸附）
    const variants = e.pts
      ? e.pts.map((p, i) => [{ pts: p }, e.pts.length > 1 ? (i === 0 ? '（右）' : '（左）') : ''])
      : (e.side ? [[e.rel, '（右）'], [[1 - e.rel[0], e.rel[1], e.rel[2]], '（左）']] : [[e.rel, '']]);
    for (const [rv, suffix] of variants) {
      for (const mesh of targets) {
        const geo = mesh.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const p = rv.pts ? rv.pts.slice() : [
          bb.min.x + (bb.max.x - bb.min.x) * rv[0],
          bb.min.y + (bb.max.y - bb.min.y) * rv[1],
          bb.min.z + (bb.max.z - bb.min.z) * rv[2],
        ];
        const sp = rv.pts ? rv.pts.slice() : annSnap(mesh, p);
        out.push({ id: e.id + '-' + (n++), name: e.name + suffix, en: e.en || '', desc: e.desc || '', detail: e.detail || '', pts: [sp] });
        break;
      }
    }
  }
  state.annEdit[fma] = out;
  return out;
}
function buildAnnSpritesEdit(fma) {
  const entries = annEditFor(fma);
  const meshes = state.byFma.get(fma) || [];
  for (const e of entries) {
    let targets = meshes;
    if (e.part && ANN_PART_VERTS[e.part]) {
      const hit = meshes.filter(m => m.geometry.attributes.position.count === ANN_PART_VERTS[e.part]);
      if (hit.length) targets = hit;
    }
    for (let pi = 0; pi < e.pts.length; pi++) {
      for (const mesh of targets) {
        const mat = new THREE.SpriteMaterial({ map: annTexture(), transparent: true, depthTest: false, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(e.pts[pi][0], e.pts[pi][1], e.pts[pi][2]);
        sprite.renderOrder = 990;
        const suffix = e.pts.length > 1 ? ' ' + (pi + 1) : '';
        sprite.userData.ann = { entry: e, name: e.name + suffix, ptIndex: pi };
        mesh.add(sprite);
        state.annSprites.push({ sprite, entry: e, name: sprite.userData.ann.name, mesh, fma });
      }
    }
  }
  renderAnnList(entries);
  refreshAnnEditForm();
}
function selectAnnPoint(sprite) {
  state.annSel = sprite ? {
    fma: sprite.userData.fma || state.selected,
    entry: sprite.userData.ann.entry,
    ptIndex: sprite.userData.ann.ptIndex ?? 0,
    sprite, mesh: sprite.parent,
  } : null;
  for (const a of state.annSprites) a.sprite.material.color.set(0xffffff);
  if (state.annSel) state.annSel.sprite.material.color.set(0xff4a2e);
  refreshAnnEditForm();
}
function moveAnnSelTo(hit) {
  if (!state.annSel) return;
  const mesh = hit.object;
  const local = mesh.worldToLocal(hit.point.clone());
  const sp = annSnap(mesh, [local.x, local.y, local.z]);
  state.annSel.entry.pts[state.annSel.ptIndex] = sp;
  // 跨部件移动时重新挂载父级
  if (state.annSel.sprite.parent !== mesh) {
    state.annSel.sprite.parent.remove(state.annSel.sprite);
    mesh.add(state.annSel.sprite);
    state.annSel.mesh = mesh;
  }
  state.annSel.sprite.position.set(sp[0], sp[1], sp[2]);
}
function createAnnAt(hit) {
  const fma = hit.object.userData.fma;
  if (!fma) return;
  const entries = annEditFor(fma);
  const mesh = hit.object;
  const local = mesh.worldToLocal(hit.point.clone());
  const sp = annSnap(mesh, [local.x, local.y, local.z]);
  const entry = { id: 'ann-' + Date.now(), name: '新标注', en: '', desc: '', detail: '', pts: [sp] };
  entries.push(entry);
  buildAnnSprites(state.selected);
  const a = state.annSprites.find(x => x.entry === entry);
  selectAnnPoint(a ? a.sprite : null);
}
function deleteAnnSel() {
  if (!state.annSel) return;
  const { fma, entry, ptIndex } = state.annSel;
  entry.pts.splice(ptIndex, 1);
  if (!entry.pts.length) {
    const arr = (state.annEdit[fma] || []).filter(e => e !== entry);
    state.annEdit[fma] = arr;
  }
  state.annSel = null;
  buildAnnSprites(state.selected);
  refreshAnnEditForm();
}
function refreshAnnEditForm() {
  const sec = document.getElementById('annEditSec');
  if (!sec) return;
  if (!state.editMode || !state.annSel) { sec.hidden = true; return; }
  sec.hidden = false;
  const { entry } = state.annSel;
  const nm = document.getElementById('annName'), en = document.getElementById('annEn'),
        de = document.getElementById('annDesc'), dt = document.getElementById('annDetail');
  if (document.activeElement !== nm) nm.value = entry.name;
  if (document.activeElement !== en) en.value = entry.en || '';
  if (document.activeElement !== de) de.value = entry.desc || '';
  if (document.activeElement !== dt) dt.value = entry.detail || '';
}
function exportAnnotations() {
  if (!state.annEdit) { loadTip('没有修改可导出'); return; }
  const merged = {};
  for (const [fma, entries] of Object.entries(state.ann)) merged[fma] = entries;
  for (const [fma, entries] of Object.entries(state.annEdit)) merged[fma] = entries;
  delete merged._说明;
  const blob = new Blob([JSON.stringify(merged, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'annotations.json';
  a.click();
}

function renderAnnList(entries) {
  const sec = $('annSec'), list = $('annList');
  if (!sec) return;
  if (!entries.length) { sec.hidden = true; list.innerHTML = ''; return; }
  sec.hidden = false;
  list.innerHTML = '';
  for (const e of entries) {
    const chip = document.createElement('span');
    chip.className = 'ann-chip';
    chip.textContent = e.name;
    chip.onclick = () => showAnnDesc(e);
    list.appendChild(chip);
  }
}
function showAnnDesc(entry) {
  const list = $('annList');
  if (!list) return;
  const old = list.querySelector('.ann-desc');
  const isOpen = old && old.dataset.id === entry.id;
  if (old) old.remove();
  list.querySelectorAll('.ann-chip').forEach(c => c.classList.remove('on'));
  if (isOpen) {
    for (const a of state.annSprites) a.sprite.material.color.set(0xffffff);
    return;
  }
  const dd = document.createElement('div');
  dd.className = 'ann-desc';
  dd.dataset.id = entry.id;
  dd.textContent = entry.desc;
  if (entry.detail) {
    const dt = document.createElement('div');
    dt.className = 'ann-detail';
    dt.textContent = entry.detail;
    dd.appendChild(dt);
  }
  list.appendChild(dd);
  list.querySelectorAll('.ann-chip').forEach(c => { if (c.textContent === entry.name) c.classList.add('on'); });
  for (const a of state.annSprites) a.sprite.material.color.set(a.entry === entry ? 0xff4a2e : 0xffffff);
}
function showAnnInfo(sprite) {
  const a = state.annSprites.find(x => x.sprite === sprite);
  if (!a) return;
  showAnnDesc(a.entry);
  // 相机不看走：仅高亮点位（面板中显示描述）
}

function placeLabel(fma) {
  removeLabel();                       // 先清旧标签（注意：会同时清掉 labelAnchor）
  if (!state.showLabel) return;
  const list = state.byFma.get(fma);
  if (!list || !list.length) return;
  const b = state.bones[fma];
  if (!b) return;
  const box = new THREE.Box3();
  list.forEach(m => box.expandByObject(m));
  labelAnchor = box.getCenter(new THREE.Vector3());
  labelRadius = box.getBoundingSphere(new THREE.Sphere()).radius || 0.01;
  labelSprite = makeLabel(b.cn);
  scene.add(labelSprite);
  // 蓝色细牵引线：骨中心 → 标签（线宽在多数平台固定为 1px，正合适）
  const geo = new THREE.BufferGeometry().setFromPoints([labelAnchor.clone(), labelAnchor.clone()]);
  labelLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0x4da3ff, transparent: true, opacity: 0.85, depthTest: false,
  }));
  labelLine.renderOrder = 998;
  scene.add(labelLine);
  updateLabelPose();
}

/* 每帧根据当前相机重算标签位姿。
   药丸保持恒定屏幕像素尺寸（不随缩放变化），位置全部在像素域规划：
   ① 先放在骨的屏幕左/右侧；② 与骨的屏幕轮廓重叠时上下错开（优先下移）；
   ③ 夹进屏幕边界；④ 避开信息面板（先换边，再上下避让）。
   最后把像素坐标反投影回世界坐标，牵引线连到药丸近侧边缘。 */
function updateLabelPose() {
  if (!labelSprite || !labelAnchor) return;
  const anchorCam = labelAnchor.clone().applyMatrix4(camera.matrixWorldInverse);
  if (anchorCam.z >= -0.01) {            // 锚点在相机背后或过近，整体隐藏
    labelSprite.visible = false;
    labelLine.visible = false;
    return;
  }
  labelSprite.visible = true;
  labelLine.visible = true;

  const dist = -anchorCam.z;
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
  const halfW = halfH * camera.aspect;
  const pxPerWorld = innerHeight / (2 * halfH);
  const pw = labelSprite.userData.cssW;
  const ph = labelSprite.userData.cssH;

  // 骨中心的屏幕坐标与屏幕半径
  const ndc = labelAnchor.clone().project(camera);
  const ax = (ndc.x * 0.5 + 0.5) * innerWidth;
  const ay = (-ndc.y * 0.5 + 0.5) * innerHeight;
  const boneRpx = Math.max(labelRadius * pxPerWorld, 6);

  const clampX = v => Math.min(innerWidth - pw / 2 - 8, Math.max(pw / 2 + 8, v));
  const clampY = v => Math.min(innerHeight - ph / 2 - 8, Math.max(ph / 2 + 8, v));
  // 与骨屏幕轮廓重叠 → 纵向错开（空间够就下移，否则上移）
  const staggerY = () => {
    const down = ay + boneRpx + ph / 2 + 10;
    const up = ay - boneRpx - ph / 2 - 10;
    sy = (down <= innerHeight - ph / 2 - 8) ? down
      : (up >= ph / 2 + 8) ? up
      : clampY(down);
  };

  let side = ax >= innerWidth / 2 ? 1 : -1;
  let sx = clampX(ax + side * (boneRpx + pw / 2 + 12));
  let sy = clampY(ay);
  if (Math.abs(sx - ax) < boneRpx + pw / 2 && Math.abs(sy - ay) < boneRpx + ph / 2) staggerY();

  /* 避开信息面板：桌面在右侧、手机是底部抽屉。若标签与面板相交，
     先换到另一侧（换边后需重新做骨避让），仍相交则挪到面板上/下缘之外 */
  const infoEl = document.getElementById('info');
  if (infoEl && infoEl.classList.contains('show')) {
    const r = infoEl.getBoundingClientRect();
    const hitP = () => Math.abs(sx - (r.left + r.width / 2)) < pw / 2 + r.width / 2 + 6 &&
                       Math.abs(sy - (r.top + r.height / 2)) < ph / 2 + r.height / 2 + 6;
    if (hitP() && side === 1) {
      side = -1;
      sx = clampX(ax + side * (boneRpx + pw / 2 + 12));
      if (Math.abs(sx - ax) < boneRpx + pw / 2 && Math.abs(sy - ay) < boneRpx + ph / 2) staggerY();
    }
    if (hitP()) {
      const above = r.top - ph / 2 - 8;
      const below = r.bottom + ph / 2 + 8;
      sy = Math.abs(sy - above) <= Math.abs(below - sy)
        ? clampY(above) : clampY(below);
    }
  }

  // 像素坐标 → 相机空间 → 世界坐标（ndc.y 与屏幕 y 方向相反，注意公式）
  const labelPos = new THREE.Vector3(
    (sx / innerWidth * 2 - 1) * halfW,
    (1 - 2 * sy / innerHeight) * halfH,
    anchorCam.z
  ).applyMatrix4(camera.matrixWorld);
  labelSprite.position.copy(labelPos);
  // 恒定屏幕尺寸：世界尺寸 = CSS 像素 ÷ 每世界单位对应的像素数
  labelSprite.scale.set(pw / pxPerWorld, ph / pxPerWorld, 1);

  // 牵引线：骨中心 → 药丸近侧边缘中点
  const ex = sx - side * pw / 2;
  const lineEnd = new THREE.Vector3(
    (ex / innerWidth * 2 - 1) * halfW,
    (1 - 2 * sy / innerHeight) * halfH,
    anchorCam.z
  ).applyMatrix4(camera.matrixWorld);
  const posAttr = labelLine.geometry.attributes.position;
  posAttr.setXYZ(0, labelAnchor.x, labelAnchor.y, labelAnchor.z);
  posAttr.setXYZ(1, lineEnd.x, lineEnd.y, lineEnd.z);
  posAttr.needsUpdate = true;
}

function updateMaterials() {
  state.meshes.forEach(({ mesh, fma }) => {
    applyXrayToMesh(mesh, fma);
    // 选中色优先级最高（画布点击时新选中的骨往往正处于悬停态，不能被悬停跳过），
    // 其次悬停蓝，其余跟随当前模式（含重点标红）
    if (fma === state.selected) setMeshColor(mesh, SEL_COLOR);
    else setMeshColor(mesh, fma === state.hovered ? HOV_COLOR : baseFor(fma));
    refreshEmissive(mesh, fma);
  });
}

/* ============ 完整介绍（懒加载 + 展开） ============ */
function loadDetails() {
  if (!state.detailCache) {
    state.detailCache = fetch('./data/bones-detail.json', { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  return state.detailCache;
}

function resetDetail() {
  const box = $('detail');
  box.classList.remove('open');
  $('moreBtn').classList.remove('open');
  $('moreBtn').textContent = '查看完整介绍 ▸';
}

async function toggleDetail() {
  const box = $('detail');
  const btn = $('moreBtn');
  if (box.classList.contains('open')) {          // 已展开 → 收起
    box.classList.remove('open');
    btn.classList.remove('open');
    btn.textContent = '查看完整介绍 ▸';
    return;
  }
  const fma = state.selected;
  if (!fma) return;
  btn.textContent = '正在加载…';
  try {
    const details = await loadDetails();
    if (state.selected !== fma) return;          // 等待期间用户已切换选中骨
    const d = details[fma];
    if (d) {
      $('dFn').textContent = d.function || '（暂无）';
      $('dPts').innerHTML = '';
      (d.points || []).forEach(p => {
        const li = document.createElement('li');
        li.textContent = p;
        $('dPts').appendChild(li);
      });
      $('dCli').textContent = d.clinical || '（暂无）';
      box.classList.add('open');
      btn.classList.add('open');
      btn.textContent = '收起完整介绍 ▾';
    } else {
      btn.textContent = '暂无该骨骼的完整介绍';
    }
  } catch (e) {
    if (state.selected !== fma) return;
    btn.textContent = '详情加载失败，请检查网络后重试';
  }
}

/* 垂直平移：相机与注视点同步上下移动，视线方向保持不变。
   只改 y，x / z 不动 —— 水平方向始终锁死。 */
function applyPanY(v) {
  const delta = v - state.panY;
  if (!delta) return;
  camera.position.y += delta;
  controls.target.y += delta;
  state.panY = v;
  controls.update();
}

function resetView() {
  if (!state.homeDist) return;
  const vp = $('vpRange');
  if (vp) vp.value = 0;
  applyPanY(0);                       // 垂直偏移归零，滑块回中
  controls.target.set(0, 0, 0);
  camera.position.set(0, 0, state.homeDist);  // 视距一并回到默认值
  controls.update();
}

/* ============ 渲染循环 ============ */
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  updateLabelPose();
  // 标注点保持恒定屏幕大小 + 遮挡检测（每 6 帧一次：被骨面挡住时变半透明）
  const tmpV = new THREE.Vector3();
  const occFrame = (frameCount++ % 6 === 0);
  for (const a of state.annSprites) {
    a.sprite.getWorldPosition(tmpV);
    const s = camera.position.distanceTo(tmpV) * 0.022;
    a.sprite.scale.set(s, s, 1);
    if (occFrame) {
      const dir = tmpV.clone().sub(camera.position);
      const dist = dir.length();
      dir.normalize();
      raycaster.set(camera.position, dir);
      raycaster.far = dist - s * 0.4;
      const hit = raycaster.intersectObject(a.mesh, false);
      raycaster.far = Infinity;
      a.sprite.material.opacity = hit.length ? 0.22 : 1.0;
    }
  }
  renderer.render(scene, camera);
}

boot();

/* 编辑模式表单绑定 */
(function annFormBind() {
  const map = { annName: 'name', annEn: 'en', annDesc: 'desc', annDetail: 'detail' };
  for (const [id, field] of Object.entries(map)) {
    document.getElementById(id).addEventListener('input', e => {
      if (!state.annSel) return;
      state.annSel.entry[field] = e.target.value;
      if (field === 'name') {
        for (const a of state.annSprites) if (a.entry === state.annSel.entry) a.name = e.target.value;
        renderAnnList(state.annEdit[state.annSel.fma] || []);
      }
    });
  }
  document.getElementById('annDel').onclick = deleteAnnSel;
})();

/* 调试出口：控制台可直接查运行时状态（不影响功能） */
window.__skel = { state, camera, scene, controls, THREE };
