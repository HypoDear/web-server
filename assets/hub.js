/* HD Hub —— 合集页通用目录引擎
 * 一次读取整个仓库的文件树（GitHub git/trees API，全站共享缓存 + ETag 复验），
 * 按页面配置自动发现条目：
 *   kind:'html'        目录下的 *.html（排除 index.html）
 *   kind:'userscript'  目录下的 *.user.js，解析 ==UserScript== 头
 *   kind:'dirs'        根目录下含 index.html 的子目录
 * 未登记的新文件会读取文件开头（HTTP Range，最多 16KB），从 <title>、description、
 * <meta name="hd:*"> 中取名称/分类/排序/图标；结果按文件 sha 缓存。
 */
(function (global) {
  'use strict';
  var REPO = 'HypoDear/web-server', BRANCH = 'main';
  var TREE_KEY = 'hd-hub-tree-v1', META_KEY = 'hd-hub-meta-v1', SEEN_KEY = 'hd-hub-seen-v1';
  var TTL = 3 * 60 * 1000, NEW_MS = 14 * 864e5, HEAD_BYTES = 16384;
  var SLUG_OK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  /* ---------- 小工具 ---------- */
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function hueOf(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function pretty(slug) {
    return slug.split(/[-_\s]+/).filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  }
  function size(n) { if (!n) return ''; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function ago(t) {
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return '刚刚'; if (s < 3600) return Math.round(s / 60) + ' 分钟前';
    if (s < 86400) return Math.round(s / 3600) + ' 小时前'; return Math.round(s / 86400) + ' 天前';
  }
  function withTimeout(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  function attrs(tag) {
    var o = {}, re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, m;
    while ((m = re.exec(tag))) o[m[1].toLowerCase()] = m[3] != null ? m[3] : m[4] != null ? m[4] : m[5];
    return o;
  }
  function decode(s) {
    var t = document.createElement('textarea'); t.innerHTML = s; return t.value;
  }

  /* ---------- 文件树 ---------- */
  function fetchTree(force) {
    var c = load(TREE_KEY);
    if (!force && c && Date.now() - c.at < TTL) return Promise.resolve({ files: c.files, src: 'cache', at: c.at });
    var api = 'https://api.github.com/repos/' + REPO + '/git/trees/' + BRANCH + '?recursive=1';
    var headers = { Accept: 'application/vnd.github+json' };
    if (c && c.etag) headers['If-None-Match'] = c.etag;
    return withTimeout(fetch(api, { headers: headers, cache: 'no-store' }), 9000).then(function (r) {
      if (r.status === 304 && c) { c.at = Date.now(); save(TREE_KEY, c); return { files: c.files, src: 'live', at: c.at }; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var etag = r.headers.get('ETag');
      return r.json().then(function (j) {
        if (!j || !Array.isArray(j.tree)) throw new Error('bad tree');
        var files = j.tree.filter(function (t) { return t.type === 'blob'; })
          .map(function (t) { return [t.path, t.sha, t.size || 0]; });
        var o = { at: Date.now(), etag: etag, files: files };
        save(TREE_KEY, o);
        return { files: files, src: 'live', at: o.at };
      });
    }).catch(function () {
      return c ? { files: c.files, src: 'stale', at: c.at } : { files: null, src: 'off', at: 0 };
    });
  }
  /* 首次出现时间：用来标「NEW」。第一次打开本站时全部记为旧条目，之后新增的才会标新 */
  var curatedPaths = {};
  function isCurated(p) { return !!curatedPaths[p]; }
  function trackSeen(files, dir) {
    /* 按顶层目录判断「第一次见」：某目录第一次被读到时，已登记条目记为旧，未登记的才算新上架 */
    var s = load(SEEN_KEY) || {}, now = Date.now(), known = {};
    Object.keys(s).forEach(function (p) { known[p.split('/')[0]] = 1; });
    files.forEach(function (f) {
      var top = f[0].split('/')[0], first = !known[top], r = s[f[0]];
      /* 目录第一次被读到：只有「当前页面目录里、且未登记」的文件才算新上架，其余一律视为旧 */
      if (!r) s[f[0]] = { t: first && (top !== dir || isCurated(f[0])) ? 0 : now, s: f[1] };
      else if (r.s !== f[1]) { r.s = f[1]; r.u = now; }
    });
    save(SEEN_KEY, s);
    return s;
  }

  /* ---------- 文件头元数据 ---------- */
  var metaCache = load(META_KEY) || {};
  function readHead(url) {
    return withTimeout(fetch(url, { headers: { Range: 'bytes=0-' + (HEAD_BYTES - 1) }, cache: 'no-cache' }), 9000)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (t) { return t.slice(0, HEAD_BYTES); });
  }
  function parseHtml(t) {
    var m = {}, x;
    if ((x = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(t))) m.title = decode(x[1].replace(/\s+/g, ' ').trim());
    var re = /<meta\b[^>]*>/gi;
    while ((x = re.exec(t))) {
      var a = attrs(x[0]), n = (a.name || a.property || '').toLowerCase();
      if (!n || a.content == null) continue;
      var v = decode(a.content).trim();
      if (n === 'description' || n === 'og:description') m.desc = m.desc || v;
      else if (n.indexOf('hd:') === 0) m[n.slice(3)] = v;
    }
    var tech = [];
    if (/webgpu|navigator\.gpu/i.test(t)) tech.push('WebGPU');
    if (/three\.js|THREE\./.test(t)) tech.push('Three.js');
    else if (/webgl/i.test(t)) tech.push('WebGL');
    else if (/<canvas/i.test(t)) tech.push('Canvas');
    m.tech = tech.join(' · ');
    return m;
  }
  function parseUserscript(t) {
    var b = /==UserScript==([\s\S]*?)==\/UserScript==/.exec(t);
    if (!b) return null;
    var m = {};
    b[1].split(/\r?\n/).forEach(function (line) {
      var x = /^\s*\/\/\s*@([\w:-]+)\s+(.+?)\s*$/.exec(line);
      if (!x) return;
      (m[x[1]] = m[x[1]] || []).push(x[2]);
    });
    return m.name ? m : null;
  }

  /* ---------- 主体 ---------- */
  function HDHub(cfg) {
    var root = document.getElementById(cfg.mount || 'hub');
    var base = cfg.dir ? cfg.dir + '/' : '';
    var cats = (cfg.categories || []).map(function (c, i) { return { id: c.id, name: c.name, en: c.en || '', rule: c.rule, i: i }; });
    var FALLBACK = cfg.fallback || { id: 'other', name: '其他', en: 'Others' };
    var curated = (cfg.items || []).map(function (it, i) { var o = Object.assign({}, it); o._i = i; return o; });
    var state = { items: [], src: 'boot', at: 0, total: 0 };
    var ui = readHash();
    if (!ui.v) ui.v = load('hd-hub-view-' + (cfg.dir || 'root')) || cfg.view || 'group';

    function catById(id) {
      if (!id) return null;
      var k = String(id).toLowerCase();
      for (var i = 0; i < cats.length; i++) if (cats[i].id.toLowerCase() === k || cats[i].name.toLowerCase() === k) return cats[i];
      return null;
    }
    function findCurated(slug) {
      for (var i = 0; i < curated.length; i++) {
        var c = curated[i];
        if (c.slug === slug || (c.aliases && c.aliases.indexOf(slug) >= 0)) return c;
      }
      return null;
    }

    /* 把文件清单整理成条目 */
    function collect(files) {
      var out = [];
      if (cfg.kind === 'dirs') {
        var set = {}, counts = {};
        files.forEach(function (f) {
          var p = f[0].split('/');
          if (p.length === 2 && p[1] === 'index.html' && !/^[._]/.test(p[0]) && (cfg.exclude || []).indexOf(p[0]) < 0) set[p[0]] = f;
          if (p.length === 2 && p[1] !== 'index.html' && (/\.html$/i.test(p[1]) || /\.user\.js$/.test(p[1])))
            counts[p[0]] = (counts[p[0]] || 0) + 1;
        });
        Object.keys(set).forEach(function (d) {
          out.push({ slug: d, file: d + '/', path: d + '/index.html', sha: set[d][1], size: 0, count: counts[d] || 0 });
        });
      } else {
        files.forEach(function (f) {
          if (f[0].indexOf(base) !== 0) return;
          var name = f[0].slice(base.length);
          if (!name || name.indexOf('/') >= 0 || /^[._]/.test(name)) return;
          if (cfg.kind === 'userscript') {
            if (!/\.user\.js$/.test(name)) return;
            out.push({ slug: name.replace(/\.user\.js$/, ''), file: name, path: f[0], sha: f[1], size: f[2] });
          } else {
            if (!/\.html?$/i.test(name) || /^index\.html?$/i.test(name)) return;
            out.push({ slug: name.replace(/\.html?$/i, ''), file: name, path: f[0], sha: f[1], size: f[2] });
          }
        });
      }
      return out;
    }
    builtinFiles().forEach(function (f) { curatedPaths[f.path] = 1; });
    curated.forEach(function (c) { (c.aliases || []).forEach(function (a) {
      curatedPaths[cfg.kind === 'dirs' ? a + '/index.html' : base + a + (cfg.kind === 'userscript' ? '.user.js' : '.html')] = 1; }); });
    function builtinFiles() {
      return curated.map(function (c) {
        if (cfg.kind === 'dirs') return { slug: c.slug, file: c.slug + '/', path: c.slug + '/index.html', sha: '', size: 0, count: c.count || 0 };
        var file = c.file || (c.slug + (cfg.kind === 'userscript' ? '.user.js' : '.html'));
        return { slug: c.slug, file: file, path: base + file, sha: '', size: c.size || 0 };
      });
    }

    /* 合并：登记信息 > 文件内 hd: 元数据 > 自动推断 */
    function build(f, seen) {
      var c = findCurated(f.slug), m = (f.sha && metaCache[f.path] && metaCache[f.path].sha === f.sha) ? metaCache[f.path].m : null;
      m = m || {};
      var it = { slug: f.slug, file: f.file, path: f.path, size: f.size, count: f.count, curated: !!c, meta: m };
      if (cfg.kind === 'userscript') {
        it.name = (m.name && m.name[0]) || (c && c.name) || pretty(f.slug);
        it.desc = (m.description && m.description[0]) || (c && c.desc) || '';
        it.ver = m.version ? m.version[0] : '';
        it.match = (m.match || []).concat(m.include || []);
        it.en = (c && c.en) || pretty(f.slug);
      } else {
        var title = m.title || '';
        var short = title.split(/\s+[|｜—–-]\s+/)[0];
        it.name = (c && c.name) || m.name || short || pretty(f.slug);
        it.en = (c && c.en) || m.en || (SLUG_OK.test(f.slug) ? pretty(f.slug) : '');
        it.desc = (c && c.desc) || m.desc || '';
      }
      it.order = c ? c._i * 10 : (m.order != null && m.order !== '' && !isNaN(+m.order) ? +m.order : 1e4);
      it.hero = !!(c && c.hero);
      it.hue = (c && c.hue != null) ? c.hue : (m.hue != null && m.hue !== '' ? +m.hue : hueOf(f.slug));
      it.icon = (c && c.icon) || m.icon || '';
      it.tags = (c && c.tags) || (m.tags ? m.tags.split(/[,，\s]+/).filter(Boolean) : []);
      it.extra = (c && c.meta) || m.tech || '';
      /* 分类 */
      var cat = catById(c && c.cat) || catById(m.category);
      if (!cat && m.category) {
        cat = { id: m.category, name: m.category, en: '', i: cats.length };
        cats.push(cat);
      }
      if (!cat && cfg.kind === 'userscript') cat = scriptCat(it.match);
      if (!cat) {
        var probe = [f.slug, it.name, it.desc, m.tech || '', m.title || ''].join(' ');
        for (var i = 0; i < cats.length && !cat; i++) if (cats[i].rule && cats[i].rule.test(probe)) cat = cats[i];
      }
      it.cat = cat || FALLBACK;
      /* NEW / 更新 */
      var r = seen && seen[f.path], added = c && c.added ? Date.parse(c.added) : 0;
      it.isNew = (added && Date.now() - added < NEW_MS) || (r && r.t && Date.now() - r.t < NEW_MS);
      it.isUpd = !it.isNew && r && r.u && Date.now() - r.u < NEW_MS;
      it.badName = cfg.kind === 'html' && !SLUG_OK.test(f.slug) && !c;
      it.href = cfg.kind === 'dirs' ? encodeURI(f.slug) + '/' : encodeURIComponent(f.file);
      return it;
    }
    function scriptCat(match) {
      if (!match.length || match.some(function (p) { return /^\*:\/\/\*\/\*$|^\*$|<all_urls>/.test(p); }))
        return catById('global') || { id: 'global', name: '全站通用', en: 'Global', i: -1 };
      var host = (/^[\w*]+:\/\/([^/]+)/.exec(match[0]) || [])[1] || '站点';
      host = host.replace(/^\*\./, '').replace(/^www\./, '');
      var c = catById(host);
      if (!c) { c = { id: host, name: host, en: 'Site', i: cats.length }; cats.push(c); }
      return c;
    }

    /* ---------- 骨架 ---------- */
    var I = {
      search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
      back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
      moon: '<svg class="moon" viewBox="0 0 24 24"><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z"/></svg>',
      sun: '<svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.1"/><path d="M12 2.6v2.3M12 19.1v2.3M4.4 4.4l1.7 1.7M17.9 17.9l1.7 1.7M2.6 12h2.3M19.1 12h2.3M4.4 19.6l1.7-1.7M17.9 6.1l1.7-1.7"/></svg>',
      sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>',
      dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'
    };
    var showBar = cfg.bar !== false;
    root.innerHTML =
      '<header class="hub-head"><div class="hub-row">' +
        '<span class="kick" id="hKick" title="目录状态"><span class="dot wait" id="hDot"></span>' + esc(cfg.kicker || 'web-server') + '</span>' +
        '<span class="acts">' +
          (cfg.back ? '<a class="ibtn" href="' + esc(cfg.back) + '" title="返回上一级" aria-label="返回上一级">' + I.back + '</a>' : '') +
          '<button class="ibtn" id="hSync" type="button" title="重新读取目录" aria-label="重新读取目录">' + I.sync + '</button>' +
          '<button class="ibtn thm" id="hThm" type="button" title="切换深色模式" aria-label="切换深色模式">' + I.moon + I.sun + '</button>' +
        '</span></div>' +
        '<h1>' + esc(cfg.title) + '<span class="cnt" id="hCnt"></span></h1>' +
        (cfg.lead ? '<p>' + esc(cfg.lead) + '</p>' : '') +
      '</header>' +
      (showBar ?
        '<div class="bar" id="hBar"><div class="bar-row">' +
          '<label class="search" id="hSearch">' + I.search +
            '<input id="hQ" type="search" placeholder="' + esc(cfg.searchHint || '搜索名称、简介、分类') + '" autocomplete="off" enterkeyhint="search" aria-label="搜索">' +
            '<kbd>/</kbd><button class="clr" id="hClr" type="button" aria-label="清空搜索">×</button></label>' +
          '<div class="seg" role="group" aria-label="排列方式">' +
            '<button type="button" data-v="group">分组</button><button type="button" data-v="rec">推荐</button><button type="button" data-v="name">名称</button>' +
          '</div></div>' +
          '<div class="chips" id="hChips" role="group" aria-label="分类筛选"></div></div>' : '') +
      '<div id="hNote"></div><main id="hMain"></main>' +
      '<footer class="hub-foot">' + (cfg.help ? '<details class="help"><summary>' + esc(cfg.helpTitle || '如何上架新作品') + '</summary>' + cfg.help + '</details>' : '') +
        '<div class="row"><span id="hSrc">正在读取目录…</span><a href="https://github.com/' + REPO + '/tree/' + BRANCH + '/' + esc(cfg.dir || '') + '" target="_blank" rel="noopener">在 GitHub 查看</a></div></footer>';
    var $ = function (id) { return document.getElementById(id); };

    /* ---------- 交互状态 ---------- */
    function readHash() {
      var o = {};
      location.hash.slice(1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) o[p[0]] = decodeURIComponent(p[1] || ''); });
      return { c: o.c || '', q: o.q || '', v: o.v || '' };
    }
    function writeHash() {
      var parts = [];
      if (ui.c) parts.push('c=' + encodeURIComponent(ui.c));
      if (ui.q) parts.push('q=' + encodeURIComponent(ui.q));
      var h = parts.length ? '#' + parts.join('&') : location.pathname + location.search;
      try { history.replaceState(null, '', parts.length ? h : h); } catch (e) {}
      save('hd-hub-view-' + (cfg.dir || 'root'), ui.v);
    }
    if (showBar) {
      var q = $('hQ'), sb = $('hSearch');
      q.value = ui.q; sb.classList.toggle('has', !!ui.q);
      q.addEventListener('input', function () { ui.q = q.value.trim(); sb.classList.toggle('has', !!q.value); writeHash(); render(); });
      $('hClr').addEventListener('click', function () { q.value = ''; ui.q = ''; sb.classList.remove('has'); writeHash(); render(); q.focus(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === '/' && document.activeElement !== q && !/input|textarea/i.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); q.focus(); }
        else if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; ui.q = ''; sb.classList.remove('has'); writeHash(); render(); q.blur(); }
      });
      [].forEach.call(document.querySelectorAll('.seg button'), function (b) {
        b.addEventListener('click', function () { ui.v = b.dataset.v; writeHash(); render(); });
      });
      $('hChips').addEventListener('click', function (e) {
        var b = e.target.closest('.chip'); if (!b) return;
        ui.c = b.dataset.c === ui.c ? '' : b.dataset.c; writeHash(); render();
      });
      var bar = $('hBar');
      addEventListener('scroll', function () { bar.classList.toggle('lift', bar.getBoundingClientRect().top <= 0 && scrollY > 40); }, { passive: true });
    }
    $('hSync').addEventListener('click', function () { refresh(true); });
    $('hThm').addEventListener('click', function () {
      var d = document.documentElement, dark = d.getAttribute('data-theme') !== 'dark';
      if (dark) d.setAttribute('data-theme', 'dark'); else d.removeAttribute('data-theme');
      try { localStorage.setItem('hd-theme', dark ? 'dark' : 'light'); } catch (e) {}
      var mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.content = dark ? '#101216' : '#faf8f3';
      try { document.dispatchEvent(new Event('hd-theme')); } catch (e) {}
    });
    addEventListener('hashchange', function () { var h = readHash(); ui.c = h.c; ui.q = h.q; if (showBar) { $('hQ').value = ui.q; $('hSearch').classList.toggle('has', !!ui.q); } render(); });

    /* ---------- 渲染 ---------- */
    function hl(text, re) { var s = esc(text); return re ? s.replace(re, '<mark>$1</mark>') : s; }
    function iconHtml(it) {
      var ic = it.icon;
      if (ic && ic.charAt(0) === '<') return '<span class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + ic + '</svg></span>';
      if (ic) return '<span class="ico" aria-hidden="true">' + esc(ic) + '</span>';
      var ch = (it.en || it.name || it.slug).replace(/[^\p{L}\p{N}]/gu, '').charAt(0) || '·';
      return '<span class="ico mono" aria-hidden="true">' + esc(ch.toUpperCase()) + '</span>';
    }
    function artHtml(it) {
      var ic = it.icon;
      if (ic && ic.charAt(0) === '<') return '<span class="art" aria-hidden="true"><svg viewBox="0 0 24 24">' + ic + '</svg></span>';
      if (ic) return '<span class="art emo" aria-hidden="true">' + esc(ic) + '</span>';
      return '';
    }
    function pills(it, inCat) {
      var p = '';
      if (it.isNew) p += '<span class="pill new">NEW</span>';
      else if (it.isUpd) p += '<span class="pill hot">已更新</span>';
      if (it.badName) p += '<span class="pill" title="建议改成小写英文加连字符，如 abc-xyz.html">待改英文名</span>';
      if (!inCat) p += '<span class="pill">' + esc(it.cat.name) + '</span>';
      (it.tags || []).slice(0, 1).forEach(function (t) { p += '<span class="pill hot">' + esc(t) + '</span>'; });
      return '<span class="pills">' + p + '</span>';
    }
    function card(it, re, inCat, k) {
      var style = '--h:' + it.hue + ';animation-delay:' + Math.min(k * 28, 280) + 'ms';
      if (cfg.kind === 'userscript') {
        var install = 'https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/' + encodeURI(it.path);
        var cdn = 'https://cdn.jsdelivr.net/gh/' + REPO + '@' + BRANCH + '/' + encodeURI(it.path);
        var tags = it.match.slice(0, 5).map(function (m) {
          return '<span class="pill" title="' + esc(m) + '">' + esc(/^\*:\/\/\*\/\*$/.test(m) ? '全站' : m.replace(/^\*:\/\//, '').replace(/\/\*$/, '')) + '</span>';
        }).join('') + (it.match.length > 5 ? '<span class="pill">+' + (it.match.length - 5) + '</span>' : '');
        return '<article class="card script" style="' + style + '"><span class="wash" aria-hidden="true"></span>' +
          '<div class="c-top">' + iconHtml(it) + pills(it, inCat) + '</div>' +
          '<div class="c-body"><span class="nm">' + hl(it.name, re) + '</span>' +
            '<span class="en">' + esc(it.ver ? 'v' + it.ver : it.en) + ' · ' + esc(it.file) + '</span>' +
            (it.desc ? '<span class="ds">' + hl(it.desc, re) + '</span>' : '') +
            (tags ? '<div class="tags">' + tags + '</div>' : '') + '</div>' +
          '<div class="btns"><a class="btn" href="' + esc(install) + '" target="_blank" rel="noopener">' + I.dl + '安装</a>' +
            '<button class="btn ghost" type="button" data-copy="' + esc(install) + '">复制链接</button>' +
            '<a class="btn ghost" href="' + esc(cdn) + '" target="_blank" rel="noopener" title="raw.githubusercontent 打不开时用这个">镜像</a>' +
            '<a class="btn ghost" href="https://github.com/' + REPO + '/blob/' + BRANCH + '/' + esc(encodeURI(it.path)) + '" target="_blank" rel="noopener">源码</a></div>' +
          '</article>';
      }
      var foot = it.extra || '';
      if (cfg.kind === 'dirs' && it.count) foot = it.count + ' ' + ((findCurated(it.slug) || {}).unit || '项');
      else if (cfg.kind === 'html' && it.size) foot = foot ? foot + ' · ' + size(it.size) : size(it.size);
      return '<a class="card' + (it.hero ? ' hero' : '') + '" href="' + esc(it.href) + '" style="' + style + '" data-slug="' + esc(it.slug) + '">' +
        '<span class="wash" aria-hidden="true"></span>' + (it.hero ? artHtml(it) : '') +
        '<span class="c-top">' + iconHtml(it) + pills(it, inCat) + '</span>' +
        '<span class="c-body"><span class="nm">' + hl(it.name, re) + '</span>' +
          (it.en ? '<span class="en">' + hl(it.en, re) + '</span>' : '') +
          (it.desc ? '<span class="ds">' + hl(it.desc, re) + '</span>' : '') + '</span>' +
        '<span class="c-foot"><span class="mt">' + esc(foot) + '</span><span class="go">' + esc(cfg.go || '打开') + ' <i aria-hidden="true">→</i></span></span></a>';
    }
    function cmpRec(a, b) { return (b.hero - a.hero) || (a.order - b.order) || a.name.localeCompare(b.name, 'zh-Hans-CN'); }
    function cmpName(a, b) { return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }); }
    function catOrder(a, b) {
      var fa = a === FALLBACK ? 1 : 0, fb = b === FALLBACK ? 1 : 0;
      return (fa - fb) || (a.i - b.i);
    }
    function render() {
      var items = state.items;
      var re = null, qs = (ui.q || '').toLowerCase();
      if (qs) re = new RegExp('(' + esc(ui.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      var hits = items.filter(function (it) {
        if (!qs) return true;
        return [it.name, it.en, it.desc, it.slug, it.cat.name, (it.tags || []).join(' '), (it.match || []).join(' ')]
          .join(' ').toLowerCase().indexOf(qs) >= 0;
      });
      /* 分类条 */
      if (showBar) {
        var used = [], seenCat = {};
        items.forEach(function (it) { if (!(it.cat.id in seenCat)) { seenCat[it.cat.id] = 0; used.push(it.cat); } });
        hits.forEach(function (it) { seenCat[it.cat.id]++; });
        used.sort(catOrder);
        if (ui.c && !used.some(function (c) { return c.id === ui.c; })) ui.c = '';
        var chips = '<button class="chip" type="button" data-c="" aria-pressed="' + (!ui.c) + '">全部 <i>' + hits.length + '</i></button>' +
          used.map(function (c) {
            return '<button class="chip" type="button" data-c="' + esc(c.id) + '" aria-pressed="' + (ui.c === c.id) + '">' + esc(c.name) + ' <i>' + seenCat[c.id] + '</i></button>';
          }).join('');
        $('hChips').innerHTML = chips;
        $('hChips').hidden = used.length < 2;
        [].forEach.call(document.querySelectorAll('.seg button'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === ui.v)); });
      }
      if (ui.c) hits = hits.filter(function (it) { return it.cat.id === ui.c; });
      var main = $('hMain'), html = '', k = 0;
      var v = showBar ? ui.v : 'group';
      if (!items.length && state.src === 'boot') {
        html = '<div class="grid"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>';
      } else if (!hits.length) {
        html = '<div class="grid"><div class="empty">' + (items.length ? '没有匹配「' + esc(ui.q || '') + '」的条目' : esc(cfg.emptyText || '这里还没有内容')) + '</div></div>';
      } else if (v === 'group' && !qs) {
        var groups = {};
        hits.forEach(function (it) { (groups[it.cat.id] = groups[it.cat.id] || { cat: it.cat, list: [] }).list.push(it); });
        Object.keys(groups).map(function (id) { return groups[id]; }).sort(function (a, b) { return catOrder(a.cat, b.cat); })
          .forEach(function (g, gi, all) {
            g.list.sort(cmpRec);
            html += '<section class="sec">' + (all.length > 1 || cfg.alwaysHeads ? '<div class="sec-h"><h2>' + esc(g.cat.name) + '</h2>' +
              (g.cat.en ? '<span>' + esc(g.cat.en) + '</span>' : '') + '<b>' + g.list.length + '</b></div>' : '') +
              '<div class="grid">' + g.list.map(function (it) { return card(it, re, true, k++); }).join('') + '</div></section>';
          });
      } else {
        hits.sort(v === 'name' ? cmpName : cmpRec);
        if (v === 'name') hits = hits.map(function (it) { var o = Object.assign({}, it); o.hero = false; return o; });
        html = '<div class="grid">' + hits.map(function (it) { return card(it, re, !!ui.c, k++); }).join('') + '</div>';
      }
      main.innerHTML = html;
      $('hCnt').textContent = items.length ? String(items.length) : '';
      document.title = cfg.title + (items.length ? ' · ' + items.length : '');
    }

    /* 复制按钮 */
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-copy]'); if (!b) return;
      var url = b.getAttribute('data-copy'), old = b.textContent;
      var ok = function () { b.textContent = '已复制'; setTimeout(function () { b.textContent = old; }, 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, function () {});
      else { var t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); ok(); } catch (x) {} t.remove(); }
    });

    function setStatus() {
      var dot = $('hDot'), src = $('hSrc');
      dot.className = 'dot' + (state.src === 'live' || state.src === 'cache' ? '' : state.src === 'boot' ? ' wait' : ' off');
      var when = state.at > 1e12 ? ago(state.at) : '';
      var txt = state.src === 'live' ? '目录已同步 · ' + when
        : state.src === 'cache' ? '目录已同步 · ' + when + '（缓存 3 分钟，点右上角刷新可立即更新）'
        : state.src === 'stale' ? '暂时连不上 GitHub，显示上次读取' + (when ? '（' + when + '）' : '') + '的目录'
        : state.src === 'off' ? '暂时连不上 GitHub，显示内置清单' : '正在读取目录…';
      src.textContent = txt; $('hKick').title = txt;
    }

    /* 补读未登记文件的元数据（并发 4） */
    function enrich(files) {
      var need = files.filter(function (f) {
        if (!f.sha) return false;
        if (metaCache[f.path] && metaCache[f.path].sha === f.sha) return false;
        return cfg.kind === 'userscript' || !findCurated(f.slug) || cfg.readAll;
      });
      if (!need.length) return Promise.resolve(false);
      var idx = 0;
      function next() {
        if (idx >= need.length) return Promise.resolve();
        var f = need[idx++];
        var url = cfg.kind === 'dirs' ? encodeURI(f.slug) + '/index.html' : encodeURIComponent(f.file);
        return readHead(url).then(function (t) {
          var m = cfg.kind === 'userscript' ? parseUserscript(t) : parseHtml(t);
          metaCache[f.path] = { sha: f.sha, m: m || {} };
        }, function () {}).then(next);
      }
      var workers = []; for (var w = 0; w < Math.min(4, need.length); w++) workers.push(next());
      return Promise.all(workers).then(function () {
        var keep = {}; Object.keys(metaCache).slice(-200).forEach(function (k) { keep[k] = metaCache[k]; });
        save(META_KEY, keep); return true;
      });
    }

    var busy = false;
    function refresh(force) {
      if (busy) return; busy = true;
      if (force) { state.src = 'boot'; setStatus(); }
      fetchTree(force).then(function (res) {
        var files = res.files ? collect(res.files) : builtinFiles();
        var seen = res.files ? trackSeen(res.files, cfg.kind === 'dirs' ? '' : cfg.dir) : null;
        state.src = res.src; state.at = res.at;
        state.items = files.map(function (f) { return build(f, seen); });
        setStatus(); render();
        return enrich(files).then(function (changed) {
          if (changed) { state.items = files.map(function (f) { return build(f, seen); }); render(); }
        });
      }).then(function () { busy = false; }, function () { busy = false; });
    }

    /* 先用内置清单秒出，再用真实目录覆盖 */
    state.items = builtinFiles().map(function (f) { return build(f, null); });
    if (cfg.kind === 'userscript') state.items = [];
    render(); setStatus();
    refresh(false);
    return { refresh: refresh };
  }
  global.HDHub = HDHub;
})(window);
