// Prototype-only coaching content. It never writes tracking thresholds or scores.
export const PLANS = {
  quick: { title: 'Quick break', minutes: 2, ids: ['vowel_a_u', 'air_side_to_side', 'cheek_draw_in'] },
  classic: { title: 'Daily balance', minutes: 3, ids: ['pucker_side_to_side', 'vowel_a_u', 'vowel_e_u', 'air_side_to_side', 'cheek_draw_in'] },
  full: { title: 'Full practice', minutes: 4, ids: null },
};
export function practiceMoves(routine, plan = 'full') {
  const ids = PLANS[plan]?.ids;
  return ids ? ids.map(id => routine.moves.find(m => m.id === id)).filter(Boolean) : routine.moves;
}
export function recommendPractice(preferences = {}, sessions = []) {
  const minutes = Number(preferences.minutes) || 4;
  const plan = minutes <= 2 ? 'quick' : minutes <= 3 ? 'classic' : 'full';
  const latest = sessions.at(-1);
  const revisit = latest?.moves?.find(m => m.status === 'partial' || m.status === 'skipped');
  return {
    plan,
    reason: `${minutes}-minute preference · ${preferences.experience === 'regular' ? 'Regular practice' : 'Gentle start'}`,
    focus: preferences.focus === 'control' ? 'Slow, distinct transitions' : preferences.focus === 'consistency' ? 'A repeatable daily rhythm' : 'A relaxed jaw and soft lips',
    revisitId: revisit?.id || null,
    range: preferences.experience === 'regular' ? 95 : 85,
  };
}
export function practiceStats(sessions = [], now = new Date()) {
  const practiced = sessions.filter(s => s.moves?.some(m => m.status === 'completed'));
  const localDay = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const dates = new Set(practiced.map(s => s.date));
  const week = Array.from({length:7}, (_, i) => {
    const day = new Date(now); day.setDate(day.getDate() - 6 + i);
    return {label: day.toLocaleDateString('en-US', {weekday:'narrow'}), date: localDay(day), active: dates.has(localDay(day))};
  });
  return { sessions: practiced.length, moves: practiced.reduce((sum,s) => sum+s.moves.filter(m=>m.status==='completed').length,0), week };
}
export function sampleSession(routine) {
  return { example: true, planId:'classic', date: '2026-11-04', mode:'camera_assisted_candidate', partial:false,
    startedAt:'2026-11-04T12:00:00', endedAt:'2026-11-04T12:03:00',
    moves: practiceMoves(routine,'classic').map((m,i)=>({id:m.id,status:i===4?'partial':'completed',cameraConfirmed:i<3,userConfirmed:i===3,activeElapsedMs:m.activeMs,...(i<3?{repPetals:i===1?[3,3,3,2]:[2,2,3,2]}:{})})) };
}
export function mockFormReview(session) {
  // Authored scenarios, not inferred measurements. No results for unperformed moves.
  const practiced = session.moves.filter(m => m.status === 'completed' || m.status === 'partial');
  if (!practiced.length) return null;
  return {
    source: 'mock',
    moves: practiced.map(move => ({
      id: move.id,
      metrics: [
        { label: 'Balance', value: 86 },
        { label: 'Isolation', value: 78 },
        { label: 'Control', value: 90 },
      ],
    })),
  };
}

function qualityRadar(metrics) {
  const center = { x: 160, y: 161 };
  const axes = [{ x: 0, y: -1 }, { x: .866, y: .5 }, { x: -.866, y: .5 }];
  const point = (index, value) => ({
    x: center.x + axes[index].x * value * 1.12,
    y: center.y + axes[index].y * value * 1.12,
  });
  // Curve through the measured points so each axis still meets its score.
  function contour(points) {
    const segments = points.map((p, i) => {
      const next = points[(i + 1) % 3];
      const previous = points[(i + 2) % 3];
      const bend = .14;
      return `C ${p.x + (next.x - previous.x) * bend} ${p.y + (next.y - previous.y) * bend},
        ${next.x - (previous.x - p.x) * bend} ${next.y - (previous.y - p.y) * bend}, ${next.x} ${next.y}`;
    });
    return `M ${points[0].x} ${points[0].y} ${segments.join(' ')} Z`;
  }
  const grid = [50, 75, 100].map(level =>
    `<path d="${contour(axes.map((_, i) => point(i, level)))}"/>`).join('');
  const vertices = metrics.map((m, i) => point(i, m.value));
  const labels = [{x:160,y:17}, {x:261,y:246}, {x:59,y:246}];
  const dots = ['#93985d', '#ca9681', '#c8a468'];
  const mean = Math.round(metrics.reduce((sum, m) => sum + m.value, 0) / metrics.length);
  return `<svg viewBox="0 0 320 277" role="img" aria-label="Average ${mean} out of 100. ${metrics.map(m => m.label + ' ' + m.value).join(', ')}">
    <defs>
      <linearGradient id="qualityWash" x1="16%" y1="0%" x2="84%" y2="100%"><stop stop-color="#a9b177"/><stop offset=".56" stop-color="#eed3ab"/><stop offset="1" stop-color="#e6a9a6"/></linearGradient>
      <filter id="qualityMist" x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="9"/></filter>
    </defs>
    <g class="radar-grid">${grid}</g>
    <path d="${contour(vertices)}" fill="url(#qualityWash)" opacity=".78" filter="url(#qualityMist)"/>
    <path d="${contour(vertices)}" fill="url(#qualityWash)" fill-opacity=".40" stroke="#fffaef" stroke-opacity=".70"/>
    ${vertices.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="4.6" fill="${dots[i]}" stroke="#fcfaf5" stroke-width="2"/>`).join('')}
    <text x="160" y="161" class="radar-average">${mean}</text>
    <text x="160" y="180" class="radar-label">/ 100</text>
    ${metrics.map((m,i) => `<text x="${labels[i].x}" y="${labels[i].y}" class="radar-label">${m.label}</text><text x="${labels[i].x}" y="${labels[i].y+21}" class="radar-value">${m.value}</text>`).join('')}
  </svg>`;
}
const escapeHTML = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function createExperience({State,Actions,show,loadStore,saveStore,renderHome,renderPreviewList,renderReport,portraitSVG}) {
  const el = id => document.getElementById(id);
  let currentReport = null, reportOrigin = 'home';
  const preferences = () => loadStore().preferences || {focus:'relax',experience:'new',minutes:4};
  let planOrigin='home', preferencesOrigin='home';
  function goPlan(origin='home') {
    planOrigin=origin;
    State.selectedPlan=recommendPractice(preferences(),loadStore().sessions).plan;
    returnToPlan();
  }
  function returnToPlan(){ renderPlan(); show('personalPlan'); }
  function renderPlanMoves(){
    const moves=practiceMoves(State.routine,State.selectedPlan);
    el('planMovesTitle').textContent='View '+moves.length+' moves';
    renderPreviewList('planMoves');
  }
  const title = id => State.routine.moves.find(m=>m.id===id)?.title.en || 'Practice';
  function renderPlan() {
    const data=loadStore(), rec=recommendPractice(preferences(),data.sessions);
    el('planReason').textContent=rec.reason;
    el('planFocus').textContent=rec.focus;
    el('planRange').textContent=`${rec.range}%`;

    el('planHistory').textContent=rec.revisitId ? `Next time: revisit ${title(rec.revisitId).toLowerCase()}.` : data.sessions?.length ? 'All moves completed in your last practice.' : 'Your first plan starts with your preferences.';
    el('planChoices').innerHTML='<legend class="sr-only">Choose a practice</legend>'+Object.entries(PLANS).map(([id,p])=>`<label class="plan-option"><span><strong>${p.title}</strong><small>${practiceMoves(State.routine,id).length} moves · ${p.minutes} min</small></span><input type="radio" name="practicePlan" value="${id}" ${State.selectedPlan===id?'checked':''}></label>`).join('');
    el('planChoices').onchange=e=>{if(Object.hasOwn(PLANS,e.target.value)){State.selectedPlan=e.target.value;renderPlanMoves();}};
    renderPlanMoves();
  }
  function openPreferences() {
    const p=preferences();
    el('practiceFocus').value=p.focus; el('practiceExperience').value=p.experience; el('practiceMinutes').value=p.minutes;
    show('preferences');
  }
  function openReport(session, origin='home') {
    currentReport=session; reportOrigin=origin;
    renderReport(session,loadStore()); show('report');
  }
  function renderReportExtras(session) {
    currentReport=session;
    el('reportStreakCard').hidden=Boolean(session.example);
    el('reportSource').textContent = session.example ? 'Example report' : 'Practice report';
    const rated = session.moves.filter(m=>m.cameraConfirmed && m.repPetals?.length)
      .map(m=>({id:m.id,score:m.repPetals.reduce((n,v)=>n+v,0)/m.repPetals.length})).sort((a,b)=>b.score-a.score);
    el('strongestCard').hidden=!rated.length;
    if(rated.length){const best=rated[0];el('strongestMove').textContent=title(best.id);el('strongestRating').textContent=`${best.score.toFixed(1)} / 3 ★`;}
    el('reportCoach').hidden = !mockFormReview(session);
    el('reportContext').textContent=PLANS[session.planId]?.title || 'Full practice';
  }
  let qualityMoves = [];
  let qualityIndex = 0;
  function displayQuality(index) {
    const move = qualityMoves[index];
    if (!move) return;
    qualityIndex = index;
    el('qualityMoveTitle').textContent = title(move.id);
    el('qualityChart').innerHTML = qualityRadar(move.metrics);
    el('qualityPosition').textContent = `${index + 1} / ${qualityMoves.length}`;
    el('qualityPrevious').disabled = index === 0;
    el('qualityNext').disabled = index === qualityMoves.length - 1;
    el('qualityPager').hidden = qualityMoves.length === 1;
  }
  function openQuality(event, button) {
    if (!currentReport) return;
    qualityMoves = mockFormReview(currentReport)?.moves || [];
    if (!qualityMoves.length) return;
    displayQuality(Math.max(0, qualityMoves.findIndex(m => m.id === button?.dataset.move)));
    show('quality');
  }
  function openProgress() {
    const data=loadStore(), sessions=data.sessions || [], stats=practiceStats(sessions);
    el('progressSessions').textContent=stats.sessions;
    el('progressMoves').textContent=stats.moves;
    el('progressDays').textContent=stats.week.filter(d=>d.active).length;
    el('progressWeek').innerHTML=stats.week.map(d=>`<span class="d ${d.active?'on':''}" aria-label="${d.date}: ${d.active?'practiced':'no practice'}">${d.label}</span>`).join('');
    const most=Math.max(0,...sessions.map(s=>s.moves.filter(m=>m.status==='completed').length));
    el('bestPractice').hidden=most===0;
    el('bestPractice').textContent=`Most moves completed in one practice: ${most}`;
    el('historyEmpty').hidden=sessions.length>0;
    el('historyList').innerHTML=sessions.map((s,index)=>({s,index})).reverse().map(({s,index})=>`<li><button class="history-row" data-action="openHistory" data-index="${index}"><span><strong>${escapeHTML(PLANS[s.planId]?.title || 'Full practice')}</strong><small>${escapeHTML(s.date)} · ${s.mode==='guided'?'Guided':'Camera'}${s.partial?' · Ended early':''}</small></span><span>${s.moves.filter(m=>m.status==='completed').length}/${s.moves.length}<span aria-hidden="true"> ↗</span></span></button></li>`).join('');
    show('progress');
  }
  Object.assign(Actions,{
    openIntroduction:()=>show('introduction'),
    dismissIntroduction:()=>{saveStore(d=>({...d,introSeen:true}));Actions.goHome();},
    setupPractice:()=>{saveStore(d=>({...d,introSeen:true}));preferencesOrigin='home';openPreferences();},
    openPreferences:()=>{preferencesOrigin='home';openPreferences();},
    editPlanPreferences:()=>{preferencesOrigin='plan';openPreferences();},
    backFromPreferences:()=>preferencesOrigin==='plan'?returnToPlan():Actions.goHome(),
    savePreferences:()=>{saveStore(d=>({...d,preferences:{focus:el('practiceFocus').value,experience:el('practiceExperience').value,minutes:Number(el('practiceMinutes').value)}}));goPlan(preferencesOrigin==='plan'?planOrigin:'home');},
    openPlan:()=>goPlan(),
    planAfterReport:()=>goPlan('report'),
    returnToPlan,
    backFromPlan:()=>{if(planOrigin==='report' && currentReport)openReport(currentReport,reportOrigin);else Actions.goHome();},
    continuePlan:()=>{State.previewOrigin='plan';Actions.toCameraChoice();},
    openPrivacy:()=>show('privacyInfo'),
    openProgress,
    openHistory:(_,button)=>{const s=loadStore().sessions?.[Number(button.dataset.index)];if(s)openReport(s,'progress');},
    viewSample:()=>openReport(sampleSession(State.routine),'progress'),
    viewReport:()=>{if(currentReport)openReport(currentReport);},
    reportBack:()=>{if(reportOrigin==='progress')openProgress();else Actions.goHome();},
    openQuality,
    previousQuality: () => displayQuality(qualityIndex - 1),
    nextQuality: () => displayQuality(qualityIndex + 1),
    qualityBack:()=>{if(currentReport)openReport(currentReport,reportOrigin);},
  });
  return {
    boot(){el('introPortrait').innerHTML=portraitSVG('neutral','Face yoga guide');const d=loadStore();show(d.introSeen || d.sessions?.length?'home':'introduction');},
    renderReportExtras,
    finish(session){currentReport=session;reportOrigin='home';el('finishTitle').textContent=session.partial?'Practice ended':'Practice complete';const completed=session.moves.filter(m=>m.status==='completed').length;el('finishCount').textContent=`${completed} of ${session.moves.length} moves completed`;el('finishPortrait').innerHTML=portraitSVG('neutral','Relaxed face');show('finish');},
  };
}
