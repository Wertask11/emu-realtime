// Small movement steps plus axis sliding keep both touch and keyboard movement
// out of walls/furniture, including after a suspended browser tab resumes.
export function isBlocked(position, boxes, bounds, radius = .24) {
  const {x,z}=position;
  return x < bounds.minX + radius || x > bounds.maxX - radius
    || z < bounds.minZ + radius || z > bounds.maxZ - radius
    || boxes.some(b => x > b.minX-radius && x < b.maxX+radius && z > b.minZ-radius && z < b.maxZ+radius);
}

export function slideMove(position, dx, dz, boxes, bounds, radius = .24) {
  const p = {x:position.x,z:position.z};
  const steps = Math.max(1,Math.ceil(Math.hypot(dx,dz)/.12));
  for(let i=0;i<steps;i++) {
    if(!isBlocked({x:p.x+dx/steps,z:p.z},boxes,bounds,radius)) p.x+=dx/steps;
    if(!isBlocked({x:p.x,z:p.z+dz/steps},boxes,bounds,radius)) p.z+=dz/steps;
  }
  return p;
}
