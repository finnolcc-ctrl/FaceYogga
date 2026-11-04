// Coordinates are in the approved drawing, before the final uniform viewport scale.
const CX = 433, MOUTH_Y = 667;
const bounded = (n, limit) => Math.max(-limit, Math.min(limit, n));
const unit = n => Math.max(0, Math.min(1, n));
const parts = {
  eyeL: [276,450,120,58], eyeR: [473,445,119,61],
  browL: [257,404,150,44], browR: [449,397,154,51],
  nose: [380,521,107,102], lips: [351,635,165,78],
  u: [1060,640,106,85]
};
export const restSketch = {
  faceWidth:1, jawWidth:0, eyeX:0, eyeY:0, noseX:0, noseY:0, lipX:0, lipY:0,
  width:142, gap:0, round:0, blinkL:0, blinkR:0, brow:0, cheekL:0, cheekR:0
};

// Convert the paper to transparent pigment once, then separate a handful of
// original pencil layers. There is no image processing on camera frames.
function makeCanvas(w,h) {
  const canvas=document.createElement('canvas');
  canvas.width=w; canvas.height=h;
  return canvas;
}
let art;
export const sketchReady = typeof Image === 'undefined' ? Promise.resolve(false) : loadArt();
async function loadArt() {
  const img=new Image();
  img.src=new URL('./art/portrait-sheet.jpg',import.meta.url).href;
  try { await img.decode(); } catch { return false; }
  const sheet=makeCanvas(img.naturalWidth,img.naturalHeight);
  const ctx=sheet.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(img,0,0);
  const pixels=ctx.getImageData(0,0,sheet.width,sheet.height);
  const paper=[250,247,239];
  for(let i=0;i<pixels.data.length;i+=4){
    const alpha=unit((1-Math.min(pixels.data[i]/paper[0],pixels.data[i+1]/paper[1],pixels.data[i+2]/paper[2])-.035)*1.35);
    if(alpha>0) for(let c=0;c<3;c++)
      pixels.data[i+c]=paper[c]+(pixels.data[i+c]-paper[c])/alpha;
    pixels.data[i+3]=255*alpha;
  }
  ctx.putImageData(pixels,0,0);
  const base=makeCanvas(768,1024);
  const baseCtx=base.getContext('2d');
  baseCtx.drawImage(sheet,0,0,768,1024,0,0,768,1024);
  const layers={base};
  for(const [key,[x,y,w,h]] of Object.entries(parts)){
    const layer=makeCanvas(w,h);
    layer.getContext('2d').drawImage(sheet,x,y,w,h,0,0,w,h);
    layers[key]=layer;
    if(key!=='u')baseCtx.clearRect(x,y,w,h);
  }
  art=layers;
  return true;
}

export function trackedSketch(raw,frame,w,h,face,profile={},blends={}) {
  const local = i => {
    const dx=raw[i].x*w-frame.top.x, dy=raw[i].y*h-frame.top.y;
    return {x:(dx*frame.ex.x+dy*frame.ex.y)/frame.height,y:(dx*frame.ey.x+dy*frame.ey.y)/frame.height};
  };
  const n=profile?.neutral;
  const left=local(33),right=local(263),nose=local(1),lip=local(13);
  const opening=Math.max(0,face.gap-(n?.gap ?? .025));
  const baselineWidth=n?.width ?? .48;
  const round=unit(Math.max(face.pucker-(n?.pucker ?? .03),(baselineWidth-face.width)*2.8)*1.6);
  return {...restSketch,
    // Personal proportions stay within 3.5% in silhouette and 6 px per feature.
    faceWidth:1+bounded((frame.width/frame.height-.85)*.22,.035),
    jawWidth:bounded(((local(397).x-local(172).x)*frame.height/frame.width-.775)*36,7),
    eyeX:bounded((right.x-left.x-.50)*40,6), eyeY:bounded(((right.y+left.y)/2-.32)*40,6),
    noseX:bounded(nose.x*30,5),noseY:bounded((nose.y-.53)*38,6),
    lipX:bounded(nose.x*26,5)+bounded((face.x-(n?.x ?? 0))*360,42),
    lipY:bounded((lip.y-.72)*24,5)+bounded((face.y-(n?.y ?? .44))*220,26),
    width:142+(face.width-baselineWidth)*220-round*17-Math.min(12,opening*62),
    gap:Math.min(52,opening*220),round,
    blinkL:unit(blends.eyeBlinkLeft||0),blinkR:unit(blends.eyeBlinkRight||0),
    brow:-bounded((blends.browInnerUp||0)*8,8),
    cheekL:bounded((-local(205).x-.23)*60,8),cheekR:bounded((local(425).x-.23)*60,8)
  };
}

export function guideSketch(key,amount=1) {
  const p={...restSketch};
  const round=['u','left','right','up','down'].includes(key);
  p.round=round?amount:0;
  if(round)p.width-=52*amount;
  if(key==='left'||key==='right')p.lipX=(key==='left'?-38:38)*amount;
  if(key==='up'||key==='down')p.lipY=(key==='up'?-25:25)*amount;
  if(key==='a'){p.gap=50*amount;p.width-=18*amount;p.lipY=9*amount;}
  if(key==='e'||key==='smile')p.width+=24*amount;
  if(key==='brow')p.brow=-10*amount;
  if(key==='draw_in'||key==='hold')p.cheekL=p.cheekR=-10*amount;
  if(key==='cheek')p.cheekL=p.cheekR=10*amount;
  if(key.startsWith('air_')||key.startsWith('tongue_')){
    p[key.includes('left')?'cheekL':'cheekR']=(key.startsWith('air_')?14:6)*amount;
  }
  return p;
}

export function mouthBounds(p) {
  const width=Math.max(88,Math.min(174,p.width));
  return {x:CX+p.lipX,y:MOUTH_Y+p.lipY,width,height:54+p.round*11+p.gap};
}

// Pencil lip border in mouth-local coordinates, from the left corner around the bow.
const LIP_EDGE=[[-1,0],[-.79,-.36],[-.46,-.88],[-.21,-.92],[0,-.77],[.24,-.95],[.48,-.83],[.8,-.34],[1,0],
  [.76,.43],[.44,.85],[0,1],[-.45,.86],[-.79,.4],[-1,0]];
export function traceLipHold(ctx,pose,fill) {
  const {x,y,width,height}=mouthBounds(pose);
  const points=LIP_EDGE.map(([u,v])=>[x+u*(width/2+4),y+v*(height/2+3)]);
  const lengths=points.slice(1).map(([px,py],i)=>Math.hypot(px-points[i][0],py-points[i][1]));
  let remaining=lengths.reduce((sum,length)=>sum+length,0)*fill;
  ctx.beginPath();ctx.moveTo(...points[0]);
  for(let i=0;i<lengths.length && remaining>0;i++){
    const a=points[i],b=points[i+1],fraction=Math.min(1,remaining/lengths[i]);
    ctx.lineTo(a[0]+(b[0]-a[0])*fraction,a[1]+(b[1]-a[1])*fraction);
    remaining-=lengths[i];
  }
  ctx.stroke();
}

// The mouth is the original pencil pigment split along its natural seam.
// The corners stay joined as the centre opens.
function drawLips(ctx,p) {
  const {x,y,width}=mouthBounds(p);
  if(p.gap>0.25){
    ctx.fillStyle='#785444';ctx.beginPath();
    ctx.moveTo(x-width/2,y);
    ctx.quadraticCurveTo(x,y-p.gap,x+width/2,y);
    ctx.quadraticCurveTo(x,y+p.gap,x-width/2,y);
    ctx.fill();
  }
  function lipLayer(layer,sourceWidth,seamY){
    const scale=width/sourceWidth, sy=1+.12*p.round;
    const left=x-layer.width*scale/2, top=y-seamY*sy;
    if(p.gap<=.25){ctx.drawImage(layer,left,top,layer.width*scale,layer.height*sy);return;}
    const n=18;
    for(let j=0;j<n;j++){
      const sx=Math.round(layer.width*j/n), end=Math.round(layer.width*(j+1)/n);
      const u=(sx+(end-sx)/2-layer.width/2)/(sourceWidth/2);
      const arc=Math.max(0,1-u*u), split=seamY+Math.round(2*arc);
      const shift=p.gap*.5*arc, dx=left+sx*scale, dw=(end-sx)*scale+.3;
      ctx.drawImage(layer,sx,0,end-sx,split,dx,top-shift,dw,split*sy);
      ctx.drawImage(layer,sx,split,end-sx,layer.height-split,dx,y+(split-seamY)*sy+shift,dw,(layer.height-split)*sy);
    }
  }
  if(p.round<1){ctx.save();ctx.globalAlpha=1-p.round;lipLayer(art.lips,142,32);ctx.restore();}
  if(p.round>0){ctx.save();ctx.globalAlpha=p.round;lipLayer(art.u,86,37);ctx.restore();}
}

export function renderSketch(ctx,p) {
  if(!art)return false;
  // Horizontal bands follow the two cheeks independently while hair and neck
  // keep the same aspect. The layers are cached at source resolution.
  for(let y=0;y<1024;){
    const band=y===0?480:y>=832?1024-y:16;
    const middle=y+band/2;
    const cheek=unit(1-Math.abs(middle-625)/140);
    const jaw=unit(1-Math.abs(middle-720)/110)*p.jawWidth;
    const dw=(p.faceWidth-1)*768;
    const left=-dw*CX/768-p.cheekL*cheek-jaw, width=768+dw+(p.cheekL+p.cheekR)*cheek+2*jaw;
    ctx.drawImage(art.base,0,y,768,band,left,y,width,band);
    y+=band;
  }
  function part(key,dx,dy,scaleY=1){
    const [x,y,w,h]=parts[key];
    ctx.drawImage(art[key],x+dx,y+dy+h*(1-scaleY)/2,w,h*scaleY);
  }
  part('browL',-p.eyeX,p.eyeY+p.brow);part('browR',p.eyeX,p.eyeY+p.brow);
  part('eyeL',-p.eyeX,p.eyeY,1-p.blinkL*.91);part('eyeR',p.eyeX,p.eyeY,1-p.blinkR*.91);
  part('nose',p.noseX,p.noseY);
  drawLips(ctx,p);
  return true;
}

export function fitSketch(ctx,w,h,roll=0) {
  const scale=Math.min(w/670,h/990);
  ctx.translate(w/2,h/2);if(roll)ctx.rotate(roll);ctx.scale(scale,scale);ctx.translate(-CX,-501);
}
