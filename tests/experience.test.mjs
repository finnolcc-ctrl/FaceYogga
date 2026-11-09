import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {practiceMoves,recommendPractice,practiceStats,mockFormReview,sampleSession,createExperience} from '../experience.mjs';
const routine=JSON.parse(readFileSync(new URL('../routine.v2.json',import.meta.url)));
test('all plan selections contain real moves in intended order without changing the registry',()=>{
  const before=JSON.stringify(routine);
  assert.deepEqual(practiceMoves(routine,'quick').map(m=>m.id),['vowel_a_u','air_side_to_side','cheek_draw_in']);
  assert.equal(practiceMoves(routine,'classic').length,5);
  assert.equal(practiceMoves(routine,'full').length,7);
  assert.equal(practiceMoves(routine,'invalid').length,7);
  assert.equal(JSON.stringify(routine),before);
});
test('recommendation uses time and latest unfinished movement, without touching calibration',()=>{
  const sessions=[{moves:[{id:'vowel_e_u',status:'partial'}]}];
  const before=JSON.stringify(sessions);
  const result=recommendPractice({minutes:2,experience:'new',focus:'control'},sessions);
  assert.equal(result.plan,'quick'); assert.equal(result.revisitId,'vowel_e_u');
  assert.equal(result.range,85); assert.equal(JSON.stringify(sessions),before);
  assert.equal(recommendPractice({minutes:3}).plan,'classic');
  assert.equal(recommendPractice({minutes:4}).plan,'full');
});
test('progress excludes all-skipped attempts and counts distinct active dates in a rolling week',()=>{
  const sessions=[{date:'2026-11-04',moves:[{status:'completed'},{status:'skipped'}]},
    {date:'2026-11-04',moves:[{status:'completed'}]},
    {date:'2026-11-03',moves:[{status:'skipped'}]},
    {date:'2026-10-01',moves:[{status:'completed'}]}];
  const stats=practiceStats(sessions,new Date(2026,10,4));
  assert.equal(stats.sessions,3);assert.equal(stats.moves,3);
  assert.equal(stats.week.filter(d=>d.active).length,1);
  assert.equal(stats.week.at(-1).date,'2026-11-04');
});
test('mock analysis is explicit, repeatable, non-mutating, and excludes unperformed moves',()=>{
  const session=sampleSession(routine), before=JSON.stringify(session);
  assert.equal(session.example,true);
  const review=mockFormReview(session);
  assert.equal(review.source,'mock');assert.equal(review.moves.length,5);
  assert.deepEqual(mockFormReview(session),review);
  assert.equal(JSON.stringify(session),before);
  assert.equal(mockFormReview({moves:[{id:'vowel_a_u',status:'skipped'}]}),null);
});
test('example report and coaching navigation never save example data; history returns to progress',()=>{
  const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,value:'',textContent:'',innerHTML:''});return elements.get(id);};
  const original=globalThis.document;globalThis.document={getElementById:element};
  try {
    let writes=0,screen='',report;const Actions={goHome:()=>{screen='home';}};
    const store={sessions:[]}; const State={routine};
    const experience=createExperience({State,Actions,show:s=>{screen=s;},loadStore:()=>store,saveStore:()=>{writes++;},renderHome(){},renderPreviewList(){},renderReport:s=>{report=s;},portraitSVG:()=>'<svg></svg>'});
    Actions.viewSample();assert.equal(screen,'report');assert.equal(report.example,true);
    experience.renderReportExtras(report);assert.equal(element('reportStreakCard').hidden,true);
    Actions.openQuality();assert.equal(screen,'quality');
    Actions.qualityBack();assert.equal(screen,'report');assert.equal(report.example,true);
    Actions.reportBack();assert.equal(screen,'progress');
    assert.equal(writes,0);assert.equal(store.sessions.length,0);
    assert.equal(element('progressSessions').textContent,0);
    Actions.openPlan();assert.equal(screen,'personalPlan');assert.equal(State.selectedPlan,'full');
    element('planChoices').onchange({target:{value:'quick'}});
    assert.equal(element('planMovesTitle').textContent,'View 3 moves');
    Actions.toCameraChoice=()=>{screen='cameraChoice';};
    Actions.continuePlan();assert.equal(State.selectedPlan,'quick');assert.equal(screen,'cameraChoice');
    Actions.returnToPlan();assert.equal(State.selectedPlan,'quick');assert.equal(screen,'personalPlan');
  } finally {globalThis.document=original;}
});
