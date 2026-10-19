/* 轻量 Markdown 渲染器：仅覆盖《使用手册》用到的语法
   （标题/表格/有序无序列表/引用/分隔线/粗体/斜体/行内代码/链接/自动链接）。
   不引入第三方库；md-render.mdRender(text) 返回 HTML 字符串。 */
(function () {
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function inline(s) {
    // 行内代码先摘出占位，避免内部内容被后续规则二次替换
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => {
      codes.push('<code>' + c + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    // 自动链接 <https://...>（esc 后尖括号为 &lt; &gt;）
    s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>');
    // [文本](链接)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
    return s;
  }
  function render(md) {
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    const flush = () => {
      if (para.length) { out.push('<p>' + inline(esc(para.join(' '))) + '</p>'); para = []; }
    };
    let i = 0;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) { flush(); i++; continue; }
      let m;
      if ((m = t.match(/^(#{1,6})\s+(.*)$/))) {           // 标题
        flush();
        const lv = m[1].length;
        out.push('<h' + lv + '>' + inline(esc(m[2])) + '</h' + lv + '>');
        i++; continue;
      }
      if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); out.push('<hr>'); i++; continue; }
      if (t.startsWith('>')) {                            // 引用块
        flush();
        const buf = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          buf.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' +
          buf.map(b => '<p>' + inline(esc(b)) + '</p>').join('') + '</blockquote>');
        continue;
      }
      // 表格：当前行以 | 开头，下一行是 |---|---| 分隔
      if (t.startsWith('|') && i + 1 < lines.length &&
          /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        flush();
        const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '')
          .split('|').map(c => inline(esc(c.trim())));
        const head = cells(lines[i]);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          rows.push(cells(lines[i])); i++;
        }
        out.push('<table><thead><tr>' +
          head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>');
        continue;
      }
      if (/^[-*]\s+/.test(t)) {                           // 无序列表
        flush();
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*]\s+/, '')); i++;
        }
        out.push('<ul>' + items.map(x => '<li>' + inline(esc(x)) + '</li>').join('') + '</ul>');
        continue;
      }
      if (/^\d+[.、]\s*/.test(t)) {                       // 有序列表
        flush();
        const items = [];
        while (i < lines.length && /^\d+[.、]\s*/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+[.、]\s*/, '')); i++;
        }
        out.push('<ol>' + items.map(x => '<li>' + inline(esc(x)) + '</li>').join('') + '</ol>');
        continue;
      }
      para.push(t);
      i++;
    }
    flush();
    return out.join('\n');
  }
  window.mdRender = render;
})();
