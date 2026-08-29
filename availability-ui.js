(function () {
  'use strict';

  var DATA_URL = 'availability.json';
  var recordsBySku = {};
  var currentData = null;
  var observer = null;

  function injectStyles() {
    if (document.getElementById('availability-styles')) return;
    var style = document.createElement('style');
    style.id = 'availability-styles';
    style.textContent = [
      '.avbar{background:#fff;border-bottom:1px solid var(--line,#e2e7ee);padding:10px 14px;color:var(--ink,#12181f)}',
      '.avbar-inner{max-width:1180px;margin:0 auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.avtime{font-size:13px;flex:1;min-width:180px}',
      '.avtime strong{font-weight:700;color:var(--accent,#1f3864)}',
      '.avstats{font-size:11.5px;color:var(--muted,#6b7784)}',
      '.avrefresh{border:0;border-radius:9px;background:var(--accent,#1f3864);color:#fff;padding:8px 13px;font:inherit;font-size:12.5px;font-weight:650;cursor:pointer}',
      '.avrefresh:disabled{opacity:.55;cursor:wait}',
      '.avmsg{width:100%;font-size:11.5px;color:var(--muted,#6b7784);min-height:18px}',
      '.avmsg.warn{color:#a86400}',
      '.avmissing{width:100%;font-size:11.5px;color:var(--muted,#6b7784)}',
      '.avmissing summary{cursor:pointer;color:var(--accent,#1f3864)}',
      '.avmissing ul{margin:7px 0 0;padding-left:20px}',
      '.bms-availability{margin-top:8px;padding:8px 9px;border-radius:9px;background:#eef3fb;border:1px solid #d9e3f2;display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11.5px}',
      '.bms-label{font-weight:700;color:var(--accent,#1f3864);margin-right:2px}',
      '.bms-pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#e8f6ed;color:#1e7a45;font-weight:650;white-space:nowrap}',
      '.bms-pill.full{background:#fdecea;color:#c0392b}',
      '.bms-pill.na{background:#eef1f5;color:#6b7784}',
      '.bms-meta{color:var(--muted,#6b7784);white-space:nowrap}',
      'tr .bms-availability{margin:5px 0 0;min-width:205px}',
      '@media(max-width:780px){.avbar{padding:9px 11px}.avstats{width:100%;order:3}.avrefresh{margin-left:auto}}'
    ].join('');
    document.head.appendChild(style);
  }

  function buildBar() {
    if (document.getElementById('availability-bar')) return;
    var bar = document.createElement('section');
    bar.id = 'availability-bar';
    bar.className = 'avbar';
    bar.setAttribute('aria-label', 'BMS 名額更新狀態');
    bar.innerHTML = '' +
      '<div class="avbar-inner">' +
        '<div class="avtime">最後更新：<strong id="availability-updated">載入中…</strong></div>' +
        '<div class="avstats" id="availability-stats"></div>' +
        '<button type="button" class="avrefresh" id="availability-refresh">重新載入名額</button>' +
        '<div class="avmsg" id="availability-message" aria-live="polite"></div>' +
        '<details class="avmissing" id="availability-missing" hidden><summary></summary><ul></ul></details>' +
      '</div>';
    var header = document.querySelector('header');
    if (header && header.parentNode) header.parentNode.insertBefore(bar, header.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
    document.getElementById('availability-refresh').addEventListener('click', function () {
      loadAvailability(true);
    });
  }

  function two(n) { return n < 10 ? '0' + n : String(n); }

  function formatUpdated(value) {
    if (!value) return '尚無資料';
    var d = new Date(value);
    if (isNaN(d.getTime())) return value;
    var now = new Date();
    var sameDay = d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    var clock = two(d.getHours()) + ':' + two(d.getMinutes());
    return sameDay ? '今天 ' + clock : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + clock;
  }

  function availabilityMarkup(r) {
    var regFull = r.registrationRemaining <= 0 || r.registrationExploded;
    var pending = /^pending_|^metric_|^lesson_/.test(r.availabilityStatus || '');
    var noLesson = !pending && (r.currentLesson == null || r.trialRemaining == null);
    var trialFull = !noLesson && (r.trialRemaining <= 0 || r.trialFull);
    var lesson = r.currentLesson == null ? '本講次' : 'L' + r.currentLesson;
    return '' +
      '<span class="bms-label">BMS</span>' +
      '<span class="bms-pill' + (regFull ? ' full' : '') + '">' +
        (regFull ? '報名已滿' : '可報名 ' + r.registrationRemaining) +
      '</span>' +
      '<span class="bms-pill' + ((pending || noLesson) ? ' na' : (trialFull ? ' full' : '')) + '">' +
        (pending ? lesson + ' 試聽名額待更新' : (noLesson ? '目前無課次' : (trialFull ? lesson + ' 試聽已滿' : lesson + ' 可試聽 ' + r.trialRemaining))) +
      '</span>' +
      (r.classId == null ? '' : '<span class="bms-meta">Class ' + r.classId + '</span>');
  }

  function decorateCards() {
    if (!currentData) return;
    var matched = {};
    var cards = document.querySelectorAll('.r[data-sku]');
    Array.prototype.forEach.call(cards, function (card) {
      var sku = String(card.getAttribute('data-sku') || '');
      var r = recordsBySku[sku];
      var old = card.querySelector('.bms-availability');
      if (!r) { if (old) old.remove(); return; }
      matched[sku] = true;
      var box = old || document.createElement('div');
      box.className = 'bms-availability';
      if (box.getAttribute('data-bms-key') !== String(r.classId) + ':' + r.registrationRemaining + ':' + r.trialRemaining + ':' + r.currentLesson) {
        box.setAttribute('data-bms-key', String(r.classId) + ':' + r.registrationRemaining + ':' + r.trialRemaining + ':' + r.currentLesson);
        box.innerHTML = availabilityMarkup(r);
      }
      if (!old) {
        var ft = card.querySelector('.ft');
        if (ft && ft.parentNode) ft.parentNode.insertBefore(box, ft.nextSibling);
        else card.appendChild(box);
      }
    });

    var rows = document.querySelectorAll('tbody tr');
    Array.prototype.forEach.call(rows, function (row) {
      var skuCell = row.querySelector('td.sku');
      if (!skuCell) return;
      var sku = String(skuCell.textContent || '').trim();
      var r = recordsBySku[sku];
      var old = row.querySelector('.bms-availability');
      if (!r) { if (old) old.remove(); return; }
      matched[sku] = true;
      var box = old || document.createElement('div');
      box.className = 'bms-availability';
      if (box.getAttribute('data-bms-key') !== String(r.classId) + ':' + r.registrationRemaining + ':' + r.trialRemaining + ':' + r.currentLesson) {
        box.setAttribute('data-bms-key', String(r.classId) + ':' + r.registrationRemaining + ':' + r.trialRemaining + ':' + r.currentLesson);
        box.innerHTML = availabilityMarkup(r);
      }
      if (!old) {
        var statusCell = row.querySelector('td[data-l="Status"],td[data-l="狀態"]') || skuCell;
        statusCell.appendChild(box);
      }
    });

    renderMissing(matched);
  }

  function renderMissing(matched) {
    var details = document.getElementById('availability-missing');
    if (!details || !currentData) return;
    var known = matched;
    if (window.ROWS && Array.isArray(window.ROWS)) {
      known = {};
      window.ROWS.forEach(function (r) { known[String(r.sku)] = true; });
    }
    var missing = currentData.records.filter(function (r) { return !known[String(r.skuId)]; });
    if (!missing.length) { details.hidden = true; return; }
    details.hidden = false;
    details.querySelector('summary').textContent = missing.length + ' 個 BMS 班級未出現在官網排課總表（仍保留名額）';
    details.querySelector('ul').innerHTML = missing.map(function (r) {
      var trialText = r.currentLesson == null || r.trialRemaining == null ? '目前無課次' :
        'L' + r.currentLesson + ' 可試聽 ' + r.trialRemaining;
      return '<li>' + r.course + ' · ' + r.teacher + ' · ' + r.timePT +
        ' · 可報名 ' + r.registrationRemaining + ' · ' + trialText + ' · Class ' + r.classId + '</li>';
    }).join('');
  }

  function applyData(data, manual) {
    if (!data || !Array.isArray(data.records)) throw new Error('名額資料格式不正確');
    currentData = data;
    recordsBySku = {};
    data.records.forEach(function (r) { recordsBySku[String(r.skuId)] = r; });
    document.getElementById('availability-updated').textContent = formatUpdated(data.updatedAt || data.asOfDate);
    var trialOpen = data.records.filter(function (r) { return r.trialRemaining > 0 && !r.trialFull; }).length;
    var regOpen = data.records.filter(function (r) { return r.registrationRemaining > 0 && !r.registrationExploded; }).length;
    var trialPending = data.records.filter(function (r) { return r.trialRemaining == null; }).length;
    document.getElementById('availability-stats').textContent =
      data.records.length + ' 班 · 可試聽 ' + trialOpen + ' · 待更新 ' + trialPending + ' · 可報名 ' + regOpen;
    var msg = document.getElementById('availability-message');
    var age = data.updatedAt ? Date.now() - new Date(data.updatedAt).getTime() : 0;
    if (age > 6 * 60 * 60 * 1000) {
      msg.className = 'avmsg warn';
      msg.textContent = '資料超過 6 小時，可能尚未同步；請確認這台 Mac 的本機更新工作是否正常。';
    } else {
      msg.className = 'avmsg';
      msg.textContent = manual ? '已重新載入網站上最新發布的名額。' : 'BMS 由本機更新工作每四小時同步一次。';
    }
    decorateCards();
    if (!observer) {
      observer = new MutationObserver(function () { decorateCards(); });
      var target = document.getElementById('tb');
      if (target) observer.observe(target, { childList: true });
    }
  }

  function loadAvailability(manual) {
    var button = document.getElementById('availability-refresh');
    var msg = document.getElementById('availability-message');
    if (button) { button.disabled = true; button.textContent = '更新中…'; }
    if (msg && manual) { msg.className = 'avmsg'; msg.textContent = '正在檢查最新資料…'; }
    fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (data) { applyData(data, manual); })
      .catch(function () {
        if (msg) { msg.className = 'avmsg warn'; msg.textContent = '暫時無法讀取名額，畫面保留上一版資料。'; }
      })
      .then(function () {
        if (button) { button.disabled = false; button.textContent = '重新載入名額'; }
      });
  }

  function start() {
    injectStyles();
    buildBar();
    loadAvailability(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
