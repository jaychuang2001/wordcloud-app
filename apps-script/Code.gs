/**
 * 點亮「心」光 文字雲 — Google 試算表後端（Apps Script）
 *
 * 用法：
 * 1. 建立（或打開）一份你自己的 Google 試算表。
 * 2. 擴充功能 → Apps Script，把這整份程式貼上（取代原本內容）並儲存。
 * 3. 回到試算表重新整理，選單會出現「點亮「心」光 → 設定主辦密碼」，按它輸入密碼
 *    （第一次會要求授權）。也可以改在 Apps Script 的專案設定 → 指令碼屬性新增 HOST_PASSWORD。
 * 4. 部署 → 新增部署作業 → 類型選「網頁應用程式」
 *      執行身分：我
 *      誰可以存取：所有人
 *    部署後複製「網頁應用程式網址」（結尾是 /exec），貼到網站主辦方頁的「試算表連線」。
 * 5. 之後改了這份程式，要「管理部署作業 → 編輯 → 新版本」才會生效。
 *
 * 資料放哪：
 *   「設定」工作表：A1 = 活動設定（JSON），B1 = 主題與工作表的對照。
 *   每個主題一張工作表（名稱：編號｜主題名稱），欄位：時間、詞彙。
 */

var BUILT_IN_BLOCKLIST = [
  '幹你娘', '幹您娘', '靠北', '白痴', '智障', '去死', '廢物', '垃圾人', '婊子', '賤人',
  '他媽的', '媽的', 'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'retard', 'nigger'
];
var CONFIG_SHEET = '設定';
var MAX_RECORDS = 5000;
var MAX_WORD = 200;
var MAX_TOPICS = 12;

/* --------------------------- 試算表選單 --------------------------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('點亮「心」光')
    .addItem('設定主辦密碼', 'setHostPassword')
    .addItem('部署說明', 'showSetupHelp')
    .addToUi();
}

function setHostPassword() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('設定主辦密碼', '請輸入新的主辦密碼（至少 4 個字元）。\n用於網站的同步、刪除主題、清空資料等管理動作。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var pw = res.getResponseText().trim();
  if (pw.length < 4) {
    ui.alert('密碼至少需要 4 個字元，未變更。');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('HOST_PASSWORD', pw);
  ui.alert('主辦密碼已設定。');
}

function showSetupHelp() {
  SpreadsheetApp.getUi().alert(
    '部署步驟',
    '1. 回到 Apps Script 編輯器（擴充功能 → Apps Script）。\n' +
    '2. 右上角「部署」→「新增部署作業」。\n' +
    '3. 類型選「網頁應用程式」，執行身分選「我」，誰可以存取選「所有人」。\n' +
    '4. 按「部署」並完成授權，複製「網頁應用程式網址」（結尾是 /exec）。\n' +
    '5. 貼到網站主辦方頁的「Google 試算表連線」，按「連線並測試」。\n\n' +
    '之後如果修改了程式，需要「管理部署作業 → 編輯 → 新版本」才會生效。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function doGet() {
  return json_({ ok: true, service: 'wordcloud-sheet-backend' });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (req.action) {
      case 'ping': return json_({ ok: true });
      case 'verify': return json_({ ok: checkPassword_(req.password) });
      case 'getConfig': return json_({ ok: true, config: readConfig_() });
      case 'setConfig': return setConfig_(req);
      case 'getData': return getData_(req);
      case 'getSummary': return getSummary_(req);
      case 'submit': return submit_(req);
      case 'replaceData': return replaceData_(req);
      case 'deleteTopic': return deleteTopic_(req);
      default: return json_({ ok: false, reason: 'bad_action' });
    }
  } catch (err) {
    return json_({ ok: false, reason: 'error', message: String(err) });
  }
}

/* ------------------------------ helpers ------------------------------ */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function checkPassword_(pw) {
  var expected = PropertiesService.getScriptProperties().getProperty('HOST_PASSWORD');
  return !!expected && String(pw || '') === expected;
}

function needPassword_(req) {
  var expected = PropertiesService.getScriptProperties().getProperty('HOST_PASSWORD');
  if (!expected) return json_({ ok: false, reason: 'password_not_set' });
  if (String(req.password || '') !== expected) return json_({ ok: false, reason: 'bad_password' });
  return null;
}

function configSheet_() {
  var sh = ss_().getSheetByName(CONFIG_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(CONFIG_SHEET);
    sh.getRange('A1').setNumberFormat('@');
    sh.getRange('B1').setNumberFormat('@');
  }
  return sh;
}

function readConfig_() {
  var raw = configSheet_().getRange('A1').getValue();
  if (!raw) return null;
  try { return JSON.parse(String(raw)); } catch (e) { return null; }
}

function readMap_() {
  var raw = configSheet_().getRange('B1').getValue();
  if (!raw) return {};
  try { return JSON.parse(String(raw)) || {}; } catch (e) { return {}; }
}

function writeMap_(map) {
  configSheet_().getRange('B1').setValue(JSON.stringify(map));
}

function sheetTitle_(id, name) {
  var clean = String(name || '').replace(/[\[\]\*\/\\\?\:]/g, '').trim();
  var t = id + '｜' + (clean || '主題 ' + id);
  return t.slice(0, 90);
}

function findSheetById_(gid) {
  var sheets = ss_().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) return sheets[i];
  }
  return null;
}

/** Returns (creating if needed) the worksheet for a topic id. */
function topicSheet_(id, name) {
  var map = readMap_();
  var sh = map[id] !== undefined ? findSheetById_(map[id]) : null;
  var title = sheetTitle_(id, name);
  if (!sh) {
    var existing = ss_().getSheetByName(title);
    sh = existing || ss_().insertSheet(title);
    if (!existing) {
      sh.getRange(1, 1, 1, 2).setValues([['時間', '詞彙']]).setFontWeight('bold');
      sh.setFrozenRows(1);
      sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat('@'); // plain text: never treated as a formula
    }
    map[id] = sh.getSheetId();
    writeMap_(map);
  } else if (name !== undefined && sh.getName() !== title && !ss_().getSheetByName(title)) {
    sh.setName(title);
  }
  return sh;
}

function str_(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function sanitizeConfig_(c) {
  if (!c || typeof c !== 'object') return null;
  var room = str_(c.room, 24);
  if (!room || !Array.isArray(c.topics) || c.topics.length < 1 || c.topics.length > MAX_TOPICS) return null;
  var topics = [];
  for (var i = 0; i < c.topics.length; i++) {
    var t = c.topics[i] || {};
    var id = str_(t.id, 16);
    if (!id) return null;
    var n = Number(t.maxLength);
    topics.push({
      id: id,
      name: str_(t.name, 40) || ('主題 ' + id),
      maxLength: isFinite(n) && n >= 1 ? Math.min(Math.floor(n), MAX_WORD) : undefined,
      mode: t.mode === 'shape' || t.mode === 'board' ? t.mode : 'cloud',
      enabled: t.enabled !== false
    });
  }
  var extra = [];
  if (Array.isArray(c.extraBlocklist)) {
    for (var j = 0; j < c.extraBlocklist.length && extra.length < 300; j++) {
      if (typeof c.extraBlocklist[j] === 'string') extra.push(c.extraBlocklist[j].slice(0, 40));
    }
  }
  return { room: room, topics: topics, filterEnabled: c.filterEnabled !== false, extraBlocklist: extra };
}

function normalizeWord_(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, MAX_WORD)
    .trim();
}

function isBlocked_(word, list) {
  var lower = word.toLowerCase();
  for (var i = 0; i < list.length; i++) {
    if (list[i] && lower.indexOf(String(list[i]).toLowerCase()) !== -1) return true;
  }
  return false;
}

function topicName_(config, id) {
  for (var i = 0; i < config.topics.length; i++) if (config.topics[i].id === id) return config.topics[i].name;
  return undefined;
}

/** Reads all submissions of a topic: [{w, t}] oldest first (last MAX_RECORDS). */
function readRows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var start = Math.max(2, last - MAX_RECORDS + 1);
  var values = sh.getRange(start, 1, last - start + 1, 2).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var w = values[i][1];
    if (w === '' || w === null) continue;
    var t = values[i][0];
    out.push({ w: String(w), t: t instanceof Date ? t.getTime() : Number(t) || 0 });
  }
  return out;
}

/* ------------------------------ actions ------------------------------ */

function setConfig_(req) {
  var denied = needPassword_(req);
  if (denied) return denied;
  var config = sanitizeConfig_(req.config);
  if (!config) return json_({ ok: false, reason: 'bad_config' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    configSheet_().getRange('A1').setValue(JSON.stringify(config));
    for (var i = 0; i < config.topics.length; i++) {
      topicSheet_(config.topics[i].id, config.topics[i].name); // create / rename worksheets
    }
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

function getData_(req) {
  var config = readConfig_();
  var id = str_(req.topicId, 16);
  if (!config || !id) return json_({ ok: true, data: { counts: {}, records: [] } });
  var name = topicName_(config, id);
  if (name === undefined) return json_({ ok: true, data: { counts: {}, records: [] } });
  var records = readRows_(topicSheet_(id, name));
  var counts = {};
  for (var i = 0; i < records.length; i++) counts[records[i].w] = (counts[records[i].w] || 0) + 1;
  return json_({ ok: true, data: { counts: counts, records: records } });
}

function getSummary_(req) {
  var config = readConfig_();
  var ids = Array.isArray(req.topicIds) ? req.topicIds : [];
  var counts = {};
  for (var i = 0; i < ids.length; i++) {
    var id = str_(ids[i], 16);
    var name = config ? topicName_(config, id) : undefined;
    if (name === undefined) { counts[id] = 0; continue; }
    var rows = readRows_(topicSheet_(id, name));
    var seen = {};
    var n = 0;
    for (var j = 0; j < rows.length; j++) if (!seen[rows[j].w]) { seen[rows[j].w] = 1; n++; }
    counts[id] = n;
  }
  return json_({ ok: true, counts: counts });
}

function submit_(req) {
  var config = readConfig_();
  if (!config) return json_({ ok: false, reason: 'no_config' });
  if (str_(req.room, 24) !== config.room) return json_({ ok: false, reason: 'room_mismatch' });
  var id = str_(req.topicId, 16);
  var topic = null;
  for (var i = 0; i < config.topics.length; i++) if (config.topics[i].id === id) topic = config.topics[i];
  if (!topic || topic.enabled === false) return json_({ ok: false, reason: 'topic_disabled' });

  var words = [];
  var incoming = Array.isArray(req.words) ? req.words.slice(0, 3) : [];
  for (var k = 0; k < incoming.length; k++) {
    var w = normalizeWord_(incoming[k]);
    if (w) words.push(w);
  }
  if (words.length === 0) return json_({ ok: false, reason: 'empty' });
  if (config.filterEnabled) {
    var list = BUILT_IN_BLOCKLIST.concat(config.extraBlocklist || []);
    for (var b = 0; b < words.length; b++) {
      if (isBlocked_(words[b], list)) return json_({ ok: false, reason: 'blocked', word: words[b] });
    }
  }

  var ts = Number(req.ts) || Date.now();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = topicSheet_(id, topic.name);
    var rows = [];
    for (var r = 0; r < words.length; r++) rows.push([new Date(ts), words[r]]);
    var first = sh.getLastRow() + 1;
    if (first + rows.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 200);
    sh.getRange(first, 2, rows.length, 1).setNumberFormat('@');
    sh.getRange(first, 1, rows.length, 2).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true, words: words });
}

function replaceData_(req) {
  var denied = needPassword_(req);
  if (denied) return denied;
  var config = readConfig_();
  var id = str_(req.topicId, 16);
  var name = config ? topicName_(config, id) : undefined;
  if (name === undefined) return json_({ ok: false, reason: 'bad_input' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = topicSheet_(id, name);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
    var data = req.data;
    var rows = [];
    var recorded = {};
    if (data && Array.isArray(data.records)) {
      var recs = data.records.slice(-MAX_RECORDS);
      for (var i = 0; i < recs.length; i++) {
        var w = normalizeWord_(recs[i].w);
        if (!w) continue;
        rows.push([new Date(Number(recs[i].t) || Date.now()), w]);
        recorded[w] = (recorded[w] || 0) + 1;
      }
    }
    if (data && data.counts) {
      // Only per-word totals are stored as rows, so top up any word whose
      // count is higher than its individual records (e.g. an old CSV import).
      var now = Date.now();
      for (var word in data.counts) {
        var cw = normalizeWord_(word);
        if (!cw) continue;
        var missing = Math.min(Math.floor(Number(data.counts[word])) || 0, 500) - (recorded[cw] || 0);
        for (var c = 0; c < missing && rows.length < MAX_RECORDS; c++) rows.push([new Date(now), cw]);
      }
    }
    if (rows.length > 0) {
      if (1 + rows.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 100);
      sh.getRange(2, 2, rows.length, 1).setNumberFormat('@');
      sh.getRange(2, 1, rows.length, 2).setValues(rows);
    }
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

function deleteTopic_(req) {
  var denied = needPassword_(req);
  if (denied) return denied;
  var id = str_(req.topicId, 16);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var map = readMap_();
    if (map[id] !== undefined) {
      var sh = findSheetById_(map[id]);
      if (sh && ss_().getSheets().length > 1) ss_().deleteSheet(sh);
      delete map[id];
      writeMap_(map);
    }
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}
