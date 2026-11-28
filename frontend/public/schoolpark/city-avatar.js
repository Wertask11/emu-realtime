/* 11/28 オーナー：「アバターの追加」。City を歩く自分の分身（冷蔵庫くん）。
   形・色はすべてここで作る（外の画像や模型は読まない）。前は -z の向き（カメラと同じ）。
   - 当たり判定（タップで選ぶ・床を選ぶ）には入らない（raycast しない）
   - 影は丸い影を足もとに置く（街の影は最初の1回しか描き直さないので、動く影は使わない）
   - 歩く・走ると手足が動き、マントがなびく。止まると、ゆっくり息をする */
export function buildAvatar(T, { disposables }) {
  const own = new Set();
  const keep = (x) => { disposables.add(x); return x; };
  const mat = (color, more = {}) => { const m = keep(new T.MeshStandardMaterial({ color, roughness: .55, ...more })); own.add(m); return m; };
  const group = new T.Group(); group.name = 'avatar';
  const body = new T.Group(); group.add(body);
  const part = (geometry, material, x, y, z, parent = body) => { keep(geometry); const o = new T.Mesh(geometry, material); o.position.set(x, y, z); parent.add(o); return o; };
  const red = mat('#e0322b'), deep = mat('#a8231d'), ink = mat('#1d1715', { roughness: .4 }), white = mat('#ffffff', { roughness: .3 });
  const silver = mat('#d9dde2', { metalness: .6, roughness: .3 }), shoe = mat('#3b2a22'), cape = mat('#2f63c8', { side: T.DoubleSide, roughness: .7 });
  const hair = mat('#2a1d17', { roughness: .8 }), cheek = mat('#ff8a8a', { roughness: .9 });
  // 冷蔵庫の箱（上下2つの扉）
  const LEG = .38, H = .92;
  part(new T.BoxGeometry(.64, H, .52), red, 0, LEG + H / 2, 0);
  part(new T.BoxGeometry(.648, .018, .528), deep, 0, LEG + H * .62, 0);
  part(new T.BoxGeometry(.05, .2, .04), silver, -.22, LEG + H * .78, -.27);
  part(new T.BoxGeometry(.05, .14, .04), silver, -.22, LEG + H * .4, -.27);
  // 顔：目・ほっぺ・にっこり口
  for (const x of [-.12, .12]) {
    const eye = part(new T.SphereGeometry(.072, 14, 10), ink, x, LEG + H * .8, -.262); eye.scale.set(1, 1.2, .35);
    part(new T.SphereGeometry(.022, 8, 6), white, x + .022, LEG + H * .8 + .03, -.29);
    const c = part(new T.CircleGeometry(.045, 14), cheek, x * 1.55, LEG + H * .68, -.262); c.rotation.y = Math.PI;
  }
  const smile = part(new T.TorusGeometry(.085, .016, 6, 18, Math.PI), ink, 0, LEG + H * .7, -.262); smile.rotation.z = Math.PI;
  // 頭のつんつん髪
  [[-.13, .42, -.35], [0, .5, 0], [.13, .42, .35], [-.06, .36, -.15], [.07, .38, .2]].forEach(([x, h, tilt]) => {
    const spike = part(new T.CylinderGeometry(0, .07, h * .5, 6), hair, x, LEG + H + h * .2, 0); spike.rotation.z = tilt;
  });
  // 腕と脚（肩・腰を軸に振る）
  const limb = (x, y, length, radius, material, foot) => {
    const pivot = new T.Group(); pivot.position.set(x, y, 0); body.add(pivot);
    part(new T.CylinderGeometry(radius, radius, length, 10), material, 0, -length / 2, 0, pivot);
    if (foot) part(new T.BoxGeometry(.14, .07, .22), shoe, 0, -length + .02, -.04, pivot);
    else part(new T.SphereGeometry(radius * 1.5, 10, 8), white, 0, -length, 0, pivot);
    return pivot;
  };
  const arms = [limb(-.37, LEG + H * .72, .4, .042, deep), limb(.37, LEG + H * .72, .4, .042, deep)];
  const legs = [limb(-.14, LEG, LEG - .02, .06, deep, true), limb(.14, LEG, LEG - .02, .06, deep, true)];
  arms[0].rotation.z = -.18; arms[1].rotation.z = .18;
  // 背中の青いマント（上の端を軸に、うしろへなびく）
  const capePivot = new T.Group(); capePivot.position.set(0, LEG + H - .04, .275); body.add(capePivot);
  part(new T.PlaneGeometry(.58, .82, 1, 4), cape, 0, -.41, 0, capePivot);
  // 足もとの丸い影
  const shadowMaterial = keep(new T.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: .26, depthWrite: false }));
  const shadow = part(new T.CircleGeometry(.42, 24), shadowMaterial, 0, .012, 0, group); shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1;
  group.traverse((o) => { o.raycast = () => {}; o.castShadow = false; o.receiveShadow = false; });

  let phase = 0, swing = 0, facing = 0, fade = 1, see = true;
  function setFade(value) {
    const next = Math.max(.3, Math.min(1, value));
    if ((next < .99) !== (fade < .99)) for (const m of own) { m.transparent = next < .99; m.needsUpdate = true; }
    fade = next; for (const m of own) m.opacity = fade; shadowMaterial.opacity = .26 * fade;
  }
  return {
    group,
    get facing() { return facing; },
    /* dt 秒・速さ（m/s）・向き（rad、null なら今の向き）・床の高さ・見せる濃さ（カメラが近いと薄くする） */
    update(dt, speed, heading, floor, opacity, time) {
      if (heading != null) { const turn = Math.atan2(Math.sin(heading - facing), Math.cos(heading - facing)); facing += turn * Math.min(1, dt * 10); }
      group.rotation.y = facing;
      group.position.y += (floor - group.position.y) * Math.min(1, dt * 12);
      const amount = Math.min(1.4, speed / 2.7);
      swing += (amount - swing) * Math.min(1, dt * 8);
      phase += dt * (3 + speed * 2.6);
      const s = Math.sin(phase) * swing;
      legs[0].rotation.x = s * .7; legs[1].rotation.x = -s * .7;
      arms[0].rotation.x = -s * .8; arms[1].rotation.x = s * .8;
      const breathe = swing < .05 ? Math.sin(time * 2.2) * .012 : 0;
      body.position.y = Math.abs(Math.sin(phase)) * .05 * swing + breathe;
      body.rotation.x = -.08 * Math.min(1, swing);
      capePivot.rotation.x = -(.1 + swing * .45 + Math.sin(phase * .5 + 1) * .05 * (swing + .3));
      if (Math.abs(opacity - fade) > .005) setFade(fade + (opacity - fade) * Math.min(1, dt * 8));
    },
    face(angle) { facing = angle; group.rotation.y = angle; },
    place(x, z) { group.position.x = x; group.position.z = z; },
    show(value) { see = !!value; group.visible = see; },
    get visible() { return see; }
  };
}
