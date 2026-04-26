import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

// ─── Cloud Error Banner ───────────────────────────────────────────────────────
window.showCloudError = function () {
    if (document.getElementById('cloudErrorBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'cloudErrorBanner';
    banner.innerHTML = `<b>☁️ CLOUD DATABASE ERR ☁️</b><br>Firebase Firestore is missing or locked. Data saves ONLY locally. Fix your Firebase Rules!`;
    banner.style.cssText = 'background:#ef4444;color:white;padding:12px;text-align:center;font-size:14px;position:fixed;top:0;left:0;width:100%;z-index:9999;box-shadow:0 4px 10px rgba(0,0,0,0.5);';
    document.body.prepend(banner);
};

// ─── Firebase Config ──────────────────────────────────────────────────────────
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
let state = { habits: [], xp: 0, level: 1, badges: [] };
let currentUser = null;
let lastSaveTime = 0;
let selectedNoteTarget = null; // { habit, dateKey }

let currentDate = new Date();
currentDate.setHours(0, 0, 0, 0);

function dateToKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayKey = dateToKey(currentDate);

let pieChartInstance = null;
let barChartInstance = null;
let selectedCell = null;

// ─── Dates Array (Responsive) ─────────────────────────────────────────────────
let dates = [];
function updateDatesArray() {
    dates = [];
    const w = window.innerWidth;
    const historyDays = w <= 480 ? 3 : w <= 768 ? 6 : w <= 1400 ? 13 : 20;
    for (let i = historyDays; i >= 0; i--) {
        const d = new Date(currentDate);
        d.setDate(d.getDate() - i);
        dates.push(d);
    }
}
updateDatesArray();
const daysOfWeek = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

window.addEventListener('resize', () => {
    const old = dates.length;
    updateDatesArray();
    if (dates.length !== old) { renderSpreadsheet(); updateCharts(); }
});

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const loginScreen = document.getElementById('loginScreen');
const appContainer = document.getElementById('appContainer');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const logoutBtn = document.getElementById('logoutBtn');
const addHabitBtn = document.getElementById('addHabitBtn');
const resetBtn = document.getElementById('resetBtn');
const notifBtn = document.getElementById('notifBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const printReportBtn = document.getElementById('printReportBtn');
const noteModal = document.getElementById('noteModal');
const noteInput = document.getElementById('noteInput');
const saveNoteBtn = document.getElementById('saveNoteBtn');
const cancelNoteBtn = document.getElementById('cancelNoteBtn');
const noteModalLabel = document.getElementById('noteModalLabel');

// ─── Auth ─────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        loginScreen.style.display = 'none';
        appContainer.style.display = 'block';

        const backup = localStorage.getItem(`habitBackup_${currentUser.uid}`);
        if (backup) {
            try { state = JSON.parse(backup); } catch (e) { state = getDefaultState(); }
            renderAll();
        } else {
            state = getDefaultState();
            document.getElementById('spreadsheet').innerHTML =
                '<div style="text-align:center;padding:60px 20px;color:#94a3b8;"><p style="font-size:16px;font-weight:600;">☁️ Synchronizing with Cloud...</p></div>';
        }

        loadState().then(() => renderAll());
        scheduleReminder();
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
}

// ─── Default State ────────────────────────────────────────────────────────────
function getDefaultState() {
    return {
        habits: [
            { id: '1', name: 'Wake up at 5:00 ⏰', completed: {}, notes: {}, color: '#7c3aed', frequency: 'daily' },
            { id: '2', name: 'Gym 💪', completed: {}, notes: {}, color: '#0ea5e9', frequency: 'daily' },
            { id: '3', name: 'Reading / Learning 📖', completed: {}, notes: {}, color: '#10b981', frequency: 'daily' },
            { id: '4', name: 'Day Planning 📅', completed: {}, notes: {}, color: '#f59e0b', frequency: 'daily' }
        ],
        xp: 0, level: 1, badges: []
    };
}

// ─── Load / Save State ────────────────────────────────────────────────────────
async function loadState() {
    if (!currentUser) return;
    const fetchStart = Date.now();
    try {
        const snap = await getDoc(doc(db, "users", currentUser.uid));
        if (lastSaveTime > fetchStart) return;
        if (snap.exists()) {
            state = snap.data();
            if (!state.habits) state.habits = [];
            if (!state.badges) state.badges = [];
            // Migrate old habits that lack new fields
            state.habits.forEach(h => {
                if (!h.notes) h.notes = {};
                if (!h.color) h.color = '#7c3aed';
                if (!h.frequency) h.frequency = 'daily';
            });
            localStorage.setItem(`habitBackup_${currentUser.uid}`, JSON.stringify(state));
        } else {
            const backup = localStorage.getItem(`habitBackup_${currentUser.uid}`);
            state = backup ? JSON.parse(backup) : getDefaultState();
            await saveState();
        }
    } catch (err) {
        console.error("Firestore Load Error:", err);
        showCloudError();
        const backup = localStorage.getItem(`habitBackup_${currentUser.uid}`);
        state = backup ? JSON.parse(backup) : getDefaultState();
    }
}

async function saveState() {
    if (!currentUser) return;
    lastSaveTime = Date.now();
    renderAll();
    try {
        localStorage.setItem(`habitBackup_${currentUser.uid}`, JSON.stringify(state));
        await setDoc(doc(db, "users", currentUser.uid), state);
    } catch (err) {
        console.error("Firestore Save Error:", err);
        showCloudError();
    }
}

// ─── Spreadsheet ──────────────────────────────────────────────────────────────
function renderSpreadsheet() {
    try {
        const container = document.getElementById('spreadsheet');
        if (!container) return;
        if (!state?.habits || !Array.isArray(state.habits)) state = getDefaultState();

        const w = window.innerWidth;
        const nameWidth = w <= 480 ? '120px' : w <= 800 ? '170px' : '220px';
        container.style.gridTemplateColumns = `40px ${nameWidth} repeat(${dates.length}, 45px)`;
        container.innerHTML = '';

        // Header row 1 — day names
        createCell(container, '', 'cell row-header');
        createCell(container, 'My Habits', 'cell header-title sticky-col');
        dates.forEach(d => createCell(container, daysOfWeek[d.getDay()], 'cell col-header-day'));

        // Header row 2 — dates
        createCell(container, '', 'cell row-header');
        createCell(container, '', 'cell habit-name sticky-col', `background-color:var(--habit-col-bg)`);
        dates.forEach(d => createCell(container, d.getDate(), 'cell col-header-date'));

        // Habit rows
        state.habits.forEach((habit, hIdx) => {
            createCell(container, hIdx + 1, 'cell row-header');

            const nameCell = document.createElement('div');
            nameCell.className = 'cell habit-name sticky-col draggable';
            nameCell.dataset.habitId = habit.id;
            nameCell.draggable = true;
            nameCell.style.borderLeft = `4px solid ${habit.color || '#7c3aed'}`;

            // Drag events
            nameCell.ondragstart = e => { e.dataTransfer.setData('text/plain', hIdx); nameCell.classList.add('dragging'); };
            nameCell.ondragover = e => { e.preventDefault(); nameCell.classList.add('drag-over'); };
            nameCell.ondragleave = () => nameCell.classList.remove('drag-over');
            nameCell.ondrop = e => {
                e.preventDefault();
                nameCell.classList.remove('drag-over');
                const from = parseInt(e.dataTransfer.getData('text/plain'));
                if (from !== hIdx) {
                    const [moved] = state.habits.splice(from, 1);
                    state.habits.splice(hIdx, 0, moved);
                    saveState();
                }
            };
            nameCell.ondragend = () => {
                nameCell.classList.remove('dragging');
                document.querySelectorAll('.habit-name').forEach(n => n.classList.remove('drag-over'));
            };

            const textSpan = document.createElement('span');
            textSpan.textContent = habit.name;

            const delBtn = document.createElement('span');
            delBtn.innerHTML = '&#10060;';
            delBtn.style.cssText = 'cursor:pointer;margin-left:8px;opacity:0.6;font-size:10px;';
            delBtn.onclick = e => { e.stopPropagation(); deleteHabit(habit.id); };

            nameCell.appendChild(textSpan);
            nameCell.appendChild(delBtn);
            nameCell.onclick = () => selectCell(nameCell);
            container.appendChild(nameCell);

            // Checkbox cells
            dates.forEach(d => {
                const k = dateToKey(d);
                const isChecked = habit.completed[k] === true;
                const isPast = k < todayKey;
                const hasNote = !!(habit.notes && habit.notes[k]);

                const checkCell = document.createElement('div');
                checkCell.className = `cell checkbox-cell${isPast ? ' disabled-cell' : ''}`;

                const box = document.createElement('div');
                box.className = `square-box${isChecked ? ' checked' : ''}`;
                if (isChecked) box.style.background = `linear-gradient(135deg, ${habit.color || '#4f46e5'}, #ec4899)`;
                checkCell.appendChild(box);

                if (hasNote) {
                    const noteIndicator = document.createElement('span');
                    noteIndicator.className = 'note-dot';
                    noteIndicator.title = habit.notes[k];
                    checkCell.appendChild(noteIndicator);
                }

                checkCell.onclick = () => { if (!isPast) toggleHabit(habit, k); };

                // Long-press / right-click to open note
                checkCell.oncontextmenu = e => { e.preventDefault(); if (isChecked) openNoteModal(habit, k); };
                let pressTimer;
                checkCell.addEventListener('touchstart', () => { pressTimer = setTimeout(() => { if (isChecked) openNoteModal(habit, k); }, 600); });
                checkCell.addEventListener('touchend', () => clearTimeout(pressTimer));

                container.appendChild(checkCell);
            });
        });

        // Progress row
        createCell(container, state.habits.length + 1, 'cell row-header');
        createCell(container, 'Daily Progress', 'cell progress-cell sticky-col');
        dates.forEach(d => {
            const k = dateToKey(d);
            const comps = state.habits.filter(h => h.completed[k]).length;
            const pct = state.habits.length ? Math.round((comps / state.habits.length) * 100) : 0;
            createCell(container, `${pct}%`, 'cell progress-cell');
        });

        // Restore selection
        if (selectedCell?.dataset.habitId) {
            container.querySelectorAll('.habit-name').forEach(n => {
                if (n.dataset.habitId === selectedCell.dataset.habitId) n.classList.add('selected');
            });
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

// ─── Cell Selection / Editing ─────────────────────────────────────────────────
function selectCell(cellDiv) {
    document.querySelectorAll('.cell').forEach(c => c.classList.remove('selected'));
    cellDiv.classList.add('selected');
    selectedCell = cellDiv;

    if (!cellDiv.classList.contains('habit-name') || !cellDiv.dataset.habitId) return;
    const habit = state.habits.find(h => h.id === cellDiv.dataset.habitId);
    if (!habit) return;

    // Build inline edit panel
    cellDiv.innerHTML = '';

    const input = document.createElement('input');
    input.className = 'habit-input';
    input.value = habit.name;

    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.value = habit.color || '#7c3aed';
    colorPicker.className = 'habit-color-picker';
    colorPicker.title = 'Habit color';
    colorPicker.onchange = () => { habit.color = colorPicker.value; saveState(); };

    const freqSelect = document.createElement('select');
    freqSelect.className = 'freq-select';
    [['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekends', 'Weekends'], ['3x', '3×/wk'], ['2x', '2×/wk']]
        .forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val; opt.textContent = label;
            if (habit.frequency === val) opt.selected = true;
            freqSelect.appendChild(opt);
        });
    freqSelect.onchange = () => { habit.frequency = freqSelect.value; saveState(); };
    freqSelect.onclick = e => e.stopPropagation();

    input.onblur = () => {
        const v = input.value.trim();
        if (v) habit.name = v;
        saveState();
    };
    input.onkeydown = e => { if (e.key === 'Enter') input.blur(); };

    cellDiv.appendChild(input);
    cellDiv.appendChild(colorPicker);
    cellDiv.appendChild(freqSelect);
    input.focus();
}

// ─── Toggle Habit ─────────────────────────────────────────────────────────────
function toggleHabit(habit, dateKey) {
    if (dateKey < todayKey) return;

    if (habit.completed[dateKey]) {
        delete habit.completed[dateKey];
        state.xp = Math.max(0, state.xp - 10);
    } else {
        habit.completed[dateKey] = true;
        state.xp += 10;
        playCheckSound();
    }

    // Level up
    const xpNeeded = state.level * 100;
    if (state.xp >= xpNeeded) { state.level++; state.xp = 0; }

    checkMilestones();
    saveState();
}

function deleteHabit(id) {
    if (confirm('Delete this habit?')) {
        state.habits = state.habits.filter(h => h.id !== id);
        selectedCell = null;
        saveState();
    }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
    try {
        let streak = 0;
        const temp = new Date(currentDate);
        while (true) {
            const k = dateToKey(temp);
            if (state.habits.some(h => h.completed[k])) { streak++; temp.setDate(temp.getDate() - 1); }
            else break;
        }
        const streakEl = document.getElementById('streakCount');
        const levelEl = document.getElementById('levelDisplay');
        const xpEl = document.getElementById('xpScore');
        if (streakEl) streakEl.textContent = streak;
        if (levelEl) levelEl.textContent = `Lv. ${state.level}`;
        if (xpEl) xpEl.textContent = state.xp;
    } catch (e) { console.error("Stats Error:", e); }
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
            data: { labels: ['Done', 'Missed'], datasets: [{ data: [done, Math.max(0, total - done)], backgroundColor: ['#7c3aed', 'rgba(255,255,255,0.08)'], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { padding: 20 } } } }
        });

        if (barChartInstance) barChartInstance.destroy();
        barChartInstance = new Chart(document.getElementById('barChart').getContext('2d'), {
            type: 'bar',
            data: { labels: habitData.map(h => h.name), datasets: [{ label: 'Completions', data: habitData.map(h => h.comps), backgroundColor: habitData.map(h => h.color), borderRadius: 6 }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    } catch (e) { console.error("Chart Error:", e); }
}

// ─── Feature 2: GitHub-Style Heatmap ─────────────────────────────────────────
function renderHeatmap() {
    const grid = document.getElementById('heatmapGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const today = new Date(currentDate);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 364);

    // Align to Sunday
    startDate.setDate(startDate.getDate() - startDate.getDay());

    const monthLabels = [];
    let lastMonth = -1;

    for (let week = 0; week < 53; week++) {
        const col = document.createElement('div');
        col.className = 'heatmap-col';

        for (let day = 0; day < 7; day++) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + week * 7 + day);
            if (d > today) { col.appendChild(document.createElement('div')); continue; }

            const k = dateToKey(d);
            const comps = state.habits.filter(h => h.completed[k]).length;
            const total = state.habits.length || 1;
            const pct = comps / total;

            const cell = document.createElement('div');
            cell.className = 'heatmap-cell';
            cell.title = `${d.toDateString()}: ${comps}/${state.habits.length} habits`;

            if (pct === 0) cell.style.background = 'rgba(139,92,246,0.07)';
            else if (pct < 0.25) cell.style.background = 'rgba(139,92,246,0.2)';
            else if (pct < 0.5) cell.style.background = 'rgba(139,92,246,0.4)';
            else if (pct < 0.75) cell.style.background = 'rgba(139,92,246,0.65)';
            else if (pct < 1) cell.style.background = 'rgba(236,72,153,0.8)';
            else cell.style.background = 'linear-gradient(135deg, #4f46e5, #ec4899)';

            col.appendChild(cell);

            // Month label tracking
            if (d.getMonth() !== lastMonth && day === 0) {
                lastMonth = d.getMonth();
                monthLabels.push({ week, label: d.toLocaleString('default', { month: 'short' }) });
            }
        }
        grid.appendChild(col);
    }

    // Month labels row above
    const monthRow = document.createElement('div');
    monthRow.className = 'heatmap-months';
    monthRow.style.gridColumn = `1 / ${53 + 1}`;
    // We'll build these below the grid via CSS
}

// ─── Feature 1: Milestones & Badges ──────────────────────────────────────────
const MILESTONES = [
    { id: 'first_check', label: 'First Step', emoji: '👶', desc: 'Check your first habit', check: (s) => Object.values(s.habits).some(h => Object.keys(h.completed).length > 0) },
    { id: 'streak_7', label: '7-Day Warrior', emoji: '🔥', desc: 'Maintain a 7-day streak', check: (s) => getStreakCount(s) >= 7 },
    { id: 'streak_30', label: 'Unstoppable', emoji: '💎', desc: '30-day streak', check: (s) => getStreakCount(s) >= 30 },
    { id: 'xp_100', label: 'XP Rising', emoji: '⭐', desc: 'Earn 100 total XP', check: (s) => (s.xp + (s.level - 1) * 100) >= 100 },
    { id: 'xp_500', label: 'XP Legend', emoji: '🌟', desc: 'Earn 500 total XP', check: (s) => (s.xp + (s.level - 1) * 100) >= 500 },
    { id: 'level_5', label: 'Level 5 Pro', emoji: '🏆', desc: 'Reach Level 5', check: (s) => s.level >= 5 },
    { id: 'all_habits', label: 'Perfect Day', emoji: '✅', desc: 'Complete ALL habits in a day', check: (s) => { const k = dateToKey(new Date()); return s.habits.length > 0 && s.habits.every(h => h.completed[k]); } },
    { id: 'habit_5', label: 'Overachiever', emoji: '🚀', desc: 'Have 5+ habits tracked', check: (s) => s.habits.length >= 5 },
];

function getStreakCount(s) {
    let streak = 0;
    const temp = new Date(currentDate);
    while (true) {
        const k = dateToKey(temp);
        if (s.habits.some(h => h.completed[k])) { streak++; temp.setDate(temp.getDate() - 1); }
        else break;
    }
    return streak;
}

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
    shelf.innerHTML = '';
    if (!state.badges) state.badges = [];

    MILESTONES.forEach(m => {
        const earned = state.badges.includes(m.id);
        const card = document.createElement('div');
        card.className = `badge-card${earned ? ' earned' : ' locked'}`;
        card.title = m.desc;
        card.innerHTML = `<span class="badge-emoji">${earned ? m.emoji : '🔒'}</span><span class="badge-label">${m.label}</span>`;
        shelf.appendChild(card);
    });
}

function showMilestoneToast(milestone) {
    const toast = document.getElementById('milestoneToast');
    toast.innerHTML = `${milestone.emoji} <b>Achievement Unlocked!</b> — ${milestone.label}`;
    toast.style.display = 'flex';
    setTimeout(() => { toast.classList.add('visible'); }, 50);
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => { toast.style.display = 'none'; }, 500); }, 3500);
}

// ─── Feature 1: Confetti ──────────────────────────────────────────────────────
function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = Array.from({ length: 120 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * -canvas.height,
        r: Math.random() * 8 + 3,
        color: ['#4f46e5', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9'][Math.floor(Math.random() * 5)],
        speed: Math.random() * 4 + 2,
        tilt: Math.random() * 10 - 5,
        tiltAngle: 0
    }));

    let frame = 0;
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.tiltAngle += 0.1;
            p.y += p.speed;
            p.x += Math.sin(p.tiltAngle) * 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, 1 - frame / 120);
            ctx.fill();
        });
        ctx.globalAlpha = 1;
        frame++;
        if (frame < 140) requestAnimationFrame(draw);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    draw();
}

// ─── Feature 3: Micro Notes ───────────────────────────────────────────────────
function openNoteModal(habit, dateKey) {
    selectedNoteTarget = { habit, dateKey };
    const d = new Date(dateKey);
    noteModalLabel.textContent = `${habit.name} — ${d.toDateString()}`;
    noteInput.value = habit.notes?.[dateKey] || '';
    noteModal.style.display = 'flex';
    setTimeout(() => noteModal.classList.add('visible'), 10);
    noteInput.focus();
}

function closeNoteModal() {
    noteModal.classList.remove('visible');
    setTimeout(() => { noteModal.style.display = 'none'; selectedNoteTarget = null; }, 300);
}

saveNoteBtn.onclick = () => {
    if (!selectedNoteTarget) return;
    const { habit, dateKey } = selectedNoteTarget;
    if (!habit.notes) habit.notes = {};
    const val = noteInput.value.trim();
    if (val) habit.notes[dateKey] = val;
    else delete habit.notes[dateKey];
    closeNoteModal();
    saveState();
};
cancelNoteBtn.onclick = closeNoteModal;
noteModal.onclick = e => { if (e.target === noteModal) closeNoteModal(); };

// ─── Feature 4: Audio Feedback ────────────────────────────────────────────────
function playCheckSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) { /* audio not supported */ }
}

// ─── Feature 4: Browser Notifications / Reminders ─────────────────────────────
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function scheduleReminder() {
    const now = new Date();
    const target = new Date();
    target.setHours(20, 0, 0, 0); // 8:00 PM
    if (now > target) target.setDate(target.getDate() + 1);
    const delay = target - now;
    setTimeout(() => {
        const allDone = state.habits.length > 0 && state.habits.every(h => h.completed[todayKey]);
        if (!allDone && Notification.permission === 'granted') {
            new Notification("🔥 Habit Reminder", {
                body: "Don't forget to log today's habits! Keep your streak alive!",
                icon: '/favicon.ico'
            });
        }
    }, delay);
}

if (notifBtn) {
    notifBtn.onclick = () => {
        requestNotificationPermission();
        if (Notification.permission === 'granted') {
            notifBtn.textContent = '🔔 Reminders On';
            notifBtn.style.borderColor = '#10b981';
            notifBtn.style.color = '#10b981';
        } else {
            alert("Please allow notifications in your browser settings!");
        }
    };
}

// ─── Feature 7: CSV Export ────────────────────────────────────────────────────
if (downloadCsvBtn) {
    downloadCsvBtn.onclick = () => {
        let csv = 'Habit Name,' + dates.map(d => d.toLocaleDateString()).join(',') + '\n';
        state.habits.forEach(h => {
            csv += `"${h.name}",` + dates.map(d => h.completed[dateToKey(d)] ? '✓' : '').join(',') + '\n';
        });
        csv += '"Daily Progress",' + dates.map(d => {
            const k = dateToKey(d);
            const comps = state.habits.filter(h => h.completed[k]).length;
            return state.habits.length ? `${Math.round(comps / state.habits.length * 100)}%` : '0%';
        }).join(',') + '\n';

        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `habit-tracker-${todayKey}.csv`;
        a.click();
    };
}

// ─── Feature 7: Print / PDF Report ───────────────────────────────────────────
if (printReportBtn) {
    printReportBtn.onclick = () => window.print();
}

// ─── Add / Reset Habits ───────────────────────────────────────────────────────
if (addHabitBtn) {
    addHabitBtn.onclick = () => {
        if (!state.habits) state.habits = [];
        state.habits.push({
            id: Date.now().toString(),
            name: 'New Habit ✏️',
            completed: {},
            notes: {},
            color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
            frequency: 'daily'
        });
        saveState();
    };
}

if (resetBtn) {
    resetBtn.onclick = () => {
        if (confirm('Reset ALL progress? This cannot be undone.')) {
            state.habits.forEach(h => { h.completed = {}; h.notes = {}; });
            state.xp = 0; state.level = 1; state.badges = [];
            saveState();
        }
    };
}

// ─── Theme Toggle ─────────────────────────────────────────────────────────────
const themeToggleBtn = document.getElementById('themeToggleBtn');
let isLightMode = localStorage.getItem('theme') === 'light';

function applyTheme() {
    if (isLightMode) {
        document.documentElement.setAttribute('data-theme', 'light');
        if (themeToggleBtn) themeToggleBtn.textContent = '🌙 Dark Mode';
        if (typeof Chart !== 'undefined') Chart.defaults.color = '#0f172a';
    } else {
        document.documentElement.removeAttribute('data-theme');
        if (themeToggleBtn) themeToggleBtn.textContent = '☀️ Light Mode';
        if (typeof Chart !== 'undefined') Chart.defaults.color = '#fff';
    }
    updateCharts();
}
applyTheme();

if (themeToggleBtn) {
    themeToggleBtn.onclick = () => {
        isLightMode = !isLightMode;
        localStorage.setItem('theme', isLightMode ? 'light' : 'dark');
        applyTheme();
    };
}
