/* 원전 입지 적합도 — 인터랙션 */
"use strict";

const OVL = "data/overlays/";
const REGIME_LABEL = {0:"폐쇄독재",1:"선거독재",2:"선거민주",3:"자유민주"};
const REGIME_LABEL_EN = {0:"Closed autocracy",1:"Electoral autocracy",2:"Electoral democracy",3:"Liberal democracy"};
// 현재 언어(영/한)에 맞는 문자열
function L(ko, en){ return document.documentElement.lang === "en" ? en : ko; }
const REGIME_COLOR = {0:"#b2182b",1:"#ef8a62",2:"#67a9cf",3:"#2166ac"};

/* ---- 진행바 ---- */
const progress = document.getElementById("progress");
window.addEventListener("scroll", () => {
  const h = document.documentElement;
  const p = h.scrollTop / (h.scrollHeight - h.clientHeight);
  progress.style.width = (p * 100) + "%";
}, {passive:true});

/* ---- reveal ---- */
const io = new IntersectionObserver((es) => {
  es.forEach(e => { if (e.isIntersecting) e.target.classList.add("visible"); });
}, {threshold:0.12});
document.querySelectorAll(".reveal").forEach(el => io.observe(el));

/* ---- RdYlGn 색 (0~100) ---- */
const STOPS = [[0,165,0,38],[25,244,109,67],[50,254,224,139],[75,166,217,106],[100,26,152,80]];
function lerp(a,b,t){return Math.round(a+(b-a)*t);}
function scoreColor(v){
  v = Math.max(0, Math.min(100, v));
  for (let i=0;i<STOPS.length-1;i++){
    const [v0,r0,g0,b0]=STOPS[i], [v1,r1,g1,b1]=STOPS[i+1];
    if (v<=v1){ const t=(v-v0)/(v1-v0); return `rgb(${lerp(r0,r1,t)},${lerp(g0,g1,t)},${lerp(b0,b1,t)})`; }
  }
  return "rgb(26,152,80)";
}

/* ---- 지도 공통 ---- 태평양(한국) 중심, 한 세계만(무한반복 차단) ---- */
const PC = 150;                       // 지도 중심 경도(한국·태평양)
function makeMap(id){
  const m = L.map(id,{minZoom:1,maxZoom:7,zoomSnap:0.25,worldCopyJump:false,
                      maxBounds:[[-58,PC-180],[82,PC+180]], maxBoundsViscosity:1.0,
                      zoomControl:true,attributionControl:true}).setView([22,PC],2);
  // 타일은 좌우로 이어지게(wrap) 두어 아메리카(오른쪽)에도 배경지도가 채워지도록 한다.
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {attribution:"&copy; OpenStreetMap, &copy; CARTO", subdomains:"abcd", maxZoom:19}).addTo(m);
  return m;
}
// 지도 가로폭에 맞춰 전 세계(360°)가 한눈에 들어오도록 줌을 맞춤(폭이 좁으면 더 축소)
function fitWidth(m){
  const w = m.getSize().x;
  if (!w) return;
  let z = Math.log2(w / 256);                 // 360°가 가로폭과 같아지는 줌
  z = Math.max(1, Math.min(7, Math.round(z * 4) / 4));
  m.setView([22, PC], z, {animate:false});
}

let mapCtx, mapFinal, IMG_BOUNDS, IMG_BOUNDS_E;
const overlays = {};
let popLayerL, popLayerR;  // 인구 오버레이 개별 레이어(연도별 교체용)
let timelinePlants = [];   // 전체 원전 목록(슬라이더 필터용)

// 연도 → GHS-POP 파일명 매핑
const POP_DEC = [1975, 1980, 1990, 2000, 2010, 2020];
function popUrl(year){
  let best = 1975;
  for (const py of POP_DEC) { if (py <= year) best = py; }
  return OVL + `layer_pop_${best}.png`;
}

// 오버레이를 원본(-180~180)과 +360 복제본으로 동시에 깔아 태평양 중심에서 양쪽 모두 채움
function overlayGroup(file, opacity){
  return L.layerGroup([
    L.imageOverlay(file, IMG_BOUNDS,   {opacity}),
    L.imageOverlay(file, IMG_BOUNDS_E, {opacity})
  ]);
}
// 원전 마커도 lon, lon+360 두 곳에 찍어 아메리카가 오른쪽에 보이도록
function addPlantMarkers(group, plants, styleFn, onClick){
  plants.forEach(p => [p.lon, p.lon + 360].forEach(lon => {
    const mk = L.circleMarker([p.lat, lon], styleFn(p))
      .bindTooltip(`${p.name} · ${p.final!=null?p.final.toFixed(0)+"점":(p.country||"")}`);
    if (onClick) mk.on("click", () => onClick(p));
    mk.addTo(group);
  }));
}

async function init(){
  const b = await (await fetch(OVL+"bounds.json")).json();
  IMG_BOUNDS   = [[b.south,b.west],[b.north,b.east]];
  IMG_BOUNDS_E = [[b.south,b.west+360],[b.north,b.east+360]];
  const plants = await (await fetch("data/plants.json")).json();

  /* ===== Map 1: 맥락 ===== */
  mapCtx = makeMap("map-context");
  // 인구 오버레이 — setUrl로 연도 교체 가능하게 개별 레이어로 저장
  popLayerL = L.imageOverlay(OVL+"layer_pop_2020.png", IMG_BOUNDS, {opacity:0.9});
  popLayerR = L.imageOverlay(OVL+"layer_pop_2020.png", IMG_BOUNDS_E, {opacity:0.9});
  overlays.pop = L.layerGroup([popLayerL, popLayerR]).addTo(mapCtx);
  overlays.seis  = overlayGroup(OVL+"layer_seismic.png",  0.95).addTo(mapCtx);
  overlays.water = overlayGroup(OVL+"layer_water.png",    0.9).addTo(mapCtx);
  overlays.volc  = overlayGroup(OVL+"layer_volcano.png",  0.9);   // 기본 꺼짐
  overlays.elev  = overlayGroup(OVL+"layer_elevation.png",0.85);  // 기본 꺼짐(인구밀도와 상호배타)

  // 슬라이더용 원전 레이어(연도별 필터)
  timelinePlants = plants;
  const timelineLayer = L.layerGroup().addTo(mapCtx);
  function updateTimeline(year){
    timelineLayer.clearLayers();
    const shown = plants.filter(p => !p.year || p.year <= year);
    addPlantMarkers(timelineLayer, shown,
      () => ({radius:3, color:"#111", weight:0.6, fillColor:"#ffd400", fillOpacity:0.95}), null);
    document.getElementById("yr-val").textContent = year;
    document.getElementById("yr-info").textContent = `${shown.length}기 표시`;
    // 인구 오버레이 교체
    if (document.getElementById("t-pop").checked){
      popLayerL.setUrl(popUrl(year));
      popLayerR.setUrl(popUrl(year));
    }
  }

  // 슬라이더 + 자동 재생
  const slider = document.getElementById("yr-slider");
  const playBtn = document.getElementById("yr-play");
  let playTimer = null;

  function stopPlay(){
    if(playTimer){ clearInterval(playTimer); playTimer=null; }
    playBtn.textContent="▶"; playBtn.classList.remove("playing");
  }
  function startPlay(){
    stopPlay();
    playBtn.textContent="⏸"; playBtn.classList.add("playing");
    // 맨 처음으로 되감기
    let yr = 1956;
    slider.value = yr; updateTimeline(yr);
    playTimer = setInterval(()=>{
      yr++;
      slider.value = yr; updateTimeline(yr);
      if(yr >= 2025) stopPlay();
    }, 80);  // 80ms/년 → 약 5.5초 완주
  }
  playBtn.addEventListener("click", ()=>{
    if(playTimer) stopPlay(); else startPlay();
  });
  slider.addEventListener("input", ()=>{ stopPlay(); updateTimeline(+slider.value); });
  updateTimeline(2025); // 초기: 전체 표시

  bindExclusive("t-pop","pop","t-elev","elev");   // 인구밀도 ↔ 고도 상호배타
  bindExclusive("t-elev","elev","t-pop","pop");
  bindToggle("t-seis","seis"); bindToggle("t-water","water"); bindToggle("t-volc","volc");
  document.getElementById("t-plants1").addEventListener("change", e=>{
    e.target.checked ? timelineLayer.addTo(mapCtx) : mapCtx.removeLayer(timelineLayer);
  });

  /* ===== Map 2: 최종 적합도 + 원전 클릭 ===== */
  mapFinal = makeMap("map-final");
  overlayGroup(OVL+"layer_final_pct.png", 0.82).addTo(mapFinal);
  const plantLayer2 = L.layerGroup().addTo(mapFinal);
  addPlantMarkers(plantLayer2, plants,
    (p) => ({radius:4.5,color:"#0b0e13",weight:1,fillColor:scoreColor(p.final),fillOpacity:0.95}),
    showDetail);

  buildLegend();
  observeMapResize();
  window._maps = {ctx:mapCtx, final:mapFinal};
  if(window._initDataTable) window._initDataTable(plants);

  // 사례 카드 클릭 → 결과 지도(s-heatmap)로 이동 + 해당 원전 상세 열기
  const byName = {}; plants.forEach(p => byName[p.name] = p);
  document.querySelectorAll(".case-card[data-plant]").forEach(card => {
    card.addEventListener("click", () => {
      const p = byName[card.dataset.plant]; if(!p) return;
      document.getElementById("s-heatmap").scrollIntoView({behavior:"smooth", block:"start"});
      setTimeout(() => {
        showDetail(p);
        if(mapFinal){ mapFinal.setView([p.lat, p.lon], Math.max(mapFinal.getZoom(), 4)); }
      }, 600);
    });
  });
}

function bindToggle(checkboxId, key){
  document.getElementById(checkboxId).addEventListener("change", e=>{
    e.target.checked ? overlays[key].addTo(mapCtx) : mapCtx.removeLayer(overlays[key]);
  });
}
// 켜면 상대 레이어를 끈다(상호배타: 인구밀도 ↔ 고도)
function bindExclusive(id, key, otherId, otherKey){
  document.getElementById(id).addEventListener("change", e=>{
    if(e.target.checked){
      overlays[key].addTo(mapCtx);
      const o=document.getElementById(otherId);
      if(o && o.checked){ o.checked=false; mapCtx.removeLayer(overlays[otherKey]); }
    } else {
      mapCtx.removeLayer(overlays[key]);
    }
  });
}

/* ---- 원전 상세 패널 ---- */
function bar(label, val){
  return `<div class="scorebar"><div class="lab"><span>${label}</span><span>${val.toFixed(0)}</span></div>
    <div class="track"><div class="fill" style="width:${Math.max(2,val)}%;background:${scoreColor(val)}"></div></div></div>`;
}
let _lastPlant = null;   // 언어 전환 시 패널 재렌더용
function showDetail(p){
  _lastPlant = p;
  const reg = (p.regime!=null) ? p.regime : null;
  const regName = reg!=null ? L(REGIME_LABEL[reg], REGIME_LABEL_EN[reg]) : "";
  const regBadge = reg!=null
    ? `<span class="badge" style="background:${REGIME_COLOR[reg]}33;color:${REGIME_COLOR[reg]};border:1px solid ${REGIME_COLOR[reg]}">${regName}</span>`
    : `<span class="badge" style="background:#333;color:#aaa">${L("체제 정보 없음","No regime info")}</span>`;
  document.getElementById("plant-detail").innerHTML = `
    <div class="dname">${p.name}</div>
    <div class="dmeta">${p.country} · ${L("건설","Built")} ${p.year||"?"}</div>
    <div class="dfinal" style="color:${scoreColor(p.final)}">${p.final.toFixed(1)}<span style="font-size:.9rem;color:#9aa7b8"> / 100</span></div>
    ${bar(L("지진 안전","Earthquake Safety"), p.seismic)}
    ${bar(L("수원 근접","Proximity to Water Source"), p.water)}
    ${bar(L("인구 이격","Population Distance"), p.population)}
    ${bar(L("홍수 안전","Flood Safety"), p.flood)}
    ${bar(L("화산 안전","Volcano Safety"), p.volcano)}
    <div style="margin-top:14px">${L("건설 당시 정치체제","Political System at Construction")}: ${regBadge}</div>
    <div class="dlist">
      ${L("가장 가까운 단층/판경계","Nearest Fault/Plate Boundary")}: <b>${p.d_fault_km} km</b><br>
      ${L("가장 가까운 수원","Nearest Water Source")}: <b>${p.d_water_km} km</b><br>
      ${L("가장 가까운 인구중심","Nearest Population Center")}: <b>${p.d_pop_km} km</b><br>
      ${L("해발고도","Elevation")}: <b>${p.elev_m} m</b> · ${L("가장 가까운 화산","Nearest Volcano")}: <b>${p.d_volcano_km} km</b>
    </div>`;
}

function buildLegend(){
  document.getElementById("legend-final").innerHTML =
    `<span>${L("부적합","Unsuitable")}</span><span class="bar"></span><span>${L("적합","Suitable")}</span>
     <span style="margin-left:18px">${L("· 마커 색 = 원전 최종점수 · 히트맵 = 육지 백분위",
        "· Marker color = Nuclear power plant final score · Heatmap = Land percentile")}</span>`;
}

// 언어 전환 시 동적 콘텐츠(범례·열린 상세패널) 재렌더
window._reLang = function(){
  try { buildLegend(); } catch(e){}
  if (_lastPlant) { try { showDetail(_lastPlant); } catch(e){} }
};

/* 지도 컨테이너가 보일 때 크기 재계산 (Leaflet 필수) */
function observeMapResize(){
  const fit = (mp)=>{ mp.invalidateSize(); requestAnimationFrame(()=>fitWidth(mp)); };
  const ro = new IntersectionObserver((es)=>{
    es.forEach(e=>{ if(e.isIntersecting){ const mp=(e.target.id==="s-context"?mapCtx:mapFinal);
      setTimeout(()=>fit(mp),200); setTimeout(()=>fit(mp),650);   // 레이아웃 안정 후 재보정
    }});
  },{threshold:0.05});
  ["s-context","s-heatmap"].forEach(id=>ro.observe(document.getElementById(id)));
  let rt; addEventListener("resize",()=>{clearTimeout(rt);rt=setTimeout(()=>{fit(mapCtx);fit(mapFinal);},200);});
}

init().catch(err=>{
  console.error(err);
  document.getElementById("plant-detail").innerHTML="<p class='ph'>데이터 로드 실패 — 로컬 서버(python -m http.server)로 열어주세요.</p>";
});

/* ---- 데이터 테이블 ---- */
(function dataTable(){
  const COLS = [
    {k:"name",      label:"원전명"},
    {k:"country",   label:"국가"},
    {k:"year",      label:"건설연도"},
    {k:"lat",       label:"위도"},
    {k:"lon",       label:"경도"},
    {k:"seismic",   label:"지진점수",    score:true},
    {k:"d_fault_km",label:"단층거리(km)"},
    {k:"water",     label:"수원점수",    score:true},
    {k:"d_water_km",label:"수원거리(km)"},
    {k:"population",label:"인구점수",    score:true},
    {k:"d_pop_km",  label:"인구거리(km)"},
    {k:"flood",     label:"홍수점수",    score:true},
    {k:"elev_m",    label:"고도(m)"},
    {k:"volcano",   label:"화산점수",    score:true},
    {k:"d_volcano_km",label:"화산거리(km)"},
    {k:"regime_label",label:"정치체제"},
    {k:"final",     label:"종합점수",    score:true},
  ];
  const RL = {0:"폐쇄독재",1:"선거독재",2:"선거민주",3:"자유민주"};
  let _plants=[], _sorted=[], _sortCol="final", _sortDir=-1, _hidden=new Set();

  function fmt(v,k){
    if(v===null||v===undefined) return "—";
    if(k==="regime_label") return RL[Math.round(v)]||v||"—";
    if(typeof v==="number") return (Number.isInteger(v)&&!k.includes("km")&&k!=="lat"&&k!=="lon")?v:parseFloat(v).toFixed(1);
    return v;
  }
  function regimeClass(p){return p.regime!=null?"regime-"+p.regime:"";}

  function render(){
    const q=(document.getElementById("dt-search").value||"").toLowerCase();
    const rows=_sorted.filter(p=>{
      if(q&&!(p.name||"").toLowerCase().includes(q)&&!(p.country||"").toLowerCase().includes(q)) return false;
      return true;
    });
    document.getElementById("dt-count").textContent=`${rows.length} / ${_plants.length}기`;
    const tbody=document.getElementById("dt-body");
    if(!rows.length){tbody.innerHTML=`<tr><td colspan="${COLS.length}" style="text-align:center;padding:18px;color:#9aa7b8">검색 결과 없음</td></tr>`;return;}
    tbody.innerHTML=rows.map(p=>`<tr>${COLS.map(c=>{
      const v=p[c.k];
      const cls=(c.k==="regime_label"?regimeClass(p):"")+(c.score?" score":"");
      return `<td class="${cls}"${_hidden.has(c.k)?' style="display:none"':''}>${fmt(v,c.k)}</td>`;
    }).join("")}</tr>`).join("");
  }

  function sort(col){
    if(_sortCol===col) _sortDir*=-1; else{_sortCol=col;_sortDir=-1;}
    const isNum=typeof(_plants[0]&&_plants[0][col])==="number";
    _sorted=[..._plants].sort((a,b)=>{
      const av=a[col]??-Infinity, bv=b[col]??-Infinity;
      return isNum?(av-bv)*_sortDir:String(av).localeCompare(String(bv),"ko")*_sortDir;
    });
    document.querySelectorAll("#dt-table th").forEach(th=>{
      th.classList.remove("asc","desc");
      if(th.dataset.col===col) th.classList.add(_sortDir===1?"asc":"desc");
    });
    render();
  }

  function csvDownload(){
    const q=(document.getElementById("dt-search").value||"").toLowerCase();
    const rows=_sorted.filter(p=>{
      if(q&&!(p.name||"").toLowerCase().includes(q)&&!(p.country||"").toLowerCase().includes(q)) return false;
      return true;
    });
    const header=COLS.map(c=>c.label).join(",");
    const body=rows.map(p=>COLS.map(c=>{
      const v=fmt(p[c.k],c.k); return `"${String(v).replace(/"/g,'""')}"`;
    }).join(",")).join("\n");
    const blob=new Blob(["﻿"+header+"\n"+body],{type:"text/csv;charset=utf-8;"});
    const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(blob),download:"nuclear_siting_scores.csv"});
    a.click();
  }

  function applyColVis(){
    document.querySelectorAll("#dt-table th[data-col]").forEach(th=>{
      th.style.display=_hidden.has(th.dataset.col)?"none":"";
    });
  }
  function buildColMenu(){
    const menu=document.getElementById("dt-colmenu"); if(!menu) return;
    menu.innerHTML=COLS.map(c=>`<label><input type="checkbox" data-col="${c.k}" checked> ${c.label}</label>`).join("");
    menu.querySelectorAll("input").forEach(inp=>inp.addEventListener("change",()=>{
      inp.checked?_hidden.delete(inp.dataset.col):_hidden.add(inp.dataset.col);
      applyColVis(); render();
    }));
    const btn=document.getElementById("dt-cols");
    if(btn) btn.addEventListener("click",()=>{ menu.hidden=!menu.hidden; });
  }

  // 초기화는 plants 로드 후 호출
  window._initDataTable = function(plants){
    _plants=plants;
    _sorted=[...plants].sort((a,b)=>((b.final||0)-(a.final||0)));
    render();
    document.getElementById("dt-search").addEventListener("input", render);
    document.getElementById("dt-csv").addEventListener("click", csvDownload);
    document.querySelectorAll("#dt-table th[data-col]").forEach(th=>
      th.addEventListener("click",()=>sort(th.dataset.col)));
    buildColMenu();
    sort("final"); // 초기 정렬: 종합점수 내림차순
  };
})();

/* ---- 마진 주석: 마커 높이에 맞춰 오른쪽 여백에 정렬 ---- */
function placeSidenotes(){
  const lastBottom = new Map();   // 앵커별 직전 노트의 하단 위치(겹침 방지)
  document.querySelectorAll(".snref[data-note]").forEach(ref=>{
    const note = document.getElementById(ref.dataset.note);
    const anchor = note && note.closest(".noteanchor");
    if (!note || !anchor) return;
    if (getComputedStyle(note).position !== "absolute"){ note.style.top = ""; return; }
    let top = ref.getBoundingClientRect().top - anchor.getBoundingClientRect().top;
    const prev = lastBottom.get(anchor);
    if (prev != null && top < prev + 16) top = prev + 16;   // 노트 간 최소 16px 간격
    note.style.top = top + "px";
    lastBottom.set(anchor, top + note.offsetHeight);
  });
}
addEventListener("load", placeSidenotes);
addEventListener("resize", placeSidenotes);
[400, 1000, 1800].forEach(t => setTimeout(placeSidenotes, t));   // reveal 애니메이션 후 재정렬

/* ---- 차트 이미지 라이트박스(클릭 시 크게) ---- */
(function lightbox(){
  const lb = document.createElement("div");
  lb.id = "lightbox";
  lb.innerHTML = '<span class="x">×</span><img alt="확대 이미지">';
  document.body.appendChild(lb);
  const close = () => lb.classList.remove("open");
  lb.addEventListener("click", close);
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  document.querySelectorAll(".card img, figure.wide img, .figrow img").forEach(img => {
    img.addEventListener("click", e => {
      e.stopPropagation();
      lb.querySelector("img").src = img.currentSrc || img.src;
      lb.classList.add("open");
    });
  });
})();
