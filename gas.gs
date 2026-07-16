var FOLDER_NAME = 'fx-weekly-shots';
var DATA_FILE = 'rb-data.json';
var KEY = 'rb-x7k3-up';
var TZ = 'Asia/Tokyo';
var L_EQUITY = '\u6642\u4fa1\u8a55\u4fa1\u7dcf\u984d';
var L_PL = '\u8a55\u4fa1\u640d\u76ca';
var L_YORYOKU = '\u4f59\u529b';
var L_MR = '\u8a3c\u62e0\u91d1\u7dad\u6301\u7387';

function folder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}
function loadData_() {
  var it = folder_().getFilesByName(DATA_FILE);
  if (it.hasNext()) {
    try { return JSON.parse(it.next().getBlob().getDataAsString('UTF-8')); } catch (e) {}
  }
  return null;
}
function saveData_(d) {
  var f = folder_(), it = f.getFilesByName(DATA_FILE), s = JSON.stringify(d);
  if (it.hasNext()) { it.next().setContent(s); } else { f.createFile(DATA_FILE, s, 'application/json'); }
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  var d = loadData_() || {_ts: 0, profiles: {}};
  return out_(d);
}
function ocr_(fileId) {
  var doc = Drive.Files.copy({mimeType: 'application/vnd.google-apps.document', name: 'tmp-ocr'}, fileId, {ocrLanguage: 'ja'});
  var txt = '';
  try {
    try {
      var out = Drive.Files.export(doc.id, 'text/plain', {alt: 'media'});
      if (out == null) txt = '';
      else if (typeof out === 'string') txt = out;
      else if (out.getDataAsString) txt = out.getDataAsString('UTF-8');
      else if (out.getBlob) txt = out.getBlob().getDataAsString('UTF-8');
      else txt = String(out);
    } catch (ex) {
      var msg = String(ex && ex.message ? ex.message : ex);
      var mk = msg.indexOf('\u30e1\u30c3\u30bb\u30fc\u30b8: ');
      txt = fixEnc_(mk >= 0 ? msg.slice(mk + 7) : msg);
    }
  } finally {
    try { DriveApp.getFileById(doc.id).setTrashed(true); } catch (e2) {}
  }
  return txt;
}
function fixEnc_(s) {
  var bytes = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c > 255) break;
    bytes.push(c > 127 ? c - 256 : c);
  }
  if (!bytes.length) return s;
  try { return Utilities.newBlob(bytes).getDataAsString('UTF-8'); } catch (e) { return s; }
}
function num_(s) {
  if (s == null) return null;
  s = String(s).replace(/[,\uff0c]/g, '').replace(/[\u2212\u2010\u2011]/g, '-');
  var v = parseFloat(s);
  return isNaN(v) ? null : v;
}
function parseHome_(t) {
  function grab(re) { var m = t.match(re); return m ? num_(m[1]) : null; }
  var NUM = '([\\-\\u2212]?[\\d,\\uff0c]+)';
  return {
    equity: grab(new RegExp(L_EQUITY + '[\\s\\S]{0,24}?' + NUM + '\\s*\u5186')),
    pl: grab(new RegExp(L_PL + '[\\s\\S]{0,16}?' + NUM + '\\s*\u5186')),
    yoryoku: grab(new RegExp(L_YORYOKU + '[\\s\\S]{0,16}?' + NUM + '\\s*\u5186')),
    mr: grab(new RegExp(L_MR + '[\\s\\S]{0,16}?([\\d,\\uff0c.]+)\\s*%'))
  };
}
function parsePos_(t) {
  var rows = [];
  var re = /TRY\s*\/\s*JPY[\s\S]{0,14}?(\d{1,3})\s+(\d\.\d{3})\s+([\-\u2212]?[\d,\uff0c]+)\s+(\d{2})\/(\d{2})\/(\d{2})\s+\d{1,2}:\d{2}\s+(\d+)\s+(\d\.\d{3})\s+([\d,\uff0c]+)/g;
  var m;
  while ((m = re.exec(t)) !== null) {
    rows.push({ lots: num_(m[1]), rate: num_(m[2]), pl: num_(m[3]), date: '20' + m[4] + '-' + m[5] + '-' + m[6], sw: num_(m[9]) });
  }
  return rows;
}
function sum_(pos) {
  if (!pos || !pos.length) return null;
  var L = 0, S = 0, P = 0, W = 0;
  for (var i = 0; i < pos.length; i++) { L += pos[i].lots; S += pos[i].sw; P += pos[i].pl; W += pos[i].lots * pos[i].rate; }
  return { lots: L, sw: S, pl: P, avg: L > 0 ? W / L : 0 };
}
function check_(prof, home, pos) {
  if (!home || home.equity == null || home.pl == null) return { pass: false, reason: 'home-unreadable' };
  if (!pos || !pos.length) return { pass: false, reason: 'positions-unreadable' };
  var s = sum_(pos);
  if (s.lots < 1 || s.lots > 999) return { pass: false, reason: 'lots-out-of-range' };
  if (Math.abs(home.pl - s.pl) > 2) return { pass: false, reason: 'pl-mismatch home=' + home.pl + ' pos=' + s.pl };
  var logs = prof.logs || [];
  var prev = null;
  for (var i = logs.length - 1; i >= 0; i--) { if (num_(logs[i].balance)) { prev = logs[i]; break; } }
  var prevSw = prof.inputs ? (num_(prof.inputs.actual) || 0) : 0;
  var dep = 0;
  if (prev) {
    var delta = home.equity - (num_(prev.balance) || 0);
    var expect = (s.sw - prevSw) + (home.pl - (num_(prev.pl) || 0));
    var gap = delta - expect;
    if (Math.abs(gap) > 5) {
      var rounded = Math.round(gap / 1000) * 1000;
      if (gap > 0 && gap <= 3000000 && Math.abs(gap - rounded) <= 5) { dep = rounded; }
      else return { pass: false, reason: 'equity-mismatch gap=' + Math.round(gap) };
    }
    if (s.sw + 1 < prevSw && s.lots >= (num_(prev.lots) || 0)) return { pass: false, reason: 'swap-decreased' };
  }
  return { pass: true, dep: dep, s: s };
}
function apply_(d, who, home, pos, verdict) {
  var prof = d.profiles[who];
  var s = verdict.s;
  var logs = prof.logs || (prof.logs = []);
  var prev = logs.length ? logs[logs.length - 1] : { week: -1, spread: 0 };
  var prevSw = prof.inputs ? (num_(prof.inputs.actual) || 0) : 0;
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  logs.push({
    week: (num_(prev.week) == null ? -1 : num_(prev.week)) + 1,
    date: today,
    rate: Math.round(s.avg * 1000) / 1000,
    spread: num_(prev.spread) || 0,
    lots: s.lots,
    swap: Math.max(0, s.sw - prevSw),
    deposit: verdict.dep || 0,
    withdraw: 0,
    balance: home.equity,
    pl: home.pl,
    memo: 'AUTO-OCR' + (verdict.dep ? ' DEP+' + verdict.dep : '')
  });
  prof.inputs = prof.inputs || {};
  prof.inputs.actual = String(s.sw);
  prof.inputs.total = String(home.equity);
  var bs = pos.slice().sort(function(a, b) { return a.date < b.date ? -1 : 1; });
  prof.batches = bs.map(function(r) { return { date: r.date, rate: r.rate, lots: r.lots }; });
}
function pipe_(d, who, fileRefs) {
  var texts = [];
  for (var i = 0; i < fileRefs.length; i++) {
    try { texts.push(ocr_(fileRefs[i].id)); } catch (e) { texts.push(''); }
  }
  var home = null, pos = null;
  for (var k = 0; k < texts.length; k++) {
    if (!home && texts[k].indexOf(L_EQUITY) >= 0) home = parseHome_(texts[k]);
    if (!pos) { var rws = parsePos_(texts[k]); if (rws.length) pos = rws; }
  }
  var names = fileRefs.map(function(f) { return f.name; });
  var verdict = check_(d.profiles[who], home, pos);
  d.audit = d.audit || [];
  if (verdict.pass) {
    apply_(d, who, home, pos, verdict);
    d.audit.push({ who: who, ts: Date.now(), files: names, result: 'auto' });
  } else {
    d.pending = d.pending || [];
    d.pending.push({ who: who, ts: Date.now(), files: names, reason: verdict.reason, home: home, posSummary: sum_(pos) });
    d.audit.push({ who: who, ts: Date.now(), files: names, result: 'pending', reason: verdict.reason });
  }
  if (d.audit.length > 30) d.audit = d.audit.slice(-30);
  d._ts = Date.now();
  saveData_(d);
  return verdict;
}
function doPost(e) {
  var res = { ok: false };
  try {
    var p = JSON.parse(e.postData.contents);
    if (p.key !== KEY) { res.err = 'bad key'; return out_(res); }
    if (p.action === 'update') {
      saveData_(p.data);
      res.ok = true; res.updated = true;
      return out_(res);
    }
    if (p.action === 'ocrtext') {
      var dbgIt = folder_().getFilesByName(p.file || '');
      if (!dbgIt.hasNext()) { res.err = 'file-not-found'; return out_(res); }
      res.ok = true;
      res.text = ocr_(dbgIt.next().getId()).slice(0, 4000);
      return out_(res);
    }
    var who = (p.who === 'chichi' || p.who === 'haha' || p.who === 'honnin') ? p.who : 'honnin';
    var d = loadData_();
    if (!d || !d.profiles || !d.profiles[who]) { res.err = 'no-data-store'; return out_(res); }
    var fileRefs = [];
    if (p.action === 'process') {
      var f = folder_();
      for (var i = 0; i < (p.files || []).length; i++) {
        var it = f.getFilesByName(p.files[i]);
        if (it.hasNext()) { var ff = it.next(); fileRefs.push({ id: ff.getId(), name: ff.getName() }); }
      }
      if (!fileRefs.length) { res.err = 'files-not-found'; return out_(res); }
    } else {
      var imgs = p.images || (p.data ? [{ filename: p.filename, mime: p.mime, data: p.data }] : []);
      if (!imgs.length) { res.err = 'no images'; return out_(res); }
      var fo = folder_();
      for (var j = 0; j < imgs.length; j++) {
        var blob = Utilities.newBlob(Utilities.base64Decode(imgs[j].data), imgs[j].mime || 'image/jpeg', imgs[j].filename || ('img_' + Date.now() + '_' + j + '.jpg'));
        var file = fo.createFile(blob);
        fileRefs.push({ id: file.getId(), name: file.getName() });
      }
    }
    res.ok = true;
    res.saved = fileRefs.map(function(x) { return x.name; });
    var verdict = pipe_(d, who, fileRefs);
    res.reflected = !!verdict.pass;
    if (!verdict.pass) res.reason = verdict.reason;
    if (verdict.dep) res.deposit = verdict.dep;
  } catch (err) { res.err = String(err); }
  return out_(res);
}
