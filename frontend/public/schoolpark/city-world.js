import * as T from './vendor/city-three.min.js';
import { isBlocked, slideMove } from './city-motion.js';
import { buildProduct, PLACEMENTS } from './city-products-3d.js';
import { createAtmosphere, PLAZA } from './city-atmosphere.js';
import { buildAvatar } from './city-avatar.js';
import { createWeather } from './city-weather.js';
import { createWish, WISH_NEAR } from './city-wish.js';

const VIEWPOINTS = {
  street:{x:7,z:11,lookX:0,lookZ:1}, entrance:{x:0,z:2.6,lookX:0,lookZ:-3,lookY:1.25},
  table:{x:1.6,z:1.5,lookX:0,lookZ:-1.7,lookY:1.12}, shelves:{x:-2.9,z:-3.3,lookX:-4.4,lookZ:-4.5},
  counter:{x:1.7,z:-2.5,lookX:3.25,lookZ:-3.75,lookY:1.48},
  // となりのお店（THE FIELD STORE）の入口。公式店舗と同じ大きさの店が、右どなりに建っている（11/21）
  neighbor:{x:13.5,z:2.6,lookX:13.5,lookZ:-3,lookY:1.25},
  // 2軒が並んでいるときの最初の眺め（公式店舗と THE FIELD STORE の両方が見える）
  streetBoth:{x:6.8,z:15.5,lookX:6.8,lookZ:0,lookY:1.6},
  // 広場（朝は噴水、昼はクリスタル、夜はやぐら）を、少し見上げる
  plaza:{x:PLAZA.x+9.5,z:PLAZA.z+5.5,lookX:PLAZA.x,lookZ:PLAZA.z,lookY:3.4},
  // あそび場（ゲームセンター）の前。ゲーム機の画面が見える高さ
  arcade:{x:-7.7,z:4.3,lookX:-12.3,lookZ:4.6,lookY:1.33},
  // 願いの泉（広場のまんなかの置物：朝は噴水・昼はクリスタル・夜はやぐらの太鼓）の前
  wish:{x:PLAZA.x+4,z:PLAZA.z+3.9,lookX:PLAZA.x,lookZ:PLAZA.z,lookY:2.8}
};
/* 11/26 オーナー：City の中に遊ぶ場所を作る（ゲームセンターのような所）。近づいたらボタンが出て遊べる。
   公式店舗の左どなり。朝・夜の屋台（x=-14）、広場、旗のロープ、植木とぶつからない所に置く。
   ゲーム機は商品と同じ仕組みで選べる（userData.productId を 'play:<id>' にする）。 */
export const ARCADE = { x: -11, z: 4 };
const ARCADE_NEAR = 3.9;

// A real perspective scene, not a panorama or an image with click areas.
// All geometry/textures are original, generated locally. No remote asset/CDN.
// time は 'morning' | 'day' | 'night'。外の世界（空・光・広場）だけが変わり、店内は同じ。
/* 11/21 オーナー：公式店舗と THE FIELD STORE を切り替えずに、1つの街に並べる（あの空間が City）。
   mainSign … 手前のお店の看板（公式店舗）。sideSign … 右どなりのお店の看板。
   sideSign があるときは、公式店舗と同じ大きさ・同じつくりの店を右どなり（x=+13.5）に建て、
   sideProducts をその店の中の台に並べる（選べる）。 */
const SIDE_X = 13.5;
export function createWorld(canvas, { products = [], sideProducts = [], mainSign = 'THE FIELD STORE', sideSign = '', time = 'day', plays = [], view: startView = 'first', onSelect = () => {}, onFocus = () => {}, onNear = () => {}, onLost = () => {} } = {}) {
  const renderer = new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.5));
  renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  const scene=new T.Scene();scene.background=new T.Color('#dce3da');scene.fog=new T.Fog('#dce3da',24,70);
  const camera=new T.PerspectiveCamera(64,1,.08,240);camera.rotation.order='YXZ';
  // 店の南の広場まで歩ける（前は x±10・z15 まで）
  const bounds={minX:-16,maxX:sideSign?20:12,minZ:-8,maxZ:24}, boxes=[], disposables=new Set();
  let yaw=0,pitch=0,drag=null,joystick={x:0,y:0,run:false},moveTarget=null,blockedFrames=0,raf=0,last=0,dead=false,paused=false,visible=true,frames=0,near=null;
  const keys=new Set(), ray=new T.Raycaster(), pointer=new T.Vector2(), abort=new AbortController();
  const options={signal:abort.signal};
  const mat=(color,more={}) => {const m=new T.MeshStandardMaterial({color,roughness:.85,...more});disposables.add(m);return m;};
  const mesh=(geometry,material,x,y,z,parent=scene) => {disposables.add(geometry);const o=new T.Mesh(geometry,material);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;};
  const block=(x,y,z,w,h,d,m,parent=scene) => mesh(new T.BoxGeometry(w,h,d),m,x,y,z,parent);
  const cylinder=(x,y,z,r1,r2,h,m,parent=scene) => mesh(new T.CylinderGeometry(r1,r2,h,24),m,x,y,z,parent);
  const obstacle=(x,z,w,d) => boxes.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});
  let seed=123456;const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
  function texture(draw,w=512,h=512) {
    const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);
    const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());disposables.add(t);return t;
  }
  const woodTexture=texture((c,w,h)=>{
    c.fillStyle='#b9956b';c.fillRect(0,0,w,h);
    for(let row=0;row<8;row++){
      c.fillStyle=`hsl(32 30% ${56+random()*12}%)`;c.fillRect(0,row*64,w,63);
      for(let i=0;i<80;i++){c.strokeStyle=`rgba(66,40,17,${random()*.1})`;c.beginPath();const y=row*64+random()*63;c.moveTo(0,y);c.bezierCurveTo(150,y-5,300,y+5,w,y);c.stroke();}
      c.fillStyle='#8c7557';c.fillRect(row%2?120:340,row*64,1,63);
    }
  });woodTexture.wrapS=woodTexture.wrapT=T.RepeatWrapping;woodTexture.repeat.set(2,2);
  const stoneTexture=texture((c,w,h)=>{c.fillStyle='#b9b9ab';c.fillRect(0,0,w,h);for(let y=0;y<4;y++)for(let x=0;x<4;x++){
    c.fillStyle=`hsl(55 8% ${69+random()*8}%)`;c.fillRect(x*128+2,y*128+2,124,124);
    for(let n=0;n<120;n++){c.fillStyle=`rgba(58,61,44,${random()*.08})`;c.fillRect(x*128+random()*124,y*128+random()*124,2,2);}
  }});stoneTexture.wrapS=stoneTexture.wrapT=T.RepeatWrapping;stoneTexture.repeat.set(6,6);
  const wood=mat('#e7ccb0',{map:woodTexture}), oak=mat('#91704f'), darkWood=mat('#5c4938'), plaster=mat('#eee7d7');
  const green=mat('#244936'), brass=mat('#ad8b4e',{metalness:.55,roughness:.38}), black=mat('#363b32');
  const paving=mat('#e3dfcf',{map:stoneTexture}), linen=mat('#e2d7ba'), soil=mat('#433a2a');
  const glass=mat('#c9ddcd',{transparent:true,opacity:.15,roughness:.15,metalness:.2});
  const glow=mat('#ffe8b7',{emissive:'#ffd89a',emissiveIntensity:.7});
  const hemi=new T.HemisphereLight('#edf5e6','#847057',2.25);scene.add(hemi);
  const sun=new T.DirectionalLight('#fff0cd',3.7);sun.position.set(-8,13,10);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-13,right:13,top:13,bottom:-13,near:1,far:40});
  sun.shadow.bias=-.0006;sun.shadow.normalBias=.025;scene.add(sun);sun.target.position.set(0,0,-2);scene.add(sun.target);
  const fill=new T.PointLight('#ffdaaa',15,15,2);fill.position.set(0,3,-3);scene.add(fill);
  block(0,-.13,3,48,.2,48,paving);
  block(0,-.015,-2,10,.15,12,wood);
  // One invisible navigation surface sits just above the visible floors. The
  // first opaque ray hit must be this surface, so walls, furniture and objects
  // never become click-to-move destinations.
  const walkMaterial=new T.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false});walkMaterial.visible=false; // 描かない（当たり判定には残る）。透明な床を1枚塗る分だけ軽くなる。
  disposables.add(walkMaterial);
  const walkSurface=mesh(new T.PlaneGeometry(36,32),walkMaterial,2,.075,8);walkSurface.rotation.x=-Math.PI/2;walkSurface.userData.walkable=true;walkSurface.castShadow=false;walkSurface.receiveShadow=false;
  const markerMaterial=new T.MeshBasicMaterial({color:'#f7efd9',transparent:true,opacity:.82,depthWrite:false,side:T.DoubleSide});disposables.add(markerMaterial);
  const moveMarker=mesh(new T.TorusGeometry(.22,.025,8,32),markerMaterial,0,.085,0);moveMarker.rotation.x=-Math.PI/2;moveMarker.visible=false;moveMarker.castShadow=false;moveMarker.receiveShadow=false;moveMarker.userData.navigationMarker=true;
  let markerPulseUntil=0;
  // ここから下が「お店1軒」（建物と店の中）。右どなりの THE FIELD STORE は、これをそのまま写して建てる
  const storeFrom=scene.children.length, storeBoxesFrom=boxes.length;
  // Store envelope, wide doorway and large windows. Collision boxes match walls.
  block(0,1.9,-8.15,10.4,3.8,.3,plaster);obstacle(0,-8.15,10.4,.3);
  block(5.15,1.9,-2,.3,3.8,12.3,plaster);obstacle(5.15,-2,.3,12.3);
  block(-5.15,.45,-2,.3,.9,12.3,plaster);obstacle(-5.15,-2,.3,12.3);
  block(-5.15,3.45,-2,.3,.7,12.3,plaster);
  for(const z of [-7.8,-4,-.2,3.8])block(-5.12,2,z,.18,2.4,.15,darkWood);
  for(const y of [1,3.12])block(-5.12,y,-2,.16,.13,12,darkWood);
  block(-5.12,2.06,-2,.06,2.04,11.8,glass);
  for(const x of [-3.1,3.1]){block(x,.45,4.1,3.8,.9,.25,plaster);obstacle(x,4.1,3.8,.3);block(x,2.03,4.1,3.7,2.25,.07,glass);}
  for(const x of [-5.1,-1.2,1.2,5.1]){block(x,1.9,4.1,.16,3.8,.2,darkWood);if(Math.abs(x)<2)obstacle(x,4.1,.16,.2);}
  block(0,3.5,4.12,10.5,.8,.35,green);
  block(0,3.94,-2,10.7,.2,12.8,plaster);
  for(let z=-7.5;z<4;z+=2)block(0,3.7,z,10.4,.24,.15,oak);
  block(0,.025,4.75,2.45,.06,1.2,green);
  function label(value,x,y,z,w,h,bg='#244936',fg='#f6f0df',size=46,rotation=0,parent=scene) {
    const map=texture((c,cw,ch)=>{c.fillStyle=bg;c.fillRect(0,0,cw,ch);c.fillStyle=fg;c.textAlign='center';c.textBaseline='middle';c.font=`500 ${size}px Georgia, serif`;c.fillText(value,cw/2,ch/2,cw-40);},1024,256);
    const material=new T.MeshBasicMaterial({map,side:T.DoubleSide});disposables.add(material);
    const o=mesh(new T.PlaneGeometry(w,h),material,x,y,z,parent);o.rotation.y=rotation;o.castShadow=false;return o;
  }
  const mainSignMesh=label(mainSign,0,3.5,4.32,6,.5,undefined,undefined,68);
  label('LEARN  /  MAKE  /  TAKE HOME',0,2.82,-7.97,5.2,.7,'#eee7d7','#244936',38);
  label('SCHOOLPARK CITY',0,2.18,-7.96,3.3,.45,'#eee7d7','#91704f',35);
  // Shelves, books, sideboard, a central display and a coffee counter.
  function shelving(x,z,w,rotation=0) {
    const g=new T.Group();g.position.set(x,0,z);g.rotation.y=rotation;scene.add(g);
    block(0,1.25,0,w,2.5,.13,oak,g);
    for(const y of [.23,.89,1.55,2.21,2.56])block(0,y,.2,w+.12,.07,.65,darkWood,g);
    for(const xx of [-w/2,w/2])block(xx,1.4,.2,.1,2.4,.6,darkWood,g);
    return g;
  }
  const shelf=shelving(-4.76,-4.55,4.8,Math.PI/2);obstacle(-4.56,-4.55,.75,4.9);
  const backShelf=shelving(2.55,-7.7,3.9);obstacle(2.55,-7.45,4,.7);
  const bookColors=['#637765','#ab8059','#ded2af','#855f4a'];
  bookColors.forEach((color,colorIndex)=>{
    const geometry=new T.BoxGeometry(.1,.44,.28);disposables.add(geometry);
    const im=new T.InstancedMesh(geometry,mat(color),24), dummy=new T.Object3D();im.castShadow=true;im.receiveShadow=true;
    for(let i=0;i<24;i++){dummy.position.set(-2.13+(i%12)*.36+colorIndex*.082,.49+Math.floor(i/12)*.67,.29);dummy.scale.set(.8, .72+random()*.35,1);dummy.rotation.z=(random()-.5)*.12;dummy.updateMatrix();im.setMatrixAt(i,dummy.matrix);}
    shelf.add(im);
  });
  // 目の高さの段（1.55）は公式ショップの商品を置くので、びんは下の2段だけ
  for(let y=0;y<2;y++)for(let i=0;i<8;i++){
    const xx=-1.55+i*.44;cylinder(xx,.48+y*.66,.23,.08,.09,.36,green,backShelf);
    cylinder(xx,.72+y*.66,.23,.035,.035,.13,brass,backShelf);
  }
  block(0,.83,-1.55,2.5,.13,1.7,wood);block(0,.73,-1.55,2.22,.15,1.48,oak);obstacle(0,-1.55,2.5,1.7);
  for(const x of [-1,1])for(const z of [-2.18,-.92])block(x,.36,z,.13,.7,.13,darkWood);
  block(3.6,.6,-4.7,2.4,1.2,2.7,green);block(3.6,1.24,-4.7,2.55,.1,2.85,wood);obstacle(3.6,-4.7,2.55,2.85);
  for(let x=2.5;x<4.7;x+=.18)block(x,.58,-3.32,.025,1.12,.035,brass);
  block(3.6,1.63,-5.3,.92,.68,.48,black);block(3.6,1.65,-5.04,.8,.38,.045,brass);
  cylinder(3.6,1.95,-5.3,.22,.22,.08,black);
  label('COFFEE & CURIOSITY',3.6,.73,-3.29,1.8,.4,'#244936','#e4d8b8',34);
  block(-2.7,.07,1,1.45,.03,2.3,linen);cylinder(-3.4,.48,1.1,.55,.55,.12,wood);obstacle(-3.4,1.1,1.1,1.1);
  cylinder(-3.4,.22,1.1,.05,.17,.48,black);
  for(const z of [-.1,2.3]){cylinder(-3.4,.43,z,.3,.3,.1,oak);for(const x of [-3.58,-3.22])block(x,.2,z,.045,.42,.045,black);}
  // Pendant lamps. Static shadows do not need to be recalculated as you walk.
  for(const [x,z] of [[0,-1.5],[3.6,-4.6],[-3.4,1.1]]){
    cylinder(x,3.4,z,.018,.018,.8,black);cylinder(x,2.98,z,.12,.3,.3,brass);cylinder(x,2.82,z,.25,.25,.018,glow);
  }
  if(sideSign){
    /* 右どなりの THE FIELD STORE。公式店舗の建物と店の中を写し、看板だけ替える。形と材質は共有するので軽い */
    const twin=new T.Group();twin.position.x=SIDE_X;
    scene.children.slice(storeFrom).filter(o=>o!==mainSignMesh).forEach(o=>twin.add(o.clone()));
    scene.add(twin);
    boxes.slice(storeBoxesFrom).forEach(b=>boxes.push({minX:b.minX+SIDE_X,maxX:b.maxX+SIDE_X,minZ:b.minZ,maxZ:b.maxZ}));
    block(SIDE_X,-.015,-2,10,.15,12,wood);
    label(sideSign,SIDE_X,3.5,4.32,6,.5,undefined,undefined,68);
    const sideFill=new T.PointLight('#ffdaaa',15,15,2);sideFill.position.set(SIDE_X,3,-3);scene.add(sideFill);
  }
  function plant(x,z,scale=1) {
    const g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(scale);scene.add(g);
    cylinder(0,.3,0,.31,.23,.58,mat('#b89a77'),g);cylinder(0,.6,0,.28,.28,.025,soil,g);
    const leafMaterial=mat('#48634a');
    for(let i=0;i<9;i++){
      const a=i*2.399,y=.9+random()*.7;const leaf=mesh(new T.SphereGeometry(.25,8,6),leafMaterial,Math.cos(a)*.28,y,Math.sin(a)*.28,g);
      leaf.scale.set(.55,1.5,.8);leaf.rotation.z=Math.cos(a)*.6;
      const stem=cylinder(Math.cos(a)*.12,y/2+.25,Math.sin(a)*.12,.012,.012,y-.5,darkWood,g);stem.rotation.z=-Math.cos(a)*.15;
    }
    obstacle(x,z,.6*scale,.6*scale);
  }
  plant(-4.1,3.15);plant(4.25,3.1);plant(-6.6,5.1,1.5);plant(6.5,5.2,1.4);plant(-6.6,-1.3,1.4);
  for(let i=0;i<5;i++){plant(-7.4,-6+i*2.2,.8);}
  // Outdoor bench, next partner's facade and wayfinding make the entry spatial.
  block(7.9,.43,7.5,2.7,.14,.65,wood);for(const x of [6.9,8.9])block(x,.21,7.5,.16,.42,.5,black);obstacle(7.9,7.5,2.7,.65);
  /* となりのお店があるときは、そこに THE FIELD STORE が建つので、出店準備中の小さな建物は置かない */
  if(!sideSign){
    block(8,1.7,-1,4,3.4,8,plaster);obstacle(8,-1,4,8);
    block(8,2.8,3.1,3.8,.55,.15,green);label('YOUR LOCAL STORE',8,2.81,3.19,3.3,.4,undefined,undefined,47);
    label('PARTNER 01 / 02',8,1.65,3.12,2.8,.7,'#eee7d7','#244936',42);
    label('COMING TO THE CITY',8,1.02,3.12,2.8,.4,'#eee7d7','#91704f',34);
  }
  block(-2.15,.8,5.7,.95,1.6,.13,green);obstacle(-2.15,5.7,.95,.16);
  label('STEP INSIDE',-2.15,1.08,5.78,.88,.35,undefined,undefined,62);
  label('3D SHOWROOM',-2.15,.64,5.78,.85,.3,undefined,undefined,41);
  /* あそび場（ゲームセンター）。前（+x の向き）が開いていて、奥の壁ぎわにゲーム機が4台並ぶ。
     遊べるゲーム（plays）が渡されたときだけ建てる（お試し表示では建てない） */
  if(plays.length){
    const ax=ARCADE.x, az=ARCADE.z, wall=mat('#3b3350'), floor=mat('#2f2a3a'), trim=mat('#f2b84b',{emissive:'#f2b84b',emissiveIntensity:.35});
    const colors=['#5b8fd0','#e8695a','#8a4fc8','#2fa58a'];
    block(ax,0,az,4.2,.12,5.8,floor);
    block(ax-1.95,1.7,az,.2,3.4,5.6,wall);obstacle(ax-1.95,az,.2,5.6);
    for(const side of [-1,1]){block(ax,1.7,az+side*2.8,4,3.4,.2,wall);obstacle(ax,az+side*2.8,4,.2);}
    block(ax,3.48,az,4.3,.16,6,wall);
    block(ax+2.05,3.12,az,.12,.56,5.9,trim);
    label('GAME CENTER',ax+2.13,3.12,az,4.6,.48,'#2a2140','#ffd36a',70,Math.PI/2);
    label('あそび場 · 近づくと遊べます',ax+2.13,2.66,az,3.4,.3,'#2a2140','#f6f0e2',44,Math.PI/2);
    const arcadeLight=new T.PointLight('#c9a6ff',9,9,2);arcadeLight.position.set(ax,2.7,az);scene.add(arcadeLight);
    plays.slice(0,4).forEach(([id,title],i)=>{
      // 前から見て左から ECHO FIELD・林檎の方程式・日常の神々・エレベーター
      const z=az+1.8-i*1.2, g=new T.Group();g.position.set(ax-1.25,0,z);g.userData.productId='play:'+id;scene.add(g);
      const body=mat(colors[i%colors.length]);
      block(0,.75,0,.8,1.5,.95,body,g);block(.02,1.72,0,.76,.44,.95,body,g);
      block(.47,.98,0,.32,.08,.9,mat('#1f1f28'),g);
      for(const [bz,c] of [[-.2,'#ff5a5a'],[0,'#ffd36a'],[.2,'#5fd0ff']])cylinder(.5,1.04,bz,.045,.045,.05,mat(c,{emissive:c,emissiveIntensity:.4}),g);
      label(title,.41,1.33,0,.88,.6,'#0e1630','#9ef0ff',58,Math.PI/2,g);
      label('PLAY',.41,1.75,0,.9,.3,colors[i%colors.length],'#ffffff',60,Math.PI/2,g);
      obstacle(ax-1.25,z,.85,.95);
    });
  }
  // Products are selectable meshes; each has its own visible physical model.
  /* 公式ショップの11品は、Claude デザインの模型（city-products-3d.js）を決まった場所に置く。
     値段はサーバーの値（EMUER）を出す。ほかの店の商品は、これまでどおり4つの台に置く。 */
  const helpers={mat,texture,label,image(file){
    const t=new T.TextureLoader().load('/schoolpark/shop/official/'+String(file).replace(/[^\w.-]/g,''));t.colorSpace=T.SRGBColorSpace;disposables.add(t);return t;
  }};
  const placed=new Map();
  for(const product of products){
    const at=PLACEMENTS[product.id];if(!at)continue;
    const price=product.prices?.EMUER??undefined;
    const g=buildProduct(T,{id:product.id,name:product.name,...(price!=null?{price}:{})},helpers);
    g.position.set(at[0],at[1],at[2]);g.rotation.y=at[3];g.userData.productId=product.id;scene.add(g);
    placed.set(product.id,[...at,middleHeight(g)]);
  }
  /* 模型の高さの真ん中。正面から見たとき、画面の真ん中がちょうど模型に当たるようにする
     （アクリルキーホルダーのように、台より上が本体のものがある）。 */
  function middleHeight(g){
    g.updateMatrixWorld(true);let lo=Infinity,hi=-Infinity;const v=new T.Vector3();
    g.traverse(o=>{if(!o.isMesh||o.parent?.name==='price-tag')return;const b=(o.geometry.boundingBox||(o.geometry.computeBoundingBox(),o.geometry.boundingBox));
      for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){v.set(x,y,z).applyMatrix4(o.matrixWorld);lo=Math.min(lo,v.y);hi=Math.max(hi,v.y);}});
    return Number.isFinite(lo)?(lo+hi)/2:g.position.y+.12;
  }
  /* 公式の品が無いときは、店の中の4つの台に置く。となりのお店の品は、となりの店の中の同じ4つの台に置く */
  const inside=[[-.68,.94,-1.45],[.68,.94,-1.43],[.42,.94,-2.05],[3.25,1.31,-3.75]];
  const outside=inside.map(([x,y,z])=>[x+SIDE_X,y,z]);
  const generic=[];const positions=[];const seats=[];   // seats[i] … [何番目の台, 右へずらした分]
  (placed.size?[]:products).slice(0,4).forEach((p,i)=>{generic.push(p);positions.push(inside[i]);seats.push([i,0]);});
  (sideSign?sideProducts:[]).slice(0,4).forEach((p,i)=>{generic.push(p);positions.push(outside[i]);seats.push([i,SIDE_X]);});
  generic.forEach((product,i)=>{
    const [x,y,z]=positions[i], g=new T.Group();g.position.set(x,y,z);g.userData.productId=product.id;scene.add(g);
    const color=mat(product.color), cream=mat('#eee3ca');
    if(product.kind==='mug'){
      cylinder(0,.16,0,.15,.125,.3,color,g);cylinder(0,.317,0,.122,.122,.007,mat('#4f392b'),g);
      const handle=mesh(new T.TorusGeometry(.105,.028,8,20),color,.16,.17,0,g);handle.rotation.y=Math.PI/2;
    }else if(product.kind==='tote'){
      block(0,.23,0,.5,.46,.17,cream,g);
      for(const zz of [-.06,.06])mesh(new T.TorusGeometry(.145,.018,6,22,Math.PI),color,0,.46,zz,g);
      label('FIELD',0,.23,.09,.32,.2,'#e2d7ba','#355a48',90,0,g);
    }else if(product.kind==='coffee'){
      cylinder(0,.22,0,.145,.145,.42,color,g);cylinder(0,.445,0,.155,.155,.04,oak,g);
      label('FIELD',0,.23,.147,.23,.19,'#eee3ca','#355a48',90,0,g);
    }else{
      block(0,.045,0,.42,.07,.57,color,g);block(0,.083,.005,.38,.012,.54,cream,g);
      const cover=block(0,.102,0,.42,.026,.57,color,g);cover.rotation.z=-.03;
      const mark=label('FIELD NOTES',0,.121,0,.32,.23,'#b3794f','#f4ecda',58,0,g);mark.rotation.x=-Math.PI/2;
    }
    const tag=label(String(product.priceJPY ? '¥ '+product.priceJPY.toLocaleString('ja-JP') : product.name),0,.012,.37,.43,.12,'#f4efdf','#244936',65,0,g);tag.rotation.x=-Math.PI*.32;
  });
  // 外の世界。時間帯で変わる（city-atmosphere.js）。失敗しても、店はこれまでどおり見られる。
  let atmosphere=null;
  try{atmosphere=createAtmosphere(T,{scene,camera,renderer,lights:{hemi,sun,fill},texture,label,obstacle,disposables},time);canvas.dataset.time=atmosphere.mode;}
  catch(error){console.warn('City atmosphere unavailable',error);}
  /* 11/28 オーナー：「アバターの追加」「リアルタイム天気の同期と、カスタム天候の追加」「没入感のある世界観に」。
     camera は「自分の目」（歩く・ぶつかる・位置の記録はこれまでどおりこれで決める）。
     アバター視点では、うしろ斜め上のカメラ（viewCam）から自分（冷蔵庫くん）を映す。画面の真ん中は、目の先にある物に合わせる。 */
  const viewCam=new T.PerspectiveCamera(60,1,.08,240);
  let viewMode=startView==='third'?'third':'first',snapView=true,cameraReach=1,pace='stop',aimDistance=6,aimFrame=0,bob=0,runBlend=0;
  const avatar=buildAvatar(T,{disposables});scene.add(avatar.group);avatar.show(viewMode==='third');
  const roofs=[{minX:-5.3,maxX:5.3,minZ:-8.3,maxZ:4.3}];
  if(sideSign)roofs.push({minX:-5.3+SIDE_X,maxX:5.3+SIDE_X,minZ:-8.3,maxZ:4.3});
  if(plays.length)roofs.push({minX:ARCADE.x-2.1,maxX:ARCADE.x+2.1,minZ:ARCADE.z-2.9,maxZ:ARCADE.z+2.9});
  const floorAt=(x,z)=>roofs.some(r=>x>r.minX&&x<r.maxX&&z>r.minZ&&z<r.maxZ)?.06:-.03;
  let weather=null;
  try{weather=createWeather(T,{scene,lights:{hemi,sun,fill},disposables,mode:atmosphere?.mode||time,roofs});canvas.dataset.weather=weather.kind;}
  catch(error){console.warn('City weather unavailable',error);}
  const activeCam=()=>viewMode==='third'?viewCam:camera;
  /* 11/28：願いの泉。広場のまんなかの置物（時間帯で変わる）に近づくと、願いを書ける（city-wish.js） */
  let wish=null,cinema=null;
  if(atmosphere){try{wish=createWish(T,{scene,disposables,texture,at:PLAZA,mode:atmosphere.mode,viewCamera:activeCam});}catch(error){console.warn('City wish unavailable',error);}}
  const forward=new T.Vector3(),rightward=new T.Vector3(),pivot=new T.Vector3(),wanted=new T.Vector3(),aimPoint=new T.Vector3();
  function measureAim(){
    // 目の先に何があるか（画面の真ん中をそこに合わせる）
    ray.set(camera.position,forward);ray.far=30;
    const hits=ray.intersectObjects(scene.children,true);ray.far=Infinity;
    let d=20;for(const hit of hits){if(hit.object.material?.transparent&&hit.object.material.opacity<.3&&!hit.object.userData.walkable)continue;if(hit.object.userData.navigationMarker)continue;d=hit.distance;break;}
    return Math.max(.9,Math.min(25,d));
  }
  function placeViewCam(dt){
    forward.set(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
    rightward.set(Math.cos(yaw),0,-Math.sin(yaw));
    if(viewMode!=='third')return;
    if(snapView||++aimFrame%3===0){const d=measureAim();aimDistance=snapView?d:aimDistance+(d-aimDistance)*.35;}
    pivot.set(camera.position.x,1.5,camera.position.z);
    // 縦長の画面（スマホ）は横が狭いので、少しうしろから映す
    const back=(viewCam.aspect<.8?3.4:2.8)+runBlend*.45;
    wanted.copy(pivot).addScaledVector(forward,-back).addScaledVector(rightward,viewCam.aspect<.8?.3:.42);wanted.y+=.45;
    // 壁・棚の向こうへカメラが入らないよう、手前で止める（低い台の上は越えてよい）
    if(snapView||aimFrame%2===0){
      const length=pivot.distanceTo(wanted);aimPoint.subVectors(wanted,pivot).normalize();
      ray.set(pivot,aimPoint);ray.far=length+.3;const hits=ray.intersectObjects(scene.children,true);ray.far=Infinity;
      let reach=1;for(const hit of hits){if(hit.object.userData.walkable||hit.object.userData.navigationMarker)continue;if(hit.object.material?.transparent&&hit.object.material.opacity<.3)continue;reach=Math.max(0,(hit.distance-.3)/length);break;}
      cameraReach=snapView?reach:Math.min(reach,cameraReach+.08);
    }
    wanted.lerpVectors(pivot,wanted,cameraReach);
    wanted.y=Math.max(.35,wanted.y);if(roofs.some(r=>wanted.x>r.minX&&wanted.x<r.maxX&&wanted.z>r.minZ&&wanted.z<r.maxZ))wanted.y=Math.min(3.35,wanted.y);
    if(snapView)viewCam.position.copy(wanted);else viewCam.position.lerp(wanted,Math.min(1,dt*14));
    aimPoint.copy(camera.position).addScaledVector(forward,aimDistance);viewCam.lookAt(aimPoint);
    // カメラが自分のすぐうしろまで寄ったら（せまい所）、アバターは消して目の高さから見る
    avatar.group.visible=avatar.visible&&viewCam.position.distanceTo(pivot)>.9;
    snapView=false;
  }
  function resize(){const r=canvas.getBoundingClientRect();if(r.width<1||r.height<1)return;renderer.setSize(r.width,r.height,false);camera.aspect=viewCam.aspect=r.width/r.height;camera.updateProjectionMatrix();viewCam.updateProjectionMatrix();}
  function look(){camera.rotation.set(pitch,yaw,0,'YXZ');}
  function publishPose(){canvas.dataset.position=JSON.stringify({x:+camera.position.x.toFixed(3),z:+camera.position.z.toFixed(3),yaw:+yaw.toFixed(3)});}
  function cancelWalk(state='idle'){moveTarget=null;blockedFrames=0;canvas.dataset.navigation=state;delete canvas.dataset.navigationTarget;publishPose();}
  function view(v){camera.position.set(v.x,1.68,v.z);yaw=Math.atan2(v.x-v.lookX,v.z-v.lookZ);pitch=Math.atan2((v.lookY??1.68)-1.68,Math.hypot(v.x-v.lookX,v.z-v.lookZ));look();keys.clear();joystick={x:0,y:0,run:false};cancelWalk();moveMarker.visible=false;snapView=true;avatar?.face(yaw);}
  function waypoint(name){const v=VIEWPOINTS[name];if(v)view(v);}
  function focusProduct(id){
    // 公式ショップの品は、その正面（模型の +z の向き）1.3m から見る
    const at=placed.get(id);
    if(at){const [x,,z,r,mid]=at;view({x:x+Math.sin(r)*1.3,z:z+Math.cos(r)*1.3,lookX:x,lookZ:z,lookY:mid});return;}
    const i=generic.findIndex(p=>p.id===id);if(i<0)return;const [x,y,z]=positions[i];
    const [k,off]=seats[i];   // となりの店の品は、同じ見方を右へずらす
    const from=[[-2,.4],[2,.5],[2,-2.8],[1.6,-2.3]][k];view({x:from[0]+off,z:from[1],lookX:x,lookZ:z,lookY:y+.18});}
  function productAt(x,y){
    pointer.set(x,y);ray.setFromCamera(pointer,activeCam());
    const hits=ray.intersectObjects(scene.children,true);
    for(const hit of hits){
      // Ignore the nearly-transparent windows, but never select through walls.
      if(hit.object.material?.transparent && hit.object.material.opacity<.3)continue;
      let o=hit.object;while(o&&!o.userData.productId)o=o.parent;
      // 近さは「自分の目」から測る（アバター視点でも、手の届く所の物だけ選べる）
      const near=viewMode==='third'?hit.point.distanceTo(camera.position)<5:hit.distance<5;
      return o?.userData.productId && near ? o.userData.productId : null;
    }
    return null;
  }
  function walkPointAt(x,y) {
    pointer.set(x,y);ray.setFromCamera(pointer,activeCam());
    const hits=ray.intersectObjects(scene.children,true);
    for(const hit of hits){
      if(hit.object.userData.navigationMarker)continue;
      if(hit.object.material?.transparent && hit.object.material.opacity<.3 && !hit.object.userData.walkable)continue;
      if(!hit.object.userData.walkable)return null;
      const point={x:hit.point.x,z:hit.point.z};
      const dx=point.x-camera.position.x,dz=point.z-camera.position.z,distance=Math.hypot(dx,dz),steps=Math.max(1,Math.ceil(distance/.12));
      let reachable={x:camera.position.x,z:camera.position.z};
      for(let step=1;step<=steps;step++){
        const candidate={x:camera.position.x+dx*step/steps,z:camera.position.z+dz*step/steps};
        if(isBlocked(candidate,boxes,bounds))break;reachable=candidate;
      }
      return Math.hypot(reachable.x-camera.position.x,reachable.z-camera.position.z)>.12 ? reachable : null;
    }
    return null;
  }
  function showMarker(point,pulse=false){
    if(!point){if(!moveTarget)moveMarker.visible=false;return;}
    moveMarker.position.set(point.x,.085,point.z);moveMarker.visible=true;moveMarker.scale.setScalar(1);markerMaterial.opacity=.82;
    if(pulse)markerPulseUntil=performance.now()+520;
  }
  function beginWalk(point){
    if(!point)return;const distance=Math.hypot(point.x-camera.position.x,point.z-camera.position.z);showMarker(point,true);
    if(distance<.12){cancelWalk();return;}
    moveTarget={x:point.x,z:point.z,lastDistance:distance};blockedFrames=0;
    canvas.dataset.navigation='moving';canvas.dataset.navigationTarget=JSON.stringify({x:+point.x.toFixed(3),z:+point.z.toFixed(3)});
  }
  function hoverAt(e){
    if(e.pointerType!=='mouse'||drag||paused)return;
    const p=point(e),product=productAt(p.x,p.y),target=product?null:walkPointAt(p.x,p.y);
    canvas.style.cursor=product||target?'pointer':'grab';showMarker(target);
  }
  function selectCenter(){const id=productAt(0,0);if(id)onSelect(id);}
  function point(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width*2-1,y:1-(e.clientY-r.top)/r.height*2};}
  canvas.addEventListener('pointerdown',e=>{
    if(paused||e.button!==0)return;canvas.focus({preventScroll:true});try{canvas.setPointerCapture(e.pointerId);}catch{}
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,moved:0,started:performance.now()};canvas.style.cursor='grabbing';
  },options);
  canvas.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId||paused){hoverAt(e);return;}
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved+=Math.hypot(dx,dy);drag.x=e.clientX;drag.y=e.clientY;
    yaw-=dx*.004;pitch=Math.max(-1.1,Math.min(.9,pitch-dy*.0035));look();
  },options);
  canvas.addEventListener('pointerup',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const tapped=drag.moved<9&&performance.now()-drag.started<650;drag=null;canvas.style.cursor='grab';
    if(tapped&&!paused){const p=point(e),id=productAt(p.x,p.y);if(id)onSelect(id);else beginWalk(walkPointAt(p.x,p.y));}
    else hoverAt(e);
  },options);
  canvas.addEventListener('pointercancel',()=>{drag=null;canvas.style.cursor='grab';},options);
  canvas.addEventListener('pointerleave',()=>{if(!drag&&!moveTarget)moveMarker.visible=false;},options);
  const supported=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyE','ShiftLeft','ShiftRight']);
  canvas.addEventListener('keydown',e=>{if(paused||!supported.has(e.code))return;e.preventDefault();keys.add(e.code);if(e.code==='KeyE'&&!e.repeat)selectCenter();},options);
  window.addEventListener('keyup',e=>keys.delete(e.code),options);
  function release(){keys.clear();drag=null;joystick={x:0,y:0,run:false};canvas.style.cursor='grab';}
  canvas.addEventListener('blur',release,options);window.addEventListener('blur',release,options);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();release();cancelAnimationFrame(raf);raf=0;onLost();},options);
  function loop(ms){
    raf=0;if(dead||!visible||document.hidden)return;
    const dt=Math.min((ms-last)/1000||0,.04);last=ms;
    if(!paused){
      if(keys.has('ArrowLeft'))yaw+=dt*1.7;if(keys.has('ArrowRight'))yaw-=dt*1.7;
      let forward=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-joystick.y;
      let side=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+joystick.x;
      const length=Math.max(1,Math.hypot(forward,side));forward/=length;side/=length;
      if(forward||side){cancelWalk('manual');moveMarker.visible=false;}
      /* 走る：スティックを外側まで倒す／Shift を押しながら。歩く速さの2倍 */
      const running=!!(joystick.run||keys.has('ShiftLeft')||keys.has('ShiftRight'));
      const stride=2.7*(running?2:1);
      // アバター視点では、スティックを横へ倒すと、カメラもゆっくりそちらへ回る（片手で曲がれる）
      if(viewMode==='third'&&joystick.x&&!drag)yaw-=joystick.x*dt*1.15;
      let dx=(-Math.sin(yaw)*forward+Math.cos(yaw)*side)*dt*stride;
      let dz=(-Math.cos(yaw)*forward-Math.sin(yaw)*side)*dt*stride;
      if(moveTarget&&!drag){
        const tx=moveTarget.x-camera.position.x,tz=moveTarget.z-camera.position.z,distance=Math.hypot(tx,tz);
        if(distance<.07){cancelWalk();moveMarker.visible=false;}
        else{
          const speed=Math.min(4,Math.max(1.25,distance*2.4)),step=Math.min(distance,speed*dt);
          dx=tx/distance*step;dz=tz/distance*step;
          const desired=Math.atan2(-dx,-dz),turn=Math.atan2(Math.sin(desired-yaw),Math.cos(desired-yaw));
          yaw+=turn*Math.min(1,dt*7);pitch+=(0-pitch)*Math.min(1,dt*4);
        }
      }
      const fromX=camera.position.x,fromZ=camera.position.z;
      if(dx||dz){const p=slideMove(camera.position,dx,dz,boxes,bounds);camera.position.x=p.x;camera.position.z=p.z;}
      const movedX=camera.position.x-fromX,movedZ=camera.position.z-fromZ,speedNow=dt>0?Math.hypot(movedX,movedZ)/dt:0;
      runBlend+=((running&&speedNow>3?1:0)-runBlend)*Math.min(1,dt*5);pace=speedNow>.2?(running?'run':'walk'):'stop';
      // 一人称：歩くと少しだけ目線がゆれる。走ると視野が少し広がる
      if(viewMode==='first'){bob+=speedNow*dt*2.3;camera.position.y+=((1.68+(speedNow>.2?Math.sin(bob*2)*.028*Math.min(1.5,speedNow/2.7):0))-camera.position.y)*Math.min(1,dt*12);}
      const fov=64+runBlend*7;if(Math.abs(camera.fov-fov)>.01){camera.fov=fov;camera.updateProjectionMatrix();}
      const vfov=60+runBlend*6;if(Math.abs(viewCam.fov-vfov)>.01){viewCam.fov=vfov;viewCam.updateProjectionMatrix();}
      avatar.place(camera.position.x,camera.position.z);
      avatar.update(dt,speedNow,speedNow>.15?Math.atan2(-movedX,-movedZ):null,floorAt(camera.position.x,camera.position.z),viewMode==='third'&&(cinema||viewCam.position.distanceTo(pivot)<1.6)?.4:1,ms/1000);
      if(moveTarget){
        const distance=Math.hypot(moveTarget.x-camera.position.x,moveTarget.z-camera.position.z);
        blockedFrames=distance>=moveTarget.lastDistance-.001?blockedFrames+1:0;moveTarget.lastDistance=distance;
        if(blockedFrames>12){cancelWalk('blocked');moveMarker.visible=false;}
      }
      look();
    }
    if(moveMarker.visible&&markerPulseUntil>ms){const phase=1-(markerPulseUntil-ms)/520;moveMarker.scale.setScalar(1+phase*.7);markerMaterial.opacity=.82*(1-phase);}
    else if(markerPulseUntil&&markerPulseUntil<=ms){markerPulseUntil=0;markerMaterial.opacity=.82;if(!moveTarget&&matchMedia('(pointer:coarse)').matches)moveMarker.visible=false;}
    if(paused){avatar.place(camera.position.x,camera.position.z);avatar.update(dt,0,null,floorAt(camera.position.x,camera.position.z),1,ms/1000);}
    placeViewCam(dt);
    atmosphere?.update(ms);
    weather?.update(ms/1000,dt,camera.position);
    if(wish){
      wish.update(ms/1000);
      // 願いを届けているあいだは、置物の上の空へ目を向ける（さわったら、そこで止める）
      if(cinema&&!drag){const turn=Math.atan2(Math.sin(cinema.yaw-yaw),Math.cos(cinema.yaw-yaw));yaw+=turn*Math.min(1,dt*2.5);pitch+=(cinema.pitch-pitch)*Math.min(1,dt*2.5);look();}
      else if(cinema&&drag)cinema=null;
    }
    renderer.render(scene,activeCam());
    if(frames===0){renderer.shadowMap.autoUpdate=false;canvas.dataset.ready='true';}
    if(++frames%10===0){
      publishPose();canvas.dataset.pace=paused?'stop':pace;
      /* あそび場の前に来たら知らせる（ボタンを出す）。離れたら消す */
      const nowNear=plays.length&&Math.hypot(camera.position.x-(ARCADE.x+1.2),camera.position.z-ARCADE.z)<ARCADE_NEAR?'arcade'
        :wish&&Math.hypot(camera.position.x-PLAZA.x,camera.position.z-PLAZA.z)<WISH_NEAR?'wish':null;
      if(nowNear!==near){near=nowNear;canvas.dataset.near=near||'';onNear(near);}
      canvas.dataset.drawCalls=String(renderer.info.render.calls);canvas.dataset.triangles=String(renderer.info.render.triangles);
      onFocus(paused?null:productAt(0,0));
    }
    raf=requestAnimationFrame(loop);
  }
  function start(){if(!raf&&!dead&&visible&&!document.hidden){last=performance.now();raf=requestAnimationFrame(loop);}}
  const ro=new ResizeObserver(resize);ro.observe(canvas);
  const io=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false;if(visible)start();else{release();cancelAnimationFrame(raf);raf=0;}});io.observe(canvas);
  document.addEventListener('visibilitychange',()=>{release();if(document.hidden){cancelAnimationFrame(raf);raf=0;}else start();},options);
  canvas.style.cursor='grab';canvas.dataset.navigation='idle';canvas.dataset.view=viewMode;resize();waypoint(sideSign?'streetBoth':'street');start();
  return {
    waypoint, selectCenter, focusProduct,
    focus(){canvas.focus({preventScroll:true});},
    /* run … スティックを外側まで倒したとき（走る） */
    setJoystick(x,y,run=false){if(paused)return;joystick={x:Math.max(-1,Math.min(1,x)),y:Math.max(-1,Math.min(1,y)),run:!!run};if(joystick.x||joystick.y){cancelWalk('manual');moveMarker.visible=false;}},
    setView(mode){viewMode=mode==='third'?'third':'first';avatar.show(viewMode==='third');canvas.dataset.view=viewMode;camera.position.y=1.68;snapView=true;},
    get view(){return viewMode;},
    /* 願いを届ける。終わると true（願いが無い・届けている途中・置物が無いときは false） */
    makeWish(text){
      if(!wish||wish.busy||!String(text||'').trim())return Promise.resolve(false);
      const c=wish.center,dx=c.x-camera.position.x,dz=c.z-camera.position.z;
      const done=wish.play(text,{x:dx,z:dz});
      // のぼっていく先の空へ目を向ける（少し下に置いて、置物も入るように）
      const s=wish.sky,far=Math.hypot(s.x-camera.position.x,s.z-camera.position.z);
      cinema={yaw:Math.atan2(-(s.x-camera.position.x),-(s.z-camera.position.z)),pitch:Math.min(.95,Math.atan2(s.y-1.68,far)-.12)};
      canvas.dataset.wish='playing';
      return done.then(ok=>{cinema=null;canvas.dataset.wish=ok?'done':'';return ok;});
    },
    setWeather(kind){if(!weather)return;weather.set(kind);canvas.dataset.weather=weather.kind;},
    pause(value){paused=!!value;release();if(paused)cancelWalk();},
    destroy(){if(dead)return;dead=true;release();cancelAnimationFrame(raf);abort.abort();ro.disconnect();io.disconnect();
      scene.traverse(o=>{if(o.geometry)disposables.add(o.geometry);if(o.material){for(const m of [].concat(o.material)){disposables.add(m);if(m.map)disposables.add(m.map);}}});
      for(const d of disposables)d.dispose?.();renderer.dispose();renderer.forceContextLoss();canvas.dataset.ready='false';
    }
  };
}
