/* ============ 用户数据存储抽象层 ============
   统一管理用户产生的数据（自定义标记 / 每骨笔记 / 未来的三维标注）。
   v1.2 使用 LocalDriver（localStorage），零后端零成本；
   未来接入账号同步时实现 RemoteDriver 并替换 store.driver 即可，业务层不用动。
   schema 带版本号，升级时按版本逐级迁移，避免旧数据被静默丢弃。 */

export const SCHEMA_VERSION = 1;

const STORAGE_KEY = 'hs3d-userdata';

export function emptyData() {
  return { schema: SCHEMA_VERSION, marks: {}, notes: {}, annotations: {} };
}

/* 版本迁移：v1 为首个版本；未来新增版本时在这里按 oldVersion 逐级升级 */
export function migrate(data) {
  if (!data || typeof data !== 'object') return emptyData();
  const out = { ...emptyData(), ...data };
  out.marks = out.marks || {};
  out.notes = out.notes || {};
  out.annotations = out.annotations || {};
  out.schema = SCHEMA_VERSION;
  return out;
}

/* ---- 本地驱动 ---- */
export const LocalDriver = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? migrate(JSON.parse(raw)) : emptyData();
    } catch (e) {
      console.warn('用户数据读取失败，按空数据继续：', e);
      return emptyData();
    }
  },
  save(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('用户数据保存失败（可能超出存储容量）：', e);
      return false;
    }
  },
};

/* ---- 业务层接口（页面只跟 store 打交道） ---- */
export const store = {
  data: emptyData(),

  init() { this.data = LocalDriver.load(); },

  /* 自定义标记 */
  isMarked(fma) { return !!this.data.marks[fma]; },
  getMarked() { return Object.keys(this.data.marks); },
  toggleMark(fma) {
    if (this.data.marks[fma]) delete this.data.marks[fma];
    else this.data.marks[fma] = 1;
    LocalDriver.save(this.data);
    return this.isMarked(fma);
  },

  /* 每骨笔记 */
  getNote(fma) { return this.data.notes[fma] || ''; },
  setNote(fma, text) {
    const t = (text || '').trim();
    if (t) this.data.notes[fma] = t;
    else delete this.data.notes[fma];
    return LocalDriver.save(this.data);
  },

  /* 导出 / 导入（JSON 文本）。导入按字段合并到现有数据，不清空未涉及部分 */
  exportJSON() {
    return JSON.stringify({
      app: 'human-skeleton-3d',
      schema: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      marks: this.data.marks,
      notes: this.data.notes,
    }, null, 2);
  },
  importJSON(text) {
    const obj = JSON.parse(text);   // 解析失败直接抛给调用方提示
    if (!obj || typeof obj !== 'object') throw new Error('不是有效的数据文件');
    const marks = obj.marks, notes = obj.notes;
    if (typeof marks !== 'object' && typeof notes !== 'object') {
      throw new Error('文件中没有可导入的标记或笔记');
    }
    let m = 0, n = 0;
    for (const k of Object.keys(marks || {})) { this.data.marks[k] = 1; m++; }
    for (const k of Object.keys(notes || {})) { this.data.notes[k] = String(notes[k]); n++; }
    LocalDriver.save(this.data);
    return { marks: m, notes: n };
  },
};
