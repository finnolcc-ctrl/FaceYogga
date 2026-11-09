// Project the existing detector's landmarks into the native camera mirror.
// Matches object-fit: cover; object-position: 50% 42%. CSS mirrors both the
// video and overlay once, so these coordinates stay in source orientation.
export const OUTER_LIP = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146,61];

export function mirrorFeedbackGeometry(points, sourceW, sourceH, viewW, viewH) {
  if (![sourceW,sourceH,viewW,viewH].every(n => Number.isFinite(n) && n > 0)) return null;
  const ids = [...OUTER_LIP,33,263,13,14,152,205,425];
  if (!points || ids.some(i => !Number.isFinite(points[i]?.x) || !Number.isFinite(points[i]?.y))) return null;
  const scale = Math.max(viewW/sourceW, viewH/sourceH);
  const offsetX = (viewW-sourceW*scale)*.5;
  const offsetY = (viewH-sourceH*scale)*.42;
  const p = i => [points[i].x*sourceW*scale+offsetX, points[i].y*sourceH*scale+offsetY];
  const a=p(33), b=p(263), upper=p(13), lower=p(14);
  const span=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if (span < 8) return null;
  const roll=Math.atan2(b[1]-a[1],b[0]-a[0]);
  const ex=[Math.cos(roll),Math.sin(roll)], ey=[-ex[1],ex[0]];
  const x=(upper[0]+lower[0])/2, y=(upper[1]+lower[1])/2;
  const lip=OUTER_LIP.map(p);
  const along=axis=>lip.map(q=>(q[0]-x)*axis[0]+(q[1]-y)*axis[1]);
  const xs=along(ex), ys=along(ey);
  const width=Math.max(...xs)-Math.min(...xs), height=Math.max(...ys)-Math.min(...ys);
  if (width < 2) return null;
  // Keep ink just outside the real lip edge; no synthetic face proportions.
  const unit=Math.max(.8, Math.min(2, span/110));
  const lipPath=lip.map(([px,py])=>{
    const dx=px-x,dy=py-y,d=Math.hypot(dx,dy)||1;
    return [px+dx/d*2*unit,py+dy/d*2*unit];
  });
  return { mouth:{x,y,width,height}, anchors:Object.fromEntries([61,291,152,205,425].map(i=>[i,p(i)])),
    unit, roll, lipPath };
}

export function traceMirrorLipHold(ctx, path, fill, stroke = () => ctx.stroke()) {
  if (!path?.length || !(fill > 0)) return;
  const lengths=path.slice(1).map((p,i)=>Math.hypot(p[0]-path[i][0],p[1]-path[i][1]));
  let remaining=lengths.reduce((a,b)=>a+b,0)*Math.min(1,fill);
  ctx.beginPath();ctx.moveTo(...path[0]);
  for(let i=0;i<lengths.length && remaining>0;i++) {
    const length=lengths[i];
    if(!length)continue;
    const fraction=Math.min(1,remaining/length),a=path[i],b=path[i+1];
    ctx.lineTo(a[0]+(b[0]-a[0])*fraction,a[1]+(b[1]-a[1])*fraction);
    remaining-=length;
  }
  stroke();
}
