import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

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

let state = { habits: [], xp: 0, level: 1 };
let currentUser = null;

let currentDate = new Date();
currentDate.setHours(0,0,0,0);

function dateToKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const todayKey = dateToKey(currentDate);

let pieChartInstance = null;
let barChartInstance = null;
let selectedCell = null;

const dates = [];
for(let i=13; i>=0; i--) {
    let d = new Date(currentDate);
    d.setDate(d.getDate() - i);
    dates.push(d);
}
const daysOfWeek = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const appContainer = document.getElementById('appContainer');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const logoutBtn = document.getElementById('logoutBtn');
const addHabitBtn = document.getElementById('addHabitBtn');
const resetBtn = document.getElementById('resetBtn');

// Setup Auth Listeners
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        loginScreen.style.display = 'none';
        appContainer.style.display = 'block';
        
        // Optimistic fast-render so you don't stare at a blank screen
        state = getDefaultState();
        renderSpreadsheet(); 
        
        await loadState(); // Takes time to fetch from cloud
        updateStats();
        updateCharts();
        renderSpreadsheet();
    } else {
        currentUser = null;
        loginScreen.style.display = 'flex';
        appContainer.style.display = 'none';
    }
});

googleSignInBtn.onclick = () => {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider).catch(err => alert("Sign in failed: " + err.message));
};

logoutBtn.onclick = () => {
    signOut(auth);
};


function getDefaultState() {
    return {
        habits: [
            { id: '1', name: 'Wake up at 5:00 ⏰', completed: {} },
            { id: '2', name: 'Gym 💪', completed: {} },
            { id: '3', name: 'Reading / Learning 📖', completed: {} },
            { id: '4', name: 'Day Planning 📅', completed: {} }
        ],
        xp: 0,
        level: 1
    };
}

async function loadState() {
    if (!currentUser) return;
    try {
        const docRef = doc(db, "users", currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            state = docSnap.data();
            if (!state.habits) state.habits = [];
        } else {
            state = getDefaultState();
            await saveState();
        }
    } catch (err) {
        console.error("Error loading state", err);
    }
}

async function saveState() {
    if (!currentUser) return;
    
    try {
        updateStats();
        updateCharts();
        renderSpreadsheet();
    } catch(e) {
        console.error("UI Render error", e);
    }
    
    try {
        const docRef = doc(db, "users", currentUser.uid);
        await setDoc(docRef, state);
    } catch (err) {
        console.error("Error saving state to database", err);
        alert("Failed to save to cloud. Ensure your Firestore Database is created and in Test Mode.");
    }
}

function renderSpreadsheet() {
    try {
        const container = document.getElementById('spreadsheet');
        if (!container) return;
        
        // Safety net to guarantee habits never crash the loop
        if (!state || !state.habits || !Array.isArray(state.habits)) {
            state = getDefaultState();
        }

        container.style.gridTemplateColumns = `40px 220px repeat(${dates.length}, 45px)`;
        container.innerHTML = '';

        let rowNumOffst = 4;
        
        // --- ROW 1: Days Header ---
        createCell(container, '', 'cell row-header');
        createCell(container, 'My Habits', 'cell header-title', 'color: #111;'); 
        dates.forEach(d => {
            createCell(container, daysOfWeek[d.getDay()], 'cell col-header-day');
        });

        // --- ROW 2: Dates Header ---
        createCell(container, '', 'cell row-header'); 
        createCell(container, '', 'cell habit-name', 'background-color: var(--habit-col-bg);'); 
        dates.forEach(d => {
            createCell(container, d.getDate(), 'cell col-header-date');
        });

    // --- HABIT ROWS ---
    state.habits.forEach((habit, hIdx) => {
        createCell(container, hIdx + 1, 'cell row-header'); // proper 1-based numbering
        
        const nameCell = document.createElement('div');
        nameCell.className = 'cell habit-name';
        nameCell.dataset.habitId = habit.id;
        
        const textSpan = document.createElement('span');
        textSpan.textContent = habit.name;
        
        const delBtn = document.createElement('span');
        delBtn.innerHTML = '&#10060;'; // cross icon
        delBtn.style.cursor = 'pointer';
        delBtn.style.marginLeft = '12px';
        delBtn.style.opacity = '0.6';
        delBtn.style.fontSize = '10px';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteHabit(habit.id);
        };
        
        nameCell.appendChild(textSpan);
        nameCell.appendChild(delBtn);
        nameCell.onclick = () => selectCell(nameCell);
        container.appendChild(nameCell);
        
        dates.forEach((d) => {
            const k = dateToKey(d);
            const isChecked = habit.completed[k] === true;
            
            const isPast = k < todayKey;
            
            const checkCell = document.createElement('div');
            checkCell.className = `cell checkbox-cell`;
            
            if(isPast) {
               checkCell.classList.add('disabled-cell');
            }
            
            const box = document.createElement('div');
            box.className = `square-box ${isChecked ? 'checked' : ''}`;
            checkCell.appendChild(box);
            
            checkCell.onclick = () => {
                if (k < todayKey) {
                    return; // Prevent action on past dates
                }
                toggleHabit(habit, k);
            };
            container.appendChild(checkCell);
        });
    });

    // --- PROGRESS ROW (Bottom) ---
    const progressRow = state.habits.length + 1;
    createCell(container, progressRow, 'cell row-header');
    createCell(container, 'Daily Progress', 'cell progress-cell', 'text-align: right; justify-content: flex-end; padding-right: 12px;');
    
    dates.forEach(d => {
        const k = dateToKey(d);
        let comps = 0;
        state.habits.forEach(h => { if(h.completed[k]) comps++; });
        const pct = state.habits.length ? Math.round((comps / state.habits.length)*100) : 0;
        createCell(container, `${pct}%`, 'cell progress-cell');
    });

        if(selectedCell && selectedCell.dataset.habitId) {
                const nodes = container.querySelectorAll('.habit-name');
                nodes.forEach(n => {
                    if(n.dataset.habitId === selectedCell.dataset.habitId) n.classList.add('selected');
                });
        }
    } catch(err) {
        console.error("Rendering Spreadsheet Error:", err);
    }
}

function createCell(parent, text, className, inlineStyle='') {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    if(inlineStyle) div.setAttribute('style', inlineStyle);
    parent.appendChild(div);
    return div;
}

function selectCell(cellDiv) {
    document.querySelectorAll('.cell').forEach(c => c.classList.remove('selected'));
    cellDiv.classList.add('selected');
    selectedCell = cellDiv;
    
    if(cellDiv.classList.contains('habit-name') && cellDiv.dataset.habitId) {
        const habit = state.habits.find(h => h.id === cellDiv.dataset.habitId);
        if(!habit) return;
        
        const input = document.createElement('input');
        input.className = 'habit-input';
        input.value = habit.name;
        
        cellDiv.textContent = '';
        cellDiv.appendChild(input);
        input.focus();
        
        input.onblur = () => {
            const newVal = input.value.trim();
            if(newVal === '') {
                renderSpreadsheet(); // restore old name cleanly
            } else {
                habit.name = newVal;
                saveState();
            }
        };
        input.onkeydown = (e) => {
            if(e.key === 'Enter') input.blur();
        };
    }
}

function toggleHabit(habit, dateKey) {
    if(habit.completed[dateKey]) {
        delete habit.completed[dateKey];
        state.xp = Math.max(0, state.xp - 10);
    } else {
        habit.completed[dateKey] = true;
        state.xp += 10;
    }
    
    const requiredXp = state.level * 100;
    if(state.xp >= requiredXp) {
        state.level++;
        state.xp = 0;
    }
    
    saveState();
}

function deleteHabit(id) {
    if(confirm('Are you sure you want to delete this habit?')) {
        state.habits = state.habits.filter(h => h.id !== id);
        selectedCell = null;
        saveState();
    }
}

function updateStats() {
    try {
        let streak = 0;
        let tempDate = new Date(currentDate);
        while(true) {
                let k = dateToKey(tempDate);
                const todayComps = state.habits.filter(h => h.completed[k]).length;
                if(todayComps > 0) {
                    streak++;
                    tempDate.setDate(tempDate.getDate() - 1);
                } else {
                    break;
                }
        }

        const streakEl = document.getElementById('streakCount');
        const levelEl = document.getElementById('levelDisplay');
        const xpEl = document.getElementById('xpScore');
        
        if(streakEl) streakEl.textContent = streak;
        if(levelEl) levelEl.textContent = `Lv. ${state.level}`;
        if(xpEl) xpEl.textContent = state.xp;
    } catch(e) {
        console.error("Stats Error:", e);
    }
}

function updateCharts() {
    try {
        if(!document.getElementById('pieChart') || typeof Chart === 'undefined') return;
        Chart.defaults.color = '#fff';
        Chart.defaults.font.family = "'Inter', sans-serif";

        let totalTasks = state.habits.length * dates.length;
        let completedTasks = 0;
        
        const habitData = state.habits.map(h => {
                let comps = 0;
                dates.forEach(d => {
                    if(h.completed[dateToKey(d)]) comps++;
                });
                completedTasks += comps;
                return { name: h.name.split(' ')[0], comps };
        });

        const ctxPie = document.getElementById('pieChart').getContext('2d');
        if(pieChartInstance) pieChartInstance.destroy();
        pieChartInstance = new Chart(ctxPie, {
            type: 'doughnut',
            data: {
                labels: ['Done', 'Missed'],
                datasets: [{
                    data: [completedTasks, Math.max(0, totalTasks - completedTasks)],
                    backgroundColor: ['#1a73e8', '#333'],
                    borderWidth: 0
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });

        const ctxBar = document.getElementById('barChart').getContext('2d');
        if(barChartInstance) barChartInstance.destroy();
        barChartInstance = new Chart(ctxBar, {
            type: 'bar',
            data: {
                labels: habitData.map(h => h.name),
                datasets: [{
                    label: 'Completions',
                    data: habitData.map(h => h.comps),
                    backgroundColor: '#1a73e8',
                    borderRadius: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    } catch(e) {
        console.error("Chart Error:", e);
    }
}

if(addHabitBtn) {
    addHabitBtn.addEventListener('click', () => {
        if (!state.habits) state.habits = [];
        state.habits.push({ id: Date.now().toString(), name: 'New Habit ✏️', completed: {} });
        saveState();
    });
}

if(resetBtn) {
    resetBtn.addEventListener('click', () => {
        if(confirm('Reset all progress?')) {
            state.habits.forEach(h => h.completed = {});
            state.xp = 0;
            state.level = 1;
            saveState();
        }
    });
}
