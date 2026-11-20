export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const project = (x, y, z = 0) => ({
  x: 340 + (x - y) * 32,
  y: 175 + (x + y) * 16 - z,
});
const coord = (p) => `${p.x},${p.y}`;
function corners(x, y, w, d, z = 0) {
  return [
    project(x, y, z),
    project(x + w, y, z),
    project(x + w, y + d, z),
    project(x, y + d, z),
  ];
}
const polygon = (pts, fill, stroke = "#947958", width = 2.5) =>
  `<polygon points="${pts.map(coord).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
const line = (a, b, stroke = "#947958", width = 3) =>
  `<path d="M${coord(a)}L${coord(b)}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
export function sceneSvg(layout, catalog, { selected = null } = {}) {
  const items = new Map((catalog.items || []).map((i) => [i.id, i])),
    P = project;
  let body = "";
  body += polygon(
    [P(0, 0), P(0, 6), P(0, 6, 140), P(0, 0, 140)],
    layout.wall ? "#f1d9cc" : "#eee2c3",
  );
  body += polygon(
    [P(0, 0), P(8, 0), P(8, 0, 140), P(0, 0, 140)],
    layout.wall ? "#fae9da" : "#f6ecd6",
  );
  body += polygon(corners(0, 0, 8, 6), layout.floor ? "#cba976" : "#e4c590");
  for (let x = 1; x < 8; x++) body += line(P(x, 0), P(x, 6), "#b99b6e", 1);
  for (let y = 1; y < 6; y++) body += line(P(0, y), P(8, y), "#b99b6e", 1);
  const windowPoints = [P(3, 0, 112), P(5, 0, 112), P(5, 0, 61), P(3, 0, 61)];
  body += polygon(
    windowPoints,
    layout.window ? "#273754" : "#d1e4e2",
    "#9d8669",
    5,
  );
  body += line(P(4, 0, 112), P(4, 0, 61), "#eee3c7", 3);
  body += line(P(3, 0, 87), P(5, 0, 87), "#eee3c7", 3);
  if (layout.window) {
    for (const [x, z] of [
      [3.4, 102],
      [4.5, 96],
      [4.7, 76],
    ]) {
      const p = P(x, 0, z);
      body += `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#fff3bb"/>`;
    }
  }
  const placed = [...(layout.placements || [])].sort(
    (a, b) => num(a.x) + num(a.y) - num(b.x) - num(b.y),
  );
  for (const p of placed) {
    const i = items.get(p.itemId);
    if (!i) continue;
    const x = num(p.x),
      y = num(p.y),
      turn = num(p.rotation) % 180 !== 0,
      w = turn ? i.depth : i.width,
      d = turn ? i.width : i.depth;
    let art = "",
      center;
    if (p.surface === "floor") {
      center = P(x + w / 2, y + d / 2);
      const top = corners(x, y, w, d, i.art.startsWith("chair") ? 23 : 40),
        base = corners(x, y, w, d);
      if (i.art.startsWith("desk")) {
        for (const k of [0, 1, 2, 3]) art += line(top[k], base[k]);
        art += polygon(top, i.art === "desk-oak" ? "#bf8e56" : "#d8b375");
        art += line(top[3], top[2], "#9b714a", 4);
      } else if (i.art.startsWith("chair")) {
        for (const k of [1, 2, 3]) art += line(top[k], base[k]);
        art += polygon(top, i.art === "chair-cushion" ? "#dbb4a6" : "#d8b375");
        const k = [0, 90].includes(p.rotation) ? [0, 1] : [2, 3],
          b1 = { ...top[k[0]], y: top[k[0]].y - 37 },
          b2 = { ...top[k[1]], y: top[k[1]].y - 37 };
        art += polygon([top[k[0]], top[k[1]], b2, b1], "#e0c397");
      } else if (i.art === "reizo") {
        art += `<image href="/ehon/common/reizo-wave.webp" x="${center.x - 35}" y="${center.y - 92}" width="70" height="95"/>`;
      } else if (i.art === "bookshelf") {
        const upper = corners(x, y, w, d, 65);
        art += polygon([upper[3], upper[2], base[2], base[3]], "#c6a171");
        art += polygon(upper, "#e1c48c");
        for (const z of [20, 40])
          art += line(P(x, y + d, z), P(x + w, y + d, z));
        for (let k = 0; k < 5; k++) {
          const q = P(x + 0.15 + k * 0.32, y + d, 44);
          art += `<path d="M${q.x} ${q.y}v-15" stroke="${["#bd7b6d", "#94ab86", "#d7b36a"][k % 3]}" stroke-width="6"/>`;
        }
      } else if (i.art === "lamp") {
        art +=
          `<ellipse cx="${center.x}" cy="${center.y}" rx="17" ry="8" fill="#b38b57"/>` +
          line(center, { x: center.x, y: center.y - 46 }) +
          polygon(
            [
              { x: center.x - 22, y: center.y - 37 },
              { x: center.x + 22, y: center.y - 37 },
              { x: center.x + 12, y: center.y - 64 },
              { x: center.x - 12, y: center.y - 64 },
            ],
            "#efce7b",
          );
      } else if (i.art === "plant") {
        art += polygon(
          [
            { x: center.x - 14, y: center.y - 25 },
            { x: center.x + 14, y: center.y - 25 },
            { x: center.x + 9, y: center.y },
            { x: center.x - 9, y: center.y },
          ],
          "#c78964",
        );
        for (const [dx, dy, angle] of [
          [-10, -43, -35],
          [10, -49, 35],
          [0, -61, 0],
        ])
          art += `<ellipse cx="${center.x + dx}" cy="${center.y + dy}" rx="10" ry="19" fill="#7c9d70" transform="rotate(${angle} ${center.x + dx} ${center.y + dy})"/>`;
      } else if (i.art === "apple") {
        art +=
          `<circle cx="${center.x - 7}" cy="${center.y - 18}" r="15" fill="#cf6e54"/><circle cx="${center.x + 7}" cy="${center.y - 18}" r="15" fill="#d97c60"/>` +
          line(
            { x: center.x, y: center.y - 30 },
            { x: center.x + 2, y: center.y - 43 },
            "#7e6f46",
            3,
          );
      }
      if (selected === p.id)
        art = polygon(corners(x, y, w, d), "#ffbc433d", "#bf6f16", 3) + art;
    } else {
      const left = p.surface === "left_wall",
        a = left ? P(0, x + 0.1, 112 - y * 32) : P(x + 0.1, 0, 112 - y * 32),
        b = left ? P(0, x + 0.9, 112 - y * 32) : P(x + 0.9, 0, 112 - y * 32);
      center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 20 };
      art += polygon(
        [a, b, { ...b, y: b.y + 25 }, { ...a, y: a.y + 25 }],
        "#ffe9af",
        selected === p.id ? "#bf6f16" : "#9c866b",
        4,
      );
      art += line(
        { x: center.x, y: center.y - 19 },
        { x: center.x, y: center.y + 1 },
        "#b98259",
        4,
      );
    }
    body += `<g data-room-instance="${escape(p.id)}" role="button" tabindex="0" aria-label="${escape(i.name)}を選ぶ"><title>${escape(i.name)}・向き${num(p.rotation)}度</title>${art}<rect x="${center.x - 50}" y="${center.y - 80}" width="100" height="100" fill="transparent" pointer-events="all"/></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="105 15 540 440" role="group" aria-label="SchoolPark Cityの部屋。持ち物から道具を選んで配置できます" tabindex="0" data-room-scene=""><rect x="105" y="15" width="540" height="440" fill="#fffdf5"/>${body}<g data-room-ghost=""></g></svg>`;
}
export function positionFromPointer(svg, event) {
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      svg.getScreenCTM().inverse(),
    ),
    u = (p.x - 340) / 32,
    v = (p.y - 175) / 16;
  return { x: Math.floor((u + v) / 2), y: Math.floor((v - u) / 2) };
}
export async function roomPng(layout, catalog) {
  const doc = new DOMParser().parseFromString(
      sceneSvg(layout, catalog),
      "image/svg+xml",
    ),
    svg = doc.documentElement;
  if (doc.querySelector("parsererror")) throw Error("ROOM_IMAGE_UNAVAILABLE");
  svg.setAttribute("width", "1200");
  svg.setAttribute("height", String(Math.round((1200 * 440) / 540)));
  for (const img of svg.querySelectorAll("image")) {
    const url = new URL(img.getAttribute("href"), location.origin);
    if (
      url.origin !== location.origin ||
      url.pathname !== "/ehon/common/reizo-wave.webp"
    )
      throw Error("ROOM_IMAGE_UNAVAILABLE");
    const r = await fetch(url, { cache: "force-cache" });
    if (!r.ok) throw Error("ROOM_IMAGE_UNAVAILABLE");
    const blob = await r.blob();
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    img.setAttribute("href", data);
  }
  const source = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml;charset=utf-8",
    }),
    url = URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = Math.round((1200 * 440) / 540);
    canvas.getContext("2d").drawImage(image, 0, 0);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error("ROOM_IMAGE_UNAVAILABLE"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
