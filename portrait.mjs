// Shared artwork for the tutorial and tracked portrait. Coordinates are design units,
// not detection measurements. Live facial features still come from the user's landmarks.
const f = n => Number(n.toFixed(2));
export const HAIR_OUTLINE = 'M54 151 C37 111 40 69 65 44 C91 14 132 12 160 17 C190 12 230 16 255 44 C280 73 281 111 266 151 L257 163 C255 118 245 94 220 81 C197 69 179 73 160 83 C137 68 119 69 98 82 C73 97 64 122 63 164Z';
export const HAIR_PATHS = [];
// Swept-back strands radiate from a broad hairline, with a soft off-center part.
for (let i=0;i<20;i++) {
  const t=i/19;
  const x=62+98*t, y=150-79*Math.sin(t*Math.PI/2)+12*t**6;
  const endX=54+100*t,endY=110-88*Math.sin(t*Math.PI/2);
  HAIR_PATHS.push(`M${f(x)} ${f(y)} C${f(x-12*(1-t))} ${f(y-30)} ${f(endX-10*(1-t))} ${f(endY-8*(1-t))} ${f(endX)} ${f(endY)}`);
  HAIR_PATHS.push(`M${f(320-x)} ${f(y)} C${f(320-x+12*(1-t))} ${f(y-30)} ${f(320-endX+10*(1-t))} ${f(endY-8*(1-t))} ${f(320-endX)} ${f(endY)}`);
}
export function hairSVG() {
  return `<g class="portrait-hair" fill="none" stroke="currentColor" stroke-linecap="round"><path d="${HAIR_OUTLINE}" stroke-width="1.25"/>${HAIR_PATHS.map((d,i)=>`<path d="${d}" stroke-width="${i%3===0?'.8':'.55'}" opacity="${i%3===0?'.85':'.58'}"/>`).join('')}</g>`;
}
// Eye widths and spacing are drawn together, keeping roughly one eye width
// between the inner corners. Tracked portraits never use these illustrative offsets.
function eyeSVG(cx) {
  return `<g class="portrait-eye">
    <path d="M${cx-24} 172 C${cx-13} 159 ${cx+11} 159 ${cx+24} 172 C${cx+11} 181 ${cx-12} 181 ${cx-24} 172Z"/>
    <path d="M${cx-24} 167 C${cx-10} 154 ${cx+11} 155 ${cx+24} 166" opacity=".45" stroke-width=".75"/>
    <path d="M${cx-19} 183 Q${cx} 189 ${cx+19} 181" opacity=".24" stroke-width=".65"/>
    <circle cx="${cx}" cy="171" r="8" stroke-width=".9"/>
    <circle cx="${cx}" cy="171" r="3.3" fill="currentColor" stroke="none"/>
    <circle cx="${cx+2.5}" cy="168.5" r="1.5" fill="#faf7ef" stroke="none"/>
    <path d="M${cx-20} 168 l-3-3 M${cx-14} 164 l-2-3 M${cx+19} 168 l3-3" opacity=".7" stroke-width=".65"/>
  </g>`;
}
const FACE_STATIC = `
  <path d="M64 151 C56 143 48 148 51 166 C53 183 57 195 65 195 M256 151 C264 143 272 148 269 166 C267 183 263 195 255 195" opacity=".55"/>
  <path d="M59 157 Q53 157 57 172 L62 181 M261 157 Q267 157 263 172 L258 181" opacity=".38"/>
  <g data-feature="brows"><path d="M84 149 C96 139 116 138 133 149 C117 142 98 143 84 149 M236 149 C224 139 204 138 187 149 C203 142 222 143 236 149" fill="currentColor" fill-opacity=".18" stroke-width=".9"/></g>
  <g class="portrait-eyes">${eyeSVG(110)}${eyeSVG(210)}</g>
  <path d="M149 173 C147 189 145 200 140 211 C137 220 143 225 149 223 M171 173 C173 189 175 200 180 211 C183 220 177 225 171 223" opacity=".42" stroke-width="1"/>
  <path d="M143 218 Q149 213 153 222 Q160 228 167 222 Q171 213 177 218 M154 229 Q160 232 166 229" stroke-width="1"/>
  <path d="M155 238 L154 246 M165 238 L166 246" opacity=".3" stroke-width=".75"/>
  <path d="M79 211 Q82 224 92 233 M241 211 Q238 224 228 233" opacity=".2" stroke-width=".65"/>`;
export const NEUTRAL_MOUTH = { x:160,y:260,w:60,h:20,gap:2,jaw:0,cheekL:0,cheekR:0,brow:0 };
export function poseShape(key) {
  const shapes = {
    a:{w:48,h:57,gap:41,jaw:12}, u:{w:29,h:30,gap:12}, e:{w:78,h:18,gap:8},
    left:{x:141,w:29,h:29,gap:10},right:{x:179,w:29,h:29,gap:10},
    up:{y:249,w:30,h:28,gap:10},down:{y:270,w:30,h:29,gap:10},
    smile:{w:75,h:16,gap:1},brow:{brow:-7},cheek:{cheekL:9,cheekR:9,w:43},
    air_left:{cheekL:12,w:39},air_right:{cheekR:12,w:39},draw_in:{cheekL:-9,cheekR:-9,w:40,h:13},hold:{cheekL:-9,cheekR:-9,w:40,h:13},
    tongue_left_up:{cheekL:5},tongue_left_down:{cheekL:5},tongue_right_up:{cheekR:5},tongue_right_down:{cheekR:5},
  };
  return {...NEUTRAL_MOUTH,...shapes[key]};
}
export function mouthPaths(s) {
  const {x,y,w,h,gap}=s, l=x-w/2,r=x+w/2;
  return {
    outer:`M${f(l)} ${f(y)} C${f(x-w*.28)} ${f(y-h*.12)} ${f(x-w*.2)} ${f(y-h*.64)} ${f(x-w*.08)} ${f(y-h*.48)} Q${f(x)} ${f(y-h*.3)} ${f(x+w*.08)} ${f(y-h*.48)} C${f(x+w*.2)} ${f(y-h*.64)} ${f(x+w*.28)} ${f(y-h*.12)} ${f(r)} ${f(y)} C${f(x+w*.27)} ${f(y+h*.63)} ${f(x-w*.27)} ${f(y+h*.63)} ${f(l)} ${f(y)}Z`,
    inner:`M${f(l+3)} ${f(y)} C${f(x-w*.2)} ${f(y-gap*.58)} ${f(x+w*.2)} ${f(y-gap*.58)} ${f(r-3)} ${f(y)} C${f(x+w*.2)} ${f(y+gap*.64)} ${f(x-w*.2)} ${f(y+gap*.64)} ${f(l+3)} ${f(y)}Z`,
    chin:`M143 ${f(294+s.jaw*.6)} Q160 ${f(298+s.jaw*.6)} 177 ${f(294+s.jaw*.6)}`,
    jaw:`M64 149 C62 192 ${f(66-s.cheekL)} 232 91 269 C110 ${f(297+s.jaw)} 141 ${f(319+s.jaw)} 160 ${f(320+s.jaw)} C179 ${f(319+s.jaw)} 210 ${f(297+s.jaw)} 229 269 C${f(254+s.cheekR)} 232 258 192 256 149`,
  };
}
export function portraitSVG(key='neutral', label='Face movement demonstration') {
  const p=mouthPaths(poseShape(key));
  return `<svg class="mouth-diagram line-portrait" viewBox="0 0 320 380" role="img" aria-label="${label}" data-pose="${key}">
    <g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
      ${hairSVG()}<path data-feature="jaw" d="${p.jaw}"/>
      <path d="M108 291 C112 315 110 338 94 356 M212 291 C208 315 210 338 226 356" opacity=".45"/>
      ${FACE_STATIC.replace('data-feature="brows"',`data-feature="brows" transform="translate(0 ${poseShape(key).brow})"`)}
      <path data-feature="outer" d="${p.outer}" fill="#ffc0c0" fill-opacity=".12"/>
      <path data-feature="inner" d="${p.inner}" stroke-width=".85" fill="#613f35" fill-opacity=".07"/>
      <path data-feature="chin" d="${p.chin}" opacity=".28" stroke-width=".75"/>
      <path data-feature="arrow" class="motion-arrow" transform="translate(0 -11)" stroke-width="1.8" d="${arrowPath(key)}"/>
    </g></svg>`;
}
export function arrowPath(key) {
  if(key==='left'||key==='air_left')return 'M116 274 H94 l6-5 m-6 5 6 5';
  if(key==='right'||key==='air_right')return 'M204 274 h22 l-6-5 m6 5-6 5';
  if(key==='up')return 'M191 274 v-20 l-5 6 m5-6 5 6';
  if(key==='down'||key==='a')return 'M197 260 v24 l-5-6 m5 6 5-6';
  if(key==='e'||key==='smile')return 'M115 270 H97 l5-4 m-5 4 5 4 M205 270 h18 l-5-4 m5 4-5 4';
  if(key==='u')return 'M113 272 h22 l-5-4 m5 4-5 4 M207 272 h-22 l5-4 m-5 4 5 4';
  if(key.startsWith('tongue_')) { const x=key.includes('left')?93:227, y=key.endsWith('up')?235:265; return `M${x-5} ${y} a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0`; }
  if(key==='draw_in'||key==='hold')return 'M83 249 h17 l-5-4 m5 4-5 4 M237 249 h-17 l5-4 m-5 4 5 4';
  return '';
}
// Morph only mouth/jaw paths. Eyes, nose and head remain stationary for clear instruction.
export function animatePortrait(svg, keys, { loop=true, reduced=false, onPose, duration=2400 }={}) {
  if(!svg?.querySelector) return {cancel(){},pause(){},resume(){}};
  let raf=0,last=0,elapsed=0,paused=false,cancelled=false,lastKey='';
  const nodes=Object.fromEntries(['outer','inner','jaw','chin','arrow','brows'].map(k=>[k,svg.querySelector(`[data-feature="${k}"]`)]));
  const render=(key,amount)=>{
    const target=poseShape(key), shape={};
    for(const k in NEUTRAL_MOUTH)shape[k]=NEUTRAL_MOUTH[k]+(target[k]-NEUTRAL_MOUTH[k])*amount;
    const paths=mouthPaths(shape);
    for(const k of ['outer','inner','jaw','chin'])nodes[k]?.setAttribute('d',paths[k]);
    nodes.arrow?.setAttribute('d',arrowPath(key));
    nodes.brows?.setAttribute('transform',`translate(0 ${shape.brow})`);
    svg.dataset.pose=key;
    if(lastKey!==key){lastKey=key;onPose?.(key);}
  };
  if(reduced){render(keys[0]||'neutral',1);return {cancel(){},pause(){},resume(){}};}
  const tick=now=>{
    if(cancelled)return;
    if(last&&!paused)elapsed+=Math.min(100,now-last);
    last=now;
    if(!paused){
      const slot=elapsed/duration, index=Math.floor(slot), t=slot-index;
      const key=keys[(loop?index:Math.min(index,keys.length-1))%keys.length]||'neutral';
      // Smooth reach, readable hold, then return to neutral before the next direction.
      const ramp=t<.4?t/.4:t<.73?1:(1-t)/.27;
      const eased=Math.max(0,Math.min(1,ramp));
      render(key,eased*eased*(3-2*eased));
    }
    raf=requestAnimationFrame(tick);
  };
  raf=requestAnimationFrame(tick);
  return {cancel(){cancelled=true;cancelAnimationFrame(raf);},pause(){paused=true;},resume(){paused=false;last=0;}};
}
// Head-local coordinate frame: measurements in source pixels, invariant to viewport aspect.
export function faceFrame(points,w,h) {
  if(!points?.[10]||!points?.[152]||!points?.[33]||!points?.[263])return null;
  const p=i=>({x:points[i].x*w,y:points[i].y*h});
  const a=p(33),b=p(263),top=p(10),chin=p(152);
  const span=Math.hypot(b.x-a.x,b.y-a.y); if(span<5)return null;
  const ex={x:(b.x-a.x)/span,y:(b.y-a.y)/span},ey={x:-ex.y,y:ex.x};
  const height=(chin.x-top.x)*ey.x+(chin.y-top.y)*ey.y;
  if(height<10)return null;
  const width=points[234]&&points[454]?Math.abs((p(454).x-p(234).x)*ex.x+(p(454).y-p(234).y)*ex.y):span*1.5;
  return {top,ex,ey,width:Math.max(span*1.2,width),height};
}
export function portraitTransform(frame,viewW,viewH) {
  const {top,ex,ey,width,height}=frame;
  const cx=top.x+ey.x*height*.44,cy=top.y+ey.y*height*.44;
  const cropW=Math.abs(ex.x)*width*1.48+Math.abs(ey.x)*height*1.5;
  const cropH=Math.abs(ex.y)*width*1.48+Math.abs(ey.y)*height*1.5;
  const scale=Math.min(viewW/cropW,viewH/cropH);
  return {scale,x:viewW/2-cx*scale,y:viewH/2-cy*scale};
}
export function drawTrackedHair(ctx,frame) {
  if(!frame||typeof Path2D==='undefined')return;
  const {top,ex,ey,width,height}=frame, sx=width/198,sy=height/255;
  ctx.save();
  ctx.transform(ex.x*sx,ex.y*sx,ey.x*sy,ey.y*sy,top.x-ex.x*sx*160-ey.x*sy*83,top.y-ex.y*sx*160-ey.y*sy*83);
  ctx.strokeStyle='#805d4c';ctx.lineWidth=1.1;ctx.stroke(new Path2D(HAIR_OUTLINE));
  ctx.globalAlpha=.5;ctx.stroke(new Path2D('M64 151 C57 142 46 146 49 167 C51 184 56 199 65 198 M256 151 C263 142 274 146 271 167 C269 184 264 199 255 198 M106 306 C110 330 109 354 100 363 M214 306 C210 330 211 354 220 363'));
  ctx.lineWidth=.6;ctx.globalAlpha=.65;
  for(const d of HAIR_PATHS)ctx.stroke(new Path2D(d));
  ctx.restore();
}
