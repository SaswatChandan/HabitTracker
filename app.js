// Remove render-blocking static imports
let initializeApp, getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged;
let getFirestore, doc, setDoc, getDoc;
let auth = null;
let db = null;

// ─── PWA Service Worker ───────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}

// ─── Firebase Config ──────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyBvc1bpouW3NCAp2wdMQbdSCmBiOH1SsYk",
    authDomain: "habit-tracker-3e772.firebaseapp.com",
    projectId: "habit-tracker-3e772",
    storageBucket: "habit-tracker-3e772.firebasestorage.app",
    messagingSenderId: "271076844504",
    appId: "1:271076844504:web:f89b1febca82bb6d3fc8ad"
};

// ─── Constants ────────────────────────────────────────────────────────────────
const XP_MAP    = { easy: 5, medium: 10, hard: 20 };
const DIFF_LABEL = { easy: '⬇ Easy', medium: '→ Med', hard: '⬆ Hard' };
const POM_WORK  = 25 * 60;
const POM_BREAK = 5  * 60;
const POM_CIRCUM = 289; // 2π×46

// ─── Date helpers ─────────────────────────────────────────────────────────────
let currentDate = new Date();
currentDate.setHours(0, 0, 0, 0);
const todayKey = dateToKey(currentDate);
function dateToKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─── Responsive date columns ──────────────────────────────────────────────────
let dates = [];
function updateDatesArray() {
    dates = [];
    const w = window.innerWidth;
    const days = w <= 480 ? 3 : w <= 768 ? 6 : w <= 1400 ? 13 : 20;
    for (let i = days; i >= 0; i--) {
        const d = new Date(currentDate);
        d.setDate(d.getDate() - i);
        dates.push(d);
    }
}
updateDatesArray();
const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];
window.addEventListener('resize', () => {
    const old = dates.length;
    updateDatesArray();
    if (dates.length !== old) { renderSpreadsheet(); updateCharts(); }
});

// ─── State ────────────────────────────────────────────────────────────────────
let state = getDefaultState();
let currentUser = null;
let lastSaveTime = 0;
let selectedNoteTarget = null;
const undoStack = [];
let searchFilter = '';
let pomState = { active: false, timeLeft: POM_WORK, phase: 'work', habitId: null, interval: null };
let focusModeActive = false;
let currentTheme = localStorage.getItem('theme') || 'dark';
let pieChartInstance = null, barChartInstance = null, selectedCell = null;

// ─── Default State ────────────────────────────────────────────────────────────
function getDefaultState() {
    return {
        habits: [
            { id:'h1', name:'Wake up at 5:00 ⏰', completed:{}, notes:{}, color:'#f59e0b', frequency:'daily', difficulty:'medium', category:'Personal' },
            { id:'h2', name:'Gym 💪',              completed:{}, notes:{}, color:'#0ea5e9', frequency:'daily', difficulty:'hard',   category:'Fitness' },
            { id:'h3', name:'Reading 📖',           completed:{}, notes:{}, color:'#10b981', frequency:'daily', difficulty:'easy',   category:'Learning' },
            { id:'h4', name:'Day Planning 📅',      completed:{}, notes:{}, color:'#7c3aed', frequency:'daily', difficulty:'medium', category:'Work' }
        ],
        xp: 0, level: 1, badges: [], archivedHabits: [], frozenDates: [],
        streakFreezeUsed: null, weeklyChallenge: null,
        onboardingDone: false, lastLoginDate: null, pomodoroSessions: 0
    };
}

function migrateState() {
    if (!state.habits)         state.habits = [];
    if (!state.badges)         state.badges = [];
    if (!state.archivedHabits) state.archivedHabits = [];
    if (!state.frozenDates)    state.frozenDates = [];
    if (state.streakFreezeUsed  === undefined) state.streakFreezeUsed  = null;
    if (state.weeklyChallenge   === undefined) state.weeklyChallenge   = null;
    if (state.onboardingDone    === undefined) state.onboardingDone    = false;
    if (state.lastLoginDate     === undefined) state.lastLoginDate     = null;
    if (state.pomodoroSessions  === undefined) state.pomodoroSessions  = 0;
    if (state.xp    === undefined) state.xp    = 0;
    if (state.level === undefined) state.level = 1;
    state.habits.forEach(h => {
        if (!h.notes)      h.notes      = {};
        if (!h.color)      h.color      = '#7c3aed';
        if (!h.frequency)  h.frequency  = 'daily';
        if (!h.difficulty) h.difficulty = 'medium';
        if (!h.category)   h.category   = 'Personal';
    });
}

// ─── DOM ref helper ───────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── Boot: load localStorage immediately, show app, then sync Firebase ────────
(function boot() {
    // 1. Try new unified key
    let raw = localStorage.getItem('habitData_guest');
    // 2. Fall back to any old habitBackup_ key from previous Firebase sessions
    if (!raw) {
        const oldKey = Object.keys(localStorage).find(k => k.startsWith('habitBackup_'));
        if (oldKey) raw = localStorage.getItem(oldKey);
    }
    if (raw) {
        try { state = JSON.parse(raw); } catch(e) { state = getDefaultState(); }
    } else {
        state = getDefaultState();
    }
    migrateState();
    // Guarantee we always have default habits if none loaded
    if (!state.habits || state.habits.length === 0) {
        state.habits = getDefaultState().habits;
    }

    // Show app container immediately
    const appContainer = $('appContainer');
    const loginScreen  = $('loginScreen');
    if (appContainer) appContainer.style.display = 'block';
    if (loginScreen)  loginScreen.style.display  = 'none';

    applyTheme(currentTheme);
    renderAll();
    checkDailyLoginBonus();
    if (!state.onboardingDone) showOnboarding();
    scheduleReminder();
})();

// ─── Firebase Auth (background sync) ─────────────────────────────────────────
// Defer loading heavy Firebase libraries until UI is fully responsive
setTimeout(async () => {
    try {
        const [appModule, authModule, dbModule] = await Promise.all([
            import("https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js"),
            import("https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js"),
            import("https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js")
        ]);

        initializeApp = appModule.initializeApp;
        getAuth = authModule.getAuth;
        GoogleAuthProvider = authModule.GoogleAuthProvider;
        signInWithPopup = authModule.signInWithPopup;
        signOut = authModule.signOut;
        onAuthStateChanged = authModule.onAuthStateChanged;
        
        getFirestore = dbModule.getFirestore;
        doc = dbModule.doc;
        setDoc = dbModule.setDoc;
        getDoc = dbModule.getDoc;
        
        const fbApp = initializeApp(firebaseConfig);
        auth = getAuth(fbApp);
        db = getFirestore(fbApp);

        onAuthStateChanged(auth, async (user) => {
            currentUser = user;
            updateAuthUI(user);
            if (user) {
                const uid = user.uid;
                try {
                    const snap = await getDoc(doc(db, 'users', uid));
                    if (snap.exists()) {
                        state = snap.data();
                        migrateState();
                        localStorage.setItem('habitData_guest', JSON.stringify(state));
                    } else {
                        await setDoc(doc(db, 'users', uid), state);
                    }
                } catch(e) { console.warn('Firebase sync failed', e); }
                renderAll();
                checkDailyLoginBonus();
            }
        });
    } catch(e) {
        console.warn('Failed to load Firebase', e);
    }
}, 800); // Wait 800ms so main thread finishes booting app UI first

function updateAuthUI(user) {
    const logoutBtn = $('logoutBtn');
    if (user) {
        if (logoutBtn) logoutBtn.textContent = `Sign Out (${user.displayName?.split(' ')[0] || 'Me'})`;
    } else {
        if (logoutBtn) logoutBtn.textContent = '☁️ Sign In';
    }
}

$('googleSignInBtn')?.addEventListener('click', () => {
    if (!auth || !signInWithPopup) return showToast('Connecting to cloud... Try again in a sec!');
    signInWithPopup(auth, new GoogleAuthProvider()).catch(e => showToast('Sign-in failed: ' + e.message));
});
$('logoutBtn')?.addEventListener('click', () => {
    if (!auth || !signInWithPopup) return showToast('Connecting to cloud... Try again in a sec!');
    if (currentUser && signOut) signOut(auth);
    else signInWithPopup(auth, new GoogleAuthProvider()).catch(e => showToast('Sign-in failed: ' + e.message));
});

// ─── Save ─────────────────────────────────────────────────────────────────────
async function saveState() {
    migrateState();
    lastSaveTime = Date.now();
    localStorage.setItem('habitData_guest', JSON.stringify(state));
    renderAll();
    if (!currentUser || !setDoc || !doc || !db) return;
    try {
        await setDoc(doc(db, 'users', currentUser.uid), state);
    } catch(e) {
        console.warn('Cloud save failed:', e);
    }
}

// ─── Render all ──────────────────────────────────────────────────────────────
function renderAll() {
    renderSpreadsheet();
    updateStats();
    updateCharts();
    renderHeatmap();
    renderBadges();
    renderAvatar();
    renderXpBar();
    renderDailyQuote();
    renderAnalytics();
    generateWeeklyChallenge();
    renderWeeklyChallenge();
}

// ─── Undo ─────────────────────────────────────────────────────────────────────
function pushUndo() { undoStack.push(JSON.stringify(state)); if (undoStack.length > 20) undoStack.shift(); }
async function undo() {
    if (!undoStack.length) { showToast('Nothing to undo!'); return; }
    state = JSON.parse(undoStack.pop());
    await saveState();
    showToast('↩️ Undone!');
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
    const t = $('milestoneToast');
    if (!t) return;
    t.innerHTML = msg;
    t.style.display = 'flex';
    setTimeout(() => t.classList.add('visible'), 50);
    setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.style.display = 'none', 500); }, 3200);
}

// ─── Themes ───────────────────────────────────────────────────────────────────
const THEMES = [
    { id:'dark',     label:'🌑 Dark',     bg:'#0b0c10', a1:'#4f46e5', a2:'#ec4899' },
    { id:'light',    label:'☀️ Light',    bg:'#f4f6fb', a1:'#4f46e5', a2:'#ec4899' },
    { id:'ocean',    label:'🌊 Ocean',    bg:'#05111f', a1:'#0ea5e9', a2:'#06b6d4' },
    { id:'sunset',   label:'🌅 Sunset',   bg:'#180b06', a1:'#f97316', a2:'#ec4899' },
    { id:'forest',   label:'🌿 Forest',   bg:'#061410', a1:'#10b981', a2:'#22c55e' },
    { id:'midnight', label:'🌙 Midnight', bg:'#08051a', a1:'#7c3aed', a2:'#a855f7' },
];
function applyTheme(theme) {
    currentTheme = theme;
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    if (typeof Chart !== 'undefined') Chart.defaults.color = theme === 'light' ? '#0f172a' : '#fff';
    renderThemePicker();
}
function renderThemePicker() {
    const grid = $('themePickerGrid');
    if (!grid) return;
    grid.innerHTML = '';
    THEMES.forEach(t => {
        const btn = document.createElement('button');
        btn.className = `theme-swatch${currentTheme === t.id ? ' active' : ''}`;
        btn.style.cssText = `background:${t.bg};border-color:${t.a1}`;
        btn.innerHTML = `<span class="swatch-emoji">${t.label.split(' ')[0]}</span><span class="swatch-label">${t.label.split(' ').slice(1).join(' ')}</span>`;
        btn.onclick = () => { applyTheme(t.id); closeModal('themePickerModal'); };
        grid.appendChild(btn);
    });
}
$('themeToggleBtn')?.addEventListener('click', () => {
    renderThemePicker();
    openModal('themePickerModal');
});
$('closeThemeBtn')?.addEventListener('click', () => closeModal('themePickerModal'));

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); addNewHabit(); return; }
    if (e.key === '?') { openModal('shortcutsModal'); return; }
    if (e.key === 'f' || e.key === 'F') { toggleFocusMode(); return; }
    if (e.key === 'p' || e.key === 'P') { showPomodoroModal(); return; }
    if (e.key === 't' || e.key === 'T') { showTemplateModal(); return; }
    if (e.key === 'Escape') {
        if (focusModeActive) { toggleFocusMode(); return; }
        ['noteModal','pomodoroModal','templateModal','archiveModal','shareModal','themePickerModal','shortcutsModal'].forEach(closeModal);
    }
});
$('shortcutsBtn')?.addEventListener('click', () => openModal('shortcutsModal'));
$('closeShortcutsBtn')?.addEventListener('click', () => closeModal('shortcutsModal'));

// ─── Search ───────────────────────────────────────────────────────────────────
$('habitSearch')?.addEventListener('input', e => { searchFilter = e.target.value.toLowerCase(); renderSpreadsheet(); });
$('clearSearchBtn')?.addEventListener('click', () => { searchFilter = ''; $('habitSearch').value = ''; renderSpreadsheet(); });

// ─── Quick Add ────────────────────────────────────────────────────────────────
function quickAddHabit(name) {
    if (!name?.trim()) return;
    pushUndo();
    const colors = ['#7c3aed','#0ea5e9','#10b981','#f59e0b','#ec4899','#ef4444'];
    state.habits.push({
        id: Date.now().toString() + Math.random(),
        name: name.trim(), completed: {}, notes: {},
        color: colors[state.habits.length % colors.length],
        frequency: 'daily', difficulty: 'medium', category: 'Personal'
    });
    $('quickAddInput').value = '';
    saveState();
}
$('quickAddInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') quickAddHabit($('quickAddInput').value); });
$('quickAddBtn')?.addEventListener('click', () => quickAddHabit($('quickAddInput').value));

// ─── Spreadsheet ──────────────────────────────────────────────────────────────
function renderSpreadsheet() {
    const container = $('spreadsheet');
    if (!container || !state?.habits) return;

    const filtered = searchFilter
        ? state.habits.filter(h => h.name.toLowerCase().includes(searchFilter))
        : state.habits;

    const w = window.innerWidth;
    const nameW = w <= 480 ? '110px' : w <= 800 ? '160px' : '215px';
    container.style.gridTemplateColumns = `40px ${nameW} repeat(${dates.length}, 44px)`;
    container.innerHTML = '';

    // Header row 1 – day names
    makeCell(container, '', 'cell row-header');
    makeCell(container, 'My Habits', 'cell header-title sticky-col');
    dates.forEach(d => makeCell(container, DOW[d.getDay()], 'cell col-header-day'));

    // Header row 2 – date numbers
    makeCell(container, '', 'cell row-header');
    makeCell(container, '', 'cell habit-name sticky-col');
    dates.forEach(d => makeCell(container, d.getDate(), 'cell col-header-date'));

    // Habit rows
    filtered.forEach((habit, hIdx) => {
        makeCell(container, hIdx + 1, 'cell row-header');

        const nameCell = document.createElement('div');
        nameCell.className = 'cell habit-name sticky-col draggable';
        nameCell.dataset.habitId = habit.id;
        nameCell.draggable = true;
        nameCell.style.borderLeft = `4px solid ${habit.color || '#7c3aed'}`;

        const diffDot = document.createElement('span');
        diffDot.className = `diff-dot diff-${habit.difficulty || 'medium'}`;
        diffDot.title = DIFF_LABEL[habit.difficulty || 'medium'];

        const nameSpan = document.createElement('span');
        nameSpan.textContent = habit.name;

        const acts = document.createElement('span');
        acts.className = 'habit-actions';
        acts.innerHTML = `<span class="action-icon" data-action="archive" title="Archive">📁</span><span class="action-icon" data-action="delete" title="Delete">✕</span>`;
        acts.onclick = e => {
            e.stopPropagation();
            const a = e.target.dataset.action;
            if (a === 'delete')  deleteHabit(habit.id);
            if (a === 'archive') archiveHabit(habit.id);
        };

        nameCell.appendChild(diffDot);
        nameCell.appendChild(nameSpan);
        nameCell.appendChild(acts);
        nameCell.onclick = () => selectCell(nameCell);

        // Drag-and-drop
        const realIdx = state.habits.indexOf(habit);
        nameCell.ondragstart = e => { e.dataTransfer.setData('text/plain', realIdx); nameCell.classList.add('dragging'); };
        nameCell.ondragover  = e => { e.preventDefault(); nameCell.classList.add('drag-over'); };
        nameCell.ondragleave = ()  => nameCell.classList.remove('drag-over');
        nameCell.ondrop = e => {
            e.preventDefault(); nameCell.classList.remove('drag-over');
            const from = parseInt(e.dataTransfer.getData('text/plain'));
            if (from !== realIdx) { pushUndo(); const [m] = state.habits.splice(from, 1); state.habits.splice(realIdx, 0, m); saveState(); }
        };
        nameCell.ondragend = () => { nameCell.classList.remove('dragging'); container.querySelectorAll('.habit-name').forEach(n => n.classList.remove('drag-over')); };
        container.appendChild(nameCell);

        // Date cells
        dates.forEach(d => {
            const k = dateToKey(d);
            const isChecked = habit.completed[k] === true;
            const isPast    = k < todayKey;
            const isFrozen  = (state.frozenDates || []).includes(k);
            const hasNote   = !!(habit.notes && habit.notes[k]);

            const cc = document.createElement('div');
            cc.className = `cell checkbox-cell${isPast && !isFrozen ? ' disabled-cell' : ''}`;

            const box = document.createElement('div');
            box.className = `square-box${isChecked ? ' checked' : ''}${isFrozen && !isChecked ? ' frozen-box' : ''}`;
            if (isChecked) box.style.background = `linear-gradient(135deg,${habit.color || '#4f46e5'},#ec4899)`;
            cc.appendChild(box);

            if (hasNote) { const nd = document.createElement('span'); nd.className = 'note-dot'; nd.title = habit.notes[k]; cc.appendChild(nd); }

            cc.onclick = () => { if (!isPast || isFrozen) toggleHabit(habit, k); };
            cc.oncontextmenu = e => { e.preventDefault(); if (isChecked) openNoteModal(habit, k); };
            let pt;
            cc.addEventListener('touchstart', () => { pt = setTimeout(() => { if (isChecked) openNoteModal(habit, k); }, 600); });
            cc.addEventListener('touchend', () => clearTimeout(pt));
            container.appendChild(cc);
        });
    });

    // Progress row
    makeCell(container, filtered.length + 1, 'cell row-header');
    makeCell(container, 'Daily Progress', 'cell progress-cell sticky-col');
    dates.forEach(d => {
        const k    = dateToKey(d);
        const comps = state.habits.filter(h => h.completed[k]).length;
        const pct   = state.habits.length ? Math.round(comps / state.habits.length * 100) : 0;
        makeCell(container, `${pct}%`, 'cell progress-cell');
    });

    if (selectedCell?.dataset.habitId) {
        container.querySelectorAll('.habit-name').forEach(n => {
            if (n.dataset.habitId === selectedCell.dataset.habitId) n.classList.add('selected');
        });
    }
}

function makeCell(parent, text, cls) {
    const d = document.createElement('div');
    d.className = cls; d.textContent = text; parent.appendChild(d); return d;
}

// ─── Inline Edit ──────────────────────────────────────────────────────────────
function selectCell(cellDiv) {
    document.querySelectorAll('.cell').forEach(c => c.classList.remove('selected'));
    cellDiv.classList.add('selected'); selectedCell = cellDiv;
    if (!cellDiv.classList.contains('habit-name') || !cellDiv.dataset.habitId) return;
    const habit = state.habits.find(h => h.id === cellDiv.dataset.habitId);
    if (!habit) return;
    cellDiv.innerHTML = '';

    const inp = document.createElement('input');
    inp.className = 'habit-input'; inp.value = habit.name;
    inp.onblur   = () => { if (inp.value.trim()) habit.name = inp.value.trim(); saveState(); };
    inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };

    const cp = document.createElement('input');
    cp.type = 'color'; cp.value = habit.color || '#7c3aed'; cp.className = 'habit-color-picker';
    cp.onchange = () => { habit.color = cp.value; saveState(); };

    const mkSel = (opts, cur, cb) => {
        const s = document.createElement('select'); s.className = 'freq-select';
        opts.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; if (cur === v) o.selected = true; s.appendChild(o); });
        s.onchange = () => cb(s.value); s.onclick = e => e.stopPropagation(); return s;
    };

    cellDiv.appendChild(inp);
    cellDiv.appendChild(cp);
    cellDiv.appendChild(mkSel([['daily','Daily'],['weekdays','Wkdays'],['weekends','Wknds'],['3x','3×/wk'],['2x','2×/wk']], habit.frequency, v => { habit.frequency = v; saveState(); }));
    cellDiv.appendChild(mkSel([['easy','⬇Easy'],['medium','→Med'],['hard','⬆Hard']], habit.difficulty, v => { habit.difficulty = v; saveState(); }));
    cellDiv.appendChild(mkSel(['Health','Fitness','Learning','Work','Personal','Mindfulness'].map(c => [c, c]), habit.category, v => { habit.category = v; saveState(); }));
    inp.focus();
}

// ─── Toggle / Add / Delete / Archive ─────────────────────────────────────────
function toggleHabit(habit, dateKey) {
    if (dateKey < todayKey && !(state.frozenDates || []).includes(dateKey)) return;
    pushUndo();
    const xp = XP_MAP[habit.difficulty || 'medium'] || 10;
    if (habit.completed[dateKey]) { delete habit.completed[dateKey]; state.xp = Math.max(0, state.xp - xp); }
    else { habit.completed[dateKey] = true; state.xp += xp; playCheckSound(); }
    if (state.xp >= state.level * 100) { state.level++; state.xp = 0; showToast(`🎉 Level Up! You're now Level ${state.level}!`); launchConfetti(); }
    checkMilestones(); checkWeeklyChallenge();
    if (focusModeActive) renderFocusMode();
    saveState();
}
function addNewHabit() {
    pushUndo();
    const colors = ['#7c3aed','#0ea5e9','#10b981','#f59e0b','#ec4899'];
    state.habits.push({ id: Date.now().toString(), name: 'New Habit ✏️', completed: {}, notes: {}, color: colors[state.habits.length % colors.length], frequency: 'daily', difficulty: 'medium', category: 'Personal' });
    saveState();
}
function deleteHabit(id) {
    if (confirm('Delete this habit permanently?')) { pushUndo(); state.habits = state.habits.filter(h => h.id !== id); selectedCell = null; saveState(); }
}
function archiveHabit(id) {
    pushUndo();
    const idx = state.habits.findIndex(h => h.id === id); if (idx === -1) return;
    const [h] = state.habits.splice(idx, 1);
    if (!state.archivedHabits) state.archivedHabits = [];
    state.archivedHabits.push(h); selectedCell = null;
    showToast(`📁 "${h.name.split(' ')[0]}" archived!`); saveState();
}
function restoreHabit(id) {
    const idx = state.archivedHabits.findIndex(h => h.id === id); if (idx === -1) return;
    const [h] = state.archivedHabits.splice(idx, 1); state.habits.push(h);
    showToast(`✅ "${h.name.split(' ')[0]}" restored!`); saveState(); renderArchiveModal();
}

$('addHabitBtn')?.addEventListener('click', addNewHabit);
$('resetBtn')?.addEventListener('click', () => {
    if (confirm('Reset ALL progress?')) {
        pushUndo();
        state.habits.forEach(h => { h.completed = {}; h.notes = {}; });
        state.xp = 0; state.level = 1; state.badges = []; state.frozenDates = []; state.weeklyChallenge = null;
        saveState();
    }
});

// ─── Stats ────────────────────────────────────────────────────────────────────
function getStreakCount(s) {
    let streak = 0;
    const temp = new Date(currentDate), frozen = s.frozenDates || [];
    while (true) {
        const k = dateToKey(temp);
        if (s.habits.some(h => h.completed[k]) || frozen.includes(k)) { streak++; temp.setDate(temp.getDate() - 1); }
        else break;
    }
    return streak;
}
function updateStats() {
    const s = getStreakCount(state);
    if ($('streakCount'))  $('streakCount').textContent  = s;
    if ($('levelDisplay')) $('levelDisplay').textContent = `Lv.${state.level}`;
    if ($('xpScore'))      $('xpScore').textContent      = state.xp;
}

// ─── Avatar & XP ─────────────────────────────────────────────────────────────
function getAvatarData() {
    const l = state.level;
    if (l <= 1) return { emoji:'🌱', title:'Seedling',  color:'#10b981' };
    if (l <= 2) return { emoji:'🌿', title:'Sprout',    color:'#22c55e' };
    if (l <= 3) return { emoji:'⚡', title:'Energized', color:'#f59e0b' };
    if (l <= 5) return { emoji:'🔥', title:'On Fire',   color:'#ef4444' };
    if (l <= 8) return { emoji:'💎', title:'Diamond',   color:'#60a5fa' };
    return { emoji:'🦁', title:'Legend', color:'#ec4899' };
}
function renderAvatar() {
    const av = getAvatarData();
    if ($('avatarBubble'))     $('avatarBubble').textContent      = av.emoji;
    if ($('avatarTitle'))      $('avatarTitle').textContent       = av.title;
    if ($('avatarLevelBadge')) {
        $('avatarLevelBadge').textContent = `Lv. ${state.level}`;
        $('avatarLevelBadge').style.cssText = `background:${av.color}33;color:${av.color};`;
    }
}
function renderXpBar() {
    const needed = state.level * 100, pct = Math.min(100, Math.round(state.xp / needed * 100));
    if ($('xpBarFill'))  $('xpBarFill').style.width     = pct + '%';
    if ($('xpBarLabel')) $('xpBarLabel').textContent    = `${state.xp} / ${needed} XP to next level`;
}

// ─── Daily Login Bonus ────────────────────────────────────────────────────────
function checkDailyLoginBonus() {
    if (state.lastLoginDate === todayKey) return;
    state.lastLoginDate = todayKey; state.xp += 5;
    if (state.xp >= state.level * 100) { state.level++; state.xp = 0; }
    localStorage.setItem('habitData_guest', JSON.stringify(state));
    setTimeout(() => showToast('🎁 Daily Login! +5 XP bonus!'), 1800);
}

// ─── Charts ───────────────────────────────────────────────────────────────────
// ─── Charts ───────────────────────────────────────────────────────────────────
let chartJsLoaded = false;
async function lazyLoadChartJS() {
    if (chartJsLoaded || typeof Chart !== 'undefined') return true;
    return new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js";
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
    });
}

async function updateCharts() {
    if (!$('pieChart') || !state?.habits?.length) return;
    
    // Lazy-load the heavy Chart.js library only when we actually draw charts
    await lazyLoadChartJS();
    if (typeof Chart === 'undefined') return;

    let done = 0;
    const hd = state.habits.map(h => {
        const c = dates.filter(d => h.completed[dateToKey(d)]).length;
        done += c; return { n: h.name.split(' ')[0], c, col: h.color || '#7c3aed' };
    });
    const total = state.habits.length * dates.length;

    if (pieChartInstance) pieChartInstance.destroy();
    pieChartInstance = new Chart($('pieChart').getContext('2d'), {
        type: 'doughnut',
        data: { labels: ['Done','Missed'], datasets: [{ data: [done, Math.max(0, total - done)], backgroundColor: ['#7c3aed','rgba(255,255,255,0.06)'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false }
    });

    if (barChartInstance) barChartInstance.destroy();
    barChartInstance = new Chart($('barChart').getContext('2d'), {
        type: 'bar',
        data: { labels: hd.map(h => h.n), datasets: [{ label: 'Completions', data: hd.map(h => h.c), backgroundColor: hd.map(h => h.col), borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

// ─── Weekly Challenge ─────────────────────────────────────────────────────────
function wkStart() { const d = new Date(currentDate); d.setDate(d.getDate() - d.getDay()); return dateToKey(d); }
function generateWeeklyChallenge() {
    const ws = wkStart();
    if (state.weeklyChallenge && state.weeklyChallenge.weekStart === ws) return;
    const types = [
        { type:'perfect',  description:'Have a 100% day 3 times this week', target:3, bonusXp:60 },
        { type:'rate',     description:'Hit 75%+ completion for 5 days',    target:5, bonusXp:50 },
        { type:'all_week', description:'Complete at least 1 habit every day',target:7, bonusXp:70 },
    ];
    if (state.habits.length > 0) {
        const h = state.habits[Math.floor(Math.random() * state.habits.length)];
        types.push({ type:'habit', description:`Complete "${h.name.split(' ')[0]}" every day`, target:7, habitId:h.id, bonusXp:80 });
    }
    const ch = types[Math.floor(Math.random() * types.length)];
    state.weeklyChallenge = { ...ch, weekStart: ws, progress: 0, completed: false };
}
function checkWeeklyChallenge() {
    if (!state.weeklyChallenge || state.weeklyChallenge.completed) return;
    if (state.weeklyChallenge.weekStart !== wkStart()) return;
    const { type, target, habitId } = state.weeklyChallenge;
    let prog = 0;
    for (let i = 0; i < 7; i++) {
        const d = new Date(currentDate); d.setDate(d.getDate() - d.getDay() + i); if (d > currentDate) break;
        const k = dateToKey(d), comps = state.habits.filter(h => h.completed[k]).length;
        if (type === 'perfect'  && comps === state.habits.length && state.habits.length > 0) prog++;
        else if (type === 'rate' && state.habits.length && (comps / state.habits.length) >= 0.75) prog++;
        else if (type === 'all_week' && comps > 0) prog++;
        else if (type === 'habit' && habitId) { const h = state.habits.find(h => h.id === habitId); if (h && h.completed[k]) prog++; }
    }
    state.weeklyChallenge.progress = prog;
    if (prog >= target) { state.weeklyChallenge.completed = true; state.xp += state.weeklyChallenge.bonusXp; showToast(`🎯 Weekly Challenge Complete! +${state.weeklyChallenge.bonusXp} XP`); launchConfetti(); }
}
function renderWeeklyChallenge() {
    const ch = state.weeklyChallenge; if (!ch) return;
    if ($('challengeDesc')) $('challengeDesc').textContent = ch.description;
    const pct = ch.target > 0 ? Math.min(100, Math.round(ch.progress / ch.target * 100)) : 0;
    if ($('challengeBarFill')) { $('challengeBarFill').style.width = pct + '%'; if (ch.completed) $('challengeBarFill').style.background = 'linear-gradient(90deg,#10b981,#22c55e)'; }
    if ($('challengeProgressText')) $('challengeProgressText').textContent = `${ch.progress}/${ch.target}${ch.completed ? ' ✅' : ''}`;
}

// ─── Analytics ────────────────────────────────────────────────────────────────
function renderAnalytics() {
    if (!state.habits.length) return;
    const dt = Array(7).fill(0), dc = Array(7).fill(0);
    for (let i = 0; i < 30; i++) {
        const d = new Date(currentDate); d.setDate(d.getDate() - i);
        const k = dateToKey(d), dow = d.getDay(), comps = state.habits.filter(h => h.completed[k]).length;
        dt[dow] += state.habits.length ? comps / state.habits.length : 0; dc[dow]++;
    }
    const avgs = dt.map((t, i) => dc[i] ? t / dc[i] : 0), bi = avgs.indexOf(Math.max(...avgs));
    if ($('bestDayValue')) $('bestDayValue').textContent = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][bi];

    let l7 = 0, p7 = 0;
    for (let i = 0; i < 7;  i++) { const d = new Date(currentDate); d.setDate(d.getDate() - i); l7 += state.habits.filter(h => h.completed[dateToKey(d)]).length / (state.habits.length || 1); }
    for (let i = 7; i < 14; i++) { const d = new Date(currentDate); d.setDate(d.getDate() - i); p7 += state.habits.filter(h => h.completed[dateToKey(d)]).length / (state.habits.length || 1); }
    l7 /= 7; p7 /= 7;
    if ($('trendValue')) {
        const diff = p7 > 0 ? Math.round((l7 - p7) / p7 * 100) : 0, up = l7 >= p7;
        $('trendValue').textContent = `${up ? '↑' : '↓'} ${Math.abs(diff)}% ${up ? '🎉 Improving!' : '💪 Keep going'}`;
        $('trendValue').style.color = up ? '#10b981' : '#f59e0b';
    }

    const wa = [];
    for (let w = 3; w >= 0; w--) {
        let wt = 0;
        for (let dd = 0; dd < 7; dd++) { const dt2 = new Date(currentDate); dt2.setDate(dt2.getDate() - w * 7 - dd); wt += state.habits.filter(h => h.completed[dateToKey(dt2)]).length / (state.habits.length || 1); }
        wa.push(Math.round(wt / 7 * 100));
    }
    const sp = $('sparklineContainer');
    if (sp && wa.length) {
        const sw = 130, sh = 46, mx = Math.max(...wa, 1);
        const pts = wa.map((v, i) => `${(i / (wa.length - 1)) * sw},${sh - (v / mx) * sh}`).join(' ');
        sp.innerHTML = `<svg width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}"><defs><linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="var(--accent1)"/><stop offset="100%" stop-color="var(--accent2)"/></linearGradient></defs><polyline points="${pts}" fill="none" stroke="url(#sg)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${wa.map((v, i) => `<circle cx="${(i / (wa.length - 1)) * sw}" cy="${sh - (v / mx) * sh}" r="3.5" fill="var(--accent2)"/>`).join('')}</svg><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--sub);margin-top:4px"><span>4w ago</span><span>3w</span><span>2w</span><span>This wk</span></div>`;
    }

    const hs = state.habits.map(h => {
        let lng = 0, cur = 0;
        for (let i = 364; i >= 0; i--) { const d = new Date(currentDate); d.setDate(d.getDate() - i); if (h.completed[dateToKey(d)]) { cur++; lng = Math.max(lng, cur); } else cur = 0; }
        return { name: h.name, lng, col: h.color || '#7c3aed' };
    }).sort((a, b) => b.lng - a.lng);
    const sl = $('habitStreakList');
    if (sl) {
        sl.innerHTML = '';
        hs.slice(0, 6).forEach(h => { const r = document.createElement('div'); r.className = 'streak-row'; r.innerHTML = `<span class="streak-habit-name">${h.name}</span><span class="streak-badge" style="background:${h.col}22;color:${h.col};border:1px solid ${h.col}44">🔥 ${h.lng}d</span>`; sl.appendChild(r); });
        if (!hs.length) sl.innerHTML = '<span style="color:var(--sub);font-size:13px;">Check off habits to build streaks!</span>';
    }
    renderMonthlyRecap();
}
function renderMonthlyRecap() {
    const lm = new Date(currentDate); lm.setMonth(lm.getMonth() - 1);
    const yr = lm.getFullYear(), mo = lm.getMonth(), dim = new Date(yr, mo + 1, 0).getDate();
    let total = 0, done = 0, bestHabit = { name:'—', c:0 };
    state.habits.forEach(h => {
        let hc = 0;
        for (let d = 1; d <= dim; d++) { if (h.completed[dateToKey(new Date(yr, mo, d))]) { hc++; done++; } total++; }
        if (hc > bestHabit.c) bestHabit = { name: h.name.split(' ')[0], c: hc };
    });
    const pct = total > 0 ? Math.round(done / total * 100) : 0, mname = lm.toLocaleString('default', { month:'long' });
    const el = $('monthlyRecapContent');
    if (el) el.innerHTML = `<div class="recap-stat"><span class="recap-num" style="color:var(--accent1)">${pct}%</span><span class="recap-label">Completion in ${mname}</span></div><div class="recap-stat"><span class="recap-num" style="color:var(--accent2)">${bestHabit.c}</span><span class="recap-label">Best: ${bestHabit.name}</span></div>`;
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────
function renderHeatmap() {
    const grid = $('heatmapGrid'); if (!grid) return; grid.innerHTML = '';
    const today = new Date(currentDate), start = new Date(today);
    start.setDate(start.getDate() - 364); start.setDate(start.getDate() - start.getDay());
    for (let wk = 0; wk < 53; wk++) {
        const col = document.createElement('div'); col.className = 'heatmap-col';
        for (let dy = 0; dy < 7; dy++) {
            const d = new Date(start); d.setDate(d.getDate() + wk * 7 + dy);
            const cell = document.createElement('div'); cell.className = 'heatmap-cell';
            if (d > today) { cell.style.background = 'transparent'; col.appendChild(cell); continue; }
            const k = dateToKey(d), comps = state.habits.filter(h => h.completed[k]).length, pct = comps / (state.habits.length || 1), frozen = (state.frozenDates || []).includes(k);
            cell.title = `${d.toDateString()}: ${comps}/${state.habits.length}${frozen ? ' ❄️' : ''}`;
            if (frozen)       cell.style.background = 'rgba(96,165,250,0.6)';
            else if (pct === 0) cell.style.background = 'rgba(139,92,246,0.07)';
            else if (pct < 0.25) cell.style.background = 'rgba(139,92,246,0.2)';
            else if (pct < 0.5)  cell.style.background = 'rgba(139,92,246,0.4)';
            else if (pct < 0.75) cell.style.background = 'rgba(139,92,246,0.65)';
            else if (pct < 1)    cell.style.background = 'rgba(236,72,153,0.8)';
            else cell.style.background = 'linear-gradient(135deg,var(--accent1),var(--accent2))';
            col.appendChild(cell);
        }
        grid.appendChild(col);
    }
}

// ─── Milestones ───────────────────────────────────────────────────────────────
const MILESTONES = [
    { id:'first_check',   label:'First Step',   emoji:'👶', check: s => s.habits.some(h => Object.keys(h.completed).length > 0) },
    { id:'streak_7',      label:'7-Day Warrior', emoji:'🔥', check: s => getStreakCount(s) >= 7 },
    { id:'streak_30',     label:'Unstoppable',  emoji:'💎', check: s => getStreakCount(s) >= 30 },
    { id:'xp_100',        label:'XP Rising',    emoji:'⭐', check: s => s.xp + (s.level - 1) * 100 >= 100 },
    { id:'xp_500',        label:'XP Legend',    emoji:'🌟', check: s => s.xp + (s.level - 1) * 100 >= 500 },
    { id:'level_5',       label:'Level 5 Pro',  emoji:'🏆', check: s => s.level >= 5 },
    { id:'all_habits',    label:'Perfect Day',  emoji:'✅', check: s => s.habits.length > 0 && s.habits.every(h => h.completed[todayKey]) },
    { id:'habit_5',       label:'Overachiever', emoji:'🚀', check: s => s.habits.length >= 5 },
    { id:'challenge_win', label:'Challenger',   emoji:'🎯', check: s => !!s.weeklyChallenge?.completed },
    { id:'freeze_used',   label:'Ice Guard',    emoji:'❄️', check: s => !!s.streakFreezeUsed },
    { id:'pomodoro_done', label:'Focused',      emoji:'🍅', check: s => s.pomodoroSessions >= 1 },
    { id:'hard_habit',    label:'Hardcore',     emoji:'⬆️', check: s => s.habits.some(h => h.difficulty === 'hard' && Object.keys(h.completed).length >= 7) },
];
function checkMilestones() {
    if (!state.badges) state.badges = [];
    MILESTONES.forEach(m => { if (!state.badges.includes(m.id) && m.check(state)) { state.badges.push(m.id); showMilestoneToast(m); launchConfetti(); } });
}
function renderBadges() {
    const shelf = $('badgesShelf'); if (!shelf) return;
    if (!state.badges) state.badges = [];
    shelf.innerHTML = '';
    MILESTONES.forEach(m => {
        const earned = state.badges.includes(m.id), card = document.createElement('div');
        card.className = `badge-card${earned ? ' earned' : ' locked'}`;
        card.title = earned ? 'Achieved!' : 'Locked';
        card.innerHTML = `<span class="badge-emoji">${earned ? m.emoji : '🔒'}</span><span class="badge-label">${m.label}</span>`;
        shelf.appendChild(card);
    });
}
function showMilestoneToast(m) {
    const t = $('milestoneToast'); if (!t) return;
    t.innerHTML = `${m.emoji} <b>Achievement!</b> — ${m.label}`;
    t.style.display = 'flex';
    setTimeout(() => t.classList.add('visible'), 50);
    setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.style.display = 'none', 500); }, 3500);
}

// ─── Confetti ─────────────────────────────────────────────────────────────────
function launchConfetti() {
    const c = $('confettiCanvas'), ctx = c.getContext('2d');
    c.width = window.innerWidth; c.height = window.innerHeight;
    const cols = ['#4f46e5','#ec4899','#f59e0b','#10b981','#0ea5e9'];
    const ps = Array.from({ length: 100 }, () => ({ x: Math.random() * c.width, y: Math.random() * -c.height, r: Math.random() * 7 + 2, col: cols[Math.floor(Math.random() * cols.length)], speed: Math.random() * 4 + 2, ta: 0 }));
    let fr = 0;
    function draw() { ctx.clearRect(0, 0, c.width, c.height); ps.forEach(p => { p.ta += 0.1; p.y += p.speed; p.x += Math.sin(p.ta) * 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = p.col; ctx.globalAlpha = Math.max(0, 1 - fr / 120); ctx.fill(); }); ctx.globalAlpha = 1; fr++; if (fr < 140) requestAnimationFrame(draw); else ctx.clearRect(0, 0, c.width, c.height); }
    draw();
}

// ─── Daily Quote ──────────────────────────────────────────────────────────────
const QUOTES = [
    {t:'We are what we repeatedly do. Excellence is not an act but a habit.',a:'Aristotle'},
    {t:'Success is the sum of small efforts, repeated day in and day out.',a:'Robert Collier'},
    {t:'Motivation is what gets you started. Habit is what keeps you going.',a:'Jim Ryun'},
    {t:'The secret of getting ahead is getting started.',a:'Mark Twain'},
    {t:'You are what you do, not what you say you\'ll do.',a:'C.G. Jung'},
    {t:'Small daily improvements over time lead to stunning results.',a:'Robin Sharma'},
    {t:'It\'s not what we do once in a while that shapes our lives. It\'s what we do consistently.',a:'Tony Robbins'},
    {t:'Discipline is the bridge between goals and accomplishment.',a:'Jim Rohn'},
    {t:'The chains of habit are too light to be felt until they are too heavy to be broken.',a:'Warren Buffett'},
    {t:'A journey of a thousand miles begins with a single step.',a:'Lao Tzu'},
    {t:'Don\'t watch the clock; do what it does. Keep going.',a:'Sam Levenson'},
    {t:'Action is the foundational key to all success.',a:'Pablo Picasso'},
    {t:'The future depends on what you do today.',a:'Mahatma Gandhi'},
    {t:'Either you run the day, or the day runs you.',a:'Jim Rohn'},
    {t:'One day or day one. You decide.',a:'Unknown'},
    {t:'A little progress each day adds up to big results.',a:'Unknown'},
    {t:'Fall seven times, stand up eight.',a:'Japanese Proverb'},
    {t:'Your habits will determine your future.',a:'Jack Canfield'},
    {t:'Success doesn\'t come from what you do occasionally. It comes from what you do consistently.',a:'Marie Forleo'},
    {t:'We first make our habits, then our habits make us.',a:'John Dryden'},
    {t:'Winning is a habit. Unfortunately, so is losing.',a:'Vince Lombardi'},
    {t:'Do something today that your future self will thank you for.',a:'Unknown'},
    {t:'Strive for progress, not perfection.',a:'Unknown'},
    {t:'The best time to start was yesterday. The next best time is now.',a:'Unknown'},
    {t:'You don\'t rise to the level of your goals. You fall to the level of your systems.',a:'James Clear'},
    {t:'Every action you take is a vote for the type of person you wish to become.',a:'James Clear'},
    {t:'The quality of your life depends on the quality of your habits.',a:'Unknown'},
];
function renderDailyQuote() {
    const el = $('quoteText'); if (!el) return;
    const doy = Math.floor((currentDate - new Date(currentDate.getFullYear(), 0, 0)) / 86400000);
    const q = QUOTES[doy % QUOTES.length];
    el.innerHTML = `"${q.t}" <span style="opacity:.55;font-size:12px">— ${q.a}</span>`;
}

// ─── Streak Freeze ────────────────────────────────────────────────────────────
$('freezeBtn')?.addEventListener('click', () => {
    const cm = `${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2,'0')}`;
    if (state.streakFreezeUsed === cm) { showToast('❄️ Freeze already used this month!'); return; }
    if ((state.frozenDates || []).includes(todayKey)) { showToast('❄️ Today already frozen!'); return; }
    if (!state.frozenDates) state.frozenDates = [];
    state.frozenDates.push(todayKey); state.streakFreezeUsed = cm;
    checkMilestones(); showToast('❄️ Streak Freeze activated! Safe for today.'); saveState();
});

// ─── Pomodoro ─────────────────────────────────────────────────────────────────
function renderPomodoroDisplay() {
    const m = Math.floor(pomState.timeLeft / 60), s = pomState.timeLeft % 60;
    if ($('pomodoroTime')) $('pomodoroTime').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    const start = pomState.phase === 'work' ? POM_WORK : POM_BREAK;
    const offset = (1 - (pomState.timeLeft / start)) * POM_CIRCUM;
    const ring = $('pomodoroRing'); if (ring) ring.setAttribute('stroke-dashoffset', offset.toFixed(1));
    if ($('pomodoroPhaseLabel')) $('pomodoroPhaseLabel').textContent = pomState.phase === 'work' ? 'Focus 🍅' : 'Break ☕';
}
function pomodoroTick() {
    if (pomState.timeLeft > 0) { pomState.timeLeft--; renderPomodoroDisplay(); }
    else {
        clearInterval(pomState.interval); pomState.interval = null; pomState.active = false;
        playCheckSound(); playCheckSound();
        if (pomState.phase === 'work') {
            if (pomState.habitId) { const h = state.habits.find(h => h.id === pomState.habitId); if (h && !h.completed[todayKey]) toggleHabit(h, todayKey); }
            state.xp += 15; state.pomodoroSessions = (state.pomodoroSessions || 0) + 1;
            if (state.xp >= state.level * 100) { state.level++; state.xp = 0; }
            checkMilestones(); showToast('🍅 Pomodoro done! +15 bonus XP! Break time ☕');
            pomState.phase = 'break'; pomState.timeLeft = POM_BREAK;
        } else {
            showToast('☕ Break over! Ready for next session?'); pomState.phase = 'work'; pomState.timeLeft = POM_WORK;
        }
        renderPomodoroDisplay();
        if ($('pomStartBtn')) $('pomStartBtn').textContent = '▶ Start';
        saveState();
    }
}
function togglePomodoro() {
    if (pomState.active) { clearInterval(pomState.interval); pomState.interval = null; pomState.active = false; if ($('pomStartBtn')) $('pomStartBtn').textContent = '▶ Start'; }
    else { pomState.habitId = $('pomodoroHabitSelect')?.value || null; pomState.interval = setInterval(pomodoroTick, 1000); pomState.active = true; if ($('pomStartBtn')) $('pomStartBtn').textContent = '⏸ Pause'; }
}
function showPomodoroModal() {
    const sel = $('pomodoroHabitSelect');
    if (sel) sel.innerHTML = '<option value="">— No specific habit —</option>' + state.habits.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
    if (pomState.habitId && sel) sel.value = pomState.habitId;
    renderPomodoroDisplay();
    openModal('pomodoroModal');
}
function resetPomodoro() { clearInterval(pomState.interval); pomState.interval = null; pomState.active = false; pomState.phase = 'work'; pomState.timeLeft = POM_WORK; renderPomodoroDisplay(); if ($('pomStartBtn')) $('pomStartBtn').textContent = '▶ Start'; }
$('pomodoroBtn')?.addEventListener('click', showPomodoroModal);
$('pomStartBtn')?.addEventListener('click', togglePomodoro);
$('pomResetBtn')?.addEventListener('click', resetPomodoro);
$('closePomBtn')?.addEventListener('click', () => closeModal('pomodoroModal'));

// ─── Focus Mode ───────────────────────────────────────────────────────────────
function toggleFocusMode() {
    focusModeActive = !focusModeActive;
    const focusModeEl = $('focusMode'); if (!focusModeEl) return;
    if (focusModeActive) { renderFocusMode(); focusModeEl.style.display = 'flex'; setTimeout(() => focusModeEl.classList.add('visible'), 10); }
    else { focusModeEl.classList.remove('visible'); setTimeout(() => focusModeEl.style.display = 'none', 300); }
}
function renderFocusMode() {
    const list = $('focusHabitList'); if (!list) return; list.innerHTML = '';
    const dateStr = currentDate.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
    const focusDate = document.querySelector('.focus-date'); if (focusDate) focusDate.textContent = `Today — ${dateStr}`;
    state.habits.forEach(habit => {
        const isChecked = habit.completed[todayKey] === true;
        const item = document.createElement('div'); item.className = `focus-item${isChecked ? ' done' : ''}`;
        item.style.setProperty('--hcol', habit.color || '#7c3aed');
        const cb = document.createElement('div'); cb.className = `focus-check${isChecked ? ' checked' : ''}`; cb.textContent = isChecked ? '✓' : '';
        cb.onclick = () => { toggleHabit(habit, todayKey); renderFocusMode(); };
        const info = document.createElement('div'); info.className = 'focus-info';
        info.innerHTML = `<div class="focus-name">${habit.name}</div><div class="focus-meta">${DIFF_LABEL[habit.difficulty || 'medium']} • +${XP_MAP[habit.difficulty || 'medium']} XP • ${habit.category || 'Personal'}</div>`;
        item.appendChild(cb); item.appendChild(info); list.appendChild(item);
    });
    const done = state.habits.filter(h => h.completed[todayKey]).length, total = state.habits.length;
    if ($('focusDoneCount')) $('focusDoneCount').textContent = done;
    if ($('focusTotalCount')) $('focusTotalCount').textContent = total;
    const fill = $('focusProgFill'); if (fill) fill.style.width = total ? `${done / total * 100}%` : '0%';
}
$('focusBtn')?.addEventListener('click', toggleFocusMode);
$('exitFocusBtn')?.addEventListener('click', () => { focusModeActive = true; toggleFocusMode(); });

// ─── Templates ────────────────────────────────────────────────────────────────
const HABIT_TEMPLATES = {
    morning: { name:'🌅 Morning Routine', description:'Start every day strong', color:'#f59e0b', habits:[{name:'Wake up Early ⏰',color:'#f59e0b',difficulty:'medium',category:'Personal'},{name:'Meditate 🧘',color:'#7c3aed',difficulty:'easy',category:'Mindfulness'},{name:'Morning Exercise 🤸',color:'#0ea5e9',difficulty:'hard',category:'Fitness'},{name:'Journaling ✍️',color:'#10b981',difficulty:'easy',category:'Personal'}]},
    fitness: { name:'💪 Fitness Pack',    description:'Build your dream body',  color:'#0ea5e9', habits:[{name:'Gym Workout 💪',color:'#ec4899',difficulty:'hard',category:'Fitness'},{name:'Running 🏃',color:'#f59e0b',difficulty:'medium',category:'Fitness'},{name:'Drink 8 Glasses 💧',color:'#0ea5e9',difficulty:'easy',category:'Health'},{name:'Stretching 🧘',color:'#10b981',difficulty:'easy',category:'Fitness'}]},
    student: { name:'📚 Student Pack',    description:'Maximize your potential',color:'#7c3aed', habits:[{name:'Study Session 📚',color:'#7c3aed',difficulty:'hard',category:'Learning'},{name:'Reading 30min 📖',color:'#0ea5e9',difficulty:'medium',category:'Learning'},{name:'No Social Media 📵',color:'#ef4444',difficulty:'hard',category:'Personal'},{name:'Sleep by 11pm 🛌',color:'#10b981',difficulty:'medium',category:'Health'}]},
    wellness:{ name:'🌿 Wellness Pack',   description:'Mind, body, and soul',   color:'#10b981', habits:[{name:'Gratitude Journal 🙏',color:'#10b981',difficulty:'easy',category:'Mindfulness'},{name:'Walk 10k Steps 🚶',color:'#22c55e',difficulty:'medium',category:'Fitness'},{name:'No Junk Food 🥗',color:'#f59e0b',difficulty:'hard',category:'Health'},{name:'Mindfulness 🧠',color:'#7c3aed',difficulty:'easy',category:'Mindfulness'}]}
};
function showTemplateModal() {
    const grid = $('templateGrid'); if (!grid) return; grid.innerHTML = '';
    Object.entries(HABIT_TEMPLATES).forEach(([key, pack]) => {
        const card = document.createElement('div'); card.className = 'template-card'; card.style.borderColor = pack.color + '55';
        card.innerHTML = `<div class="template-name" style="color:${pack.color}">${pack.name}</div><div class="template-desc">${pack.description}</div><ul class="template-habits">${pack.habits.map(h => `<li style="color:${h.color}">${h.name} <span style="opacity:.5;font-size:10px">${DIFF_LABEL[h.difficulty]}</span></li>`).join('')}</ul><button class="btn template-add-btn" data-key="${key}">+ Add Pack</button>`;
        card.querySelector('button').onclick = () => { applyTemplate(key); closeModal('templateModal'); };
        grid.appendChild(card);
    });
    openModal('templateModal');
}
function applyTemplate(key) {
    const pack = HABIT_TEMPLATES[key]; if (!pack) return; pushUndo();
    pack.habits.forEach(h => state.habits.push({ id: Date.now().toString() + Math.random(), name: h.name, completed: {}, notes: {}, color: h.color, frequency: 'daily', difficulty: h.difficulty, category: h.category }));
    showToast(`✅ ${pack.name} added!`); saveState();
}
$('templateBtn')?.addEventListener('click', showTemplateModal);
$('closeTemplateBtn')?.addEventListener('click', () => closeModal('templateModal'));

// ─── Archive ──────────────────────────────────────────────────────────────────
function renderArchiveModal() {
    const list = $('archiveList'); if (!list) return; list.innerHTML = '';
    const archived = state.archivedHabits || [];
    if (!archived.length) { list.innerHTML = '<p style="color:var(--sub);text-align:center;padding:20px">No archived habits yet.</p>'; return; }
    archived.forEach(h => {
        const row = document.createElement('div'); row.className = 'archive-row'; row.style.borderLeftColor = h.color || '#7c3aed';
        row.innerHTML = `<span class="archive-name">${h.name}</span><button class="btn" style="font-size:12px;padding:6px 14px" data-id="${h.id}">↩️ Restore</button>`;
        row.querySelector('button').onclick = () => restoreHabit(h.id); list.appendChild(row);
    });
}
$('archiveBtn')?.addEventListener('click', () => { renderArchiveModal(); openModal('archiveModal'); });
$('closeArchiveBtn')?.addEventListener('click', () => closeModal('archiveModal'));

// ─── Share Card ───────────────────────────────────────────────────────────────
function renderShareCard() {
    const canvas = $('shareCanvas'); if (!canvas) return;
    canvas.width = 600; canvas.height = 340;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 600, 340); g.addColorStop(0, '#0b0c10'); g.addColorStop(1, '#1a0a2e'); ctx.fillStyle = g; ctx.fillRect(0, 0, 600, 340);
    ctx.beginPath(); ctx.arc(80, 80, 150, 0, Math.PI * 2); ctx.fillStyle = 'rgba(79,70,229,0.12)'; ctx.fill();
    ctx.beginPath(); ctx.arc(520, 260, 100, 0, Math.PI * 2); ctx.fillStyle = 'rgba(236,72,153,0.12)'; ctx.fill();
    const av = getAvatarData(); ctx.font = '68px serif'; ctx.textAlign = 'center'; ctx.fillText(av.emoji, 300, 100);
    ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText('Track It. Stick To It. Become It.', 300, 145);
    const streak = getStreakCount(state), tg = ctx.createLinearGradient(80, 0, 520, 0); tg.addColorStop(0, '#4f46e5'); tg.addColorStop(1, '#ec4899');
    ctx.font = 'bold 58px sans-serif'; ctx.fillStyle = tg; ctx.fillText(`🔥 ${streak} Day Streak`, 300, 228);
    ctx.font = '19px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillText(`${av.title} • Level ${state.level} • ${state.xp} XP`, 300, 275);
    ctx.font = '12px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillText('habit-tracker-sigma-amber.vercel.app', 300, 312);
}
$('shareBtn')?.addEventListener('click', () => { renderShareCard(); openModal('shareModal'); });
$('downloadShareBtn')?.addEventListener('click', () => { const c = $('shareCanvas'); c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'habit-streak.png'; a.click(); }); });
$('closeShareBtn')?.addEventListener('click', () => closeModal('shareModal'));

// ─── Onboarding ───────────────────────────────────────────────────────────────
function showOnboarding() {
    const ov = $('onboardingOverlay'); if (!ov) return;
    ['ob-step-1','ob-step-2','ob-step-3'].forEach((id, i) => { const el = $(id); if (el) el.classList.toggle('active', i === 0); });
    ov.style.display = 'flex'; setTimeout(() => ov.classList.add('visible'), 10);
}
function closeOnboarding() {
    const ov = $('onboardingOverlay'); if (!ov) return;
    ov.classList.remove('visible'); setTimeout(() => ov.style.display = 'none', 300);
    state.onboardingDone = true; saveState();
}
$('obCloseBtn')?.addEventListener('click', closeOnboarding);
$('obTemplateBtn')?.addEventListener('click', () => { closeOnboarding(); setTimeout(() => showTemplateModal(), 300); });

// ─── Note Modal ───────────────────────────────────────────────────────────────
function openNoteModal(habit, dateKey) {
    selectedNoteTarget = { habit, dateKey };
    const d = new Date(dateKey);
    $('noteModalLabel').textContent = `${habit.name} — ${d.toDateString()}`;
    $('noteInput').value = habit.notes?.[dateKey] || '';
    openModal('noteModal');
    $('noteInput').focus();
}
function closeNoteModal() { closeModal('noteModal'); selectedNoteTarget = null; }
$('saveNoteBtn')?.addEventListener('click', () => {
    if (!selectedNoteTarget) return;
    const { habit, dateKey } = selectedNoteTarget;
    if (!habit.notes) habit.notes = {};
    const v = $('noteInput').value.trim();
    if (v) habit.notes[dateKey] = v; else delete habit.notes[dateKey];
    closeNoteModal(); saveState();
});
$('cancelNoteBtn')?.addEventListener('click', closeNoteModal);
$('noteModal')?.addEventListener('click', e => { if (e.target === $('noteModal')) closeNoteModal(); });

// ─── Audio ────────────────────────────────────────────────────────────────────
function playCheckSound() {
    try {
        const ac = new (window.AudioContext || window.webkitAudioContext)(), osc = ac.createOscillator(), g = ac.createGain();
        osc.connect(g); g.connect(ac.destination);
        osc.frequency.setValueAtTime(880, ac.currentTime);
        osc.frequency.exponentialRampToValueAtTime(660, ac.currentTime + 0.1);
        g.gain.setValueAtTime(0.1, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25);
        osc.start(ac.currentTime); osc.stop(ac.currentTime + 0.25);
    } catch(e) {}
}

// ─── Notifications ────────────────────────────────────────────────────────────
function scheduleReminder() {
    const t = new Date(); t.setHours(20, 0, 0, 0); if (new Date() > t) t.setDate(t.getDate() + 1);
    setTimeout(() => {
        const done = state.habits.length > 0 && state.habits.every(h => h.completed[todayKey]);
        if (!done && Notification.permission === 'granted') new Notification('🔥 Habit Reminder', { body: "Don't forget your habits! Keep that streak alive! 💪" });
    }, t - new Date());
}
$('notifBtn')?.addEventListener('click', () => {
    'Notification' in window && Notification.requestPermission().then(p => {
        if (p === 'granted') { $('notifBtn').textContent = '🔔 On'; showToast('🔔 Reminders enabled!'); }
        else showToast('Allow notifications in browser settings.');
    });
});

// ─── CSV Export / Import ──────────────────────────────────────────────────────
$('downloadCsvBtn')?.addEventListener('click', () => {
    let csv = 'Habit,Difficulty,Category,' + dates.map(d => d.toLocaleDateString()).join(',') + '\n';
    state.habits.forEach(h => { csv += `"${h.name}",${h.difficulty},${h.category},` + dates.map(d => h.completed[dateToKey(d)] ? '✓' : '').join(',') + '\n'; });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' })); a.download = `habits-${todayKey}.csv`; a.click();
});
$('importCsvBtn')?.addEventListener('click', () => $('csvFileInput').click());
$('csvFileInput')?.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = ev => {
        const lines = ev.target.result.split('\n').filter(l => l.trim());
        const colors = ['#7c3aed','#0ea5e9','#10b981','#f59e0b','#ec4899'];
        let added = 0;
        lines.forEach((l, i) => {
            if (i === 0 && l.toLowerCase().includes('habit')) return;
            const name = l.split(',')[0].replace(/"/g, '').trim();
            if (name) { pushUndo(); state.habits.push({ id: Date.now().toString() + Math.random(), name, completed:{}, notes:{}, color: colors[added % colors.length], frequency:'daily', difficulty:'medium', category:'Personal' }); added++; }
        });
        if (added > 0) { showToast(`📂 Imported ${added} habit${added > 1 ? 's' : ''}!`); saveState(); }
        else showToast('No habits found in CSV.');
        $('csvFileInput').value = '';
    };
    r.readAsText(f);
});
$('printReportBtn')?.addEventListener('click', () => window.print());

// ─── Modal helpers ────────────────────────────────────────────────────────────
function openModal(id) {
    const m = $(id); if (!m) return;
    m.style.display = 'flex';
    setTimeout(() => m.classList.add('visible'), 10);
}
function closeModal(id) {
    const m = $(id); if (!m) return;
    m.classList.remove('visible');
    setTimeout(() => m.style.display = 'none', 300);
}
// Close on backdrop click
['noteModal','pomodoroModal','templateModal','archiveModal','shareModal','themePickerModal','shortcutsModal'].forEach(id => {
    $(id)?.addEventListener('click', e => { if (e.target === $(id)) closeModal(id); });
});
