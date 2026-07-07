const STORAGE_KEY = 'reading-pick-draft-state-v4';
const OLD_KEYS = ['reading-draft-state-v1', 'reading-draft-state-v2', 'reading-pick-draft-state-v3'];
const TOTAL_ROUNDS = 3;
const ORIGINAL_BOOK_TITLES = new Set([
  'A Long Walk to Water',
  'The Giver',
  'The Boy Who Harnessed the Wind',
  'Refugee'
]);
const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
const BGM_SRC = 'bgm.mp3';
const PICK_LOCK_SFX_SRC = 'sounds/pick-confirm.mp3';
const PICK_LOCK_SFX_GAIN = 1.5;
const BGM_TARGET_VOLUME = 0.24;
const BGM_FADE_SECONDS = 3.6;

let books = [];
let students = [];
let state = null;
let bgm = null;
let bgmFrame = null;
let bgmDuckUntil = 0;
let pickLockSfx = null;
let pickLockSfxBuffer = null;
let audioContext = null;

const app = document.getElementById('app');

document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupAudio();

  try {
    const [booksResponse, studentsResponse] = await Promise.all([
      fetch('data/books.json'),
      fetch('data/students.json')
    ]);

    books = await booksResponse.json();
    students = await studentsResponse.json();
    state = loadState();
    render();
  } catch (error) {
    app.innerHTML = `
      <main class="app-shell">
        <section class="empty-state">
          <h1>데이터를 불러오지 못했습니다</h1>
          <p>${escapeHtml(error.message)}</p>
        </section>
      </main>
    `;
  }
}

function createInitialState() {
  return {
    phase: 'start',
    round: 1,
    pickIndex: 0,
    pickOrder: [],
    roundPool: [],
    currentRoundPicks: {},
    selectedBookTitle: null,
    ownedBooksByStudent: {},
    roundHistory: {},
    selectedTradeStudents: [],
    tradeLogByRound: {},
    returnPhase: null
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  OLD_KEYS.forEach((key) => localStorage.removeItem(key));

  if (!saved) {
    return createInitialState();
  }

  try {
    const parsed = JSON.parse(saved);
    return {
      ...createInitialState(),
      ...parsed,
      currentRoundPicks: parsed.currentRoundPicks || {},
      ownedBooksByStudent: parsed.ownedBooksByStudent || {},
      roundHistory: parsed.roundHistory || {},
      selectedTradeStudents: parsed.selectedTradeStudents || [],
      tradeLogByRound: parsed.tradeLogByRound || {}
    };
  } catch (error) {
    console.warn('Saved state ignored.', error);
    return createInitialState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setupAudio() {
  bgm = new Audio(BGM_SRC);
  bgm.preload = 'auto';
  bgm.volume = 0;
  bgm.addEventListener('ended', restartBgm);
  loadOptionalAudio(PICK_LOCK_SFX_SRC, 1).then((audio) => {
    pickLockSfx = audio;
  });
  loadOptionalAudioBuffer(PICK_LOCK_SFX_SRC).then((buffer) => {
    pickLockSfxBuffer = buffer;
  });

  document.addEventListener('pointerdown', unlockAudio, { capture: true });
  document.addEventListener('keydown', unlockAudio, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      startBgm();
    }
  });

  startBgm();
}

async function loadOptionalAudio(src, volume) {
  try {
    const response = await fetch(src, { method: 'HEAD', cache: 'no-store' });

    if (!response.ok) {
      return null;
    }

    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = volume;
    return audio;
  } catch (error) {
    return null;
  }
}

async function loadOptionalAudioBuffer(src) {
  const context = getAudioContext();

  if (!context) {
    return null;
  }

  try {
    const response = await fetch(src, { cache: 'no-store' });

    if (!response.ok) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return context.decodeAudioData(arrayBuffer);
  } catch (error) {
    return null;
  }
}

function unlockAudio() {
  startBgm();
  resumeAudioContext();
}

function startBgm() {
  if (!bgm) {
    return;
  }

  const playPromise = bgm.play();
  if (playPromise?.then) {
    playPromise.then(scheduleBgmFade).catch(() => {});
    return;
  }

  scheduleBgmFade();
}

function restartBgm() {
  if (!bgm) {
    return;
  }

  bgm.currentTime = 0;
  bgm.volume = 0;
  startBgm();
}

function scheduleBgmFade() {
  cancelAnimationFrame(bgmFrame);

  const tick = () => {
    if (!bgm || bgm.paused) {
      bgmFrame = null;
      return;
    }

    updateBgmFade();
    bgmFrame = requestAnimationFrame(tick);
  };

  tick();
}

function updateBgmFade() {
  if (!bgm) {
    return;
  }

  const duration = bgm.duration;
  let fade = Math.min(1, bgm.currentTime / BGM_FADE_SECONDS);

  if (Number.isFinite(duration) && duration > BGM_FADE_SECONDS * 2) {
    const remaining = duration - bgm.currentTime;

    if (remaining <= 0.14) {
      bgm.currentTime = 0;
      fade = 0;
    } else {
      const fadeIn = Math.min(1, bgm.currentTime / BGM_FADE_SECONDS);
      const fadeOut = Math.min(1, Math.max(remaining, 0) / BGM_FADE_SECONDS);
      fade = Math.min(fadeIn, fadeOut);
    }
  }

  const duck = performance.now() < bgmDuckUntil ? 0.38 : 1;
  bgm.volume = clamp(BGM_TARGET_VOLUME * fade * duck, 0, BGM_TARGET_VOLUME);
}

function duckBgm(milliseconds = 900) {
  bgmDuckUntil = Math.max(bgmDuckUntil, performance.now() + milliseconds);
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  resumeAudioContext();
  return audioContext;
}

function resumeAudioContext() {
  if (audioContext?.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
}

function playBookSelectCue() {
  unlockAudio();

  const context = getAudioContext();
  if (!context) {
    return;
  }

  const now = context.currentTime;
  const bus = createSfxBus(context, 0.5, 0.45);

  playTone(context, bus, {
    type: 'triangle',
    start: now,
    duration: 0.16,
    from: 180,
    to: 720,
    gain: 0.16
  });
  playTone(context, bus, {
    type: 'sine',
    start: now + 0.05,
    duration: 0.11,
    from: 920,
    to: 1240,
    gain: 0.08
  });
  playNoise(context, bus, {
    start: now,
    duration: 0.08,
    gain: 0.11,
    filterType: 'highpass',
    frequency: 1800
  });
}

function playPickLockCue() {
  if (playAudioBufferCue(pickLockSfxBuffer, PICK_LOCK_SFX_GAIN, 1300)) {
    return;
  }

  if (playAudioFileCue(pickLockSfx, 1300)) {
    return;
  }

  playGeneratedPickLockCue();
}

function playGeneratedPickLockCue() {
  playLockCue({
    chord: [196, 247, 392],
    bassFrom: 88,
    bassTo: 38,
    accentFrom: 760,
    accentTo: 520
  });
}

function playAudioBufferCue(buffer, gain, duckMilliseconds) {
  if (!buffer) {
    return false;
  }

  unlockAudio();
  duckBgm(duckMilliseconds);

  const context = getAudioContext();

  if (!context) {
    return false;
  }

  try {
    const source = context.createBufferSource();
    const output = context.createGain();

    source.buffer = buffer;
    output.gain.setValueAtTime(gain, context.currentTime);
    source.connect(output);
    output.connect(context.destination);
    source.addEventListener('ended', () => {
      source.disconnect();
      output.disconnect();
    }, { once: true });
    source.start();
    return true;
  } catch (error) {
    return false;
  }
}

function playAudioFileCue(audio, duckMilliseconds) {
  if (!audio) {
    return false;
  }

  unlockAudio();
  duckBgm(duckMilliseconds);

  const cue = audio.cloneNode();
  cue.volume = audio.volume;

  const playPromise = cue.play();
  if (playPromise?.catch) {
    playPromise.catch(playGeneratedPickLockCue);
  }

  return true;
}

function playTradeLockCue() {
  playLockCue({
    chord: [147, 220, 294],
    bassFrom: 72,
    bassTo: 32,
    accentFrom: 540,
    accentTo: 290,
    doubleHit: true
  });
}

function playLockCue({ chord, bassFrom, bassTo, accentFrom, accentTo, doubleHit = false }) {
  unlockAudio();
  duckBgm(1200);

  const context = getAudioContext();
  if (!context) {
    return;
  }

  const now = context.currentTime;
  const bus = createSfxBus(context, 0.9, 1.35);

  playNoise(context, bus, {
    start: now,
    duration: 0.18,
    gain: 0.34,
    filterType: 'lowpass',
    frequency: 1100
  });
  playTone(context, bus, {
    type: 'sine',
    start: now,
    duration: 0.52,
    from: bassFrom,
    to: bassTo,
    gain: 0.42
  });
  chord.forEach((frequency, index) => {
    playTone(context, bus, {
      type: 'sawtooth',
      start: now + 0.025 + index * 0.012,
      duration: 0.82,
      from: frequency,
      to: frequency * 0.96,
      gain: 0.08
    });
  });
  playTone(context, bus, {
    type: 'square',
    start: now + 0.04,
    duration: 0.23,
    from: accentFrom,
    to: accentTo,
    gain: 0.045
  });

  if (doubleHit) {
    playNoise(context, bus, {
      start: now + 0.21,
      duration: 0.14,
      gain: 0.2,
      filterType: 'bandpass',
      frequency: 1800
    });
    playTone(context, bus, {
      type: 'sine',
      start: now + 0.18,
      duration: 0.46,
      from: bassFrom * 1.2,
      to: bassTo,
      gain: 0.26
    });
  }
}

function createSfxBus(context, gain, lifetime) {
  const bus = context.createGain();
  bus.gain.setValueAtTime(gain, context.currentTime);
  bus.connect(context.destination);
  window.setTimeout(() => bus.disconnect(), lifetime * 1000);
  return bus;
}

function playTone(context, destination, { type, start, duration, from, to, gain }) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const attack = Math.min(0.025, duration * 0.24);

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(from, 1), start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(to, 1), start + duration);

  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0001), start + attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(envelope);
  envelope.connect(destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.04);
}

function playNoise(context, destination, { start, duration, gain, filterType, frequency }) {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < frameCount; index += 1) {
    const decay = 1 - index / frameCount;
    data[index] = (Math.random() * 2 - 1) * decay;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const envelope = context.createGain();

  source.buffer = buffer;
  filter.type = filterType;
  filter.frequency.setValueAtTime(frequency, start);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0001), start + 0.01);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(destination);
  source.start(start);
  source.stop(start + duration + 0.02);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function render() {
  if (state.phase === 'draft') {
    renderDraft();
    return;
  }

  if (state.phase === 'trade') {
    renderTrade();
    return;
  }

  if (state.phase === 'final') {
    renderFinal();
    return;
  }

  renderStart();
}

function renderStart() {
  app.innerHTML = `
    <main class="app-shell">
      <section class="home-grid home-hero">
        <div class="hero-panel">
          <h1>Book Draft</h1>
          <div class="button-row">
            ${state.returnPhase ? '<button class="btn secondary" id="resume-draft">이어가기</button>' : ''}
            <button class="btn primary" id="start-draft">Start Draft</button>
            <button class="btn quiet" id="reset-state">전체 초기화</button>
          </div>
        </div>

        <aside class="scoreboard">
          <div><strong>${students.length}</strong><span>학생</span></div>
          <div><strong>${books.length}</strong><span>도서 풀</span></div>
          <div><strong>${TOTAL_ROUNDS}</strong><span>라운드</span></div>
        </aside>
      </section>

      <section class="panel">
        <div class="panel-title">
          <h2>참가 학생</h2>
        </div>
        <div class="student-grid">
          ${students.map(renderStudentBadge).join('')}
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">
          <h2>픽 가능 도서</h2>
        </div>
        <div class="book-grid preview">
          ${books.map((book) => renderBookCard(book)).join('')}
        </div>
      </section>
    </main>
  `;

  document.getElementById('start-draft').addEventListener('click', startDraft);
  document.getElementById('resume-draft')?.addEventListener('click', resumeDraft);
  document.getElementById('reset-state').addEventListener('click', resetState);
  hydrateImages();
}

function renderDraft() {
  const currentName = state.pickOrder[state.pickIndex];
  const currentStudent = currentName ? getStudent(currentName) : null;
  const isDone = state.pickIndex >= students.length;
  const eligibleTitles = currentStudent ? getEligibleBookTitles(currentStudent.name) : [];
  const selectedBook = state.selectedBookTitle ? getBook(state.selectedBookTitle) : null;
  const progress = Math.min(state.pickIndex, students.length);
  const leftoverCount = state.roundPool.length;
  const leftOrder = state.pickOrder.slice(0, 6);
  const rightOrder = state.pickOrder.slice(6);
  const selectedCreatesOriginalWarning = Boolean(currentStudent && selectedBook && wouldCreateOriginalOverflow(currentStudent.name, selectedBook.title));

  app.innerHTML = `
    <main class="app-shell pick-room">
      ${renderTopbar(`Round ${state.round} Pick`, `${progress}/${students.length} · ${leftoverCount}`)}

      <section class="pick-layout">
        <aside class="side-panel blue-side">
          <ol class="pick-order">
            ${leftOrder.map((name, index) => renderPickOrderItem(name, index)).join('')}
          </ol>
        </aside>

        <section class="center-stage">
          <div class="phase-banner">
            <div>
              <span class="eyebrow">${isDone ? 'PICK COMPLETE' : 'PICK PHASE'}</span>
              <h1>${isDone ? 'Round Complete' : escapeHtml(formatStudentName(currentStudent))}</h1>
            </div>
            ${currentStudent ? renderAvatar(currentStudent, 'xl') : ''}
          </div>

          <div class="selected-slot ${selectedBook ? 'locked' : ''} ${selectedCreatesOriginalWarning ? 'original-warning' : ''}">
            ${selectedBook ? renderSelectedBook(selectedBook, currentStudent) : renderEmptySelectedSlot(isDone)}
          </div>

          <div class="button-row stage-actions">
            <button class="btn primary" id="confirm-pick" ${state.selectedBookTitle && !isDone ? '' : 'disabled'}>픽 확정</button>
            <button class="btn secondary" id="finish-round" ${isDone ? '' : 'disabled'}>트레이드 단계로</button>
            <button class="btn quiet" id="undo-pick" ${canUndoLastPick() ? '' : 'disabled'}>직전 픽 취소</button>
            <button class="btn quiet" id="clear-selection" ${state.selectedBookTitle ? '' : 'disabled'}>선택 취소</button>
          </div>

          <div class="book-grid pick-grid">
            ${books.map((book) => renderPickBookCard(book, eligibleTitles, isDone)).join('')}
          </div>
        </section>

        <aside class="side-panel red-side">
          <ol class="pick-order">
            ${rightOrder.map((name, index) => renderPickOrderItem(name, index + 6)).join('')}
          </ol>
        </aside>
      </section>
    </main>
  `;

  document.querySelectorAll('.pick-book:not(.disabled)').forEach((card) => {
    card.addEventListener('click', () => selectBook(card.dataset.title));
  });
  document.getElementById('confirm-pick').addEventListener('click', confirmPick);
  document.getElementById('finish-round').addEventListener('click', finishRound);
  document.getElementById('undo-pick').addEventListener('click', undoLastPick);
  document.getElementById('clear-selection').addEventListener('click', clearSelection);
  bindTopbarActions();
  hydrateImages();
}

function renderTrade() {
  const selected = state.selectedTradeStudents;
  const [firstName, secondName] = selected;
  const firstBook = state.currentRoundPicks[firstName];
  const secondBook = state.currentRoundPicks[secondName];
  const canExchange = selected.length === 2 && isValidTrade(firstName, secondName);
  const originalViolations = getOriginalRuleViolations();
  const canLeaveTrade = originalViolations.length === 0;
  const log = state.tradeLogByRound[state.round] || [];

  app.innerHTML = `
    <main class="app-shell">
      ${renderTopbar(`Round ${state.round} Trade`, `${selected.length}/2${originalViolations.length ? ` · 원서 경고 ${originalViolations.length}` : ''}`)}

      <section class="trade-header">
        <div>
          <span class="eyebrow">TRADE PHASE</span>
          <h1>${selected.length === 2 ? `${escapeHtml(firstName)} ↔ ${escapeHtml(secondName)}` : 'Trade'}</h1>
        </div>
        <div class="button-row">
          <button class="btn primary" id="exchange-books" ${canExchange ? '' : 'disabled'}>교환</button>
          <button class="btn secondary" id="next-round" ${canLeaveTrade ? '' : 'disabled'}>${state.round >= TOTAL_ROUNDS ? '최종 결과로' : '다음 라운드로'}</button>
          <button class="btn quiet" id="undo-pick" ${canUndoLastPick() ? '' : 'disabled'}>직전 픽 취소</button>
          <button class="btn quiet" id="reset-state">전체 초기화</button>
        </div>
      </section>

      ${originalViolations.length ? `
        <section class="trade-warning-panel">
          <strong>원서 2권 이상</strong>
          <span>${originalViolations.map(({ student, count }) => `${escapeHtml(student.name)} ${count}권`).join(' · ')}</span>
        </section>
      ` : ''}

      <section class="trade-grid">
        ${students.map(renderTradeCard).join('')}
      </section>

      <section class="panel">
        <div class="panel-title">
          <h2>교환 로그</h2>
        </div>
        <div class="log-list">
          ${log.length ? log.map((entry) => `<div>${escapeHtml(entry)}</div>`).join('') : '<div class="muted">아직 교환 내역이 없습니다.</div>'}
        </div>
      </section>
    </main>
  `;

  document.querySelectorAll('.trade-card').forEach((card) => {
    card.addEventListener('click', () => toggleTradeSelection(card.dataset.studentName));
  });
  document.getElementById('exchange-books').addEventListener('click', exchangeSelectedBooks);
  document.getElementById('next-round').addEventListener('click', commitRoundAndContinue);
  document.getElementById('undo-pick').addEventListener('click', undoLastPick);
  document.getElementById('reset-state').addEventListener('click', resetState);
  bindTopbarActions();
  hydrateImages();
}

function renderFinal() {
  app.innerHTML = `
    <main class="app-shell">
      ${renderTopbar('Final', '3/3')}

      <section class="trade-header">
        <div>
          <span class="eyebrow">FINAL ROSTER</span>
          <h1>Book Draft</h1>
        </div>
        <div class="button-row">
          <button class="btn primary" id="transfer-results">결과 전송</button>
          <button class="btn quiet" id="reset-state">처음부터 다시</button>
        </div>
      </section>

      <section class="final-grid">
        ${students.map(renderFinalCard).join('')}
      </section>
    </main>
  `;

  document.getElementById('transfer-results').addEventListener('click', openResultsTransferPopup);
  document.getElementById('reset-state').addEventListener('click', resetState);
  bindTopbarActions();
  hydrateImages();
  bindFinalBookTooltips();
}

function renderTopbar(title, meta) {
  return `
    <header class="topbar">
      <div>
        <span>Book Draft</span>
        <strong>${escapeHtml(title)}</strong>
      </div>
      <div class="top-actions">
        <span class="top-meta">${escapeHtml(meta)}</span>
        <button class="btn quiet small" id="go-home">초기 화면</button>
      </div>
    </header>
  `;
}

function renderStudentBadge(student) {
  return `
    <article class="student-badge">
      ${renderAvatar(student)}
      <div>
        <strong>${escapeHtml(formatStudentName(student))}</strong>
      </div>
    </article>
  `;
}

function renderAvatar(student, size = '') {
  return `
    <div class="avatar ${size}">
      <img class="student-photo" data-student-name="${escapeHtml(student.name)}" alt="${escapeHtml(student.name)}" />
      <span>${escapeHtml(student.englishName.charAt(0).toUpperCase())}</span>
    </div>
  `;
}

function renderBookCard(book, className = '') {
  return `
    <article class="book-card ${className}">
      <img class="book-cover" src="images/books/${encodeURIComponent(book.slug)}.jpg" data-title="${escapeHtml(book.title)}" alt="${escapeHtml(book.title)}" />
      <div>
        <strong>${escapeHtml(book.title)}</strong>
        <span>${escapeHtml(book.author)}</span>
        <small>${escapeHtml(book.publisher)} · ${book.year}</small>
      </div>
    </article>
  `;
}

function renderBookCoverByTitle(title, className = '') {
  if (!title) {
    return `<span class="empty-cover ${className}"></span>`;
  }

  const book = getBook(title);
  return `<img class="book-cover book-cover-only ${className}" src="images/books/${encodeURIComponent(book.slug)}.jpg" data-title="${escapeHtml(book.title)}" data-author="${escapeHtml(book.author)}" data-pages="${escapeHtml(book.pages || '')}" alt="${escapeHtml(book.title)}" />`;
}

function renderPickBookCard(book, eligibleTitles, isDone) {
  const alreadyPicked = Boolean(getPickerForTitle(book.title));
  const ineligible = !eligibleTitles.includes(book.title);
  const selected = state.selectedBookTitle === book.title;
  const disabled = isDone || alreadyPicked || ineligible;

  return `
    <article class="book-card pick-book ${isOriginalBookTitle(book.title) ? 'original-book' : ''} ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}" data-title="${escapeHtml(book.title)}">
      <img class="book-cover" src="images/books/${encodeURIComponent(book.slug)}.jpg" data-title="${escapeHtml(book.title)}" alt="${escapeHtml(book.title)}" />
    </article>
  `;
}

function renderSelectedBook(book, student) {
  return `
    <div class="selected-book-display">
      <img class="book-cover selected-book-cover" src="images/books/${encodeURIComponent(book.slug)}.jpg" data-title="${escapeHtml(book.title)}" alt="${escapeHtml(book.title)}" />
      <div class="selected-book-overlay">
        <h2>${escapeHtml(book.title)}</h2>
        <span>${escapeHtml(book.author)}</span>
        ${book.pages ? `<strong>${book.pages}쪽</strong>` : ''}
      </div>
    </div>
  `;
}

function renderEmptySelectedSlot(isDone) {
  return `
    <div class="empty-lock">
      <strong>${isDone ? '픽 완료' : '도서 선택'}</strong>
    </div>
  `;
}

function renderPickOrderItem(name, index) {
  const student = getStudent(name);
  const pickedTitle = state.currentRoundPicks[name];
  const originalCount = getOriginalCountForStudent(name);
  const className = [
    index < state.pickIndex ? 'done' : '',
    index === state.pickIndex ? 'active' : '',
    pickedTitle ? 'has-current-pick' : '',
    originalCount > 1 ? 'original-warning' : ''
  ].filter(Boolean).join(' ');
  const previousTitles = getOwnedBooks(name);

  return `
    <li class="${className}">
      <span class="order-number">${index + 1}</span>
      ${renderAvatar(student)}
      <div>
        <strong>${escapeHtml(formatStudentName(student))}</strong>
        ${originalCount > 1 ? `<small class="original-alert">원서 ${originalCount}권</small>` : ''}
        <div class="student-book-stack">
          ${previousTitles.map((title) => renderBookCoverByTitle(title, 'order-cover')).join('')}
          ${pickedTitle ? renderBookCoverByTitle(pickedTitle, 'order-cover current-pick-cover') : ''}
        </div>
      </div>
    </li>
  `;
}

function renderTradeCard(student) {
  const currentTitle = state.currentRoundPicks[student.name];
  const currentBook = currentTitle ? getBook(currentTitle) : null;
  const selected = state.selectedTradeStudents.includes(student.name);
  const previous = getOwnedBooks(student.name).filter((_, index) => index !== state.round - 1);
  const originalCount = getOriginalCountForStudent(student.name);

  return `
    <article class="trade-card ${selected ? 'selected' : ''} ${originalCount > 1 ? 'original-warning' : ''}" data-student-name="${escapeHtml(student.name)}">
      <div class="student-badge">
        ${renderAvatar(student)}
        <div>
          <strong>${escapeHtml(formatStudentName(student))}</strong>
          ${originalCount > 1 ? `<span class="original-alert">원서 ${originalCount}권</span>` : ''}
        </div>
      </div>
      <div class="trade-cover">
        ${currentBook ? renderBookCoverByTitle(currentBook.title, 'trade-cover-img') : renderBookCoverByTitle(null, 'trade-cover-img')}
      </div>
      <div class="previous-list cover-list">
        ${previous.length ? previous.map((title) => renderBookCoverByTitle(title, 'previous-cover')).join('') : ''}
      </div>
    </article>
  `;
}

function renderFinalCard(student) {
  const owned = getOwnedBooks(student.name);
  return `
    <article class="final-card">
      <div class="student-badge">
        ${renderAvatar(student)}
        <div>
          <strong>${escapeHtml(formatStudentName(student))}</strong>
        </div>
      </div>
      <ol>
        ${[0, 1, 2].map((index) => `<li class="final-pick-slot round-${index + 1}"><span class="round-label">${index + 1}차</span>${renderBookCoverByTitle(owned[index], 'final-cover')}</li>`).join('')}
      </ol>
    </article>
  `;
}

function bindTopbarActions() {
  document.getElementById('go-home')?.addEventListener('click', goHome);
}

function startDraft() {
  state = createInitialState();
  startRound(1);
}

function resumeDraft() {
  if (!state.returnPhase) {
    return;
  }
  state.phase = state.returnPhase;
  state.returnPhase = null;
  saveState();
  render();
}

function goHome() {
  if (state.phase !== 'start') {
    state.returnPhase = state.phase;
    state.phase = 'start';
    saveState();
    render();
  }
}

function startRound(round) {
  state.phase = 'draft';
  state.round = round;
  state.pickIndex = 0;
  state.pickOrder = shuffle(students.map((student) => student.name));
  state.roundPool = books.map((book) => book.title);
  state.currentRoundPicks = {};
  state.selectedBookTitle = null;
  state.selectedTradeStudents = [];
  state.returnPhase = null;
  saveState();
  render();
}

function selectBook(title) {
  playBookSelectCue();
  state.selectedBookTitle = title;
  saveState();
  render();
}

function clearSelection() {
  state.selectedBookTitle = null;
  saveState();
  render();
}

function canUndoLastPick() {
  if (state.phase === 'trade' && hasCurrentRoundTrades()) {
    return false;
  }

  if (!['draft', 'trade'].includes(state.phase) || state.pickIndex <= 0) {
    return false;
  }

  const previousName = state.pickOrder[state.pickIndex - 1];
  return Boolean(previousName && state.currentRoundPicks[previousName]);
}

function undoLastPick() {
  if (!canUndoLastPick()) {
    return;
  }

  const previousIndex = state.pickIndex - 1;
  const previousName = state.pickOrder[previousIndex];
  const restoredTitle = state.currentRoundPicks[previousName];

  delete state.currentRoundPicks[previousName];
  state.roundPool = restoreTitleToRoundPool(restoredTitle);
  state.selectedBookTitle = restoredTitle;
  state.pickIndex = previousIndex;
  state.phase = 'draft';
  state.selectedTradeStudents = [];
  delete state.roundHistory[state.round];
  saveState();
  render();
}

function confirmPick() {
  const studentName = state.pickOrder[state.pickIndex];
  const selected = state.selectedBookTitle;

  if (!studentName || !selected || !getEligibleBookTitles(studentName).includes(selected)) {
    return;
  }

  playPickLockCue();
  state.currentRoundPicks[studentName] = selected;
  state.roundPool = state.roundPool.filter((title) => title !== selected);
  state.selectedBookTitle = null;
  state.pickIndex += 1;
  saveState();
  render();
}

function finishRound() {
  if (state.pickIndex < students.length) {
    return;
  }
  state.roundHistory[state.round] = { ...state.currentRoundPicks };
  state.phase = 'trade';
  state.selectedTradeStudents = [];
  saveState();
  render();
}

function toggleTradeSelection(studentName) {
  if (state.selectedTradeStudents.includes(studentName)) {
    state.selectedTradeStudents = state.selectedTradeStudents.filter((name) => name !== studentName);
  } else if (state.selectedTradeStudents.length < 2) {
    state.selectedTradeStudents = [...state.selectedTradeStudents, studentName];
  } else {
    state.selectedTradeStudents = [state.selectedTradeStudents[1], studentName];
  }
  saveState();
  render();
}

function exchangeSelectedBooks() {
  const [firstName, secondName] = state.selectedTradeStudents;
  const firstBook = state.currentRoundPicks[firstName];
  const secondBook = state.currentRoundPicks[secondName];

  if (!isValidTrade(firstName, secondName)) {
    return;
  }

  playTradeLockCue();
  state.currentRoundPicks[firstName] = secondBook;
  state.currentRoundPicks[secondName] = firstBook;
  state.roundHistory[state.round] = { ...state.currentRoundPicks };

  if (!state.tradeLogByRound[state.round]) {
    state.tradeLogByRound[state.round] = [];
  }
  state.tradeLogByRound[state.round].push(`${firstName} ↔ ${secondName}: ${firstBook} ↔ ${secondBook}`);
  state.selectedTradeStudents = [];
  saveState();
  render();
}

function isValidTrade(firstName, secondName) {
  const firstBook = state.currentRoundPicks[firstName];
  const secondBook = state.currentRoundPicks[secondName];

  if (!firstName || !secondName || !firstBook || !secondBook || firstBook === secondBook) {
    return false;
  }

  return canReceiveBook(firstName, secondBook) && canReceiveBook(secondName, firstBook);
}

function commitRoundAndContinue() {
  if (getOriginalRuleViolations().length) {
    render();
    return;
  }

  commitCurrentRound();

  if (state.round >= TOTAL_ROUNDS) {
    state.phase = 'final';
    saveState();
    render();
    return;
  }

  startRound(state.round + 1);
}

function commitCurrentRound() {
  state.roundHistory[state.round] = { ...state.currentRoundPicks };
  students.forEach((student) => {
    const title = state.currentRoundPicks[student.name];
    if (!title) {
      return;
    }
    if (!state.ownedBooksByStudent[student.name]) {
      state.ownedBooksByStudent[student.name] = [];
    }
    state.ownedBooksByStudent[student.name][state.round - 1] = title;
  });
}

function resetState() {
  localStorage.removeItem(STORAGE_KEY);
  OLD_KEYS.forEach((key) => localStorage.removeItem(key));
  state = createInitialState();
  render();
}

function openResultsTransferPopup() {
  document.querySelector('.export-popup')?.remove();

  const readableText = createReadableResultsText();
  const popup = document.createElement('div');
  const panel = document.createElement('section');
  const header = document.createElement('div');
  const title = document.createElement('h2');
  const board = document.createElement('div');
  const actions = document.createElement('div');
  const copyButton = document.createElement('button');
  const closeButton = document.createElement('button');

  popup.className = 'export-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'true');

  panel.className = 'export-panel';
  header.className = 'export-header';
  title.textContent = '결과 전송';

  board.className = 'results-transfer-board';
  board.innerHTML = renderResultsTransferTable();

  actions.className = 'button-row export-actions';
  copyButton.className = 'btn primary';
  copyButton.type = 'button';
  copyButton.textContent = '복사';
  closeButton.className = 'btn quiet';
  closeButton.type = 'button';
  closeButton.textContent = '닫기';

  const close = () => {
    popup.remove();
    document.removeEventListener('keydown', handleKeydown);
  };
  const handleKeydown = (event) => {
    if (event.key === 'Escape') {
      close();
    }
  };

  copyButton.addEventListener('click', async () => {
    if (await copyTextToClipboard(readableText)) {
      copyButton.textContent = '복사됨';
      return;
    }

    copyButton.textContent = '복사 실패';
  });
  closeButton.addEventListener('click', close);
  popup.addEventListener('click', (event) => {
    if (event.target === popup) {
      close();
    }
  });
  document.addEventListener('keydown', handleKeydown);

  header.append(title);
  actions.append(copyButton, closeButton);
  panel.append(header, board, actions);
  popup.append(panel);
  document.body.append(popup);
}

function renderResultsTransferTable() {
  return `
    <table class="results-table">
      <thead>
        <tr>
          <th>이름</th>
          <th>1차</th>
          <th>2차</th>
          <th>3차</th>
        </tr>
      </thead>
      <tbody>
        ${students.map((student) => {
          const owned = getOwnedBooks(student.name);
          return `
            <tr>
              <th>${escapeHtml(student.name)}</th>
              <td>${escapeHtml(owned[0] || '')}</td>
              <td>${escapeHtml(owned[1] || '')}</td>
              <td>${escapeHtml(owned[2] || '')}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function createReadableResultsText() {
  const rows = [['이름', '1차', '2차', '3차']];

  students.forEach((student) => {
    const owned = getOwnedBooks(student.name);
    rows.push([
      student.name,
      owned[0] || '',
      owned[1] || '',
      owned[2] || ''
    ]);
  });

  return rows.map((row) => row.map(formatResultCell).join(' | ')).join('\n');
}

function getEligibleBookTitles(studentName) {
  const owned = getOwnedBooks(studentName).filter(Boolean);
  return state.roundPool.filter((title) => !owned.includes(title));
}

function getPickerForTitle(title) {
  return Object.entries(state.currentRoundPicks).find(([, pickedTitle]) => pickedTitle === title)?.[0] || '';
}

function getOwnedBooks(studentName) {
  return state.ownedBooksByStudent[studentName] || [];
}

function canReceiveBook(studentName, title) {
  const owned = getOwnedBooks(studentName).filter((ownedTitle, index) => ownedTitle && index !== state.round - 1);

  return title ? !owned.includes(title) : false;
}

function hasCurrentRoundTrades() {
  return Boolean(state.tradeLogByRound[state.round]?.length);
}

function restoreTitleToRoundPool(title) {
  const restored = unique([...state.roundPool, title]);
  return books
    .map((book) => book.title)
    .filter((bookTitle) => restored.includes(bookTitle));
}

function getEffectiveOwnedBooks(studentName) {
  const owned = [...getOwnedBooks(studentName)];
  const currentTitle = state.currentRoundPicks[studentName];

  if (currentTitle) {
    owned[state.round - 1] = currentTitle;
  }

  return owned.filter(Boolean);
}

function getOriginalCountForStudent(studentName) {
  return countOriginalBooks(getEffectiveOwnedBooks(studentName));
}

function wouldCreateOriginalOverflow(studentName, title) {
  if (!isOriginalBookTitle(title)) {
    return false;
  }

  const owned = getOwnedBooks(studentName).filter((ownedTitle, index) => ownedTitle && index !== state.round - 1);
  return countOriginalBooks([...owned, title]) > 1;
}

function getOriginalRuleViolations() {
  return students
    .map((student) => ({
      student,
      count: getOriginalCountForStudent(student.name)
    }))
    .filter(({ count }) => count > 1);
}

function countOriginalBooks(titles) {
  return titles.filter(isOriginalBookTitle).length;
}

function isOriginalBookTitle(title) {
  return ORIGINAL_BOOK_TITLES.has(title);
}

function getStudent(name) {
  return students.find((student) => student.name === name) || students[0];
}

function getBook(title) {
  return books.find((book) => book.title === title) || books[0];
}

function formatStudentName(student) {
  return `${student.name}/${student.englishName}`;
}

function hydrateImages(root = document) {
  root.querySelectorAll('.book-cover').forEach((img) => {
    img.addEventListener('error', () => {
      if (img.dataset.fallback === 'true') {
        return;
      }
      img.dataset.fallback = 'true';
      img.src = createBookPlaceholder(img.dataset.title || img.alt || '도서');
    });
  });

  root.querySelectorAll('.student-photo').forEach((img) => {
    const rawName = img.dataset.studentName;
    const names = unique([rawName, rawName.normalize('NFC'), rawName.normalize('NFD')]);
    const candidates = names.flatMap((name) => PHOTO_EXTENSIONS.map((extension) => `images/students/${encodeURIComponent(name)}.${extension}`));
    let index = 0;

    const tryNext = () => {
      if (index >= candidates.length) {
        img.classList.add('missing');
        return;
      }
      img.src = candidates[index];
      index += 1;
    };

    img.addEventListener('load', () => img.classList.remove('missing'));
    img.addEventListener('error', tryNext);
    tryNext();
  });
}

function bindFinalBookTooltips() {
  const covers = document.querySelectorAll('.final-cover.book-cover');

  if (!covers.length) {
    return;
  }

  let tooltip = document.querySelector('.book-hover-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'book-hover-tooltip';
    document.body.append(tooltip);
  }

  const hide = () => {
    tooltip.classList.remove('visible');
  };

  covers.forEach((cover) => {
    cover.addEventListener('pointerenter', (event) => {
      tooltip.innerHTML = `
        <strong>${escapeHtml(cover.dataset.title || '')}</strong>
        <span>${escapeHtml(cover.dataset.author || '')}</span>
        ${cover.dataset.pages ? `<em>${escapeHtml(cover.dataset.pages)}쪽</em>` : ''}
      `;
      tooltip.classList.add('visible');
      moveBookTooltip(event, tooltip);
    });
    cover.addEventListener('pointermove', (event) => moveBookTooltip(event, tooltip));
    cover.addEventListener('pointerleave', hide);
    cover.addEventListener('pointercancel', hide);
  });
}

function moveBookTooltip(event, tooltip) {
  const offset = 18;
  const margin = 8;
  const rect = tooltip.getBoundingClientRect();
  let x = event.clientX + offset;
  let y = event.clientY + offset;

  if (x + rect.width > window.innerWidth - margin) {
    x = event.clientX - rect.width - offset;
  }

  if (y + rect.height > window.innerHeight - margin) {
    y = event.clientY - rect.height - offset;
  }

  tooltip.style.transform = `translate(${Math.max(margin, x)}px, ${Math.max(margin, y)}px)`;
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    document.body.append(textarea);
    textarea.select();

    try {
      return document.execCommand('copy');
    } catch (copyError) {
      return false;
    } finally {
      textarea.remove();
    }
  }
}

function createBookPlaceholder(title) {
  const palette = pickPalette(title);
  const lines = wrapTitle(title, 13).slice(0, 4);
  const text = lines.map((line, index) => `<text x="30" y="${170 + index * 34}" font-size="24" font-weight="800" fill="${palette.text}">${escapeHtml(line)}</text>`).join('');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 440">
      <rect width="320" height="440" rx="16" fill="${palette.bg}"/>
      <rect x="24" y="24" width="272" height="392" rx="12" fill="${palette.panel}" opacity=".86"/>
      <text x="30" y="78" font-size="15" font-weight="700" fill="${palette.bg}">READING PICK</text>
      ${text}
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function pickPalette(value) {
  const palettes = [
    { bg: '#1f6f78', panel: '#d8f3dc', text: '#10383d' },
    { bg: '#8f3d38', panel: '#ffe8d6', text: '#4b1d1a' },
    { bg: '#31572c', panel: '#ecf39e', text: '#132a13' },
    { bg: '#5f4b8b', panel: '#f1e4ff', text: '#2b1d42' },
    { bg: '#2f4858', panel: '#f6f0d5', text: '#1c2c35' }
  ];
  const score = [...String(value)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palettes[score % palettes.length];
}

function wrapTitle(title, size) {
  const words = String(title).split(/\s+/);
  const lines = [];
  let current = '';

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > size && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current) {
    lines.push(current);
  }

  if (lines.length === 1 && lines[0].length > size) {
    return lines[0].match(new RegExp(`.{1,${size}}`, 'g')) || lines;
  }

  return lines;
}

function shuffle(items) {
  const copied = [...items];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }
  return copied;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatResultCell(value) {
  return String(value ?? '').replaceAll('\t', ' ').replace(/\r?\n/g, ' ');
}
