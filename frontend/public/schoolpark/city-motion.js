// Small movement steps plus axis sliding keep both touch and keyboard movement
// out of walls/furniture, including after a suspended browser tab resumes.
export function slideMove(position, dx, dz, boxes, bounds, radius = .24) {
  const p = {x:position.x,z:position.z};
  const blocked = (x,z) => x < bounds.minX + radius || x > bounds.maxX - radius
    || z < bounds.minZ + radius || z > bounds.maxZ - radius
    || boxes.some(b => x > b.minX-radius && x < b.maxX+radius && z > b.minZ-radius && z < b.maxZ+radius);
  const steps = Math.max(1,Math.ceil(Math.hypot(dx,dz)/.12));
  for(let i=0;i<steps;i++) {
    if(!blocked(p.x+dx/steps,p.z)) p.x+=dx/steps;
    if(!blocked(p.x,p.z+dz/steps)) p.z+=dz/steps;
  }
  return p;
}
