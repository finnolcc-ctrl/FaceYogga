import test from 'node:test';
import assert from 'node:assert/strict';
import { mirrorFeedbackGeometry, traceMirrorLipHold, OUTER_LIP } from '../mirror-feedback.mjs';

function landmarks() {
  const points=Array.from({length:478},()=>({x:.5,y:.5}));
  for(const [i,x,y] of [[33,.35,.35],[263,.65,.35],[13,.5,.59],[14,.5,.61],[152,.5,.85],[205,.3,.6],[425,.7,.6]]) points[i]={x,y};
  OUTER_LIP.slice(0,-1).forEach((id,i)=>{
    const angle=Math.PI+i*Math.PI*2/(OUTER_LIP.length-1);
    points[id]={x:.5+Math.cos(angle)*.1,y:.6+Math.sin(angle)*.04};
  });
  return points;
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);

test('landscape video maps through cover crop and exactly one CSS horizontal mirror',()=>{
  const p=landmarks(),g=mirrorFeedbackGeometry(p,640,480,200,250);
  near(g.mouth.x,100);near(g.mouth.y,150);
  near(g.anchors[61][0],(640*.4)*(250/480)+(200-640*(250/480))*.5);
  assert.ok(200-g.anchors[291][0]<200-g.anchors[61][0],'source-right appears on screen-left');
});
test('portrait video applies the same 42 percent vertical object-position as the video',()=>{
  const g=mirrorFeedbackGeometry(landmarks(),480,640,240,240);
  near(g.mouth.x,120);near(g.mouth.y,640*.6*.5+(240-640*.5)*.42);
});
test('mirror anchors follow translation, resize and head roll instead of portrait proportions',()=>{
  const p=landmarks(),g=mirrorFeedbackGeometry(p,640,480,200,250);
  const moved=p.map(q=>({x:q.x+.03,y:q.y+.02}));
  const m=mirrorFeedbackGeometry(moved,640,480,200,250);
  near(m.mouth.x-g.mouth.x,.03*640*250/480);
  near(m.mouth.y-g.mouth.y,.02*250);
  const large=mirrorFeedbackGeometry(p,640,480,400,500);
  near(large.mouth.x,g.mouth.x*2);near(large.anchors[152][1],g.anchors[152][1]*2);
  const angle=.2,rotated=p.map(q=>{
    const x=(q.x-.5)*640,y=(q.y-.35)*480;
    return {x:.5+(x*Math.cos(angle)-y*Math.sin(angle))/640,y:.35+(x*Math.sin(angle)+y*Math.cos(angle))/480};
  });
  const r=mirrorFeedbackGeometry(rotated,640,480,200,250);
  near(r.roll,angle);near(r.mouth.width,g.mouth.width);
});
test('invalid or absent face and zero-size video do not produce overlays',()=>{
  assert.equal(mirrorFeedbackGeometry(null,640,480,200,250),null);
  assert.equal(mirrorFeedbackGeometry(landmarks(),0,480,200,250),null);
  const p=landmarks();p[61].x=NaN;
  assert.equal(mirrorFeedbackGeometry(p,640,480,200,250),null);
});
test('hold contour advances by measured path length and closes only at a full hold',()=>{
  const path=[[0,0],[20,0],[20,10],[0,10],[0,0]],lines=[];
  const ctx={beginPath(){},moveTo(){},lineTo:(...p)=>lines.push(p),stroke(){}};
  traceMirrorLipHold(ctx,path,.5);assert.deepEqual(lines.at(-1),[20,10]);
  lines.length=0;traceMirrorLipHold(ctx,path,1);assert.deepEqual(lines.at(-1),[0,0]);
  lines.length=0;traceMirrorLipHold(ctx,path,0);assert.equal(lines.length,0);
});
