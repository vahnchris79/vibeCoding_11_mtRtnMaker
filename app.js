/**
 * Workout Routine Timer - Core Application Logic
 * Pure ES6+ Vanilla JavaScript implementation
 */

// ==========================================================================
// 1. Initial State & Data Definitions
// ==========================================================================

const INITIAL_STAGES = [
  { id: 'stage-1', name: '가벼운 스트레칭', workSeconds: 20, restSeconds: 10, totalRounds: 2 },
  { id: 'stage-2', name: '스쿼트 (Squat)', workSeconds: 30, restSeconds: 15, totalRounds: 3 },
  { id: 'stage-3', name: '플랭크 (Plank)', workSeconds: 40, restSeconds: 20, totalRounds: 2 }
];

const state = {
  stages: JSON.parse(JSON.stringify(INITIAL_STAGES)),
  prepareSeconds: 5,
  soundEnabled: true,

  // Runtime State
  status: 'IDLE', // 'IDLE' | 'RUNNING' | 'PAUSED' | 'WAIT_NEXT' | 'COMPLETED'
  currentPhase: 'IDLE', // 'IDLE' | 'PREPARE' | 'WORK' | 'REST' | 'WAIT_NEXT' | 'COMPLETED'
  currentStageIndex: 0,
  currentRound: 1,
  remainingSeconds: 0,
  phaseTotalSeconds: 0,

  // Internal Timer Reference
  timerId: null,
  lastTickTime: null
};

// ==========================================================================
// 2. DOM Elements Selection
// ==========================================================================

const DOM = {
  displayCard: document.getElementById('displayCard'),
  phaseBadge: document.getElementById('phaseBadge'),
  stageProgressText: document.getElementById('stageProgressText'),
  currentExerciseName: document.getElementById('currentExerciseName'),
  currentRoundBadge: document.getElementById('currentRoundBadge'),
  timerDisplay: document.getElementById('timerDisplay'),
  progressBarFill: document.getElementById('progressBarFill'),
  nextPreviewCard: document.getElementById('nextPreviewCard'),
  nextContentText: document.getElementById('nextContentText'),

  // Controls
  btnStart: document.getElementById('btnStart'),
  btnStartText: document.getElementById('btnStartText'),
  btnPause: document.getElementById('btnPause'),
  btnNext: document.getElementById('btnNext'),
  btnReset: document.getElementById('btnReset'),

  // Settings
  prepareSecondsInput: document.getElementById('prepareSecondsInput'),
  soundToggle: document.getElementById('soundToggle'),

  // Stage Builder
  btnAddStage: document.getElementById('btnAddStage'),
  stageListContainer: document.getElementById('stageListContainer'),
  summaryTotalTime: document.getElementById('summaryTotalTime')
};

// ==========================================================================
// 3. Audio Synthesizer (Web Audio API - No External Assets Needed)
// ==========================================================================

class SoundManager {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playBeep(freq = 440, duration = 0.1, type = 'sine', gainVal = 0.15) {
    if (!state.soundEnabled) return;
    try {
      this.init();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  }

  playShortTick() {
    this.playBeep(520, 0.08, 'triangle', 0.12);
  }

  playPhaseStart() {
    this.playBeep(880, 0.2, 'sine', 0.2);
    setTimeout(() => this.playBeep(1100, 0.25, 'sine', 0.2), 100);
  }

  playRestStart() {
    this.playBeep(660, 0.25, 'sine', 0.15);
  }

  playRoutineComplete() {
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      setTimeout(() => this.playBeep(freq, 0.35, 'triangle', 0.22), idx * 160);
    });
  }
}

const soundManager = new SoundManager();

// ==========================================================================
// 4. Formatting Utilities
// ==========================================================================

function formatTime(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function calculateTotalRoutineTime() {
  const prep = Number(state.prepareSeconds) || 0;
  let routineSec = prep;

  state.stages.forEach(st => {
    const rounds = Math.max(1, Number(st.totalRounds) || 1);
    const work = Math.max(1, Number(st.workSeconds) || 0);
    const rest = Math.max(0, Number(st.restSeconds) || 0);
    routineSec += rounds * (work + rest);
  });

  const minutes = Math.floor(routineSec / 60);
  const seconds = routineSec % 60;
  let str = '';
  if (minutes > 0) str += `${minutes}분 `;
  str += `${seconds}초`;
  return `총 ${state.stages.length}개 단계 · 예상 소요 시간 약 ${str}`;
}

// ==========================================================================
// 5. Stage Builder Rendering & Interaction
// ==========================================================================

function renderStageList() {
  DOM.stageListContainer.innerHTML = '';

  state.stages.forEach((stage, idx) => {
    const row = document.createElement('div');
    row.className = 'stage-row';
    row.dataset.id = stage.id;
    row.dataset.index = idx;

    // 실행 중인 스테이지 하이라이트
    if (state.status !== 'IDLE' && state.currentStageIndex === idx) {
      row.classList.add('active-executing');
    }

    const isLocked = state.status === 'RUNNING' || state.status === 'PAUSED' || state.status === 'WAIT_NEXT';

    row.innerHTML = `
      <div class="stage-idx-badge">${idx + 1}</div>
      <input type="text" class="field-input stage-name-input" value="${escapeHtml(stage.name)}" placeholder="운동 이름" ${isLocked ? 'disabled' : ''} data-field="name">
      <div class="unit-input-group">
        <input type="number" class="field-input" min="1" max="3600" value="${stage.workSeconds}" ${isLocked ? 'disabled' : ''} data-field="workSeconds">
        <span class="unit-tag">초</span>
      </div>
      <div class="unit-input-group">
        <input type="number" class="field-input" min="0" max="3600" value="${stage.restSeconds}" ${isLocked ? 'disabled' : ''} data-field="restSeconds">
        <span class="unit-tag">초</span>
      </div>
      <div class="unit-input-group">
        <input type="number" class="field-input" min="1" max="99" value="${stage.totalRounds}" ${isLocked ? 'disabled' : ''} data-field="totalRounds">
        <span class="unit-tag">R</span>
      </div>
      <button type="button" class="btn-delete-stage" title="이 단계 삭제" ${isLocked || state.stages.length <= 1 ? 'disabled' : ''} data-action="delete">
        ✕
      </button>
    `;

    DOM.stageListContainer.appendChild(row);
  });

  DOM.summaryTotalTime.textContent = calculateTotalRoutineTime();
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function handleStageContainerInput(e) {
  const target = e.target;
  const row = target.closest('.stage-row');
  if (!row) return;

  const stageId = row.dataset.id;
  const stage = state.stages.find(s => s.id === stageId);
  if (!stage) return;

  const field = target.dataset.field;
  if (field === 'name') {
    stage.name = target.value.trim() || '새 운동';
  } else if (field === 'workSeconds') {
    stage.workSeconds = Math.max(1, parseInt(target.value, 10) || 1);
  } else if (field === 'restSeconds') {
    stage.restSeconds = Math.max(0, parseInt(target.value, 10) || 0);
  } else if (field === 'totalRounds') {
    stage.totalRounds = Math.max(1, parseInt(target.value, 10) || 1);
  }

  DOM.summaryTotalTime.textContent = calculateTotalRoutineTime();
  if (state.status === 'IDLE') {
    updateDisplayForIdle();
  }
}

function handleStageContainerClick(e) {
  const btn = e.target.closest('[data-action="delete"]');
  if (!btn || btn.disabled) return;

  const row = btn.closest('.stage-row');
  if (!row) return;

  const stageId = row.dataset.id;
  if (state.stages.length <= 1) return;

  state.stages = state.stages.filter(s => s.id !== stageId);
  renderStageList();
  if (state.status === 'IDLE') {
    updateDisplayForIdle();
  }
}

function handleAddStage() {
  if (state.status === 'RUNNING' || state.status === 'PAUSED' || state.status === 'WAIT_NEXT') return;

  const newId = `stage-${Date.now()}`;
  const defaultNames = ['점핑잭', '마운틴 클라이머', '런지', '푸시업', '버피'];
  const randomName = defaultNames[state.stages.length % defaultNames.length];

  state.stages.push({
    id: newId,
    name: randomName,
    workSeconds: 30,
    restSeconds: 15,
    totalRounds: 3
  });

  renderStageList();
  if (state.status === 'IDLE') {
    updateDisplayForIdle();
  }

  // 새로 추가된 행으로 스크롤 부드럽게 이동
  const lastRow = DOM.stageListContainer.lastElementChild;
  if (lastRow) {
    lastRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ==========================================================================
// 6. Theme & Visual Updating
// ==========================================================================

function applyTheme(themeKey) {
  const root = document.documentElement;
  const themeMap = {
    IDLE: {
      accent: 'var(--theme-idle)',
      soft: 'var(--theme-idle-soft)',
      border: 'var(--theme-idle-border)',
      glow: 'rgba(79, 70, 229, 0.15)'
    },
    PREPARE: {
      accent: 'var(--theme-prepare)',
      soft: 'var(--theme-prepare-soft)',
      border: 'var(--theme-prepare-border)',
      glow: 'rgba(139, 92, 246, 0.2)'
    },
    WORK: {
      accent: 'var(--theme-work)',
      soft: 'var(--theme-work-soft)',
      border: 'var(--theme-work-border)',
      glow: 'var(--theme-work-glow)'
    },
    REST: {
      accent: 'var(--theme-rest)',
      soft: 'var(--theme-rest-soft)',
      border: 'var(--theme-rest-border)',
      glow: 'var(--theme-rest-glow)'
    },
    WAIT_NEXT: {
      accent: 'var(--theme-wait)',
      soft: 'var(--theme-wait-soft)',
      border: 'var(--theme-wait-border)',
      glow: 'rgba(245, 158, 11, 0.25)'
    },
    COMPLETED: {
      accent: 'var(--theme-completed)',
      soft: '#ecfdf5',
      border: '#a7f3d0',
      glow: 'rgba(5, 150, 105, 0.2)'
    }
  };

  const selected = themeMap[themeKey] || themeMap.IDLE;
  root.style.setProperty('--active-accent', selected.accent);
  root.style.setProperty('--active-accent-soft', selected.soft);
  root.style.setProperty('--active-accent-border', selected.border);
  root.style.setProperty('--active-glow', selected.glow);
}

function updateNextPreview() {
  const currentStage = state.stages[state.currentStageIndex];
  const nextStage = state.stages[state.currentStageIndex + 1];

  if (state.currentPhase === 'PREPARE') {
    if (currentStage) {
      DOM.nextContentText.textContent = `${currentStage.name} (운동 ${currentStage.workSeconds}초 · ${currentStage.totalRounds}R)`;
    }
    return;
  }

  if (state.currentPhase === 'WORK') {
    if (currentStage && currentStage.restSeconds > 0) {
      DOM.nextContentText.textContent = `휴식 (${currentStage.restSeconds}초)`;
    } else if (state.currentRound < currentStage.totalRounds) {
      DOM.nextContentText.textContent = `${currentStage.name} (Round ${state.currentRound + 1}/${currentStage.totalRounds})`;
    } else if (nextStage) {
      DOM.nextContentText.textContent = `다음 스테이지: ${nextStage.name} (${nextStage.workSeconds}초 x ${nextStage.totalRounds}R)`;
    } else {
      DOM.nextContentText.textContent = '루틴 완료 🎉';
    }
    return;
  }

  if (state.currentPhase === 'REST') {
    if (state.currentRound < currentStage.totalRounds) {
      DOM.nextContentText.textContent = `${currentStage.name} (Round ${state.currentRound + 1}/${currentStage.totalRounds})`;
    } else if (nextStage) {
      DOM.nextContentText.textContent = `다음 스테이지: ${nextStage.name} (${nextStage.workSeconds}초 x ${nextStage.totalRounds}R)`;
    } else {
      DOM.nextContentText.textContent = '루틴 완료 🎉';
    }
    return;
  }

  if (state.currentPhase === 'WAIT_NEXT') {
    if (nextStage) {
      DOM.nextContentText.textContent = `[다음]을 눌러 '${nextStage.name}' 시작하기`;
    } else {
      DOM.nextContentText.textContent = '모든 운동이 완료되었습니다 🎉';
    }
    return;
  }

  if (state.currentPhase === 'COMPLETED') {
    DOM.nextContentText.textContent = '수고하셨습니다! 모든 루틴을 달성했습니다 🏆';
    return;
  }

  // IDLE
  if (state.stages.length > 0) {
    const first = state.stages[0];
    DOM.nextContentText.textContent = `${first.name} (운동 ${first.workSeconds}초 · ${first.totalRounds}R)`;
  }
}

function updateDisplayForIdle() {
  applyTheme('IDLE');
  DOM.phaseBadge.className = 'phase-badge badge-idle';
  DOM.phaseBadge.textContent = '대기 중';

  const firstStage = state.stages[0];
  if (firstStage) {
    DOM.stageProgressText.textContent = `Step 1 of ${state.stages.length}`;
    DOM.currentExerciseName.textContent = firstStage.name;
    DOM.currentRoundBadge.textContent = `Round 1 / ${firstStage.totalRounds}`;
    const initialSec = state.prepareSeconds > 0 ? state.prepareSeconds : firstStage.workSeconds;
    DOM.timerDisplay.textContent = formatTime(initialSec);
  } else {
    DOM.stageProgressText.textContent = 'Step 0 of 0';
    DOM.currentExerciseName.textContent = '운동을 추가하세요';
    DOM.currentRoundBadge.textContent = 'Round 0 / 0';
    DOM.timerDisplay.textContent = '00:00';
  }

  DOM.progressBarFill.style.width = '100%';
  DOM.timerDisplay.classList.remove('pulse-urgent');
  DOM.btnNext.classList.remove('highlight-next');
  updateNextPreview();
  updateButtonStates();
}

function updateButtonStates() {
  switch (state.status) {
    case 'IDLE':
      DOM.btnStart.disabled = state.stages.length === 0;
      DOM.btnStartText.textContent = '루틴 시작';
      DOM.btnPause.disabled = true;
      DOM.btnNext.disabled = true;
      DOM.btnReset.disabled = true;
      DOM.btnAddStage.disabled = false;
      DOM.prepareSecondsInput.disabled = false;
      break;

    case 'RUNNING':
      DOM.btnStart.disabled = true;
      DOM.btnStartText.textContent = '진행 중';
      DOM.btnPause.disabled = false;
      DOM.btnNext.disabled = false; // 언제든 다음 스테이지 스킵 가능
      DOM.btnReset.disabled = false;
      DOM.btnAddStage.disabled = true;
      DOM.prepareSecondsInput.disabled = true;
      break;

    case 'PAUSED':
      DOM.btnStart.disabled = false;
      DOM.btnStartText.textContent = '계속하기';
      DOM.btnPause.disabled = true;
      DOM.btnNext.disabled = false;
      DOM.btnReset.disabled = false;
      DOM.btnAddStage.disabled = true;
      DOM.prepareSecondsInput.disabled = true;
      break;

    case 'WAIT_NEXT':
      DOM.btnStart.disabled = true;
      DOM.btnStartText.textContent = '다음 대기 중';
      DOM.btnPause.disabled = true;
      DOM.btnNext.disabled = false; // 핵심 액션!
      DOM.btnReset.disabled = false;
      DOM.btnAddStage.disabled = true;
      DOM.prepareSecondsInput.disabled = true;
      break;

    case 'COMPLETED':
      DOM.btnStart.disabled = true;
      DOM.btnStartText.textContent = '완료됨';
      DOM.btnPause.disabled = true;
      DOM.btnNext.disabled = true;
      DOM.btnReset.disabled = false;
      DOM.btnAddStage.disabled = false;
      DOM.prepareSecondsInput.disabled = false;
      break;
  }
}

// ==========================================================================
// 7. Timer Engine & Sequence Execution
// ==========================================================================

function startRoutine() {
  if (state.stages.length === 0) {
    alert('최소 1개 이상의 운동 단계를 등록해 주세요.');
    return;
  }

  soundManager.init();

  if (state.status === 'PAUSED') {
    // 일시정지에서 재개
    resumeRoutine();
    return;
  }

  // 초기 시작
  state.status = 'RUNNING';
  state.currentStageIndex = 0;
  state.currentRound = 1;

  renderStageList(); // 활성 행 표시 및 입력 잠금

  if (state.prepareSeconds > 0) {
    enterPhase('PREPARE', state.prepareSeconds);
  } else {
    enterPhase('WORK', state.stages[0].workSeconds);
  }

  runTimerLoop();
}

function resumeRoutine() {
  state.status = 'RUNNING';
  updateButtonStates();
  runTimerLoop();
}

function pauseRoutine() {
  if (state.status !== 'RUNNING') return;
  state.status = 'PAUSED';
  clearInterval(state.timerId);
  state.timerId = null;
  updateButtonStates();
}

function resetRoutine() {
  clearInterval(state.timerId);
  state.timerId = null;
  state.status = 'IDLE';
  state.currentPhase = 'IDLE';
  state.currentStageIndex = 0;
  state.currentRound = 1;
  state.remainingSeconds = 0;

  renderStageList();
  updateDisplayForIdle();
}

function enterPhase(phase, durationSeconds) {
  state.currentPhase = phase;
  state.remainingSeconds = durationSeconds;
  state.phaseTotalSeconds = Math.max(1, durationSeconds);

  DOM.timerDisplay.classList.remove('pulse-urgent');
  DOM.btnNext.classList.remove('highlight-next');

  const currentStage = state.stages[state.currentStageIndex];

  switch (phase) {
    case 'PREPARE':
      applyTheme('PREPARE');
      DOM.phaseBadge.className = 'phase-badge badge-prepare';
      DOM.phaseBadge.textContent = '준비 (READY)';
      DOM.stageProgressText.textContent = `Step 1 of ${state.stages.length}`;
      DOM.currentExerciseName.textContent = '운동 시작 준비';
      DOM.currentRoundBadge.textContent = '자세를 잡아주세요';
      soundManager.playShortTick();
      break;

    case 'WORK':
      applyTheme('WORK');
      DOM.phaseBadge.className = 'phase-badge badge-work';
      DOM.phaseBadge.textContent = '운동 (WORK)';
      DOM.stageProgressText.textContent = `Step ${state.currentStageIndex + 1} of ${state.stages.length}`;
      DOM.currentExerciseName.textContent = currentStage.name;
      DOM.currentRoundBadge.textContent = `Round ${state.currentRound} / ${currentStage.totalRounds}`;
      soundManager.playPhaseStart();
      break;

    case 'REST':
      applyTheme('REST');
      DOM.phaseBadge.className = 'phase-badge badge-rest';
      DOM.phaseBadge.textContent = '휴식 (REST)';
      DOM.stageProgressText.textContent = `Step ${state.currentStageIndex + 1} of ${state.stages.length}`;
      DOM.currentExerciseName.textContent = `${currentStage.name} - 휴식`;
      DOM.currentRoundBadge.textContent = `Round ${state.currentRound} / ${currentStage.totalRounds}`;
      soundManager.playRestStart();
      break;

    case 'WAIT_NEXT':
      applyTheme('WAIT_NEXT');
      DOM.phaseBadge.className = 'phase-badge badge-wait';
      DOM.phaseBadge.textContent = '스테이지 완료';
      DOM.stageProgressText.textContent = `Step ${state.currentStageIndex + 1} of ${state.stages.length}`;
      DOM.currentExerciseName.textContent = `${currentStage.name} 완료!`;
      DOM.currentRoundBadge.textContent = '휴식 및 준비 완료 시 [다음] 클릭';
      DOM.timerDisplay.textContent = 'DONE';
      DOM.progressBarFill.style.width = '100%';
      DOM.btnNext.classList.add('highlight-next');
      state.status = 'WAIT_NEXT';
      updateButtonStates();
      updateNextPreview();
      soundManager.playPhaseStart();
      return;

    case 'COMPLETED':
      applyTheme('COMPLETED');
      DOM.phaseBadge.className = 'phase-badge badge-completed';
      DOM.phaseBadge.textContent = '루틴 완료';
      DOM.stageProgressText.textContent = `전체 ${state.stages.length}단계 완료!`;
      DOM.currentExerciseName.textContent = '🎉 모든 운동을 끝마쳤습니다!';
      DOM.currentRoundBadge.textContent = 'Great Job!';
      DOM.timerDisplay.textContent = 'CLEAR';
      DOM.progressBarFill.style.width = '100%';
      state.status = 'COMPLETED';
      clearInterval(state.timerId);
      state.timerId = null;
      renderStageList();
      updateButtonStates();
      updateNextPreview();
      soundManager.playRoutineComplete();
      return;
  }

  updateDisplayTime();
  updateNextPreview();
  renderStageList();
}

function updateDisplayTime() {
  DOM.timerDisplay.textContent = formatTime(state.remainingSeconds);

  // 진행률 바 업데이트 (현재 페이즈 기준)
  const pct = Math.max(0, Math.min(100, (state.remainingSeconds / state.phaseTotalSeconds) * 100));
  DOM.progressBarFill.style.width = `${pct}%`;

  // 마지막 3초 카운트다운 효과
  if (state.remainingSeconds <= 3 && state.remainingSeconds > 0) {
    DOM.timerDisplay.classList.add('pulse-urgent');
    soundManager.playShortTick();
  } else {
    DOM.timerDisplay.classList.remove('pulse-urgent');
  }
}

function runTimerLoop() {
  clearInterval(state.timerId);
  state.lastTickTime = Date.now();

  state.timerId = setInterval(() => {
    if (state.status !== 'RUNNING') return;

    if (state.remainingSeconds > 1) {
      state.remainingSeconds -= 1;
      updateDisplayTime();
    } else {
      // 0초 도달 -> 페이즈 전환 핸들러
      state.remainingSeconds = 0;
      updateDisplayTime();
      handlePhaseCompletion();
    }
  }, 1000);
}

function handlePhaseCompletion() {
  const currentStage = state.stages[state.currentStageIndex];

  // 1. 준비 완료 -> 첫 번째 스테이지 운동 시작
  if (state.currentPhase === 'PREPARE') {
    enterPhase('WORK', currentStage.workSeconds);
    return;
  }

  // 2. 운동 종료
  if (state.currentPhase === 'WORK') {
    if (currentStage.restSeconds > 0) {
      // 휴식 시간 진행
      enterPhase('REST', currentStage.restSeconds);
    } else {
      // 휴식 시간이 0초면 바로 라운드 처리
      proceedNextRoundOrWait();
    }
    return;
  }

  // 3. 휴식 종료
  if (state.currentPhase === 'REST') {
    proceedNextRoundOrWait();
    return;
  }
}

function proceedNextRoundOrWait() {
  const currentStage = state.stages[state.currentStageIndex];

  if (state.currentRound < currentStage.totalRounds) {
    // 같은 스테이지의 다음 라운드 진행
    state.currentRound += 1;
    enterPhase('WORK', currentStage.workSeconds);
  } else {
    // 해당 스테이지의 모든 라운드 종료!
    if (state.currentStageIndex + 1 < state.stages.length) {
      // 다음 스테이지가 남아있음 -> '다음' 버튼 대기 상태로 진입!
      enterPhase('WAIT_NEXT', 0);
    } else {
      // 모든 스테이지 완료!
      enterPhase('COMPLETED', 0);
    }
  }
}

/**
 * '다음(Next)' 버튼 클릭 핸들러
 * - WAIT_NEXT 상태에서는 바로 다음 스테이지로 진입
 * - 운동(WORK) 또는 휴식(REST) 진행 중일 때는 현재 스테이지를 즉시 스킵하고 다음 스테이지로 직행
 */
function handleNextClick() {
  if (state.status === 'IDLE' || state.status === 'COMPLETED') return;

  const nextStageIndex = state.currentStageIndex + 1;

  if (nextStageIndex < state.stages.length) {
    state.currentStageIndex = nextStageIndex;
    state.currentRound = 1;
    state.status = 'RUNNING';
    updateButtonStates();
    enterPhase('WORK', state.stages[state.currentStageIndex].workSeconds);
    runTimerLoop();
  } else {
    // 마지막 스테이지에서 다음을 누르면 완료 처리
    enterPhase('COMPLETED', 0);
  }
}

// ==========================================================================
// 8. Event Listeners Setup
// ==========================================================================

function initEvents() {
  // 컨트롤 버튼 이벤트
  DOM.btnStart.addEventListener('click', startRoutine);
  DOM.btnPause.addEventListener('click', pauseRoutine);
  DOM.btnNext.addEventListener('click', handleNextClick);
  DOM.btnReset.addEventListener('click', resetRoutine);

  // 단계 추가 이벤트
  DOM.btnAddStage.addEventListener('click', handleAddStage);

  // 스테이지 폼 이벤트 위임
  DOM.stageListContainer.addEventListener('input', handleStageContainerInput);
  DOM.stageListContainer.addEventListener('click', handleStageContainerClick);

  // 대기 시간 설정 변경
  DOM.prepareSecondsInput.addEventListener('change', (e) => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 0) val = 0;
    if (val > 60) val = 60;
    e.target.value = val;
    state.prepareSeconds = val;
    DOM.summaryTotalTime.textContent = calculateTotalRoutineTime();
    if (state.status === 'IDLE') {
      updateDisplayForIdle();
    }
  });

  // 사운드 토글
  DOM.soundToggle.addEventListener('change', (e) => {
    state.soundEnabled = e.target.checked;
    if (state.soundEnabled) {
      soundManager.init();
      soundManager.playShortTick();
    }
  });

  // 키보드 단축키 지원 (스페이스바: 시작/일시정지, N: 다음, R: 초기화)
  window.addEventListener('keydown', (e) => {
    // 텍스트 인풋 포커스 중에는 단축키 무시
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (state.status === 'IDLE' || state.status === 'PAUSED') {
        startRoutine();
      } else if (state.status === 'RUNNING') {
        pauseRoutine();
      }
    } else if (e.code === 'KeyN') {
      e.preventDefault();
      if (!DOM.btnNext.disabled) {
        handleNextClick();
      }
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      if (!DOM.btnReset.disabled) {
        resetRoutine();
      }
    }
  });
}

// ==========================================================================
// 9. Application Bootstrap
// ==========================================================================

function initApp() {
  renderStageList();
  updateDisplayForIdle();
  initEvents();
}

document.addEventListener('DOMContentLoaded', initApp);
