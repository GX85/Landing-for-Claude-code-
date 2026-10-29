/**
 * Ready-made games. Each one is a tested engine; the model only picks one and fills in
 * the title, colours and texts, so the result always runs and always looks finished.
 * All games: start and game-over screens, best score, keyboard + touch, pause when hidden.
 */

import { cssVars, esc, FONT, jsonForScript, list, pickTheme, str } from "./kit";

export interface GameConfig {
  template: string;
  pad?: string;
  controls?: string;
  title?: string;
  subtitle?: string;
  theme?: string;
  lang?: string;
  text?: { start?: string; restart?: string; score?: string; best?: string; gameOver?: string; win?: string; controls?: string };
  icons?: string[];
  difficulty?: "easy" | "normal" | "hard";
}

/* ---------- the shell every game runs in ---------- */

const SHELL_JS = `
(function(){
  var cv=document.getElementById("c"),ov=document.getElementById("ov"),go=document.getElementById("go"),
      fin=document.getElementById("final"),msg=document.getElementById("msg"),sc=document.getElementById("score"),
      bestEl=document.getElementById("best"),pad=document.getElementById("pad");
  var css=getComputedStyle(document.documentElement);
  var C={a:css.getPropertyValue("--a").trim(),b:css.getPropertyValue("--b").trim(),fg:css.getPropertyValue("--fg").trim(),muted:css.getPropertyValue("--muted").trim(),bg:css.getPropertyValue("--bg").trim(),bg2:css.getPropertyValue("--bg2").trim()};
  var KEY="focus-best-"+location.pathname+document.title;
  var best=0;try{best=+localStorage.getItem(KEY)||0}catch(e){}
  bestEl.textContent=best;
  var state="menu",score=0,shake=0,parts=[],last=0,g=null,W=0,H=0,DPR=1,hidden=false;
  var DIFF=({easy:.8,normal:1,hard:1.3})[CFG.difficulty]||1;
  var api={
    W:function(){return W},H:function(){return H},c:C,diff:DIFF,cfg:CFG,
    rnd:function(n){return Math.floor(Math.random()*n)},
    add:function(n){score+=n;sc.textContent=score},
    set:function(n){score=n;sc.textContent=score},
    get score(){return score},
    shake:function(n){shake=Math.max(shake,n)},
    burst:function(x,y,color,n){for(var i=0;i<(n||14);i++){var a=Math.random()*6.283,s=60+Math.random()*220;parts.push({x:x,y:y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,l:.5+Math.random()*.5,t:0,c:color||C.a,r:2+Math.random()*3})}},
    end:function(won){finish(won)}
  };
  var G=(GAME)(api);
  if(!G.webgl)g=cv.getContext("2d");
  if(pad.children.length)pad.classList.add("on");
  function resize(){DPR=Math.min(2,window.devicePixelRatio||1);W=innerWidth;H=innerHeight;cv.width=W*DPR;cv.height=H*DPR;if(g)g.setTransform(DPR,0,0,DPR,0,0);if(G.resize)G.resize(W,H)}
  addEventListener("resize",resize);resize();
  function start(){score=0;sc.textContent="0";parts=[];G.reset();state="play";ov.classList.add("hide");last=0}
  function finish(won){if(state!=="play")return;state="over";if(score>best){best=score;bestEl.textContent=best;try{localStorage.setItem(KEY,best)}catch(e){}}
    fin.hidden=false;fin.textContent=score;msg.textContent=won?CFG.text.win:CFG.text.gameOver;go.textContent=CFG.text.restart;
    setTimeout(function(){ov.classList.remove("hide")},450)}
  go.addEventListener("click",function(e){e.stopPropagation();start()});
  addEventListener("keydown",function(e){
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].indexOf(e.key)>=0)e.preventDefault();
    if(state!=="play"){if(e.key==="Enter"||e.key===" ")start();return}
    if(G.key)G.key(e.key.length===1?e.key.toLowerCase():e.key,true)});
  addEventListener("keyup",function(e){if(state==="play"&&G.key)G.key(e.key.length===1?e.key.toLowerCase():e.key,false)});
  var sx=0,sy=0,st=0;
  cv.addEventListener("pointerdown",function(e){sx=e.clientX;sy=e.clientY;st=Date.now();if(state==="play"&&G.down)G.down(e.clientX,e.clientY)});
  cv.addEventListener("pointermove",function(e){if(state==="play"&&G.move)G.move(e.clientX,e.clientY,e.buttons>0||e.pointerType==="touch")});
  cv.addEventListener("pointerup",function(e){if(state!=="play")return;var dx=e.clientX-sx,dy=e.clientY-sy;
    if(Math.max(Math.abs(dx),Math.abs(dy))>28&&G.swipe)G.swipe(Math.abs(dx)>Math.abs(dy)?(dx>0?"right":"left"):(dy>0?"down":"up"));
    else if(Date.now()-st<300&&G.tap)G.tap(e.clientX,e.clientY);
    if(G.up)G.up(e.clientX,e.clientY)});
  pad.querySelectorAll("button").forEach(function(b){var k=b.getAttribute("data-k");
    b.addEventListener("pointerdown",function(e){e.preventDefault();if(state!=="play"){start();return}if(G.key)G.key(k,true)});
    b.addEventListener("pointerup",function(){if(G.key)G.key(k,false)});b.addEventListener("pointerleave",function(){if(G.key)G.key(k,false)})});
  document.addEventListener("visibilitychange",function(){hidden=document.hidden;last=0});
  function frame(t){requestAnimationFrame(frame);if(hidden)return;var dt=last?Math.min(.05,(t-last)/1000):0;last=t;
    if(state==="play")G.update(dt);
    if(G.webgl){G.draw(null,t/1000);return}
    g.save();if(shake>0){g.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake=Math.max(0,shake-dt*40)}
    G.draw(g,t/1000);
    for(var i=parts.length-1;i>=0;i--){var p=parts[i];p.t+=dt;if(p.t>p.l){parts.splice(i,1);continue}p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.96;p.vy*=.96;
      g.globalAlpha=1-p.t/p.l;g.fillStyle=p.c;g.beginPath();g.arc(p.x,p.y,p.r,0,6.283);g.fill()}
    g.globalAlpha=1;g.restore()}
  if(G.reset)G.reset();
  requestAnimationFrame(frame);
})();`;

const PADS: Record<string, string> = {
  dpad: '<button data-k="ArrowLeft" aria-label="Left">◀</button><div class="col"><button data-k="ArrowUp" aria-label="Up">▲</button><button data-k="ArrowDown" aria-label="Down">▼</button></div><button data-k="ArrowRight" aria-label="Right">▶</button>',
  lr: '<button data-k="ArrowLeft" aria-label="Left">◀</button><button data-k=" " aria-label="Action">●</button><button data-k="ArrowRight" aria-label="Right">▶</button>',
  tetris: '<button data-k="ArrowLeft" aria-label="Left">◀</button><button data-k="ArrowUp" aria-label="Rotate">⟳</button><button data-k="ArrowDown" aria-label="Down">▼</button><button data-k="ArrowRight" aria-label="Right">▶</button>',
};

function shell(cfg: GameConfig, def: GameDef): string {
  const t = pickTheme(cfg.theme ?? def.theme);
  const ru = (cfg.lang ?? "").startsWith("ru");
  const tx = {
    start: str(cfg.text?.start, ru ? "Играть" : "Play", 30),
    restart: str(cfg.text?.restart, ru ? "Ещё раз" : "Play again", 30),
    score: str(cfg.text?.score, ru ? "Очки" : "Score", 20),
    best: str(cfg.text?.best, ru ? "Рекорд" : "Best", 20),
    gameOver: str(cfg.text?.gameOver, ru ? "Игра окончена" : "Game over", 60),
    win: str(cfg.text?.win, ru ? "Победа!" : "You win!", 60),
    controls: str(cfg.text?.controls ?? cfg.controls, ru ? def.controls[1] : def.controls[0], 160),
  };
  const title = str(cfg.title, def.name, 60);
  const runtime = { difficulty: cfg.difficulty ?? "normal", icons: list<string>(cfg.icons, 12).map((i) => String(i).slice(0, 8)), text: tx };
  const pad = def.pad && PADS[def.pad] ? def.pad : "";
  return `<!DOCTYPE html>
<html lang="${esc(cfg.lang ?? "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>${esc(title)}</title>
<style>
:root{${cssVars(t)}}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{height:100%;overflow:hidden;background:radial-gradient(120% 90% at 50% 0%,var(--bg2),var(--bg));color:var(--fg);font-family:${FONT};touch-action:none;-webkit-user-select:none;user-select:none}
#c{position:fixed;inset:0;width:100%;height:100%;display:block}
.hud{position:fixed;top:12px;left:16px;right:16px;display:flex;justify-content:space-between;font-weight:800;font-size:22px;z-index:2;pointer-events:none;text-shadow:0 2px 12px rgba(0,0,0,.35)}
.hud small{display:block;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.overlay{position:fixed;inset:0;display:grid;place-items:center;z-index:3;background:color-mix(in srgb,var(--bg) 55%,transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:opacity .35s}
.overlay.hide{opacity:0;pointer-events:none}
.card{text-align:center;padding:34px 30px;border-radius:26px;background:var(--card);border:1px solid var(--line);width:min(420px,88vw);box-shadow:0 30px 80px -30px rgba(0,0,0,.7)}
h1{font-size:clamp(34px,9vw,58px);line-height:1;letter-spacing:-.035em;font-weight:900;background:linear-gradient(120deg,var(--a),var(--b));-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:12px;overflow-wrap:anywhere}
.big{font-size:48px;font-weight:900;margin:0 0 4px}
.card p{color:var(--muted);margin:0 0 22px;line-height:1.45;font-size:15px}
.play{border:0;border-radius:999px;padding:15px 38px;font:800 17px ${FONT};color:${t.dark ? "#0b0b0e" : "#fff"};background:linear-gradient(120deg,var(--a),var(--b));cursor:pointer;box-shadow:0 12px 30px -12px var(--a);transition:transform .15s}
.play:active{transform:scale(.96)}
.pad{position:fixed;left:0;right:0;bottom:calc(16px + env(safe-area-inset-bottom,0px));display:none;justify-content:center;align-items:center;gap:12px;z-index:2}
.pad .col{display:flex;flex-direction:column;gap:10px}
.pad button{width:62px;height:62px;border-radius:18px;border:1px solid var(--line);background:var(--card);color:var(--fg);font-size:22px;touch-action:none}
.pad button:active{background:color-mix(in srgb,var(--a) 30%,transparent)}
@media (hover:none){.pad.on{display:flex}}
</style></head><body>
<canvas id="c" aria-label="${esc(title)}"></canvas>
<div class="hud"><div><small>${esc(tx.score)}</small><span id="score">0</span></div><div style="text-align:right"><small>${esc(tx.best)}</small><span id="best">0</span></div></div>
<div class="overlay" id="ov"><div class="card"><h1>${esc(title)}</h1><div class="big" id="final" hidden></div><p id="msg">${esc(str(cfg.subtitle, "", 140))}${cfg.subtitle ? "<br>" : ""}${esc(tx.controls)}</p><button class="play" id="go">${esc(tx.start)}</button></div></div>
<div class="pad" id="pad">${pad ? PADS[pad] : ""}</div>
${def.head ?? ""}
<script>var CFG=${jsonForScript(runtime)};</script>
<script>${SHELL_JS.replace("(GAME)", `(${def.js})`)}</script>
</body></html>`;
}

interface GameDef {
  name: string;
  theme: string;
  pad?: string;
  controls: [string, string];
  /** What it is, for the model choosing a template. */
  about: string;
  head?: string;
  js: string;
}

/* ---------- the games ---------- */

const GAMES: Record<string, GameDef> = {
  snake: {
    name: "Snake",
    theme: "neon",
    pad: "dpad",
    about: "classic snake on a grid; eat food, grow, don't hit walls or yourself",
    controls: ["Arrows / WASD or swipe", "Стрелки / WASD или свайпы"],
    js: `function(api){
  var N=20,cell=20,ox=0,oy=0,snake,dir,next,food,acc,speed;
  function lay(){var s=Math.min(api.W()-24,api.H()-150);cell=Math.max(10,Math.floor(s/N));ox=(api.W()-cell*N)/2;oy=Math.max(70,(api.H()-cell*N)/2)}
  function place(){do{food={x:api.rnd(N),y:api.rnd(N)}}while(snake.some(function(p){return p.x===food.x&&p.y===food.y}))}
  var M={arrowup:[0,-1],w:[0,-1],arrowdown:[0,1],s:[0,1],arrowleft:[-1,0],a:[-1,0],arrowright:[1,0],d:[1,0]};
  return{pad:"dpad",
    reset:function(){lay();snake=[{x:7,y:10},{x:6,y:10},{x:5,y:10}];dir={x:1,y:0};next=dir;acc=0;speed=7*api.diff;place()},
    resize:lay,
    key:function(k,d){if(!d)return;var m=M[String(k).toLowerCase()];if(m&&!(m[0]===-dir.x&&m[1]===-dir.y))next={x:m[0],y:m[1]}},
    swipe:function(s){this.key({up:"ArrowUp",down:"ArrowDown",left:"ArrowLeft",right:"ArrowRight"}[s],true)},
    update:function(dt){acc+=dt;var step=1/speed;while(acc>=step){acc-=step;dir=next;var h={x:snake[0].x+dir.x,y:snake[0].y+dir.y};
      if(h.x<0||h.y<0||h.x>=N||h.y>=N||snake.some(function(p){return p.x===h.x&&p.y===h.y})){api.shake(12);api.burst(ox+snake[0].x*cell+cell/2,oy+snake[0].y*cell+cell/2,api.c.a,30);api.end();return}
      snake.unshift(h);if(h.x===food.x&&h.y===food.y){api.add(10);api.burst(ox+h.x*cell+cell/2,oy+h.y*cell+cell/2,api.c.b,18);speed=Math.min(18,speed+.35);place()}else snake.pop()}},
    draw:function(g,t){g.clearRect(0,0,api.W(),api.H());
      g.fillStyle="rgba(255,255,255,.04)";g.beginPath();g.roundRect(ox-6,oy-6,cell*N+12,cell*N+12,14);g.fill();
      g.strokeStyle="rgba(255,255,255,.05)";g.lineWidth=1;for(var i=0;i<=N;i++){g.beginPath();g.moveTo(ox+i*cell+.5,oy);g.lineTo(ox+i*cell+.5,oy+N*cell);g.stroke();g.beginPath();g.moveTo(ox,oy+i*cell+.5);g.lineTo(ox+N*cell,oy+i*cell+.5);g.stroke()}
      if(!snake)return;var pulse=.75+Math.sin(t*6)*.25;g.shadowBlur=18;g.shadowColor=api.c.b;g.fillStyle=api.c.b;g.globalAlpha=pulse;g.beginPath();g.arc(ox+food.x*cell+cell/2,oy+food.y*cell+cell/2,cell*.34,0,6.283);g.fill();g.globalAlpha=1;
      g.shadowColor=api.c.a;snake.forEach(function(p,i){g.fillStyle=i===0?api.c.fg:api.c.a;g.globalAlpha=1-i/(snake.length*1.6);g.beginPath();g.roundRect(ox+p.x*cell+2,oy+p.y*cell+2,cell-4,cell-4,Math.min(7,cell/3));g.fill()});g.globalAlpha=1;g.shadowBlur=0}
  }}`,
  },

  breakout: {
    name: "Breakout",
    theme: "candy",
    pad: "lr",
    about: "paddle and ball breaking rows of bricks, levels get faster",
    controls: ["Move the mouse or finger · ← → · Space to launch", "Двигай мышью или пальцем · ← → · пробел — запуск"],
    js: `function(api){
  var px,pw,ball,stuck,bricks,lives,level,keys={},cols=9,rows=6;
  function build(){bricks=[];var bw=(api.W()-40)/cols,bh=Math.min(26,api.H()*.03);for(var r=0;r<rows;r++)for(var c=0;c<cols;c++)bricks.push({x:20+c*bw+3,y:90+r*(bh+8),w:bw-6,h:bh,hp:r<2&&level>1?2:1,r:r})}
  function serve(){stuck=true;ball={x:px,y:api.H()-70,vx:0,vy:0,r:8}}
  return{pad:"lr",
    reset:function(){level=1;lives=3;pw=Math.max(80,api.W()*.16);px=api.W()/2;build();serve()},
    resize:function(){pw=Math.max(80,api.W()*.16)},
    key:function(k,d){keys[k]=d;if(d&&k===" "&&stuck)this.launch()},
    move:function(x){px=x},tap:function(){if(stuck)this.launch()},
    launch:function(){stuck=false;var s=(380+level*40)*api.diff;ball.vx=s*(Math.random()-.5)*.8;ball.vy=-s},
    update:function(dt){var W=api.W(),H=api.H();if(keys.ArrowLeft||keys.a)px-=620*dt;if(keys.ArrowRight||keys.d)px+=620*dt;px=Math.max(pw/2,Math.min(W-pw/2,px));
      if(stuck){ball.x=px;ball.y=H-70;return}
      ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;
      if(ball.x<ball.r){ball.x=ball.r;ball.vx*=-1}if(ball.x>W-ball.r){ball.x=W-ball.r;ball.vx*=-1}if(ball.y<60+ball.r){ball.y=60+ball.r;ball.vy*=-1}
      var py=H-56;if(ball.vy>0&&ball.y+ball.r>py&&ball.y<py+14&&Math.abs(ball.x-px)<pw/2+ball.r){var o=(ball.x-px)/(pw/2),sp=Math.hypot(ball.vx,ball.vy)*1.01;ball.vx=sp*o*.8;ball.vy=-Math.sqrt(Math.max(1,sp*sp-ball.vx*ball.vx));api.burst(ball.x,py,api.c.fg,6)}
      for(var i=bricks.length-1;i>=0;i--){var b=bricks[i];if(ball.x+ball.r>b.x&&ball.x-ball.r<b.x+b.w&&ball.y+ball.r>b.y&&ball.y-ball.r<b.y+b.h){
        var ox=Math.min(ball.x+ball.r-b.x,b.x+b.w-ball.x+ball.r),oy=Math.min(ball.y+ball.r-b.y,b.y+b.h-ball.y+ball.r);if(ox<oy)ball.vx*=-1;else ball.vy*=-1;
        if(--b.hp<=0){bricks.splice(i,1);api.add(10*level);api.burst(b.x+b.w/2,b.y+b.h/2,b.r%2?api.c.a:api.c.b,14)}api.shake(3);break}}
      if(!bricks.length){level++;build();serve()}
      if(ball.y>H+20){lives--;api.shake(10);if(lives<=0)api.end();else serve()}},
    draw:function(g,t){var W=api.W(),H=api.H();g.clearRect(0,0,W,H);
      if(!bricks)return;bricks.forEach(function(b){var k=b.r/(rows-1);g.fillStyle=k<.5?api.c.a:api.c.b;g.globalAlpha=b.hp>1?1:.82;g.beginPath();g.roundRect(b.x,b.y,b.w,b.h,6);g.fill()});g.globalAlpha=1;
      g.fillStyle=api.c.fg;g.shadowBlur=16;g.shadowColor=api.c.a;g.beginPath();g.roundRect(px-pw/2,H-56,pw,14,7);g.fill();
      g.beginPath();g.arc(ball.x,ball.y,ball.r,0,6.283);g.fill();g.shadowBlur=0;
      for(var i=0;i<lives;i++){g.fillStyle=api.c.b;g.beginPath();g.arc(W/2-20+i*20,30,5,0,6.283);g.fill()}}
  }}`,
  },

  flappy: {
    name: "Flappy",
    theme: "sky",
    about: "tap to flap a bird through gaps between pipes",
    controls: ["Tap, click or Space to fly", "Тап, клик или пробел — взмах"],
    js: `function(api){
  var by,vy,pipes,timer,clouds,gx;
  function flap(){vy=-420}
  return{
    reset:function(){by=api.H()/2;vy=0;pipes=[];timer=0;gx=0;clouds=[];for(var i=0;i<6;i++)clouds.push({x:Math.random()*api.W(),y:60+Math.random()*api.H()*.5,s:.5+Math.random()})},
    key:function(k,d){if(d&&(k===" "||k==="ArrowUp"||k==="w"))flap()},down:flap,
    update:function(dt){var W=api.W(),H=api.H(),sp=180*api.diff+Math.min(120,api.score*3);vy+=1250*dt;by+=vy*dt;gx=(gx+sp*dt)%40;
      timer-=dt;if(timer<=0){timer=1.55;var gap=Math.max(130,190-api.score*2),c=110+Math.random()*(H-gap-260);pipes.push({x:W+40,top:c,gap:gap,pass:false})}
      var bx=W*.3;for(var i=pipes.length-1;i>=0;i--){var p=pipes[i];p.x-=sp*dt;if(p.x<-80){pipes.splice(i,1);continue}
        if(!p.pass&&p.x+30<bx){p.pass=true;api.add(1);api.burst(bx,by,api.c.b,10)}
        if(bx+16>p.x-30&&bx-16<p.x+30&&(by-16<p.top||by+16>p.top+p.gap)){api.shake(12);api.burst(bx,by,api.c.a,30);api.end();return}}
      if(by>H-60||by<0){api.shake(12);api.burst(bx,by,api.c.a,30);api.end()}
      clouds.forEach(function(c){c.x-=sp*.2*c.s*dt;if(c.x<-120)c.x=W+60})},
    draw:function(g,t){var W=api.W(),H=api.H();g.clearRect(0,0,W,H);
      if(!clouds)return;g.fillStyle="rgba(255,255,255,.55)";clouds.forEach(function(c){g.beginPath();g.ellipse(c.x,c.y,60*c.s,22*c.s,0,0,6.283);g.fill()});
      pipes.forEach(function(p){var gr=g.createLinearGradient(p.x-30,0,p.x+30,0);gr.addColorStop(0,api.c.b);gr.addColorStop(1,api.c.a);g.fillStyle=gr;
        g.beginPath();g.roundRect(p.x-30,-10,60,p.top+10,10);g.fill();g.beginPath();g.roundRect(p.x-30,p.top+p.gap,60,H,10);g.fill()});
      g.fillStyle=api.c.a;g.fillRect(0,H-60,W,60);g.fillStyle="rgba(255,255,255,.25)";for(var x=-gx;x<W;x+=40)g.fillRect(x,H-60,20,6);
      var bx=W*.3,ang=Math.max(-.5,Math.min(1,vy/600));g.save();g.translate(bx,by);g.rotate(ang);
      g.fillStyle="#ffd43b";g.beginPath();g.arc(0,0,17,0,6.283);g.fill();g.fillStyle="#fff";g.beginPath();g.arc(6,-5,6,0,6.283);g.fill();
      g.fillStyle="#111";g.beginPath();g.arc(8,-5,2.6,0,6.283);g.fill();g.fillStyle="#ff8a3d";g.beginPath();g.moveTo(14,1);g.lineTo(26,4);g.lineTo(14,8);g.fill();
      g.fillStyle="#f5b700";g.beginPath();g.ellipse(-5,4,9,5,Math.sin(t*20)*.5,0,6.283);g.fill();g.restore()}
  }}`,
  },

  "2048": {
    name: "2048",
    theme: "paper",
    pad: "dpad",
    about: "slide numbered tiles on a 4x4 grid to merge them up to 2048",
    controls: ["Arrows / WASD or swipe", "Стрелки / WASD или свайпы"],
    js: `function(api){
  var b,born,size,ox,oy,gap=10,moved;
  function empty(){var e=[];for(var i=0;i<16;i++)if(!b[i])e.push(i);return e}
  function spawn(){var e=empty();if(!e.length)return;var i=e[api.rnd(e.length)];b[i]=Math.random()<.9?2:4;born[i]=performance.now()}
  function lay(){var s=Math.min(api.W()-32,api.H()-170,520);size=(s-gap*5)/4;ox=(api.W()-s)/2;oy=Math.max(80,(api.H()-s)/2)}
  function canMove(){if(empty().length)return true;for(var r=0;r<4;r++)for(var c=0;c<4;c++){var v=b[r*4+c];if(c<3&&b[r*4+c+1]===v)return true;if(r<3&&b[r*4+c+4]===v)return true}return false}
  function slide(dir){var any=false;for(var l=0;l<4;l++){var idx=[];for(var k=0;k<4;k++){var r,c;if(dir==="left"){r=l;c=k}else if(dir==="right"){r=l;c=3-k}else if(dir==="up"){r=k;c=l}else{r=3-k;c=l}idx.push(r*4+c)}
    var vals=idx.map(function(i){return b[i]}).filter(Boolean),out=[];for(var i=0;i<vals.length;i++){if(vals[i]===vals[i+1]){out.push(vals[i]*2);api.add(vals[i]*2);i++}else out.push(vals[i])}
    for(var j=0;j<4;j++){var nv=out[j]||0;if(b[idx[j]]!==nv){any=true;if(nv&&out[j]&&vals.indexOf(nv)<0)born[idx[j]]=performance.now()}b[idx[j]]=nv}}
    if(any){spawn();if(b.indexOf(2048)>=0){api.burst(api.W()/2,api.H()/2,api.c.a,60);api.end(true);return}if(!canMove()){api.shake(8);api.end()}}}
  return{pad:"dpad",
    reset:function(){b=[];born=[];for(var i=0;i<16;i++){b.push(0);born.push(0)}lay();spawn();spawn()},resize:lay,
    key:function(k,d){if(!d)return;var m={arrowleft:"left",a:"left",arrowright:"right",d:"right",arrowup:"up",w:"up",arrowdown:"down",s:"down"}[String(k).toLowerCase()];if(m)slide(m)},
    swipe:slide,update:function(){},
    draw:function(g){g.clearRect(0,0,api.W(),api.H());if(!b)return;var s=size*4+gap*5;g.fillStyle="rgba(120,100,70,.18)";g.beginPath();g.roundRect(ox,oy,s,s,16);g.fill();
      var now=performance.now();for(var i=0;i<16;i++){var r=Math.floor(i/4),c=i%4,x=ox+gap+c*(size+gap),y=oy+gap+r*(size+gap),v=b[i];
        g.fillStyle="rgba(120,100,70,.14)";g.beginPath();g.roundRect(x,y,size,size,10);g.fill();if(!v)continue;
        var lvl=Math.log2(v),k=Math.min(1,(lvl-1)/10),sc=Math.min(1,(now-born[i])/140);sc=.6+.4*sc;
        g.save();g.translate(x+size/2,y+size/2);g.scale(sc,sc);g.fillStyle=lvl<3?"#eee4da":"hsl("+(30-k*40)+" "+(70+k*20)+"% "+(62-k*20)+"%)";
        g.beginPath();g.roundRect(-size/2,-size/2,size,size,10);g.fill();g.fillStyle=lvl<3?"#776e65":"#fff";
        g.font="800 "+(v<100?size*.45:v<1000?size*.36:size*.28)+"px system-ui,sans-serif";g.textAlign="center";g.textBaseline="middle";g.fillText(v,0,2);g.restore()}}
  }}`,
  },

  shooter: {
    name: "Star Raid",
    theme: "ocean",
    pad: "lr",
    about: "space shooter: your ship auto-fires at waves of enemies coming down",
    controls: ["Drag or ← → to move · you fire automatically", "Веди пальцем или ← → · стрельба автоматическая"],
    js: `function(api){
  var sx,sy,bul,en,eb,stars,cool,wave,lives,inv,keys={},tx=null;
  function spawnWave(){wave++;var n=5+wave*2;for(var i=0;i<n;i++)en.push({x:60+Math.random()*(api.W()-120),y:-40-i*55,hp:1+Math.floor(wave/3),ph:Math.random()*6,t:0,big:i%7===6})}
  return{pad:"lr",
    reset:function(){sx=api.W()/2;sy=api.H()-110;bul=[];en=[];eb=[];cool=0;wave=0;lives=3;inv=0;stars=[];for(var i=0;i<90;i++)stars.push({x:Math.random()*api.W(),y:Math.random()*api.H(),z:Math.random()});spawnWave()},
    key:function(k,d){keys[k]=d},move:function(x,y,pressed){if(pressed)tx=x},down:function(x){tx=x},up:function(){tx=null},
    update:function(dt){var W=api.W(),H=api.H();if(keys.ArrowLeft||keys.a)sx-=420*dt;if(keys.ArrowRight||keys.d)sx+=420*dt;if(tx!==null)sx+=(tx-sx)*Math.min(1,dt*12);sx=Math.max(20,Math.min(W-20,sx));sy=H-110;
      stars.forEach(function(s){s.y+=(30+s.z*140)*dt;if(s.y>H){s.y=0;s.x=Math.random()*W}});
      cool-=dt;if(cool<=0){cool=.16;bul.push({x:sx-9,y:sy-16},{x:sx+9,y:sy-16})}
      bul.forEach(function(b){b.y-=760*dt});bul=bul.filter(function(b){return b.y>-20});
      inv=Math.max(0,inv-dt);
      for(var i=en.length-1;i>=0;i--){var e=en[i];e.t+=dt;e.y+=(60+wave*8)*api.diff*dt;e.x+=Math.sin(e.t*2+e.ph)*80*dt;
        if(e.y>20&&Math.random()<dt*.35*api.diff)eb.push({x:e.x,y:e.y+14,vy:220+wave*10});
        for(var j=bul.length-1;j>=0;j--){var b=bul[j];if(Math.abs(b.x-e.x)<(e.big?28:18)&&Math.abs(b.y-e.y)<(e.big?24:16)){bul.splice(j,1);if(--e.hp<=0){api.burst(e.x,e.y,e.big?api.c.b:api.c.a,e.big?30:16);api.add(e.big?50:10);api.shake(e.big?8:3);en.splice(i,1)}break}}
        if(en[i]===e&&(e.y>H+40)){en.splice(i,1)}
        else if(en[i]===e&&!inv&&Math.abs(e.x-sx)<24&&Math.abs(e.y-sy)<24){en.splice(i,1);this.hit()}}
      for(var k=eb.length-1;k>=0;k--){var q=eb[k];q.y+=q.vy*dt;if(q.y>H){eb.splice(k,1);continue}if(!inv&&Math.abs(q.x-sx)<14&&Math.abs(q.y-sy)<16){eb.splice(k,1);this.hit()}}
      if(!en.length)spawnWave()},
    hit:function(){lives--;inv=1.6;api.shake(14);api.burst(sx,sy,api.c.fg,30);if(lives<=0)api.end()},
    draw:function(g,t){var W=api.W(),H=api.H();g.clearRect(0,0,W,H);if(!stars)return;
      stars.forEach(function(s){g.fillStyle="rgba(255,255,255,"+(.25+s.z*.6)+")";g.fillRect(s.x,s.y,1+s.z*1.6,1+s.z*1.6)});
      g.shadowBlur=12;g.shadowColor=api.c.a;g.fillStyle=api.c.a;bul.forEach(function(b){g.fillRect(b.x-1.5,b.y-8,3,12)});
      g.shadowColor="#ff4d6d";g.fillStyle="#ff4d6d";eb.forEach(function(q){g.beginPath();g.arc(q.x,q.y,4,0,6.283);g.fill()});
      en.forEach(function(e){var r=e.big?24:15;g.shadowColor=e.big?api.c.b:"#ff7a8a";g.fillStyle=e.big?api.c.b:"#ff7a8a";g.beginPath();g.moveTo(e.x,e.y+r);g.lineTo(e.x-r,e.y-r*.6);g.lineTo(e.x,e.y-r*.2);g.lineTo(e.x+r,e.y-r*.6);g.closePath();g.fill()});
      if(!inv||Math.floor(t*12)%2){g.shadowColor=api.c.b;g.fillStyle=api.c.fg;g.beginPath();g.moveTo(sx,sy-22);g.lineTo(sx-18,sy+16);g.lineTo(sx,sy+8);g.lineTo(sx+18,sy+16);g.closePath();g.fill();
        g.fillStyle=api.c.b;g.beginPath();g.moveTo(sx-6,sy+12);g.lineTo(sx,sy+22+Math.random()*10);g.lineTo(sx+6,sy+12);g.fill()}
      g.shadowBlur=0;for(var i=0;i<lives;i++){g.fillStyle=api.c.a;g.beginPath();g.arc(W/2-18+i*18,30,5,0,6.283);g.fill()}}
  }}`,
  },

  memory: {
    name: "Memory",
    theme: "candy",
    about: "flip cards to find matching pairs of pictures, fewer moves = more points",
    controls: ["Tap two cards to find a pair", "Открывай по две карты и ищи пары"],
    js: `function(api){
  var cards,open,lock,moves,found,cw,ch,ox,oy,started,cols=4,rows=4;
  var DEF=["🍕","🚀","🎧","🐙","🌵","⚡","🍩","🦊","🎲","🌈"];
  function lay(){cols=api.W()>api.H()?4:4;rows=4;var s=Math.min(api.W()-32,api.H()-170,560);cw=(s-10*(cols-1))/cols;ch=cw*1.15;ox=(api.W()-(cw*cols+10*(cols-1)))/2;oy=Math.max(80,(api.H()-(ch*rows+10*(rows-1)))/2)}
  return{
    reset:function(){var icons=(api.cfg.icons&&api.cfg.icons.length>=8?api.cfg.icons:DEF).slice(0,8),deck=icons.concat(icons);for(var i=deck.length-1;i>0;i--){var j=api.rnd(i+1),t=deck[i];deck[i]=deck[j];deck[j]=t}
      cards=deck.map(function(v){return{v:v,up:false,done:false,f:0}});open=[];lock=false;moves=0;found=0;started=performance.now();lay();api.set(0)},resize:lay,
    tap:function(x,y){if(lock)return;var c=Math.floor((x-ox)/(cw+10)),r=Math.floor((y-oy)/(ch+10));if(c<0||r<0||c>=cols||r>=rows)return;var k=cards[r*cols+c];if(!k||k.up||k.done)return;
      k.up=true;open.push(k);if(open.length===2){moves++;lock=true;var a=open[0],b=open[1];setTimeout(function(){
        if(a.v===b.v){a.done=b.done=true;found++;api.burst(api.W()/2,api.H()/2,api.c.a,16);var sec=(performance.now()-started)/1000;api.set(Math.max(10,found*100-moves*5-Math.floor(sec)));if(found===8)api.end(true)}
        else{a.up=b.up=false;api.shake(4)}open=[];lock=false},a.v===b.v?260:700)}},
    update:function(dt){cards.forEach(function(k){var t=k.up||k.done?1:0;k.f+=(t-k.f)*Math.min(1,dt*12)})},
    draw:function(g){g.clearRect(0,0,api.W(),api.H());if(!cards)return;cards.forEach(function(k,i){var c=i%cols,r=Math.floor(i/cols),x=ox+c*(cw+10),y=oy+r*(ch+10),sx=Math.abs(Math.cos(k.f*Math.PI));
      g.save();g.translate(x+cw/2,y+ch/2);g.scale(Math.max(.02,sx),1);var face=k.f>.5;
      if(face){g.fillStyle=k.done?"rgba(255,255,255,.18)":"rgba(255,255,255,.9)";g.beginPath();g.roundRect(-cw/2,-ch/2,cw,ch,14);g.fill();g.font=(cw*.48)+"px system-ui";g.textAlign="center";g.textBaseline="middle";g.globalAlpha=k.done?.55:1;g.fillText(k.v,0,4)}
      else{var gr=g.createLinearGradient(-cw/2,-ch/2,cw/2,ch/2);gr.addColorStop(0,api.c.a);gr.addColorStop(1,api.c.b);g.fillStyle=gr;g.beginPath();g.roundRect(-cw/2,-ch/2,cw,ch,14);g.fill();g.fillStyle="rgba(255,255,255,.25)";g.beginPath();g.arc(0,0,cw*.16,0,6.283);g.fill()}
      g.restore()})}
  }}`,
  },

  tetris: {
    name: "Blocks",
    theme: "neon",
    pad: "tetris",
    about: "falling-block puzzle like Tetris: rotate pieces and clear full lines",
    controls: ["← → move · ↑ rotate · ↓ drop · Space hard drop · swipes on phone", "← → двигать · ↑ повернуть · ↓ вниз · пробел — сброс · свайпы"],
    js: `function(api){
  var COLS=10,ROWS=20,board,cur,nextP,acc,lines,cell,ox,oy,level;
  var P=[[[1,1,1,1]],[[1,1],[1,1]],[[0,1,0],[1,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]],[[1,1,0],[0,1,1]],[[0,1,1],[1,1,0]]];
  var COL=["#00e5ff","#ffd60a","#c77dff","#4895ef","#ff9f1c","#ff4d6d","#2ee59d"];
  function lay(){cell=Math.floor(Math.min((api.W()-40)/COLS,(api.H()-190)/ROWS));ox=(api.W()-cell*COLS)/2;oy=Math.max(70,(api.H()-cell*ROWS)/2-30)}
  function piece(){var i=api.rnd(7);return{m:P[i].map(function(r){return r.slice()}),c:i,x:3,y:0}}
  function hits(m,x,y){for(var r=0;r<m.length;r++)for(var c=0;c<m[r].length;c++)if(m[r][c]){var bx=x+c,by=y+r;if(bx<0||bx>=COLS||by>=ROWS||(by>=0&&board[by][bx]>=0))return true}return false}
  function rot(m){return m[0].map(function(_,i){return m.map(function(r){return r[i]}).reverse()})}
  function lock(){cur.m.forEach(function(r,ri){r.forEach(function(v,ci){if(v&&cur.y+ri>=0)board[cur.y+ri][cur.x+ci]=cur.c})});
    var cleared=0;for(var r=ROWS-1;r>=0;r--){if(board[r].every(function(v){return v>=0})){board.splice(r,1);board.unshift(new Array(COLS).fill(-1));cleared++;r++}}
    if(cleared){lines+=cleared;api.add([0,100,300,500,800][cleared]*level);api.shake(cleared*4);api.burst(api.W()/2,oy+cell*ROWS*.7,api.c.a,cleared*14);level=1+Math.floor(lines/10)}
    cur=nextP;nextP=piece();if(hits(cur.m,cur.x,cur.y)){api.shake(14);api.end()}}
  function move(dx){if(!hits(cur.m,cur.x+dx,cur.y))cur.x+=dx}
  function drop(){if(!hits(cur.m,cur.x,cur.y+1)){cur.y++;return true}lock();return false}
  return{pad:"tetris",
    reset:function(){board=[];for(var r=0;r<ROWS;r++)board.push(new Array(COLS).fill(-1));cur=piece();nextP=piece();acc=0;lines=0;level=1;lay()},resize:lay,
    key:function(k,d){if(!d)return;k=String(k).toLowerCase();if(k==="arrowleft"||k==="a")move(-1);else if(k==="arrowright"||k==="d")move(1);else if(k==="arrowdown"||k==="s"){if(drop())api.add(1)}
      else if(k==="arrowup"||k==="w"){var m=rot(cur.m);if(!hits(m,cur.x,cur.y))cur.m=m;else if(!hits(m,cur.x-1,cur.y)){cur.m=m;cur.x--}else if(!hits(m,cur.x+1,cur.y)){cur.m=m;cur.x++}}
      else if(k===" "){while(drop())api.add(2)}},
    swipe:function(s){if(s==="left")move(-1);else if(s==="right")move(1);else if(s==="down"){while(drop())api.add(2)}else this.key("ArrowUp",true)},
    tap:function(){this.key("ArrowUp",true)},
    update:function(dt){acc+=dt;var step=Math.max(.08,.8-(level-1)*.07)/api.diff;while(acc>step){acc-=step;drop()}},
    draw:function(g){g.clearRect(0,0,api.W(),api.H());if(!board)return;g.fillStyle="rgba(255,255,255,.04)";g.beginPath();g.roundRect(ox-6,oy-6,cell*COLS+12,cell*ROWS+12,12);g.fill();
      function sq(x,y,c,a){g.globalAlpha=a||1;g.fillStyle=COL[c];g.beginPath();g.roundRect(ox+x*cell+1,oy+y*cell+1,cell-2,cell-2,4);g.fill();g.globalAlpha=1}
      for(var r=0;r<ROWS;r++)for(var c=0;c<COLS;c++)if(board[r][c]>=0)sq(c,r,board[r][c]);
      var gy=cur.y;while(!hits(cur.m,cur.x,gy+1))gy++;cur.m.forEach(function(rw,ri){rw.forEach(function(v,ci){if(v){sq(cur.x+ci,gy+ri,cur.c,.18);if(cur.y+ri>=0)sq(cur.x+ci,cur.y+ri,cur.c)}})});
      g.fillStyle=api.c.muted;g.font="700 12px system-ui";g.textAlign="center";g.fillText("LV "+level+" · "+lines,api.W()/2,oy+cell*ROWS+22)}
  }}`,
  },

  pong: {
    name: "Pong",
    theme: "mono",
    pad: "lr",
    about: "pong against a computer paddle, first to 7 points",
    controls: ["Move the mouse or finger · ↑ ↓", "Двигай мышью или пальцем · ↑ ↓"],
    js: `function(api){
  var py,ay,ball,me,ai,keys={},serveT;
  function serve(dir){ball={x:api.W()/2,y:api.H()/2,vx:0,vy:0,dir:dir};serveT=.8}
  return{pad:"lr",
    reset:function(){py=ay=api.H()/2;me=0;ai=0;serve(1)},
    key:function(k,d){keys[k]=d},move:function(x,y){py=y},down:function(x,y){py=y},
    update:function(dt){var W=api.W(),H=api.H(),half=Math.min(60,H*.09);
      if(keys.ArrowUp||keys.ArrowLeft||keys.w)py-=520*dt;if(keys.ArrowDown||keys.ArrowRight||keys.s)py+=520*dt;py=Math.max(half,Math.min(H-half,py));
      if(serveT>0){serveT-=dt;if(serveT<=0){var s=Math.min(W,900)*.55*api.diff;ball.vx=s*ball.dir;ball.vy=s*(Math.random()-.5)*.8}return}
      ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;
      ay+=Math.max(-330*api.diff*dt,Math.min(330*api.diff*dt,ball.y-ay));
      if(ball.y<10){ball.y=10;ball.vy=Math.abs(ball.vy)}if(ball.y>H-10){ball.y=H-10;ball.vy=-Math.abs(ball.vy)}
      if(ball.vx<0&&ball.x<44&&ball.x>20&&Math.abs(ball.y-py)<half+8){ball.vx=Math.abs(ball.vx)*1.06;ball.vy+=(ball.y-py)*4;api.burst(40,ball.y,api.c.fg,8)}
      if(ball.vx>0&&ball.x>W-44&&ball.x<W-20&&Math.abs(ball.y-ay)<half+8){ball.vx=-Math.abs(ball.vx)*1.06;ball.vy+=(ball.y-ay)*3}
      if(ball.x<0){ai++;api.shake(8);serve(1)}else if(ball.x>W){me++;api.add(100);api.burst(W-10,ball.y,api.c.a,24);serve(-1)}
      if(me>=7)api.end(true);else if(ai>=7)api.end()},
    draw:function(g){var W=api.W(),H=api.H(),half=Math.min(60,H*.09);g.clearRect(0,0,W,H);if(!ball)return;g.fillStyle="rgba(255,255,255,.12)";
      for(var i=0;i<H;i+=26)g.fillRect(W/2-1,i,2,14);
      g.font="900 64px system-ui";g.textAlign="center";g.fillStyle="rgba(255,255,255,.18)";g.fillText(me,W*.3,130);g.fillText(ai,W*.7,130);
      g.fillStyle=api.c.fg;g.shadowBlur=14;g.shadowColor=api.c.a;g.fillRect(28,py-half,12,half*2);g.fillRect(W-40,ay-half,12,half*2);
      g.beginPath();g.arc(ball.x,ball.y,9,0,6.283);g.fill();g.shadowBlur=0}
  }}`,
  },

  runner3d: {
    name: "Neon Run 3D",
    theme: "neon",
    pad: "lr",
    about: "3D endless runner: switch between 3 lanes and jump over obstacles (three.js)",
    controls: ["← → or swipe to switch lanes · ↑ / Space or swipe up to jump", "← → или свайп — полоса · ↑ / пробел или свайп вверх — прыжок"],
    head: '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>',
    js: `function(api){
  if(typeof THREE==="undefined"){var cv=document.getElementById("c"),g2=cv.getContext("2d");return{reset:function(){},update:function(){},draw:function(){g2.fillStyle="#fff";g2.font="16px system-ui";g2.fillText("3D engine could not load. Check your connection.",20,60)}}}
  var cv=document.getElementById("c"),R=new THREE.WebGLRenderer({canvas:cv,antialias:true}),S=new THREE.Scene(),cam=new THREE.PerspectiveCamera(65,1,.1,300);
  var bg=new THREE.Color(api.c.bg);S.background=bg;S.fog=new THREE.Fog(bg,20,95);
  S.add(new THREE.HemisphereLight(0xffffff,0x222244,.9));var dl=new THREE.DirectionalLight(0xffffff,.8);dl.position.set(5,10,7);S.add(dl);
  var A=new THREE.Color(api.c.a),B=new THREE.Color(api.c.b);
  var ground=new THREE.Mesh(new THREE.PlaneGeometry(14,400),new THREE.MeshStandardMaterial({color:0x0c0c18,roughness:.9}));ground.rotation.x=-Math.PI/2;ground.position.z=-150;S.add(ground);
  var lines=[];for(var i=0;i<60;i++){var l=new THREE.Mesh(new THREE.BoxGeometry(.08,.02,2),new THREE.MeshBasicMaterial({color:i%2?A:B}));l.position.set(i%2?-1.5:1.5,.01,-i*6);S.add(l);lines.push(l)}
  var player=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:A,emissive:A,emissiveIntensity:.5}));player.position.y=.5;S.add(player);
  var obs=[],coins=[],lane,targetX,vy,speed,dist,spawn,jumping;
  function clear(){obs.concat(coins).forEach(function(o){S.remove(o)});obs=[];coins=[]}
  return{webgl:true,pad:"lr",
    reset:function(){clear();lane=0;targetX=0;vy=0;speed=18*api.diff;dist=0;spawn=0;player.position.set(0,.5,0)},
    resize:function(w,h){R.setPixelRatio(Math.min(2,window.devicePixelRatio||1));R.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix()},
    key:function(k,d){if(!d)return;if(k==="ArrowLeft"||k==="a")this.swipe("left");else if(k==="ArrowRight"||k==="d")this.swipe("right");else if(k==="ArrowUp"||k===" "||k==="w")this.swipe("up")},
    swipe:function(s){if(s==="left")lane=Math.max(-1,lane-1);else if(s==="right")lane=Math.min(1,lane+1);else if(s==="up"&&player.position.y<=.51)vy=9;targetX=lane*3},
    tap:function(x){this.swipe(x<api.W()/3?"left":x>api.W()*2/3?"right":"up")},
    update:function(dt){speed+=dt*.35;dist+=speed*dt;api.set(Math.floor(dist));
      player.position.x+=(targetX-player.position.x)*Math.min(1,dt*12);vy-=26*dt;player.position.y=Math.max(.5,player.position.y+vy*dt);if(player.position.y<=.5)vy=0;player.rotation.x-=dt*speed*.4;
      lines.forEach(function(l){l.position.z+=speed*dt;if(l.position.z>8)l.position.z-=360});
      spawn-=dt;if(spawn<=0){spawn=Math.max(.45,1.1-speed*.012);var ln=api.rnd(3)-1,o=new THREE.Mesh(new THREE.BoxGeometry(2.2,1+Math.random()*1.4,1),new THREE.MeshStandardMaterial({color:B,emissive:B,emissiveIntensity:.35}));o.position.set(ln*3,o.geometry.parameters.height/2,-90);S.add(o);obs.push(o);
        if(Math.random()<.6){var c=new THREE.Mesh(new THREE.TorusGeometry(.4,.12,8,16),new THREE.MeshStandardMaterial({color:0xffd60a,emissive:0xffd60a,emissiveIntensity:.6}));c.position.set((api.rnd(3)-1)*3,1.2,-60);S.add(c);coins.push(c)}}
      var p=player.position;for(var i=obs.length-1;i>=0;i--){var o=obs[i];o.position.z+=speed*dt;if(o.position.z>10){S.remove(o);obs.splice(i,1);continue}
        var h=o.geometry.parameters.height;if(Math.abs(o.position.z-p.z)<1&&Math.abs(o.position.x-p.x)<1.6&&p.y-.5<h-.05){api.end();return}}
      for(var j=coins.length-1;j>=0;j--){var c2=coins[j];c2.position.z+=speed*dt;c2.rotation.y+=dt*4;if(c2.position.z>10){S.remove(c2);coins.splice(j,1);continue}
        if(c2.position.distanceTo(p)<1.2){S.remove(c2);coins.splice(j,1);dist+=50}}},
    draw:function(){cam.position.set(player.position.x*.6,4.2,7);cam.lookAt(player.position.x*.4,1,-8);R.render(S,cam)}
  }}`,
  },
};

export const GAME_LIST = Object.entries(GAMES).map(([id, g]) => `${id}: ${g.about}`);

export const isGame = (template: string) => template in GAMES;

export function renderGame(cfg: GameConfig): string {
  const def = GAMES[cfg.template] ?? GAMES.snake;
  return shell(cfg, def);
}

const PICK: [RegExp, string][] = [
  [/(3d|3д|runner|раннер|бег|гонк|racing|three)/i, "runner3d"],
  [/(тетрис|tetris|блок|blocks)/i, "tetris"],
  [/(змей|snake)/i, "snake"],
  [/(арканоид|breakout|arkanoid|кирпич|brick)/i, "breakout"],
  [/(flappy|флэппи|птиц|bird)/i, "flappy"],
  [/2048/, "2048"],
  [/(пинг|понг|pong|теннис|tennis)/i, "pong"],
  [/(памят|memory|пар[ыу]|карточ|cards|match)/i, "memory"],
  [/(шутер|shooter|космо|space|стрел|invaders|звёзд|star)/i, "shooter"],
];

/** The ready-made game closest to a request: the model's example, and the fallback if its own version won't run. */
export function closestGame(request: string): string {
  return PICK.find(([rx]) => rx.test(request))?.[1] ?? "shooter";
}

/** The source of a ready-made game, shown to the model as a working example of the engine. */
export const exampleGameJs = (id: string) => (GAMES[id] ?? GAMES.shooter).js;

/** A game the model wrote itself, running inside the same tested engine. */
export function renderCustomGame(cfg: GameConfig, js: string): string {
  const needs3d = /\bTHREE\./.test(js);
  return shell(cfg, {
    name: str(cfg.title, "Game", 60),
    theme: cfg.theme ?? "neon",
    pad: cfg.pad && cfg.pad in PADS ? cfg.pad : "none",
    controls: [str(cfg.controls, "", 160), str(cfg.controls, "", 160)],
    about: "",
    head: needs3d ? GAMES.runner3d.head : undefined,
    js,
  });
}
