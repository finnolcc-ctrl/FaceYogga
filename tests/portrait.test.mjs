import test from 'node:test';
import assert from 'node:assert/strict';
import { poseShape, faceFrame, portraitTransform, HAIR_PATHS, portraitSVG } from '../portrait.mjs';
test('guide moves the lips toward the displayed direction with distinct A/E/U shapes',()=>{
 assert.ok(poseShape('left').x<poseShape('u').x);assert.ok(poseShape('right').x>poseShape('u').x);
 assert.ok(poseShape('a').gap>poseShape('u').gap);assert.ok(poseShape('e').w>poseShape('a').w);
 assert.equal(HAIR_PATHS.length,40);assert.match(portraitSVG('u'),/portrait-hair/);
});
test('head frame and portrait crop use source pixels and preserve aspect',()=>{
 const pts=Array.from({length:478},()=>({x:.5,y:.5}));
 for(const [i,x,y] of [[10,320,100],[152,320,400],[33,240,200],[263,400,200],[234,200,240],[454,440,240]])pts[i]={x:x/640,y:y/480};
 const f=faceFrame(pts,640,480);assert.equal(f.width,240);assert.equal(f.height,300);
 for(const [w,h] of [[320,400],[800,300]]){const t=portraitTransform(f,w,h);assert.ok(t.scale>0);assert.ok(f.height*1.5*t.scale<=h+.001);assert.ok(f.width*1.48*t.scale<=w+.001);}
 assert.equal(faceFrame([],640,480),null);
});
