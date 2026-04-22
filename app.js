document.addEventListener("DOMContentLoaded", () => {
    let state = loadState();
    let currentDate = new Date();
    currentDate.setHours(0,0,0,0);
    
    let pieChartInstance = null;
    let barChartInstance = null;
    let selectedCell = null;

    // Load or init state
    function loadState() {
        const saved = localStorage.getItem('habitSpreadsheetState');
        if (saved) return JSON.parse(saved);
        return {
            habits: [
                { id: '1', name: 'Wake up at 5:00 ⏰', completed: {} },
                { id: '2', name: 'Gym 💪', completed: {} },
                { id: '3', name: 'Reading / Learning 📖', completed: {} },
                { id: '4', name: 'Day Planning 📅', completed: {} },
                { id: '5', name: 'Budget Tracking 💰', completed: {} },
                { id: '6', name: 'Project Work 🎯', completed: {} },
                { id: '7', name: 'No Alcohol 🍾', completed: {} },
                { id: '8', name: 'Social Media Detox 🌿', completed: {} }
            ],
            xp: 0,
            level: 1
        };
    }

    function saveState() {
        localStorage.setItem('habitSpreadsheetState', JSON.stringify(state));
        updateStats();
        updateCharts();
        renderSpreadsheet();
    }

    function dateToKey(d) {
         return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    // Generate last 14 days and current day to match image structure well
    const dates = [];
    for(let i=13; i>=0; i--) {
        let d = new Date(currentDate);
        d.setDate(d.getDate() - i);
        dates.push(d);
    }
    const daysOfWeek = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    function renderSpreadsheet() {
        const container = document.getElementById('spreadsheet');
        // Define columns: rowNum | Title | Dates...
        container.style.gridTemplateColumns = `40px 220px repeat(${dates.length}, 45px)`;
        container.innerHTML = '';

        let rowNumOffst = 4; // So first habit row is 6 like the image

        // --- ROW 1: Days Header ---
        createCell(container, '', 'cell row-header'); // empty top left
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
            const currentSpreadsheetRow = rowNumOffst + hIdx + 2; 

            // Row block
            createCell(container, currentSpreadsheetRow, 'cell row-header');
            
            // Name block
            const nameCell = createCell(container, habit.name, 'cell habit-name');
            nameCell.dataset.habitId = habit.id;
            nameCell.onclick = (e) => selectCell(nameCell);
            
            // Checkboxes
            dates.forEach((d) => {
                const k = dateToKey(d);
                const isChecked = habit.completed[k] === true;
                
                const checkCell = document.createElement('div');
                checkCell.className = `cell checkbox-cell`;
                
                const box = document.createElement('div');
                box.className = `square-box ${isChecked ? 'checked' : ''}`;
                checkCell.appendChild(box);
                
                checkCell.onclick = () => toggleHabit(habit, k);
                container.appendChild(checkCell);
            });
        });

        // --- PROGRESS ROW (Bottom) ---
        const progressRow = rowNumOffst + state.habits.length + 2;
        createCell(container, progressRow, 'cell row-header');
        createCell(container, 'Daily Progress', 'cell progress-cell', 'text-align: right; justify-content: flex-end; padding-right: 12px;');
        
        dates.forEach(d => {
            const k = dateToKey(d);
            let comps = 0;
            state.habits.forEach(h => { if(h.completed[k]) comps++; });
            const pct = state.habits.length ? Math.round((comps / state.habits.length)*100) : 0;
            createCell(container, `${pct}%`, 'cell progress-cell');
        });

        // Re-apply selection if exists
        if(selectedCell && selectedCell.dataset.habitId) {
             const nodes = container.querySelectorAll('.habit-name');
             nodes.forEach(n => {
                 if(n.dataset.habitId === selectedCell.dataset.habitId) n.classList.add('selected');
             });
        }
    }

    function createCell(parent, text, className, inlineStyle='') {
        const div = document.createElement('div');
        div.className = className;
        div.textContent = text;
        if(inlineStyle) div.style = inlineStyle;
        parent.appendChild(div);
        return div;
    }

    function selectCell(cellDiv) {
        document.querySelectorAll('.cell').forEach(c => c.classList.remove('selected'));
        cellDiv.classList.add('selected');
        selectedCell = cellDiv;
        
        // Editable capability
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
                    deleteHabit(habit.id);
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
        if(confirm('Habit name is empty. Delete habit?')) {
            state.habits = state.habits.filter(h => h.id !== id);
            selectedCell = null;
            saveState();
        } else {
            saveState();
        }
    }

    function updateStats() {
        let streak = 0;
        let tempDate = new Date(currentDate);
        while(true) {
             let k = dateToKey(tempDate);
             const todayComps = state.habits.filter(h => h.completed[k]).length;
             if(todayComps > 0) {
                 streak++;
                 tempDate.setDate(tempDate.getDate() - 1);
             } else {
                 break; // Overall streak logic: breaking condition
             }
        }

        const streakEl = document.getElementById('streakCount');
        const levelEl = document.getElementById('levelDisplay');
        const xpEl = document.getElementById('xpScore');
        
        if(streakEl) streakEl.textContent = streak;
        if(levelEl) levelEl.textContent = `Lv. ${state.level}`;
        if(xpEl) xpEl.textContent = state.xp;
    }

    function updateCharts() {
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
                    data: [completedTasks, totalTasks - completedTasks],
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
    }

    // Buttons
    const addBtn = document.getElementById('addHabitBtn');
    if(addBtn) {
        addBtn.onclick = () => {
            state.habits.push({ id: Date.now().toString(), name: 'New Habit ✏️', completed: {} });
            saveState();
        };
    }

    const resetBtn = document.getElementById('resetBtn');
    if(resetBtn) {
        resetBtn.onclick = () => {
            if(confirm('Reset all progress?')) {
                state.habits.forEach(h => h.completed = {});
                state.xp = 0;
                state.level = 1;
                saveState();
            }
        };
    }

    // Initialize
    updateStats();
    updateCharts();
    renderSpreadsheet();
});
