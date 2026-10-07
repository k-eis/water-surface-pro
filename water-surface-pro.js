// ── Water Surface PRO（k-eis DESIGN FILTER 008・WebGL）
// 波の高さマップ（正弦波の重ね合わせ）から、反射・屈折・きらめき・コースティクス・色収差・水の色を全てGPUで計算する。
const $ = (id) => document.getElementById(id);
const cv = $('outputCanvas');
const gl = cv.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
const downloadBtn = $('downloadBtn');
const DEFAULTS = { waveScale: 90, ripple: 5, waveDir: 104, waveAmp: 35, waveSpeed: 60, white: 26, whiteDir: 284, horizon: 25, bal: 74, lightDir: 293, glint: 10, caus: 60, dist: 80, chroma: 5, depth: 5, tint: 5, turbidity: 60, timeOfDay: 70, timeFlow: 0, timeInt: 55, glow: 45, haze: 30, mood: 35, vig: 25 };
const IDS = Object.keys(DEFAULTS), UNIT = { waveDir: '°', lightDir: '°', whiteDir: '°' };

// ── 時間帯の光：夜明け(0)→朝→昼(50)→夕方→夕暮れ(100)。太陽の高さ・光の色・水平線のにじみ・全体の色味と明るさを一緒に動かす
const TK = [[0, 8, [1, .78, .72], [1, .70, .62], [1.02, .95, 1.00], .95], [.25, 28, [1, .94, .84], [.95, .88, .78], [1.00, .98, .94], 1.0], [.5, 62, [1, 1, 1], [.80, .90, 1], [.98, 1.00, 1.03], 1.05], [.75, 14, [1, .72, .42], [1, .62, .30], [1.08, .94, .80], .95], [1, 3, [.95, .50, .60], [.85, .40, .55], [1.00, .84, .92], .82]];
function timeParams(t, k) {   // t:0〜1（時間帯）、k:0〜1（TIME INTENSITY＝どれだけ効かせるか）
  t = Math.min(1, Math.max(0, t)); const i = Math.min(3, Math.floor(t * 4)), f = t * 4 - i, a = TK[i], b = TK[i + 1];
  const m = (x, y) => x + (y - x) * f, v = (x, y) => x.map((q, j) => m(q, y[j])), mix = (n, x) => n + (x - n) * k;
  return { elev: mix(35, m(a[1], b[1])), light: v(a[2], b[2]).map((q) => mix(1, q)), glow: v(a[3], b[3]).map((q) => mix(.9, q)), tint: v(a[4], b[4]).map((q) => mix(1, q)), expo: mix(1, m(a[5], b[5])) };
}

// THEME
const THEME_CLASS_MAP = { shinkai: 'theme-shinkai', yugure: 'theme-yugure' };
function applyTheme(key) {
  if (!(key in THEME_CLASS_MAP)) return;
  Object.values(THEME_CLASS_MAP).forEach((c) => c && document.body.classList.remove(c));
  if (THEME_CLASS_MAP[key]) document.body.classList.add(THEME_CLASS_MAP[key]);
  document.querySelectorAll('.theme-btn').forEach((b) => b.classList.toggle('active', b.dataset.theme === key));
  try { localStorage.setItem('watersurface-theme', key); } catch (e) {}
}
document.querySelectorAll('.theme-btn').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.theme)));
applyTheme('shinkai');
try { const t = localStorage.getItem('watersurface-theme'); if (t) applyTheme(t); } catch (e) {}

// ── シェーダー
const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const FS = `precision highp float;
uniform vec2 uRes; uniform vec4 uW[11]; uniform float uT,uHmax,uHasB,uHasS,uRaw,uShow;
uniform sampler2D uB,uS;
uniform float uAmp,uHor,uLight,uDepth,uTint,uTurb,uBal,uGlint,uCaus,uDist,uChroma,uWhite,uWDir;
uniform float uElev,uExpo,uGlow,uHaze,uMood,uVig; uniform vec3 uLightC,uGlowC,uTintC;
float HY;
uniform vec3 uRip; uniform float uRipT;
vec2 P;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
vec3 hsl(float h,float s,float l){vec3 k=mod(vec3(0.,8.,4.)+h/30.,12.);float a=s*min(l,1.-l);return l-a*max(vec3(-1.),min(min(k-3.,9.-k),vec3(1.)));}
vec3 tex(sampler2D t,vec2 off,float rad,float ch){   // 6点ぼかし＋チャンネルごとのずれ（色収差）
  vec3 c=vec3(0.);
  for(int i=0;i<6;i++){float a=float(i)*1.0472;vec2 o=vec2(cos(a),sin(a))*rad;
    c.r+=texture2D(t,(P+off*(1.+ch)+o)/uRes).r; c.g+=texture2D(t,(P+off+o)/uRes).g; c.b+=texture2D(t,(P+off*(1.-ch)+o)/uRes).b;}
  return c/6.;}
vec3 post(vec3 c){   // 仕上げ：水平線の霞→光のにじみ→時間帯の色味→MOOD→VIGNETTE
  float band=exp(-abs(P.y-HY)/uRes.y*5.5);
  c=mix(c,uGlowC*.95+.05,uHaze*band*.55);
  float lum=dot(c,vec3(.3,.59,.11));
  c+=uGlowC*(uGlow*band*.22+uGlow*max(0.,lum-.72)*.55);
  c*=uTintC*uExpo;
  float sh=(1.-lum)*uMood,hi=lum*uMood;
  c=(c-.45)*(1.+.5*uMood)+.45;
  c=c*vec3(1.-.28*sh,1.-.08*sh,1.+.10*sh)+uLightC*vec3(.11,.08,.04)*hi;
  float v=clamp((length((P/uRes-.5)*2.)-.55)/.9,0.,1.);
  return max(c*(1.-uVig*.7*v*v),0.);}
void main(){
  P=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);
  float hy=uHor*uRes.y; HY=hy;
  if(uRaw>.5){gl_FragColor=vec4(uHasB>.5?texture2D(uB,P/uRes).rgb:texture2D(uS,P/uRes).rgb,1.);return;}
  if(P.y<hy){float k=P.y/max(1.,hy);vec3 sky=uHasS>.5?texture2D(uS,P/uRes).rgb:vec3(.80+.1*k,.88+.05*k,.91+.03*k);
    gl_FragColor=vec4(post(uShow>.5?vec3(.08):sky),1.);return;}
  float h=0.,lap=0.;vec2 g=vec2(0.);
  for(int i=0;i<11;i++){vec4 w=uW[i];float k=length(w.xy);float t=dot(w.xy,P)+w.w-12.*sqrt(k)*uT;
    h+=w.z*sin(t);g+=w.z*cos(t)*w.xy;lap-=w.z*k*k*sin(t);}
  vec2 d=P-uRip.xy;float r=length(d),age=uRipT-uRip.z;                  // タップ波紋
  if(age>0.&&age<4.){float x=r-age*140.;g+=d/max(r,1.)*cos(x*.35)*exp(-x*x/900.)*(1.-age/4.)*.5;}
  float sk=.4+1.2*uAmp, disp=uAmp*48.*(1.+uDepth*.8)*uDist*2.;
  if(uShow>.5){float v=.5+.5*h/uHmax*(.4+.6*uAmp)*1.6;gl_FragColor=vec4(vec3(v),1.);return;}
  float R=.02+.98*pow(max(0.,1.-(P.y-hy)/max(1.,uRes.y-hy)),2.6);
  R=clamp(R*uBal*2.,0.,1.);
  vec3 tc=hsl(215.-uTint*180.,.5,.32);
  vec3 trans=exp(-uDepth*vec3(3.2,1.2,.45));float mixT=1.-exp(-uDepth*2.2);
  float blur=uDepth*3.5+uTurb*5.;
  vec3 c=uHasB>.5?tex(uB,g*disp,blur,uChroma)*trans+tc*mixT:tc*(1.-.45*uDepth);
  float caus=pow(clamp(lap*5.,0.,1.),2.);                                 // 光の網（水面の凹み）
  c+=caus*uCaus*vec3(.8,.95,1.)*.7*(1.-uDepth*.5);
  float u=uTurb*.8;c=mix(c,tc*.55+.5,u);
  if(uHasS>.5)c=mix(c,tex(uS,g*disp+vec2(0.,2.*(hy+clamp(1.-hy/(.15*uRes.y),0.,1.)*(.5*uRes.y-hy)-P.y)),0.,uChroma),R);
  vec2 n=-g*sk;float lr=(uLight*360.-90.)*.0174533;
  vec3 H=normalize(vec3(cos(lr)*cos(uElev),sin(lr)*cos(uElev),1.+sin(uElev)));
  float dt=dot(normalize(vec3(n,1.)),H);
  c+=pow(max(dt,0.),90.)*(.35+R*.9)*uGlint*1.6*(1.-u*.5)*uLightC*clamp(1.-(uElev*57.2958-35.)/40.,.33,1.);     // きらめき
  vec2 wd=vec2(cos(uWDir),sin(uWDir)); vec2 q=vec2(dot(P,wd),dot(P,vec2(-wd.y,wd.x)))-vec2(uT*300.,0.);   // 白波：選んだ向きに伸びた泡の筋が、その向きへ流れる
  float st=vn(vec2(q.x*.016,q.y*.26))*.6+vn(vec2(q.x*.040+7.,q.y*.62))*.4;
  float thr=.84-.34*uWhite, crest=smoothstep(.04,.34,h/uHmax+.12);
  float foam=smoothstep(0.,.06,uWhite)*crest*smoothstep(thr,thr+.26,st)*(.45+.55*uAmp);
  c=mix(c,vec3(.96,.98,1.),clamp(foam,0.,1.)*.72);
  gl_FragColor=vec4(post(c),1.);}`;
function mk(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; }
const prog = gl.createProgram();
gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog); gl.useProgram(prog);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const aLoc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(aLoc); gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
const U = {}; const loc = (n) => U[n] || (U[n] = gl.getUniformLocation(prog, n));
const f1 = (n, v) => gl.uniform1f(loc(n), v);

// ── 写真（テクスチャ）
const photos = { below: null, surf: null }, tex = {};
function coverCanvas(im, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const ir = im.width / im.height, cr = w / h; let sw, sh, sx, sy;
  if (ir > cr) { sh = im.height; sw = sh * cr; sx = (im.width - sw) / 2; sy = 0; } else { sw = im.width; sh = sw / cr; sx = 0; sy = (im.height - sh) / 2; }
  g.drawImage(im, sx, sy, sw, sh, 0, 0, w, h); return c;
}
function setupTextures() {
  const ref = photos.below || photos.surf; let w = ref ? ref.width : 900, h = ref ? ref.height : 600;
  if (w > 1280) { h = Math.round(h * 1280 / w); w = 1280; }
  cv.width = w; cv.height = h; gl.viewport(0, 0, w, h);
  [['below', 0, 'uB'], ['surf', 1, 'uS']].forEach(([key, unit, name]) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    if (!tex[key]) tex[key] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex[key]);
    if (photos[key]) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, coverCanvas(photos[key], w, h));
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((p) => gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR));
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((p) => gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE));
    gl.uniform1i(loc(name), unit);
  });
}

// ── 波（SHUFFLEで種を変える）
let seed = 0, tAcc = 0, rip = [0, 0, -99];
const seeded = (i, s) => { const x = Math.sin(i * 127.1 + (s + seed * 17) * 311.7) * 43758.5453; return x - Math.floor(x); };
function waveData(p) {
  const out = [], base = (p.waveDir - 90) * Math.PI / 180, lamG = 60 + p.waveScale / 100 * 340, rp = p.ripple / 100; let hMax = 0;
  const add = (ang, lam, slope, ph) => { const k = 2 * Math.PI / lam; out.push(Math.cos(ang) * k, Math.sin(ang) * k, slope / k, ph); hMax += slope / k; };
  for (let i = 0; i < 5; i++) add(base + (seeded(i, 1) - .5) * 1.2, lamG * (.7 + seeded(i, 2) * .7), .30, seeded(i, 3) * 6.283);
  for (let i = 0; i < 6; i++) add(seeded(i, 4) * 6.283, 9 + seeded(i, 5) * 16, .22 * rp, seeded(i, 6) * 6.283);
  return { arr: new Float32Array(out), hMax: hMax || 1 };
}

let rawFlag = 0;
function render() {
  const p = {}; IDS.forEach((id) => { p[id] = +$(id).value; });
  const w = waveData(p);
  gl.uniform2f(loc('uRes'), cv.width, cv.height);
  gl.uniform4fv(loc('uW'), w.arr); f1('uHmax', w.hMax); f1('uT', tAcc);
  f1('uHasB', photos.below ? 1 : 0); f1('uHasS', photos.surf ? 1 : 0); f1('uRaw', rawFlag); f1('uShow', $('showHeight').checked ? 1 : 0);
  f1('uAmp', p.waveAmp / 100); f1('uHor', p.horizon / 100); f1('uLight', p.lightDir / 360); f1('uDepth', p.depth / 100);
  f1('uTint', p.tint / 100); f1('uTurb', p.turbidity / 100); f1('uBal', p.bal / 100); f1('uGlint', p.glint / 100);
  f1('uCaus', p.caus / 100); f1('uDist', p.dist / 100); f1('uChroma', p.chroma / 100 * .35); f1('uWhite', p.white / 100); f1('uWDir', (p.whiteDir - 90) * Math.PI / 180);
  const TP = timeParams((flow() > 0 ? tFloat : p.timeOfDay) / 100, p.timeInt / 100);
  f1('uElev', TP.elev * Math.PI / 180); f1('uExpo', TP.expo); f1('uGlow', p.glow / 100); f1('uHaze', p.haze / 100); f1('uMood', p.mood / 100); f1('uVig', p.vig / 100);
  gl.uniform3f(loc('uLightC'), ...TP.light); gl.uniform3f(loc('uGlowC'), ...TP.glow); gl.uniform3f(loc('uTintC'), ...TP.tint);
  gl.uniform3f(loc('uRip'), rip[0], rip[1], rip[2]); f1('uRipT', performance.now() / 1000);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ── 再描画ループ（動く要素がある間だけ回す）
let anim = 0, lastT = 0, cmpTimer = 0;
const speed = () => +$('waveSpeed').value;
let tFloat = 70, tDir = 1;   // TIME FLOW：時間帯が行ったり来たりしながら自動で巡る（スライダーを触れば、その位置から続く）
const flow = () => +$('timeFlow').value;
function busy() { return speed() > 0 || flow() > 0 || performance.now() / 1000 - rip[2] < 4; }
function loop(now) {
  const dt = Math.min(.05, (now - lastT) / 1000); tAcc += dt * speed() / 100; lastT = now;
  if (flow() > 0) { tFloat += tDir * dt * flow() / 100 * 5; if (tFloat > 100) { tFloat = 100; tDir = -1; } if (tFloat < 0) { tFloat = 0; tDir = 1; } $('timeOfDay').value = Math.round(tFloat); $('timeOfDayVal').textContent = Math.round(tFloat); }
  render(); anim = busy() ? requestAnimationFrame(loop) : 0;
}
function kick() { if (anim) return; lastT = performance.now(); anim = requestAnimationFrame(loop); }

IDS.forEach((id) => $(id).addEventListener('input', () => { $(id + 'Val').textContent = $(id).value + (UNIT[id] || ''); if (id === 'timeOfDay') tFloat = +$(id).value; kick(); }));
$('showHeight').addEventListener('change', kick);
$('shuffleBtn').addEventListener('click', () => { seed++; kick(); });
$('compare').addEventListener('change', (e) => {                      // 元の写真と1.5秒ごとに交互表示
  clearInterval(cmpTimer); rawFlag = 0;
  if (e.target.checked) cmpTimer = setInterval(() => { rawFlag = rawFlag ? 0 : 1; kick(); }, 1500); else kick();
});
cv.addEventListener('pointerdown', (e) => {                            // タップ波紋
  const r = cv.getBoundingClientRect();
  rip = [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height, performance.now() / 1000]; kick();
});

function wireDrop(dropId, fileId, key) {
  const drop = $(dropId), file = $(fileId);
  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => { const im = new Image(); im.onload = () => {
      photos[key] = im; drop.classList.add('filled'); drop.style.backgroundImage = `url(${ev.target.result})`;
      setupTextures(); downloadBtn.disabled = false; kick(); render();
    }; im.src = ev.target.result; };
    reader.readAsDataURL(f);
  });
}
wireDrop('dropSurf', 'fileSurf', 'surf'); wireDrop('dropBelow', 'fileBelow', 'below');

function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; }
downloadBtn.addEventListener('click', () => {
  if (!photos.below && !photos.surf) return;
  const keep = rawFlag; rawFlag = 0; render(); const dataUrl = cv.toDataURL('image/png'); rawFlag = keep;
  if (isIOS()) { $('saveOverlayImg').src = dataUrl; $('saveOverlay').style.display = 'flex'; }
  else { const a = document.createElement('a'); a.href = dataUrl; a.download = 'water-surface-pro.png'; a.click(); }
});
$('saveOverlayClose').addEventListener('click', () => { $('saveOverlay').style.display = 'none'; });

$('resetBtn').addEventListener('click', () => {
  IDS.forEach((id) => { $(id).value = DEFAULTS[id]; $(id + 'Val').textContent = DEFAULTS[id] + (UNIT[id] || ''); });
  $('showHeight').checked = false; $('compare').checked = false; clearInterval(cmpTimer); rawFlag = 0;
  photos.below = photos.surf = null; tAcc = 0; seed = 0; rip = [0, 0, -99]; tFloat = DEFAULTS.timeOfDay; tDir = 1;
  ['dropSurf', 'dropBelow'].forEach((id) => { $(id).classList.remove('filled'); $(id).style.backgroundImage = ''; });
  $('fileSurf').value = ''; $('fileBelow').value = ''; downloadBtn.disabled = true; setupTextures(); render(); kick();
});

if (!gl) document.getElementById('canvasHint').textContent = 'このブラウザはWebGLに対応していません（無料版をお使いください）';
else { setupTextures(); render(); kick(); }   // WAVE SPEED が初期値で動くので、開いた時から波が流れる
