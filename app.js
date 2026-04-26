import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

// ─── Cloud Error Banner ───────────────────────────────────────────────────────
window.showCloudError = function () {
    if (document.getElementById('cloudErrorBanner')) return;
    const b = document.createElement('div');
    b.id = 'cloudErrorBanner';
    b.innerHTML = `<b>☁️ CLOUD DB ERROR ☁️</b><br>Firebase Firestore missing or locked. Data saved locally only. Fix Firebase Rules!`;
    b.style.cssText = 'background:#ef4444;color:#fff;padding:12px;text-align:center;font-size:13px;position:fixed;top:0;left:0;width:100%;z-index:9999;box-shadow:0 4px 10px rgba(0,0,0,0.5);';
    document.body.prepend(b);
};

// ─── Firebase ─────────────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyBvc1bpouW3NCAp2wdMQbdSCmBiOH1SsYk",
    authDomain: "habit-tracker-3e772.firebaseapp.com",
    projectId: "habit-tracker-3e772",
    storageBucket: "habit-tracker-3e772.firebasestorage.app",
    messagingSenderId: "271076844504",
    appId: "1:271076844504:web:f89b1febca82bb6d3fc8ad",
    measurementId: "G-RFPS1M2NWM"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ─── State ────────────────────────────────────────────────────────────────────
let state = { habits: [], xp: 0, level: 1, badges: [], archivedHabits: [], frozenDates: [], streakFreezeUsed: null, weeklyChallenge: null, onboardingDone: false };
let currentUser = null;
let lastSaveTime = 0;
let selectedNoteTarget = null;
const undoStack = [];

let currentDate = new Date();
currentDate.setHours(0, 0, 0, 0);
function dateToKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
const todayKey = dateToKey(currentDate);

let pieChartInstance = null, barChartInstance = null, selectedCell = null;

// ─── Responsive Dates Array ───────────────────────────────────────────────────
let dates = [];
function updateDatesArray() {
    dates = [];
    const w = window.innerWidth;
    const days = w <= 480 ? 3 : w <= 768 ? 6 : w <= 1400 ? 13 : 20;
    for (let i = days; i >= 0; i--) { const d = new Date(currentDate); d.setDate(d.getDate() - i); dates.push(d); }
}
updateDatesArray();
const daysOfWeek = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
window.addEventListener('resize', () => { const old = dates.length; updateDatesArray(); if (dates.length !== old) { renderSpreadsheet(); updateCharts(); } });

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const loginScreen = document.getElementById('loginScreen');
const appContainer = document.getElementById('appContainer');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const logoutBtn = document.getElementById('logoutBtn');
const addHabitBtn = document.getElementById('addHabitBtn');
const resetBtn = document.getElementById('resetBtn');
const notifBtn = document.getElementById('notifBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const printReportBtn = document.getElementById('printReportBtn');
const shareBtn = document.getElementById('shareBtn');
const templateBtn = document.getElementById('templateBtn');
const archiveBtn = document.getElementById('archiveBtn');
const freezeBtn = document.getElementById('freezeBtn');
const importCsvBtn = document.getElementById('importCsvBtn');
const csvFileInput = document.getElementById('csvFileInput');
const noteModal = document.getElementById('noteModal');
const noteInput = document.getElementById('noteInput');
const templateModal = document.getElementById('templateModal');
const archiveModal = document.getElementById('archiveModal');
const shareModal = document.getElementById('shareModal');
const onboardingOverlay = document.getElementById('onboardingOverlay');

// ─── Auth ─────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        loginScreen.style.display = 'none';
        appContainer.style.display = 'block';
        document.getElementById('ob-step-1').classList.add('active');
        document.getElementById('ob-step-2').classList.remove('active');
        document.getElementById('ob-step-3').classList.remove('active');

        const backup = localStorage.getItem(`habitBackup_${currentUser.uid}`);
        if (backup) {
            try { state = JSON.parse(backup); } catch { state = getDefaultState(); }
            migrateState();
            renderAll();
        } else {
            state = getDefaultState();
            const c = document.getElementById('spreadsheet');
            if (c) c.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#94a3b8;"><p style="font-size:16px;font-weight:600;">☁️ Synchronizing with Cloud...</p></div>';
        }

        loadState().then(() => {
            renderAll();
            if (!state.onboardingDone) showOnboarding();
            scheduleReminder();
        });
    } else {
        currentUser = null;
        loginScreen.style.display = 'flex';
        appContainer.style.display = 'none';
    }
});
googleSignInBtn.onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(e => alert("Sign in failed: " + e.message));
logoutBtn.onclick = () => signOut(auth);

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

// ─── Default State + Migration ────────────────────────────────────────────────
function getDefaultState() {
    return {
        habits: [
            { id:'1', name:'Wake up at 5:00 ⏰', completed:{}, notes:{}, color:'#f59e0b', frequency:'daily' },
            { id:'2', name:'Gym 💪', completed:{}, notes:{}, color:'#0ea5e9', frequency:'daily' },
            { id:'3', name:'Reading / Learning 📖', completed:{}, notes:{}, color:'#10b981', frequency:'daily' },
            { id:'4', name:'Day Planning 📅', completed:{}, notes:{}, color:'#7c3aed', frequency:'daily' }
        ],
        xp:0, level:1, badges:[], archivedHabits:[], frozenDates:[], streakFreezeUsed:null, weeklyChallenge:null, onboardingDone:false
    };
}
function migrateState() {
    if (!state.badges) state.badges = [];
    if (!state.archivedHabits) state.archivedHabits = [];
    if (!state.frozenDates) state.frozenDates = [];
    if (state.streakFreezeUsed === undefined) state.streakFreezeUsed = null;
    if (state.weeklyChallenge === undefined) state.weeklyChallenge = null;
    if (state.onboardingDone === undefined) state.onboardingDone = false;
    state.habits.forEach(h => {
        if (!h.notes) h.notes = {};
        if (!h.color) h.color = '#7c3aed';
        if (!h.frequency) h.frequency = 'daily';
    });
}

// ─── Load / Save ──────────────────────────────────────────────────────────────
async function loadState() {
    if (!currentUser) return;
    const fetchStart = Date.now();
    try {
        const snap = await getDoc(doc(db, "users", currentUser.uid));
        if (lastSaveTime > fetchStart) return;
        if (snap.exists()) {
            state = snap.data();
            migrateState();
            localStorage.setItem(`habitBackup_${currentUser.uid}`, JSON.stringify(state));
        } else {
            const backup = localStorage.getItem(`habitBackup_${currentUser.uid}`);
            state = backup ? JSON.parse(backup) : getDefaultState();
            migrateState();
            await saveState();
        }
    } catch (err) {
        console.error("Firestore Load:", err);
        showCloudError();
        const backup = localStorage.getItem(`habitBackup_${currentUser.uid}`);
        state = backup ? JSON.parse(backup) : getDefaultState();
        migrateState();
    }
}

async function saveState() {
    if (!currentUser) return;
    lastSaveTime = Date.now();
    renderAll();
    try {
        localStorage.setItem(`habitBackup_${currentUser.uid}`, JSON.stringify(state));
        await setDoc(doc(db, "users", currentUser.uid), state);
    } catch (err) { console.error("Firestore Save:", err); showCloudError(); }
}

// ─── Undo System ─────────────────────────────────────────────────────────────
function pushUndo() {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 20) undoStack.shift();
}
async function undo() {
    if (!undoStack.length) { showToast('↕ Nothing to undo!'); return; }
    state = JSON.parse(undoStack.pop());
    await saveState();
    showToast('↩️ Undone!');
}
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); } });

function showToast(msg) {
    const toast = document.getElementById('milestoneToast');
    toast.innerHTML = msg;
    toast.style.display = 'flex';
    setTimeout(() => toast.classList.add('visible'), 50);
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.style.display = 'none', 500); }, 3000);
}

// ─── Spreadsheet ──────────────────────────────────────────────────────────────
function renderSpreadsheet() {
    try {
        const container = document.getElementById('spreadsheet');
        if (!container) return;
        if (!state?.habits || !Array.isArray(state.habits)) state = getDefaultState();

        const w = window.innerWidth;
        const nameWidth = w <= 480 ? '115px' : w <= 800 ? '165px' : '220px';
        container.style.gridTemplateColumns = `40px ${nameWidth} repeat(${dates.length}, 45px)`;
        container.innerHTML = '';

        createCell(container, '', 'cell row-header');
        createCell(container, 'My Habits', 'cell header-title sticky-col');
        dates.forEach(d => createCell(container, daysOfWeek[d.getDay()], 'cell col-header-day'));

        createCell(container, '', 'cell row-header');
        createCell(container, '', 'cell habit-name sticky-col', 'background-color:var(--habit-col-bg)');
        dates.forEach(d => createCell(container, d.getDate(), 'cell col-header-date'));

        state.habits.forEach((habit, hIdx) => {
            createCell(container, hIdx + 1, 'cell row-header');

            const nameCell = document.createElement('div');
            nameCell.className = 'cell habit-name sticky-col draggable';
            nameCell.dataset.habitId = habit.id;
            nameCell.draggable = true;
            nameCell.style.borderLeft = `4px solid ${habit.color || '#7c3aed'}`;

            nameCell.ondragstart = e => { e.dataTransfer.setData('text/plain', hIdx); nameCell.classList.add('dragging'); };
            nameCell.ondragover = e => { e.preventDefault(); nameCell.classList.add('drag-over'); };
            nameCell.ondragleave = () => nameCell.classList.remove('drag-over');
            nameCell.ondrop = e => {
                e.preventDefault(); nameCell.classList.remove('drag-over');
                const from = parseInt(e.dataTransfer.getData('text/plain'));
                if (from !== hIdx) { pushUndo(); const [m] = state.habits.splice(from, 1); state.habits.splice(hIdx, 0, m); saveState(); }
            };
            nameCell.ondragend = () => { nameCell.classList.remove('dragging'); document.querySelectorAll('.habit-name').forEach(n => n.classList.remove('drag-over')); };

            const textSpan = document.createElement('span');
            textSpan.textContent = habit.name;

            const actionsSpan = document.createElement('span');
            actionsSpan.className = 'habit-actions';
            actionsSpan.innerHTML = `<span title="Archive" class="action-icon" data-action="archive" data-id="${habit.id}">📁</span><span title="Delete" class="action-icon" data-action="delete" data-id="${habit.id}">✕</span>`;
            actionsSpan.onclick = e => {
                e.stopPropagation();
                const action = e.target.dataset.action;
                if (action === 'delete') deleteHabit(habit.id);
                if (action === 'archive') archiveHabit(habit.id);
            };

            nameCell.appendChild(textSpan);
            nameCell.appendChild(actionsSpan);
            nameCell.onclick = () => selectCell(nameCell);
            container.appendChild(nameCell);

            dates.forEach(d => {
                const k = dateToKey(d);
                const isChecked = habit.completed[k] === true;
                const isPast = k < todayKey;
                const isFrozen = (state.frozenDates || []).includes(k);
                const hasNote = !!(habit.notes && habit.notes[k]);

                const checkCell = document.createElement('div');
                checkCell.className = `cell checkbox-cell${isPast && !isFrozen ? ' disabled-cell' : ''}`;

                const box = document.createElement('div');
                box.className = `square-box${isChecked ? ' checked' : ''}${isFrozen && !isChecked ? ' frozen-box' : ''}`;
                if (isChecked) box.style.background = `linear-gradient(135deg, ${habit.color || '#4f46e5'}, #ec4899)`;
                checkCell.appendChild(box);

                if (hasNote) { const nd = document.createElement('span'); nd.className = 'note-dot'; nd.title = habit.notes[k]; checkCell.appendChild(nd); }

                checkCell.onclick = () => { if (!isPast || isFrozen) toggleHabit(habit, k); };
                checkCell.oncontextmenu = e => { e.preventDefault(); if (isChecked) openNoteModal(habit, k); };
                let pressTimer;
                checkCell.addEventListener('touchstart', () => { pressTimer = setTimeout(() => { if (isChecked) openNoteModal(habit, k); }, 600); });
                checkCell.addEventListener('touchend', () => clearTimeout(pressTimer));

                container.appendChild(checkCell);
            });
        });

        createCell(container, state.habits.length + 1, 'cell row-header');
        createCell(container, 'Daily Progress', 'cell progress-cell sticky-col');
        dates.forEach(d => {
            const k = dateToKey(d);
            const comps = state.habits.filter(h => h.completed[k]).length;
            const pct = state.habits.length ? Math.round(comps / state.habits.length * 100) : 0;
            createCell(container, `${pct}%`, 'cell progress-cell');
        });

        if (selectedCell?.dataset.habitId) {
            container.querySelectorAll('.habit-name').forEach(n => { if (n.dataset.habitId === selectedCell.dataset.habitId) n.classList.add('selected'); });
        }
    } catch (err) { console.error("Spreadsheet Error:", err); }
}

function createCell(parent, text, className, inlineStyle = '') {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    if (inlineStyle) div.setAttribute('style', inlineStyle);
    parent.appendChild(div);
    return div;
}

// ─── Cell Selection / Edit ────────────────────────────────────────────────────
function selectCell(cellDiv) {
    document.querySelectorAll('.cell').forEach(c => c.classList.remove('selected'));
    cellDiv.classList.add('selected');
    selectedCell = cellDiv;
    if (!cellDiv.classList.contains('habit-name') || !cellDiv.dataset.habitId) return;
    const habit = state.habits.find(h => h.id === cellDiv.dataset.habitId);
    if (!habit) return;

    cellDiv.innerHTML = '';
    const input = document.createElement('input');
    input.className = 'habit-input';
    input.value = habit.name;

    const cp = document.createElement('input');
    cp.type = 'color'; cp.value = habit.color || '#7c3aed'; cp.className = 'habit-color-picker'; cp.title = 'Pick color';
    cp.onchange = () => { habit.color = cp.value; saveState(); };

    const fs = document.createElement('select');
    fs.className = 'freq-select';
    [['daily','Daily'],['weekdays','Weekdays'],['weekends','Weekends'],['3x','3×/wk'],['2x','2×/wk']].forEach(([v, l]) => {
        const o = document.createElement('option'); o.value = v; o.textContent = l; if (habit.frequency === v) o.selected = true; fs.appendChild(o);
    });
    fs.onchange = () => { habit.frequency = fs.value; saveState(); };
    fs.onclick = e => e.stopPropagation();

    input.onblur = () => { if (input.value.trim()) habit.name = input.value.trim(); saveState(); };
    input.onkeydown = e => { if (e.key === 'Enter') input.blur(); };
    cellDiv.appendChild(input); cellDiv.appendChild(cp); cellDiv.appendChild(fs);
    input.focus();
}

// ─── Toggle Habit ─────────────────────────────────────────────────────────────
function toggleHabit(habit, dateKey) {
    if (dateKey < todayKey && !(state.frozenDates || []).includes(dateKey)) return;
    pushUndo();
    if (habit.completed[dateKey]) {
        delete habit.completed[dateKey]; state.xp = Math.max(0, state.xp - 10);
    } else {
        habit.completed[dateKey] = true; state.xp += 10; playCheckSound();
    }
    if (state.xp >= state.level * 100) { state.level++; state.xp = 0; }
    checkMilestones();
    checkWeeklyChallenge();
    saveState();
}

function deleteHabit(id) {
    if (confirm('Delete this habit permanently?')) {
        pushUndo();
        state.habits = state.habits.filter(h => h.id !== id);
        selectedCell = null; saveState();
    }
}

function archiveHabit(id) {
    pushUndo();
    const idx = state.habits.findIndex(h => h.id === id);
    if (idx === -1) return;
    const [habit] = state.habits.splice(idx, 1);
    if (!state.archivedHabits) state.archivedHabits = [];
    state.archivedHabits.push(habit);
    selectedCell = null;
    showToast(`📁 "${habit.name.split(' ')[0]}" archived!`);
    saveState();
}

function restoreHabit(id) {
    const idx = state.archivedHabits.findIndex(h => h.id === id);
    if (idx === -1) return;
    const [habit] = state.archivedHabits.splice(idx, 1);
    state.habits.push(habit);
    showToast(`✅ "${habit.name.split(' ')[0]}" restored!`);
    saveState();
    renderArchiveModal();
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function getStreakCount(s) {
    let streak = 0;
    const temp = new Date(currentDate);
    const frozen = s.frozenDates || [];
    while (true) {
        const k = dateToKey(temp);
        if (s.habits.some(h => h.completed[k]) || frozen.includes(k)) { streak++; temp.setDate(temp.getDate() - 1); }
        else break;
    }
    return streak;
}

function updateStats() {
    try {
        const streak = getStreakCount(state);
        const el = id => document.getElementById(id);
        if (el('streakCount')) el('streakCount').textContent = streak;
        if (el('levelDisplay')) el('levelDisplay').textContent = `Lv. ${state.level}`;
        if (el('xpScore')) el('xpScore').textContent = state.xp;
    } catch (e) { console.error("Stats:", e); }
}

// ─── Avatar & XP Bar ─────────────────────────────────────────────────────────
function getAvatarData() {
    const l = state.level;
    if (l <= 1) return { emoji: '🌱', title: 'Seedling', color: '#10b981' };
    if (l <= 2) return { emoji: '🌿', title: 'Sprout', color: '#22c55e' };
    if (l <= 3) return { emoji: '⚡', title: 'Energized', color: '#f59e0b' };
    if (l <= 5) return { emoji: '🔥', title: 'On Fire', color: '#ef4444' };
    if (l <= 8) return { emoji: '💎', title: 'Diamond', color: '#60a5fa' };
    return { emoji: '🦁', title: 'Legend', color: '#ec4899' };
}
function renderAvatar() {
    const av = getAvatarData();
    const el = id => document.getElementById(id);
    if (el('avatarBubble')) el('avatarBubble').textContent = av.emoji;
    if (el('avatarTitle')) el('avatarTitle').textContent = av.title;
    if (el('avatarLevelBadge')) el('avatarLevelBadge').textContent = `Lv. ${state.level}`;
    if (el('avatarLevelBadge')) el('avatarLevelBadge').style.background = av.color + '33';
    if (el('avatarLevelBadge')) el('avatarLevelBadge').style.color = av.color;
}
function renderXpBar() {
    const needed = state.level * 100;
    const pct = Math.min(100, Math.round(state.xp / needed * 100));
    const fill = document.getElementById('xpBarFill');
    const label = document.getElementById('xpBarLabel');
    if (fill) fill.style.width = pct + '%';
    if (label) label.textContent = `${state.xp} / ${needed} XP`;
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function updateCharts() {
    try {
        if (!document.getElementById('pieChart') || typeof Chart === 'undefined') return;
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        Chart.defaults.color = isLight ? '#0f172a' : '#fff';
        Chart.defaults.font.family = "'Inter', sans-serif";

        let total = state.habits.length * dates.length, done = 0;
        const habitData = state.habits.map(h => {
            const comps = dates.filter(d => h.completed[dateToKey(d)]).length;
            done += comps;
            return { name: h.name.split(' ')[0], comps, color: h.color || '#7c3aed' };
        });

        if (pieChartInstance) pieChartInstance.destroy();
        pieChartInstance = new Chart(document.getElementById('pieChart').getContext('2d'), {
            type: 'doughnut',
            data: { labels: ['Done','Missed'], datasets: [{ data:[done, Math.max(0,total-done)], backgroundColor:['#7c3aed','rgba(255,255,255,0.08)'], borderWidth:0 }] },
            options: { responsive:true, maintainAspectRatio:false }
        });

        if (barChartInstance) barChartInstance.destroy();
        barChartInstance = new Chart(document.getElementById('barChart').getContext('2d'), {
            type: 'bar',
            data: { labels: habitData.map(h=>h.name), datasets: [{ label:'Completions', data:habitData.map(h=>h.comps), backgroundColor:habitData.map(h=>h.color), borderRadius:6 }] },
            options: { responsive:true, maintainAspectRatio:false }
        });
    } catch (e) { console.error("Charts:", e); }
}

// ─── Weekly Challenge ─────────────────────────────────────────────────────────
function getWeekStartKey() {
    const d = new Date(currentDate); d.setDate(d.getDate() - d.getDay()); return dateToKey(d);
}
function generateWeeklyChallenge() {
    const ws = getWeekStartKey();
    if (state.weeklyChallenge && state.weeklyChallenge.weekStart === ws) return;
    const types = [
        { type:'perfect', description:'Have a 100% completion day 3 times this week', target:3, bonusXp:60 },
        { type:'rate', description:'Hit 75%+ completion rate for 5 days', target:5, bonusXp:50 },
        { type:'all_week', description:'Complete at least 1 habit every single day', target:7, bonusXp:70 },
    ];
    if (state.habits.length > 0) {
        const h = state.habits[Math.floor(Math.random() * state.habits.length)];
        types.push({ type:'habit', description:`Complete "${h.name.split(' ')[0]}" every day this week`, target:7, habitId:h.id, bonusXp:80 });
    }
    const chosen = types[Math.floor(Math.random() * types.length)];
    state.weeklyChallenge = { ...chosen, weekStart:ws, progress:0, completed:false };
}
function checkWeeklyChallenge() {
    if (!state.weeklyChallenge || state.weeklyChallenge.completed) return;
    if (state.weeklyChallenge.weekStart !== getWeekStartKey()) return;
    const { type, target, habitId } = state.weeklyChallenge;
    let progress = 0;
    for (let i = 0; i < 7; i++) {
        const d = new Date(currentDate); d.setDate(d.getDate() - d.getDay() + i);
        if (d > currentDate) break;
        const k = dateToKey(d);
        const comps = state.habits.filter(h => h.completed[k]).length;
        if (type === 'perfect' && comps === state.habits.length && state.habits.length > 0) progress++;
        else if (type === 'rate' && state.habits.length && (comps/state.habits.length) >= 0.75) progress++;
        else if (type === 'all_week' && comps > 0) progress++;
        else if (type === 'habit' && habitId) { const h = state.habits.find(h => h.id === habitId); if (h && h.completed[k]) progress++; }
    }
    state.weeklyChallenge.progress = progress;
    if (progress >= target) {
        state.weeklyChallenge.completed = true;
        state.xp += state.weeklyChallenge.bonusXp;
        showMilestoneToast({ emoji:'🎯', label:`Weekly Challenge Complete! +${state.weeklyChallenge.bonusXp} XP` });
        launchConfetti();
    }
}
function renderWeeklyChallenge() {
    const ch = state.weeklyChallenge;
    if (!ch) return;
    const desc = document.getElementById('challengeDesc');
    const bar = document.getElementById('challengeBarFill');
    const prog = document.getElementById('challengeProgressText');
    if (desc) desc.textContent = ch.description;
    const pct = ch.target > 0 ? Math.min(100, Math.round(ch.progress / ch.target * 100)) : 0;
    if (bar) { bar.style.width = pct + '%'; bar.style.background = ch.completed ? 'linear-gradient(90deg,#10b981,#22c55e)' : 'linear-gradient(90deg,#4f46e5,#ec4899)'; }
    if (prog) prog.textContent = `${ch.progress}/${ch.target}${ch.completed ? ' ✅' : ''}`;
}

// ─── Analytics ────────────────────────────────────────────────────────────────
function renderAnalytics() {
    if (!state.habits.length) return;
    // Best day of week
    const dayTotals = Array(7).fill(0), dayCounts = Array(7).fill(0);
    for (let i = 0; i < 30; i++) {
        const d = new Date(currentDate); d.setDate(d.getDate() - i);
        const k = dateToKey(d), dow = d.getDay();
        const comps = state.habits.filter(h => h.completed[k]).length;
        dayTotals[dow] += state.habits.length ? comps / state.habits.length : 0;
        dayCounts[dow]++;
    }
    const dayAvgs = dayTotals.map((t, i) => dayCounts[i] ? t / dayCounts[i] : 0);
    const bestDayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const bestDayIdx = dayAvgs.indexOf(Math.max(...dayAvgs));
    const bestEl = document.getElementById('bestDayValue');
    if (bestEl) bestEl.textContent = `${['Su','Mo','Tu','We','Th','Fr','Sa'][bestDayIdx]} — ${bestDayNames[bestDayIdx]}`;

    // Trend
    let last7 = 0, prev7 = 0;
    for (let i = 0; i < 7; i++) { const d = new Date(currentDate); d.setDate(d.getDate()-i); const k=dateToKey(d); last7 += state.habits.filter(h=>h.completed[k]).length / (state.habits.length||1); }
    for (let i = 7; i < 14; i++) { const d = new Date(currentDate); d.setDate(d.getDate()-i); const k=dateToKey(d); prev7 += state.habits.filter(h=>h.completed[k]).length / (state.habits.length||1); }
    last7 /= 7; prev7 /= 7;
    const trendEl = document.getElementById('trendValue');
    if (trendEl) {
        const diff = prev7 > 0 ? Math.round((last7 - prev7) / prev7 * 100) : 0;
        const up = last7 >= prev7;
        trendEl.textContent = `${up ? '↑' : '↓'} ${Math.abs(diff)}% ${up ? 'Improving! 🎉' : 'Keep going 💪'}`;
        trendEl.style.color = up ? '#10b981' : '#f59e0b';
    }

    // Sparkline (4 weeks)
    const weeklyAvgs = [];
    for (let w = 3; w >= 0; w--) {
        let wt = 0;
        for (let d = 0; d < 7; d++) { const date = new Date(currentDate); date.setDate(date.getDate()-w*7-d); const k=dateToKey(date); wt += state.habits.filter(h=>h.completed[k]).length / (state.habits.length||1); }
        weeklyAvgs.push(Math.round(wt / 7 * 100));
    }
    const sparkEl = document.getElementById('sparklineContainer');
    if (sparkEl && weeklyAvgs.length) {
        const sw = 130, sh = 46;
        const maxV = Math.max(...weeklyAvgs, 1);
        const pts = weeklyAvgs.map((v, i) => `${(i/(weeklyAvgs.length-1))*sw},${sh-(v/maxV)*sh}`).join(' ');
        sparkEl.innerHTML = `<svg width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}"><defs><linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#4f46e5"/><stop offset="100%" stop-color="#ec4899"/></linearGradient></defs><polyline points="${pts}" fill="none" stroke="url(#sg)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${weeklyAvgs.map((v,i)=>`<circle cx="${(i/(weeklyAvgs.length-1))*sw}" cy="${sh-(v/maxV)*sh}" r="3.5" fill="#ec4899"/>`).join('')}</svg><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--sub-text);margin-top:4px"><span>4w ago</span><span>3w</span><span>2w</span><span>This wk</span></div>`;
    }

    // Per-habit longest streak
    const habitStreaks = state.habits.map(h => {
        let longest = 0, cur = 0;
        for (let i = 364; i >= 0; i--) {
            const d = new Date(currentDate); d.setDate(d.getDate()-i); const k=dateToKey(d);
            if (h.completed[k]) { cur++; longest = Math.max(longest, cur); } else cur = 0;
        }
        return { name: h.name, longest, color: h.color || '#7c3aed' };
    }).sort((a,b) => b.longest - a.longest);

    const listEl = document.getElementById('habitStreakList');
    if (listEl) {
        listEl.innerHTML = '';
        habitStreaks.slice(0,6).forEach(h => {
            const row = document.createElement('div');
            row.className = 'streak-row';
            row.innerHTML = `<span class="streak-habit-name">${h.name}</span><span class="streak-badge" style="background:${h.color}22;color:${h.color};border:1px solid ${h.color}44">🔥 ${h.longest} days</span>`;
            listEl.appendChild(row);
        });
        if (!habitStreaks.length) listEl.innerHTML = '<span style="color:var(--sub-text);font-size:13px;">Check off habits to build streaks!</span>';
    }
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────
function renderHeatmap() {
    const grid = document.getElementById('heatmapGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const today = new Date(currentDate);
    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    start.setDate(start.getDate() - start.getDay());

    for (let week = 0; week < 53; week++) {
        const col = document.createElement('div');
        col.className = 'heatmap-col';
        for (let day = 0; day < 7; day++) {
            const d = new Date(start); d.setDate(d.getDate() + week*7 + day);
            const cell = document.createElement('div');
            cell.className = 'heatmap-cell';
            if (d > today) { cell.style.background = 'transparent'; col.appendChild(cell); continue; }
            const k = dateToKey(d);
            const comps = state.habits.filter(h => h.completed[k]).length;
            const pct = comps / (state.habits.length || 1);
            const frozen = (state.frozenDates || []).includes(k);
            cell.title = `${d.toDateString()}: ${comps}/${state.habits.length} habits${frozen ? ' ❄️' : ''}`;
            if (frozen) cell.style.background = 'rgba(96,165,250,0.6)';
            else if (pct === 0) cell.style.background = 'rgba(139,92,246,0.07)';
            else if (pct < 0.25) cell.style.background = 'rgba(139,92,246,0.2)';
            else if (pct < 0.5) cell.style.background = 'rgba(139,92,246,0.4)';
            else if (pct < 0.75) cell.style.background = 'rgba(139,92,246,0.65)';
            else if (pct < 1) cell.style.background = 'rgba(236,72,153,0.8)';
            else cell.style.background = 'linear-gradient(135deg,#4f46e5,#ec4899)';
            col.appendChild(cell);
        }
        grid.appendChild(col);
    }
}

// ─── Milestones & Badges ──────────────────────────────────────────────────────
const MILESTONES = [
    { id:'first_check', label:'First Step', emoji:'👶', desc:'Check your first habit', check: s => s.habits.some(h => Object.keys(h.completed).length > 0) },
    { id:'streak_7', label:'7-Day Warrior', emoji:'🔥', desc:'7-day streak', check: s => getStreakCount(s) >= 7 },
    { id:'streak_30', label:'Unstoppable', emoji:'💎', desc:'30-day streak', check: s => getStreakCount(s) >= 30 },
    { id:'xp_100', label:'XP Rising', emoji:'⭐', desc:'Earn 100 XP', check: s => s.xp + (s.level-1)*100 >= 100 },
    { id:'xp_500', label:'XP Legend', emoji:'🌟', desc:'Earn 500 XP', check: s => s.xp + (s.level-1)*100 >= 500 },
    { id:'level_5', label:'Level 5 Pro', emoji:'🏆', desc:'Reach Level 5', check: s => s.level >= 5 },
    { id:'all_habits', label:'Perfect Day', emoji:'✅', desc:'100% all habits in a day', check: s => s.habits.length > 0 && s.habits.every(h => h.completed[todayKey]) },
    { id:'habit_5', label:'Overachiever', emoji:'🚀', desc:'Track 5+ habits', check: s => s.habits.length >= 5 },
    { id:'challenge_win', label:'Challenger', emoji:'🎯', desc:'Complete a weekly challenge', check: s => s.weeklyChallenge?.completed },
    { id:'freeze_used', label:'Ice Guard', emoji:'❄️', desc:'Use a streak freeze', check: s => !!s.streakFreezeUsed },
];
function checkMilestones() {
    if (!state.badges) state.badges = [];
    MILESTONES.forEach(m => {
        if (!state.badges.includes(m.id) && m.check(state)) {
            state.badges.push(m.id);
            showMilestoneToast(m);
            launchConfetti();
        }
    });
}
function renderBadges() {
    const shelf = document.getElementById('badgesShelf');
    if (!shelf) return;
    if (!state.badges) state.badges = [];
    shelf.innerHTML = '';
    MILESTONES.forEach(m => {
        const earned = state.badges.includes(m.id);
        const card = document.createElement('div');
        card.className = `badge-card${earned ? ' earned' : ' locked'}`;
        card.title = m.desc;
        card.innerHTML = `<span class="badge-emoji">${earned ? m.emoji : '🔒'}</span><span class="badge-label">${m.label}</span>`;
        shelf.appendChild(card);
    });
}
function showMilestoneToast(m) {
    const toast = document.getElementById('milestoneToast');
    toast.innerHTML = `${m.emoji} <b>Achievement Unlocked!</b> — ${m.label}`;
    toast.style.display = 'flex';
    setTimeout(() => toast.classList.add('visible'), 50);
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.style.display='none', 500); }, 3500);
}

// ─── Confetti ─────────────────────────────────────────────────────────────────
function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const colors = ['#4f46e5','#ec4899','#f59e0b','#10b981','#0ea5e9','#8b5cf6'];
    const particles = Array.from({length:100}, () => ({ x:Math.random()*canvas.width, y:Math.random()*-canvas.height, r:Math.random()*7+2, color:colors[Math.floor(Math.random()*colors.length)], speed:Math.random()*4+2, tiltAngle:0 }));
    let frame = 0;
    function draw() {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        particles.forEach(p => { p.tiltAngle+=0.1; p.y+=p.speed; p.x+=Math.sin(p.tiltAngle)*2; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fillStyle=p.color; ctx.globalAlpha=Math.max(0,1-frame/120); ctx.fill(); });
        ctx.globalAlpha=1; frame++;
        if (frame<140) requestAnimationFrame(draw); else ctx.clearRect(0,0,canvas.width,canvas.height);
    }
    draw();
}

// ─── Daily Quote ──────────────────────────────────────────────────────────────
const QUOTES = [
    { text:'We are what we repeatedly do. Excellence is not an act but a habit.', author:'Aristotle' },
    { text:'Success is the sum of small efforts, repeated day in and day out.', author:'Robert Collier' },
    { text:'Motivation is what gets you started. Habit is what keeps you going.', author:'Jim Ryun' },
    { text:'The secret of getting ahead is getting started.', author:'Mark Twain' },
    { text:'You are what you do, not what you say you\'ll do.', author:'C.G. Jung' },
    { text:'Small daily improvements over time lead to stunning results.', author:'Robin Sharma' },
    { text:'It\'s not what we do once in a while that shapes our lives. It\'s what we do consistently.', author:'Tony Robbins' },
    { text:'Discipline is the bridge between goals and accomplishment.', author:'Jim Rohn' },
    { text:'The chains of habit are too light to be felt until they are too heavy to be broken.', author:'Warren Buffett' },
    { text:'A journey of a thousand miles begins with a single step.', author:'Lao Tzu' },
    { text:'Don\'t watch the clock; do what it does. Keep going.', author:'Sam Levenson' },
    { text:'Action is the foundational key to all success.', author:'Pablo Picasso' },
    { text:'The future depends on what you do today.', author:'Mahatma Gandhi' },
    { text:'Either you run the day, or the day runs you.', author:'Jim Rohn' },
    { text:'The difference between who you are and who you want to be is what you do.', author:'Unknown' },
    { text:'Focus on progress, not perfection.', author:'Unknown' },
    { text:'One day or day one. You decide.', author:'Unknown' },
    { text:'A little progress each day adds up to big results.', author:'Unknown' },
    { text:'Fall seven times, stand up eight.', author:'Japanese Proverb' },
    { text:'Your habits will determine your future.', author:'Jack Canfield' },
    { text:'Success doesn\'t come from what you do occasionally, it comes from what you do consistently.', author:'Marie Forleo' },
    { text:'All our life is but a mass of habits.', author:'William James' },
    { text:'First forget inspiration. Habit is more dependable.', author:'Octavia Butler' },
    { text:'We first make our habits, then our habits make us.', author:'John Dryden' },
    { text:'Winning is a habit. Unfortunately, so is losing.', author:'Vince Lombardi' },
    { text:'Good habits formed at youth make all the difference.', author:'Aristotle' },
    { text:'Your net worth to the world is usually determined by what remains after your bad habits are subtracted from your good ones.', author:'Benjamin Franklin' },
    { text:'The best time to start was yesterday. The next best time is now.', author:'Unknown' },
    { text:'Do something today that your future self will thank you for.', author:'Unknown' },
    { text:'Strive for progress, not perfection.', author:'Unknown' },
];
function renderDailyQuote() {
    const el = document.getElementById('quoteText');
    if (!el) return;
    const dayOfYear = Math.floor((currentDate - new Date(currentDate.getFullYear(), 0, 0)) / 86400000);
    const q = QUOTES[dayOfYear % QUOTES.length];
    el.innerHTML = `"${q.text}" <span style="opacity:0.6;font-size:12px">— ${q.author}</span>`;
}

// ─── Streak Freeze ────────────────────────────────────────────────────────────
function streakFreeze() {
    const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2,'0')}`;
    if (state.streakFreezeUsed === currentMonth) { showToast('❄️ Streak freeze already used this month!'); return; }
    if ((state.frozenDates||[]).includes(todayKey)) { showToast('❄️ Today is already frozen!'); return; }
    if (!state.frozenDates) state.frozenDates = [];
    state.frozenDates.push(todayKey);
    state.streakFreezeUsed = currentMonth;
    checkMilestones();
    showToast('❄️ Streak Freeze activated! Your streak is safe for today.');
    saveState();
}
if (freezeBtn) freezeBtn.onclick = streakFreeze;

// ─── Habit Templates ──────────────────────────────────────────────────────────
const HABIT_TEMPLATES = {
    morning: {
        name:'🌅 Morning Routine', description:'Start every day strong', color:'#f59e0b',
        habits:[{ name:'Wake up Early ⏰', color:'#f59e0b' },{ name:'Meditate 🧘', color:'#7c3aed' },{ name:'Morning Exercise 🤸', color:'#0ea5e9' },{ name:'Journaling ✍️', color:'#10b981' }]
    },
    fitness: {
        name:'💪 Fitness Pack', description:'Build your dream body', color:'#0ea5e9',
        habits:[{ name:'Gym Workout 💪', color:'#ec4899' },{ name:'Running 🏃', color:'#f59e0b' },{ name:'Drink 8 Glasses 💧', color:'#0ea5e9' },{ name:'Stretching 🧘', color:'#10b981' }]
    },
    student: {
        name:'📚 Student Pack', description:'Maximize your potential', color:'#7c3aed',
        habits:[{ name:'Study Session 📚', color:'#7c3aed' },{ name:'Reading 30min 📖', color:'#0ea5e9' },{ name:'No Social Media 📵', color:'#ef4444' },{ name:'Sleep by 11pm 🛌', color:'#10b981' }]
    },
    wellness: {
        name:'🌿 Wellness Pack', description:'Mind, body, and soul', color:'#10b981',
        habits:[{ name:'Gratitude Journal 🙏', color:'#10b981' },{ name:'Walk 10k Steps 🚶', color:'#22c55e' },{ name:'No Junk Food 🥗', color:'#f59e0b' },{ name:'Mindfulness 🧠', color:'#7c3aed' }]
    }
};
function showTemplateModal() {
    const grid = document.getElementById('templateGrid');
    if (!grid) return;
    grid.innerHTML = '';
    Object.values(HABIT_TEMPLATES).forEach(pack => {
        const card = document.createElement('div');
        card.className = 'template-card';
        card.style.borderColor = pack.color + '66';
        card.innerHTML = `<div class="template-name" style="color:${pack.color}">${pack.name}</div><div class="template-desc">${pack.description}</div><ul class="template-habits">${pack.habits.map(h=>`<li style="color:${h.color}">${h.name}</li>`).join('')}</ul><button class="btn" style="margin-top:12px;font-size:12px;padding:8px 16px" data-pack="${Object.keys(HABIT_TEMPLATES).find(k=>HABIT_TEMPLATES[k].name===pack.name)}">+ Add Pack</button>`;
        card.querySelector('button').onclick = e => {
            const key = e.target.dataset.pack || Object.keys(HABIT_TEMPLATES).find(k=>HABIT_TEMPLATES[k].name===pack.name);
            applyTemplate(key); closeModal('templateModal');
        };
        grid.appendChild(card);
    });
    templateModal.style.display = 'flex';
    setTimeout(() => templateModal.classList.add('visible'), 10);
}
function applyTemplate(key) {
    const pack = HABIT_TEMPLATES[key];
    if (!pack) return;
    pushUndo();
    pack.habits.forEach(h => {
        state.habits.push({ id: Date.now().toString() + Math.random(), name: h.name, completed: {}, notes: {}, color: h.color, frequency: 'daily' });
    });
    showToast(`✅ ${pack.name} added!`);
    saveState();
}
if (templateBtn) templateBtn.onclick = showTemplateModal;
document.getElementById('closeTemplateBtn')?.addEventListener('click', () => closeModal('templateModal'));

// ─── Archive Modal ────────────────────────────────────────────────────────────
function renderArchiveModal() {
    const list = document.getElementById('archiveList');
    if (!list) return;
    list.innerHTML = '';
    const archived = state.archivedHabits || [];
    if (!archived.length) { list.innerHTML = '<p style="color:var(--sub-text);text-align:center;padding:20px">No archived habits yet.</p>'; return; }
    archived.forEach(h => {
        const row = document.createElement('div');
        row.className = 'archive-row';
        row.style.borderLeft = `4px solid ${h.color || '#7c3aed'}`;
        row.innerHTML = `<span class="archive-name">${h.name}</span><button class="btn" style="font-size:12px;padding:6px 14px" data-id="${h.id}">↩️ Restore</button>`;
        row.querySelector('button').onclick = () => restoreHabit(h.id);
        list.appendChild(row);
    });
}
if (archiveBtn) archiveBtn.onclick = () => { renderArchiveModal(); archiveModal.style.display = 'flex'; setTimeout(() => archiveModal.classList.add('visible'), 10); };
document.getElementById('closeArchiveBtn')?.addEventListener('click', () => closeModal('archiveModal'));

// ─── Share Card ───────────────────────────────────────────────────────────────
function renderShareCard() {
    const canvas = document.getElementById('shareCanvas');
    if (!canvas) return;
    canvas.width = 600; canvas.height = 340;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0,0,600,340);
    grad.addColorStop(0,'#0b0c10'); grad.addColorStop(1,'#1a0a2e');
    ctx.fillStyle = grad; ctx.fillRect(0,0,600,340);
    ctx.beginPath(); ctx.arc(80,80,150,0,Math.PI*2); ctx.fillStyle='rgba(79,70,229,0.12)'; ctx.fill();
    ctx.beginPath(); ctx.arc(520,260,100,0,Math.PI*2); ctx.fillStyle='rgba(236,72,153,0.12)'; ctx.fill();

    const av = getAvatarData();
    ctx.font = '70px serif'; ctx.textAlign = 'center'; ctx.fillText(av.emoji, 300, 100);

    ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText('Track It. Stick To It. Become It.', 300, 145);

    const streak = getStreakCount(state);
    const tg = ctx.createLinearGradient(100,0,500,0);
    tg.addColorStop(0,'#4f46e5'); tg.addColorStop(1,'#ec4899');
    ctx.font = 'bold 62px sans-serif'; ctx.fillStyle = tg;
    ctx.fillText(`🔥 ${streak} Day Streak`, 300, 230);

    ctx.font = '19px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`${av.title} • Level ${state.level} • ${state.xp} XP`, 300, 278);

    ctx.font = '13px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('habit-tracker-sigma-amber.vercel.app', 300, 315);
}
if (shareBtn) {
    shareBtn.onclick = () => {
        renderShareCard();
        shareModal.style.display = 'flex';
        setTimeout(() => shareModal.classList.add('visible'), 10);
    };
}
document.getElementById('downloadShareBtn')?.addEventListener('click', () => {
    const canvas = document.getElementById('shareCanvas');
    canvas.toBlob(blob => { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`habit-streak.png`; a.click(); });
});
document.getElementById('closeShareBtn')?.addEventListener('click', () => closeModal('shareModal'));

// ─── Onboarding ───────────────────────────────────────────────────────────────
function showOnboarding() {
    if (!onboardingOverlay) return;
    onboardingOverlay.style.display = 'flex';
    setTimeout(() => onboardingOverlay.classList.add('visible'), 10);
}
function closeOnboarding() {
    onboardingOverlay.classList.remove('visible');
    setTimeout(() => { onboardingOverlay.style.display = 'none'; }, 300);
    state.onboardingDone = true;
    saveState();
}
document.getElementById('obCloseBtn')?.addEventListener('click', closeOnboarding);
document.getElementById('obTemplateBtn')?.addEventListener('click', () => { closeOnboarding(); setTimeout(() => showTemplateModal(), 300); });

// ─── Note Modal ───────────────────────────────────────────────────────────────
function openNoteModal(habit, dateKey) {
    selectedNoteTarget = { habit, dateKey };
    const d = new Date(dateKey);
    document.getElementById('noteModalLabel').textContent = `${habit.name} — ${d.toDateString()}`;
    document.getElementById('noteInput').value = habit.notes?.[dateKey] || '';
    noteModal.style.display = 'flex';
    setTimeout(() => noteModal.classList.add('visible'), 10);
    document.getElementById('noteInput').focus();
}
function closeNoteModal() { noteModal.classList.remove('visible'); setTimeout(() => { noteModal.style.display='none'; selectedNoteTarget=null; }, 300); }
document.getElementById('saveNoteBtn')?.addEventListener('click', () => {
    if (!selectedNoteTarget) return;
    const { habit, dateKey } = selectedNoteTarget;
    if (!habit.notes) habit.notes = {};
    const val = document.getElementById('noteInput').value.trim();
    if (val) habit.notes[dateKey] = val; else delete habit.notes[dateKey];
    closeNoteModal(); saveState();
});
document.getElementById('cancelNoteBtn')?.addEventListener('click', closeNoteModal);
noteModal?.addEventListener('click', e => { if (e.target === noteModal) closeNoteModal(); });

// ─── Audio ─────────────────────────────────────────────────────────────────────
function playCheckSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime+0.1);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.25);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.25);
    } catch {}
}

// ─── Notifications ────────────────────────────────────────────────────────────
function scheduleReminder() {
    const target = new Date(); target.setHours(20,0,0,0);
    if (new Date() > target) target.setDate(target.getDate()+1);
    setTimeout(() => {
        const allDone = state.habits.length>0 && state.habits.every(h=>h.completed[todayKey]);
        if (!allDone && Notification.permission==='granted') new Notification("🔥 Habit Reminder", { body:"Don't forget your habits! Keep that streak alive! 💪" });
    }, target - new Date());
}
if (notifBtn) {
    notifBtn.onclick = () => {
        if ('Notification' in window) {
            Notification.requestPermission().then(p => {
                if (p==='granted') { notifBtn.textContent='🔔 On'; notifBtn.style.color='#10b981'; showToast('🔔 Reminders enabled!'); }
                else showToast('Please allow notifications in browser settings.');
            });
        }
    };
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
if (downloadCsvBtn) downloadCsvBtn.onclick = () => {
    let csv = 'Habit,' + dates.map(d=>d.toLocaleDateString()).join(',') + '\n';
    state.habits.forEach(h => { csv += `"${h.name}",` + dates.map(d=>h.completed[dateToKey(d)]?'✓':'').join(',') + '\n'; });
    const blob = new Blob([csv], { type:'text/csv' });
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`habits-${todayKey}.csv`; a.click();
};

// ─── CSV Import ───────────────────────────────────────────────────────────────
if (importCsvBtn) importCsvBtn.onclick = () => csvFileInput.click();
if (csvFileInput) {
    csvFileInput.onchange = e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            const lines = ev.target.result.split('\n').filter(l=>l.trim());
            const colors = ['#7c3aed','#0ea5e9','#10b981','#f59e0b','#ec4899','#ef4444'];
            let added = 0;
            lines.forEach((line, i) => {
                if (i===0 && line.toLowerCase().includes('habit')) return; // skip header
                const name = line.split(',')[0].replace(/"/g,'').trim();
                if (name && name.length > 0) {
                    pushUndo();
                    state.habits.push({ id:Date.now().toString()+Math.random(), name, completed:{}, notes:{}, color:colors[added%colors.length], frequency:'daily' });
                    added++;
                }
            });
            if (added > 0) { showToast(`📂 Imported ${added} habit${added>1?'s':''}!`); saveState(); }
            else showToast('No habits found in CSV file.');
            csvFileInput.value = '';
        };
        reader.readAsText(file);
    };
}

// ─── Print ────────────────────────────────────────────────────────────────────
if (printReportBtn) printReportBtn.onclick = () => window.print();

// ─── Add / Reset ─────────────────────────────────────────────────────────────
if (addHabitBtn) addHabitBtn.onclick = () => {
    if (!state.habits) state.habits = [];
    pushUndo();
    const colors = ['#7c3aed','#0ea5e9','#10b981','#f59e0b','#ec4899'];
    state.habits.push({ id:Date.now().toString(), name:'New Habit ✏️', completed:{}, notes:{}, color:colors[state.habits.length%colors.length], frequency:'daily' });
    saveState();
};
if (resetBtn) resetBtn.onclick = () => {
    if (confirm('Reset ALL progress? This cannot be undone.')) {
        pushUndo();
        state.habits.forEach(h => { h.completed={}; h.notes={}; });
        state.xp=0; state.level=1; state.badges=[]; state.frozenDates=[]; state.weeklyChallenge=null;
        saveState();
    }
};

// ─── Shared close utility ─────────────────────────────────────────────────────
function closeModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('visible');
    setTimeout(() => m.style.display='none', 300);
}
[templateModal, archiveModal, shareModal].forEach(m => {
    m?.addEventListener('click', e => { if (e.target === m) { m.classList.remove('visible'); setTimeout(() => m.style.display='none', 300); } });
});

// ─── Theme Toggle ─────────────────────────────────────────────────────────────
const themeToggleBtn = document.getElementById('themeToggleBtn');
let isLightMode = localStorage.getItem('theme') === 'light';
function applyTheme() {
    if (isLightMode) { document.documentElement.setAttribute('data-theme','light'); if(themeToggleBtn) themeToggleBtn.textContent='🌙 Dark Mode'; if(typeof Chart!=='undefined') Chart.defaults.color='#0f172a'; }
    else { document.documentElement.removeAttribute('data-theme'); if(themeToggleBtn) themeToggleBtn.textContent='☀️ Light Mode'; if(typeof Chart!=='undefined') Chart.defaults.color='#fff'; }
    updateCharts();
}
applyTheme();
if (themeToggleBtn) themeToggleBtn.onclick = () => { isLightMode=!isLightMode; localStorage.setItem('theme',isLightMode?'light':'dark'); applyTheme(); };
