import * as T from './vendor/city-three.min.js';
import { slideMove } from './city-motion.js';

const VIEWPOINTS = {
  street:{x:7,z:11,lookX:0,lookZ:1}, entrance:{x:0,z:2.6,lookX:0,lookZ:-3,lookY:1.25},
  table:{x:1.6,z:1.5,lookX:0,lookZ:-1.7,lookY:1.12}, shelves:{x:-2.9,z:-3.3,lookX:-4.4,lookZ:-4.5},
  counter:{x:1.7,z:-2.5,lookX:3.25,lookZ:-3.75,lookY:1.48}
};

// A real perspective scene, not a panorama or an image with click areas.
// All geometry/textures are original, generated locally. No remote asset/CDN.
export function createWorld(canvas, { products = [], onSelect = () => {}, onFocus = () => {}, onLost = () => {} } = {}) {
  const renderer = new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.5));
  renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  const scene=new T.Scene();scene.background=new T.Color('#dce3da');scene.fog=new T.Fog('#dce3da',24,70);
  const camera=new T.PerspectiveCamera(64,1,.08,85);camera.rotation.order='YXZ';
  const bounds={minX:-10,maxX:10,minZ:-8,maxZ:15}, boxes=[], disposables=new Set();
  let yaw=0,pitch=0,drag=null,joystick={x:0,y:0},raf=0,last=0,dead=false,paused=false,visible=true,frames=0;
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
  scene.add(new T.HemisphereLight('#edf5e6','#847057',2.25));
  const sun=new T.DirectionalLight('#fff0cd',3.7);sun.position.set(-8,13,10);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-13,right:13,top:13,bottom:-13,near:1,far:40});
  sun.shadow.bias=-.0006;sun.shadow.normalBias=.025;scene.add(sun);sun.target.position.set(0,0,-2);scene.add(sun.target);
  const fill=new T.PointLight('#ffdaaa',15,15,2);fill.position.set(0,3,-3);scene.add(fill);
  block(0,-.13,3,48,.2,48,paving);
  block(0,-.015,-2,10,.15,12,wood);
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
  label('THE FIELD STORE',0,3.5,4.32,6,.5,undefined,undefined,68);
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
  for(let y=0;y<3;y++)for(let i=0;i<8;i++){
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
  block(8,1.7,-1,4,3.4,8,plaster);obstacle(8,-1,4,8);
  block(8,2.8,3.1,3.8,.55,.15,green);label('YOUR LOCAL STORE',8,2.81,3.19,3.3,.4,undefined,undefined,47);
  label('PARTNER 01 / 02',8,1.65,3.12,2.8,.7,'#eee7d7','#244936',42);
  label('COMING TO THE CITY',8,1.02,3.12,2.8,.4,'#eee7d7','#91704f',34);
  block(-2.15,.8,5.7,.95,1.6,.13,green);obstacle(-2.15,5.7,.95,.16);
  label('STEP INSIDE',-2.15,1.08,5.78,.88,.35,undefined,undefined,62);
  label('3D SHOWROOM',-2.15,.64,5.78,.85,.3,undefined,undefined,41);
  // Products are selectable meshes; each has its own visible physical model.
  const positions=[[-.68,.94,-1.45],[.68,.94,-1.43],[.42,.94,-2.05],[3.25,1.31,-3.75]];
  products.slice(0,4).forEach((product,i)=>{
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
  function resize(){const r=canvas.getBoundingClientRect();if(r.width<1||r.height<1)return;renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}
  function look(){camera.rotation.set(pitch,yaw,0,'YXZ');}
  function view(v){camera.position.set(v.x,1.68,v.z);yaw=Math.atan2(v.x-v.lookX,v.z-v.lookZ);pitch=Math.atan2((v.lookY??1.68)-1.68,Math.hypot(v.x-v.lookX,v.z-v.lookZ));look();keys.clear();joystick={x:0,y:0};}
  function waypoint(name){const v=VIEWPOINTS[name];if(v)view(v);}
  function focusProduct(id){const i=products.findIndex(p=>p.id===id);if(i<0||i>3)return;const [x,y,z]=positions[i];const from=[[-2,.4],[2,.5],[2,-2.8],[1.6,-2.3]][i];view({x:from[0],z:from[1],lookX:x,lookZ:z,lookY:y+.18});}
  function productAt(x,y){
    pointer.set(x,y);ray.setFromCamera(pointer,camera);
    const hits=ray.intersectObjects(scene.children,true);
    for(const hit of hits){
      // Ignore the nearly-transparent windows, but never select through walls.
      if(hit.object.material?.transparent && hit.object.material.opacity<.3)continue;
      let o=hit.object;while(o&&!o.userData.productId)o=o.parent;
      return o?.userData.productId && hit.distance<5 ? o.userData.productId : null;
    }
    return null;
  }
  function selectCenter(){const id=productAt(0,0);if(id)onSelect(id);}
  function point(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width*2-1,y:1-(e.clientY-r.top)/r.height*2};}
  canvas.addEventListener('pointerdown',e=>{
    if(paused||e.button!==0)return;canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,moved:0};
  },options);
  canvas.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId||paused)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved+=Math.hypot(dx,dy);drag.x=e.clientX;drag.y=e.clientY;
    yaw-=dx*.004;pitch=Math.max(-1.1,Math.min(.9,pitch-dy*.0035));look();
  },options);
  canvas.addEventListener('pointerup',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    if(drag.moved<7&&!paused){const p=point(e),id=productAt(p.x,p.y);if(id)onSelect(id);}
    drag=null;
  },options);
  canvas.addEventListener('pointercancel',()=>{drag=null;},options);
  const supported=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyE']);
  canvas.addEventListener('keydown',e=>{if(paused||!supported.has(e.code))return;e.preventDefault();keys.add(e.code);if(e.code==='KeyE'&&!e.repeat)selectCenter();},options);
  window.addEventListener('keyup',e=>keys.delete(e.code),options);
  function release(){keys.clear();drag=null;joystick={x:0,y:0};}
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
      const dx=(-Math.sin(yaw)*forward+Math.cos(yaw)*side)*dt*2.7;
      const dz=(-Math.cos(yaw)*forward-Math.sin(yaw)*side)*dt*2.7;
      if(dx||dz){const p=slideMove(camera.position,dx,dz,boxes,bounds);camera.position.x=p.x;camera.position.z=p.z;}
      look();
    }
    renderer.render(scene,camera);
    if(frames===0){renderer.shadowMap.autoUpdate=false;canvas.dataset.ready='true';}
    if(++frames%10===0){
      canvas.dataset.position=JSON.stringify({x:+camera.position.x.toFixed(3),z:+camera.position.z.toFixed(3),yaw:+yaw.toFixed(3)});
      canvas.dataset.drawCalls=String(renderer.info.render.calls);canvas.dataset.triangles=String(renderer.info.render.triangles);
      onFocus(paused?null:productAt(0,0));
    }
    raf=requestAnimationFrame(loop);
  }
  function start(){if(!raf&&!dead&&visible&&!document.hidden){last=performance.now();raf=requestAnimationFrame(loop);}}
  const ro=new ResizeObserver(resize);ro.observe(canvas);
  const io=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false;if(visible)start();else{release();cancelAnimationFrame(raf);raf=0;}});io.observe(canvas);
  document.addEventListener('visibilitychange',()=>{release();if(document.hidden){cancelAnimationFrame(raf);raf=0;}else start();},options);
  resize();waypoint('street');start();
  return {
    waypoint, selectCenter, focusProduct,
    focus(){canvas.focus({preventScroll:true});},
    setJoystick(x,y){joystick={x:Math.max(-1,Math.min(1,x)),y:Math.max(-1,Math.min(1,y))};},
    pause(value){paused=!!value;release();},
    destroy(){if(dead)return;dead=true;release();cancelAnimationFrame(raf);abort.abort();ro.disconnect();io.disconnect();
      scene.traverse(o=>{if(o.geometry)disposables.add(o.geometry);if(o.material){for(const m of [].concat(o.material)){disposables.add(m);if(m.map)disposables.add(m.map);}}});
      for(const d of disposables)d.dispose?.();renderer.dispose();renderer.forceContextLoss();canvas.dataset.ready='false';
    }
  };
}
