const $ = s => document.querySelector(s);
const inv = (c, ...a) => window.api.invoke(c, ...a);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => { if (!n) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const dur = ms => { const s = Math.round(ms / 1000); return s < 60 ? s + ' sn' : Math.floor(s / 60) + ' dk ' + (s % 60) + ' sn'; };
const errMsg = e => String(e.message).replace(/^Error invoking remote method '.*?': (Error: )?/, '');
const STATUS = { queued: 'Sırada', resolving: 'Link çözülüyor…', downloading: 'İndiriliyor', paused: 'Duraklatıldı', done: 'Bitti', error: 'Hata', cancelled: 'İptal' };
const ACTIVE = ['queued', 'resolving', 'downloading'];
let settings, jobs = new Map(), filter = 'all';

// ---- tabs ----
document.querySelectorAll('aside button').forEach(b => b.onclick = () => {
  document.querySelectorAll('aside button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('section').forEach(s => s.hidden = s.id !== b.dataset.tab);
  ({ hist: loadHistory, stats: loadStats, sites: loadSites, settings: loadSettings })[b.dataset.tab]?.();
});
function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', 3500); }
window.api.on('toast', toast);

// ---- downloads ----
function visible(j) {
  return filter === 'all' || (filter === 'active' && (ACTIVE.includes(j.status) || j.status === 'paused')) ||
    (filter === 'done' && j.status === 'done') || (filter === 'error' && j.status === 'error');
}
const ext = n => ((/.([a-z0-9]{1,5})$/i.exec(n || '') || [])[1] || '').toLowerCase();
function jobHtml(j) {
  const pct = j.total ? Math.min(100, j.received / j.total * 100) : (j.status === 'done' ? 100 : 0);
  const eta = j.status === 'downloading' && j.speed && j.total ? ' · ' + dur((j.total - j.received) / j.speed * 1000) + ' kaldı' : '';
  const act = [];
  if (ACTIVE.includes(j.status)) act.push(['pause', 'Duraklat']);
  if (['paused', 'error', 'cancelled'].includes(j.status)) act.push(['resume', j.status === 'error' ? 'Tekrar dene' : 'Devam']);
  if (!['done', 'cancelled'].includes(j.status)) act.push(['cancel', 'İptal']);
  if (j.status === 'done') act.push(['open', 'Aç', 'pri'], ['show', '📂 Klasör']);
  act.push(['remove', '✕']);
  return `<div class="job ${j.status}" data-id="${j.id}">
    <div class="t"><span class="fi ${ext(j.filename)}">${esc(ext(j.filename).toUpperCase().slice(0, 4) || 'FILE')}</span><span class="name" title="${esc(j.url)}">${esc(j.filename || j.url)}<small>${esc(j.url)}</small></span>
    ${act.map(([a, l, c]) => `<button data-a="${a}"${c ? ' class="' + c + '"' : ''}>${l}</button>`).join('')}</div>
    <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="meta"><span class="st">${STATUS[j.status] || j.status}${j.total ? ' · ' + pct.toFixed(0) + '%' : ''}</span><span>${fmt(j.received)}${j.total ? ' / ' + fmt(j.total) : ''}</span>
    ${j.status === 'downloading' && j.speed ? `<span>${fmt(j.speed)}/s${eta}</span>` : ''}<span>${esc(j.pluginName)}</span></div>
    ${j.error ? `<div class="err">${esc(j.error)}</div>` : ''}
    ${(j.notes || []).slice(-3).map(n => `<div class="note">${esc(n)}</div>`).join('')}</div>`;
}
function summary() {
  const all = [...jobs.values()];
  const act = all.filter(j => ACTIVE.includes(j.status)).length;
  $('#badge').textContent = act || '';
  $('#speed').textContent = '⬇ ' + fmt(all.reduce((s, j) => s + (j.status === 'downloading' ? j.speed || 0 : 0), 0)) + '/s';
  $('#empty').hidden = all.some(visible);
}
function renderJob(j) {
  jobs.set(j.id, j);
  const el = document.querySelector(`.job[data-id="${j.id}"]`);
  if (!visible(j)) { el?.remove(); return summary(); }
  const tmp = document.createElement('div'); tmp.innerHTML = jobHtml(j);
  if (el) el.replaceWith(tmp.firstElementChild); else $('#jobs').appendChild(tmp.firstElementChild);
  summary();
}
function rerenderAll() { $('#jobs').innerHTML = ''; [...jobs.values()].sort((a, b) => a.addedAt - b.addedAt).forEach(renderJob); summary(); }
window.api.on('job', renderJob);
window.api.on('job-removed', id => { jobs.delete(id); document.querySelector(`.job[data-id="${id}"]`)?.remove(); summary(); });
$('#jobs').onclick = e => { const b = e.target.closest('button[data-a]'); if (b) inv('jobs:' + b.dataset.a, b.closest('.job').dataset.id); };
$('#clear').onclick = () => inv('jobs:clear');
$('#pauseall').onclick = () => jobs.forEach(j => ACTIVE.includes(j.status) && inv('jobs:pause', j.id));
$('#resumeall').onclick = () => jobs.forEach(j => ['paused', 'error'].includes(j.status) && inv('jobs:resume', j.id));
$('#chips').onclick = e => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.f; document.querySelectorAll('#chips button').forEach(x => x.classList.toggle('on', x === b)); rerenderAll(); };
$('#pick').onclick = async () => { const d = await inv('dialog:folder'); if (d) $('#dir').value = d; };
$('#dirreset').onclick = () => $('#dir').value = '';
async function addUrls(urls) {
  if (!urls.trim()) return;
  try { await inv('jobs:add', { urls, dir: $('#dir').value, presetId: $('#preset').value }); $('#urls').value = ''; }
  catch (e) { toast(errMsg(e)); }
}
$('#add').onclick = () => addUrls($('#urls').value);
$('#urls').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) { e.preventDefault(); addUrls($('#urls').value); } });
const drop = $('#drop');
['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); }));
document.addEventListener('drop', e => { const t = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'); if (t) addUrls(t.replace(/^#.*$/gm, '')); });

// clipboard banner
let clipUrl = '';
window.api.on('clip', u => { clipUrl = u; $('#cliptxt').textContent = 'Panoda link var: ' + u; $('#clip').hidden = false; });
$('#clipadd').onclick = () => { addUrls(clipUrl); $('#clip').hidden = true; };
$('#clipno').onclick = () => $('#clip').hidden = true;

// ---- history ----
async function loadHistory() {
  const q = $('#hq').value.toLowerCase();
  const h = (await inv('history:list')).filter(x => !q || (x.name + ' ' + x.site).toLowerCase().includes(q));
  $('#hlist').innerHTML = h.length ? h.map(x => `<div class="hrow" data-id="${x.id}" data-url="${esc(x.url)}">
    <span class="n" title="${esc(x.url)}">${esc(x.name)}</span><span class="note">${esc(x.site)}</span><span>${fmt(x.bytes)}</span>
    <span class="d">${new Date(x.at).toLocaleString('tr-TR')}</span>
    <button data-a="show">Göster</button><button data-a="again">Tekrar indir</button><button data-a="del">✕</button></div>`).join('')
    : '<div class="empty">Geçmiş boş.</div>';
}
$('#hq').oninput = loadHistory;
window.api.on('history-changed', () => { if (!$('#hist').hidden) loadHistory(); if (!$('#stats').hidden) loadStats(); });
$('#hclear').onclick = async () => { if (confirm('Tüm geçmiş ve istatistikler silinsin mi?')) { await inv('history:clear'); loadHistory(); } };
$('#hlist').onclick = async e => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const r = b.closest('.hrow');
  if (b.dataset.a === 'show') inv('history:show', r.dataset.id);
  if (b.dataset.a === 'again') { try { await inv('jobs:add', { urls: r.dataset.url, presetId: $('#preset').value }); toast('Kuyruğa eklendi'); } catch (er) { toast(errMsg(er)); } }
  if (b.dataset.a === 'del') { await inv('history:remove', r.dataset.id); loadHistory(); }
};

// ---- stats ----
async function loadStats() {
  const h = await inv('history:list');
  const day = t => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const now = Date.now(), DAY = 864e5;
  const sum = a => a.reduce((s, x) => s + x.bytes, 0);
  const today = h.filter(x => day(x.at) === day(now)), week = h.filter(x => now - x.at < 7 * DAY);
  const totalMs = h.reduce((s, x) => s + (x.ms || 0), 0);
  const avg = totalMs ? sum(h) / (totalMs / 1000) : 0;
  const card = (l, v) => `<div class="card"><span>${l}</span><b>${v}</b></div>`;
  $('#cards').innerHTML = card('Toplam indirilen', fmt(sum(h))) + card('Dosya sayısı', h.length) + card('Bugün', fmt(sum(today)) + ' · ' + today.length) +
    card('Son 7 gün', fmt(sum(week))) + card('Ortalama hız', fmt(avg) + '/s') + card('En büyük dosya', h.length ? fmt(Math.max(...h.map(x => x.bytes))) : '-');
  const days = [...Array(14)].map((_, i) => { const t = now - (13 - i) * DAY; return { l: new Date(t).getDate(), v: sum(h.filter(x => day(x.at) === day(t))) }; });
  const mx = Math.max(1, ...days.map(d => d.v));
  $('#chart').innerHTML = days.map(d => `<div title="${fmt(d.v)}"><i style="height:${d.v / mx * 100}%"></i>${d.l}</div>`).join('');
  const by = {}; h.forEach(x => { (by[x.site] ||= { n: 0, b: 0 }); by[x.site].n++; by[x.site].b += x.bytes; });
  const rows = Object.entries(by).sort((a, b) => b[1].b - a[1].b), tb = Math.max(1, ...rows.map(r => r[1].b));
  $('#bysite').innerHTML = rows.map(([s, v]) => `<div class="sbar"><span class="l">${esc(s)}</span><span class="b"><i style="width:${v.b / tb * 100}%"></i></span><span class="v">${fmt(v.b)} · ${v.n} dosya</span></div>`).join('') || '<span class="note">Veri yok.</span>';
}

// ---- sites ----
async function loadSites() {
  const sites = await inv('sites:list');
  $('#sitelist').innerHTML = sites.map(s => `<div class="site" data-id="${s.id}">
    <div class="row"><b>${esc(s.name)}</b><span class="note">${esc(s.source)} · ${s.cookies} çerez</span><span class="grow"></span>
    ${s.canLogin ? '<button data-a="open">Tarayıcıyı aç / giriş yap</button><button data-a="logout">Oturumu sil</button>' : ''}</div>
    <div class="note">${esc(s.description)}</div>
    ${s.secrets.map(x => `<div class="row"><label>${esc(x.label)} <input type="password" data-key="${esc(x.key)}" placeholder="${x.set ? '•••••• (kayıtlı)' : 'yapıştır'}" size="40"></label><button data-a="savesecret">Kaydet</button></div>`).join('')}
  </div>`).join('');
  $('#errs').textContent = (await inv('sites:errors')).map(e => `${e.file}: ${e.error}`).join('\n');
}
$('#sitelist').onclick = async e => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const id = b.closest('.site').dataset.id;
  if (b.dataset.a === 'open') inv('sites:open', id);
  if (b.dataset.a === 'logout') { await inv('sites:logout', id); loadSites(); }
  if (b.dataset.a === 'savesecret') { const i = b.parentElement.querySelector('input'); await inv('secret:set', id, i.dataset.key, i.value.trim()); toast('Kaydedildi'); loadSites(); }
};
$('#plugfolder').onclick = () => inv('sites:folder');
$('#plugreload').onclick = async () => { await inv('sites:reload'); loadSites(); };

// ---- settings ----
function renderPresets() {
  $('#presets').innerHTML = settings.presets.map(p => `<div class="site row" data-id="${p.id}"><b>${esc(p.name)}</b>
    <span class="note">${p.extract ? 'aç → ' + esc(p.extractTo) : ''} ${p.deleteArchive ? '· zip silinir' : ''}</span><span class="grow"></span><button>Sil</button></div>`).join('') || '<p class="hint">Yok.</p>';
  const cur = $('#preset').value;
  $('#preset').innerHTML = '<option value="">Yok</option>' + settings.presets.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('#preset').value = cur;
}
async function loadSettings() {
  settings = await inv('settings:get');
  const sys = await inv('sys:get');
  $('#s-dir').value = settings.downloadDir; $('#s-conc').value = settings.concurrency; $('#s-ver').textContent = 'Sürüm ' + sys.version; $('#s-upurl').value = settings.updateUrl || ''; $('#s-auto').checked = sys.autostart; $('#s-confirm').checked = settings.confirmBrowser !== false; $('#s-token').value = sys.token;
  renderPresets();
}
$('#s-pick').onclick = async () => { const d = await inv('dialog:folder'); if (d) { await inv('settings:set', { downloadDir: d }); loadSettings(); } };
$('#s-conc').onchange = () => inv('settings:set', { concurrency: +$('#s-conc').value || 2 });
$('#s-auto').onchange = () => inv('sys:autostart', $('#s-auto').checked);
$('#s-copy').onclick = async () => { await navigator.clipboard.writeText($('#s-token').value); toast('Kopyalandı'); };
$('#s-ext').onclick = () => inv('sys:extfolder');
$('#p-pick').onclick = async () => { const d = await inv('dialog:folder'); if (d) $('#p-to').value = d; };
$('#p-add').onclick = async () => {
  const name = $('#p-name').value.trim(); if (!name) return toast('Ad gerekli');
  settings.presets.push({ id: Math.random().toString(36).slice(2, 8), name, extract: $('#p-extract').checked, extractTo: $('#p-to').value.trim(), deleteArchive: $('#p-del').checked });
  await inv('settings:set', { presets: settings.presets }); $('#p-name').value = ''; renderPresets();
};
$('#presets').onclick = async e => {
  if (e.target.tagName !== 'BUTTON') return;
  const id = e.target.closest('[data-id]').dataset.id;
  settings.presets = settings.presets.filter(p => p.id !== id); await inv('settings:set', { presets: settings.presets }); renderPresets();
};

(async () => { await loadSettings(); (await inv('jobs:list')).forEach(renderJob); summary(); })();

document.addEventListener('contextmenu', e => {
  const job = e.target.closest('.job'); if (job) { e.preventDefault(); inv('ctx:job', job.dataset.id); return; }
  const h = e.target.closest('.hrow'); if (h) { e.preventDefault(); inv('ctx:hist', h.dataset.id); }
});
$('#opendir').onclick = () => inv('open:dir', $('#dir').value);
$('#hlist').addEventListener('dblclick', e => { const r = e.target.closest('.hrow'); if (r) inv('open:hist', r.dataset.id); });
$('#jobs').addEventListener('dblclick', e => { const r = e.target.closest('.job.done'); if (r) inv('jobs:open', r.dataset.id); });

// ---- browser download confirmation ----
const queue = [];
function showConfirm() {
  const c = queue[0]; $('#modal').hidden = !c; if (!c) return;
  $('#mname').textContent = c.name; $('#murl').textContent = c.url; $('#msite').textContent = c.site ? 'Site profili: ' + c.site : '';
  $('#mdir').value = c.dir; $('#mcount').textContent = queue.length > 1 ? '(+' + (queue.length - 1) + ' bekliyor)' : '';
  $('#mpreset').innerHTML = $('#preset').innerHTML; $('#mpreset').value = $('#preset').value;
}
window.api.on('confirm', c => { queue.push(c); showConfirm(); });
$('#mpick').onclick = async () => { const d = await inv('dialog:folder'); if (d) $('#mdir').value = d; };
async function answer(accept) { const c = queue.shift(); await inv('confirm:resolve', { id: c.id, accept, dir: $('#mdir').value, presetId: $('#mpreset').value }); showConfirm(); }
$('#myes').onclick = () => answer(true); $('#mno').onclick = () => answer(false);
document.addEventListener('keydown', e => { if (!$('#modal').hidden && e.key === 'Escape') answer(false); });
$('#s-confirm').onchange = () => inv('settings:set', { confirmBrowser: $('#s-confirm').checked });

// ---- updates ----
const UPD_TXT = { checking: 'Güncelleme aranıyor…', latest: 'Güncelsin.', nourl: 'Güncelleme adresi girilmemiş.', dev: 'Geliştirme sürümünde güncelleme kapalı (kurulu sürümde çalışır).', idle: '', ready: 'Güncelleme hazır, yeniden başlatılıyor…' };
function onUpdate(u) {
  $('#s-updst').textContent = u.status === 'error' ? 'Hata: ' + u.error : u.status === 'available' ? 'Yeni sürüm: ' + u.latest : u.status === 'downloading' ? 'İndiriliyor %' + (u.percent || 0) : (UPD_TXT[u.status] || '');
  const show = ['available', 'downloading', 'ready'].includes(u.status);
  $('#upd').hidden = !show;
  if (show) {
    $('#updtxt').textContent = u.status === 'available' ? 'Yeni sürüm var: ' + u.latest + ' (şu an ' + u.version + ')' : u.status === 'downloading' ? 'Güncelleme indiriliyor… %' + (u.percent || 0) : 'Güncelleme kuruluyor…';
    $('#updgo').hidden = u.status !== 'available';
  }
}
window.api.on('update', onUpdate);
$('#updgo').onclick = () => inv('update:apply');
$('#s-upcheck').onclick = async () => { await inv('settings:set', { updateUrl: $('#s-upurl').value.trim() }); inv('update:check'); };
$('#s-upurl').onchange = () => inv('settings:set', { updateUrl: $('#s-upurl').value.trim() });
inv('update:state').then(onUpdate);
