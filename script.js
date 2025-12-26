class NineBoardGo {
    constructor() {
        this.board = Array(9).fill().map(() => Array(9).fill(0));
        this.currentPlayer = 1; // 1=黑, -1=白
        this.gameHistory = [];
        this.consecutivePasses = 0;
        this.phase = 'playing'; 
        this.aiEnabled = true;
        this.komi = 5.5; 
        
        this.deadStones = new Set();
        this.atariStones = new Set();
        this.koBan = null;
        
        // --- 新增：動畫鎖定狀態 ---
        this.isAnimating = false;

        // 音效設定
        this.placeSound = new Audio('https://www.soundjay.com/button/sounds/button-16.mp3'); 
        this.captureSound = new Audio('https://www.soundjay.com/button/sounds/button-09.mp3');
        this.atariSound = new Audio('https://www.soundjay.com/misc/sounds/bell-ringing-01.mp3');
        this.atariSound.volume = 0.4;

        this.initBoard();
        this.updateStatus();
    }

    initBoard() {
        const boardEl = document.getElementById('board');
        boardEl.innerHTML = '';
        const starPoints = ['2,2', '6,2', '4,4', '2,6', '6,6'];

        for (let i = 0; i < 81; i++) {
            const row = Math.floor(i / 9);
            const col = i % 9;
            const cell = document.createElement('div');
            cell.className = 'cell';
            
            if (col === 0) cell.classList.add('left-edge');
            if (col === 8) cell.classList.add('right-edge');
            if (row === 0) cell.classList.add('top-edge');
            if (row === 8) cell.classList.add('bottom-edge');

            if (starPoints.includes(`${col},${row}`)) {
                const dot = document.createElement('div');
                dot.className = 'dot';
                cell.appendChild(dot);
            }

            cell.dataset.row = row;
            cell.dataset.col = col;
            cell.addEventListener('click', () => this.handleClick(row, col));
            cell.addEventListener('mouseenter', () => this.handleHover(row, col, true));
            cell.addEventListener('mouseleave', () => this.handleHover(row, col, false));

            boardEl.appendChild(cell);
        }
    }

    handleHover(row, col, isEntering) {
        if (this.phase !== 'playing') return;
        const color = this.board[row][col];
        if (color === 0) return;

        const group = this.getConnectedGroup(row, col, color);
        group.forEach(pos => {
            const cell = document.querySelector(`.cell[data-row="${pos.r}"][data-col="${pos.c}"]`);
            const stone = cell ? cell.querySelector('.stone') : null;
            if (stone) {
                if (isEntering) stone.classList.add('group-highlight');
                else stone.classList.remove('group-highlight');
            }
        });
    }

    handleClick(row, col) {
        // --- 檢查：若正在播放動畫，禁止點擊 ---
        if (this.isAnimating) return;

        if (this.phase === 'playing') {
            if (this.currentPlayer !== 1) return; 
            if (this.isValidMove(row, col)) {
                this.playMove(row, col, 1);
                // AI 呼叫移至 finalizeMove 確保動畫後才執行
            }
        } else if (this.phase === 'marking') {
            this.toggleDeadStone(row, col);
        }
    }

    playMove(row, col, player) {
        // makeMove 現在負責處理動畫與邏輯
        this.makeMove(row, col, player);
        this.gameHistory.push({row, col, player});
        this.consecutivePasses = 0;
        document.getElementById('passInfo').textContent = '';
        // 玩家切換與 AI 觸發移至 finalizeMove
    }

    isValidMove(row, col) {
        if (this.board[row][col] !== 0) return false;
        if (this.koBan && this.koBan.row === row && this.koBan.col === col) return false;

        const tempBoard = JSON.parse(JSON.stringify(this.board));
        tempBoard[row][col] = this.currentPlayer;
        
        if (this.hasLiberties(tempBoard, row, col, this.currentPlayer)) return true;
        if (this.canCapture(tempBoard, row, col, this.currentPlayer)) return true;
        
        return false;
    }

    // --- 重寫：包含動畫邏輯的下子函數 ---
    makeMove(row, col, player) {
        this.placeSound.currentTime = 0;
        this.placeSound.play();

        this.board[row][col] = player;
        this.lastMove = {row, col};
        
        const opponent = -player;
        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        
        let allCapturedStones = []; // 收集所有被提掉的子

        // 1. 掃描所有被提掉的棋子
        for (let [dr, dc] of dirs) {
            const nr = row + dr, nc = col + dc;
            if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && this.board[nr][nc] === opponent) {
                if (!this.hasLiberties(this.board, nr, nc, opponent)) {
                    const group = this.getConnectedGroup(nr, nc, opponent);
                    allCapturedStones.push(...group);
                }
            }
        }

        // 2. 判斷是否有提子，決定流程
        if (allCapturedStones.length > 0) {
            // --- A. 有提子：播放動畫 ---
            this.isAnimating = true; // 鎖定介面

            this.captureSound.currentTime = 0;
            this.captureSound.play();

            // 對 DOM 元素添加動畫 class
            allCapturedStones.forEach(pos => {
                const cell = document.querySelector(`.cell[data-row="${pos.r}"][data-col="${pos.c}"]`);
                const stone = cell ? cell.querySelector('.stone') : null;
                if (stone) {
                    stone.classList.add('capturing');
                }
            });

            // 設定延遲，等待 CSS 動畫結束 (300ms)
            setTimeout(() => {
                // 清除邏輯盤面
                allCapturedStones.forEach(pos => {
                    this.board[pos.r][pos.c] = 0;
                });
                
                // 處理 Ko (打劫)
                this.handleKoLogic(row, col, allCapturedStones);
                
                // 完成回合更新
                this.finalizeMove();
                
                this.isAnimating = false; // 解除鎖定
            }, 300); // 這裡的時間要配合 CSS animation duration

        } else {
            // --- B. 無提子：直接更新 ---
            this.handleKoLogic(row, col, []);
            this.finalizeMove();
        }
    }

    // 新增：獨立的 Ko 判斷邏輯
    handleKoLogic(row, col, capturedStones) {
        this.koBan = null;
        if (capturedStones.length === 1) {
            const selfGroup = this.getConnectedGroup(row, col, this.board[row][col]);
            if (selfGroup.length === 1 && this.getGroupLiberties(selfGroup) === 1) {
                this.koBan = { row: capturedStones[0].r, col: capturedStones[0].c };
            }
        }
    }

    // 新增：回合結束後的統一更新 (換手、UI、AI)
    finalizeMove() {
        this.currentPlayer = -this.currentPlayer;
        
        this.calculateAtari();
        this.updateBoardDisplay();
        this.updateSimpleCount();
        this.updateStatus();

        // 如果輪到 AI，且遊戲正在進行中
        if (this.aiEnabled && this.currentPlayer === -1 && this.phase === 'playing') {
            setTimeout(() => this.aiMove(), 500);
        }
    }

    // --- 以下輔助函數與之前相同 ---

    calculateAtari() {
        this.atariStones.clear();
        let atariSoundTriggered = false;
        const visited = Array(9).fill().map(() => Array(9).fill(false));

        for(let r=0; r<9; r++) {
            for(let c=0; c<9; c++) {
                const color = this.board[r][c];
                if (color !== 0 && !visited[r][c]) {
                    const group = this.getConnectedGroup(r, c, color);
                    group.forEach(p => visited[p.r][p.c] = true);
                    const liberties = this.getGroupLiberties(group);
                    
                    if (liberties === 1) {
                        group.forEach(p => this.atariStones.add(`${p.r},${p.c}`));
                        atariSoundTriggered = true;
                    }
                }
            }
        }
        if (atariSoundTriggered && this.phase === 'playing') {
             this.atariSound.currentTime = 0;
             this.atariSound.play().catch(e=>{});
        }
    }

    getGroupLiberties(group) {
        const liberties = new Set();
        group.forEach(stone => {
            const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
            for (let [dr, dc] of dirs) {
                const nr = stone.r + dr, nc = stone.c + dc;
                if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && this.board[nr][nc] === 0) {
                    liberties.add(`${nr},${nc}`);
                }
            }
        });
        return liberties.size;
    }

    updateBoardDisplay() {
        const cells = document.querySelectorAll('.cell');
        cells.forEach(cell => {
            const r = parseInt(cell.dataset.row);
            const c = parseInt(cell.dataset.col);
            const val = this.board[r][c];
            
            // 這裡會清除舊的 .stone，包含正在播放動畫的 .capturing 棋子
            // 但因為 makeMove 有 setTimeout 延遲呼叫此函數，所以動畫播放完才會執行這裡
            const oldStone = cell.querySelector('.stone');
            if (oldStone) oldStone.remove();
            cell.classList.remove('last-move');

            if (val !== 0) {
                const stone = document.createElement('div');
                stone.className = `stone ${val === 1 ? 'black' : 'white'}`;
                if (this.deadStones.has(`${r},${c}`)) stone.classList.add('dead');
                if (this.atariStones.has(`${r},${c}`) && this.phase === 'playing') {
                    stone.classList.add('atari-warning');
                }
                cell.appendChild(stone);
                if (this.lastMove && this.lastMove.row === r && this.lastMove.col === c && !this.deadStones.has(`${r},${c}`)) {
                    stone.classList.add('last-move');
                }
            }
        });
        document.getElementById('undoBtn').disabled = this.gameHistory.length === 0 || this.phase !== 'playing' || this.isAnimating;
    }

    getConnectedGroup(row, col, color) {
        const group = [];
        const visited = Array(9).fill().map(() => Array(9).fill(false));
        const stack = [{r: row, c: col}];
        visited[row][col] = true;

        while(stack.length > 0) {
            const curr = stack.pop();
            group.push(curr);
            const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
            for (let [dr, dc] of dirs) {
                const nr = curr.r + dr, nc = curr.c + dc;
                if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && 
                    !visited[nr][nc] && this.board[nr][nc] === color) {
                    visited[nr][nc] = true;
                    stack.push({r: nr, c: nc});
                }
            }
        }
        return group;
    }

    hasLiberties(board, row, col, player) {
        const visited = Array(9).fill().map(() => Array(9).fill(false));
        const stack = [{r: row, c: col}];
        visited[row][col] = true;
        
        while(stack.length > 0) {
            const curr = stack.pop();
            const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
            for (let [dr, dc] of dirs) {
                const nr = curr.r + dr, nc = curr.c + dc;
                if (nr < 0 || nr >= 9 || nc < 0 || nc >= 9) continue;
                if (board[nr][nc] === 0) return true;
                if (board[nr][nc] === player && !visited[nr][nc]) {
                    visited[nr][nc] = true;
                    stack.push({r: nr, c: nc});
                }
            }
        }
        return false;
    }

    canCapture(board, row, col, player) {
        const opponent = -player;
        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (let [dr, dc] of dirs) {
            const nr = row + dr, nc = col + dc;
            if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && board[nr][nc] === opponent) {
                if (!this.hasLiberties(board, nr, nc, opponent)) return true;
            }
        }
        return false;
    }
    
    countLiberties(row, col) {
        const player = this.board[row][col];
        const group = this.getConnectedGroup(row, col, player);
        return this.getGroupLiberties(group);
    }

    toggleDeadStone(row, col) {
        const val = this.board[row][col];
        if (val === 0) return; 

        const group = this.getConnectedGroup(row, col, val);
        const key = `${row},${col}`;
        const isCurrentlyDead = this.deadStones.has(key);
        
        group.forEach(stone => {
            const stoneKey = `${stone.r},${stone.c}`;
            if (isCurrentlyDead) this.deadStones.delete(stoneKey);
            else this.deadStones.add(stoneKey);
        });

        this.updateBoardDisplay();
    }

    undoMove() {
        if (this.gameHistory.length === 0 || this.phase !== 'playing' || this.isAnimating) return;
        let steps = this.aiEnabled ? 2 : 1;
        while(steps > 0 && this.gameHistory.length > 0) {
            const last = this.gameHistory.pop();
            this.board[last.row][last.col] = 0;
            steps--;
        }
        this.currentPlayer = 1;
        this.consecutivePasses = 0;
        this.koBan = null;
        this.atariStones.clear();
        this.updateBoardDisplay();
        this.updateStatus();
    }

    pass() {
        this.consecutivePasses++;
        const pName = this.currentPlayer === 1 ? "黑棋" : "白棋";
        document.getElementById('passInfo').textContent = `${pName} 讓子 (${this.consecutivePasses}/2)`;
        
        if (this.consecutivePasses >= 2) {
            this.startScoringPhase();
            return;
        }
        
        this.currentPlayer = -this.currentPlayer;
        this.updateStatus();
        this.atariStones.clear();
        
        if (this.currentPlayer === -1 && this.aiEnabled && this.phase === 'playing') {
            setTimeout(() => this.aiMove(), 500);
        }
    }

    startScoringPhase() {
        this.phase = 'marking';
        document.getElementById('status').textContent = "🧐 請點擊棋盤上的「死子」(將被移除)";
        document.getElementById('status').style.color = "#f39c12";
        document.getElementById('passBtn').style.display = 'none';
        document.getElementById('aiBtn').style.display = 'none';
        document.getElementById('undoBtn').style.display = 'none';
        document.getElementById('calcBtn').style.display = 'inline-block';
        this.atariStones.clear();
        this.updateBoardDisplay();
    }

    aiMove() {
        if (this.phase !== 'playing') return;
        
        // 確保 AI 思考時身分是白棋 (-1)
        // 這樣 isValidMove 才會正確檢查白棋的禁手
        const originalPlayer = this.currentPlayer;
        this.currentPlayer = -1; 

        let availableMoves = [];
        for (let r=0; r<9; r++) {
            for (let c=0; c<9; c++) {
                if (this.board[r][c] === 0) {
                    
                    // 檢查這步棋對白棋是否合法
                    if (this.isValidMove(r, c)) {
                        let score = Math.random() * 10;
                        if (r>=3 && r<=5 && c>=3 && c<=5) score += 5;
                        
                        // 簡單防禦評估
                        this.board[r][c] = -1; 
                        if (this.countLiberties(r, c) === 1) score -= 20;
                        this.board[r][c] = 0; 

                        availableMoves.push({r, c, score});
                    }
                }
            }
        }
        
        // 恢復原本的玩家狀態 (雖然理論上此時應該還是 -1)
        this.currentPlayer = originalPlayer;

        if (availableMoves.length > 0) {
            availableMoves.sort((a,b) => b.score - a.score);
            this.playMove(availableMoves[0].r, availableMoves[0].c, -1);
        } else {
            this.pass();
        }
    }

    calculateFinalScore() {
        let calcBoard = this.board.map(row => [...row]);
        this.deadStones.forEach(key => {
            const [r, c] = key.split(',').map(Number);
            calcBoard[r][c] = 0;
        });
        let territoryMap = Array(9).fill().map(() => Array(9).fill(0)); 
        let visited = Array(9).fill().map(() => Array(9).fill(false));
        for(let r=0; r<9; r++){
            for(let c=0; c<9; c++){
                if(calcBoard[r][c] === 0 && !visited[r][c]) {
                    const region = [];
                    const q = [{r, c}];
                    visited[r][c] = true;
                    let touchesBlack = false, touchesWhite = false;
                    while(q.length > 0) {
                        const curr = q.pop();
                        region.push(curr);
                        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
                        for(let [dr, dc] of dirs) {
                            const nr = curr.r + dr, nc = curr.c + dc;
                            if(nr>=0 && nr<9 && nc>=0 && nc<9) {
                                const val = calcBoard[nr][nc];
                                if(val === 1) touchesBlack = true;
                                else if(val === -1) touchesWhite = true;
                                else if(!visited[nr][nc]) {
                                    visited[nr][nc] = true;
                                    q.push({r: nr, c: nc});
                                }
                            }
                        }
                    }
                    let owner = 0;
                    if(touchesBlack && !touchesWhite) owner = 1;
                    else if(!touchesBlack && touchesWhite) owner = -1;
                    region.forEach(p => territoryMap[p.r][p.c] = owner);
                }
            }
        }
        let bStones=0, wStones=0, bTerr=0, wTerr=0;
        for(let r=0; r<9; r++){
            for(let c=0; c<9; c++){
                if(calcBoard[r][c]===1) bStones++; else if(calcBoard[r][c]===-1) wStones++;
                if(territoryMap[r][c]===1) bTerr++; else if(territoryMap[r][c]===-1) wTerr++;
            }
        }
        const bTotal = bStones + bTerr;
        const wTotal = wStones + wTerr + this.komi;
        this.drawTerritory(territoryMap);
        this.showScoreModal(bTotal, wTotal, bStones, wStones, bTerr, wTerr);
        this.phase = 'ended';
        document.getElementById('status').textContent = "🏁 遊戲結束";
        document.getElementById('calcBtn').style.display = 'none';
    }
    
    drawTerritory(map) { document.querySelectorAll('.territory-mark').forEach(el => el.remove()); const cells = document.querySelectorAll('.cell'); cells.forEach(cell => { const r = parseInt(cell.dataset.row); const c = parseInt(cell.dataset.col); if (map[r][c] !== 0) { const mark = document.createElement('div'); mark.className = `territory-mark ${map[r][c] === 1 ? 'territory-black' : 'territory-white'}`; cell.appendChild(mark); } }); }
    
    showScoreModal(bTotal, wTotal, bStones, wStones, bTerr, wTerr) { const modal = document.getElementById('scoreModal'); const details = document.getElementById('scoreDetails'); const winner = document.getElementById('winnerDisplay'); details.innerHTML = `<div class="score-row"><span>🖤 黑棋子數</span> <span>${bStones}</span></div><div class="score-row"><span>🖤 黑棋地盤</span> <span>${bTerr}</span></div><div class="score-row" style="color:#2ecc71"><strong>🖤 總分</strong> <strong>${bTotal}</strong></div><hr><div class="score-row"><span>⚪ 白棋子數</span> <span>${wStones}</span></div><div class="score-row"><span>⚪ 白棋地盤</span> <span>${wTerr}</span></div><div class="score-row"><span>⚪ 貼目</span> <span>${this.komi}</span></div><div class="score-row" style="color:#2ecc71"><strong>⚪ 總分</strong> <strong>${wTotal}</strong></div>`; if (bTotal > wTotal) winner.textContent = `🎉 黑棋勝 ${Math.round((bTotal - wTotal)*10)/10} 目`; else winner.textContent = `🎉 白棋勝 ${Math.round((wTotal - bTotal)*10)/10} 目`; modal.classList.add('active'); }
    
    updateSimpleCount() { let b = 0, w = 0; for(let r=0; r<9; r++) for(let c=0; c<9; c++) { if(this.board[r][c] === 1) b++; if(this.board[r][c] === -1) w++; } document.getElementById('blackScore').textContent = b; document.getElementById('whiteScore').textContent = w; }
    
    updateStatus() { const statusEl = document.getElementById('status'); if (this.phase === 'marking' || this.phase === 'ended') return; const name = this.currentPlayer === 1 ? "🖤 黑棋" : "⚪ 白棋"; statusEl.textContent = `${name} 回合`; statusEl.style.color = this.currentPlayer === 1 ? "#000" : "#fff"; }
}

let game;
function newGame() {
    document.getElementById('passBtn').style.display = 'inline-block';
    document.getElementById('aiBtn').style.display = 'inline-block';
    document.getElementById('undoBtn').style.display = 'inline-block';
    document.getElementById('calcBtn').style.display = 'none';
    document.getElementById('passInfo').textContent = '';
    document.getElementById('scoreModal').classList.remove('active');
    document.querySelectorAll('.territory-mark').forEach(el => el.remove());
    game = new NineBoardGo();
}
function toggleAI() { if(!game) return; game.aiEnabled = !game.aiEnabled; document.getElementById('aiBtn').textContent = `AI: ${game.aiEnabled?'開':'關'}`; }
window.onload = newGame;
