import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as tracking from '../tracking.mjs';
import * as guidance from '../guidance.mjs';
import * as portrait from '../portrait.mjs';
const source = readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g,'');
const routine = JSON.parse(readFileSync(new URL('../routine.v2.json',import.meta.url)));
const n={x:.015,y:.44,width:.5,gap:.025,jaw:.02,pucker:.02,smile:.01,yaw:0,pitch:.3,roll:0};
const u={...n,x:.02,y:.47,width:.33,gap:.045,pucker:.55};
const profile={neutral:n,a:{...n,jaw:.4,gap:.22},u,e:{...n,width:.61,gap:.055,smile:.45},
  left:{...u,x:.075},right:{...u,x:-.02},up:{...u,y:.435},down:{...u,y:.52}};
function detection(f) {
  if(!f) return {faceLandmarks:[],faceBlendshapes:[]};
  const pts=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
  const place=(i,x,y)=>pts[i]={x:x/640,y:y/480,z:0};
  place(33,220,180);place(263,420,180);place(1,320,240);
  const x=320+f.x*200, y=240+f.y*200;
  place(61,x-f.width*100,y);place(291,x+f.width*100,y);
  place(13,x,y-f.gap*100);place(14,x,y+f.gap*100);
  const categories=Object.entries({jawOpen:f.jaw,mouthPucker:f.pucker,mouthSmileLeft:f.smile,mouthSmileRight:f.smile}).map(([categoryName,score])=>({categoryName,score}));
  return {faceLandmarks:[pts],faceBlendshapes:[{categories}]};
}
function boot() {
  let time=1000,raf=null,frame=profile.neutral,nextTimer=1;
  const timers=new Map();
  const elements=new Map();
  const transforms=[];
  const ctx=new Proxy({}, {get:(_,key)=>key==='setTransform'? (...args)=>transforms.push(args) : key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}});
  function element(id) {
    if(!elements.has(id)) elements.set(id,{hidden:true,style:{},dataset:{},textContent:'',innerHTML:'',value:0,
      clientWidth:360,clientHeight:260,width:0,height:0,videoWidth:640,videoHeight:480,currentTime:1,readyState:4,
      classList:{add(){},remove(){},toggle(){}},setAttribute(){},appendChild(){},remove(){},getContext:()=>ctx,
      querySelectorAll:()=>[],querySelector:()=>element('button'),play:()=>Promise.resolve(),pause(){}});
    return elements.get(id);
  }
  const document={hidden:false,getElementById:element,querySelector:element,querySelectorAll:()=>[],
    createElement:element,body:element('body'),documentElement:element('root'),addEventListener(){}};
  const sandbox={...tracking,...guidance,...portrait,animatePortrait:()=>({cancel(){},pause(){},resume(){}}),console,URLSearchParams,document,location:{search:'?test=1',pathname:'/'},
    window:{__faceYogaTest:true,devicePixelRatio:2,scrollTo(){}},navigator:{},performance:{now:()=>time},
    setTimeout:(fn,ms)=>{const id=nextTimer++;timers.set(id,{fn,at:time+ms});return id;},setInterval:()=>1,clearTimeout:id=>timers.delete(id),clearInterval(){},
    requestAnimationFrame:fn=>{raf=fn;return 2;},cancelAnimationFrame:()=>{raf=null;},
    fetch:async()=>({json:async()=>structuredClone(routine)})};
  vm.runInNewContext(source,sandbox);
  const FY=sandbox.window.FaceYoga;
  FY.State.routine=structuredClone(routine);
  FY.State.calibration=structuredClone(profile);
  FY.State.mode='camera_assisted_candidate';
  FY.State.session={moveIndex:0,moves:routine.moves.map(m=>({id:m.id,status:'not_started'}))};
  FY.State.landmarker={detectForVideo:()=>detection(frame)};
  function tick(f,ms=50) {
    time+=ms;
    FY.State.blendshapes={};
    const result=detection(f);
    // Supply already stabilized model scores for deterministic gate timing.
    FY.recordTrackingFrame(result,element('exerciseVideo'));
    if(f) Object.assign(FY.State.blendshapes,{jawOpen:f.jaw,mouthPucker:f.pucker,mouthSmileLeft:f.smile,mouthSmileRight:f.smile});
    FY.advanceGate();
  }
  return {FY,element,tick,transforms,elapse(ms){const end=time+ms;let loops=0;while(loops++<1000){const next=[...timers].filter(([id,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=end;},calibTick(f,ms=50){time+=ms;frame=f;element('calibVideo').currentTime+=ms/1000;const cb=raf;raf=null;cb?.();}};
}
test('a full left/right cycle requires both sides; all four cycles complete',()=>{
  const {FY,tick}=boot();FY.runActive(routine.moves[0]);
  for(let i=0;i<21;i++)tick(profile.left);
  assert.equal(FY.State.active.phase,'right');assert.equal(FY.State.phaseGate.reps,0);
  for(let i=0;i<21;i++)tick(profile.right);
  assert.equal(FY.State.phaseGate.reps,1);
  for(let cycle=1;cycle<4;cycle++)for(const key of ['left','right'])for(let i=0;i<21;i++)tick(profile[key]);
  assert.equal(FY.State.phaseGate,null);assert.equal(FY.State.session.moves[0].status,'completed');
  assert.equal(FY.State.session.moves[0].cameraConfirmed,true);
});
test('circle completes all four directions, then reverses after two cycles',()=>{
  const {FY,tick}=boot();FY.State.session.moveIndex=1;FY.runActive(routine.moves[1]);
  for(const expected of ['left','up','right','down','left','up','right','down','left','down','right','up','left','down','right','up']){
    assert.equal(FY.State.active.phase,expected);
    for(let i=0;i<21;i++)tick(profile[expected]);
  }
  assert.equal(FY.State.session.moves[1].status,'completed');
});
test('lost face clears hold and stale blendshapes; pause cannot finish a phase',()=>{
  const {FY,tick}=boot();FY.runActive(routine.moves[0]);
  for(let i=0;i<12;i++)tick(profile.left);
  assert.ok(FY.State.phaseGate.fill>.5);
  tick(null);assert.equal(FY.State.phaseGate.fill,0);assert.equal(Object.keys(FY.State.blendshapes).length,0);
  FY.State.paused=true;const elapsed=FY.State.phaseGate.elapsedMs;
  for(let i=0;i<100;i++)tick(profile.left);
  assert.equal(FY.State.phaseGate.elapsedMs,elapsed);assert.equal(FY.State.active.phase,'left');
});
test('timeout asks for confirmation without marking a move completed',()=>{
  const {FY,tick,element}=boot();FY.runActive(routine.moves[0]);FY.State.phaseGate.maxMs=500;
  for(let i=0;i<12;i++)tick(profile.neutral);
  assert.equal(FY.State.phaseGate,null);assert.equal(element('selfcheck').hidden,false);
  assert.equal(FY.State.session.moves[0].status,'not_started');
});
test('skipped calibration uses paced guidance',()=>{
  const {FY}=boot();FY.State.calibration=null;FY.runActive(routine.moves[0]);
  assert.equal(FY.State.phaseGate,null);assert.equal(FY.State.active.phase,'left');
});
test('calibration waits for valid frames and records all eight real pose samples',()=>{
  const {FY,calibTick,element}=boot();FY.beginCalibration();
  for(let i=0;i<70;i++)calibTick(null);
  assert.equal(FY.State.calibrationRun.index,0);assert.equal(FY.State.calibration,null);
  assert.equal(element('calibProgress').value,0);
  for(const key of guidance.CALIBRATION_STEPS){
    let count=0;
    while(FY.State.calibrationRun && guidance.CALIBRATION_STEPS[FY.State.calibrationRun.index]===key && count++<100)calibTick(profile[key]);
    assert.ok(count<100,`calibration stuck at ${key}`);
  }
  assert.equal(FY.State.calibrationRun,null);
  assert.equal(Object.keys(FY.State.calibration).length,8);
  assert.ok(Math.abs(FY.State.calibration.left.x-profile.left.x)<.001);
});

for(const [index,phases] of [[2,['a','u']],[3,['e','u']]]) {
  test(`vowel move ${index+1} advances through four complete alternations`,()=>{
    const {FY,tick}=boot();FY.State.session.moveIndex=index;FY.runActive(routine.moves[index]);
    for(let c=0;c<4;c++)for(const phase of phases) {
      assert.equal(FY.State.active.phase,phase);
      for(let i=0;i<21;i++)tick(profile[phase]);
    }
    assert.equal(FY.State.session.moves[index].status,'completed');
  });
}
test('actual mesh renderer resizes to viewport and applies a uniform pixel scale',()=>{
  const {FY,element,transforms}=boot();
  const canvas=element('exerciseMesh');
  for(const [w,h] of [[320,260],[390,300],[250,500]]) {
    canvas.clientWidth=w;canvas.clientHeight=h;
    FY.drawMesh(canvas,{videoWidth:640,videoHeight:480},detection(profile.neutral).faceLandmarks);
    assert.equal(canvas.width,w*2);assert.equal(canvas.height,h*2);
    const [sx,, ,sy]=transforms.at(-1);
    assert.equal(sx,sy);
  }
});

test('three second demo pauses in place, then enters the actual movement once',()=>{
 const {FY,elapse,element}=boot();FY.State.mode='guided';FY.runDemo(routine.moves[0]);
 elapse(1200);FY.pauseExercise(true);elapse(10000);
 assert.equal(FY.State.intro,true);assert.equal(FY.State.active,null);
 FY.resumeExercise();elapse(1799);assert.equal(FY.State.intro,true);
 elapse(1);assert.equal(FY.State.intro,false);assert.equal(element('demoCountdown').hidden,true);
 elapse(520);assert.equal(FY.State.active.phase,'left');
});
test('skip cancels the pending intro and cannot start the skipped movement',()=>{
 const {FY,elapse}=boot();FY.State.mode='guided';FY.runDemo(routine.moves[0]);
 elapse(500);FY.handleSelfResult('skipped');elapse(1000);
 assert.equal(FY.State.active,null);assert.equal(FY.State.session.moves[0].status,'skipped');
 assert.equal(FY.State.scheduled.intro,undefined);
});
test('paced phase retains its remaining duration when paused',()=>{
 const {FY,elapse}=boot();FY.State.mode='guided';FY.runActive(routine.moves[0]);
 const duration=routine.moves[0].phaseSchedule[0].durationMs;
 elapse(duration-200);FY.pauseExercise(true);elapse(10000);assert.equal(FY.State.active.phase,'left');
 FY.resumeExercise();elapse(199);assert.equal(FY.State.active.phase,'left');elapse(1);assert.equal(FY.State.active.phase,'right');
});

test('mirror switches immediately without changing movement or hold progress',()=>{
 const {FY}=boot();FY.runActive(routine.moves[0]);
 const active=FY.State.active,gate=FY.State.phaseGate;
 gate.fill=.4;
 FY.setFaceView('camera');assert.equal(FY.State.faceView,'camera');
 FY.setFaceView('line');assert.equal(FY.State.faceView,'line');
 assert.equal(FY.State.active,active);assert.equal(FY.State.phaseGate,gate);assert.equal(gate.fill,.4);
});
test('guided mode does not enable a camera mirror',()=>{
 const {FY}=boot();FY.State.mode='guided';FY.setFaceView('camera');assert.equal(FY.State.faceView,'line');
});
