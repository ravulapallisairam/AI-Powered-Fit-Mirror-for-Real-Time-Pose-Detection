(function(){
  "use strict";

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const videoEl   = $('videoEl');
  const canvas    = $('canvas');
  const ctx       = canvas.getContext('2d');
  const stage     = $('stage');
  const emptyState= $('emptyState');
  const fpsChip   = $('fpsChip');
  const fpsVal    = $('fpsVal');
  const repChip   = $('repChip');
  const repChipVal= $('repChipVal');
  const modeLabel = $('modeLabel');
  const modelDot  = $('modelDot');
  const modelStatusText = $('modelStatusText');
  const statusLog = $('statusLog');

  const btnImage  = $('btnImage');
  const btnVideo  = $('btnVideo');
  const btnWebcam = $('btnWebcam');
  const btnPause  = $('btnPause');
  const btnStop   = $('btnStop');
  const btnSnapshot = $('btnSnapshot');
  const btnExport = $('btnExport');
  const btnResetReps = $('btnResetReps');
  const fileImage = $('fileImage');
  const fileVideo = $('fileVideo');

  const scoreNum  = $('scoreNum');
  const feedbackMsg = $('feedbackMsg');
  const dotBack = $('dotBack'), valBack = $('valBack');
  const dotShoulders = $('dotShoulders'), valShoulders = $('valShoulders');
  const dotKnees = $('dotKnees'), valKnees = $('valKnees');

  const exerciseModeSel = $('exerciseMode');
  const repBlock = $('repBlock');
  const repNum = $('repNum');
  const repPhase = $('repPhase');
  const repAngle = $('repAngle');

  const confSlider = $('confSlider');
  const confVal = $('confVal');
  const modelQualitySel = $('modelQuality');
  const toggleMulti = $('toggleMulti');
  const toggleMirror = $('toggleMirror');
  const toggleSmooth = $('toggleSmooth');
  const toggleVoice = $('toggleVoice');

  const sparkline = $('sparkline');
  const sctx = sparkline.getContext('2d');
  const statAvg = $('statAvg');
  const statDuration = $('statDuration');
  const statSamples = $('statSamples');
  const btnTheme = $('btnTheme');

  const btnDashboard = $('btnDashboard');
  const dashOverlay = $('dashOverlay');
  const dashClose = $('dashClose');
  const dashTabs = document.querySelectorAll('.dash-tab');
  const dashPanes = { overview:$('paneOverview'), history:$('paneHistory'), trends:$('paneTrends'), exercise:$('paneExercise'), people:$('panePeople') };
  const dashViewing = $('dashViewing');
  const dashBackLive = $('dashBackLive');
  const overviewEmpty = $('overviewEmpty'), overviewContent = $('overviewContent');
  const ovScore = $('ovScore'), ovDuration = $('ovDuration'), ovReps = $('ovReps'), ovMode = $('ovMode');
  const ovSnapshot = $('ovSnapshot'), ovTimestamp = $('ovTimestamp'), ovExport = $('ovExport'), ovPdf = $('ovPdf');
  const historyEmpty = $('historyEmpty'), historyList = $('historyList');
  const trendsEmpty = $('trendsEmpty'), trendsContent = $('trendsContent');
  const trendsChart = $('trendsChart'), tctx = trendsChart.getContext('2d');
  const worstNote = $('worstNote');
  const exerciseEmpty = $('exerciseEmpty'), exerciseContent = $('exerciseContent');
  const exerciseChart = $('exerciseChart'), ectx = exerciseChart.getContext('2d');
  const exerciseTableBody = document.querySelector('#exerciseTable tbody');
  const peopleEmpty = $('peopleEmpty'), peopleGrid = $('peopleGrid');

  // ---------- State ----------
  let detector = null;
  let mode = null;          // 'image' | 'video' | 'webcam'
  let rafId = null;
  let paused = false;
  let stream = null;
  let frameTimes = [];
  let confidenceThreshold = 0.3;
  let modelQuality = 'lightning';
  let multiPerson = false;
  let mirrorWebcam = true;
  let smoothingEnabled = true;
  let voiceEnabled = false;
  let exerciseMode = 'none';
  let modelBusy = false;

  let prevSmoothed = {};
  let repState = { stage:'extended', count:0 };
  let scoreHistory = [];
  let checkHistory = [];     // {t, back, shoulders, knees} normalized 0-100 (null if not measured)
  let repLog = [];           // {exercise, t}
  let sessionStart = null;
  let lastSpoken = '';
  let lastSpeakTime = 0;
  let audioCtx = null;

  let sessionsHistory = [];  // completed sessions, in-memory only (cleared on page reload)
  let currentViewSession = null; // null = live session, else index into sessionsHistory
  let activeDashTab = 'overview';
  let lastMultiAnalyses = []; // latest per-person analyses when multiPerson is active

  // ---------- Logging ----------
  function log(msg, kind){
    const row = document.createElement('div');
    row.className = 'line' + (kind ? ' ' + kind : '');
    const time = new Date().toLocaleTimeString([], {hour12:false});
    row.innerHTML = '<span class="t">' + time + '</span><span class="m">' + msg + '</span>';
    statusLog.appendChild(row);
    statusLog.scrollTop = statusLog.scrollHeight;
  }

  // ---------- Skeleton definition ----------
  const CONNECTIONS = [
    ['nose','left_eye'], ['nose','right_eye'],
    ['left_eye','left_ear'], ['right_eye','right_ear'],
    ['left_shoulder','right_shoulder'],
    ['left_shoulder','left_elbow'], ['left_elbow','left_wrist'],
    ['right_shoulder','right_elbow'], ['right_elbow','right_wrist'],
    ['left_shoulder','left_hip'], ['right_shoulder','right_hip'],
    ['left_hip','right_hip'],
    ['left_hip','left_knee'], ['left_knee','left_ankle'],
    ['right_hip','right_knee'], ['right_knee','right_ankle'],
  ];

  function kpMap(keypoints){
    const m = {};
    keypoints.forEach(k => m[k.name] = k);
    return m;
  }

  // ---------- Keypoint smoothing (EMA) ----------
  function smoothKeypoints(keypoints){
    if (!smoothingEnabled){ prevSmoothed = {}; return keypoints; }
    const alpha = 0.45;
    return keypoints.map(k => {
      if (k.score <= confidenceThreshold) return k;
      const prev = prevSmoothed[k.name];
      let sx = k.x, sy = k.y;
      if (prev){
        sx = alpha * k.x + (1 - alpha) * prev.x;
        sy = alpha * k.y + (1 - alpha) * prev.y;
      }
      const out = { name:k.name, score:k.score, x:sx, y:sy };
      prevSmoothed[k.name] = out;
      return out;
    });
  }

  // ---------- Drawing ----------
  function drawSkeleton(keypoints, mirror, dim){
    const m = kpMap(keypoints);
    const w = canvas.width;
    const mapX = (x) => mirror ? (w - x) : x;
    const op = dim ? 0.45 : 1;

    ctx.globalAlpha = op;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    CONNECTIONS.forEach(([a,b]) => {
      const pa = m[a], pb = m[b];
      if (pa && pb && pa.score > confidenceThreshold && pb.score > confidenceThreshold){
        const grad = ctx.createLinearGradient(mapX(pa.x), pa.y, mapX(pb.x), pb.y);
        grad.addColorStop(0, '#6FE7DD');
        grad.addColorStop(1, '#B98CFF');
        ctx.strokeStyle = grad;
        ctx.shadowColor = 'rgba(111,231,221,0.5)';
        ctx.shadowBlur = dim ? 0 : 6;
        ctx.beginPath();
        ctx.moveTo(mapX(pa.x), pa.y);
        ctx.lineTo(mapX(pb.x), pb.y);
        ctx.stroke();
      }
    });

    ctx.shadowBlur = 0;
    keypoints.forEach(k => {
      if (k.score > confidenceThreshold){
        ctx.beginPath();
        ctx.arc(mapX(k.x), k.y, 4.5, 0, 2*Math.PI);
        ctx.fillStyle = '#0E1114';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(mapX(k.x), k.y, 3, 0, 2*Math.PI);
        ctx.fillStyle = '#EDEFF1';
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
  }

  // ---------- Angle helpers ----------
  function angleAt(p1, vertex, p2){
    const v1x = p1.x - vertex.x, v1y = p1.y - vertex.y;
    const v2x = p2.x - vertex.x, v2y = p2.y - vertex.y;
    const dot = v1x*v2x + v1y*v2y;
    const mag1 = Math.hypot(v1x, v1y), mag2 = Math.hypot(v2x, v2y);
    if (mag1 === 0 || mag2 === 0) return null;
    let cos = dot / (mag1 * mag2);
    cos = Math.max(-1, Math.min(1, cos));
    return Math.acos(cos) * (180/Math.PI);
  }

  function bestAngleFor(m, aName, vName, bName){
    let best = null, bestConf = 0;
    ['left','right'].forEach(side => {
      const a = m[side+'_'+aName], v = m[side+'_'+vName], b = m[side+'_'+bName];
      if (a && v && b && a.score>confidenceThreshold && v.score>confidenceThreshold && b.score>confidenceThreshold){
        const conf = a.score + v.score + b.score;
        const ang = angleAt(a, v, b);
        if (ang !== null && conf > bestConf){ bestConf = conf; best = ang; }
      }
    });
    return best;
  }

  // ---------- Posture analysis ----------
  function analyzePosture(keypoints){
    const m = kpMap(keypoints);
    const visible = keypoints.filter(k => k.score > confidenceThreshold);

    if (visible.length < 6) return { detected:false };

    const result = {
      detected:true,
      backOk:null, backNote:'—', backHealth:null,
      shouldersOk:null, shouldersNote:'—', shouldersHealth:null,
      kneesOk:null, kneesNote:'—', kneesHealth:null,
      messages:[],
      score:100
    };

    const ls = m.left_shoulder, rs = m.right_shoulder;
    if (ls && rs && ls.score > confidenceThreshold && rs.score > confidenceThreshold){
      const width = Math.abs(ls.x - rs.x) || 1;
      const tilt = Math.abs(ls.y - rs.y) / width;
      result.shouldersNote = Math.round(tilt*100) + '%';
      result.shouldersHealth = Math.max(0, Math.min(100, 100 - tilt*300));
      if (tilt > 0.09){
        result.shouldersOk = false;
        result.messages.push('Straighten your shoulders');
        result.score -= 20;
      } else result.shouldersOk = true;
    }

    const backAngle = bestAngleFor(m, 'shoulder', 'hip', 'knee');
    if (backAngle !== null){
      result.backNote = Math.round(backAngle) + '°';
      result.backHealth = Math.max(0, Math.min(100, (backAngle - 90) / 90 * 100));
      if (backAngle < 155){
        result.backOk = false;
        result.messages.push('Keep your back straight');
        result.score -= 25;
      } else result.backOk = true;
    }

    let kneeFlag = false, kneeChecked = false, worstDev = 0;
    ['left','right'].forEach(side => {
      const hp = m[side+'_hip'], kn = m[side+'_knee'], an = m[side+'_ankle'];
      if (hp && kn && an && hp.score>confidenceThreshold && kn.score>confidenceThreshold && an.score>confidenceThreshold){
        kneeChecked = true;
        const legSpan = Math.abs(hp.x - an.x) + Math.abs(hp.y - an.y) || 1;
        const midX = (hp.x + an.x)/2;
        const dev = Math.abs(kn.x - midX) / legSpan;
        worstDev = Math.max(worstDev, dev);
        if (dev > 0.22) kneeFlag = true;
      }
    });
    if (kneeChecked){
      result.kneesNote = Math.round(worstDev*100) + '%';
      result.kneesHealth = Math.max(0, Math.min(100, 100 - worstDev*200));
      if (kneeFlag){
        result.kneesOk = false;
        result.messages.push('Align your knees properly');
        result.score -= 20;
      } else result.kneesOk = true;
    }

    const avgScore = visible.reduce((s,k)=>s+k.score,0) / visible.length;
    result.score = Math.round(result.score * (0.7 + 0.3*avgScore));
    result.score = Math.max(0, Math.min(100, result.score));

    if (result.messages.length === 0) result.messages.push('Good posture!');
    return result;
  }

  function renderFeedback(analysis){
    if (!analysis || !analysis.detected){
      scoreNum.textContent = '—';
      scoreNum.classList.add('dim');
      feedbackMsg.textContent = 'No person detected — step into frame.';
      feedbackMsg.className = '';
      [dotBack,dotShoulders,dotKnees].forEach(d => d.className = 'check-dot');
      valBack.textContent = '—'; valShoulders.textContent = '—'; valKnees.textContent = '—';
      return;
    }

    scoreNum.classList.remove('dim');
    scoreNum.textContent = analysis.score;

    dotBack.className = 'check-dot' + (analysis.backOk===null?'':(analysis.backOk?' good':' bad'));
    dotShoulders.className = 'check-dot' + (analysis.shouldersOk===null?'':(analysis.shouldersOk?' good':' bad'));
    dotKnees.className = 'check-dot' + (analysis.kneesOk===null?'':(analysis.kneesOk?' good':' bad'));

    valBack.textContent = analysis.backNote;
    valShoulders.textContent = analysis.shouldersNote;
    valKnees.textContent = analysis.kneesNote;

    const allGood = analysis.messages.length === 1 && analysis.messages[0] === 'Good posture!';
    feedbackMsg.textContent = analysis.messages.join('  •  ');
    feedbackMsg.className = allGood ? 'good' : 'bad';

    recordScore(analysis);
    maybeSpeak(analysis.messages.join('. '));
  }

  // ---------- Exercise rep counter ----------
  const exerciseConfigs = {
    squat:  { fn:(m)=>bestAngleFor(m,'hip','knee','ankle'),     low:100, high:160, label:'Squat' },
    pushup: { fn:(m)=>bestAngleFor(m,'shoulder','elbow','wrist'),low:90,  high:160, label:'Push-up' },
    curl:   { fn:(m)=>bestAngleFor(m,'shoulder','elbow','wrist'),low:50,  high:150, label:'Curl' },
  };

  function resetReps(){
    repState = { stage:'extended', count:0 };
    repNum.textContent = '0';
    repPhase.textContent = '—';
    repAngle.textContent = '—';
    repChipVal.textContent = '0';
  }

  function updateExerciseCounter(m){
    if (exerciseMode === 'none'){
      repBlock.classList.remove('show');
      repChip.style.display = 'none';
      return;
    }
    repBlock.classList.add('show');
    repChip.style.display = (mode === 'video' || mode === 'webcam') ? 'block' : 'none';

    const cfg = exerciseConfigs[exerciseMode];
    const angle = cfg.fn(m);
    if (angle === null){
      repAngle.textContent = '—';
      return;
    }
    repAngle.textContent = Math.round(angle) + '°';

    if (repState.stage === 'extended' && angle < cfg.low){
      repState.stage = 'flexed';
    } else if (repState.stage === 'flexed' && angle > cfg.high){
      repState.stage = 'extended';
      repState.count++;
      repLog.push({ exercise: exerciseMode, t: Date.now() });
      playBeep();
    }
    repPhase.textContent = repState.stage;
    repNum.textContent = repState.count;
    repChipVal.textContent = repState.count;
  }

  // ---------- Audio beep ----------
  function ensureAudio(){
    if (!audioCtx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    return audioCtx;
  }
  function playBeep(){
    const ac = ensureAudio();
    if (!ac) return;
    try{
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.connect(g); g.connect(ac.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.18);
      o.stop(ac.currentTime + 0.2);
    }catch(e){}
  }

  // ---------- Voice feedback ----------
  function maybeSpeak(text){
    if (!voiceEnabled || !('speechSynthesis' in window)) return;
    const now = performance.now();
    if (text === lastSpoken && now - lastSpeakTime < 4000) return;
    if (now - lastSpeakTime < 3000) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1; u.volume = 0.9;
    window.speechSynthesis.speak(u);
    lastSpoken = text;
    lastSpeakTime = now;
  }

  // ---------- Session tracking ----------
  function recordScore(analysis){
    if (!sessionStart) sessionStart = Date.now();
    const t = Date.now();
    scoreHistory.push({ t, score: analysis.score });
    if (scoreHistory.length > 200) scoreHistory.shift();
    checkHistory.push({
      t,
      back: analysis.backHealth,
      shoulders: analysis.shouldersHealth,
      knees: analysis.kneesHealth
    });
    if (checkHistory.length > 200) checkHistory.shift();
    updateSessionUI();
    drawSparkline();
    if (activeDashTab === 'trends' && dashOverlay.classList.contains('open') && currentViewSession === null) renderTrends();
    if (activeDashTab === 'exercise' && dashOverlay.classList.contains('open') && currentViewSession === null) renderExercise();
  }

  function updateSessionUI(){
    if (scoreHistory.length === 0){
      statAvg.textContent = '—'; statDuration.textContent = '00:00'; statSamples.textContent = '0';
      return;
    }
    const avg = Math.round(scoreHistory.reduce((s,e)=>s+e.score,0) / scoreHistory.length);
    statAvg.textContent = avg;
    statSamples.textContent = scoreHistory.length;
    const secs = Math.floor((Date.now() - sessionStart)/1000);
    const mm = String(Math.floor(secs/60)).padStart(2,'0');
    const ss = String(secs%60).padStart(2,'0');
    statDuration.textContent = mm + ':' + ss;
  }

  function drawSparkline(){
    const w = sparkline.width, h = sparkline.height;
    sctx.clearRect(0,0,w,h);
    if (scoreHistory.length < 2){
      sctx.strokeStyle = 'rgba(138,145,153,0.4)';
      sctx.beginPath(); sctx.moveTo(0,h/2); sctx.lineTo(w,h/2); sctx.stroke();
      return;
    }
    const pts = scoreHistory.slice(-60);
    const stepX = w / (pts.length - 1);
    const grad = sctx.createLinearGradient(0,0,w,0);
    grad.addColorStop(0, '#6FE7DD');
    grad.addColorStop(1, '#B98CFF');
    sctx.lineWidth = 2;
    sctx.strokeStyle = grad;
    sctx.beginPath();
    pts.forEach((p,i) => {
      const x = i * stepX;
      const y = h - (p.score/100) * (h-6) - 3;
      if (i===0) sctx.moveTo(x,y); else sctx.lineTo(x,y);
    });
    sctx.stroke();
  }

  function resetSession(){
    scoreHistory = [];
    checkHistory = [];
    repLog = [];
    sessionStart = null;
    currentViewSession = null;
    lastMultiAnalyses = [];
    updateSessionUI();
    drawSparkline();
  }

  function buildCSV(scoreArr){
    let csv = 'timestamp_iso,seconds_from_start,score\n';
    if (scoreArr.length === 0) return csv;
    const t0 = scoreArr[0].t;
    scoreArr.forEach(e => {
      csv += new Date(e.t).toISOString() + ',' + ((e.t-t0)/1000).toFixed(2) + ',' + e.score + '\n';
    });
    return csv;
  }

  function downloadCSV(csv, filename){
    const blob = new Blob([csv], { type:'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  function exportCSV(){
    if (scoreHistory.length === 0){ log('Nothing to export yet.', 'error'); return; }
    downloadCSV(buildCSV(scoreHistory), 'mirror-session-' + Date.now() + '.csv');
    log('Session CSV exported.', 'ok');
  }

  function takeSnapshot(){
    if (!mode){ return; }
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'mirror-snapshot-' + Date.now() + '.png';
    a.click();
    log('Snapshot saved.', 'ok');
  }

  // ---------- Finalize a session into history when stopped ----------
  function finalizeSession(autoOpen){
    if (scoreHistory.length === 0) return; // nothing was tracked
    const endTime = Date.now();
    const avg = Math.round(scoreHistory.reduce((s,e)=>s+e.score,0) / scoreHistory.length);
    let snap = null;
    try{ snap = canvas.toDataURL('image/png'); }catch(e){}
    const record = {
      id: 's' + endTime,
      mode,
      startTime: sessionStart,
      endTime,
      durationSec: Math.round((endTime - sessionStart)/1000),
      avgScore: avg,
      scoreHistory: scoreHistory.slice(),
      checkHistory: checkHistory.slice(),
      repLog: repLog.slice(),
      snapshot: snap
    };
    sessionsHistory.unshift(record);
    if (sessionsHistory.length > 20) sessionsHistory.pop();
    currentViewSession = null;
    renderHistory();
    if (autoOpen){
      renderOverview(record);
      openDashboard('overview');
    }
    log('Session saved to dashboard history.', 'ok');
  }

  // ---------- Dashboard: data helpers ----------
  function getActiveRecord(){
    // returns a session-shaped object, either the live session or a viewed history record
    if (currentViewSession !== null && sessionsHistory[currentViewSession]){
      return sessionsHistory[currentViewSession];
    }
    if (scoreHistory.length === 0) return null;
    return {
      mode,
      startTime: sessionStart,
      endTime: Date.now(),
      durationSec: sessionStart ? Math.round((Date.now()-sessionStart)/1000) : 0,
      avgScore: Math.round(scoreHistory.reduce((s,e)=>s+e.score,0)/scoreHistory.length),
      scoreHistory, checkHistory, repLog,
      snapshot: (function(){ try{ return canvas.toDataURL('image/png'); }catch(e){ return null; } })()
    };
  }

  function exerciseStatsFromLog(logArr){
    const byEx = {};
    logArr.forEach(entry => {
      if (!byEx[entry.exercise]) byEx[entry.exercise] = { count:0, times:[] };
      byEx[entry.exercise].count++;
      byEx[entry.exercise].times.push(entry.t);
    });
    Object.keys(byEx).forEach(ex => {
      const times = byEx[ex].times.slice().sort((a,b)=>a-b);
      const tempos = [];
      for (let i=1;i<times.length;i++) tempos.push((times[i]-times[i-1])/1000);
      byEx[ex].avgTempo = tempos.length ? tempos.reduce((a,b)=>a+b,0)/tempos.length : null;
      byEx[ex].minTempo = tempos.length ? Math.min(...tempos) : null;
      byEx[ex].maxTempo = tempos.length ? Math.max(...tempos) : null;
    });
    return byEx;
  }

  // ---------- Dashboard: open / close / tabs ----------
  function openDashboard(tab){
    dashOverlay.classList.add('open');
    switchDashTab(tab || activeDashTab);
  }
  function closeDashboard(){
    dashOverlay.classList.remove('open');
  }
  function switchDashTab(tab){
    activeDashTab = tab;
    dashTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    Object.keys(dashPanes).forEach(k => dashPanes[k].classList.toggle('active', k === tab));
    if (tab === 'overview') renderOverview(getActiveRecord());
    if (tab === 'history') renderHistory();
    if (tab === 'trends') renderTrends();
    if (tab === 'exercise') renderExercise();
    if (tab === 'people') renderPeople();
    dashViewing.style.display = currentViewSession !== null ? 'block' : 'none';
  }

  // ---------- Dashboard: Overview pane ----------
  function renderOverview(record){
    if (!record){
      overviewEmpty.style.display = 'block';
      overviewContent.style.display = 'none';
      return;
    }
    overviewEmpty.style.display = 'none';
    overviewContent.style.display = 'block';
    ovScore.textContent = record.avgScore;
    const mm = String(Math.floor(record.durationSec/60)).padStart(2,'0');
    const ss = String(record.durationSec%60).padStart(2,'0');
    ovDuration.textContent = mm + ':' + ss;
    const repCount = record.repLog ? record.repLog.length : 0;
    ovReps.textContent = repCount;
    ovMode.textContent = record.mode ? record.mode.charAt(0).toUpperCase()+record.mode.slice(1) : '—';
    if (record.snapshot){
      ovSnapshot.src = record.snapshot;
      ovSnapshot.style.display = 'block';
    } else {
      ovSnapshot.style.display = 'none';
    }
    ovTimestamp.textContent = record.endTime ? new Date(record.endTime).toLocaleString() : 'In progress…';
  }

  // ---------- Dashboard: History pane ----------
  function renderHistory(){
    if (sessionsHistory.length === 0){
      historyEmpty.style.display = 'block';
      historyList.innerHTML = '';
      return;
    }
    historyEmpty.style.display = 'none';
    historyList.innerHTML = '';
    sessionsHistory.forEach((rec, idx) => {
      const row = document.createElement('div');
      row.className = 'history-row';
      const mm = String(Math.floor(rec.durationSec/60)).padStart(2,'0');
      const ss = String(rec.durationSec%60).padStart(2,'0');
      row.innerHTML =
        '<div class="history-meta">' +
          '<span>' + new Date(rec.endTime).toLocaleString() + '</span>' +
          '<span>Mode <b>' + (rec.mode||'—') + '</b></span>' +
          '<span>Avg <b>' + rec.avgScore + '</b></span>' +
          '<span>Dur <b>' + mm + ':' + ss + '</b></span>' +
          '<span>Reps <b>' + rec.repLog.length + '</b></span>' +
        '</div>';
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'View';
      btn.addEventListener('click', () => {
        currentViewSession = idx;
        switchDashTab('overview');
      });
      row.appendChild(btn);
      historyList.appendChild(row);
    });
  }

  dashBackLive.addEventListener('click', () => {
    currentViewSession = null;
    switchDashTab(activeDashTab);
  });

  // ---------- Dashboard: Trends pane ----------
  function renderTrends(){
    const record = getActiveRecord();
    const data = record ? record.checkHistory : [];
    if (!data || data.length < 2){
      trendsEmpty.style.display = 'block';
      trendsContent.style.display = 'none';
      return;
    }
    trendsEmpty.style.display = 'none';
    trendsContent.style.display = 'block';

    const w = trendsChart.width, h = trendsChart.height;
    tctx.clearRect(0,0,w,h);
    const pad = 10;
    const pts = data.slice(-150);
    const stepX = (w - pad*2) / Math.max(1, pts.length - 1);

    function plotLine(key, color){
      tctx.beginPath();
      tctx.lineWidth = 2;
      tctx.strokeStyle = color;
      let started = false;
      pts.forEach((p, i) => {
        if (p[key] === null || p[key] === undefined) return;
        const x = pad + i * stepX;
        const y = h - pad - (p[key]/100) * (h - pad*2);
        if (!started){ tctx.moveTo(x,y); started = true; } else tctx.lineTo(x,y);
      });
      if (started) tctx.stroke();
    }
    plotLine('back', '#6FE7DD');
    plotLine('shoulders', '#B98CFF');
    plotLine('knees', '#FF8966');

    // worst moment: lowest combined health across all three measured channels
    let worstIdx = -1, worstVal = Infinity;
    pts.forEach((p, i) => {
      const vals = [p.back, p.shoulders, p.knees].filter(v => v !== null && v !== undefined);
      if (vals.length === 0) return;
      const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
      if (avg < worstVal){ worstVal = avg; worstIdx = i; }
    });
    if (worstIdx >= 0){
      const x = pad + worstIdx * stepX;
      tctx.strokeStyle = 'rgba(255,137,102,0.6)';
      tctx.setLineDash([4,4]);
      tctx.lineWidth = 1;
      tctx.beginPath(); tctx.moveTo(x, pad); tctx.lineTo(x, h-pad); tctx.stroke();
      tctx.setLineDash([]);
      const t0 = pts[0].t;
      const secs = Math.round((pts[worstIdx].t - t0)/1000);
      worstNote.textContent = 'Worst moment: ~' + Math.round(worstVal) + '/100 at ' + secs + 's';
    } else {
      worstNote.textContent = '—';
    }
  }

  // ---------- Dashboard: Exercise analytics pane ----------
  function renderExercise(){
    const record = getActiveRecord();
    const log = record ? record.repLog : [];
    if (!log || log.length === 0){
      exerciseEmpty.style.display = 'block';
      exerciseContent.style.display = 'none';
      return;
    }
    exerciseEmpty.style.display = 'none';
    exerciseContent.style.display = 'block';

    const stats = exerciseStatsFromLog(log);
    const colors = { squat:'#6FE7DD', pushup:'#B98CFF', curl:'#FF8966' };
    const names = Object.keys(stats);
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#EDEFF1';

    const w = exerciseChart.width, h = exerciseChart.height;
    ectx.clearRect(0,0,w,h);
    const pad = 30;
    const maxCount = Math.max(...names.map(n => stats[n].count), 1);
    const barW = Math.min(90, (w - pad*2) / names.length - 20);
    names.forEach((n, i) => {
      const barH = (stats[n].count / maxCount) * (h - pad*2);
      const x = pad + i * ((w - pad*2)/names.length) + 10;
      const y = h - pad - barH;
      ectx.fillStyle = colors[n] || '#8A9199';
      ectx.fillRect(x, y, barW, barH);
      ectx.font = '12px Inter, sans-serif';
      ectx.fillStyle = textColor;
      ectx.fillText(n, x, h - pad + 16);
      ectx.fillText(String(stats[n].count), x, y - 6);
    });

    exerciseTableBody.innerHTML = '';
    names.forEach(n => {
      const s = stats[n];
      const tr = document.createElement('tr');
      const fmt = (v) => v===null ? '—' : v.toFixed(1)+'s';
      tr.innerHTML = '<td>' + (exerciseConfigs[n] ? exerciseConfigs[n].label : n) + '</td>' +
        '<td>' + s.count + '</td><td>' + fmt(s.avgTempo) + '</td><td>' + fmt(s.minTempo) + '</td><td>' + fmt(s.maxTempo) + '</td>';
      exerciseTableBody.appendChild(tr);
    });
  }

  // ---------- Dashboard: People pane (multi-person) ----------
  function renderPeople(){
    if (!multiPerson || lastMultiAnalyses.length < 2){
      peopleEmpty.style.display = 'block';
      peopleGrid.innerHTML = '';
      return;
    }
    peopleEmpty.style.display = 'none';
    peopleGrid.innerHTML = '';
    lastMultiAnalyses.forEach((a, i) => {
      const card = document.createElement('div');
      card.className = 'people-card';
      const score = a.detected ? a.score : '—';
      const msg = a.detected ? a.messages.join(', ') : 'Not detected';
      card.innerHTML =
        '<div class="pc-title">Person ' + (i+1) + '</div>' +
        '<div class="pc-score">' + score + '</div>' +
        '<div class="pc-msg">' + msg + '</div>';
      peopleGrid.appendChild(card);
    });
  }

  btnDashboard.addEventListener('click', () => openDashboard(activeDashTab));
  dashClose.addEventListener('click', closeDashboard);
  dashOverlay.addEventListener('click', (e) => { if (e.target === dashOverlay) closeDashboard(); });
  dashTabs.forEach(b => b.addEventListener('click', () => switchDashTab(b.dataset.tab)));
  ovExport.addEventListener('click', () => {
    const record = getActiveRecord();
    if (!record){ log('Nothing to export yet.', 'error'); return; }
    downloadCSV(buildCSV(record.scoreHistory), 'mirror-session-' + (record.endTime||Date.now()) + '.csv');
    log('Session CSV exported.', 'ok');
  });

  // ---------- PDF report ----------
  function downloadReportPDF(){
    const record = getActiveRecord();
    if (!record){ log('Nothing to export yet.', 'error'); return; }
    if (!window.jspdf){ log('PDF library still loading — try again in a moment.', 'error'); return; }

    // Make sure the trends/exercise canvases reflect this exact record before capturing them as images.
    renderTrends();
    renderExercise();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'pt', format:'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 42;
    let y = margin;

    function ensureRoom(h){
      if (y + h > pageH - margin){ doc.addPage(); y = margin; }
    }

    doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(20,20,20);
    doc.text('MIRROR — Session Report', margin, y); y += 22;

    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(120,120,120);
    doc.text('Generated ' + new Date().toLocaleString(), margin, y); y += 26;

    const mm = String(Math.floor(record.durationSec/60)).padStart(2,'0');
    const ss = String(record.durationSec%60).padStart(2,'0');
    const repCount = record.repLog ? record.repLog.length : 0;
    const stats = [
      ['Average posture score', String(record.avgScore) + ' / 100'],
      ['Session duration', mm + ':' + ss],
      ['Total reps logged', String(repCount)],
      ['Input mode', record.mode ? (record.mode.charAt(0).toUpperCase()+record.mode.slice(1)) : '—'],
      ['Recorded at', record.endTime ? new Date(record.endTime).toLocaleString() : 'In progress'],
    ];
    doc.setFontSize(11);
    stats.forEach(([label,val]) => {
      doc.setFont('helvetica','normal'); doc.setTextColor(120,120,120);
      doc.text(label, margin, y);
      doc.setFont('helvetica','bold'); doc.setTextColor(20,20,20);
      doc.text(val, margin + 190, y);
      y += 18;
    });
    y += 12;

    if (record.snapshot){
      ensureRoom(160);
      doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(20,20,20);
      doc.text('Snapshot', margin, y); y += 14;
      try{
        const props = doc.getImageProperties(record.snapshot);
        const w = Math.min(pageW - margin*2, 240);
        const h = (props.height / props.width) * w;
        ensureRoom(h);
        doc.addImage(record.snapshot, 'PNG', margin, y, w, h);
        y += h + 22;
      }catch(e){ y += 8; }
    }

    if (record.checkHistory && record.checkHistory.length > 1){
      ensureRoom(40);
      doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(20,20,20);
      doc.text('Posture Trends', margin, y); y += 14;
      const w = pageW - margin*2;
      const h = w * (trendsChart.height / trendsChart.width);
      ensureRoom(h + 20);
      doc.addImage(trendsChart.toDataURL('image/png'), 'PNG', margin, y, w, h);
      y += h + 14;

      function legendDot(x, color, label){
        doc.setFillColor(color[0], color[1], color[2]);
        doc.circle(x, y - 3, 3, 'F');
        doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(90,90,90);
        doc.text(label, x + 8, y);
      }
      legendDot(margin, [111,231,221], 'Back');
      legendDot(margin + 70, [185,140,255], 'Shoulders');
      legendDot(margin + 160, [255,137,102], 'Knees');
      y += 26;
    }

    if (record.repLog && record.repLog.length){
      ensureRoom(40);
      doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(20,20,20);
      doc.text('Exercise Breakdown', margin, y); y += 14;
      const w = pageW - margin*2;
      const h = w * (exerciseChart.height / exerciseChart.width);
      ensureRoom(h + 10);
      doc.addImage(exerciseChart.toDataURL('image/png'), 'PNG', margin, y, w, h);
      y += h + 18;

      const exStats = exerciseStatsFromLog(record.repLog);
      const fmt = (v) => v===null ? '—' : v.toFixed(1) + 's';
      doc.setFontSize(10);
      Object.keys(exStats).forEach(n => {
        ensureRoom(18);
        const s = exStats[n];
        const label = exerciseConfigs[n] ? exerciseConfigs[n].label : n;
        doc.setFont('helvetica','normal'); doc.setTextColor(20,20,20);
        doc.text(label + ':  ' + s.count + ' reps  ·  avg ' + fmt(s.avgTempo) + '  ·  fastest ' + fmt(s.minTempo) + '  ·  slowest ' + fmt(s.maxTempo), margin, y);
        y += 16;
      });
      y += 8;
    }

    doc.setFontSize(8.5); doc.setTextColor(150,150,150);
    doc.text('Generated locally in your browser — no images or video left your device.', margin, pageH - 24);

    doc.save('mirror-report-' + (record.endTime || Date.now()) + '.pdf');
    log('PDF report downloaded.', 'ok');
  }

  ovPdf.addEventListener('click', downloadReportPDF);

  // ---------- FPS ----------
  function tickFps(){
    const now = performance.now();
    frameTimes.push(now);
    frameTimes = frameTimes.filter(t => now - t < 1000);
    fpsVal.textContent = frameTimes.length;
  }

  // ---------- Canvas sizing ----------
  function sizeCanvasTo(w, h){
    const maxW = 1280;
    let cw = w, ch = h;
    if (cw > maxW){ const r = maxW/cw; cw = maxW; ch = Math.round(ch*r); }
    canvas.width = cw;
    canvas.height = ch;
  }

  function showEmpty(show){
    emptyState.style.display = show ? 'flex' : 'none';
    canvas.style.visibility = show ? 'hidden' : 'visible';
  }

  // ---------- Primary pose selection (multi-person) ----------
  function pickPrimary(poses){
    if (poses.length <= 1) return poses[0];
    let best = poses[0], bestSpan = -1;
    poses.forEach(p => {
      const vis = p.keypoints.filter(k => k.score > confidenceThreshold);
      if (vis.length < 4) return;
      const ys = vis.map(k=>k.y);
      const span = Math.max(...ys) - Math.min(...ys);
      if (span > bestSpan){ bestSpan = span; best = p; }
    });
    return best;
  }

  // ---------- Model loading ----------
  async function reloadDetector(){
    if (modelBusy) return;
    modelBusy = true;
    modelDot.className = 'dot loading';
    modelStatusText.textContent = 'Reloading model…';
    [btnImage, btnVideo, btnWebcam].forEach(b => b.disabled = true);
    try{
      if (!tf.getBackend()) await tf.setBackend('webgl');
      await tf.ready();

      let cfg;
      if (multiPerson){
        cfg = { modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING };
      } else {
        const mt = modelQuality === 'thunder'
          ? poseDetection.movenet.modelType.SINGLEPOSE_THUNDER
          : poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING;
        cfg = { modelType: mt };
      }
      detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, cfg);

      modelDot.className = 'dot ready';
      modelStatusText.textContent = 'Model ready';
      log('Model ready: ' + (multiPerson ? 'MoveNet multi-person' : 'MoveNet ' + modelQuality) + '.', 'ok');
      [btnImage, btnVideo, btnWebcam].forEach(b => b.disabled = false);
    }catch(err){
      modelDot.className = '';
      modelStatusText.textContent = 'Model failed to load';
      log('Failed to load pose model: ' + err.message, 'error');
    }finally{
      modelBusy = false;
    }
  }

  // ---------- Reset / stop ----------
  function stopAll(autoOpenDash){
    finalizeSession(!!autoOpenDash);
    if (rafId){ cancelAnimationFrame(rafId); rafId = null; }
    if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
    videoEl.pause();
    videoEl.srcObject = null;
    videoEl.removeAttribute('src');
    mode = null;
    paused = false;
    prevSmoothed = {};
    btnPause.disabled = true;
    btnPause.textContent = '⏸ Pause';
    btnStop.disabled = true;
    btnSnapshot.disabled = true;
    fpsChip.style.display = 'none';
    repChip.style.display = 'none';
    stage.classList.remove('scanning');
    modeLabel.textContent = 'Idle';
    ctx.clearRect(0,0,canvas.width,canvas.height);
    showEmpty(true);
    renderFeedback(null);
  }

  // ---------- Image flow ----------
  btnImage.addEventListener('click', () => fileImage.click());
  fileImage.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    stopAll();
    resetSession();
    mode = 'image';
    modeLabel.textContent = 'Image';
    btnSnapshot.disabled = false;
    log('Analyzing uploaded image…');
    const img = new Image();
    img.onload = async () => {
      sizeCanvasTo(img.naturalWidth, img.naturalHeight);
      showEmpty(false);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try{
        const poses = await detector.estimatePoses(img);
        if (poses.length){
          const primary = pickPrimary(poses);
          poses.forEach(p => { if (p !== primary) drawSkeleton(p.keypoints, false, true); });
          drawSkeleton(primary.keypoints, false, false);
          const m = kpMap(primary.keypoints);
          renderFeedback(analyzePosture(primary.keypoints));
          updateExerciseCounter(m);
          if (multiPerson){
            lastMultiAnalyses = poses.map(p => analyzePosture(p.keypoints));
            if (activeDashTab === 'people' && dashOverlay.classList.contains('open')) renderPeople();
          } else {
            lastMultiAnalyses = [];
          }
          log('Pose detected in image' + (poses.length>1 ? ' (' + poses.length + ' people)' : '') + '.', 'ok');
        } else {
          renderFeedback({detected:false});
          log('No pose detected in image.', 'error');
        }
      }catch(err){
        log('Detection error: ' + err.message, 'error');
      }
    };
    img.onerror = () => log('Could not load image file.', 'error');
    img.src = URL.createObjectURL(file);
  });

  // ---------- Video flow ----------
  btnVideo.addEventListener('click', () => fileVideo.click());
  fileVideo.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    stopAll();
    resetSession();
    mode = 'video';
    modeLabel.textContent = 'Video';
    btnSnapshot.disabled = false;
    videoEl.src = URL.createObjectURL(file);
    videoEl.loop = false;
    videoEl.onloadedmetadata = () => {
      sizeCanvasTo(videoEl.videoWidth, videoEl.videoHeight);
      showEmpty(false);
      videoEl.play();
      btnPause.disabled = false;
      btnStop.disabled = false;
      fpsChip.style.display = 'block';
      log('Processing uploaded video…');
      loop();
    };
    videoEl.onended = () => {
      log('Video finished.', 'ok');
      if (rafId){ cancelAnimationFrame(rafId); rafId = null; }
    };
  });

  // ---------- Webcam flow ----------
  btnWebcam.addEventListener('click', async () => {
    stopAll();
    resetSession();
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video: { width:640, height:480 }, audio:false });
      videoEl.srcObject = stream;
      mode = 'webcam';
      modeLabel.textContent = 'Webcam';
      btnSnapshot.disabled = false;
      videoEl.onloadedmetadata = () => {
        sizeCanvasTo(videoEl.videoWidth, videoEl.videoHeight);
        showEmpty(false);
        videoEl.play();
        btnPause.disabled = false;
        btnStop.disabled = false;
        fpsChip.style.display = 'block';
        stage.classList.add('scanning');
        setTimeout(() => stage.classList.remove('scanning'), 1800);
        log('Webcam started.', 'ok');
        loop();
      };
    }catch(err){
      log('Camera access denied or unavailable: ' + err.message, 'error');
    }
  });

  // ---------- Pause / Stop ----------
  btnPause.addEventListener('click', () => {
    paused = !paused;
    btnPause.textContent = paused ? '▶ Resume' : '⏸ Pause';
    if (mode === 'video'){
      if (paused) videoEl.pause(); else videoEl.play();
    }
    log(paused ? 'Detection paused.' : 'Detection resumed.');
  });

  btnStop.addEventListener('click', () => {
    log((mode === 'webcam' ? 'Webcam' : 'Video') + ' stopped.');
    stopAll(true);
  });

  btnSnapshot.addEventListener('click', takeSnapshot);
  btnExport.addEventListener('click', exportCSV);
  btnResetReps.addEventListener('click', () => { resetReps(); log('Rep counter reset.'); });

  // ---------- Theme toggle ----------
  let theme = 'dark';
  btnTheme.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    btnTheme.textContent = theme === 'dark' ? '🌙 Dark' : '☀️ Light';
    drawSparkline();
    if (dashOverlay.classList.contains('open')){
      if (activeDashTab === 'trends') renderTrends();
      if (activeDashTab === 'exercise') renderExercise();
    }
  });

  // ---------- Settings wiring ----------
  confSlider.addEventListener('input', () => {
    confidenceThreshold = parseInt(confSlider.value,10) / 100;
    confVal.textContent = confSlider.value + '%';
  });
  modelQualitySel.addEventListener('change', () => {
    modelQuality = modelQualitySel.value;
    if (!multiPerson) reloadDetector();
  });
  toggleMulti.addEventListener('change', () => {
    multiPerson = toggleMulti.checked;
    modelQualitySel.disabled = multiPerson;
    reloadDetector();
  });
  toggleMirror.addEventListener('change', () => { mirrorWebcam = toggleMirror.checked; });
  toggleSmooth.addEventListener('change', () => { smoothingEnabled = toggleSmooth.checked; prevSmoothed = {}; });
  toggleVoice.addEventListener('change', () => {
    voiceEnabled = toggleVoice.checked;
    if (!voiceEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  });
  exerciseModeSel.addEventListener('change', () => {
    exerciseMode = exerciseModeSel.value;
    resetReps();
    log('Exercise mode: ' + (exerciseMode==='none' ? 'posture only' : exerciseConfigs[exerciseMode].label) + '.');
  });

  // ---------- Main render loop (video & webcam) ----------
  async function loop(){
    if (mode !== 'video' && mode !== 'webcam') return;

    if (!paused && videoEl.readyState >= 2 && !videoEl.paused){
      const mirror = (mode === 'webcam') && mirrorWebcam;
      if (mirror){
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(videoEl, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();
      } else {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      }
      try{
        const poses = await detector.estimatePoses(videoEl);
        if (poses.length){
          const primary = pickPrimary(poses);
          poses.forEach(p => { if (p !== primary) drawSkeleton(p.keypoints, mirror, true); });
          const smoothed = smoothKeypoints(primary.keypoints);
          drawSkeleton(smoothed, mirror, false);
          const m = kpMap(smoothed);
          renderFeedback(analyzePosture(smoothed));
          updateExerciseCounter(m);
          if (multiPerson){
            lastMultiAnalyses = poses.map(p => analyzePosture(p.keypoints));
            if (activeDashTab === 'people' && dashOverlay.classList.contains('open')) renderPeople();
          } else {
            lastMultiAnalyses = [];
          }
        } else {
          renderFeedback({detected:false});
        }
      }catch(err){ /* skip frame on transient error */ }
      tickFps();
    }

    if (mode === 'video' && videoEl.ended) return;
    rafId = requestAnimationFrame(loop);
  }

  // ---------- Init ----------
  log('Booting MIRROR pose lab…');
  drawSparkline();
  reloadDetector();
})();
