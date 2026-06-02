/* 원전 입지 적합도 — 인터랙션 */
"use strict";

const OVL = "data/overlays/";
const REGIME_LABEL = {0:"폐쇄독재",1:"선거독재",2:"선거민주",3:"자유민주"};
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
  overlays.pop   = overlayGroup(OVL+"layer_population.png", 0.9).addTo(mapCtx);
  overlays.seis  = overlayGroup(OVL+"layer_seismic.png",    0.95).addTo(mapCtx);
  overlays.water = overlayGroup(OVL+"layer_water.png",      0.9).addTo(mapCtx);

  const plantLayer1 = L.layerGroup().addTo(mapCtx);
  addPlantMarkers(plantLayer1, plants,
    () => ({radius:3,color:"#111",weight:0.6,fillColor:"#ffd400",fillOpacity:0.95}), null);

  bindToggle("t-pop","pop"); bindToggle("t-seis","seis"); bindToggle("t-water","water");
  document.getElementById("t-plants1").addEventListener("change",e=>{
    e.target.checked ? plantLayer1.addTo(mapCtx) : mapCtx.removeLayer(plantLayer1);
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
}

function bindToggle(checkboxId, key){
  document.getElementById(checkboxId).addEventListener("change", e=>{
    e.target.checked ? overlays[key].addTo(mapCtx) : mapCtx.removeLayer(overlays[key]);
  });
}

/* ---- 원전 상세 패널 ---- */
function bar(label, val){
  return `<div class="scorebar"><div class="lab"><span>${label}</span><span>${val.toFixed(0)}</span></div>
    <div class="track"><div class="fill" style="width:${Math.max(2,val)}%;background:${scoreColor(val)}"></div></div></div>`;
}
function showDetail(p){
  const reg = (p.regime!=null) ? p.regime : null;
  const regBadge = reg!=null
    ? `<span class="badge" style="background:${REGIME_COLOR[reg]}33;color:${REGIME_COLOR[reg]};border:1px solid ${REGIME_COLOR[reg]}">${REGIME_LABEL[reg]}</span>`
    : `<span class="badge" style="background:#333;color:#aaa">체제 정보 없음</span>`;
  const reasonHtml = p.reason
    ? `<div class="dreason"><div class="rh">왜 이곳에 지었나</div><p>${p.reason}</p>${
        (p.sources && p.sources.length)
          ? `<div class="rsrc">출처: ${p.sources.slice(0,3).map((u,i)=>`<a href="${u}" target="_blank" rel="noopener">[${i+1}]</a>`).join(" ")}</div>` : ""
      }</div>`
    : `<div class="dreason muted">입지 이유: 신뢰할 출처를 아직 확보하지 못함(미표기)</div>`;
  document.getElementById("plant-detail").innerHTML = `
    <div class="dname">${p.name}</div>
    <div class="dmeta">${p.country} · 건설 ${p.year||"?"}</div>
    <div class="dfinal" style="color:${scoreColor(p.final)}">${p.final.toFixed(1)}<span style="font-size:.9rem;color:#9aa7b8"> / 100</span></div>
    <div style="color:#9aa7b8;font-size:.85rem;margin-bottom:14px">최종 적합도 (5요소 가중합)</div>
    ${bar("지진 안전", p.seismic)}
    ${bar("수원 근접", p.water)}
    ${bar("인구 이격", p.population)}
    ${bar("홍수 안전", p.flood)}
    ${bar("화산 안전", p.volcano)}
    <div style="margin-top:14px">건설 당시 정치체제: ${regBadge}</div>
    ${reasonHtml}
    <div class="dlist">
      가장 가까운 단층/판경계: <b>${p.d_fault_km} km</b><br>
      가장 가까운 수원: <b>${p.d_water_km} km</b><br>
      가장 가까운 인구중심: <b>${p.d_pop_km} km</b><br>
      해발고도: <b>${p.elev_m} m</b> · 가장 가까운 화산: <b>${p.d_volcano_km} km</b>
    </div>`;
}

function buildLegend(){
  document.getElementById("legend-final").innerHTML =
    `<span>부적합</span><span class="bar"></span><span>적합</span>
     <span style="margin-left:18px">· 마커 색 = 원전 최종점수 · 히트맵 = 육지 백분위</span>`;
}

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

/* ---- 마진 주석: 마커 높이에 맞춰 오른쪽 여백에 정렬 ---- */
function placeSidenotes(){
  document.querySelectorAll(".snref[data-note]").forEach(ref=>{
    const note = document.getElementById(ref.dataset.note);
    const anchor = note && note.closest(".noteanchor");
    if (!note || !anchor) return;
    if (getComputedStyle(note).position !== "absolute"){ note.style.top = ""; return; }
    note.style.top = (ref.getBoundingClientRect().top - anchor.getBoundingClientRect().top) + "px";
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
