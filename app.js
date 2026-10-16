import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ============ 全局状态 ============ */
const state = {
  bones: null,          // FMA -> {cn, latin, desc, region, en}
  meshes: [],           // {mesh, fma}
  byFma: new Map(),     // FMA -> [mesh]
  selected: null,
  hovered: null,
  regionVisible: {},    // 区域 -> bool
  showLabel: true,
  xray: false,
  spin: false,
  panY: 0,              // 当前垂直偏移（世界单位），只由右侧滑块驱动
  homeDist: 0,          // 默认视距，重置视角时回到这里
  panRange: 1,          // 滑块满行程对应的世界单位
};
const REGIONS = ['颅骨', '脊柱', '胸廓', '上肢', '下肢'];
const REGION_COLOR = {
  '颅骨': 0xdfe6f0, '脊柱': 0xc8d4e6, '胸廓': 0xd2dae8,
  '上肢': 0xcfd8e6, '下肢': 0xd6dfec, '其他': 0xcccccc,
};

/* 骨骼外观：干骨的象牙米黄，而不是纯白或灰蓝 */
const BASE_COLOR = new THREE.Color(0xe8ddc3);
const SEL_COLOR  = new THREE.Color(0xff4d4f);
const HOV_COLOR  = new THREE.Color(0x4da3ff);
const XRAY_OPACITY = 0.34;   // X 光模式透明度（统一常量）
const XRAY_TINT  = new THREE.Color(0x9fd8e8);  // X 光下的冷青色
const SEL_EMISSIVE = new THREE.Color(0x551010);
const XRAY_EMISSIVE = new THREE.Color(0x16404d);
const NO_EMISSIVE  = new THREE.Color(0x000000);

/* 所有骨共用同一套 PBR 参数（干骨质感：哑光、微糙、几乎无金属感） */
const BONE_MAT = {
  roughness: 0.62,
  metalness: 0.0,
  clearcoat: 0.10,          // 只留极淡的一层油润，多了会变成陶瓷
  clearcoatRoughness: 0.5,
  sheen: 0.28,              // 边缘细微绒感，避免塑料感
  sheenRoughness: 0.78,
  envMapIntensity: 1.15,
  flatShading: false,
};

/* ============ 场景 ============ */
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
/* 雾只在远得多的距离才起作用，避免把模型染成背景色「吞掉」（见 boot 里的二次校准） */
scene.fog = new THREE.Fog(0x0b0e14, 12, 40);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 0.05, 1.9);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
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
/* 有了环境贴图之后，平行光只负责「方向感」和轮廓，不再承担全部照明 */
scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x2a2418, 0.45));
const key = new THREE.DirectionalLight(0xfff6e8, 2.1); key.position.set(3, 5, 4); scene.add(key);
const fill = new THREE.DirectionalLight(0xa8c6ff, 0.75); fill.position.set(-4, 1, -3); scene.add(fill);
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
  panel(0xfff2df, 1.5, [0, 0.6, 7], [0, 0, 0]);                // 正面柔光
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

    const bones = await fetch('./data/bones.json').then(r => {
      if (!r.ok) throw new Error('bones.json 加载失败 HTTP ' + r.status);
      return r.json();
    });
    state.bones = bones;

    const gltf = await new Promise((res, rej) => {
      // 正确的回调顺序: load(url, onLoad, onProgress, onError)
      new GLTFLoader().load('./models/skeleton.glb', res,
        p => {
          if (p.total) {
            const pct = (p.loaded / p.total * 100).toFixed(0);
            barEl.style.width = pct + '%';
            loadTxt.textContent = `正在加载骨骼模型… ${pct}%`;
          }
        },
        err => rej(new Error('模型加载失败: ' + (err.message || err.type || '未知错误'))));
    });

    setupEnvironment();

    // 模型：每个节点名 = FMA ID
    const model = gltf.scene;
    model.traverse(o => {
      if (o.isMesh) {
        // 源 glb 只有顶点坐标、没有法线，不补的话任何光照都算不出明暗 → 渲染成全黑
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
        if (!o.geometry.attributes.uv) {
          // 部分贴图通道需要 uv，缺失时补一组占位，避免 Three.js 告警
          const count = o.geometry.attributes.position.count;
          o.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
        }
        const fma = o.name || o.parent?.name || '';
        o.userData.fma = fma;
        o.material = new THREE.MeshPhysicalMaterial(Object.assign({ color: BASE_COLOR.clone() }, BONE_MAT));
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
    controls.minDistance = maxDim * 0.35;
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
function buildRegionUI() {
  const counts = {};
  for (const fma of state.byFma.keys()) {
    const r = state.bones[fma]?.region || '其他';
    counts[r] = (counts[r] || 0) + 1;
  }
  const wrap = $('regions');
  wrap.innerHTML = '';
  REGIONS.forEach(r => {
    state.regionVisible[r] = true;
    const n = counts[r] || 0;
    const d = document.createElement('div');
    d.className = 'reg';
    d.innerHTML = `<span class="dot"></span><span>${r}</span><span class="n">${n}</span>`;
    d.onclick = () => {
      state.regionVisible[r] = !state.regionVisible[r];
      d.classList.toggle('off', !state.regionVisible[r]);
      applyVisibility();
    };
    wrap.appendChild(d);
  });
}

function applyVisibility() {
  state.meshes.forEach(({ mesh, fma }) => {
    const r = state.bones[fma]?.region || '其他';
    mesh.visible = state.regionVisible[r] !== false;
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
  const hits = raycast(clientX, clientY);
  if (!hits.length) { clearSelection(); return; }
  const fma = hits[0].object.userData.fma;
  selectBone(fma);
}

function raycast(clientX, clientY) {
  ndc.x = (clientX / innerWidth) * 2 - 1;
  ndc.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const targets = state.meshes.filter(m => m.mesh.visible).map(m => m.mesh);
  return raycaster.intersectObjects(targets, false);
}

function onMove(e) {
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

/* 一块骨在「当前状态下」应该是什么底色 */
function baseFor() {
  return state.xray ? XRAY_TINT : BASE_COLOR;
}

/* 自发光也跟着状态走，避免 X 光模式下选中态被覆盖 */
function refreshEmissive(mesh, fma) {
  if (fma === state.selected) mesh.material.emissive.copy(SEL_EMISSIVE);
  else if (state.xray) mesh.material.emissive.copy(XRAY_EMISSIVE);
  else mesh.material.emissive.copy(NO_EMISSIVE);
}

function highlightHover(fma) {
  if (state.hovered && state.hovered !== state.selected) {
    state.byFma.get(state.hovered)?.forEach(m => setMeshColor(m, baseFor()));
  }
  state.hovered = fma;
  if (fma && fma !== state.selected) {
    state.byFma.get(fma)?.forEach(m => setMeshColor(m, HOV_COLOR));
  }
}

function selectBone(fma) {
  clearSelection(false);
  state.selected = fma;
  state.byFma.get(fma)?.forEach(m => {
    setMeshColor(m, SEL_COLOR);
    refreshEmissive(m, fma);
  });
  const b = state.bones[fma];
  if (b) {
    $('tag').textContent = b.region;
    $('cn').textContent = b.cn;
    $('latin').textContent = b.latin;
    $('desc').textContent = b.desc;
    $('fma').textContent = 'FMA ' + fma.replace('FMA', '') + ' · BodyParts3D';
  } else {
    $('cn').textContent = fma;
    $('latin').textContent = ''; $('desc').textContent = '(无描述)';
  }
  infoEl.classList.add('show');
  placeLabel(fma);
}

function clearSelection(alsoHidePanel = true) {
  if (state.selected) {
    const prev = state.selected;
    state.selected = null;   // 先解绑状态，再还原外观，否则会被判定为仍处于选中态
    state.byFma.get(prev)?.forEach(m => {
      setMeshColor(m, baseFor());
      refreshEmissive(m, prev);
      if (state.xray) m.material.opacity = XRAY_OPACITY;
    });
  }
  state.selected = null;
  if (alsoHidePanel) {
    infoEl.classList.remove('show');
    removeLabel();
  }
}

/* ============ 3D 骨骼名称标签（跟随选中的骨） ============ */
let labelSprite = null;

function removeLabel() {
  if (labelSprite) {
    scene.remove(labelSprite);
    labelSprite.material.map?.dispose();
    labelSprite.material.dispose();
    labelSprite.geometry.dispose();
    labelSprite = null;
  }
}

function makeLabel(text) {
  removeLabel();
  const dpr = 2;
  const pad = 14, fs = 34;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = `600 ${fs}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = fs + pad * 2;
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
  const scale = 0.055;
  sp.scale.set((w / h) * scale, scale, 1);
  sp.renderOrder = 999;
  return sp;
}

function placeLabel(fma) {
  if (!state.showLabel) { removeLabel(); return; }
  const list = state.byFma.get(fma);
  if (!list || !list.length) return;
  const b = state.bones[fma];
  if (!b) return;
  const box = new THREE.Box3();
  list.forEach(m => box.expandByObject(m));
  const c = box.getCenter(new THREE.Vector3());
  labelSprite = makeLabel(b.cn);
  labelSprite.position.copy(c);
  scene.add(labelSprite);
}

function updateMaterials() {
  state.meshes.forEach(({ mesh, fma }) => {
    mesh.material.transparent = state.xray;
    mesh.material.opacity = state.xray ? XRAY_OPACITY : 1;
    mesh.material.depthWrite = !state.xray;
    mesh.material.needsUpdate = true;
    // 选中 / 悬停的骨保留各自的强调色，其余跟随当前模式
    if (fma !== state.selected && fma !== state.hovered) setMeshColor(mesh, baseFor());
    refreshEmissive(mesh, fma);
  });
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
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

boot();
