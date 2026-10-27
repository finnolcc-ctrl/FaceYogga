import test from 'node:test';
import assert from 'node:assert/strict';
import { measureFace, calibrationIssue, canMatch, evaluatePose, advanceHold, containTransform, medianSample, samplesAreStable } from '../tracking.mjs';
const neutral = { x:.015,y:.44,width:.5,gap:.025,jaw:.02,pucker:.02,smile:.01,yaw:0,pitch:.3,roll:0 };
const pose = overrides => ({...neutral,...overrides});
const profile = {
  neutral,
  a: pose({ jaw:.4,gap:.22 }),
  u: pose({ x:.02,y:.47,width:.33,gap:.045,pucker:.55 }),
  e: pose({ width:.61,gap:.055,smile:.45 }),
};
Object.assign(profile, {
  left: {...profile.u,x:.075}, right: {...profile.u,x:-.02},
  up: {...profile.u,y:.435}, down: {...profile.u,y:.52},
});
const score = (move, phase, f, c=profile) => evaluatePose(move,phase,f,c).precision;
for (const phase of ['left','right']) {
  test(`comfortable ${phase} pucker matches its own asymmetric calibration`, () => {
    assert.equal(score('pucker_side_to_side',phase,profile[phase]),1);
  });
}
test('large pucker and large displacement never collapse to zero', () => {
  assert.equal(score('pucker_side_to_side','left',{...profile.left,x:.25,pucker:.99}),1);
});
test('wrong direction and centered pucker cannot count', () => {
  assert.equal(score('pucker_side_to_side','left',profile.right),0);
  assert.equal(score('pucker_side_to_side','left',profile.u),0);
});
test('lip movement without rounding does not count', () => {
  assert.equal(score('pucker_side_to_side','left',pose({x:.09})),0);
});
test('very small but measurable individual range is usable', () => {
  const small = {...profile,left:{...profile.u,x:profile.u.x+.022}};
  assert.equal(score('pucker_side_to_side','left',small.left,small),1);
});
for (const phase of ['left','up','right','down']) {
  test(`circle ${phase} uses the rounded center, not a guessed mouth height`, () => {
    assert.equal(score('pucker_circles',phase,profile[phase]),1);
    assert.equal(score('pucker_circles',phase,profile.u),0);
  });
}
for (const [move,phase] of [['vowel_a_u','a'],['vowel_a_u','u'],['vowel_e_u','e'],['vowel_e_u','u']]) {
  test(`${move} ${phase} recognizes comfortable pose and rejects neutral`, () => {
    assert.equal(score(move,phase,profile[phase]),1);
    assert.equal(score(move,phase,neutral),0);
  });
}
test('A, E and U are distinct; open jaw is not a U', () => {
  assert.equal(score('vowel_a_u','u',profile.a),0);
  assert.equal(score('vowel_a_u','a',profile.u),0);
  assert.equal(score('vowel_e_u','u',profile.e),0);
  assert.equal(score('vowel_e_u','e',profile.u),0);
});
test('funnel and geometric rounding support U without strong mouthPucker', () => {
  assert.equal(score('vowel_a_u','u',{...profile.u,pucker:0}),1);
});
test('head turning, loss of landmarks and absent calibration cannot earn credit', () => {
  assert.equal(score('pucker_side_to_side','left',{...profile.left,yaw:.2}),0);
  assert.equal(score('vowel_a_u','a',null),0);
  assert.equal(score('vowel_a_u','a',profile.a,null),0);
  assert.equal(canMatch('pucker_side_to_side',{neutral,u:profile.u}),false);
});
test('calibration rejects wrong direction, neutral poses and turned heads', () => {
  for (const key of ['a','u','e','left','right','up','down']) {
    assert.equal(calibrationIssue(key, profile[key],profile),'');
    assert.ok(calibrationIssue(key, neutral,profile));
  }
  assert.ok(calibrationIssue('left',profile.right,profile));
  assert.ok(calibrationIssue('a',{...profile.a,yaw:.3},profile));
  assert.ok(calibrationIssue('neutral',null,{}));
});
test('stable sample capture uses median and rejects movement', () => {
  const stable = Array.from({length:40},()=>({...profile.u}));
  stable[0].x += .5;
  assert.equal(medianSample(stable).x,profile.u.x);
  assert.ok(samplesAreStable(stable));
  assert.equal(samplesAreStable(stable.map((s,i)=>({...s,x:i*.01}))),false);
});
test('continuous one-second hold works across 15, 30 and 60 fps', () => {
  for (const fps of [15,30,60]) {
    let fill=0;
    for(let i=0;i<fps+1;i++) fill=advanceHold(fill,1,1000/fps);
    assert.equal(fill,1);
  }
});
test('wrong poses, camera gaps and pause reset hold immediately', () => {
  assert.equal(advanceHold(.9,0,33),0);
  assert.equal(advanceHold(.9,1,500),0);
  assert.equal(advanceHold(.9,1,33,true),0);
});
function landmarks(w,h,rotation=0,scale=1,dx=0,dy=0) {
  const locations={33:[-100,-50],263:[100,-50],1:[0,0],61:[-45,80],291:[55,80],13:[5,75],14:[5,85]};
  const pts=[];
  for(const [key,[x,y]] of Object.entries(locations)) {
    pts[key]={x:(w/2+dx+scale*(x*Math.cos(rotation)-y*Math.sin(rotation)))/w,
      y:(h/2+dy+scale*(x*Math.sin(rotation)+y*Math.cos(rotation)))/h};
  }
  return pts;
}
test('face measurements are invariant under aspect, translation, scale and head roll', () => {
  const base=measureFace(landmarks(640,480),{},640,480);
  for(const [w,h,r,z,dx,dy] of [[480,640,0,1,0,0],[1280,720,.15,1.5,20,30],[640,480,-.1,.8,-10,20]]) {
    const actual=measureFace(landmarks(w,h,r,z,dx,dy),{},w,h);
    for(const key of ['x','y','width','gap','yaw','pitch']) assert.ok(Math.abs(base[key]-actual[key])<1e-9, key);
  }
});
test('portrait and landscape canvases preserve one scale on both axes', () => {
  for(const [sw,sh,vw,vh] of [[640,480,320,600],[480,640,400,250],[1280,720,390,844]]) {
    const t=containTransform(sw,sh,vw,vh);
    assert.ok(sw*t.scale<=vw+.001 && sh*t.scale<=vh+.001);
    assert.equal((sw*t.scale)/(sh*t.scale),sw/sh);
  }
});
