const STORAGE_KEY = 'reading-pick-draft-state-v4';
const OLD_KEYS = ['reading-draft-state-v1', 'reading-draft-state-v2', 'reading-pick-draft-state-v3'];
const TOTAL_ROUNDS = 3;
const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

let books = [];
let students = [];
let state = null;

const app = document.getElementById('app');

document.addEventListener('DOMContentLoaded', init);

async function init() {
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
            ${currentStudent ? renderAvatar(currentStudent, 'xl') : '<div class="round-token">OK</div>'}
          </div>

          <div class="selected-slot ${selectedBook ? 'locked' : ''}">
            ${selectedBook ? renderSelectedBook(selectedBook, currentStudent) : renderEmptySelectedSlot(isDone)}
          </div>

          <div class="button-row stage-actions">
            <button class="btn primary" id="confirm-pick" ${state.selectedBookTitle && !isDone ? '' : 'disabled'}>픽 확정</button>
            <button class="btn secondary" id="finish-round" ${isDone ? '' : 'disabled'}>트레이드 단계로</button>
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
  const log = state.tradeLogByRound[state.round] || [];

  app.innerHTML = `
    <main class="app-shell">
      ${renderTopbar(`Round ${state.round} Trade`, `${selected.length}/2`)}

      <section class="trade-header">
        <div>
          <span class="eyebrow">TRADE PHASE</span>
          <h1>${selected.length === 2 ? `${escapeHtml(firstName)} ↔ ${escapeHtml(secondName)}` : 'Trade'}</h1>
        </div>
        <div class="button-row">
          <button class="btn primary" id="exchange-books" ${canExchange ? '' : 'disabled'}>교환</button>
          <button class="btn secondary" id="next-round">${state.round >= TOTAL_ROUNDS ? '최종 결과로' : '다음 라운드로'}</button>
          <button class="btn quiet" id="reset-state">전체 초기화</button>
        </div>
      </section>

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
          <button class="btn primary" id="export-csv">CSV 내보내기</button>
          <button class="btn quiet" id="reset-state">처음부터 다시</button>
        </div>
      </section>

      <section class="final-grid">
        ${students.map(renderFinalCard).join('')}
      </section>
    </main>
  `;

  document.getElementById('export-csv').addEventListener('click', exportCsv);
  document.getElementById('reset-state').addEventListener('click', resetState);
  bindTopbarActions();
  hydrateImages();
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
  return `<img class="book-cover book-cover-only ${className}" src="images/books/${encodeURIComponent(book.slug)}.jpg" data-title="${escapeHtml(book.title)}" alt="${escapeHtml(book.title)}" title="${escapeHtml(book.title)}" />`;
}

function renderPickBookCard(book, eligibleTitles, isDone) {
  const alreadyPicked = Boolean(getPickerForTitle(book.title));
  const ineligible = !eligibleTitles.includes(book.title);
  const selected = state.selectedBookTitle === book.title;
  const disabled = isDone || alreadyPicked || ineligible;

  return `
    <article class="book-card pick-book ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}" data-title="${escapeHtml(book.title)}">
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
  const className = [
    index < state.pickIndex ? 'done' : '',
    index === state.pickIndex ? 'active' : '',
    pickedTitle ? 'has-current-pick' : ''
  ].filter(Boolean).join(' ');
  const previousTitles = getOwnedBooks(name);

  return `
    <li class="${className}">
      <span class="order-number">${index + 1}</span>
      ${renderAvatar(student)}
      <div>
        <strong>${escapeHtml(formatStudentName(student))}</strong>
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

  return `
    <article class="trade-card ${selected ? 'selected' : ''}" data-student-name="${escapeHtml(student.name)}">
      <div class="student-badge">
        ${renderAvatar(student)}
        <div>
          <strong>${escapeHtml(formatStudentName(student))}</strong>
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
        ${[0, 1, 2].map((index) => `<li><span>${index + 1}</span>${renderBookCoverByTitle(owned[index], 'final-cover')}</li>`).join('')}
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
  state.selectedBookTitle = title;
  saveState();
  render();
}

function clearSelection() {
  state.selectedBookTitle = null;
  saveState();
  render();
}

function confirmPick() {
  const studentName = state.pickOrder[state.pickIndex];
  const selected = state.selectedBookTitle;

  if (!studentName || !selected || !getEligibleBookTitles(studentName).includes(selected)) {
    return;
  }

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

  return !getOwnedBooks(firstName).includes(secondBook) && !getOwnedBooks(secondName).includes(firstBook);
}

function commitRoundAndContinue() {
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

function exportCsv() {
  const rows = [['학생 한국어이름', '영어이름', '1차 도서 제목', '2차 도서 제목', '3차 도서 제목']];
  students.forEach((student) => {
    const owned = getOwnedBooks(student.name);
    rows.push([student.name, student.englishName, owned[0] || '', owned[1] || '', owned[2] || '']);
  });

  const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'reading-draft-results.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getEligibleBookTitles(studentName) {
  const owned = new Set(getOwnedBooks(studentName));
  return state.roundPool.filter((title) => !owned.has(title));
}

function getPickerForTitle(title) {
  return Object.entries(state.currentRoundPicks).find(([, pickedTitle]) => pickedTitle === title)?.[0] || '';
}

function getOwnedBooks(studentName) {
  return state.ownedBooksByStudent[studentName] || [];
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

function escapeCsvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
