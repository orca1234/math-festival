// ==========================================
// 1. Firebase / 설정
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyDeMuBq6JxfjGTuardW5QWjDTXsQbFtyFo",
  authDomain: "maeroomarble.firebaseapp.com",
  projectId: "maeroomarble",
  storageBucket: "maeroomarble.firebasestorage.app",
  messagingSenderId: "671932419152",
  appId: "1:671932419152:web:e85ada32ef8bed2355d555",
  measurementId: "G-GHW4PY7NP7"
};

const isMockMode = false; // Firebase 연동 모드 활성화
let db, auth;

if (!isMockMode) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
}

// ==========================================
// 2. 초기화 및 전역 변수
// ==========================================
const isAdminPage = !!window.IS_ADMIN_PAGE;
let currentUser = null;

let gameState = {
    status: 'waiting',
    players: [],
    turnIndex: 0,
    islandMode: false,
    currentProblem: null,
    winner: null,
    minPlayers: 2,
    gridSize: 7,
    boardRotation: 0,
    direction: 'clockwise',
    tileProblems: {},
    personalProblemPlayerId: null // 개인 문제 풀이중인 플레이어 ID
};

function getTotalTiles(size) {
    return (size * 4) - 4;
}

const colors = ['#EF4444', '#3B82F6', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899'];

// UI Elements
const views = {
    auth: document.getElementById('auth-view'),
    admin: document.getElementById('admin-view'),
    lobby: document.getElementById('lobby-view'),
    game: document.getElementById('game-view')
};

// ==========================================
// 3. UI 렌더링 함수
// ==========================================
function switchView(viewName) {
    if(!views[viewName]) return;
    Object.values(views).forEach(v => {
        if(v) {
            v.classList.remove('active');
            v.classList.add('hidden');
        }
    });
    views[viewName].classList.remove('hidden');
    views[viewName].classList.add('active');
}

function getTileGridPosition(index, size) {
    const topEnd = size;
    const rightEnd = topEnd + size - 2;
    const bottomEnd = rightEnd + size;

    let col, row;
    if (index < topEnd) {
        col = index + 1;
        row = 1;
    } else if (index < rightEnd) {
        col = size;
        row = (index - topEnd) + 2;
    } else if (index < bottomEnd) {
        col = size - (index - rightEnd);
        row = size;
    } else {
        col = 1;
        row = size - 1 - (index - bottomEnd);
    }
    return { col, row };
}

function isCornerTile(index, size) {
    return index === 0 || index === size - 1 || index === 2 * size - 2 || index === 3 * size - 3;
}

function initBoard(containerId, isMinimap = false) {
    const container = document.getElementById(containerId);
    if(!container) return;

    container.innerHTML = '';
    const size = gameState.gridSize;
    const total = getTotalTiles(size);
    
    container.style.gridTemplateColumns = `repeat(${size}, ${isMinimap ? '30px' : '1fr'})`;
    container.style.gridTemplateRows = `repeat(${size}, ${isMinimap ? '30px' : '1fr'})`;
    
    for (let i = 0; i < total; i++) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.dataset.index = i;
        
        const pos = getTileGridPosition(i, size);
        tile.style.gridColumn = pos.col;
        tile.style.gridRow = pos.row;
        
        let label = isMinimap ? '' : `칸 ${i}`;
        
        if (i === 0) {
            label = isMinimap ? '출' : '출발';
            tile.classList.add('start', 'corner');
        } else if (isCornerTile(i, size)) {
            tile.classList.add('island', 'corner');
            if(!isMinimap) label = '무인도';
        }

        if (gameState.tileProblems[i]) {
            tile.classList.add('has-problem');
            if(!isMinimap && !isCornerTile(i, size)) label = '⚠️ 문제';
        }

        container.style.transform = `rotate(${gameState.boardRotation || 0}deg)`;

        tile.innerHTML = `
            <div style="transform: rotate(-${gameState.boardRotation || 0}deg); display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100%;">
                ${!isMinimap ? `<span class="tile-number">${i}</span>` : ''}
                <span>${label}</span>
            </div>
        `;
        
        if (isMinimap) {
            tile.addEventListener('click', () => openProblemEditor(i));
        }
        
        container.appendChild(tile);
    }
}

function renderTokens(containerId = 'board') {
    const board = document.getElementById(containerId);
    if(!board) return;
    const boardRect = board.getBoundingClientRect();

    gameState.players.forEach((player, index) => {
        const targetTile = document.querySelector(`#${containerId} .tile[data-index="${player.pos}"]`);
        if (!targetTile) return;

        let token = document.getElementById(`token-${containerId}-${player.id}`);
        if (!token) {
            token = document.createElement('div');
            token.id = `token-${containerId}-${player.id}`;
            token.className = 'token';
            token.style.backgroundColor = player.color;
            
            if (containerId === 'minimap') {
                token.style.width = '12px';
                token.style.height = '12px';
            }

            if (isAdminPage && containerId === 'minimap') {
                token.style.cursor = 'pointer';
                token.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openPlayerControl(player.id);
                });
            }
            board.appendChild(token);
        }
        
        const offset = containerId === 'minimap' ? index * 4 : index * 8;
        const relativeLeft = targetTile.offsetLeft + (containerId === 'minimap' ? 5 : 15) + offset;
        const relativeTop = targetTile.offsetTop + (containerId === 'minimap' ? 5 : 15) + offset;

        token.style.left = `${relativeLeft}px`;
        token.style.top = `${relativeTop}px`;
        token.style.transform = `rotate(-${gameState.boardRotation || 0}deg)`;
    });

    document.querySelectorAll(`#${containerId} > .token`).forEach(t => {
        const playerId = t.id.replace(`token-${containerId}-`, '');
        if (!gameState.players.find(p => p.id === playerId)) t.remove();
    });
}

function updateGameUI() {
    if (gameState.status !== 'playing' || isAdminPage) return;
    
    const board = document.getElementById('board');
    if(board.children.length !== getTotalTiles(gameState.gridSize)) {
        initBoard('board', false);
    }
    renderTokens('board');

    const turnIndicator = document.getElementById('turn-indicator');
    const rollBtn = document.getElementById('roll-dice-btn');
    
    if (gameState.players.length > 0) {
        const currentPlayer = gameState.players[gameState.turnIndex];
        const isMyTurn = currentPlayer && currentPlayer.id === currentUser?.id;

        turnIndicator.textContent = `현재 턴: ${currentPlayer.name}`;
        
        if (isMyTurn && !gameState.islandMode && !gameState.personalProblemPlayerId) {
            turnIndicator.classList.add('turn-active');
            rollBtn.disabled = false;
        } else {
            turnIndicator.classList.remove('turn-active');
            rollBtn.disabled = true;
        }
    }

    if (gameState.winner) {
        document.getElementById('winner-name').textContent = `${gameState.winner}님이 우승하셨습니다!`;
        document.getElementById('winner-modal').classList.remove('hidden');
    } else {
        document.getElementById('winner-modal').classList.add('hidden');
    }

    // 모서리 무인도 (전원 소환 모달)
    if (gameState.islandMode && gameState.currentProblem) {
        document.getElementById('island-modal').classList.remove('hidden');
        document.getElementById('math-question').textContent = gameState.currentProblem.q;
        document.getElementById('math-answer').value = '';
        document.getElementById('island-status').textContent = '';
    } else {
        document.getElementById('island-modal').classList.add('hidden');
    }

    // 일반 개인 문제 모달
    if (gameState.personalProblemPlayerId && gameState.currentProblem) {
        if(currentUser && currentUser.id === gameState.personalProblemPlayerId) {
            document.getElementById('personal-modal').classList.remove('hidden');
            document.getElementById('personal-math-question').textContent = gameState.currentProblem.q;
            document.getElementById('personal-math-answer').value = '';
            document.getElementById('personal-status').textContent = '';
        } else {
            // 다른 사람은 대기
            document.getElementById('personal-modal').classList.add('hidden');
            turnIndicator.textContent = `${gameState.players[gameState.turnIndex].name}님이 문제를 푸는 중...`;
        }
    } else {
        document.getElementById('personal-modal')?.classList.add('hidden');
    }
}

// ==========================================
// 4. 게임 로직
// ==========================================
function rollDice() {
    const diceBtn = document.getElementById('roll-dice-btn');
    const diceEl = document.getElementById('dice');
    
    diceBtn.disabled = true;
    diceEl.classList.add('rolling');
    
    setTimeout(() => {
        diceEl.classList.remove('rolling');
        let result = Math.floor(Math.random() * 6) + 1;
        
        // 치트 주사위 확인
        const currentPlayer = gameState.players[gameState.turnIndex];
        if (currentPlayer && currentPlayer.cheatDice) {
            result = parseInt(currentPlayer.cheatDice);
        }

        diceEl.textContent = result;
        
        processMove(result);
    }, 500);
}

function processMove(steps) {
    let players = [...gameState.players];
    let pIdx = gameState.turnIndex;
    let player = { ...players[pIdx] }; // 복사본 생성

    let currentStep = 0;
    const totalTiles = getTotalTiles(gameState.gridSize);
    const dirMultiplier = gameState.direction === 'counterclockwise' ? -1 : 1;
    
    let moveInterval = setInterval(() => {
        currentStep++;
        
        player.distance = (player.distance || 0) + 1;
        player.pos = (player.pos + dirMultiplier + totalTiles) % totalTiles;
        
        // 로컬 업데이트용 임시 배열
        let tempPlayers = [...players];
        tempPlayers[pIdx] = player;
        updateGameState({ players: tempPlayers });
        
        if (currentStep >= steps || player.distance >= totalTiles) {
            clearInterval(moveInterval);
            finishMove(player.pos, tempPlayers, pIdx, player.distance);
        }
    }, 300);
}

function finishMove(newPos, players, pIdx, distance) {
    const totalTiles = getTotalTiles(gameState.gridSize);
    let currentPlayer = players[pIdx];

    // 사용한 치트 주사위 초기화
    if (currentPlayer.cheatDice) {
        currentPlayer.cheatDice = null;
    }
    
    if (distance >= totalTiles) {
        updateGameState({ 
            winner: currentPlayer.name,
            players: players
        });
        return;
    }

    // 잡기(Catch) 룰 적용: 같은 칸에 다른 플레이어가 있으면 5칸 뒤로
    const dirMultiplier = gameState.direction === 'counterclockwise' ? -1 : 1;
    players = players.map((p, index) => {
        if (index !== pIdx && p.pos === newPos && p.distance > 0) {
            // 5칸 뒤로
            let caughtDist = p.distance - 5;
            let caughtPos;
            if (caughtDist <= 0) {
                caughtDist = 0;
                caughtPos = 0; // 출발지 뒤로는 못 가도록 0에서 멈춤
            } else {
                caughtPos = (p.pos - 5 * dirMultiplier + totalTiles * 5) % totalTiles;
            }
            return { ...p, pos: caughtPos, distance: caughtDist };
        }
        return p;
    });

    let updateData = { players };
    const isCorner = isCornerTile(newPos, gameState.gridSize);
    
    if (isCorner) {
        updateData.players = players.map(p => ({...p, pos: newPos}));
        updateData.islandMode = true;
        
        if (currentPlayer.hardProblem) {
            updateData.currentProblem = { ...currentPlayer.hardProblem };
            currentPlayer.hardProblem = null; // 사용 후 초기화
        } else if (gameState.tileProblems[newPos]) {
            updateData.currentProblem = gameState.tileProblems[newPos];
        } else {
            const a = Math.floor(Math.random() * 8) + 2;
            const b = Math.floor(Math.random() * 8) + 2;
            updateData.currentProblem = { q: `${a} x ${b} = ?`, a: (a*b).toString() };
        }
    } else if (currentPlayer.hardProblem || gameState.tileProblems[newPos]) {
        updateData.personalProblemPlayerId = currentPlayer.id;
        if (currentPlayer.hardProblem) {
            updateData.currentProblem = { ...currentPlayer.hardProblem };
            currentPlayer.hardProblem = null; // 사용 후 초기화
        } else {
            updateData.currentProblem = gameState.tileProblems[newPos];
        }
    } else {
        updateData.turnIndex = (pIdx + 1) % players.length;
    }

    setTimeout(() => {
        updateGameState(updateData);
    }, 400);
}

function submitAnswer(type) {
    const isPersonal = type === 'personal';
    const inputId = isPersonal ? 'personal-math-answer' : 'math-answer';
    const statusId = isPersonal ? 'personal-status' : 'island-status';
    
    const answer = document.getElementById(inputId).value.trim();
    if (!gameState.currentProblem) return;

    if (answer === gameState.currentProblem.a) {
        let updateData = {
            currentProblem: null
        };
        
        if (isPersonal) {
            updateData.personalProblemPlayerId = null;
            updateData.turnIndex = (gameState.turnIndex + 1) % gameState.players.length;
        } else {
            updateData.islandMode = false;
            updateData.turnIndex = (gameState.turnIndex + 1) % gameState.players.length;
        }
        
        updateGameState(updateData);
    } else {
        document.getElementById(statusId).textContent = '틀렸습니다! 다시 시도하세요.';
    }
}

// ==========================================
// 5. Firebase / Local Storage (MOCK)
// ==========================================
function loadState() {
    if (isMockMode) {
        const stored = localStorage.getItem('maeroomable_state');
        if (stored) {
            gameState = JSON.parse(stored);
            syncUI();
        }
    } else {
        db.collection('game').doc('state').onSnapshot(doc => {
            if (doc.exists) {
                gameState = doc.data();
                syncUI();
            } else if (isAdminPage) {
                // 문서가 없으면 어드민 페이지에서 초기화
                db.collection('game').doc('state').set(gameState);
            }
        });
    }
}

function updateGameState(newData) {
    gameState = { ...gameState, ...newData };
    if (isMockMode) {
        localStorage.setItem('maeroomable_state', JSON.stringify(gameState));
        syncUI();
    } else {
        db.collection('game').doc('state').set(gameState, { merge: true });
    }
}

if (isMockMode) {
    window.addEventListener('storage', (e) => {
        if (e.key === 'maeroomable_state') {
            gameState = JSON.parse(e.newValue);
            syncUI();
        }
    });
}

function syncUI() {
    if (isAdminPage) {
        updateAdminUI();
    } else {
        updateLobbyUI();
        updateGameUI();
        
        // 뷰 전환 자동 처리 (플레이어 전용)
        if (gameState.status === 'playing' && document.getElementById('game-view').classList.contains('hidden') && currentUser) {
            switchView('game');
        } else if (gameState.status === 'waiting' && document.getElementById('game-view').classList.contains('active')) {
            switchView('lobby');
        }
    }
}

function updateLobbyUI() {
    if(isAdminPage) return;
    const countEl = document.getElementById('lobby-count');
    if(countEl) countEl.textContent = gameState.players.length;
    const minEl = document.getElementById('lobby-min');
    if(minEl) minEl.textContent = gameState.minPlayers;
    
    const list = document.getElementById('lobby-players-list');
    if(!list) return;
    list.innerHTML = '';
    gameState.players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.name;
        list.appendChild(li);
    });
}

function updateAdminUI() {
    if(!isAdminPage) return;
    
    const countEl = document.getElementById('admin-player-count');
    if(countEl) countEl.textContent = gameState.players.length;
    
    const adminList = document.getElementById('waiting-players-list');
    if(adminList) {
        adminList.innerHTML = '';
        gameState.players.forEach(p => {
            const li = document.createElement('li');
            li.style.color = p.color;
            li.style.fontWeight = 'bold';
            let statusText = gameState.status === 'playing' ? `(위치: ${p.pos}칸)` : '(대기중)';
            li.textContent = `${p.name} ${statusText}`;
            adminList.appendChild(li);
        });
    }

    const startBtn = document.getElementById('start-game-btn');
    if(startBtn) {
        startBtn.disabled = gameState.players.length < gameState.minPlayers;
    }

    const minPlayersInput = document.getElementById('min-players');
    if(minPlayersInput && document.activeElement !== minPlayersInput) {
        minPlayersInput.value = gameState.minPlayers;
    }
    
    const gridSelect = document.getElementById('grid-size-select');
    if(gridSelect) gridSelect.value = gameState.gridSize;
    
    const dirSelect = document.getElementById('direction-select');
    if(dirSelect) dirSelect.value = gameState.direction || 'clockwise';
    
    const rotSelect = document.getElementById('rotation-select');
    if(rotSelect) rotSelect.value = gameState.boardRotation || 0;

    const minimap = document.getElementById('minimap');
    if (minimap && minimap.children.length !== getTotalTiles(gameState.gridSize)) {
        initBoard('minimap', true);
    }
    if (gameState.status === 'playing') {
        renderTokens('minimap');
    }
}

// ==========================================
// 6. 이벤트 리스너 설정
// ==========================================

// [Player]
if (!isAdminPage) {
    document.getElementById('login-btn')?.addEventListener('click', () => {
        const name = document.getElementById('username').value.trim();
        if (!name) return alert('이름을 입력하세요');

        loadState(); 
        document.getElementById('welcome-modal').classList.remove('hidden');
        
        document.getElementById('welcome-close-btn').onclick = () => {
            document.getElementById('welcome-modal').classList.add('hidden');
            currentUser = { id: Date.now().toString() + Math.random(), name: name, distance: 0 };
            
            if (gameState.players.length < 10 && gameState.status === 'waiting') {
                const newPlayer = {
                    id: currentUser.id,
                    name: currentUser.name,
                    pos: 0,
                    distance: 0,
                    color: colors[gameState.players.length % colors.length]
                };
                updateGameState({ players: [...gameState.players, newPlayer] });
                switchView('lobby');
            } else {
                alert('게임이 이미 시작되었거나 정원이 꽉 찼습니다.');
            }
        };
    });

    document.getElementById('roll-dice-btn')?.addEventListener('click', rollDice);
    document.getElementById('submit-answer-btn')?.addEventListener('click', () => submitAnswer('island'));
    document.getElementById('submit-personal-btn')?.addEventListener('click', () => submitAnswer('personal'));
    document.getElementById('back-to-lobby-btn')?.addEventListener('click', () => {
        updateGameState({ status: 'waiting', players: [], turnIndex: 0, islandMode: false, personalProblemPlayerId: null, winner: null });
    });
}

// [Admin]
if (isAdminPage) {
    document.getElementById('admin-login-btn')?.addEventListener('click', () => {
        const pass = document.getElementById('admin-pass').value;
        if(pass !== 'admin1234' && pass !== '150122') {
            return alert('비밀번호가 틀렸습니다.');
        }
        switchView('admin');
        loadState();
        syncUI();
    });

    document.getElementById('min-players')?.addEventListener('change', (e) => {
        updateGameState({ minPlayers: parseInt(e.target.value) || 2 });
    });

    document.getElementById('grid-size-select')?.addEventListener('change', (e) => {
        updateGameState({ gridSize: parseInt(e.target.value) || 7 });
    });

    document.getElementById('direction-select')?.addEventListener('change', (e) => {
        updateGameState({ direction: e.target.value });
    });

    document.getElementById('rotation-select')?.addEventListener('change', (e) => {
        updateGameState({ boardRotation: parseInt(e.target.value) });
    });

    document.getElementById('start-game-btn')?.addEventListener('click', () => {
        if (gameState.players.length < gameState.minPlayers) return alert('최소 인원을 충족하지 못했습니다.');
        updateGameState({ status: 'playing', turnIndex: 0, islandMode: false, personalProblemPlayerId: null, winner: null });
        alert('게임이 시작되었습니다! 플레이어들의 화면이 보드판으로 넘어갔습니다.');
    });

    document.getElementById('end-game-btn')?.addEventListener('click', () => {
        updateGameState({ status: 'waiting', players: [], turnIndex: 0, islandMode: false, personalProblemPlayerId: null, winner: null });
        alert('게임이 초기화되었습니다.');
    });

    document.getElementById('logout-admin-btn')?.addEventListener('click', () => {
        switchView('auth');
    });

    // Admin Editor (Tile)
    let editingTileIndex = null;
    window.openProblemEditor = function(index) {
        editingTileIndex = index;
        const existing = gameState.tileProblems[index] || {q: '', a: ''};
        
        let typeStr = isCornerTile(index, gameState.gridSize) ? '(무인도-전원소환)' : '(일반칸-개인풀이)';
        document.getElementById('editor-tile-title').textContent = `${index}번 칸 문제 설정 ${typeStr}`;
        document.getElementById('editor-q').value = existing.q;
        document.getElementById('editor-a').value = existing.a;
        
        document.getElementById('problem-editor-modal').classList.remove('hidden');
    }

    document.getElementById('editor-save-btn')?.addEventListener('click', () => {
        const q = document.getElementById('editor-q').value.trim();
        const a = document.getElementById('editor-a').value.trim();
        let updatedProblems = { ...gameState.tileProblems };
        if (q && a) updatedProblems[editingTileIndex] = { q, a };
        else delete updatedProblems[editingTileIndex];
        updateGameState({ tileProblems: updatedProblems });
        document.getElementById('problem-editor-modal').classList.add('hidden');
    });

    document.getElementById('editor-cancel-btn')?.addEventListener('click', () => {
        document.getElementById('problem-editor-modal').classList.add('hidden');
    });

    // Admin Editor (Player)
    let editingPlayerId = null;
    window.openPlayerControl = function(playerId) {
        editingPlayerId = playerId;
        const player = gameState.players.find(p => p.id === playerId);
        if(!player) return;
        
        document.getElementById('player-control-title').textContent = `플레이어 제어: ${player.name}`;
        document.getElementById('cheat-dice-select').value = player.cheatDice || "";
        document.getElementById('cheat-problem-q').value = player.hardProblem ? player.hardProblem.q : "";
        document.getElementById('cheat-problem-a').value = player.hardProblem ? player.hardProblem.a : "";
        
        document.getElementById('player-control-modal').classList.remove('hidden');
    }

    document.getElementById('player-control-save-btn')?.addEventListener('click', () => {
        const cheatDice = document.getElementById('cheat-dice-select').value;
        const q = document.getElementById('cheat-problem-q').value.trim();
        const a = document.getElementById('cheat-problem-a').value.trim();
        
        let players = [...gameState.players];
        const idx = players.findIndex(p => p.id === editingPlayerId);
        if(idx !== -1) {
            players[idx].cheatDice = cheatDice || null;
            if (q && a) players[idx].hardProblem = { q, a };
            else players[idx].hardProblem = null;
            updateGameState({ players });
        }
        document.getElementById('player-control-modal').classList.add('hidden');
    });

    document.getElementById('player-control-cancel-btn')?.addEventListener('click', () => {
        document.getElementById('player-control-modal').classList.add('hidden');
    });

    // Resizer Logic
    const resizer = document.getElementById('resizer');
    const leftPanel = document.getElementById('admin-left');
    
    if(resizer && leftPanel) {
        let isResizing = false;
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = e.clientX - leftPanel.getBoundingClientRect().left;
            if (newWidth > 200 && newWidth < window.innerWidth - 300) {
                leftPanel.style.flex = `0 0 ${newWidth}px`;
            }
        });
        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = '';
        });
    }
}

// Init
loadState();
if(isMockMode) syncUI();
