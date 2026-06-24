/* ═══════════════════════════════════════════════
   Watchy. — app.js v12
   ═══════════════════════════════════════════════ */
'use strict';

const TMDB_KEY  = 'e79205984c6394afec4499019f32f679';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p';

const GENRES=[
  {label:'All',id:null},{label:'Action',id:'28'},{label:'Drama',id:'18'},
  {label:'Comedy',id:'35'},{label:'Horror',id:'27'},{label:'Sci-Fi',id:'878'},
  {label:'Thriller',id:'53'},{label:'Adventure',id:'12'},{label:'Mystery',id:'9648'},
  {label:'Romance',id:'10749'},{label:'Animation',id:'16'},
  {label:'Documentary',id:'99'},{label:'Crime',id:'80'},
];

let GENRE_MAP={};
const _videoCache={};
let _cardHoverTimer=null,_cardPreviewCard=null;

/* ── State ── */
const S={
  page:'home',lastPage:'home',
  scrollPositions:{},
  item:null,heroItems:[],heroIdx:0,heroTimer:null,heroPaused:false,
  favs:JSON.parse(localStorage.getItem('wt_favs')||'[]'),
  hist:JSON.parse(localStorage.getItem('wt_hist')||'[]'),
  viewed:JSON.parse(localStorage.getItem('wt_viewed')||'[]'),
  prog:JSON.parse(localStorage.getItem('wt_prog')||'{}'),
  genre:null,moviesLoaded:false,seriesLoaded:false,
  moviesPage:1,seriesPage:1,moviesLoading:false,seriesLoading:false,
  moviesDone:false,seriesDone:false,
  movieFilters:{sort:'popularity.desc',genre:'',year:'',lang:''},
  seriesFilters:{sort:'popularity.desc',genre:'',year:'',lang:''},
  favSort:'added',
  playerItem:null,playerType:null,playerSeason:1,playerEp:1,
  playerEps:[],playerSeasons:0,progressTimer:null,
  searchOpen:false,searchFilter:'all',
  titleItem:null,titlePrevPage:'home',playerReturnPage:'home',
  discoverItems:[],discoverIdx:0,discoverType:'movie',discoverMood:'random',discoverGenre:null,discoverDir:1,
  dailyPickId:null,
  recentSearches:JSON.parse(localStorage.getItem('wt_recent')||'[]'),
  playerOpenTime:0,playerRuntime:0,
  homeTrending:[],
  hidden:JSON.parse(localStorage.getItem('wt_hide')||'[]'),
  _cardMenuItem:null,
};
(()=>{const p=localStorage.getItem('wt_page');if(p&&p!=='player'){S.page=p==='franchises'?'home':p;S.lastPage=S.page;}})();

/* ── Persist ── */
const save=()=>{
  localStorage.setItem('wt_favs',JSON.stringify(S.favs));
  localStorage.setItem('wt_hist',JSON.stringify(S.hist));
  localStorage.setItem('wt_viewed',JSON.stringify(S.viewed));
  localStorage.setItem('wt_prog',JSON.stringify(S.prog));
  localStorage.setItem('wt_hide',JSON.stringify(S.hidden));
};
const savePage=p=>{if(p!=='player'){localStorage.setItem('wt_page',p);S.lastPage=p;}};
const progKey=(id,t,s,e)=>t==='movie'?`m_${id}`:`tv_${id}_${s}_${e}`;
const getProg=(id,t,s=1,e=1)=>S.prog[progKey(id,t,s,e)]||0;
function saveProg(id,type,season,ep,pct){
  const k=progKey(id,type,season,ep);
  S.prog[k]=Math.min(Math.round(pct),99);
  save();refreshContRow();
}
function getLastEp(id){
  const keys=Object.keys(S.prog).filter(k=>k.startsWith(`tv_${id}_`));
  if(!keys.length)return null;
  const best=keys.reduce((b,k)=>S.prog[k]>S.prog[b]?k:b,keys[0]);
  const p=best.split('_');return{season:parseInt(p[2]),episode:parseInt(p[3])};
}
const isFav=id=>S.favs.some(f=>f.id===id);
function toggleFav(item){
  const i=S.favs.findIndex(f=>f.id===item.id);
  if(i>-1){S.favs.splice(i,1);showToast('Removed from My List');haptic();}
  else{S.favs.unshift({...item,_ts:Date.now()});showToast('Added to My List');haptic();}
  save();refreshFavPage();return isFav(item.id);
}
function addHist(item){
  const i=S.hist.findIndex(h=>h.id===item.id);
  if(i>-1)S.hist.splice(i,1);
  S.hist.unshift({...item,_ts:Date.now()});
  if(S.hist.length>40)S.hist.pop();save();
}
function addViewed(item){
  const type=mtyp(item);
  const i=S.viewed.findIndex(v=>v.id===item.id);
  if(i>-1)S.viewed.splice(i,1);
  S.viewed.unshift({...item,media_type:type,_ts:Date.now()});
  if(S.viewed.length>24)S.viewed.pop();
  save();refreshViewedRow();
}
function hasProgress(id,type){
  if(type==='movie')return getProg(id,'movie')>5;
  return Object.keys(S.prog).some(k=>k.startsWith(`tv_${id}_`)&&S.prog[k]>5);
}
function haptic(kind='light'){
  if(!navigator.vibrate)return;
  navigator.vibrate(kind==='heavy'?[10,35,10]:6);
}
function clearProgress(id,type){
  if(type==='movie')delete S.prog[`m_${id}`];
  else Object.keys(S.prog).filter(k=>k.startsWith(`tv_${id}_`)).forEach(k=>delete S.prog[k]);
  save();refreshContRow();
}
function isHidden(id){return S.hidden.includes(id);}
function hideTitle(id){
  if(!S.hidden.includes(id)){S.hidden.push(id);if(S.hidden.length>200)S.hidden.shift();save();}
}
function playItem(item){
  const type=mtyp(item);
  if(type==='tv'){const last=getLastEp(item.id);openPlayer(item,'tv',last?.season||1,last?.episode||1);}
  else openPlayer(item,'movie');
}
function playFromStart(item){
  const type=mtyp(item);
  if(type==='tv')openPlayer(item,'tv',1,1);
  else openPlayer(item,'movie');
}
async function isPosterOfflineReady(path){
  if(!path||!('caches' in window))return false;
  try{
    const url=`${TMDB_IMG}/w342${path}`;
    const hit=await caches.match(url);
    return !!hit;
  }catch(_){return false;}
}
function bindSwipeRemove(el,onRemove){
  let sx=0,sy=0,tracking=false;
  el.addEventListener('touchstart',e=>{
    if(e.touches.length!==1)return;
    sx=e.touches[0].clientX;sy=e.touches[0].clientY;tracking=true;
    el.classList.remove('swipe-out');
  },{passive:true});
  el.addEventListener('touchmove',e=>{
    if(!tracking)return;
    const dx=e.touches[0].clientX-sx,dy=e.touches[0].clientY-sy;
    if(Math.abs(dx)>Math.abs(dy)&&dx<-20){
      el.style.transform=`translateX(${Math.max(dx,-90)}px)`;
      el.style.opacity=String(1+dx/120);
    }
  },{passive:true});
  el.addEventListener('touchend',e=>{
    if(!tracking)return;tracking=false;
    const dx=e.changedTouches[0].clientX-sx;
    el.style.transform='';el.style.opacity='';
    if(dx<-70){
      el.classList.add('swipe-out');
      haptic('heavy');
      setTimeout(()=>onRemove(),280);
    }
  },{passive:true});
}
let _lpTimer=null,_lpCard=null;
function bindCardLongPress(card,item,opts={}){
  const start=e=>{
    if(e.target.closest('.card-fav,.cont-remove-btn'))return;
    _lpCard=card;
    clearTimeout(_lpTimer);
    _lpTimer=setTimeout(()=>{
      haptic('heavy');
      openCardMenu(item,opts,e);
    },520);
  };
  const cancel=()=>{clearTimeout(_lpTimer);_lpCard=null;};
  card.addEventListener('touchstart',start,{passive:true});
  card.addEventListener('mousedown',start);
  card.addEventListener('touchend',cancel);
  card.addEventListener('touchmove',cancel,{passive:true});
  card.addEventListener('mouseup',cancel);
  card.addEventListener('mouseleave',cancel);
}
function openCardMenu(item,opts,e){
  const menu=document.getElementById('card-menu');if(!menu)return;
  S._cardMenuItem=item;
  const favLbl=menu.querySelector('[data-fav-label]');
  if(favLbl)favLbl.textContent=isFav(item.id)?'In My List':'Add to List';
  const rem=menu.querySelector('[data-action="remove"]');
  const onRem=opts.onRemove||item._onRemove;
  if(rem)rem.style.display=onRem?'flex':'none';
  menu.classList.add('open');
  menu.setAttribute('aria-hidden','false');
  const x=e?.touches?.[0]?.clientX??e?.clientX??window.innerWidth/2;
  const y=e?.touches?.[0]?.clientY??e?.clientY??window.innerHeight/2;
  const mw=200,mh=220;
  menu.style.left=`${Math.min(Math.max(12,x-mw/2),window.innerWidth-mw-12)}px`;
  menu.style.top=`${Math.min(Math.max(12,y-mh),window.innerHeight-mh-12)}px`;
}
function closeCardMenu(){
  const menu=document.getElementById('card-menu');
  menu?.classList.remove('open');
  menu?.setAttribute('aria-hidden','true');
  S._cardMenuItem=null;
}
function handleCardMenuAction(action){
  const item=S._cardMenuItem;if(!item)return;
  closeCardMenu();
  if(action==='play'){haptic();playItem(item);}
  if(action==='info'){haptic();openTitlePage(item);}
  if(action==='fav'){haptic();toggleFav(item);}
  if(action==='share'){haptic();shareCard(item);}
  if(action==='remove'&&item._onRemove){haptic('heavy');item._onRemove();}
}
function buildFilterChips(selectId,chipsId,scroll=false){
  const sel=document.getElementById(selectId);
  const box=document.getElementById(chipsId);
  if(!sel||!box)return;
  box.innerHTML='';
  [...sel.options].forEach(opt=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className=`filter-chip${opt.value===sel.value?' active':''}`;
    btn.textContent=opt.textContent;
    btn.dataset.value=opt.value;
    btn.addEventListener('click',()=>{
      sel.value=opt.value;
      box.querySelectorAll('.filter-chip').forEach(b=>b.classList.toggle('active',b.dataset.value===opt.value));
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      haptic();
    });
    box.appendChild(btn);
  });
  if(scroll)box.classList.add('filter-chips-scroll');
}
function syncFilterChips(selectId){
  const sel=document.getElementById(selectId);
  const box=document.querySelector(`.filter-chips[data-for="${selectId}"]`);
  if(!sel||!box)return;
  box.querySelectorAll('.filter-chip').forEach(b=>b.classList.toggle('active',b.dataset.value===sel.value));
}
function updateTitleWatchButtons(item,type){
  const watchBtn=document.getElementById('tp-watch-btn');
  const restartBtn=document.getElementById('tp-restart-btn');
  if(!watchBtn)return;
  const prog=getProg(item.id,type);
  const has=hasProgress(item.id,type);
  if(has){
    watchBtn.innerHTML=`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Resume${prog>5?` (${prog}%)`:''}`;
    if(restartBtn)restartBtn.style.display='inline-flex';
  }else{
    watchBtn.innerHTML=`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Watch Now`;
    if(restartBtn)restartBtn.style.display='none';
  }
  watchBtn.onclick=()=>{haptic();playItem(item);};
  if(restartBtn){
    restartBtn.onclick=()=>{
      haptic('heavy');
      clearProgress(item.id,type);
      playFromStart(item);
      showToast('Starting from the beginning');
    };
  }
}
async function getContinueThumb(item){
  const type=mtyp(item);
  if(type==='movie')return imgP(item.poster_path);
  const last=getLastEp(item.id);
  if(!last)return imgP(item.poster_path);
  const data=await A.season(item.id,last.season);
  const ep=data?.episodes?.find(e=>e.episode_number===last.episode);
  return ep?.still_path?`${TMDB_IMG}/w300${ep.still_path}`:imgP(item.poster_path);
}

/* ── TMDB API ── */
async function api(path,params={}){
  const url=new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key',TMDB_KEY);
  url.searchParams.set('language','en-US');
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  try{const r=await fetch(url);if(!r.ok)throw 0;return await r.json();}
  catch(_){return null;}
}
const A={
  trending:()=>api('/trending/all/week').then(d=>d?.results||[]),
  movies:()=>api('/movie/popular').then(d=>d?.results||[]),
  tv:()=>api('/tv/popular').then(d=>d?.results||[]),
  topRated:()=>api('/movie/top_rated').then(d=>d?.results||[]),
  nowPlaying:()=>api('/movie/now_playing').then(d=>d?.results||[]),
  topTV:()=>api('/tv/top_rated').then(d=>d?.results||[]),
  details:(id,t)=>api(`/${t}/${id}`,{append_to_response:'credits,belongs_to_collection,videos,watch/providers,external_ids,images'}),
  season:(id,s)=>api(`/tv/${id}/season/${s}`),
  search:q=>api('/search/multi',{query:q}).then(d=>(d?.results||[]).filter(r=>r.media_type!=='person')),
  byGenre:(g,t='movie')=>api(`/discover/${t}`,{with_genres:g,sort_by:'popularity.desc'}).then(d=>d?.results||[]),
  upcoming:()=>api('/movie/upcoming').then(d=>d?.results||[]),
  discoverFiltered:(t,params,page=1)=>api(`/discover/${t}`,{page,...params}).then(d=>d?.results||[]),
  genreLists:async()=>{
    const [m,tv]=await Promise.all([api('/genre/movie/list'),api('/genre/tv/list')]);
    [...(m?.genres||[]),...(tv?.genres||[])].forEach(g=>{GENRE_MAP[g.id]=g.name;});
  },
  similar:(id,t)=>api(`/${t}/${id}/similar`).then(d=>d?.results||[]),
  recommended:(id,t)=>api(`/${t}/${id}/recommendations`).then(d=>d?.results||[]),
  collection:id=>api(`/collection/${id}`).then(d=>d?.parts||[]),
  discoverM:(page)=>api('/discover/movie',{sort_by:'vote_average.desc','vote_count.gte':'500',page}).then(d=>d?.results||[]),
  discoverTV:(page)=>api('/discover/tv',{sort_by:'vote_average.desc','vote_count.gte':'200',page}).then(d=>d?.results||[]),
  person:(id)=>api(`/person/${id}`,{append_to_response:'combined_credits'}),
  videos:(id,t)=>api(`/${t}/${id}/videos`).then(d=>d?.results||[]),
};

const ttl=i=>i.title||i.name||'Untitled';
const yr=i=>(i.release_date||i.first_air_date||'').slice(0,4);
const mtyp=i=>i.media_type||(i.first_air_date?'tv':'movie');
const imgP=p=>p?`${TMDB_IMG}/w342${p}`:null;
const imgB=p=>p?`${TMDB_IMG}/w1280${p}`:null;
const imgFace=p=>p?`${TMDB_IMG}/w185${p}`:null;
function genreLabel(ids){
  if(!ids?.length)return'';
  const id=ids.find(gid=>GENRE_MAP[gid])||ids[0];
  return GENRE_MAP[id]||GENRES.find(g=>g.id&&ids.includes(parseInt(g.id)))?.label||'';
}
function dailySeed(){
  const d=new Date();
  return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate();
}
function pickDaily(items){
  if(!items.length)return null;
  const seed=dailySeed();
  return items[seed%items.length];
}
function buildYearOptions(selectId){
  const el=document.getElementById(selectId);if(!el)return;
  const cur=el.value;
  const y=new Date().getFullYear();
  for(let i=y;i>=1970;i--){
    const o=document.createElement('option');
    o.value=String(i);o.textContent=String(i);
    el.appendChild(o);
  }
  if(cur)el.value=cur;
}
function populateGenreSelect(selectId){
  const el=document.getElementById(selectId);if(!el)return;
  const cur=el.value;
  Object.entries(GENRE_MAP).sort((a,b)=>a[1].localeCompare(b[1])).forEach(([id,name])=>{
    const o=document.createElement('option');
    o.value=id;o.textContent=name;
    el.appendChild(o);
  });
  if(cur)el.value=cur;
  const prefix=selectId.replace('-genre','');
  buildFilterChips(selectId,`${prefix}-genre-chips`,true);
}
function fmtScore(v){
  if(!v)return'';
  const pct=Math.round(v*10);
  const cls=pct>=70?'score-fresh':pct>=50?'score-mixed':'score-rotten';
  return`<span class="score-pill ${cls}">${pct}%</span>`;
}
function fmtRuntime(mins){
  if(!mins)return'';
  const h=Math.floor(mins/60),m=mins%60;
  return h>0?`${h}h ${m}m`:`${m}m`;
}
function allowTrailerAutoplay(){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return false;
  if(window.innerWidth<=800)return false;
  const conn=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  if(conn&&(conn.saveData||conn.effectiveType==='slow-2g'||conn.effectiveType==='2g'))return false;
  return true;
}
function ytEmbedUrl(key,{mute=true,loop=true,autoplay=true}={}){
  const p=new URLSearchParams({
    autoplay:autoplay?'1':'0',
    mute:mute?'1':'0',
    controls:'0',
    rel:'0',
    modestbranding:'1',
    playsinline:'1',
    enablejsapi:'1',
  });
  if(loop)p.set('loop','1'),p.set('playlist',key);
  return`https://www.youtube.com/embed/${key}?${p}`;
}
async function getTrailerKey(id,type){
  const k=`${type}_${id}`;
  if(_videoCache[k]!==undefined)return _videoCache[k];
  const videos=await A.videos(id,type);
  const trailer=videos.find(v=>v.type==='Trailer'&&v.site==='YouTube')||videos.find(v=>v.site==='YouTube');
  _videoCache[k]=trailer?.key||null;
  return _videoCache[k];
}
function extractAmbientColor(url,onColor){
  if(!url){onColor(null);return;}
  const img=new Image();
  img.crossOrigin='anonymous';
  img.onload=()=>{
    try{
      const c=document.createElement('canvas');
      c.width=24;c.height=24;
      const ctx=c.getContext('2d');
      ctx.drawImage(img,0,0,24,24);
      const d=ctx.getImageData(0,0,24,24).data;
      let r=0,g=0,b=0,n=0;
      for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}
      onColor(`rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})`);
    }catch(_){onColor(null);}
  };
  img.onerror=()=>onColor(null);
  img.src=url;
}
function setAmbientGlow(elProp,url){
  extractAmbientColor(url,color=>{
    if(!color)return;
    const m=color.match(/\d+/g);
    if(!m)return;
    document.documentElement.style.setProperty(elProp,`rgba(${m[0]},${m[1]},${m[2]},0.38)`);
  });
}
function stopCardPreview(){
  clearTimeout(_cardHoverTimer);
  if(_cardPreviewCard){
    const prev=_cardPreviewCard.querySelector('.card-preview');
    if(prev)prev.remove();
    const img=_cardPreviewCard.querySelector('.card-img');
    if(img)img.style.opacity='';
    _cardPreviewCard=null;
  }
}
function bindCardHoverPreview(card,item){
  if(!allowTrailerAutoplay())return;
  if(!window.matchMedia('(hover:hover) and (pointer:fine)').matches)return;
  card.addEventListener('mouseenter',()=>{
    clearTimeout(_cardHoverTimer);
    _cardHoverTimer=setTimeout(async()=>{
      stopCardPreview();
      _cardPreviewCard=card;
      const type=mtyp(item);
      const key=await getTrailerKey(item.id,type);
      if(!key||_cardPreviewCard!==card)return;
      const wrap=document.createElement('div');
      wrap.className='card-preview';
      wrap.innerHTML=`<iframe src="${ytEmbedUrl(key)}" allow="autoplay; encrypted-media" loading="lazy" title=""></iframe>`;
      card.querySelector('.card-img-w')?.appendChild(wrap);
      const img=card.querySelector('.card-img');
      if(img)img.style.opacity='.15';
    },420);
  });
  card.addEventListener('mouseleave',stopCardPreview);
}

/* ── Hash routing helpers ── */
function clearHash(){
  if(window.location.hash){
    history.replaceState(null,'',window.location.pathname+window.location.search);
  }
}
function setHash(path,push=false){
  const url=window.location.pathname+window.location.search+'#'+path;
  if(push)history.pushState({watchy:path},'',url);
  else history.replaceState({watchy:path},'',url);
}
function resolvePage(name){
  if(name&&document.getElementById(`page-${name}`))return name;
  return'home';
}
function goBack(){
  if(S.page==='player'){
    const dest=resolvePage(S.playerReturnPage||S.lastPage||'home');
    stopPlayer();
    clearHash();
    goTo(dest,false,true);
    return;
  }
  if(S.page==='person'){
    if(S.titleItem)goTo('title',false,true);
    else{clearHash();goTo(resolvePage(S.lastPage||'home'),false,true);}
    return;
  }
  if(S.page==='title'){
    clearHash();
    const dest=resolvePage(S.titlePrevPage||'home');
    if(dest==='person')goTo('person',false,true);
    else goTo(dest,false,true);
    return;
  }
}

/* ── Routing ── */
function goTo(name,skipSave=false,restoreScroll=false){
  if(S.page==='player'&&name!=='player')stopPlayer();
  clearToast();closeSearch();
  if(S.page&&S.page!=='player'&&S.page!=='title'&&S.page!=='person'){
    S.scrollPositions[S.page]=window.scrollY;
  }
  const cur=document.querySelector('.page.active');
  const next=document.getElementById(`page-${name}`);
  if(!next){name='home';}
  const nextEl=document.getElementById(`page-${name}`);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const apply=()=>{
    document.querySelectorAll('.page').forEach(p=>{
      p.classList.remove('active','page-exit','page-enter');
    });
    nextEl?.classList.add('active');
    if(!reduced)nextEl?.classList.add('page-enter');
    document.querySelectorAll('.nav-link[data-page]').forEach(l=>l.classList.toggle('active',l.dataset.page===name));
    document.querySelectorAll('.bot-nav-item[data-page]').forEach(l=>l.classList.toggle('active',l.dataset.page===name));
    const nav=document.getElementById('nav'),bot=document.querySelector('.bot-nav');
    if(name==='player'){
      nav.classList.add('hidden');
      if(bot)bot.style.display='none';
    }else{
      nav.classList.remove('hidden');
      if(bot&&window.innerWidth<=800)bot.style.display='flex';
    }
    S.page=name;
    if(!skipSave)savePage(name);
    if(restoreScroll&&S.scrollPositions[name]!==undefined){
      requestAnimationFrame(()=>window.scrollTo(0,S.scrollPositions[name]));
    }else{
      window.scrollTo(0,0);
    }
  };
  if(cur&&cur!==nextEl&&!reduced){
    cur.classList.add('page-exit');
    setTimeout(apply,180);
  }else apply();
}

/* ── Toast ── */
let _tt;
const showToast=msg=>{
  const el=document.getElementById('toast');if(!el)return;
  el.textContent=msg;el.classList.add('show');
  clearTimeout(_tt);_tt=setTimeout(()=>el.classList.remove('show'),2500);
};
const clearToast=()=>{clearTimeout(_tt);document.getElementById('toast')?.classList.remove('show');};
const greeting=()=>{
  const h=new Date().getHours();
  if(h<5)return'Still up?';if(h<12)return'Good morning.';
  if(h<17)return'Good afternoon.';if(h<21)return'Good evening.';
  return'Good night.';
};

/* ── Search ── */
function openSearch(){
  S.searchOpen=true;
  const ov=document.getElementById('search-overlay');
  ov.classList.add('open');
  document.body.style.overflow='hidden';
  renderRecentSearches();
  setTimeout(()=>document.getElementById('search-overlay-input')?.focus(),200);
}
function closeSearch(){
  if(!S.searchOpen)return;S.searchOpen=false;
  const ov=document.getElementById('search-overlay');
  ov?.classList.remove('open');
  document.body.style.overflow='';
  const inp=document.getElementById('search-overlay-input');if(inp)inp.value='';
  const grid=document.getElementById('search-overlay-results');if(grid)grid.innerHTML='';
  const countEl=document.getElementById('search-result-count');if(countEl)countEl.textContent='';
  document.getElementById('search-recent')?.style.setProperty('display','none');
  document.getElementById('search-icon-btn')?.focus();
}
function saveRecentSearch(q){
  const term=q.trim();if(!term||term.length<2)return;
  S.recentSearches=S.recentSearches.filter(s=>s.toLowerCase()!==term.toLowerCase());
  S.recentSearches.unshift(term);
  if(S.recentSearches.length>8)S.recentSearches.pop();
  localStorage.setItem('wt_recent',JSON.stringify(S.recentSearches));
}
function renderRecentSearches(){
  const box=document.getElementById('search-recent');
  const list=document.getElementById('search-recent-list');
  const q=document.getElementById('search-overlay-input')?.value?.trim();
  if(!box||!list||q)return;
  if(!S.recentSearches.length){box.style.display='none';return;}
  box.style.display='block';
  list.innerHTML='';
  S.recentSearches.forEach(term=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='search-recent-chip';
    btn.textContent=term;
    btn.addEventListener('click',()=>{
      const inp=document.getElementById('search-overlay-input');
      if(inp){inp.value=term;handleSearchInput(term);}
    });
    list.appendChild(btn);
  });
}
function trapSearchFocus(e){
  if(!S.searchOpen||e.key!=='Tab')return;
  const f=document.querySelectorAll('#search-overlay button,#search-overlay input');
  if(!f.length)return;
  const items=[...f];
  const first=items[0],last=items[items.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
}
let _sd;
function handleSearchInput(q){
  clearTimeout(_sd);
  const grid=document.getElementById('search-overlay-results');
  const countEl=document.getElementById('search-result-count');
  const recentBox=document.getElementById('search-recent');
  if(!q.trim()){
    if(grid)grid.innerHTML='';
    if(countEl)countEl.textContent='';
    renderRecentSearches();
    return;
  }
  if(recentBox)recentBox.style.display='none';
  _sd=setTimeout(async()=>{
    if(grid){grid.innerHTML='';skels(6).forEach(s=>grid.appendChild(s));}
    if(countEl)countEl.textContent='';
    const results=await A.search(q);
    saveRecentSearch(q);
    if(!grid)return;grid.innerHTML='';
    let filtered=results;
    if(S.searchFilter==='movie')filtered=results.filter(r=>mtyp(r)==='movie');
    if(S.searchFilter==='tv')filtered=results.filter(r=>mtyp(r)==='tv');
    if(!filtered.length){
      if(countEl)countEl.textContent='';
      grid.innerHTML=emptyHTML('Nothing found.','Try a different filter or search term.');
      return;
    }
    if(countEl)countEl.textContent=`${filtered.length} result${filtered.length!==1?'s':''}`;
    filtered.slice(0,20).forEach(item=>grid.appendChild(makeCard(item)));
  },380);
}
function setSearchFilter(f){
  S.searchFilter=f;
  document.querySelectorAll('.search-filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.f===f));
  const countEl=document.getElementById('search-result-count');
  if(countEl)countEl.textContent='';
  const q=document.getElementById('search-overlay-input')?.value;
  if(q?.trim())handleSearchInput(q);
}

/* ── Cards ── */
function makeCard(item,opts={}){
  const type=mtyp(item),t=ttl(item),y=yr(item);
  const src=opts.thumbUrl||imgP(item.poster_path),fav=isFav(item.id);
  const pct=opts.showProgress?getProg(item.id,type):0;
  const wrap=document.createElement('div');
  wrap.className=`card${opts.twoLine?' card-2line':''}`;
  wrap.dataset.id=item.id;
  const imgW=document.createElement('div');imgW.className='card-img-w';
  if(src){
    const img=document.createElement('img');
    img.className='card-img';img.src=src;img.alt=t;img.loading='lazy';
    imgW.appendChild(img);
    if(item.poster_path)isPosterOfflineReady(item.poster_path).then(ok=>{
      if(ok){const b=document.createElement('span');b.className='card-offline-badge';b.textContent='Offline';imgW.appendChild(b);}
    });
  }else{
    const ph=document.createElement('div');ph.className='card-ph';
    ph.innerHTML=`<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="m7 8 4 3-4 3V8z"/></svg><span>${t.slice(0,10)}</span>`;
    imgW.appendChild(ph);
  }
  if(opts.rank){
    const badge=document.createElement('div');
    badge.className=`rank-badge${opts.rank<=3?' rank-top':''}`;
    badge.textContent=`#${opts.rank}`;
    imgW.appendChild(badge);
  }
  const gl=genreLabel(item.genre_ids);
  const badges=document.createElement('div');
  badges.className='card-badges';
  badges.innerHTML=`<span class="card-badge-score">${item.vote_average?fmtScore(item.vote_average):''}</span>${gl?`<span class="card-badge-genre">${gl}</span>`:''}`;
  imgW.appendChild(badges);
  const ov=document.createElement('div');ov.className='card-ov';
  ov.innerHTML=`<div class="card-play-btn"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>`;
  imgW.appendChild(ov);
  const favBtn=document.createElement('button');
  favBtn.className=`card-fav${fav?' active':''}`;
  favBtn.innerHTML=`<svg width="12" height="12" viewBox="0 0 24 24" fill="${fav?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l8.84 8.84 8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  imgW.appendChild(favBtn);
  if(opts.showProgress&&pct>0){
    const r=10,circ=2*Math.PI*r,off=circ*(1-pct/100);
    const ring=document.createElement('div');ring.className='card-ring';
    ring.innerHTML=`<svg width="26" height="26" viewBox="0 0 26 26"><circle class="ring-bg" cx="13" cy="13" r="${r}"/><circle class="ring-fill" cx="13" cy="13" r="${r}" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>`;
    imgW.appendChild(ring);
  }
  wrap.appendChild(imgW);
  const info=document.createElement('div');info.className='card-info';
  info.innerHTML=`<div class="card-title">${t}</div><div class="card-meta">${y}${type==='tv'?' · Series':''}</div>`;
  wrap.appendChild(info);
  wrap.addEventListener('click',e=>{if(e.target.closest('.card-fav'))return;closeSearch();openTitlePage(item);});
  favBtn.addEventListener('click',e=>{
    e.stopPropagation();
    const now=toggleFav(item);
    favBtn.classList.toggle('active',now);
    favBtn.querySelector('svg').setAttribute('fill',now?'currentColor':'none');
  });
  bindCardLongPress(wrap,item,opts);
  bindCardHoverPreview(wrap,item);
  return wrap;
}
const skels=(n=8)=>Array.from({length:n},()=>{const d=document.createElement('div');d.className='card-sk';return d;});
async function fillRail(el,fn,opts={}){
  el.innerHTML='';skels(8).forEach(s=>el.appendChild(s));
  const items=await fn();el.innerHTML='';
  const filtered=S.genre?items.filter(i=>i.genre_ids?.includes(parseInt(S.genre))):items;
  const list=filtered.length?filtered:items;
  list.forEach((item,i)=>el.appendChild(makeCard(item,{...opts,rank:opts.ranked?i+1:undefined})));
}
async function fillGrid(el,fn){
  el.innerHTML='<div class="card-sk" style="height:228px"></div>'.repeat(12);
  const items=await fn(1);el.innerHTML='';
  if(!items.length){el.innerHTML=emptyHTML('Nothing here yet.','Good things take time.');return;}
  items.forEach(item=>el.appendChild(makeCard(item)));
}
async function appendGrid(el,fn,page){
  const loader=el.nextElementSibling;
  if(loader?.classList.contains('load-more-sentinel'))loader.classList.add('loading');
  const items=await fn(page);
  if(loader?.classList.contains('load-more-sentinel'))loader.classList.remove('loading');
  if(!items?.length)return false;
  items.forEach(item=>el.appendChild(makeCard(item)));
  return true;
}
const pagedfetch={
  movies:page=>api('/movie/popular',{page}).then(d=>d?.results||[]),
  nowPlaying:page=>api('/movie/now_playing',{page}).then(d=>d?.results||[]),
  tv:page=>api('/tv/popular',{page}).then(d=>d?.results||[]),
  topTV:page=>api('/tv/top_rated',{page}).then(d=>d?.results||[]),
};
function initInfiniteScroll(sentinelId,onLoad){
  const sentinel=document.getElementById(sentinelId);if(!sentinel)return;
  const obs=new IntersectionObserver(entries=>{if(entries[0].isIntersecting)onLoad();},{rootMargin:'200px'});
  obs.observe(sentinel);return obs;
}
const emptyHTML=(h,p,action=null)=>{
  const btn=action?`<button class="empty-action" type="button" data-empty-goto="${action.goto}">${action.label}</button>`:'';
  return`<div class="empty"><div class="empty-icon">◻</div><div class="empty-h">${h}</div><div class="empty-p">${p}</div>${btn}</div>`;
};
function bindEmptyActions(root){
  root?.querySelectorAll('[data-empty-goto]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const p=btn.dataset.emptyGoto;
      if(p)document.querySelector(`[data-page="${p}"]`)?.click()||document.querySelector(`.bot-nav-item[data-page="${p}"]`)?.click();
    });
  });
}

/* ── Hero ── */
function setHeroVideo(key){
  const wrap=document.getElementById('hero-video');
  const bg=document.getElementById('hero-bg');
  if(!wrap)return;
  if(!key||!allowTrailerAutoplay()){
    wrap.classList.remove('active');
    wrap.innerHTML='';
    bg?.classList.remove('has-video');
    return;
  }
  wrap.innerHTML=`<iframe src="${ytEmbedUrl(key)}" allow="autoplay; encrypted-media" title=""></iframe>`;
  wrap.classList.add('active');
  bg?.classList.add('has-video');
}
function setHeroBg(url){
  const cur=document.getElementById('hero-bg');
  const next=document.getElementById('hero-bg-next');
  if(!cur||!next)return;
  const bg=url||'linear-gradient(135deg,#141416,#09090b)';
  if(!url){cur.style.backgroundImage=bg;cur.style.opacity='1';next.style.opacity='0';return;}
  next.style.backgroundImage=`url(${bg})`;
  next.style.opacity='1';
  cur.style.opacity='0';
  setTimeout(()=>{
    cur.style.backgroundImage=`url(${bg})`;
    cur.style.opacity='1';
    next.style.opacity='0';
  },800);
  setAmbientGlow('--hero-glow',bg);
}
async function renderHero(item){
  setHeroBg(item.backdrop_path?imgB(item.backdrop_path):null);
  const type=mtyp(item);
  const key=await getTrailerKey(item.id,type);
  setHeroVideo(key);
  document.getElementById('hero-greeting').textContent=greeting();
  document.getElementById('hero-title').textContent=ttl(item);
  document.getElementById('hero-type').textContent=type==='tv'?'Series':'Film';
  document.getElementById('hero-year').textContent=yr(item);
  document.getElementById('hero-score').innerHTML=fmtScore(item.vote_average);
  document.getElementById('hero-overview').textContent=(item.overview||'').slice(0,200)+((item.overview?.length||0)>200?'…':'');
  const dailyBadge=document.getElementById('hero-daily-badge');
  if(dailyBadge)dailyBadge.style.display=item.id===S.dailyPickId?'inline':'none';
  document.querySelectorAll('.hero-dot').forEach((d,i)=>d.classList.toggle('active',i===S.heroIdx));
}
function setupHero(items){
  const daily=pickDaily(items);
  S.dailyPickId=daily?.id||null;
  let pool=[...items];
  if(daily){
    pool=pool.filter(i=>i.id!==daily.id);
    pool.unshift(daily);
  }
  S.heroItems=pool.slice(0,7);S.heroIdx=0;renderHero(S.heroItems[0]);
  const dw=document.getElementById('hero-dots');dw.innerHTML='';
  S.heroItems.forEach((_,i)=>{
    const d=document.createElement('button');
    d.className=`hero-dot${i===0?' active':''}`;
    d.setAttribute('aria-label',`Show slide ${i+1}`);
    d.addEventListener('click',()=>{S.heroIdx=i;renderHero(S.heroItems[i]);startHeroTimer();});
    dw.appendChild(d);
  });
  startHeroTimer();
  const hero=document.getElementById('hero');
  if(hero&&!hero.dataset.hoverBound){
    hero.dataset.hoverBound='1';
    hero.addEventListener('mouseenter',pauseHeroTimer);
    hero.addEventListener('mouseleave',resumeHeroTimer);
    hero.addEventListener('focusin',pauseHeroTimer);
    hero.addEventListener('focusout',resumeHeroTimer);
  }
}
function pauseHeroTimer(){S.heroPaused=true;clearInterval(S.heroTimer);}
function resumeHeroTimer(){if(!S.heroPaused)return;S.heroPaused=false;startHeroTimer();}
function startHeroTimer(){
  clearInterval(S.heroTimer);
  if(S.heroPaused||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  S.heroTimer=setInterval(()=>{
    if(S.heroPaused||S.page!=='home')return;
    S.heroIdx=(S.heroIdx+1)%S.heroItems.length;
    renderHero(S.heroItems[S.heroIdx]);
  },7000);
}
function renderDiscoverVideo(key){
  const vidWrap=document.getElementById('discover-video');
  if(!vidWrap)return;
  if(!key||!allowTrailerAutoplay()){
    vidWrap.classList.remove('active');
    vidWrap.innerHTML='';
    return;
  }
  vidWrap.innerHTML=`<iframe src="${ytEmbedUrl(key)}" allow="autoplay; encrypted-media" title=""></iframe>`;
  vidWrap.classList.add('active');
}
async function refreshHomeRails(){
  const g=S.genre;
  const filter=i=>!g||i.genre_ids?.includes(parseInt(g));
  fillRail(document.getElementById('rail-trending'),()=>A.trending().then(r=>r.filter(filter)),{ranked:true});
  fillRail(document.getElementById('rail-movies'),()=>A.movies().then(r=>r.filter(filter)));
  fillRail(document.getElementById('rail-tv'),()=>A.tv().then(r=>r.filter(filter)));
  fillRail(document.getElementById('rail-toprated'),()=>A.topRated().then(r=>r.filter(filter)));
  fillRail(document.getElementById('rail-nowplaying'),()=>A.nowPlaying().then(r=>r.filter(filter)));
  fillRail(document.getElementById('rail-upcoming'),()=>A.upcoming().then(r=>r.filter(filter)));
}
async function refreshHomeContent(){
  const trending=await A.trending();
  S.homeTrending=trending;
  if(trending.length)setupHero(trending);
  refreshContRow();
  refreshViewedRow();
  await refreshHomeRails();
  loadBecauseRail();
  showToast('Home refreshed');
}
function initHomePullRefresh(){
  const home=document.getElementById('page-home');if(!home)return;
  const hint=document.getElementById('home-pull-hint');
  let sy=0,pulling=false,refreshing=false;
  home.addEventListener('touchstart',e=>{
    if(S.page!=='home'||refreshing||window.scrollY>8)return;
    sy=e.touches[0].clientY;pulling=true;
  },{passive:true});
  home.addEventListener('touchmove',e=>{
    if(!pulling||refreshing)return;
    const dy=e.touches[0].clientY-sy;
    if(dy>0&&window.scrollY<=0){
      hint?.classList.toggle('visible',dy>55);
      hint?.classList.toggle('ready',dy>90);
    }
  },{passive:true});
  home.addEventListener('touchend',async e=>{
    if(!pulling)return;pulling=false;
    const dy=e.changedTouches[0].clientY-sy;
    if(dy>90&&!refreshing&&S.page==='home'){
      refreshing=true;
      hint?.classList.add('loading');
      await refreshHomeContent();
      hint?.classList.remove('visible','ready','loading');
      refreshing=false;
    }else hint?.classList.remove('visible','ready');
  },{passive:true});
}
function setupGenres(){
  const bar=document.getElementById('mood-bar');if(!bar)return;
  bar.innerHTML='<span class="mood-label">Genre</span>';
  GENRES.forEach(g=>{
    const btn=document.createElement('button');
    btn.className=`mood-chip${!g.id?' active':''}`;btn.textContent=g.label;
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.mood-chip').forEach(c=>c.classList.remove('active'));
      btn.classList.add('active');S.genre=g.id;
      refreshHomeRails();
    });
    bar.appendChild(btn);
  });
}
async function loadBecauseRail(){
  const sec=document.getElementById('because-sec'),rail=document.getElementById('rail-because');
  const titleEl=document.getElementById('because-title');
  if(!sec||!rail)return;
  const last=S.hist.find(h=>hasProgress(h.id,mtyp(h)))||S.viewed[0];
  const source=last||S.viewed[0];
  if(!source){sec.style.display='none';return;}
  const type=mtyp(source);
  const rec=await A.recommended(source.id,type);
  const items=rec.filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i&&v.id!==source.id).slice(0,14);
  if(!items.length){sec.style.display='none';return;}
  titleEl.textContent=`Because You Watched ${ttl(source)}`;
  rail.innerHTML='';
  items.forEach(p=>{p.media_type=type;rail.appendChild(makeCard(p));});
  sec.style.display='block';
}
async function loadHome(){
  const trending=await A.trending();
  S.homeTrending=trending;
  if(trending.length)setupHero(trending);
  refreshContRow();
  refreshViewedRow();
  refreshHomeRails();
  loadBecauseRail();
}
function wrapRailCard(item,opts={}){
  const wrap=document.createElement('div');
  wrap.className='cont-item';
  wrap.appendChild(makeCard(item,opts));
  return wrap;
}
function addRailRemove(wrap,item,onRemove){
  item._onRemove=onRemove;
  const xBtn=document.createElement('button');
  xBtn.className='cont-remove-btn';
  xBtn.setAttribute('aria-label','Remove');
  xBtn.innerHTML='✕';
  xBtn.addEventListener('click',e=>{e.stopPropagation();haptic('heavy');onRemove();});
  wrap.appendChild(xBtn);
  bindSwipeRemove(wrap,onRemove);
  item._onRemove=onRemove;
}
function refreshViewedRow(){
  const sec=document.getElementById('viewed-sec'),rail=document.getElementById('rail-viewed');
  if(!sec||!rail)return;
  if(!S.viewed.length){sec.style.display='none';return;}
  sec.style.display='block';rail.innerHTML='';
  S.viewed.slice(0,14).forEach(item=>{
    const wrap=wrapRailCard(item);
    addRailRemove(wrap,item,()=>{
      const idx=S.viewed.findIndex(v=>v.id===item.id);
      if(idx>-1)S.viewed.splice(idx,1);
      save();refreshViewedRow();
      showToast('Removed from Recently Viewed');
    });
    rail.appendChild(wrap);
  });
}
function refreshContRow(){
  const sec=document.getElementById('continue-sec'),rail=document.getElementById('rail-continue');
  if(!sec||!rail)return;
  const items=S.hist.filter(h=>hasProgress(h.id,mtyp(h)));
  if(!items.length){sec.style.display='none';return;}
  sec.style.display='block';rail.innerHTML='';
  items.slice(0,12).forEach(item=>{
    const type=mtyp(item);
    const wrap=wrapRailCard(item,{showProgress:true});
    if(type==='tv'){
      getContinueThumb(item).then(url=>{
        const img=wrap.querySelector('.card-img');
        if(img&&url)img.src=url;
      });
    }
    addRailRemove(wrap,item,()=>{
      const idx=S.hist.findIndex(h=>h.id===item.id);
      if(idx>-1)S.hist.splice(idx,1);
      const keys=Object.keys(S.prog).filter(k=>k.startsWith(`tv_${item.id}_`)||k===`m_${item.id}`);
      keys.forEach(k=>delete S.prog[k]);
      save();refreshContRow();
      showToast('Removed from Continue Watching');
    });
    rail.appendChild(wrap);
  });
}
function sortFavs(list){
  const arr=[...list];
  switch(S.favSort){
    case 'title':return arr.sort((a,b)=>ttl(a).localeCompare(ttl(b)));
    case 'year':return arr.sort((a,b)=>(yr(b)||'0').localeCompare(yr(a)||'0'));
    case 'rating':return arr.sort((a,b)=>(b.vote_average||0)-(a.vote_average||0));
    default:return arr.sort((a,b)=>(b._ts||0)-(a._ts||0));
  }
}
function refreshFavPage(){
  const grid=document.getElementById('fav-grid');if(!grid)return;
  if(!S.favs.length){
    grid.innerHTML=emptyHTML('Your list is empty.','Save something worth returning to.',{goto:'discover',label:'Discover something'});
    bindEmptyActions(grid);
    return;
  }
  grid.innerHTML='';
  sortFavs(S.favs).forEach((item)=>{
    const wrap=document.createElement('div');
    wrap.className='fav-swipe-item';
    const remove=()=>{
      const idx=S.favs.findIndex(f=>f.id===item.id);
      if(idx>-1)S.favs.splice(idx,1);
      save();refreshFavPage();
      showToast('Removed from My List');
    };
    item._onRemove=remove;
    const card=makeCard(item,{twoLine:true,onRemove:remove});
    card.draggable=true;
    card.dataset.favIdx=String(S.favs.findIndex(f=>f.id===item.id));
    card.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',card.dataset.favIdx);card.classList.add('dragging');});
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
    card.addEventListener('dragover',e=>{e.preventDefault();card.classList.add('drag-over');});
    card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));
    card.addEventListener('drop',e=>{
      e.preventDefault();card.classList.remove('drag-over');
      const from=parseInt(e.dataTransfer.getData('text/plain'),10);
      const to=parseInt(card.dataset.favIdx,10);
      if(isNaN(from)||isNaN(to)||from===to)return;
      const [moved]=S.favs.splice(from,1);
      S.favs.splice(to,0,moved);
      save();refreshFavPage();haptic();
    });
    bindSwipeRemove(wrap,remove);
    wrap.appendChild(card);
    grid.appendChild(wrap);
  });
}

/* ══════════════════════════════════════════════════════════════
   JUSTWATCH helpers — via TMDB watch/providers endpoint
   ══════════════════════════════════════════════════════════════ */
const JW_SERVICES = {
  8:   { name:'Netflix',    logo:'https://image.tmdb.org/t/p/original/t2yyOv40HZeVlLjYsCsPHnWLk4W.jpg' },
  337: { name:'Disney+',   logo:'https://image.tmdb.org/t/p/original/7rwgEs15tFwyR9NPQ5vpzxTj19Q.jpg' },
  9:   { name:'Prime Video',logo:'https://image.tmdb.org/t/p/original/dQeAar5H991VYporEjUspolDarG.jpg' },
  384: { name:'HBO Max',   logo:'https://image.tmdb.org/t/p/original/Ajqyt5aNxNvaG0sDlKm0F7ReiID.jpg' },
  15:  { name:'Hulu',      logo:'https://image.tmdb.org/t/p/original/zxrVdFjIjLqkfnwyghnfywTn3Lh.jpg' },
  531: { name:'Paramount+',logo:'https://image.tmdb.org/t/p/original/xbhHHa1YgtpwhC8lb1NQ3ACVcLd.jpg' },
  2:   { name:'Apple TV+', logo:'https://image.tmdb.org/t/p/original/peURlLlr8jggOwK53fJ5wdQl05y.jpg' },
  283: { name:'Crunchyroll',logo:'https://image.tmdb.org/t/p/original/8Gt1iClBlzTeQs8WQm8UrCoIxnQ.jpg' },
};
const TARGET_IDS = new Set(Object.keys(JW_SERVICES).map(Number));

function parseWatchProviders(watchData){
  // TMDB returns providers by country — prefer US, fall back to first available
  const regions = watchData?.results || {};
  const region = regions['US'] || regions['GB'] || Object.values(regions)[0];
  if(!region) return [];
  // flatrate = subscription, ads = free with ads, rent/buy = paid
  const flatrate = region.flatrate || [];
  const ads      = region.ads      || [];
  const rent     = region.rent     || [];
  const buy      = region.buy      || [];
  const seen = new Set();
  const out  = [];
  for(const p of [...flatrate,...ads,...rent,...buy]){
    if(seen.has(p.provider_id)) continue;
    seen.add(p.provider_id);
    if(!TARGET_IDS.has(p.provider_id)) continue;
    const known = JW_SERVICES[p.provider_id];
    out.push({
      id:   p.provider_id,
      name: known?.name || p.provider_name,
      logo: p.logo_path ? `${TMDB_IMG}/w45${p.logo_path}` : known?.logo,
      type: flatrate.some(x=>x.provider_id===p.provider_id) ? 'stream'
          : ads.some(x=>x.provider_id===p.provider_id)      ? 'ads'
          : rent.some(x=>x.provider_id===p.provider_id)     ? 'rent' : 'buy',
    });
  }
  return out;
}

function showTitleSkeleton(on){
  const sk=document.getElementById('tp-skeleton');
  const layout=document.getElementById('tp-hero-layout');
  if(!sk)return;
  sk.style.display=on?'block':'none';
  if(layout)layout.style.visibility=on?'hidden':'visible';
}
function openPosterLightbox(src,alt){
  const lb=document.getElementById('poster-lightbox');
  const img=document.getElementById('poster-lightbox-img');
  if(!lb||!img||!src)return;
  img.src=src;img.alt=alt||'';
  lb.classList.add('open');
}
function closePosterLightbox(){
  document.getElementById('poster-lightbox')?.classList.remove('open');
}
async function renderTitleUpNext(item,details){
  const sec=document.getElementById('tp-upnext-sec');
  const card=document.getElementById('tp-upnext-card');
  if(!sec||!card)return;
  sec.style.display='none';
  card.innerHTML='';
  if(mtyp(item)!=='tv'||!details?.number_of_seasons)return;
  const last=getLastEp(item.id);
  const season=last?.season||1;
  const data=await A.season(item.id,season);
  const eps=data?.episodes||[];
  if(!eps.length)return;
  const curEp=last?.episode||1;
  const idx=eps.findIndex(e=>e.episode_number===curEp);
  const next=idx>=0&&idx<eps.length-1?eps[idx+1]:null;
  if(!next)return;
  const still=next.still_path?`${TMDB_IMG}/w300${next.still_path}`:null;
  const pct=getProg(item.id,'tv',season,next.episode_number);
  card.innerHTML=`
    ${still?`<img class="tp-upnext-still" src="${still}" alt="" loading="lazy">`:`<div class="tp-upnext-still tp-upnext-ph"></div>`}
    <div class="tp-upnext-info">
      <div class="tp-upnext-label">Season ${season} · Episode ${next.episode_number}</div>
      <div class="tp-upnext-name">${next.name||'Episode '+next.episode_number}</div>
      ${next.overview?`<div class="tp-upnext-desc">${next.overview.slice(0,100)}${next.overview.length>100?'…':''}</div>`:''}
      ${pct>0?`<div class="ep-prog-bar"><div class="ep-prog-fill" style="width:${pct}%"></div></div>`:''}
    </div>
    <button class="btn-primary tp-upnext-play" type="button">
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M8 5v14l11-7z"/></svg>Play
    </button>`;
  card.querySelector('.tp-upnext-play')?.addEventListener('click',()=>{
    haptic();
    openPlayer(item,'tv',season,next.episode_number,next.name);
  });
  sec.style.display='block';
}
async function openTitlePage(item){
  S.titleItem = item;
  addViewed(item);
  if(S.page==='person'){
    S.titlePrevPage='person';
  }else if(S.page!=='title'){
    S.titlePrevPage=S.page;
  }

  const type = mtyp(item);
  const hashPath=`/title/${type}/${item.id}`;
  setHash(hashPath,S.page!=='title');
  goTo('title');
  showTitleSkeleton(true);

  const errEl=document.getElementById('tp-error');
  if(errEl){errEl.style.display='none';errEl.textContent='';}

  const tp = document.getElementById('tp-backdrop');
  tp.classList.remove('loaded');
  tp.style.backgroundImage = '';

  const posterEl=document.getElementById('tp-poster');
  if(posterEl){
    if(item.poster_path){posterEl.src=imgP(item.poster_path);posterEl.style.display='block';}
    else posterEl.style.display='none';
  }

  const bgUrl = imgB(item.backdrop_path);
  if(bgUrl){
    const img = new Image();
    img.onload = ()=>{
      tp.style.backgroundImage = `url(${bgUrl})`;
      requestAnimationFrame(()=>tp.classList.add('loaded'));
    };
    img.src = bgUrl;
    setAmbientGlow('--tp-glow',bgUrl);
  }

  document.getElementById('tp-title').textContent    = ttl(item);
  document.getElementById('tp-year').textContent     = yr(item);
  document.getElementById('tp-overview').textContent = item.overview || '';
  document.getElementById('tp-score').innerHTML      = fmtScore(item.vote_average);
  document.getElementById('tp-type-badge').textContent = type === 'tv' ? 'Series' : 'Movie';

  ['tp-genres','tp-trailer-wrap','tp-cast-rail','tp-ep-list','tp-collection-rail','tp-similar-rail',
   'tp-rating-block','tp-justwatch-block'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.innerHTML='';
  });
  document.getElementById('tp-eps-section').style.display     = 'none';
  document.getElementById('tp-collection-sec').style.display  = 'none';
  document.getElementById('tp-similar-sec').style.display     = 'none';
  document.getElementById('tp-upnext-sec').style.display='none';
  const ratingBlock = document.getElementById('tp-rating-block');
  const jwBlock   = document.getElementById('tp-justwatch-block');
  if(ratingBlock) ratingBlock.style.display = 'none';
  if(jwBlock)   jwBlock.style.display   = 'none';

  // Skeleton cast
  const castRailEl = document.getElementById('tp-cast-rail');
  castRailEl.innerHTML = Array.from({length:6},()=>`
    <div style="flex:0 0 100px">
      <div style="width:100px;height:100px;border-radius:50%;background:var(--card);margin-bottom:8px"></div>
      <div style="width:80px;height:10px;background:var(--card);border-radius:4px;margin:0 auto"></div>
    </div>`).join('');

  // Watch button
  updateTitleWatchButtons(item,type);

  const details = await A.details(item.id, type);
  showTitleSkeleton(false);
  if(!details){
    if(errEl){
      errEl.textContent='Could not load details. Check your connection and try again.';
      errEl.style.display='block';
    }
    document.getElementById('tp-cast-rail').innerHTML=emptyHTML('Unavailable','This title could not be loaded.');
    return;
  }

  const favBtn = document.getElementById('tp-fav-btn');
  const upFav  = a=>{favBtn.classList.toggle('active',a);favBtn.querySelector('span').textContent=a?'In My List':'My List';};
  upFav(isFav(item.id));
  favBtn.onclick = ()=>{const now=toggleFav(item);upFav(now);};
  updateTitleWatchButtons(item,type);

  // Runtime / seasons
  const rt = details.runtime || details.episode_run_time?.[0];
  const rtEl = document.getElementById('tp-runtime');
  if(rtEl) rtEl.textContent = rt ? fmtRuntime(rt) : '';
  const seasonsEl = document.getElementById('tp-seasons');
  if(seasonsEl) seasonsEl.textContent = details.number_of_seasons
    ? `${details.number_of_seasons} Season${details.number_of_seasons!==1?'s':''}` : '';

  // ── Genres ──
  const gEl = document.getElementById('tp-genres');
  (details.genres||[]).forEach(g=>{
    const pill = document.createElement('span');
    pill.className = 'tp-genre-pill';
    pill.textContent = g.name;
    gEl.appendChild(pill);
  });

  renderTmdbRatingBlock(details);

  // ── JustWatch block ──
  renderJustWatchBlock(details['watch/providers']);

  // ── Trailer ──
  const videos   = details.videos?.results || [];
  const trailer  = videos.find(v=>v.type==='Trailer'&&v.site==='YouTube') || videos.find(v=>v.site==='YouTube');
  const trailerWrap = document.getElementById('tp-trailer-wrap');
  if(trailer && trailerWrap){
    const btn = document.createElement('button');
    btn.className = 'tp-trailer-btn';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg> Watch Trailer`;
    btn.addEventListener('click',()=>openTrailer(trailer.key));
    trailerWrap.appendChild(btn);
  }

  // ── Cast ──
  const cast = (details.credits?.cast||[]).slice(0,12);
  const castRail = document.getElementById('tp-cast-rail');
  castRail.innerHTML = '';
  cast.forEach(person=>{
    const card = document.createElement('div');card.className='cast-card';
    const face = person.profile_path ? `${TMDB_IMG}/w185${person.profile_path}` : null;
    const imgW = document.createElement('div');imgW.className='cast-img-w';
    if(face){
      const img = document.createElement('img');
      img.alt = person.name;img.loading='eager';
      img.onerror = ()=>{ imgW.innerHTML=castPH(); };
      img.src = face;
      imgW.appendChild(img);
    }else{
      imgW.innerHTML = castPH();
    }
    const name = document.createElement('div');name.className='cast-name';name.textContent=person.name;
    const role = document.createElement('div');role.className='cast-role';role.textContent=person.character||'';
    card.appendChild(imgW);card.appendChild(name);card.appendChild(role);
    card.addEventListener('click',()=>openPersonPage(person.id));
    castRail.appendChild(card);
  });

  // ── Episodes (TV) ──
  if(type==='tv' && details.number_of_seasons){
    S.playerSeasons = details.number_of_seasons;
    const epSec = document.getElementById('tp-eps-section');
    epSec.style.display = 'block';
    buildTitlePageSeasons(item, details.number_of_seasons);
    await renderTitleUpNext(item,details);
  }

  // ── Collection ──
  if(type==='movie' && details.belongs_to_collection?.id){
    const parts  = await A.collection(details.belongs_to_collection.id);
    const others = parts.filter(p=>p.id!==item.id).sort((a,b)=>(a.release_date||'').localeCompare(b.release_date||''));
    if(others.length){
      const sec   = document.getElementById('tp-collection-sec');
      const title = document.getElementById('tp-collection-title');
      const rail  = document.getElementById('tp-collection-rail');
      if(title) title.textContent = details.belongs_to_collection.name || 'Other Parts';
      if(rail){rail.innerHTML='';others.forEach(p=>{p.media_type='movie';rail.appendChild(makeCard(p));});}
      if(sec) sec.style.display='block';
    }
  }

  // ── Similar ──
  const [sim,rec] = await Promise.all([A.similar(item.id,type), A.recommended(item.id,type)]);
  const combined  = [...rec,...sim].filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i&&v.id!==item.id).slice(0,16);
  const simRail   = document.getElementById('tp-similar-rail');
  if(simRail && combined.length){combined.forEach(p=>{p.media_type=type;simRail.appendChild(makeCard(p));});}
  document.getElementById('tp-similar-sec').style.display = combined.length ? 'block' : 'none';
}

const castPH = ()=>`<div class="cast-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="24" height="24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>`;

/* ── TMDB rating block ── */
function renderTmdbRatingBlock(details){
  const block = document.getElementById('tp-rating-block');
  if(!block) return;

  const v = details.vote_average;
  const c = details.vote_count;
  const imdb_id = details.external_ids?.imdb_id;

  if(!v){ block.style.display='none'; return; }

  const score  = v.toFixed(1);
  const stars  = Math.round(v / 2);
  const starsHtml = Array.from({length:5},(_,i)=>`
    <svg class="tmdb-star${i<stars?' filled':''}" viewBox="0 0 24 24" width="14" height="14">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>`).join('');

  const votes = c >= 1_000_000
    ? (c/1_000_000).toFixed(1)+'M'
    : c >= 1000
    ? Math.round(c/1000)+'K'
    : String(c||'');

  block.innerHTML = `
    <div class="tmdb-rating-badge">
      <div class="tmdb-logo-wrap"><span class="tmdb-logo-text">TMDB</span></div>
      <div class="tmdb-score-wrap">
        <span class="tmdb-score">${score}</span>
        <span class="tmdb-max">/10</span>
      </div>
      <div class="tmdb-stars">${starsHtml}</div>
      ${votes ? `<div class="tmdb-votes">${votes} votes</div>` : ''}
      ${imdb_id ? `<a class="tmdb-imdb-link" href="https://www.imdb.com/title/${imdb_id}/" target="_blank" rel="noopener">IMDb page ↗</a>` : ''}
    </div>`;
  block.style.display = 'block';
}

/* ── JustWatch block render ── */
function renderJustWatchBlock(watchProviders){
  const block = document.getElementById('tp-justwatch-block');
  if(!block) return;

  const providers = parseWatchProviders(watchProviders);
  if(!providers.length){ block.style.display='none'; return; }

  // Group by type
  const streaming = providers.filter(p=>p.type==='stream');
  const adFree    = providers.filter(p=>p.type==='ads');
  const rent      = providers.filter(p=>p.type==='rent'||p.type==='buy');

  const renderGroup = (label, list) => {
    if(!list.length) return '';
    const logos = list.map(p=>`
      <div class="jw-provider" title="${p.name}">
        ${p.logo
          ? `<img src="${p.logo}" alt="${p.name}" class="jw-logo" loading="lazy">`
          : `<span class="jw-logo-text">${p.name.slice(0,2)}</span>`
        }
        <span class="jw-name">${p.name}</span>
      </div>`).join('');
    return `<div class="jw-group"><div class="jw-group-label">${label}</div><div class="jw-logos">${logos}</div></div>`;
  };

  block.innerHTML = `
    <div class="jw-block">
      <div class="jw-header">
        <span class="jw-title">Where to Watch</span>
        <span class="jw-powered">via JustWatch</span>
      </div>
      ${renderGroup('Stream', streaming)}
      ${renderGroup('Free with Ads', adFree)}
      ${renderGroup('Rent / Buy', rent)}
    </div>`;
  block.style.display = 'block';
}

function buildTitlePageSeasons(item,n){
  const head=document.getElementById('tp-season-tabs');head.innerHTML='';
  for(let s=1;s<=n;s++){
    const btn=document.createElement('button');
    btn.className=`season-tab${s===1?' active':''}`;btn.textContent=`Season ${s}`;
    btn.addEventListener('click',()=>{
      document.querySelectorAll('#tp-season-tabs .season-tab').forEach(t=>t.classList.remove('active'));
      btn.classList.add('active');loadTitlePageEps(item,s);
    });
    head.appendChild(btn);
  }
  loadTitlePageEps(item,1);
}
async function loadTitlePageEps(item,season){
  const list=document.getElementById('tp-ep-list');
  list.innerHTML=`<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Loading…</div>`;
  const data=await A.season(item.id,season);list.innerHTML='';
  if(!data?.episodes)return;
  data.episodes.forEach(ep=>{
    const pct=getProg(item.id,'tv',season,ep.episode_number);
    const still=ep.still_path?`${TMDB_IMG}/w300${ep.still_path}`:null;
    const row=document.createElement('div');row.className='ep-item';
    row.innerHTML=`
      ${still?`<img class="ep-still" src="${still}" alt="" loading="lazy">`:`<div class="ep-still ep-still-ph"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1"><path d="m7 8 4 3-4 3V8z"/></svg></div>`}
      <div class="ep-info">
        <div class="ep-info-top">
          <span class="ep-num">E${ep.episode_number}</span>
          <span class="ep-name">${ep.name||'Episode '+ep.episode_number}</span>
          ${ep.runtime?`<span class="ep-dur">${ep.runtime}m</span>`:''}
        </div>
        ${ep.overview?`<div class="ep-overview">${ep.overview.slice(0,120)}${ep.overview.length>120?'…':''}</div>`:''}
        ${pct>0?`<div class="ep-prog-bar"><div class="ep-prog-fill" style="width:${pct}%"></div></div>`:''}
      </div>
      <span class="ep-arr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>`;
    row.addEventListener('click',()=>openPlayer(item,'tv',season,ep.episode_number,ep.name));
    list.appendChild(row);
  });
}

/* ── Trailer modal ── */
function openTrailer(key){
  const modal=document.getElementById('trailer-modal');
  document.getElementById('trailer-frame').src=`https://www.youtube.com/embed/${key}?autoplay=1&rel=0`;
  modal.classList.add('open');
}
function closeTrailer(){
  document.getElementById('trailer-frame').src='';
  document.getElementById('trailer-modal').classList.remove('open');
}

/* ── Person page ── */
async function openPersonPage(id){
  goTo('person');
  document.getElementById('person-name').textContent='Loading…';
  document.getElementById('person-bio').textContent='';
  document.getElementById('person-credits-rail').innerHTML='';
  const data=await A.person(id);if(!data)return;
  const face=imgFace(data.profile_path);
  const img=document.getElementById('person-img');
  if(face&&img){img.src=face;img.style.display='block';}
  document.getElementById('person-name').textContent=data.name||'';
  document.getElementById('person-known').textContent=data.known_for_department||'';
  document.getElementById('person-bio').textContent=(data.biography||'').slice(0,400)+((data.biography?.length||0)>400?'…':'');
  const credits=[...(data.combined_credits?.cast||[]),...(data.combined_credits?.crew||[])]
    .filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i&&v.poster_path)
    .sort((a,b)=>(b.vote_count||0)-(a.vote_count||0)).slice(0,20);
  const rail=document.getElementById('person-credits-rail');
  credits.forEach(item=>{item.media_type=item.media_type||'movie';rail.appendChild(makeCard(item));});
}

/* ── Discover ── */
function discoverQueryParams(mood,type){
  let p;
  switch(mood){
    case 'light':p={with_genres:type==='movie'?'35|10751':'35',sort_by:'popularity.desc'};break;
    case 'short':p={'with_runtime.lte':'90',sort_by:'vote_average.desc','vote_count.gte':'100'};break;
    case 'gems':p={sort_by:'vote_average.desc','vote_count.gte':'50','vote_count.lte':'800','vote_average.gte':'7'};break;
    case 'epic':p={'with_runtime.gte':'150',sort_by:'popularity.desc'};break;
    case 'trending':p={sort_by:'popularity.desc'};break;
    default:p={sort_by:'vote_average.desc','vote_count.gte':type==='movie'?'500':'200'};
  }
  if(S.discoverGenre)p.with_genres=S.discoverGenre;
  return p;
}
function setupDiscoverGenres(){
  const bar=document.getElementById('discover-genres');if(!bar)return;
  bar.innerHTML='';
  const allBtn=document.createElement('button');
  allBtn.type='button';
  allBtn.className=`mood-chip${!S.discoverGenre?' active':''}`;
  allBtn.textContent='All Genres';
  allBtn.addEventListener('click',()=>{
    S.discoverGenre=null;
    bar.querySelectorAll('.mood-chip').forEach(c=>c.classList.remove('active'));
    allBtn.classList.add('active');
    initDiscover();
  });
  bar.appendChild(allBtn);
  GENRES.filter(g=>g.id).forEach(g=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className=`mood-chip${S.discoverGenre===g.id?' active':''}`;
    btn.textContent=g.label;
    btn.addEventListener('click',()=>{
      S.discoverGenre=g.id;
      bar.querySelectorAll('.mood-chip').forEach(c=>c.classList.remove('active'));
      btn.classList.add('active');
      initDiscover();
    });
    bar.appendChild(btn);
  });
}
async function initDiscover(){
  document.getElementById('discover-loading').style.display='flex';
  document.getElementById('discover-stage').style.display='none';
  const page=Math.floor(Math.random()*12)+1;
  const params=discoverQueryParams(S.discoverMood,S.discoverType);
  const items=await A.discoverFiltered(S.discoverType,params,page);
  S.discoverItems=items.filter(i=>i.backdrop_path&&!isHidden(i.id));
  S.discoverIdx=0;
  document.getElementById('discover-loading').style.display='none';
  document.getElementById('discover-stage').style.display='flex';
  renderDiscover();
}
async function renderDiscover(){
  if(!S.discoverItems.length)return;
  const item=S.discoverItems[S.discoverIdx];
  const type=S.discoverType;
  const bg=imgB(item.backdrop_path);
  const cur=document.getElementById('discover-bg');
  const next=document.getElementById('discover-bg-next');
  if(bg&&cur){
    if(next&&cur.style.backgroundImage){
      next.style.backgroundImage=`url(${bg})`;
      next.style.opacity='1';
      setTimeout(()=>{cur.style.backgroundImage=`url(${bg})`;next.style.opacity='0';},50);
    }else cur.style.backgroundImage=`url(${bg})`;
    setAmbientGlow('--disc-glow',bg);
  }
  const poster=document.getElementById('discover-poster');
  if(poster){
    if(item.poster_path){poster.src=imgP(item.poster_path);poster.alt=ttl(item);}
    else poster.removeAttribute('src');
  }
  const vidWrap=document.getElementById('discover-video');
  if(vidWrap){
    const key=await getTrailerKey(item.id,type);
    renderDiscoverVideo(key);
  }
  document.getElementById('discover-title').textContent=ttl(item);
  document.getElementById('discover-year').textContent=yr(item);
  document.getElementById('discover-score').innerHTML=fmtScore(item.vote_average);
  document.getElementById('discover-overview').textContent=(item.overview||'').slice(0,180)+((item.overview?.length||0)>180?'…':'');
  const gl=genreLabel(item.genre_ids);
  document.getElementById('discover-genre').textContent=gl;
  document.getElementById('discover-counter').textContent=`${S.discoverIdx+1} / ${S.discoverItems.length}`;
  const rtEl=document.getElementById('discover-runtime');
  if(rtEl)rtEl.textContent=item.runtime?fmtRuntime(item.runtime):'';
  const favBtn=document.getElementById('discover-fav');
  if(favBtn){
    favBtn.classList.toggle('active',isFav(item.id));
    favBtn.querySelector('span').textContent=isFav(item.id)?'In My List':'My List';
    favBtn.onclick=()=>{
      const now=toggleFav(item);
      favBtn.classList.toggle('active',now);
      favBtn.querySelector('span').textContent=now?'In My List':'My List';
    };
  }
  const card=document.getElementById('discover-card');
  if(card){
    card.classList.remove('slide-left','slide-right');
    void card.offsetWidth;
    card.classList.add(S.discoverDir>0?'slide-left':'slide-right');
  }
}
function discoverNext(){
  S.discoverDir=1;
  if(S.discoverIdx<S.discoverItems.length-1)S.discoverIdx++;else S.discoverIdx=0;
  renderDiscover();
}
function discoverPrev(){
  S.discoverDir=-1;
  if(S.discoverIdx>0)S.discoverIdx--;else S.discoverIdx=S.discoverItems.length-1;
  renderDiscover();
}
function discoverWatch(){
  if(!S.discoverItems.length)return;
  openTitlePage(S.discoverItems[S.discoverIdx]);
}
function discoverPlay(){
  if(!S.discoverItems.length)return;
  playItem(S.discoverItems[S.discoverIdx]);
}
function discoverSkip(){
  if(!S.discoverItems.length)return;
  const item=S.discoverItems[S.discoverIdx];
  hideTitle(item.id);
  haptic();
  showToast('We\'ll show you less like this');
  S.discoverItems.splice(S.discoverIdx,1);
  if(!S.discoverItems.length){initDiscover();return;}
  if(S.discoverIdx>=S.discoverItems.length)S.discoverIdx=0;
  renderDiscover();
}
let _touchX=0;
function initDiscoverSwipe(){
  const el=document.getElementById('discover-card');if(!el)return;
  el.addEventListener('touchstart',e=>{_touchX=e.touches[0].clientX;},{passive:true});
  el.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-_touchX;
    if(Math.abs(dx)>50){dx<0?discoverNext():discoverPrev();}
  },{passive:true});
}

/* ── Grid filters ── */
function buildGridParams(filters,type){
  const p={sort_by:filters.sort};
  if(filters.genre)p.with_genres=filters.genre;
  if(filters.year){
    if(type==='movie')p.primary_release_year=filters.year;
    else p.first_air_date_year=filters.year;
  }
  if(filters.lang)p.with_original_language=filters.lang;
  return p;
}
async function loadFilteredGrid(type){
  const isMovie=type==='movie';
  const gridId=isMovie?'movies-grid':'series-grid';
  const sentinelId=isMovie?'movies-sentinel':'series-sentinel';
  const filters=isMovie?S.movieFilters:S.seriesFilters;
  const grid=document.getElementById(gridId);
  if(isMovie){S.moviesPage=1;S.moviesDone=false;}else{S.seriesPage=1;S.seriesDone=false;}
  grid.innerHTML='<div class="card-sk" style="height:228px"></div>'.repeat(12);
  const items=await A.discoverFiltered(type,buildGridParams(filters,type),1);
  grid.innerHTML='';
  if(!items.length){grid.innerHTML=emptyHTML('No results','Try different filters.');return;}
  items.forEach(item=>{item.media_type=type;grid.appendChild(makeCard(item,{twoLine:true}));});
  if(isMovie)S.moviesPage=2;else S.seriesPage=2;
  const sentinel=document.getElementById(sentinelId);
  if(sentinel)sentinel.style.display='flex';
}
function bindGridFilters(type){
  const prefix=type==='movie'?'movies':'series';
  const stateKey=type==='movie'?'movieFilters':'seriesFilters';
  ['sort','genre','year','lang'].forEach(key=>{
    const el=document.getElementById(`${prefix}-${key}`);
    el?.addEventListener('change',async()=>{
      S[stateKey][key]=el.value;
      syncFilterChips(`${prefix}-${key}`);
      if(type==='movie')S.moviesLoaded=false;else S.seriesLoaded=false;
      await loadFilteredGrid(type);
    });
  });
}

/* ── Player ── */
async function openPlayer(item,type,season=1,ep=1,epName=''){
  if(S.page!=='player')S.playerReturnPage=S.page;
  S.playerItem=item;S.playerType=type;S.playerSeason=season;S.playerEp=ep;
  addHist({...item,media_type:type});
  addViewed({...item,media_type:type});
  goTo('player');
  document.getElementById('below-title').textContent=`Watchy. — ${ttl(item)}`;
  document.getElementById('below-meta').textContent=type==='tv'
    ?`Season ${season} · Episode ${ep}${epName?' — '+epName:''}`:yr(item);
  const saved=getProg(item.id,type,season,ep);
  document.getElementById('cont-fill').style.width=saved+'%';
  document.getElementById('cont-pct').textContent=saved+'%';
  S.playerOpenTime=Date.now();
  const details=await A.details(item.id,type);
  S.playerRuntime=(details?.runtime||details?.episode_run_time?.[0]||45)*60*1000;
  loadVidSrc(item.id,type,season,ep);
  if(type==='tv'){
    const data=await A.season(item.id,season);
    S.playerEps=data?.episodes||[];
    if(!S.playerSeasons){const det=await A.details(item.id,'tv');S.playerSeasons=det?.number_of_seasons||1;}
    buildEpPanel();
    loadBelowContent(item,type,null);
  }else{
    S.playerEps=[];S.playerSeasons=0;
    document.getElementById('pep-list').innerHTML='';
    document.getElementById('pep-season-tabs').innerHTML='';
    const det=await A.details(item.id,'movie');
    loadBelowContent(item,type,det);
  }
  updatePlayerNav();
  startProgressWatch();
}

function updatePlayerNav(){
  const bar=document.getElementById('player-nav-bar');
  const prevBtn=document.getElementById('player-prev-ep');
  const nextBtn=document.getElementById('player-next-ep');
  const epBtn=document.getElementById('player-episodes-btn');
  const epToggle=document.getElementById('player-ep-toggle');
  if(!bar)return;
  if(S.playerType!=='tv'){
    bar.style.display='none';
    if(epToggle)epToggle.style.display='none';
    return;
  }
  bar.style.display='flex';
  if(epToggle)epToggle.style.display='none';
  const cur=S.playerEps.findIndex(e=>e.episode_number===S.playerEp);
  if(prevBtn)prevBtn.disabled=cur<=0;
  if(nextBtn)nextBtn.disabled=cur===-1||cur===S.playerEps.length-1;
}

function startProgressWatch(){
  clearInterval(S.progressTimer);
  S.progressTimer=setInterval(()=>{
    if(S.page!=='player'||!S.playerOpenTime||!S.playerRuntime)return;
    const elapsed=Date.now()-S.playerOpenTime;
    const pct=Math.min(Math.round((elapsed/S.playerRuntime)*100),99);
    if(pct>2){
      document.getElementById('cont-fill').style.width=pct+'%';
      document.getElementById('cont-pct').textContent=pct+'%';
    }
  },15000);
}

function loadVidSrc(id,type,season,ep){
  loadVidSrcWithServer(id,type,season,ep);
}

function stopPlayer(){
  if(S.playerItem&&S.playerOpenTime&&S.playerRuntime){
    const elapsed=Date.now()-S.playerOpenTime;
    const pct=Math.min(Math.round((elapsed/S.playerRuntime)*100),99);
    if(pct>2){
      saveProg(S.playerItem.id,S.playerType,S.playerSeason,S.playerEp,pct);
      document.getElementById('cont-fill').style.width=pct+'%';
      document.getElementById('cont-pct').textContent=pct+'%';
    }
  }
  const iframe=document.getElementById('vidsrc-iframe');
  if(iframe){iframe.src='about:blank';iframe.remove();}
  clearInterval(S.progressTimer);
  document.getElementById('player-ep-panel')?.classList.remove('open');
  document.getElementById('player-nav-bar').style.display='none';
  S.playerSeasons=0;S.playerOpenTime=0;
}

async function loadBelowContent(item,type,details){
  const collSec=document.getElementById('collection-sec');
  const collRail=document.getElementById('collection-rail');
  const collTitle=document.getElementById('collection-title');
  const simSec=document.getElementById('similar-sec');
  const simRail=document.getElementById('similar-rail');
  const simTitle=document.getElementById('similar-title');
  if(collSec)collSec.style.display='none';
  if(simSec)simSec.style.display='none';
  let hasParts=false;
  if(type==='movie'&&details?.belongs_to_collection?.id){
    const parts=await A.collection(details.belongs_to_collection.id);
    const others=parts.filter(p=>p.id!==item.id).sort((a,b)=>(a.release_date||'').localeCompare(b.release_date||''));
    if(others.length&&collSec&&collRail){
      if(collTitle)collTitle.textContent=details.belongs_to_collection.name||'Other Parts';
      collRail.innerHTML='';others.forEach(p=>{p.media_type='movie';collRail.appendChild(makeCard(p));});
      collSec.style.display='block';hasParts=true;
    }
  }
  const [sim,rec]=await Promise.all([A.similar(item.id,type),A.recommended(item.id,type)]);
  const combined=[...rec,...sim].filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i&&v.id!==item.id).slice(0,20);
  if(combined.length&&simSec&&simRail){
    if(simTitle)simTitle.textContent=type==='tv'?'More Like This':hasParts?'You May Also Like':'Similar Movies';
    simRail.innerHTML='';combined.forEach(p=>{p.media_type=type;simRail.appendChild(makeCard(p));});
    simSec.style.display='block';
  }
}

function buildEpPanel(){
  const pepList=document.getElementById('pep-list');
  const pepTabs=document.getElementById('pep-season-tabs');
  if(!pepList)return;
  if(pepTabs&&S.playerSeasons>1){
    pepTabs.innerHTML='';
    for(let s=1;s<=Math.min(S.playerSeasons,8);s++){
      const btn=document.createElement('button');
      btn.className=`pep-season-btn${s===S.playerSeason?' active':''}`;btn.textContent=`Season ${s}`;
      btn.addEventListener('click',()=>{
        document.querySelectorAll('.pep-season-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');S.playerSeason=s;
        A.season(S.playerItem.id,s).then(d=>{S.playerEps=d?.episodes||[];renderEps(pepList);});
      });
      pepTabs.appendChild(btn);
    }
  }else if(pepTabs)pepTabs.innerHTML='';
  renderEps(pepList);
}
function renderEps(container){
  container.querySelectorAll('.pep-ep-row').forEach(r=>r.remove());
  S.playerEps.forEach(ep=>{
    const pct=getProg(S.playerItem.id,'tv',S.playerSeason,ep.episode_number);
    const still=ep.still_path?`${TMDB_IMG}/w300${ep.still_path}`:null;
    const isNow=ep.episode_number===S.playerEp;
    const row=document.createElement('div');row.className=`pep-ep-row${isNow?' active':''}`;
    row.innerHTML=`
      ${still?`<img class="pep-thumb" src="${still}" alt="" loading="lazy">`:`<div class="pep-thumb pep-thumb-ph"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m7 8 4 3-4 3V8z"/></svg></div>`}
      <div class="pep-info">
        <div class="pep-ep-title">E${ep.episode_number} — ${ep.name||'Episode '+ep.episode_number}</div>
        ${ep.runtime?`<div class="pep-ep-dur">${ep.runtime}m</div>`:''}
        ${pct>0?`<div class="pep-prog"><div class="pep-prog-fill" style="width:${pct}%"></div></div>`:''}
      </div>
      ${isNow?'<span class="pep-now">Now</span>':''}`;
    row.addEventListener('click',()=>{
      document.getElementById('player-ep-panel')?.classList.remove('open');
      openPlayer(S.playerItem,'tv',S.playerSeason,ep.episode_number,ep.name);
    });
    container.appendChild(row);
  });
}
function nextEpisode(){
  const cur=S.playerEps.findIndex(e=>e.episode_number===S.playerEp);
  if(S.playerType!=='tv'||cur===-1||cur===S.playerEps.length-1){showToast('End of season');return;}
  const next=S.playerEps[cur+1];openPlayer(S.playerItem,'tv',S.playerSeason,next.episode_number,next.name);
}
function prevEpisode(){
  const cur=S.playerEps.findIndex(e=>e.episode_number===S.playerEp);
  if(S.playerType!=='tv'||cur<=0){showToast('Already at first episode');return;}
  const prev=S.playerEps[cur-1];openPlayer(S.playerItem,'tv',S.playerSeason,prev.episode_number,prev.name);
}

function initKeyboard(){
  document.addEventListener('keydown',e=>{
    if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){
      if(e.key==='Escape'&&S.searchOpen)closeSearch();
      return;
    }
    if((e.key==='/'||((e.ctrlKey||e.metaKey)&&e.key==='k'))&&!S.searchOpen){
      e.preventDefault();openSearch();return;
    }
    if(S.page==='player'){
      if(e.code==='KeyN'){e.preventDefault();nextEpisode();}
      if(e.code==='KeyP'){e.preventDefault();prevEpisode();}
      if(e.code==='Escape')document.getElementById('player-ep-panel')?.classList.remove('open');
    }
    if(S.page==='title'||S.page==='person'){
      if(e.key==='Escape'&&!S.searchOpen){
      if(document.getElementById('poster-lightbox')?.classList.contains('open')){closePosterLightbox();return;}
      e.preventDefault();goBack();
    }
    }
    if(S.page==='discover'){
      if(e.code==='ArrowRight')discoverNext();
      if(e.code==='ArrowLeft')discoverPrev();
      if(e.code==='Enter')discoverPlay();
    }
    if(e.key==='Escape'&&S.searchOpen)closeSearch();
  });
  document.addEventListener('keydown',trapSearchFocus);
}

window.addEventListener('scroll',()=>{
  document.getElementById('nav').classList.toggle('scrolled',window.scrollY>20);
},{passive:true});

/* ── PWA ── */
let _installPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();_installPrompt=e;});
function showInstallBanner(){
  if(localStorage.getItem('wt_install_dismissed'))return;
  if(window.matchMedia('(display-mode: standalone)').matches)return;
  const banner=document.getElementById('install-banner');if(!banner)return;
  banner.classList.add('show');
  setTimeout(()=>banner.classList.remove('show'),5000);
}

/* ══════════════════════════════════════════
   MULTI-SERVER SUPPORT
   ══════════════════════════════════════════ */
const SERVERS=[
  {id:'vidsrc',    label:'VidSrc',      tag:'Popular',
   movie:id=>`https://vidsrc.to/embed/movie/${id}`,
   tv:(id,s,e)=>`https://vidsrc.to/embed/tv/${id}/${s}/${e}`},
  {id:'vidking',   label:'VidKing',     tag:'',
   movie:id=>`https://www.vidking.net/embed/movie/${id}`,
   tv:(id,s,e)=>`https://www.vidking.net/embed/tv/${id}/${s}/${e}`},
  {id:'vidsrc2',   label:'VidSrc XYZ',  tag:'',
   movie:id=>`https://vidsrc.xyz/embed/movie?tmdb=${id}`,
   tv:(id,s,e)=>`https://vidsrc.xyz/embed/tv?tmdb=${id}&season=${s}&episode=${e}`},
  {id:'ezvidapi',  label:'EzVidAPI',    tag:'HD',
   movie:id=>`https://ezvidapi.com/movie/${id}`,
   tv:(id,s,e)=>`https://ezvidapi.com/tv/${id}/${s}/${e}`},
  {id:'streamdb',  label:'StreamDB',    tag:'',
   movie:id=>`https://streamdb.dev/embed/movie/${id}`,
   tv:(id,s,e)=>`https://streamdb.dev/embed/tv/${id}/${s}/${e}`},
  {id:'videasy',   label:'Videasy',     tag:'',
   movie:id=>`https://player.videasy.net/movie/${id}`,
   tv:(id,s,e)=>`https://player.videasy.net/tv/${id}/${s}/${e}`},
  {id:'vidnest',   label:'VidNest',     tag:'',
   movie:id=>`https://vidnest.online/embed/movie/${id}`,
   tv:(id,s,e)=>`https://vidnest.online/embed/tv/${id}/${s}/${e}`},
  {id:'pstream',   label:'P-Stream',    tag:'',
   movie:id=>`https://p-stream.co/embed/movie/${id}`,
   tv:(id,s,e)=>`https://p-stream.co/embed/tv/${id}?s=${s}&e=${e}`},
  {id:'embed2',    label:'2Embed',      tag:'',
   movie:id=>`https://www.2embed.cc/embed/${id}`,
   tv:(id,s,e)=>`https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`},
];

let _currentServer=parseInt(localStorage.getItem('wt_server')||'0');
function getCurrentServer(){return SERVERS[_currentServer]||SERVERS[0];}
function setServer(idx){
  _currentServer=idx;localStorage.setItem('wt_server',idx);
  buildServerSwitcher();
  if(S.playerItem)loadVidSrcWithServer(S.playerItem.id,S.playerType,S.playerSeason,S.playerEp);
}
function loadVidSrcWithServer(id,type,season,ep){
  const wrap=document.getElementById('player-embed-wrap');if(!wrap)return;
  const old=document.getElementById('vidsrc-iframe');
  if(old){old.src='about:blank';old.remove();}
  const loader=document.getElementById('player-loader');
  if(loader)loader.classList.add('on');
  const srv=getCurrentServer();
  let url=type==='movie'?srv.movie(id):srv.tv(id,season,ep);
  const iframe=document.createElement('iframe');
  iframe.id='vidsrc-iframe';
  iframe.setAttribute('allowfullscreen','');
  iframe.setAttribute('allow','autoplay; fullscreen; picture-in-picture; encrypted-media');
  iframe.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:none;z-index:2;background:#000;display:block;';
  iframe.src=url;
  iframe.onload=()=>{if(loader)loader.classList.remove('on');};
  wrap.appendChild(iframe);
}
function buildServerSwitcher(){
  const container=document.getElementById('server-switcher');if(!container)return;
  container.innerHTML='';
  SERVERS.forEach((srv,i)=>{
    const btn=document.createElement('button');
    btn.className=`server-opt${i===_currentServer?' active':''}`;
    btn.setAttribute('role','menuitem');
    btn.setAttribute('aria-current',i===_currentServer?'true':'false');
    btn.dataset.idx=i;
    btn.innerHTML=`
      <span class="srv-opt-left">
        <span class="srv-check">${i===_currentServer?'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>':''}</span>
        <span class="srv-name">${srv.label}</span>
      </span>
      ${srv.tag?`<span class="srv-tag">${srv.tag}</span>`:''}`;
    btn.addEventListener('click',()=>{setServer(i);closeSrcPanel();});
    container.appendChild(btn);
  });
}
function openSrcPanel(){
  const p=document.getElementById('src-panel');if(!p)return;
  p.classList.add('open');
  setTimeout(()=>p.querySelector('.server-opt')?.focus(),50);
}
function closeSrcPanel(){document.getElementById('src-panel')?.classList.remove('open');}
function toggleSrcPanel(){
  const p=document.getElementById('src-panel');if(!p)return;
  p.classList.contains('open')?closeSrcPanel():openSrcPanel();
}

/* ── Home auto-refresh ── */
let _homeRefreshTimer=null;
function startHomeRefresh(){
  stopHomeRefresh();
  _homeRefreshTimer=setInterval(async()=>{
    if(S.page!=='home')return;
    const trending=await A.trending();
    if(trending.length){
      const newIdx=Math.floor(Math.random()*Math.min(trending.length,10));
      const shuffled=[...trending.slice(newIdx),...trending.slice(0,newIdx)];
      setupHero(shuffled);
    }
    refreshHomeRails();
  },5*60*1000);
}
function stopHomeRefresh(){if(_homeRefreshTimer){clearInterval(_homeRefreshTimer);_homeRefreshTimer=null;}}

/* ── Hash routing ── */
async function routeFromHash(){
  let raw=window.location.hash;
  if(!raw||raw==='#')return;
  let hash=raw.slice(1);
  if(hash.startsWith('/'))hash=hash.slice(1);
  const parts=hash.split('/').filter(Boolean);
  const [section,typeOrId,id]=parts;
  if(!section)return;
  if(section==='title'&&typeOrId&&id){
    try{
      const data=await api(`/${typeOrId}/${id}`);
      if(data){data.media_type=typeOrId;setTimeout(()=>{if(S.page!=='title')S.titlePrevPage=S.page||'home';openTitlePage(data);},400);}
    }catch(_){}
    return;
  }
  if((section==='movie'||section==='tv')&&typeOrId&&!isNaN(typeOrId)){
    try{
      const data=await api(`/${section}/${typeOrId}`);
      if(data){data.media_type=section;setTimeout(()=>{if(S.page!=='title')S.titlePrevPage=S.page||'home';openTitlePage(data);},400);}
    }catch(_){}
    return;
  }
  if(['discover','mylist','movies','series'].includes(section)){
    setTimeout(()=>document.querySelector(`[data-page="${section}"]`)?.click(),300);
  }
}

/* ── Share card ── */
async function shareCard(item){
  showToast('Generating card…');
  const type=mtyp(item),title=ttl(item),year=yr(item);
  const score=item.vote_average?`${Math.round(item.vote_average*10)}%`:'';
  const overview=(item.overview||'').slice(0,120)+((item.overview?.length||0)>120?'…':'');
  const posterURL=item.poster_path?`${TMDB_IMG}/w500${item.poster_path}`:null;
  const bgColor='#09090B',textColor='#F2F1EC',goldColor='#C9A96E',subColor='rgba(138,138,144,0.85)';
  const W=1080,H=1350;
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle=bgColor;ctx.fillRect(0,0,W,H);
  if(posterURL){
    try{
      const img=await loadImage(posterURL);
      ctx.save();
      const scale=Math.max(W/img.width,H/img.height);
      const iw=img.width*scale,ih=img.height*scale;
      ctx.drawImage(img,(W-iw)/2,(H-ih)/2,iw,ih);
      ctx.restore();
      ctx.fillStyle='rgba(9,9,11,0.82)';ctx.fillRect(0,0,W,H);
      const ph=640,pw=ph*(2/3),px=(W-pw)/2,py=120;
      ctx.save();roundRect(ctx,px,py,pw,ph,18);ctx.clip();
      ctx.drawImage(img,px,py,pw,ph);ctx.restore();
    }catch(_){}
  }
  const grd=ctx.createLinearGradient(0,0,W,0);
  grd.addColorStop(0,'rgba(201,169,110,0)');grd.addColorStop(0.2,goldColor);
  grd.addColorStop(0.8,goldColor);grd.addColorStop(1,'rgba(201,169,110,0)');
  ctx.fillStyle=grd;ctx.fillRect(0,0,W,4);
  ctx.font='300 38px Georgia, serif';ctx.fillStyle=textColor;ctx.textAlign='center';
  ctx.fillText('Watchy',W/2-12,72);ctx.fillStyle=goldColor;ctx.fillText('.',W/2+56,72);
  const badgeLabel=type==='tv'?'SERIES':'FILM';
  ctx.font='500 20px Outfit, system-ui, sans-serif';
  const bw=ctx.measureText(badgeLabel).width+32,bx=(W-bw)/2,by=820;
  ctx.fillStyle='rgba(201,169,110,0.14)';roundRect(ctx,bx,by,bw,36,6);ctx.fill();
  ctx.strokeStyle='rgba(201,169,110,0.4)';ctx.lineWidth=1;roundRect(ctx,bx,by,bw,36,6);ctx.stroke();
  ctx.fillStyle=goldColor;ctx.textAlign='center';ctx.fillText(badgeLabel,W/2,by+24);
  ctx.font='400 72px Georgia, serif';ctx.fillStyle=textColor;ctx.textAlign='center';
  const titleLines=wrapText(ctx,title,W-120);let ty=900;
  titleLines.slice(0,2).forEach(line=>{ctx.fillText(line,W/2,ty);ty+=84;});
  ctx.font='300 30px Outfit, system-ui, sans-serif';ctx.fillStyle=subColor;
  ctx.fillText([year,score].filter(Boolean).join('  ·  '),W/2,ty+10);ty+=56;
  ctx.font='300 26px Outfit, system-ui, sans-serif';ctx.fillStyle='rgba(138,138,144,0.7)';
  wrapText(ctx,overview,W-160).slice(0,3).forEach(line=>{ctx.fillText(line,W/2,ty);ty+=36;});
  ctx.font='300 22px Outfit, system-ui, sans-serif';ctx.fillStyle='rgba(62,62,70,0.9)';
  ctx.textAlign='left';ctx.fillText(window.location.hostname,52,H-44);
  ctx.textAlign='right';ctx.fillText('@arbw_13',W-52,H-44);
  ctx.fillStyle='rgba(201,169,110,0.25)';ctx.fillRect(0,H-3,W,3);
  canvas.toBlob(async blob=>{
    const file=new File([blob],`watchy-${title.replace(/\s+/g,'-').toLowerCase()}.png`,{type:'image/png'});
    const movieUrl=`${window.location.origin}${window.location.pathname}#/title/${type}/${item.id}`;
    if(navigator.canShare?.({files:[file]})){
      try{await navigator.share({files:[file],title:`${title} on Watchy.`,text:`🎬 ${title} (${year})\n${movieUrl}`,url:movieUrl});return;}catch(_){}
    }
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=file.name;a.click();
    if(navigator.clipboard)navigator.clipboard.writeText(movieUrl).catch(()=>{});
    showToast('Image saved · Link copied');
  },'image/png');
}
function loadImage(url){
  return new Promise((resolve,reject)=>{
    const img=new Image();img.crossOrigin='anonymous';
    img.onload=()=>resolve(img);img.onerror=reject;img.src=url;
  });
}
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}
function wrapText(ctx,text,maxW){
  const words=text.split(' '),lines=[];let cur='';
  for(const w of words){
    const test=cur?cur+' '+w:w;
    if(ctx.measureText(test).width>maxW&&cur){lines.push(cur);cur=w;}else cur=test;
  }
  if(cur)lines.push(cur);return lines;
}
function copyTitleLink(){
  const item=S.titleItem;
  const url=item
    ?`${window.location.origin}${window.location.pathname}#/title/${mtyp(item)}/${item.id}`
    :window.location.href;
  if(navigator.clipboard){navigator.clipboard.writeText(url).then(()=>showToast('Link copied'));}
  else{const el=document.createElement('input');el.value=url;document.body.appendChild(el);el.select();document.execCommand('copy');document.body.removeChild(el);showToast('Link copied');}
}

/* ══════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',()=>{
  const startPage=S.lastPage||'home';

  async function navTo(p){
    goTo(p);
    if(p==='movies'&&!S.moviesLoaded){
      S.moviesLoaded=true;
      await loadFilteredGrid('movie');
      const grid=document.getElementById('movies-grid');
      initInfiniteScroll('movies-sentinel',async()=>{
        if(S.moviesLoading||S.moviesDone)return;
        S.moviesLoading=true;
        const more=await A.discoverFiltered('movie',buildGridParams(S.movieFilters,'movie'),S.moviesPage);
        if(!more.length){S.moviesDone=true;document.getElementById('movies-sentinel').style.display='none';}
        else{more.forEach(item=>{item.media_type='movie';grid.appendChild(makeCard(item,{twoLine:true}));});S.moviesPage++;}
        S.moviesLoading=false;
      });
    }
    if(p==='series'&&!S.seriesLoaded){
      S.seriesLoaded=true;
      await loadFilteredGrid('tv');
      const grid=document.getElementById('series-grid');
      initInfiniteScroll('series-sentinel',async()=>{
        if(S.seriesLoading||S.seriesDone)return;
        S.seriesLoading=true;
        const more=await A.discoverFiltered('tv',buildGridParams(S.seriesFilters,'tv'),S.seriesPage);
        if(!more.length){S.seriesDone=true;document.getElementById('series-sentinel').style.display='none';}
        else{more.forEach(item=>{item.media_type='tv';grid.appendChild(makeCard(item,{twoLine:true}));});S.seriesPage++;}
        S.seriesLoading=false;
      });
    }
    if(p==='mylist')refreshFavPage();
    if(p==='discover')initDiscover();
  }

  let _logoLong=false,_logoTimer=null;
  const logo=document.getElementById('nav-logo');
  const startLogoSearch=()=>{_logoTimer=setTimeout(()=>{_logoLong=true;openSearch();},550);};
  const endLogoSearch=()=>{clearTimeout(_logoTimer);};
  logo?.addEventListener('mousedown',startLogoSearch);
  logo?.addEventListener('mouseup',endLogoSearch);
  logo?.addEventListener('mouseleave',endLogoSearch);
  logo?.addEventListener('touchstart',startLogoSearch,{passive:true});
  logo?.addEventListener('touchend',endLogoSearch);
  logo?.addEventListener('click',e=>{if(_logoLong){_logoLong=false;e.preventDefault();return;}goTo('home');});

  // Nav
  document.querySelectorAll('.nav-link[data-page]').forEach(l=>l.addEventListener('click',()=>navTo(l.dataset.page)));
  document.querySelectorAll('.bot-nav-item[data-page]').forEach(l=>l.addEventListener('click',()=>navTo(l.dataset.page)));
  document.getElementById('bot-search-btn')?.addEventListener('click',openSearch);
  document.querySelectorAll('[data-goto]').forEach(el=>el.addEventListener('click',()=>navTo(el.dataset.goto)));

  // Hero
  document.getElementById('hero-play-btn').addEventListener('click',()=>{const item=S.heroItems[S.heroIdx];if(item)openPlayer(item,mtyp(item));});
  document.getElementById('hero-info-btn').addEventListener('click',()=>{const item=S.heroItems[S.heroIdx];if(item)openTitlePage(item);});

  // Continue watching clear
  document.getElementById('continue-clear-btn')?.addEventListener('click',()=>{S.hist=[];S.prog={};save();refreshContRow();showToast('Continue watching cleared');});
  document.getElementById('viewed-clear-btn')?.addEventListener('click',()=>{S.viewed=[];save();refreshViewedRow();showToast('Recently viewed cleared');});
  document.getElementById('fav-clear-btn')?.addEventListener('click',()=>{
    if(!S.favs.length)return;
    S.favs=[];save();refreshFavPage();showToast('My List cleared');
  });
  document.getElementById('fav-sort')?.addEventListener('change',e=>{S.favSort=e.target.value;refreshFavPage();});

  // Player
  document.getElementById('player-back-btn').addEventListener('click',()=>{haptic();goBack();});
  document.getElementById('player-ep-toggle')?.addEventListener('click',()=>document.getElementById('player-ep-panel')?.classList.toggle('open'));
  document.getElementById('player-episodes-btn')?.addEventListener('click',()=>document.getElementById('player-ep-panel')?.classList.toggle('open'));
  document.getElementById('player-next-ep')?.addEventListener('click',()=>{haptic();nextEpisode();});
  document.getElementById('player-prev-ep')?.addEventListener('click',()=>{haptic();prevEpisode();});
  document.getElementById('pep-close')?.addEventListener('click',()=>document.getElementById('player-ep-panel')?.classList.remove('open'));

  // Title page
  document.getElementById('tp-back-btn')?.addEventListener('click',()=>{haptic();goBack();});
  document.getElementById('tp-share-btn')?.addEventListener('click',()=>{if(S.titleItem)shareCard(S.titleItem);});
  document.getElementById('tp-copy-link-btn')?.addEventListener('click',copyTitleLink);

  // Person page
  document.getElementById('person-back-btn')?.addEventListener('click',()=>{haptic();goBack();});

  // Trailer
  document.getElementById('trailer-close')?.addEventListener('click',closeTrailer);
  document.getElementById('trailer-backdrop')?.addEventListener('click',closeTrailer);

  // Discover
  document.getElementById('discover-next')?.addEventListener('click',discoverNext);
  document.getElementById('discover-prev')?.addEventListener('click',discoverPrev);
  document.getElementById('discover-watch')?.addEventListener('click',discoverWatch);
  document.getElementById('discover-play')?.addEventListener('click',discoverPlay);
  document.getElementById('discover-skip')?.addEventListener('click',discoverSkip);
  document.getElementById('discover-type-movie')?.addEventListener('click',()=>{
    S.discoverType='movie';
    document.querySelectorAll('.discover-type-btn').forEach(b=>b.classList.toggle('active',b.dataset.t==='movie'));
    initDiscover();
  });
  document.getElementById('discover-type-tv')?.addEventListener('click',()=>{
    S.discoverType='tv';
    document.querySelectorAll('.discover-type-btn').forEach(b=>b.classList.toggle('active',b.dataset.t==='tv'));
    initDiscover();
  });
  document.querySelectorAll('#discover-moods .mood-chip').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('#discover-moods .mood-chip').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      S.discoverMood=btn.dataset.mood;
      initDiscover();
    });
  });

  document.getElementById('card-menu')?.addEventListener('click',e=>{
    const btn=e.target.closest('[data-action]');
    if(btn)handleCardMenuAction(btn.dataset.action);
  });
  document.addEventListener('click',e=>{if(!e.target.closest('#card-menu'))closeCardMenu();});

  const playFromTitleBackdrop=()=>{if(S.titleItem){haptic('heavy');playItem(S.titleItem);}};
  document.getElementById('tp-backdrop-wrap')?.addEventListener('click',playFromTitleBackdrop);
  document.getElementById('tp-play-hint')?.addEventListener('click',e=>{e.stopPropagation();playFromTitleBackdrop();});
  document.getElementById('tp-poster-btn')?.addEventListener('click',()=>{
    const src=document.getElementById('tp-poster')?.src;
    if(src)openPosterLightbox(src,document.getElementById('tp-poster')?.alt);
  });
  document.getElementById('poster-lightbox-close')?.addEventListener('click',closePosterLightbox);
  document.getElementById('poster-lightbox-backdrop')?.addEventListener('click',closePosterLightbox);

  // Search
  document.getElementById('search-icon-btn').addEventListener('click',openSearch);
  document.getElementById('search-overlay-close')?.addEventListener('click',closeSearch);
  document.getElementById('search-overlay-backdrop')?.addEventListener('click',closeSearch);
  document.getElementById('search-overlay-input')?.addEventListener('input',e=>{
    handleSearchInput(e.target.value);
    if(!e.target.value.trim())renderRecentSearches();
  });
  document.getElementById('search-recent-clear')?.addEventListener('click',()=>{
    S.recentSearches=[];localStorage.removeItem('wt_recent');renderRecentSearches();
    showToast('Recent searches cleared');
  });
  document.querySelectorAll('.search-filter-btn').forEach(b=>b.addEventListener('click',()=>setSearchFilter(b.dataset.f)));

  // Server panel
  buildServerSwitcher();
  document.getElementById('server-panel-toggle')?.addEventListener('click',toggleSrcPanel);
  document.getElementById('server-panel-close')?.addEventListener('click',closeSrcPanel);
  document.addEventListener('click',e=>{
    if(!e.target.closest('#src-panel')&&!e.target.closest('#server-panel-toggle'))closeSrcPanel();
  });
  document.getElementById('src-panel')?.addEventListener('keydown',e=>{
    if(e.key==='Escape')closeSrcPanel();
    const items=[...document.querySelectorAll('.server-opt')];
    const idx=items.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){e.preventDefault();items[(idx+1)%items.length]?.focus();}
    if(e.key==='ArrowUp'){e.preventDefault();items[(idx-1+items.length)%items.length]?.focus();}
  });
  // aria-expanded sync
  const srcBtn=document.getElementById('server-panel-toggle');
  const srcPanel=document.getElementById('src-panel');
  if(srcBtn&&srcPanel){
    new MutationObserver(()=>{
      srcBtn.setAttribute('aria-expanded',srcPanel.classList.contains('open').toString());
    }).observe(srcPanel,{attributes:true,attributeFilter:['class']});
  }

  // Setup
  A.genreLists().then(()=>{
    populateGenreSelect('movies-genre');
    populateGenreSelect('series-genre');
  });
  buildYearOptions('movies-year');
  buildYearOptions('series-year');
  buildFilterChips('movies-sort','movies-sort-chips');
  buildFilterChips('series-sort','series-sort-chips');
  bindGridFilters('movie');
  bindGridFilters('tv');
  setupGenres();initKeyboard();initDiscoverSwipe();initHomePullRefresh();setupDiscoverGenres();startHomeRefresh();

  // Start
  goTo(startPage,true);
  if(startPage==='movies')navTo('movies');
  else if(startPage==='series')navTo('series');
  else if(startPage==='mylist')navTo('mylist');
  else if(startPage==='discover')navTo('discover');
  else loadHome();
  if(startPage!=='home')loadHome();

  // Hash routing
  if(window.location.hash)routeFromHash();
  window.addEventListener('popstate',()=>{
    const hash=window.location.hash.replace(/^#\/?/,'');
    if(!hash&&['title','person','player'].includes(S.page))goBack();
  });

  // PWA
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  setTimeout(showInstallBanner,2000);
  document.getElementById('install-btn')?.addEventListener('click',async()=>{
    document.getElementById('install-banner')?.classList.remove('show');
    if(_installPrompt){_installPrompt.prompt();await _installPrompt.userChoice;_installPrompt=null;}
    else showToast('On Chrome: Menu → "Add to Home Screen"');
    localStorage.setItem('wt_install_dismissed','1');
  });
  document.getElementById('install-dismiss')?.addEventListener('click',()=>{
    document.getElementById('install-banner')?.classList.remove('show');
    localStorage.setItem('wt_install_dismissed','1');
  });
});
