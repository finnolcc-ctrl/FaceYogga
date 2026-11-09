import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as tracking from '../tracking.mjs';
import * as guidance from '../guidance.mjs';
import * as portrait from '../portrait.mjs';
import * as experience from '../experience.mjs';
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
  const storage=new Map();
  const elements=new Map();
  const transforms=[];
  const ctx=new Proxy({}, {get:(_,key)=>key==='setTransform'? (...args)=>transforms.push(args) : key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}});
  function element(id) {
    if(!elements.has(id)) elements.set(id,{hidden:true,style:{setProperty(){}},dataset:{},textContent:'',innerHTML:'',value:0,
      clientWidth:360,clientHeight:260,width:0,height:0,videoWidth:640,videoHeight:480,currentTime:1,readyState:4,
      classList:{add(){},remove(){},toggle(){}},setAttribute(){},appendChild(){},remove(){},getContext:()=>ctx,
      querySelectorAll:()=>[],querySelector:()=>element('button'),play:()=>Promise.resolve(),pause(){}});
    return elements.get(id);
  }
  const document={hidden:false,getElementById:element,querySelector:element,querySelectorAll:()=>[],
    createElement:element,body:element('body'),documentElement:element('root'),addEventListener(){}};
  const sandbox={...tracking,...guidance,...portrait,...experience,animatePortrait:()=>({cancel(){},pause(){},resume(){}}),console,URLSearchParams,document,location:{search:'?test=1',pathname:'/'},
    window:{__faceYogaTest:true,devicePixelRatio:2,scrollTo(){}},navigator:{},performance:{now:()=>time},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
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
  return {FY,element,tick,transforms,storage,elapse(ms){const end=time+ms;let loops=0;while(loops++<1000){const next=[...timers].filter(([id,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=end;},calibTick(f,ms=50){time+=ms;frame=f;element('calibVideo').currentTime+=ms/1000;const cb=raf;raf=null;cb?.();}};
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

test('first demo waits for readiness; the separate countdown pauses and enters once',()=>{
 const {FY,elapse,element}=boot();FY.State.mode='guided';FY.runDemo(routine.moves[0]);
 elapse(30000);assert.equal(element('demoCountdown').hidden,true);assert.equal(FY.State.active,null);
 FY.beginCountdown(routine.moves[0]);assert.equal(element('demoCountdown').hidden,false);
 elapse(1200);FY.pauseExercise(true);elapse(10000);
 assert.equal(FY.State.intro,true);assert.equal(FY.State.active,null);
 FY.resumeExercise();elapse(1799);assert.equal(FY.State.intro,true);
 elapse(1);assert.equal(FY.State.intro,false);assert.equal(element('demoCountdown').hidden,true);
 elapse(520);assert.equal(FY.State.active.phase,'left');
});
test('skip cancels the pending intro and cannot start the skipped movement',()=>{
 const {FY,elapse}=boot();FY.State.mode='guided';FY.runDemo(routine.moves[0]);
 FY.beginCountdown(routine.moves[0]);elapse(500);FY.handleSelfResult('skipped');elapse(1000);
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

test('quick practice completes one move and keeps its round count separate from full practice',()=>{
 const {FY,element,elapse}=boot();FY.startSession('guided',true);
 assert.equal(FY.State.session.moves.length,1);assert.equal(element('moveTotal').textContent,1);
 const move=FY.State.watchMove;FY.beginCountdown(move);elapse(3520);
 assert.equal(element('practiceHeading').textContent,move.title.en);assert.equal(element('roundProgress').textContent,'Round 1 of 5');
 elapse(4000);assert.equal(element('roundProgress').textContent,'Round 2 of 5');
 elapse(16000);assert.equal(element('selfcheck').hidden,false);
 FY.handleSelfResult('completed');assert.equal(FY.State.session,null);
 FY.startSession('guided');assert.equal(FY.State.session.moves.length,7);assert.equal(element('moveTotal').textContent,7);
});
test('later moves show a full demo before their automatic countdown',()=>{
 const {FY,elapse,element}=boot();FY.State.session.moveIndex=1;FY.runDemo(routine.moves[1]);
 elapse(routine.defaults.demoMs-1);assert.equal(element('demoCountdown').hidden,true);
 elapse(1);assert.equal(element('demoCountdown').hidden,false);assert.equal(FY.State.active,null);
 elapse(3520);assert.equal(element('roundProgress').textContent,'Round 1 of 4');
});

test('quick camera calibrates just A and U against neutral, then counts two confirmed pairs',()=>{
  const {FY,element,calibTick,elapse,tick}=boot();
  FY.State.quickCamera=true;
  FY.beginCalibration();
  for (const [index,key] of ['neutral','a','u'].entries()) {
    assert.match(element('calibStep').textContent,new RegExp((index+1)+' / 3'));
    for(let i=0;i<100 && FY.State.calibrationRun?.index===index;i++) calibTick(profile[key]);
  }
  assert.deepEqual(Object.keys(FY.State.calibration),['neutral','a','u']);
  assert.equal(FY.State.session.moves.length,1);
  assert.equal(FY.State.watchMove.id,'vowel_a_u');
  FY.beginCountdown(FY.State.watchMove); elapse(3520);
  const gate=FY.State.phaseGate;
  const hold=(pose,frames)=>{for(let i=0;i<frames;i++) tick(pose);};
  hold(profile.neutral,5);
  assert.equal(gate.cue,'lower-jaw');
  hold(profile.a,21);
  assert.equal(FY.State.active.phase,'u');
  hold(profile.a,5);
  assert.equal(gate.cue,'lift-jaw');
  hold(profile.neutral,1);
  assert.equal(gate.cue,'lift-jaw'); // a single borderline frame cannot swap arrows
  hold(profile.neutral,4);
  assert.equal(gate.cue,'round-lips');
  hold(profile.u,8);
  assert.equal(gate.cue,'hold');
  tick(null);
  assert.equal(gate.fill,0); assert.equal(gate.cue,null);
  hold(profile.u,20);
  assert.equal(gate.reps,1); assert.ok(FY.State.lipRippleAt>0);
  hold(profile.a,20);hold(profile.u,20);
  elapse(1800);
  assert.equal(element('quickResult').textContent,'A to U · 2 rounds · Camera confirmed');
  assert.equal(FY.State.session,null);
});

test('line portrait points toward the mirrored target and follows corrections from the camera',()=>{
  const {FY,tick,element}=boot();
  const pts=detection(profile.neutral).faceLandmarks[0];
  pts[10]={x:.5,y:.23}; pts[152]={x:.5,y:.88};
  const angles=[];
  const ctx=new Proxy({createRadialGradient:()=>({addColorStop(){}}),rotate:angle=>angles.push(angle)}, {get:(obj,key)=>obj[key] || (()=>{})});
  const canvas=element('exerciseMesh'); canvas.getContext=()=>ctx;
  function arrows(){
    angles.length=0; FY.drawMesh(canvas,element('exerciseVideo'),[pts],true);
    return [...angles];
  }
  FY.runActive(routine.moves[0]);
  for(let i=0;i<6;i++)tick(profile.neutral);
  assert.deepEqual(arrows(),[0,Math.PI]); // both corners inward
  for(let i=0;i<6;i++)tick(profile.u);
  assert.deepEqual(arrows(),[0]); // source +x is left in the mirror
  for(let i=0;i<21;i++)tick(profile.left);
  for(let i=0;i<12;i++)tick(profile.u);
  assert.deepEqual(arrows(),[Math.PI]);
  FY.clearPhaseTimers();
  FY.runActive(routine.moves[3]);
  for(let i=0;i<6;i++)tick(profile.neutral);
  assert.deepEqual(arrows(),[Math.PI,0]); // E widens both corners
  for(let i=0;i<6;i++)tick(profile.a);
  assert.deepEqual(arrows(),[-Math.PI/2]); // close an overly open jaw first
});

test('portrait adjustments are bounded independently of mouth movement',()=>{
  const poses=[profile.a,profile.u,profile.left].map(f=>{
    const pts=detection(f).faceLandmarks[0];
    pts[10].y=.22;pts[152].y=.90;
    const original=structuredClone(pts);
    const frame=portrait.faceFrame(pts,640,480);
    const p=portrait.trackedSketch(pts,frame,640,480,f,profile);
    assert.deepEqual(pts,original);
    assert.ok(Math.abs(p.faceWidth-1)<=.0351 && Math.abs(p.eyeX)<=6 && Math.abs(p.noseX)<=5);
    return p;
  });
  const [a,u,left]=poses;
  assert.ok(a.gap>u.gap+20 && u.round>a.round);
  assert.ok(left.lipX>u.lipX+10);
  assert.equal(a.eyeY,u.eyeY);
});

test('timed cheek guidance follows every scheduled phase and ends with self confirmation',()=>{
  const {FY,element,elapse}=boot();
  for(const move of routine.moves.slice(4)){
    FY.clearPhaseTimers(); FY.runActive(move);
    for(let i=0;i<move.repeat;i++) for(const p of move.phaseSchedule){
      assert.equal(FY.State.active.guideCue,guidance.guideKey(move.id,p.phase));
      assert.equal(FY.State.phaseGate,null); assert.equal(FY.State.lipRippleAt,null);
      elapse(p.durationMs);
    }
    if(move.afterRepeats){
      assert.equal(FY.State.active.guideCue,'hold');elapse(move.afterRepeats[0].durationMs);
    }
    assert.equal(FY.State.active,null);assert.equal(element('selfcheck').hidden,false);
  }
});


test('selected three-move practice saves its plan and reports the correct movement definitions',()=>{
  const {FY,element,storage}=boot();
  FY.State.selectedPlan='quick';
  FY.startSession('guided');
  assert.deepEqual(Array.from(FY.State.session.moves,m=>m.id),['vowel_a_u','air_side_to_side','cheek_draw_in']);
  assert.equal(element('moveTotal').textContent,3);
  FY.State.session.moves.forEach(m=>{m.status='completed';m.userConfirmed=true;});
  FY.finishSession();
  const saved=JSON.parse(storage.get('faceyoga.v2'));
  assert.equal(saved.sessions.length,1);assert.equal(saved.sessions[0].planId,'quick');
  assert.equal(saved.streak,1);assert.equal(element('reportCompleted').textContent,3);
  assert.match(element('li').innerHTML,/Draw in, release, then hold/);
  assert.match(element('li').innerHTML,/Self-confirmed/);
});
test('ending a selected practice before any completion does not award a streak',()=>{
  const {FY,storage}=boot();FY.State.selectedPlan='classic';FY.startSession('guided');FY.finishSession(true);
  const saved=JSON.parse(storage.get('faceyoga.v2'));
  assert.equal(saved.sessions[0].moves.length,5);assert.equal(saved.sessions[0].partial,true);
  assert.ok(saved.sessions[0].moves.every(m=>m.status==='skipped'));assert.equal(saved.streak,undefined);
});
