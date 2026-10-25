(function(){
  var API = 'https://api.github.com';
  var OLD_SLUGS = {"LET'S FLOW":"let's-flow",'ALONE':'aione','OVADOSE':'overdose','GIVE ME LOVE':'give-me-love','JIGGY':'jiggy-2','TIME':'time-new','TOUCH YOUR BODY':'touch-you-body-new-2','WINE':'wine-2'};
  var MAX_BYTES = 20*1024*1024;
  var TITLE_RE = /^[A-Z0-9][A-Z0-9 '&.,!+()_-]{0,59}$/;
  var $ = function(s){ return document.querySelector(s); };
  function slug(t){ return t.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
  function guessTitle(fn){ return fn.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim().toUpperCase(); }
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(_){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(_){} }
  function lsDel(k){ try{ localStorage.removeItem(k); }catch(_){} }
  function say(el,text,cls){ el.textContent = text||''; el.className = 'msg'+(cls?' '+cls:''); }

  var S = { sel:Object.create(null), lastSel:null, vis:[], meta:{}, metaLoaded:{}, metaText:null, metaBase:'', pr:null, prBase:'', prText:null, prOpen:{}, repo:'', branch:'main', token:'', original:[], originalText:'', list:[], audio:{}, audioLower:{}, queue:[], removed:{}, files:{}, delAudio:{}, order:null };
  // S.list = working order of titles. S.files[title] = File for new/replaced previews. S.removed[title] = true.

  function gh(method,path,body,accept){
    var h = { 'Authorization':'Bearer '+S.token, 'Accept': accept || 'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28' };
    if(body) h['Content-Type'] = 'application/json';
    return fetch(API+path,{method:method,headers:h,body:body?JSON.stringify(body):undefined,cache:'no-store'}).then(function(r){
      if(r.ok) return accept && /raw/.test(accept) ? r.text() : r.json();
      return r.text().then(function(t){
        var m = ''; try{ m = JSON.parse(t).message || ''; }catch(_){}
        var e = new Error(r.status===401 ? 'GitHub rejected the token (expired or wrong).' :
          r.status===403 ? 'GitHub refused: '+(m||'the token may not allow writing to this repository.') :
          r.status===404 ? 'Not found. Check the repository name, branch and that the token has access to it.' : 'GitHub error '+r.status+(m?': '+m:''));
        e.status = r.status; throw e;
      });
    });
  }
  function repoPath(p){ return '/repos/'+S.repo+p; }

  /* ---- prices ---- */
  var TIERS = ['MP3','WAV','Unlimited'];
  var DEF_PRICES = [30000,80000,160000,250000];
  var SYM = {NGN:'₦',USD:'$',GBP:'£',EUR:'€'};
  var CUR_NAME = {NGN:'naira',USD:'US dollars',GBP:'British pounds',EUR:'euros'};
  S.prBad = {};
  function defaultPr(){ return {cur:'NGN',rate:1,live:false,tiers:DEF_PRICES.slice(0,3),offer:{min:400,max:2000},beats:{}}; }
  function parseMoney(str,cur){
    str = String(str).replace(/[,\s]/g,'');
    if(!/^\d+(\.\d{1,2})?$/.test(str)) return NaN;
    var v = parseFloat(str); if(cur==='NGN' && v%1) return NaN;
    return v>0 && v<=1e9 ? v : NaN;
  }
  function fmt(v,cur){ return v==null ? '' : (cur==='NGN' ? Math.round(v).toLocaleString('en-NG') : v.toLocaleString('en-US',{minimumFractionDigits:v%1?2:0,maximumFractionDigits:2})); }
  function prFromJSON(d){
    var o = defaultPr(); if(!d || typeof d!=='object') return o;
    if(d.offer && +d.offer.min>0 && +d.offer.max>+d.offer.min) o.offer = {min:+d.offer.min,max:+d.offer.max};
    var cur = ['NGN','USD','GBP','EUR'].indexOf(d.currency)>=0 ? d.currency : null; if(!cur) return o;
    var rate = cur==='NGN' ? 1 : +d.rate; if(!(rate>0)) return o;
    if(!Array.isArray(d.prices) || d.prices.length<3 || !d.prices.slice(0,3).every(function(v){ return typeof v==='number' && v>0; })) return o;
    o.cur = cur; o.rate = rate; o.live = cur!=='NGN' && d.live===true; o.tiers = d.prices.slice(0,3);
    if(d.beats && typeof d.beats==='object') Object.keys(d.beats).forEach(function(k){
      var m = {}, src = d.beats[k]; if(!src || typeof src!=='object') return;
      for(var j=0;j<3;j++) if(typeof src[j]==='number' && src[j]>0) m[j] = src[j];
      if(Object.keys(m).length) o.beats[k] = m;
    });
    return o;
  }
  function liveSlugs(){ return S.list.filter(function(t){ return !S.removed[t]; }).map(slug); }
  function prJSON(live){
    var pr = S.pr, out = {currency:pr.cur};
    if(pr.cur!=='NGN'){ out.live = !!pr.live; out.rate = pr.rate; }
    out.prices = pr.tiers.slice(0,3); out.offer = {min:pr.offer.min,max:pr.offer.max}; out.beats = {};
    Object.keys(pr.beats).sort().forEach(function(k){
      if(live && live.indexOf(k)<0) return;
      var m = pr.beats[k], r = {}; for(var j=0;j<3;j++) if(m[j]!=null) r[j] = m[j];
      if(Object.keys(r).length) out.beats[k] = r;
    });
    return JSON.stringify(out,null,2)+'\n';
  }
  function priceChanged(){ return !!S.pr && prJSON(liveSlugs()) !== S.prBase; }
  function prProblem(){
    var pr = S.pr;
    if(!pr.tiers.every(function(v){ return v>0; })) return 'One of the prices for all beats is empty or not a valid number.';
    if(pr.cur!=='NGN' && !(pr.rate>0)) return 'Enter the naira rate for '+SYM[pr.cur]+'1.';
    if(!(pr.offer.min>0 && pr.offer.max>pr.offer.min)) return 'The offer range needs a lowest amount above 0 and a highest amount above the lowest.';
    if(Object.keys(S.prBad).length) return 'One of the individual beat details is not valid. Fix the red box.';
    return '';
  }
  function fetchRate(code){
    var lc = code.toLowerCase();
    function a(){ return fetch('https://open.er-api.com/v6/latest/NGN',{cache:'no-store'}).then(function(r){ return r.json(); }).then(function(d){ var v = d && d.rates && d.rates[code]; if(!(v>0)) throw 0; return Math.round(1/v); }); }
    function b(){ return fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/ngn.json',{cache:'no-store'}).then(function(r){ return r.json(); }).then(function(d){ var v = d && d.ngn && d.ngn[lc]; if(!(v>0)) throw 0; return Math.round(1/v); }); }
    return a().catch(b);
  }
  function customCount(){ var live = liveSlugs(); return Object.keys(S.pr.beats).filter(function(k){ return live.indexOf(k)>=0 && Object.keys(S.pr.beats[k]).length; }).length; }
  function updateEq(){
    var pr = S.pr;
    document.querySelectorAll('#prTiers .eq').forEach(function(e,k){
      e.textContent = pr.cur!=='NGN' && pr.tiers[k]>0 && pr.rate>0 ? '≈ ₦'+Math.round(pr.tiers[k]*pr.rate).toLocaleString('en-NG')+' in naira' : '';
    });
    var n = customCount();
    $('#prCustomN').textContent = n ? n+' beat'+(n>1?'s have':' has')+' their own price' : '';
    $('#prClear').disabled = !n;
  }
  function renderPrices(){
    var pr = S.pr;
    $('#prCur').value = pr.cur;
    $('#prRateBox').classList.toggle('hidden',pr.cur==='NGN');
    $('#prUnit').textContent = SYM[pr.cur]+'1';
    $('#prLive').checked = !!pr.live; $('#prFixed').checked = !pr.live;
    $('#prRateRow').classList.toggle('hidden',pr.live);
    $('#prRate').value = pr.cur==='NGN' ? '' : fmt(pr.rate,'USD'); $('#prRate').classList.remove('bad');
    var box = $('#prTiers'); box.textContent = '';
    TIERS.forEach(function(name,k){
      var w = document.createElement('div'), l = document.createElement('label'), i = document.createElement('input'), e = document.createElement('div');
      l.textContent = name+' ('+SYM[pr.cur]+')'; i.type = 'text'; i.setAttribute('inputmode','decimal'); i.autocomplete = 'off'; i.value = fmt(pr.tiers[k],pr.cur); i.setAttribute('aria-label',name+' price');
      e.className = 'eq';
      i.oninput = function(){
        var v = parseMoney(i.value,S.pr.cur); S.pr.tiers[k] = isNaN(v) ? null : v; i.classList.toggle('bad',isNaN(v));
        updateEq(); updateBar();
      };
      w.appendChild(l); w.appendChild(i); w.appendChild(e); box.appendChild(w);
    });
    $('#prRateHint').textContent = '';
    if(pr.cur!=='NGN') fetchRate(pr.cur).then(function(r){ if(S.pr.cur!==pr.cur) return; S.market = r; $('#prRateHint').textContent = S.pr.live ? 'Today\'s rate is about ₦'+r.toLocaleString('en-NG')+' per '+SYM[pr.cur]+'1. The store updates by itself, so you never need to change naira prices.' : 'For reference, today\'s market rate is about ₦'+r.toLocaleString('en-NG')+'. Use any rate you like (for example a round number).'; }).catch(function(){});
    $('#ofMin').value = fmt(pr.offer.min,'USD'); $('#ofMax').value = fmt(pr.offer.max,'USD');
    $('#ofMin').classList.remove('bad'); $('#ofMax').classList.remove('bad');
    updateEq();
  }
  function convertTo(to,newRate){
    var old = S.pr;
    function f(v){ if(v==null) return v; var n = v*old.rate/newRate; return to==='NGN' ? Math.round(n) : Math.round(n*100)/100; }
    var nb = {}; Object.keys(old.beats).forEach(function(k){ var m = {}; for(var j=0;j<3;j++) if(old.beats[k][j]!=null) m[j] = f(old.beats[k][j]); nb[k] = m; });
    S.pr = {cur:to,rate:newRate,live:to!=='NGN',tiers:old.tiers.map(f),offer:old.offer,beats:nb}; S.prBad = {};
    renderPrices(); render();
    say($('#prMsg'),'Your prices were converted to '+CUR_NAME[to]+'. Check them and change anything you like.','ok');
  }
  function onCurrency(){
    var sel = $('#prCur'), to = sel.value, old = S.pr;
    if(to===old.cur) return;
    if(!old.tiers.every(function(v){ return v>0; }) || !(old.rate>0) || Object.keys(S.prBad).length){ sel.value = old.cur; say($('#prMsg'),'Fix the highlighted prices first, then change the currency.','err'); return; }
    if(to==='NGN') return convertTo('NGN',1);
    say($('#prMsg'),'Getting today\'s rate…');
    fetchRate(to).catch(function(){
      var r = parseMoney(prompt('Could not get today\'s rate. How many naira is '+SYM[to]+'1? (for example 1500)') || '', 'USD');
      if(!(r>0)) throw 0; return r;
    }).then(function(r){ convertTo(to,r); }).catch(function(){ sel.value = old.cur; say($('#prMsg'),'Currency not changed.','err'); });
  }
  $('#prCur').onchange = onCurrency;
  ['ofMin','ofMax'].forEach(function(id){
    $('#'+id).oninput = function(){
      var v = parseMoney(this.value,'USD'), key = id==='ofMin' ? 'min' : 'max';
      this.classList.toggle('bad',isNaN(v)); S.pr.offer[key] = isNaN(v) ? null : v; updateBar();
    };
  });
  function setMode(live){
    if(S.pr.live===live) return;
    S.pr.live = live;
    if(live && S.market>0) S.pr.rate = S.market;   // the saved rate is only a backup while today's rate loads
    renderPrices(); updateBar();
  }
  $('#prLive').onchange = function(){ if(this.checked) setMode(true); };
  $('#prFixed').onchange = function(){ if(this.checked) setMode(false); };
  $('#prRate').oninput = function(){
    var v = parseMoney(this.value,'USD'); S.pr.rate = isNaN(v) ? null : v; this.classList.toggle('bad',isNaN(v));
    updateEq(); updateBar();
  };
  $('#prClear').onclick = function(){
    if(!confirm('Remove the individual prices from all beats, so every beat uses the prices above?')) return;
    S.pr.beats = {}; S.prBad = {}; say($('#prMsg'),''); render(); updateEq(); updateBar();
  };
  /* ---- genre and BPM (meta.json) ---- */
  var KEYS = (function(){
    var n = ['C','C\u266F','D\u266D','D','D\u266F','E\u266D','E','F','F\u266F','G\u266D','G','G\u266F','A\u266D','A','A\u266F','B\u266D','B'], out = [];
    n.forEach(function(x){ out.push(x+' major'); }); n.forEach(function(x){ out.push(x+' minor'); });
    return out;
  })();
  function cleanGenre(g){ return String(g||'').replace(/[<>"'`\\]/g,'').replace(/\s+/g,' ').trim().slice(0,24); }
  function metaFromJSON(d){
    var o = {}; if(!d || typeof d!=='object' || Array.isArray(d)) return o;
    Object.keys(d).forEach(function(k){
      var m = d[k], r = {}; if(!m || typeof m!=='object') return;
      var g = cleanGenre(m.g), b = Math.round(+m.bpm);
      if(g) r.g = g; if(b>=40 && b<=300) r.bpm = b; if(KEYS.indexOf(m.k)>=0) r.k = m.k;
      if(Object.keys(r).length) o[k] = r;
    });
    return o;
  }
  function metaJSON(live){
    var out = {};
    Object.keys(S.meta).sort().forEach(function(k){
      if(live && live.indexOf(k)<0) return;
      var m = S.meta[k], r = {}; if(m.g) r.g = m.g; if(m.bpm) r.bpm = m.bpm; if(m.k) r.k = m.k;
      if(Object.keys(r).length) out[k] = r;
    });
    return JSON.stringify(out,null,2)+'\n';
  }
  function metaChanged(){ return metaJSON(liveSlugs()) !== S.metaBase; }
  function genreList(){
    var seen = {}, out = [];
    ['Afrobeats','Afropop','Amapiano','Trap','Drill','Hip-hop','RnB','Highlife','Dancehall','Gospel'].forEach(function(g){ seen[g.toLowerCase()] = 1; out.push(g); });
    Object.keys(S.meta).forEach(function(k){ var g = S.meta[k].g; if(g && !seen[g.toLowerCase()]){ seen[g.toLowerCase()] = 1; out.push(g); } });
    return out;
  }
  function metaLine(t){ var m = S.meta[slug(t)]; if(!m) return ''; return [m.g, m.bpm ? m.bpm+' BPM' : '', m.k].filter(Boolean).join(' · '); }
  function buildEditor(t){
    var s = slug(t), ed = document.createElement('div'); ed.className = 'ed';
    Object.keys(S.prBad).forEach(function(k){ if(k.indexOf(s+'|')===0) delete S.prBad[k]; });
    var det = document.createElement('div'); det.className = 'pr';
    var gw = document.createElement('div'), gl = document.createElement('label'), gi = document.createElement('input');
    gl.textContent = 'Genre'; gi.type = 'text'; gi.setAttribute('list','genreList'); gi.autocomplete = 'off'; gi.maxLength = 24; gi.placeholder = 'e.g. Afrobeats'; gi.value = (S.meta[s] && S.meta[s].g) || ''; gi.setAttribute('aria-label',t+' genre');
    var bw = document.createElement('div'), bl = document.createElement('label'), bi = document.createElement('input');
    bl.textContent = 'BPM'; bi.type = 'text'; bi.setAttribute('inputmode','numeric'); bi.autocomplete = 'off'; bi.placeholder = 'e.g. 100'; bi.value = (S.meta[s] && S.meta[s].bpm) || ''; bi.setAttribute('aria-label',t+' BPM');
    function saveMeta(){
      var m = S.meta[s] || (S.meta[s] = {});
      var g = cleanGenre(gi.value); if(g) m.g = g; else delete m.g;
      var raw = bi.value.trim(), n = /^\d{2,3}$/.test(raw) ? +raw : NaN;
      if(!raw){ delete m.bpm; bi.classList.remove('bad'); delete S.prBad[s+'|bpm']; }
      else if(n>=40 && n<=300){ m.bpm = n; bi.classList.remove('bad'); delete S.prBad[s+'|bpm']; }
      else { bi.classList.add('bad'); S.prBad[s+'|bpm'] = 1; }
      if(KEYS.indexOf(ks.value)>=0) m.k = ks.value; else delete m.k;
      if(!Object.keys(m).length) delete S.meta[s];
      var hl = ed.parentNode && ed.parentNode.querySelector('.mline'); if(hl) hl.textContent = metaLine(t);
      var dl = $('#genreList'); if(dl){ dl.textContent = ''; genreList().forEach(function(x){ var o = document.createElement('option'); o.value = x; dl.appendChild(o); }); }
      updateBar();
    }
    var kw = document.createElement('div'), kl = document.createElement('label'), ks = document.createElement('select');
    kl.textContent = 'Key'; ks.setAttribute('aria-label',t+' key'); ks.style.width = '100%';
    var none = document.createElement('option'); none.value = ''; none.textContent = 'Not set'; ks.appendChild(none);
    ['major','minor'].forEach(function(mode){
      var og = document.createElement('optgroup'); og.label = mode.charAt(0).toUpperCase()+mode.slice(1);
      KEYS.filter(function(x){ return x.slice(-mode.length) === mode; }).forEach(function(x){ var o = document.createElement('option'); o.value = x; o.textContent = x; og.appendChild(o); });
      ks.appendChild(og);
    });
    ks.value = (S.meta[s] && S.meta[s].k) || '';
    gi.oninput = saveMeta; bi.oninput = saveMeta; ks.onchange = saveMeta;
    gw.appendChild(gl); gw.appendChild(gi); bw.appendChild(bl); bw.appendChild(bi); kw.appendChild(kl); kw.appendChild(ks); det.appendChild(gw); det.appendChild(bw); det.appendChild(kw);
    var grid = document.createElement('div'); grid.className = 'pr'; grid.style.marginTop = '12px';
    TIERS.forEach(function(name,k){
      var w = document.createElement('div'), l = document.createElement('label'), i = document.createElement('input');
      l.textContent = name+' ('+SYM[S.pr.cur]+')'; i.type = 'text'; i.setAttribute('inputmode','decimal'); i.autocomplete = 'off';
      i.placeholder = S.pr.tiers[k]>0 ? 'Standard '+fmt(S.pr.tiers[k],S.pr.cur) : 'Standard'; i.setAttribute('aria-label',t+' '+name+' price');
      var cur = S.pr.beats[s] && S.pr.beats[s][k]; i.value = cur ? fmt(cur,S.pr.cur) : '';
      i.oninput = function(){
        var raw = i.value.trim(), key = s+'|'+k;
        if(!raw){ if(S.pr.beats[s]){ delete S.pr.beats[s][k]; if(!Object.keys(S.pr.beats[s]).length) delete S.pr.beats[s]; } delete S.prBad[key]; i.classList.remove('bad'); }
        else { var v = parseMoney(raw,S.pr.cur);
          if(isNaN(v)){ S.prBad[key] = 1; i.classList.add('bad'); }
          else { delete S.prBad[key]; i.classList.remove('bad'); (S.pr.beats[s] = S.pr.beats[s] || {})[k] = v; } }
        var tag = ed.parentNode && ed.parentNode.querySelector('.cp'); if(tag) tag.classList.toggle('hidden',!(S.pr.beats[s] && Object.keys(S.pr.beats[s]).length));
        updateEq(); updateBar();
      };
      w.appendChild(l); w.appendChild(i); grid.appendChild(w);
    });
    var h = document.createElement('div'); h.className = 'hint'; h.style.marginTop = '6px'; h.textContent = '';
    var rs = document.createElement('button'); rs.className = 'small'; rs.style.marginTop = '8px'; rs.textContent = 'Reset to standard prices';
    rs.onclick = function(){ delete S.pr.beats[s]; Object.keys(S.prBad).forEach(function(k){ if(k.indexOf(s+'|')===0) delete S.prBad[k]; }); render(); updateEq(); updateBar(); };
    var ph = document.createElement('div'); ph.className = 'hint'; ph.style.marginTop = '12px'; ph.textContent = 'Price for this beat only (leave a box empty to use the price for all beats). Exclusive is always an offer.';
    ed.appendChild(det); ed.appendChild(ph); ed.appendChild(grid); ed.appendChild(h); ed.appendChild(rs);
    return ed;
  }

  function previewState(t){
    var s = slug(t), cands = [s+'.mp3'];
    if(OLD_SLUGS[t]) cands.push(OLD_SLUGS[t]+'.mp3');
    for(var i=0;i<cands.length;i++) if(S.audio[cands[i]]) return 'ok';
    for(var j=0;j<cands.length;j++) if(S.audioLower[cands[j].toLowerCase()]) return 'case';
    return 'none';
  }

  function load(){
    say($('#loginMsg'),'Connecting…');
    return gh('GET',repoPath('')).then(function(r){
      if(!r.permissions || r.permissions.push === false) throw new Error('This token can read the repository but not write to it. Set Contents to "Read and write".');
      return gh('GET',repoPath('/git/ref/heads/'+encodeURIComponent(S.branch)).replace('%2F','/'));
    }).then(function(ref){
      return gh('GET',repoPath('/git/commits/'+ref.object.sha)).then(function(c){ return gh('GET',repoPath('/git/trees/'+c.tree.sha+'?recursive=1')); });
    }).then(function(tree){
      S.audio = {}; S.audioLower = {};
      (tree.tree||[]).forEach(function(e){
        if(e.type==='blob' && /^audio\//.test(e.path)){ var n = e.path.slice(6); S.audio[n] = e.sha; S.audioLower[n.toLowerCase()] = n; }
      });
      return gh('GET',repoPath('/contents/beats.json?ref='+encodeURIComponent(S.branch)),null,'application/vnd.github.raw+json').catch(function(e){
        if(e.status===404) throw new Error('beats.json was not found in the repository. Upload the beats.json file I sent you to the main folder first.');
        throw e;
      });
    }).then(function(text){
      var arr; try{ arr = JSON.parse(text); }catch(_){ throw new Error('beats.json could not be read (it is not valid JSON).'); }
      if(!Array.isArray(arr)) throw new Error('beats.json should be a list of titles.');
      S.originalText = text; S.original = arr.map(String); S.list = S.original.slice();
      S.files = {}; S.removed = {}; S.queue = [];
      return gh('GET',repoPath('/contents/prices.json?ref='+encodeURIComponent(S.branch)),null,'application/vnd.github.raw+json').catch(function(e){
        if(e.status===404) return null; throw e;
      });
    }).then(function(ptext){
      var d = null;
      if(ptext){ try{ d = JSON.parse(ptext); }catch(_){ throw new Error('prices.json could not be read (it is not valid JSON). Delete it on GitHub or fix it, then reload.'); } }
      S.prText = ptext; S.pr = prFromJSON(d); S.prLoaded = JSON.parse(JSON.stringify(S.pr)); S.prBad = {}; S.prOpen = {};
      return gh('GET',repoPath('/contents/meta.json?ref='+encodeURIComponent(S.branch)),null,'application/vnd.github.raw+json').catch(function(e){
        if(e.status===404) return null; throw e;
      });
    }).then(function(mtext){
      var md = null;
      if(mtext){ try{ md = JSON.parse(mtext); }catch(_){ throw new Error('meta.json could not be read (it is not valid JSON). Delete it on GitHub or fix it, then reload.'); } }
      S.metaText = mtext; S.meta = metaFromJSON(md); S.metaLoaded = JSON.parse(JSON.stringify(S.meta));
      S.prBase = prJSON(liveSlugs()); S.metaBase = metaJSON(liveSlugs());
      $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
      $('#who').textContent = S.repo+' · '+S.branch;
      say($('#loginMsg'),''); say($('#prMsg'),''); $('#token').value = ''; renderPrices(); render(); renderQueue();
    });
  }

  function changeCount(){
    var n = 0, i;
    var removedList = Object.keys(S.removed).length;
    var added = S.list.filter(function(t){ return S.original.indexOf(t)<0; }).length;
    var orderChanged = false;
    var kept = S.list.filter(function(t){ return !S.removed[t]; });
    var ko = S.original.filter(function(t){ return !S.removed[t]; });
    for(i=0;i<kept.length;i++) if(kept[i]!==ko[i]){ orderChanged = true; break; }
    return { removed:removedList, added:added, files:Object.keys(S.files).length, moved: orderChanged && !added ? 1 : (orderChanged?1:0) };
  }

  function render(){
    var q = $('#filter').value.trim().toLowerCase(), box = $('#list');
    box.textContent = '';
    var shown = 0; S.vis = [];
    Object.keys(S.sel).forEach(function(k){ if(S.list.indexOf(k)<0 || S.removed[k]) delete S.sel[k]; });
    S.list.forEach(function(t,i){
      if(q && t.toLowerCase().indexOf(q)<0) return;
      shown++;
      var row = document.createElement('div'); row.className = 'b'+(S.removed[t]?' removed':'')+(S.sel[t]&&!S.removed[t]?' sel':''); row.setAttribute('data-t',t);
      S.vis.push(t);
      var gr = document.createElement('span'), ck = document.createElement('span');
      if(!S.removed[t]){
        var g = document.createElement('button'); g.type = 'button'; g.className = 'grip'; g.textContent = '\u22EE\u22EE'; g.setAttribute('aria-label','Move '+t+'. Drag, or press the up or down arrow.'); g.title = 'Drag to reorder';
        g.addEventListener('pointerdown',function(e){ startDrag(e,t,g); });
        g.addEventListener('keydown',function(e){ if(e.key==='ArrowUp'||e.key==='ArrowDown'){ e.preventDefault(); nudge(t,e.key==='ArrowUp'?-1:1); } });
        gr.appendChild(g);
        var c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!S.sel[t]; c.setAttribute('aria-label','Select '+t);
        c.addEventListener('click',function(e){ pickRow(t,c.checked,e.shiftKey); });
        ck.appendChild(c);
      }
      var n = document.createElement('span'); n.className = 'n'; n.textContent = i+1;
      var name = document.createElement('span'); name.className = 't'; name.textContent = t;
      var ml = document.createElement('div'); ml.className = 'hint mline'; ml.style.fontWeight = '400'; ml.textContent = metaLine(t); name.appendChild(ml);
      var tags = document.createElement('span'); tags.className = 'tg';
      var isNew = S.original.indexOf(t)<0, st = S.files[t] ? 'new' : previewState(t);
      var tag = document.createElement('span'); tag.className = 'tag '+(st==='ok'?'ok':st==='case'?'warn':st==='new'?'new':'bad');
      tag.textContent = st==='ok' ? 'preview ✓' : st==='case' ? 'file name case' : st==='new' ? (isNew?'new · ':'')+'preview ready' : 'no preview';
      if(st==='case') tag.title = 'The file exists but its name has capital letters. Rename it to '+slug(t)+'.mp3';
      tags.appendChild(tag);
      var sg = slug(t), cp = document.createElement('span'); cp.className = 'tag cp'+(S.pr.beats[sg] && Object.keys(S.pr.beats[sg]).length ? '' : ' hidden'); cp.textContent = 'own price'; cp.style.marginLeft = '6px'; tags.appendChild(cp);
      var act = document.createElement('span'); act.className = 'row act';
      if(!S.removed[t]){
        var pb = document.createElement('button'); pb.className = 'small'; pb.textContent = 'Edit'; pb.setAttribute('aria-expanded',!!S.prOpen[t]);
        pb.onclick = function(){ S.prOpen[t] = !S.prOpen[t]; render(); };
        act.appendChild(pb);
        var rm = document.createElement('button'); rm.className = 'small danger'; rm.textContent = 'Remove'; rm.onclick = function(){ remove(t); }; act.appendChild(rm);
      } else {
        var un = document.createElement('button'); un.className = 'small'; un.textContent = 'Undo'; un.onclick = function(){ delete S.removed[t]; render(); }; act.appendChild(un);
      }
      row.appendChild(gr); row.appendChild(ck); row.appendChild(n); row.appendChild(name); row.appendChild(tags); row.appendChild(act);
      row.addEventListener('mousedown',function(e){ if(e.shiftKey && !e.target.closest('input,select,textarea')) e.preventDefault(); });
      row.addEventListener('click',function(e){
        if(S.removed[t] || e.target.closest('button,input,select,textarea,a,.ed')) return;
        if(e.shiftKey) pickRow(t,true,true); else if(e.ctrlKey || e.metaKey) pickRow(t,!S.sel[t],false);
      });
      if(S.prOpen[t] && !S.removed[t]){ row.classList.add('has-ed'); row.appendChild(buildEditor(t)); }
      box.appendChild(row);
    });
    if(!shown){ var e = document.createElement('p'); e.className = 'hint'; e.style.padding = '12px'; e.textContent = 'Nothing matches.'; box.appendChild(e); }
    var live = S.list.filter(function(t){ return !S.removed[t]; }).length;
    $('#count').textContent = '· '+live+' beats';
    if(S.focusT){ var fr = box.querySelectorAll('.b'); for(var z=0;z<fr.length;z++) if(fr[z].getAttribute('data-t')===S.focusT){ var fg = fr[z].querySelector('.grip'); if(fg) fg.focus(); break; } S.focusT = null; }
    paintSel(); updateEq(); updateBar();
  }

  function updateBar(){
    var c = changeCount(), parts = [];
    if(c.added) parts.push(c.added+' added');
    if(c.removed) parts.push(c.removed+' removed');
    if(c.moved && !c.added) parts.push('order changed');
    if(priceChanged()) parts.push('prices changed');
    if(metaChanged()) parts.push('genre, BPM or key changed');
    var replaced = Object.keys(S.files).filter(function(t){ return S.original.indexOf(t)>=0; }).length;
    if(replaced) parts.push(replaced+' preview'+(replaced>1?'s':'')+' replaced');
    $('#bar').classList.toggle('hidden',!parts.length);
    $('#pending').textContent = parts.join(' · ');
  }

  function remove(t){
    if(S.original.indexOf(t)<0){ var i = S.list.indexOf(t); S.list.splice(i,1); delete S.files[t]; }
    else S.removed[t] = true;
    render();
  }

  /* ---- add queue ---- */
  function addFiles(files){
    Array.prototype.forEach.call(files,function(f){
      if(!/\.mp3$/i.test(f.name)){ say($('#addMsg'),'Skipped "'+f.name+'": only .mp3 files are supported.','err'); return; }
      if(f.size > MAX_BYTES){ say($('#addMsg'),'Skipped "'+f.name+'": larger than 20 MB. A preview should be much smaller.','err'); return; }
      S.queue.push({file:f,title:guessTitle(f.name)});
    });
    renderQueue();
  }
  function renderQueue(){
    var box = $('#queue'); box.textContent = '';
    S.queue.forEach(function(it,i){
      var d = document.createElement('div'); d.className = 'q';
      var inp = document.createElement('input'); inp.type = 'text'; inp.value = it.title; inp.setAttribute('aria-label','Beat title'); inp.maxLength = 60;
      inp.oninput = function(){ it.title = inp.value; };
      var x = document.createElement('button'); x.className = 'small'; x.textContent = '×'; x.setAttribute('aria-label','Remove from queue'); x.onclick = function(){ S.queue.splice(i,1); renderQueue(); };
      var fn = document.createElement('span'); fn.className = 'fn'; fn.textContent = it.file.name+' · '+(it.file.size/1048576).toFixed(1)+' MB';
      d.appendChild(inp); d.appendChild(x); d.appendChild(fn); box.appendChild(d);
    });
    var has = S.queue.length>0;
    $('#addBtn').classList.toggle('hidden',!has); $('#posBox').classList.toggle('hidden',!has);
  }
  function commitQueue(){
    var msgs = [], top = document.querySelector('input[name=pos]:checked').value === 'top', adds = [];
    for(var i=0;i<S.queue.length;i++){
      var it = S.queue[i], t = it.title.replace(/\s+/g,' ').trim().toUpperCase();
      if(!TITLE_RE.test(t)){ say($('#addMsg'),'"'+it.title+'" is not a usable title. Use letters, numbers, spaces and simple punctuation (up to 60 characters).','err'); return; }
      if(!slug(t)){ say($('#addMsg'),'"'+it.title+'" needs at least one letter or number.','err'); return; }
      for(var j=0;j<adds.length;j++) if(slug(adds[j].t)===slug(t)){ say($('#addMsg'),'"'+t+'" appears twice in this batch.','err'); return; }
      adds.push({t:t,file:it.file});
    }
    var newTitles = [];
    adds.forEach(function(a){
      var ex = S.list.filter(function(x){ return slug(x)===slug(a.t); })[0];
      if(ex){
        if(S.removed[ex]){ delete S.removed[ex]; S.files[ex] = a.file; msgs.push('"'+ex+'" was marked removed, so it has been restored with the new preview.'); }
        else { S.files[ex] = a.file; msgs.push('"'+ex+'" is already in your list, so only its preview will be replaced.'); }
      } else { S.files[a.t] = a.file; newTitles.push(a.t); }
    });
    if(top) S.list = newTitles.concat(S.list); else S.list = S.list.concat(newTitles);
    S.queue = []; renderQueue(); render();
    say($('#addMsg'),(newTitles.length? newTitles.length+' beat'+(newTitles.length>1?'s':'')+' added to the '+(top?'top':'bottom')+'. ':'')+msgs.join(' ')+' Press "Publish changes" to make them live.','ok');
    if(top) $('#list').scrollTop = 0;
  }

  /* ---- publish ---- */
  function toB64(file){
    return new Promise(function(res,rej){
      var r = new FileReader();
      r.onload = function(){ res(String(r.result).split(',')[1]||''); };
      r.onerror = function(){ rej(new Error('Could not read '+file.name)); };
      r.readAsDataURL(file);
    });
  }
  function jsonText(list){ return '[\n'+list.map(function(t){ return '  '+JSON.stringify(t); }).join(',\n')+'\n]\n'; }

  function publish(){
    var btn = $('#publish'); btn.disabled = true; $('#discard').disabled = true;
    var final = S.list.filter(function(t){ return !S.removed[t]; });
    if(!final.length){ alert('The list would be empty. Keep at least one beat.'); btn.disabled = false; $('#discard').disabled = false; return; }
    var pp = prProblem();
    if(pp){ alert(pp); btn.disabled = false; $('#discard').disabled = false; return; }
    var removedTitles = Object.keys(S.removed);
    var ok = removedTitles.length ? confirm('Remove '+removedTitles.length+' beat'+(removedTitles.length>1?'s':'')+' from the site and delete the preview file'+(removedTitles.length>1?'s':'')+'?') : true;
    if(!ok){ btn.disabled = false; $('#discard').disabled = false; return; }
    var treeItems = [], msg = [], commitSha, baseTree;
    function st(t){ $('#pending').textContent = t; }
    st('Checking GitHub…');
    gh('GET',repoPath('/git/ref/heads/'+encodeURIComponent(S.branch)).replace('%2F','/')).then(function(ref){
      commitSha = ref.object.sha;
      return gh('GET',repoPath('/contents/beats.json?ref='+encodeURIComponent(S.branch)),null,'application/vnd.github.raw+json');
    }).then(function(cur){
      if(cur !== S.originalText) throw new Error('beats.json changed on GitHub since you opened this page. Reload the page and make your changes again so nothing is overwritten.');
      return gh('GET',repoPath('/contents/prices.json?ref='+encodeURIComponent(S.branch)),null,'application/vnd.github.raw+json').catch(function(e){ if(e.status===404) return null; throw e; });
    }).then(function(pcur){
      if(pcur !== S.prText) throw new Error('prices.json changed on GitHub since you opened this page. Reload the page and make your changes again so nothing is overwritten.');
      return gh('GET',repoPath('/contents/meta.json?ref='+encodeURIComponent(S.branch)),null,'application/vnd.github.raw+json').catch(function(e){ if(e.status===404) return null; throw e; });
    }).then(function(mcur){
      if(mcur !== S.metaText) throw new Error('meta.json changed on GitHub since you opened this page. Reload the page and make your changes again so nothing is overwritten.');
      return gh('GET',repoPath('/git/commits/'+commitSha));
    }).then(function(c){
      baseTree = c.tree.sha;
      var titles = Object.keys(S.files), chain = Promise.resolve();
      titles.forEach(function(t,i){
        chain = chain.then(function(){
          st('Uploading preview '+(i+1)+' of '+titles.length+'…');
          return toB64(S.files[t]).then(function(b64){ return gh('POST',repoPath('/git/blobs'),{content:b64,encoding:'base64'}); })
            .then(function(b){ treeItems.push({path:'audio/'+slug(t)+'.mp3',mode:'100644',type:'blob',sha:b.sha}); });
        });
      });
      return chain;
    }).then(function(){
      st('Saving the beat list…');
      return gh('POST',repoPath('/git/blobs'),{content:jsonText(final),encoding:'utf-8'});
    }).then(function(b){
      treeItems.push({path:'beats.json',mode:'100644',type:'blob',sha:b.sha});
      if(!priceChanged()) return null;
      st('Saving prices…');
      return gh('POST',repoPath('/git/blobs'),{content:prJSON(liveSlugs()),encoding:'utf-8'});
    }).then(function(pb){
      if(pb) treeItems.push({path:'prices.json',mode:'100644',type:'blob',sha:pb.sha});
      if(!metaChanged()) return null;
      st('Saving genres and BPM…');
      return gh('POST',repoPath('/git/blobs'),{content:metaJSON(liveSlugs()),encoding:'utf-8'});
    }).then(function(mb){
      if(mb) treeItems.push({path:'meta.json',mode:'100644',type:'blob',sha:mb.sha});
      removedTitles.forEach(function(t){
        var s = slug(t), names = [s+'.mp3']; if(OLD_SLUGS[t]) names.push(OLD_SLUGS[t]+'.mp3');
        names.forEach(function(n){
          var real = S.audio[n] ? n : S.audioLower[n.toLowerCase()];
          if(real && !S.files[t]) treeItems.push({path:'audio/'+real,mode:'100644',type:'blob',sha:null});
        });
      });
      return gh('POST',repoPath('/git/trees'),{base_tree:baseTree,tree:treeItems});
    }).then(function(tr){
      var added = final.filter(function(t){ return S.original.indexOf(t)<0; }).length;
      var bits = []; if(added) bits.push(added+' added'); if(removedTitles.length) bits.push(removedTitles.length+' removed'); if(priceChanged()) bits.push('prices updated'); if(metaChanged()) bits.push('genre, BPM and key updated');
      var m = 'Admin: '+(bits.length ? bits.join(', ') : 'update list');
      st('Publishing…');
      return gh('POST',repoPath('/git/commits'),{message:m,tree:tr.sha,parents:[commitSha]});
    }).then(function(c){
      return gh('PATCH',repoPath('/git/refs/heads/'+encodeURIComponent(S.branch)).replace('%2F','/'),{sha:c.sha});
    }).then(function(){
      btn.disabled = false; $('#discard').disabled = false;
      return load().then(function(){ say($('#addMsg'),'Published. Your site will update in about a minute (refresh the store page after that).','ok'); window.scrollTo({top:0,behavior:'smooth'}); });
    }).catch(function(e){
      btn.disabled = false; $('#discard').disabled = false; updateBar();
      alert('Could not publish: '+(e && e.message || e)+'\n\nNothing was changed on your site.');
    });
  }

  /* ---- selecting several beats ---- */
  function selTitles(){ return S.list.filter(function(t){ return S.sel[t] && !S.removed[t]; }); }
  function pickRow(t,on,range){
    if(range && S.lastSel && S.vis.indexOf(S.lastSel)>=0 && S.vis.indexOf(t)>=0){
      var a = S.vis.indexOf(S.lastSel), b = S.vis.indexOf(t), lo = Math.min(a,b), hi = Math.max(a,b);
      for(var i=lo;i<=hi;i++) if(!S.removed[S.vis[i]]) S.sel[S.vis[i]] = true;
    } else if(on) S.sel[t] = true; else delete S.sel[t];
    S.lastSel = t; paintSel();
  }
  function paintSel(){
    document.querySelectorAll('#list .b').forEach(function(r){
      var t = r.getAttribute('data-t'), on = !!S.sel[t] && !S.removed[t], c = r.querySelector('input[type=checkbox]');
      r.classList.toggle('sel',on); if(c) c.checked = on;
    });
    var n = selTitles().length, vis = S.vis.filter(function(t){ return !S.removed[t]; }), inVis = vis.filter(function(t){ return S.sel[t]; }).length, all = $('#selAll');
    all.checked = vis.length>0 && inVis===vis.length; all.indeterminate = inVis>0 && inVis<vis.length;
    $('#selAllL').textContent = $('#filter').value.trim() ? 'Select all shown' : 'Select all';
    $('#selCount').textContent = n ? n+' selected' : '';
    $('#selActs').classList.toggle('hidden',!n);
    if(!n){ $('#selMetaP').classList.add('hidden'); $('#selPriceP').classList.add('hidden'); }
  }
  $('#selAll').onchange = function(){
    var on = this.checked;
    S.vis.forEach(function(t){ if(S.removed[t]) return; if(on) S.sel[t] = true; else delete S.sel[t]; });
    paintSel();
  };
  $('#selClear').onclick = function(){ S.sel = Object.create(null); S.lastSel = null; say($('#selMsg'),''); paintSel(); };
  function moveSel(top){
    var g = selTitles(); if(!g.length) return;
    var rest = S.list.filter(function(t){ return g.indexOf(t)<0; });
    S.list = top ? g.concat(rest) : rest.concat(g);
    say($('#selMsg'),g.length+' beat'+(g.length>1?'s':'')+' moved to the '+(top?'top':'bottom')+', keeping their order. Nothing is live until you press Publish changes.','ok');
    render();
  }
  $('#selTop').onclick = function(){ moveSel(true); };
  $('#selBottom').onclick = function(){ moveSel(false); };
  $('#selRemove').onclick = function(){
    var g = selTitles(); if(!g.length) return;
    if(!confirm('Remove '+g.length+' beat'+(g.length>1?'s':'')+' from your list? You can still undo before publishing.')) return;
    g.forEach(function(t){ delete S.sel[t]; remove(t); });
    say($('#selMsg'),g.length+' beat'+(g.length>1?'s':'')+' marked for removal. Press Undo on a beat to bring it back, or Publish changes to confirm.','ok');
  };
  // genre, BPM and key for the selection
  (function(){
    var ks = $('#bmKey'), none = document.createElement('option'); none.value = ''; none.textContent = 'Leave as it is'; ks.appendChild(none);
    ['major','minor'].forEach(function(mode){
      var og = document.createElement('optgroup'); og.label = mode.charAt(0).toUpperCase()+mode.slice(1);
      KEYS.filter(function(x){ return x.slice(-mode.length) === mode; }).forEach(function(x){ var o = document.createElement('option'); o.value = x; o.textContent = x; og.appendChild(o); });
      ks.appendChild(og);
    });
  })();
  $('#selMetaBtn').onclick = function(){ $('#selPriceP').classList.add('hidden'); $('#selMetaP').classList.toggle('hidden'); say($('#selMsg'),''); };
  $('#bmCancel').onclick = function(){ $('#selMetaP').classList.add('hidden'); };
  $('#bmApply').onclick = function(){
    var g = selTitles(), genre = cleanGenre($('#bmGenre').value), raw = $('#bmBpm').value.trim(), key = $('#bmKey').value, bpm = NaN;
    if(raw){ bpm = /^\d{2,3}$/.test(raw) ? +raw : NaN; if(!(bpm>=40 && bpm<=300)){ say($('#selMsg'),'BPM should be a whole number from 40 to 300.','err'); return; } }
    if(key && KEYS.indexOf(key)<0){ say($('#selMsg'),'That key is not on the list.','err'); return; }
    if(!genre && !raw && !key){ say($('#selMsg'),'Fill in a genre, a BPM or a key first.','err'); return; }
    g.forEach(function(t){
      var s = slug(t), m = S.meta[s] || (S.meta[s] = {});
      if(genre) m.g = genre; if(raw) m.bpm = bpm; if(key) m.k = key;
    });
    $('#bmGenre').value = ''; $('#bmBpm').value = ''; $('#bmKey').value = ''; $('#selMetaP').classList.add('hidden');
    say($('#selMsg'),'Updated '+g.length+' beat'+(g.length>1?'s':'')+'. Nothing is live until you press Publish changes.','ok');
    render();
  };
  // prices for the selection
  $('#selPriceBtn').onclick = function(){
    $('#selMetaP').classList.add('hidden'); var p = $('#selPriceP'); p.classList.toggle('hidden'); say($('#selMsg'),'');
    if(p.classList.contains('hidden')) return;
    var gridEl = $('#bpGrid'); gridEl.textContent = '';
    TIERS.forEach(function(name,k){
      var w = document.createElement('div'), l = document.createElement('label'), i = document.createElement('input');
      l.textContent = name+' ('+SYM[S.pr.cur]+')'; i.type = 'text'; i.setAttribute('inputmode','decimal'); i.autocomplete = 'off'; i.id = 'bp'+k;
      i.placeholder = S.pr.tiers[k]>0 ? 'Standard '+fmt(S.pr.tiers[k],S.pr.cur) : 'Standard';
      w.appendChild(l); w.appendChild(i); gridEl.appendChild(w);
    });
  };
  $('#bpCancel').onclick = function(){ $('#selPriceP').classList.add('hidden'); };
  $('#bpApply').onclick = function(){
    var g = selTitles(), vals = {}, any = false, bad = false;
    TIERS.forEach(function(name,k){
      var el = $('#bp'+k), raw = el ? el.value.trim() : ''; if(!raw){ if(el) el.classList.remove('bad'); return; }
      var v = parseMoney(raw,S.pr.cur); if(isNaN(v)){ bad = true; el.classList.add('bad'); } else { el.classList.remove('bad'); vals[k] = v; any = true; }
    });
    if(bad){ say($('#selMsg'),'One of the prices is not a valid number.','err'); return; }
    if(!any){ say($('#selMsg'),'Type at least one price first.','err'); return; }
    g.forEach(function(t){ var s = slug(t), m = S.pr.beats[s] || (S.pr.beats[s] = {}); Object.keys(vals).forEach(function(k){ m[k] = vals[k]; }); });
    $('#selPriceP').classList.add('hidden');
    say($('#selMsg'),'Set the price for '+g.length+' beat'+(g.length>1?'s':'')+'. Nothing is live until you press Publish changes.','ok');
    render();
  };
  $('#bpStd').onclick = function(){
    var g = selTitles(); g.forEach(function(t){ delete S.pr.beats[slug(t)]; });
    $('#selPriceP').classList.add('hidden');
    say($('#selMsg'),g.length+' beat'+(g.length>1?'s':'')+' now use the standard prices. Nothing is live until you press Publish changes.','ok');
    render();
  };

  /* ---- drag to reorder ---- */
  function moveGroup(group,targetT,after){
    var rest = S.list.filter(function(t){ return group.indexOf(t)<0; }), at = rest.indexOf(targetT);
    if(at<0) return;
    rest.splice.apply(rest,[after ? at+1 : at, 0].concat(group)); S.list = rest;
  }
  function nudge(t,dir){
    var group = (S.sel[t] && selTitles().length>1) ? selTitles() : [t];
    var vis = S.vis.filter(function(x){ return group.indexOf(x)<0 && !S.removed[x]; }), first = S.vis.indexOf(group[0]), pos = 0;
    if(dir<0){ for(var i=0;i<S.vis.length && S.vis[i]!==group[0];i++) if(group.indexOf(S.vis[i])<0 && !S.removed[S.vis[i]]) pos = S.vis[i]; if(!pos) return; moveGroup(group,pos,false); }
    else { var last = group[group.length-1], seen = false, nx = null; for(var j=0;j<S.vis.length;j++){ if(S.vis[j]===last){ seen = true; continue; } if(seen && group.indexOf(S.vis[j])<0 && !S.removed[S.vis[j]]){ nx = S.vis[j]; break; } } if(!nx) return; moveGroup(group,nx,true); }
    S.focusT = t; render();
  }
  var DRAG = null;
  function startDrag(e,t,handle){
    if(e.button!==undefined && e.button!==0) return;
    e.preventDefault();
    var group = (S.sel[t] && selTitles().length>1) ? selTitles() : [t], box = $('#list');
    DRAG = {group:group,target:null,after:false,y:e.clientY,timer:null};
    try{ handle.setPointerCapture(e.pointerId); }catch(_){}
    box.querySelectorAll('.b').forEach(function(r){ if(group.indexOf(r.getAttribute('data-t'))>=0) r.classList.add('dragging'); });
    function mark(){
      var rows = Array.prototype.slice.call(box.querySelectorAll('.b')).filter(function(r){ return group.indexOf(r.getAttribute('data-t'))<0 && !S.removed[r.getAttribute('data-t')]; });
      rows.forEach(function(r){ r.classList.remove('drop-before','drop-after'); });
      DRAG.target = null;
      for(var i=0;i<rows.length;i++){
        var rc = rows[i].getBoundingClientRect();
        if(DRAG.y < rc.top + rc.height/2){ DRAG.target = rows[i].getAttribute('data-t'); DRAG.after = false; rows[i].classList.add('drop-before'); return; }
      }
      if(rows.length){ var lr = rows[rows.length-1]; DRAG.target = lr.getAttribute('data-t'); DRAG.after = true; lr.classList.add('drop-after'); }
    }
    function onMove(ev){ DRAG.y = ev.clientY; mark(); }
    function tick(){
      var rc = box.getBoundingClientRect(), d = 0;
      if(DRAG.y < rc.top+36) d = -14; else if(DRAG.y > rc.bottom-36) d = 14;
      if(d){ box.scrollTop += d; mark(); }
    }
    function end(ev,commit){
      handle.removeEventListener('pointermove',onMove); handle.removeEventListener('pointerup',onUp); handle.removeEventListener('pointercancel',onCancel);
      clearInterval(DRAG.timer);
      var d = DRAG; DRAG = null;
      box.querySelectorAll('.b').forEach(function(r){ r.classList.remove('dragging','drop-before','drop-after'); });
      if(commit && d.target){ moveGroup(d.group,d.target,d.after); S.focusT = t; render(); }
    }
    function onUp(ev){ end(ev,true); } function onCancel(ev){ end(ev,false); }
    handle.addEventListener('pointermove',onMove); handle.addEventListener('pointerup',onUp); handle.addEventListener('pointercancel',onCancel);
    DRAG.timer = setInterval(tick,40); mark();
  }

  /* ---- bulk genre and BPM ---- */
  var BULK = null;
  function bulkParse(text){
    var lines = String(text).split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean), out = [], cand = '';
    var skip = /^(public|private|published|draft|unpublished|scheduled|mp3|wav|rar\/zip|zip|stems|status|all|sort by|visibility|new to old|old to new)$/i;
    lines.forEach(function(l){
      var cs = /^([^,|]{1,60}?)\s*,\s*([^,]{2,24}?)\s*(?:,\s*(\d{2,3}|-|\u2014)?\s*)?$/.exec(l);
      if(cs && !/BPM/i.test(l) && !/^\[/.test(l) && /[A-Za-z]/.test(cs[2]) && !/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(l)){ out.push({raw:cs[1],genre:cleanGenre(cs[2]),bpm:cs[3] && /\d/.test(cs[3]) ? +cs[3] : NaN}); cand = ''; return; }
      var bm = /(\d{2,3})\s*BPM/i.exec(l);
      if(bm){ if(cand) out.push({raw:cand,bpm:+bm[1]}); cand = ''; return; }
      var ml = /^\[(.+?)\]\(.*\)$/.exec(l);
      if(ml){ cand = ml[1]; return; }
      if(skip.test(l) || /^[\d\s.,]+$/.test(l) || /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(l) || l.length > 120) return;
      if(/[A-Za-z]/.test(l)) cand = l;
    });
    return out;
  }
  function bulkCandidates(raw){
    var c = [], q = /["\u201C]([^"\u201D]+)["\u201D]/.exec(raw);
    if(q) c.push(q[1]);
    var base = raw.replace(/["\u201C\u201D]/g,'').trim();
    var toks = base.split(/\s+[-\u2013\u2014|]\s+|\s*[-_\u2013\u2014|]\s*(?=[A-Za-z0-9])/).map(function(x){ return x.trim(); }).filter(Boolean);
    c.push(base);
    for(var n=Math.min(3,toks.length);n>=1;n--) c.push(toks.slice(0,n).join(' '));
    if(toks.length > 1) c.push(toks[toks.length-1]);   // "... type beat - Jiggy"
    return c.filter(Boolean);
  }
  function bulkMatch(entries){
    var bySlug = {}; S.list.forEach(function(t){ if(!S.removed[t]) bySlug[slug(t)] = t; });
    var ok = [], bad = [], dup = [], seen = {};
    entries.forEach(function(e){
      var hit = null, cs = bulkCandidates(e.raw);
      for(var i=0;i<cs.length && !hit;i++) hit = bySlug[slug(cs[i])] || null;
      if(hit && !seen[hit]){ seen[hit] = 1; ok.push({t:hit,bpm:e.bpm,genre:e.genre,raw:e.raw}); }
      else if(hit) dup.push(e); else bad.push(e);
    });
    return {ok:ok,bad:bad,dup:dup};
  }
  $('#bulkCheck').onclick = function(){
    var entries = bulkParse($('#bulkText').value), res = bulkMatch(entries), out = $('#bulkOut'), g = cleanGenre($('#bulkGenre').value);
    BULK = {res:res,genre:g}; $('#bulkApply').classList.toggle('hidden',!res.ok.length);
    if(!entries.length){ say(out,'No beats with a BPM were found in that text. Paste the list including the lines that say "112 BPM".','err'); return; }
    var msg = res.ok.length+' beat'+(res.ok.length===1?'':'s')+' found in your store'+(g ? ' (genre: '+g+')' : '')+':\n'+res.ok.map(function(x){ return x.t+(x.genre ? ' · '+x.genre : '')+' · '+(x.bpm>=40&&x.bpm<=300 ? x.bpm+' BPM' : 'no BPM'); }).join('\n');
    if(res.dup.length) msg += '\n\nSame beat listed twice (only the first is used):\n'+res.dup.map(function(x){ return x.raw; }).join('\n');
    if(res.bad.length) msg += '\n\nNot found in your store (nothing will be changed for these):\n'+res.bad.map(function(x){ return x.raw; }).join('\n');
    say(out,msg,res.bad.length ? '' : 'ok');
  };
  $('#bulkApply').onclick = function(){
    if(!BULK || !BULK.res.ok.length) return;
    BULK.res.ok.forEach(function(x){
      var s = slug(x.t), m = S.meta[s] || (S.meta[s] = {});
      var gg = x.genre || BULK.genre; if(gg) m.g = gg;
      if(x.bpm>=40 && x.bpm<=300) m.bpm = x.bpm;
      if(!Object.keys(m).length) delete S.meta[s];
    });
    var n = BULK.res.ok.length; BULK = null; $('#bulkApply').classList.add('hidden');
    render(); updateBar();
    say($('#bulkOut'),'Applied to '+n+' beat'+(n===1?'':'s')+'. Press Publish changes at the bottom to make it live.','ok');
  };

  /* ---- wiring ---- */
  $('#connect').onclick = function(){
    S.repo = $('#repo').value.trim().replace(/^https?:\/\/github\.com\//,'').replace(/\.git$/,'').replace(/\/+$/,'');
    S.branch = $('#branch').value.trim() || 'main'; S.token = $('#token').value.trim();
    if(!/^[A-Za-z0-9._\/-]{1,100}$/.test(S.branch) || S.branch.indexOf('..')>=0){ say($('#loginMsg'),'The branch name looks wrong. It is usually main.','err'); return; }
    if(!/^[\w.-]+\/[\w.-]+$/.test(S.repo)){ say($('#loginMsg'),'Enter the repository as owner/name, for example yourname/your-site.','err'); return; }
    if(!S.token){ say($('#loginMsg'),'Paste your access token.','err'); return; }
    load().then(function(){
      if($('#remember').checked) lsSet('ap_admin',JSON.stringify({repo:S.repo,branch:S.branch,token:S.token})); else lsDel('ap_admin');
    }).catch(function(e){ say($('#loginMsg'),e.message,'err'); });
  };
  $('#signout').onclick = function(){
    if(Object.keys(S.files).length || changeCount().removed || priceChanged() || metaChanged()){ if(!confirm('You have unpublished changes. Sign out anyway?')) return; }
    lsDel('ap_admin'); location.reload();
  };
  $('#drop').onclick = function(){ $('#files').click(); };
  $('#drop').onkeydown = function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); $('#files').click(); } };
  $('#files').onchange = function(){ addFiles(this.files); this.value = ''; };
  ['dragenter','dragover'].forEach(function(ev){ $('#drop').addEventListener(ev,function(e){ e.preventDefault(); this.classList.add('over'); }); });
  ['dragleave','drop'].forEach(function(ev){ $('#drop').addEventListener(ev,function(e){ e.preventDefault(); this.classList.remove('over'); }); });
  $('#drop').addEventListener('drop',function(e){ addFiles(e.dataTransfer.files); });
  $('#addBtn').onclick = commitQueue;
  $('#filter').oninput = render;
  $('#publish').onclick = publish;
  $('#discard').onclick = function(){ S.list = S.original.slice(); S.files = {}; S.removed = {}; S.sel = Object.create(null); S.lastSel = null; S.pr = JSON.parse(JSON.stringify(S.prLoaded)); S.meta = JSON.parse(JSON.stringify(S.metaLoaded)); S.prBad = {}; S.prOpen = {}; renderPrices(); render(); say($('#addMsg'),''); say($('#prMsg'),''); };
  window.addEventListener('beforeunload',function(e){ if(!$('#bar').classList.contains('hidden')){ e.preventDefault(); e.returnValue = ''; } });

  try{
    var saved = JSON.parse(lsGet('ap_admin')||'null');
    if(saved && saved.repo && saved.token){
      $('#repo').value = saved.repo; $('#branch').value = saved.branch||'main'; $('#token').value = saved.token;
      $('#connect').click();
    }
  }catch(_){}
})();
