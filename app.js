/* =============================================
   LÔ TÔ - MAIN APPLICATION
   Game logic and UI management
   ============================================= */

const Game = {
    // Game state
    calledNumbers: new Set(),
    remainingNumbers: [],
    currentNumber: null,
    gameStarted: false,
    playerTicket: null,
    markedNumbers: new Set(),
    isDrawing: false, // Lock to prevent rapid draw clicks

    // DOM Elements cache
    elements: {},

    // Initialize game
    init() {
        this.cacheElements();
        this.setupEventListeners();
        this.generateNumbersGrid('numbers-grid');
        this.generateNumbersGrid('player-numbers-grid', true);
        this.resetRemainingNumbers();
        this.setupTTSControls();

        console.log('Lô Tô game initialized');
    },

    // Cache DOM elements
    cacheElements() {
        this.elements = {
            // Screens
            homeScreen: document.getElementById('home-screen'),
            hostScreen: document.getElementById('host-screen'),
            playerScreen: document.getElementById('player-screen'),

            // Home buttons
            btnHost: document.getElementById('btn-host'),
            btnJoin: document.getElementById('btn-join'),

            // Host elements
            btnBackHost: document.getElementById('btn-back-host'),
            qrCode: document.getElementById('qr-code'),
            roomCodeDisplay: document.getElementById('room-code-display'),
            btnCopyCode: document.getElementById('btn-copy-code'),
            playerCount: document.getElementById('player-count'),
            currentNumber: document.getElementById('current-number'),
            numberText: document.getElementById('number-text'),
            btnDraw: document.getElementById('btn-draw'),
            calledCount: document.getElementById('called-count'),
            numbersGrid: document.getElementById('numbers-grid'),

            // Player elements
            btnBackPlayer: document.getElementById('btn-back-player'),
            connectionStatus: document.getElementById('connection-status'),
            playerCurrentNumber: document.getElementById('player-current-number'),
            playerTicket: document.getElementById('player-ticket'),
            btnNewTicket: document.getElementById('btn-new-ticket'),
            btnLoto: document.getElementById('btn-loto'),
            playerNumbersGrid: document.getElementById('player-numbers-grid'),

            // Modals
            joinModal: document.getElementById('join-modal'),
            btnCloseJoin: document.getElementById('btn-close-join'),
            roomCodeInput: document.getElementById('room-code-input'),
            btnJoinRoom: document.getElementById('btn-join-room'),
            btnStartScan: document.getElementById('btn-start-scan'),
            qrVideo: document.getElementById('qr-video'),
            qrScannerContainer: document.getElementById('qr-scanner-container'),

            winModal: document.getElementById('win-modal'),
            winnerName: document.getElementById('winner-name'),
            btnCloseWin: document.getElementById('btn-close-win'),

            // TTS
            ttsSpeed: document.getElementById('tts-speed'),
            speedValue: document.getElementById('speed-value'),
            ttsVolume: document.getElementById('tts-volume'),
            volumeValue: document.getElementById('volume-value'),

            // Toast
            toastContainer: document.getElementById('toast-container'),

            // New Input
            playerNameInput: document.getElementById('player-name-input')
        };
    },

    // Player Management (Host Side)
    players: new Map(), // Map<peerId, { name, ticket, connected: true }>

    // Setup event listeners
    setupEventListeners() {
        // Home screen
        this.elements.btnHost.addEventListener('click', () => this.startAsHost());
        this.elements.btnJoin.addEventListener('click', () => this.showJoinModal());

        // Host screen
        this.elements.btnBackHost.addEventListener('click', () => this.goHome());
        this.elements.btnCopyCode.addEventListener('click', () => this.copyRoomCode());
        this.elements.btnDraw.addEventListener('click', () => this.drawNumber());

        // Player screen
        this.elements.btnBackPlayer.addEventListener('click', () => this.goHome());
        this.elements.btnNewTicket.addEventListener('click', () => this.generatePlayerTicket());
        this.elements.btnLoto.addEventListener('click', () => this.claimLoto());

        // Join modal
        this.elements.btnCloseJoin.addEventListener('click', () => this.hideJoinModal());
        this.elements.btnJoinRoom.addEventListener('click', () => this.joinRoom());
        this.elements.roomCodeInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        this.elements.btnStartScan.addEventListener('click', () => this.startQRScanner());

        // Win modal
        this.elements.btnCloseWin.addEventListener('click', () => this.hideWinModal());

        // Close modals on backdrop click
        this.elements.joinModal.addEventListener('click', (e) => {
            if (e.target === this.elements.joinModal) this.hideJoinModal();
        });
        this.elements.winModal.addEventListener('click', (e) => {
            if (e.target === this.elements.winModal) this.hideWinModal();
        });
    },

    // Setup TTS controls
    setupTTSControls() {
        this.elements.ttsSpeed.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            TTS.setRate(value);
            this.elements.speedValue.textContent = `${value}x`;
        });

        this.elements.ttsVolume.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            TTS.setVolume(value);
            this.elements.volumeValue.textContent = `${Math.round(value * 100)}%`;
        });
    },

    // Generate numbers grid (1-90)
    generateNumbersGrid(containerId, small = false) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        for (let i = 1; i <= 90; i++) {
            const cell = document.createElement('div');
            cell.className = 'number-cell';
            cell.dataset.number = i;
            cell.textContent = i;
            container.appendChild(cell);
        }
    },

    // Reset remaining numbers
    resetRemainingNumbers() {
        this.remainingNumbers = Array.from({ length: 90 }, (_, i) => i + 1);
        this.shuffleArray(this.remainingNumbers);
    },

    // Fisher-Yates shuffle
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },

    // Switch screens
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    },

    // Go back to home
    goHome() {
        P2P.disconnect();
        this.reset();
        this.players.clear();
        this.showScreen('home-screen');
    },

    // =============================================
    // HOST FUNCTIONS
    // =============================================

    async startAsHost() {
        try {
            this.showToast('Đang tạo phòng...', 'info');

            // Initialize P2P as host
            const roomCode = await P2P.initHost();

            // Setup P2P callbacks
            // Setup P2P callbacks
            P2P.onPlayerJoin = (playerId, count, name, ticket) => {
                const playerData = this.handlePlayerJoin(playerId, name, ticket);
                this.elements.playerCount.textContent = this.players.size;
                const displayName = name || `Người chơi ${playerId.substr(0, 4)}`;
                this.showToast(`${displayName} đã tham gia!`, 'success');
                return playerData;
            };

            P2P.onPlayerLeave = (playerId, count) => {
                if (this.players.has(playerId)) {
                    this.players.get(playerId).connected = false;
                }
                this.elements.playerCount.textContent = this.players.size; // Or keep count of active only?
            };

            P2P.onWinClaim = (playerId) => {
                // Verify win and announce
                if (this.verifyWin(playerId)) {
                    const player = this.players.get(playerId);
                    const listName = player ? (player.name || 'Người chơi') : 'Người chơi';
                    P2P.confirmWin(listName);
                    this.showWin(listName);
                } else {
                    // Notify the cheater (optional) or just ignore
                    console.warn(`Invalid win claim from ${playerId}`);
                }
            };

            P2P.onTicketUpdate = (playerId, ticket) => {
                this.handleTicketUpdate(playerId, ticket);
            };

            // Generate QR code
            this.generateQRCode(roomCode);

            // Update UI
            this.elements.roomCodeDisplay.textContent = roomCode;
            this.elements.playerCount.textContent = '0';
            this.elements.btnDraw.disabled = false;
            this.gameStarted = false; // Game starts only when first number is drawn

            this.showScreen('host-screen');
            this.showToast('Phòng đã sẵn sàng!', 'success');

        } catch (error) {
            console.error('Failed to start as host:', error);
            this.showToast('Không thể tạo phòng. Vui lòng thử lại.', 'error');
        }
    },

    // Generate QR code for room
    generateQRCode(roomCode) {
        this.elements.qrCode.innerHTML = '';

        // Create URL with room code
        const url = `${window.location.href}?room=${roomCode}`;

        QRCode.toCanvas(url, {
            width: 250,
            margin: 2,
            color: {
                dark: '#1A0A0A',
                light: '#FFFFFF'
            }
        }, (error, canvas) => {
            if (error) {
                console.error('QR Code error:', error);
                return;
            }
            this.elements.qrCode.appendChild(canvas);
        });
    },

    // Copy room code to clipboard
    async copyRoomCode() {
        try {
            await navigator.clipboard.writeText(P2P.roomCode);
            this.showToast('Đã sao chép mã phòng!', 'success');
        } catch (error) {
            // Fallback for older browsers
            const input = document.createElement('input');
            input.value = P2P.roomCode;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            this.showToast('Đã sao chép mã phòng!', 'success');
        }
    },

    // Draw a random number
    async drawNumber() {
        // Prevent rapid clicks (race condition fix)
        if (this.isDrawing) return;

        if (this.remainingNumbers.length === 0) {
            this.showToast('Đã hết số!', 'info');
            return;
        }

        this.isDrawing = true;
        this.elements.btnDraw.disabled = true;

        // Get next number
        const number = this.remainingNumbers.pop();
        this.calledNumbers.add(number);
        this.currentNumber = number;

        // Update UI
        this.updateCurrentNumber(number);
        this.markNumberCalled(number);
        this.elements.calledCount.textContent = this.calledNumbers.size;

        // Broadcast to players IMMEDIATELY (before TTS)
        P2P.broadcastNumber(number, TTS.numberToWords(number));

        // Announce via TTS (host side)
        await TTS.announceNumber(number);

        // Re-enable button after TTS completes
        this.isDrawing = false;
        this.elements.btnDraw.disabled = false;
    },

    // Update current number display
    updateCurrentNumber(number) {
        const ball = P2P.isHost ? this.elements.currentNumber : this.elements.playerCurrentNumber;
        ball.querySelector('span').textContent = number;
        ball.classList.remove('new-number');
        void ball.offsetWidth; // Force reflow
        ball.classList.add('new-number');

        // Get the rhyme from TTS module
        const rhyme = TTS.getNumberRhyme(number);

        if (P2P.isHost) {
            this.elements.numberText.textContent = rhyme;
        }

        // Also update player's rhyme display if exists
        const playerRhymeElement = document.getElementById('player-number-text');
        if (playerRhymeElement) {
            playerRhymeElement.textContent = rhyme;
        }
    },

    // Mark number as called in grid
    markNumberCalled(number, gridId = null) {
        const grids = gridId
            ? [document.getElementById(gridId)]
            : [this.elements.numbersGrid, this.elements.playerNumbersGrid];

        grids.forEach(grid => {
            if (!grid) return;
            const cell = grid.querySelector(`[data-number="${number}"]`);
            if (cell) {
                cell.classList.add('called');
            }
        });
    },

    // =============================================
    // PLAYER FUNCTIONS
    // =============================================

    showJoinModal() {
        this.elements.joinModal.classList.add('active');
        this.elements.roomCodeInput.focus();

        // Check for room code in URL
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        if (roomCode) {
            this.elements.roomCodeInput.value = roomCode;
            this.joinRoom();
        }
    },

    hideJoinModal() {
        this.elements.joinModal.classList.remove('active');
        this.stopQRScanner();

        // Clear room code from URL so refresh doesn't trigger modal again
        const url = new URL(window.location);
        if (url.searchParams.has('room')) {
            url.searchParams.delete('room');
            window.history.replaceState({}, document.title, url.pathname + url.search);
        }
    },

    async joinRoom() {
        const roomCode = this.elements.roomCodeInput.value.trim().toUpperCase();

        if (roomCode.length !== 6) {
            this.showToast('Mã phòng phải có 6 ký tự', 'error');
            return;
        }

        try {
            this.showToast('Đang kết nối...', 'info');

            // Setup P2P callbacks
            // Setup P2P callbacks
            P2P.onConnected = () => {
                this.elements.connectionStatus.classList.add('connected');
                this.elements.connectionStatus.querySelector('span:last-child').textContent = 'Đã kết nối';
            };

            P2P.onWelcome = (data) => {
                this.playerTicket = data.ticket; // Host confirms the ticket (should be same)
                this.calledNumbers = new Set(data.gameState.calledNumbers);
                this.gameStarted = data.gameState.gameStarted;

                // Re-render to be safe (ensure state matches Host)
                this.renderPlayerTicket();

                // Sync state
                this.syncState(this.calledNumbers, this.gameStarted);

                this.hideJoinModal();
                this.showScreen('player-screen');
                this.showToast(`Chào mừng ${data.name || ''}!`, 'success');
            };

            P2P.onDisconnected = () => {
                this.elements.connectionStatus.classList.remove('connected');
                this.elements.connectionStatus.classList.add('disconnected');
                this.elements.connectionStatus.querySelector('span:last-child').textContent = 'Mất kết nối';
                this.showToast('Mất kết nối với chủ xướng', 'error');
            };

            P2P.onNumberDrawn = (number, text) => {
                // Ensure game is marked started
                if (!this.gameStarted) {
                    this.gameStarted = true;
                    this.elements.btnNewTicket.disabled = true;
                    this.elements.btnNewTicket.textContent = '🔒 Đã khoá vé';
                }

                this.calledNumbers.add(number);
                this.updateCurrentNumber(number);
                this.markNumberCalled(number);
                // DISABLED: Auto-marking (hardcore mode)
                // this.highlightTicketNumber(number);
                // this.checkWinCondition();

                // Play TTS for player too
                TTS.announceNumber(number);
            };

            // Connect to room
            const name = this.elements.playerNameInput.value.trim().substr(0, 20);

            // Generate ticket locally first
            this.playerTicket = this.createSheetData();

            // Render it immediately so user sees their sheet
            this.currentTheme = ['blue', 'green', 'red', 'purple', 'yellow'][Math.floor(Math.random() * 5)];
            this.markedNumbers.clear();
            this.renderPlayerTicket();

            // Connect and register ticket with Host
            await P2P.initPlayer(roomCode, name, this.playerTicket);

            // Wait for Welcome message to process game state...
            this.showToast('Đang đăng ký vé với chủ xướng...', 'info');

            // Generate ticket and show player screen
            // MOVED: Ticket generation now happens on Host side
            // this.generatePlayerTicket();

            // this.hideJoinModal(); -> Moved to onWelcome
            // this.showScreen('player-screen'); -> Moved to onWelcome
            // this.showToast('Đã tham gia phòng!', 'success'); -> Moved to onWelcome

            // Clear URL params
            window.history.replaceState({}, document.title, window.location.pathname);

        } catch (error) {
            console.error('Failed to join room:', error);

            // Distinguish between errors
            if (error.type === 'peer-unavailable') {
                this.showToast('Mã phòng không tồn tại. Vui lòng kiểm tra lại.', 'error');
            } else if (error.message && (error.message.includes('timeout') || error.message.includes('Could not connect'))) {
                this.showToast('Không thể kết nối. Nếu dùng 3G/4G, hãy thử chuyển sang cùng WiFi.', 'error');
            } else {
                this.showToast(`Lỗi kết nối: ${error.message || 'Không xác định'}`, 'error');
            }
        }
    },

    // Generate raw ticket data (pure logic)
    createSheetData() {
        // Standard lô tô ticket: 3 rows × 9 columns
        // Each row has 5 numbers and 4 blanks
        // Numbers in columns are grouped by tens (1-9, 10-19, etc.)

        // Generate 3 independent tickets for one sheet
        const sheet = [];
        for (let t = 0; t < 3; t++) {
            const ticket = [];

            // Hardcoded column ranges for bulletproof accuracy
            const COL_RANGES = [
                { start: 1, end: 9 },   // Col 0
                { start: 10, end: 19 }, // Col 1
                { start: 20, end: 29 }, // Col 2
                { start: 30, end: 39 }, // Col 3
                { start: 40, end: 49 }, // Col 4
                { start: 50, end: 59 }, // Col 5
                { start: 60, end: 69 }, // Col 6
                { start: 70, end: 79 }, // Col 7
                { start: 80, end: 90 }  // Col 8
            ];

            // Create column pools from ranges
            const columnPools = COL_RANGES.map(range => {
                const pool = [];
                for (let n = range.start; n <= range.end; n++) {
                    pool.push(n);
                }
                this.shuffleArray(pool);
                return pool;
            });

            // Generate 3 rows
            for (let row = 0; row < 3; row++) {
                const rowData = new Array(9).fill(null);
                const usedNumbers = new Set(); // Track numbers used in this row

                // Pick 5 random columns for this row to have numbers
                const filledColumns = [];
                // Simple strategy: try to fill
                while (filledColumns.length < 5) {
                    const col = Math.floor(Math.random() * 9);
                    if (!filledColumns.includes(col) && columnPools[col].length > 0) {
                        filledColumns.push(col);
                    }
                }

                // Sort columns index to keep order
                filledColumns.sort((a, b) => a - b);

                // Fill in the numbers
                filledColumns.forEach(col => {
                    const num = columnPools[col].pop();
                    rowData[col] = num;
                });

                ticket.push(rowData);
            }

            // Sort numbers in each column (standard Lô Tô rule)
            for (let col = 0; col < 9; col++) {
                const colNumbers = ticket.map(row => row[col]).filter(n => n !== null);
                colNumbers.sort((a, b) => a - b);
                let idx = 0;
                for (let row = 0; row < 3; row++) {
                    if (ticket[row][col] !== null) {
                        ticket[row][col] = colNumbers[idx++];
                    }
                }
            }

            sheet.push(ticket);
        }
        return sheet;
    },

    // Handle new player joining (Host Side)
    handlePlayerJoin(playerId, name, ticket) {
        // Validate ticket (basic check)
        if (!ticket || !Array.isArray(ticket) || ticket.length !== 3) {
            console.error('Invalid ticket from player', playerId);
            // Fallback: Generate one for them if theirs is garbage
            ticket = this.createSheetData();
        }

        // Store player data with their provided ticket
        this.players.set(playerId, {
            name: name,
            ticket: ticket,
            connected: true
        });

        // Return data for welcome message
        return { ticket, name };
    },

    // Handle ticket update from player (Host Side)
    handleTicketUpdate(playerId, ticket) {
        if (this.gameStarted) {
            console.warn(`Player ${playerId} tried to change ticket after game start.`);
            return;
        }

        if (this.players.has(playerId)) {
            // Validate ticket (basic check)
            if (!ticket || !Array.isArray(ticket) || ticket.length !== 3) {
                console.error('Invalid updated ticket from player', playerId);
                return;
            }

            const player = this.players.get(playerId);
            player.ticket = ticket;
            console.log(`Updated ticket for player ${player.name || playerId}`);
            // P2P.sendToast(playerId, 'Chủ xướng đã xác nhận vé mới'); // Optional feedback
        }
    },

    // Generate player's lô tô ticket (Requested by User)
    generatePlayerTicket() {
        if (this.gameStarted) {
            this.showToast('Không thể đổi vé khi ván đấu đang diễn ra!', 'error');
            return;
        }

        // Generate new ticket locally
        this.playerTicket = this.createSheetData();

        // Random Theme
        this.currentTheme = ['blue', 'green', 'red', 'purple', 'yellow'][Math.floor(Math.random() * 5)];

        this.markedNumbers.clear();
        this.renderPlayerTicket();

        // Send update to Host
        if (window.P2P) {
            P2P.sendTicketUpdate(this.playerTicket);
            this.showToast('Đã đổi vé mới!', 'success');
        }
    },

    // Render player ticket to DOM - Authentic Vietnamese Lô Tô Style
    renderPlayerTicket() {
        this.elements.playerTicket.innerHTML = '';

        // Create Sheet Container
        const sheet = document.createElement('div');
        sheet.className = `loto-sheet theme-${this.currentTheme}`;

        // Sheet Header (Single Brand Header)
        const sheetHeader = document.createElement('div');
        sheetHeader.className = 'loto-sheet-header';
        sheetHeader.textContent = '★ TÂN TÂN - TỐT NHẤT ★';
        sheet.appendChild(sheetHeader);

        // Render 3 tickets in the sheet
        this.playerTicket.forEach((ticketData, ticketIdx) => {
            // Create a card (one of the 3 sections)
            const card = document.createElement('div');
            card.className = 'loto-card';

            // Ticket grid
            const ticketGrid = document.createElement('div');
            ticketGrid.className = 'loto-ticket';

            // Render rows/cols
            ticketData.forEach((row, rowIdx) => {
                row.forEach((num, colIdx) => {
                    const cell = document.createElement('div');
                    cell.className = 'ticket-cell';

                    if (num === null) {
                        cell.classList.add('empty');
                    } else {
                        const numSpan = document.createElement('span');
                        numSpan.textContent = num;
                        cell.appendChild(numSpan);
                        // Store specific ticket index alongside row/num
                        cell.dataset.ticketIndex = ticketIdx;
                        cell.dataset.number = num;
                        cell.dataset.row = rowIdx;

                        if (this.markedNumbers.has(`${ticketIdx}-${num}`)) {
                            cell.classList.add('marked');
                        }

                        cell.addEventListener('click', () => this.toggleTicketMark(cell, ticketIdx, num));
                    }
                    ticketGrid.appendChild(cell);
                });
            });

            card.appendChild(ticketGrid);
            sheet.appendChild(card);
        });

        this.elements.playerTicket.appendChild(sheet);
    },

    // Toggle mark on ticket number
    toggleTicketMark(cell, ticketIdx, num) {
        const key = `${ticketIdx}-${num}`;

        if (this.markedNumbers.has(key)) {
            this.markedNumbers.delete(key);
            cell.classList.remove('marked');
        } else {
            this.markedNumbers.add(key);
            cell.classList.add('marked');
        }

        this.checkWinCondition();
    },

    // Check win condition (any row in any ticket)
    checkWinCondition() {
        let hasWin = false;
        let isWaiting = false;

        // Iterate through all 3 tickets
        for (let t = 0; t < 3; t++) {
            const ticketData = this.playerTicket[t];

            // Check rows in this ticket
            for (let r = 0; r < 3; r++) {
                const rowNumbers = ticketData[r].filter(n => n !== null);
                let markedCount = 0;

                rowNumbers.forEach(n => {
                    if (this.markedNumbers.has(`${t}-${n}`)) {
                        markedCount++;
                    }
                });

                // Get DOM row cells to apply visuals
                // Since we don't have row containers, we query by data attributes
                const rowCells = document.querySelectorAll(`[data-ticket-index="${t}"][data-row="${r}"]`);

                // Reset Row State first (Cleaner fix)
                rowCells.forEach(cell => {
                    cell.classList.remove('winning-row', 'waiting-row');
                });

                if (markedCount === 5) { // WIN (KINH)
                    hasWin = true;
                    rowCells.forEach(cell => cell.classList.add('winning-row'));
                } else if (markedCount === 4) { // WAIT (ĐỢI)
                    isWaiting = true;
                    rowCells.forEach(cell => cell.classList.add('waiting-row'));

                    // Announce Wait (Debounced to avoid spamming)
                    this.announceWaitState();
                }
            }
        }

        this.elements.btnLoto.disabled = !hasWin;
        return hasWin;
    },

    // Debounce wait announcement
    announceWaitState() {
        if (this._lastWaitAnnounce && Date.now() - this._lastWaitAnnounce < 5000) return;
        this._lastWaitAnnounce = Date.now();

        P2P.broadcastWait();
        this.showToast('Bạn đang Đợi!', 'info');
    },

    // Claim win
    claimLoto() {
        if (!this.checkWinCondition()) {
            this.showToast('Bạn chưa đủ điều kiện để Kinh!', 'error');
            return;
        }

        // Send full sheet data + marked numbers for verification?
        // For simplicity, host just trusts or we send the specific winning row.
        // P2P prototype: Send the ticket data.
        if (P2P.hostConnection) {
            P2P.claimWin(null); // No payload needed, host knows my ticket
        }

        this.showWin('Bạn');
    },

    // Verify Win (Host Side)
    verifyWin(playerId) {
        const player = this.players.get(playerId);
        if (!player || !player.ticket) return false;

        const sheetData = player.ticket;

        // Check if any row in the sheet is fully called
        for (const ticket of sheetData) {
            for (const row of ticket) {
                const rowNumbers = row.filter(n => n !== null);
                const allCalled = rowNumbers.every(n => this.calledNumbers.has(n));
                if (allCalled) return true;
            }
        }
        return false;
    },

    // Show win modal
    showWin(winnerName) {
        // Prevent duplicate win effects (race condition fix)
        // If modal is already active for this winner, do nothing
        if (this.elements.winModal.classList.contains('active')) {
            return;
        }

        this.elements.winnerName.textContent = `${winnerName} đã thắng!`;
        this.elements.winModal.classList.add('active');
        this.createConfetti();
        TTS.announceWinner(winnerName);
    },

    hideWinModal() {
        this.elements.winModal.classList.remove('active');
    },

    // Create confetti effect
    createConfetti() {
        const container = document.querySelector('.confetti');
        if (!container) return;

        container.innerHTML = '';
        const colors = ['#DC2626', '#F59E0B', '#FDE68A', '#22C55E', '#FFFFFF'];

        for (let i = 0; i < 100; i++) {
            const piece = document.createElement('div');
            piece.style.cssText = `
                position: absolute;
                width: ${Math.random() * 10 + 5}px;
                height: ${Math.random() * 10 + 5}px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                left: ${Math.random() * 100}%;
                top: -20px;
                border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
                animation: confettiFall ${Math.random() * 3 + 2}s linear forwards;
                animation-delay: ${Math.random() * 0.5}s;
            `;
            container.appendChild(piece);
        }

        // Add confetti animation if not exists
        if (!document.getElementById('confetti-style')) {
            const style = document.createElement('style');
            style.id = 'confetti-style';
            style.textContent = `
                @keyframes confettiFall {
                    to {
                        top: 100%;
                        transform: rotate(${Math.random() * 720}deg) translateX(${Math.random() * 200 - 100}px);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    },

    // Sync game state (for late joiners)
    syncState(calledNumbers, gameStarted) {
        this.calledNumbers = new Set(calledNumbers);
        this.gameStarted = gameStarted;

        // Update UI Controls
        if (this.gameStarted) {
            this.elements.btnNewTicket.disabled = true;
            this.elements.btnNewTicket.textContent = '🔒 Đã khoá vé';
        } else {
            this.elements.btnNewTicket.disabled = false;
            this.elements.btnNewTicket.textContent = '🔄 Đổi vé';
        }

        // Update grids
        calledNumbers.forEach(num => {
            this.markNumberCalled(num);
        });

        this.checkWinCondition();
    },

    // Reset game
    reset() {
        this.calledNumbers.clear();
        this.markedNumbers.clear();
        this.resetRemainingNumbers();
        this.currentNumber = null;
        this.gameStarted = false;

        // Reset UI
        document.querySelectorAll('.number-cell').forEach(cell => {
            cell.classList.remove('called');
        });

        this.elements.currentNumber.querySelector('span').textContent = '?';
        this.elements.numberText.textContent = 'Bấm để bắt đầu';
        this.elements.calledCount.textContent = '0';
        this.elements.playerCurrentNumber.querySelector('span').textContent = '?';

        // Reset player controls
        this.elements.btnNewTicket.disabled = false;
        this.elements.btnNewTicket.textContent = '🔄 Đổi vé';

        if (P2P.isHost) {
            this.elements.btnDraw.disabled = false;
            P2P.broadcastReset();
        }
    },

    // QR Scanner (basic implementation)
    // QR Scanner (Real implementation with jsQR)
    async startQRScanner() {
        if (this.elements.qrScannerContainer.classList.contains('active')) {
            this.stopQRScanner();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });

            this.elements.qrVideo.srcObject = stream;
            // Required to play the video for the canvas to capture frames
            this.elements.qrVideo.setAttribute('playsinline', true);
            this.elements.qrVideo.play();

            this.elements.qrScannerContainer.classList.add('active');
            this.elements.btnStartScan.textContent = 'Đang quét...';
            this.showToast('Đang tìm mã QR...', 'info');

            // Start scanning loop
            requestAnimationFrame(() => this.scanQRCode());

        } catch (error) {
            console.error('Camera error:', error);
            this.showToast('Không thể mở camera. Hãy đảm bảo bạn đã cấp quyền.', 'error');
        }
    },

    scanQRCode() {
        if (!this.elements.qrScannerContainer.classList.contains('active')) return;

        const video = this.elements.qrVideo;

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            // Create a temporary canvas to draw the video frame
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "dontInvert",
            });

            if (code) {
                console.log("QR Code found:", code.data);
                // Check if it's a URL with room code or just a code
                let roomCode = code.data;

                // If URL, extract 'room' param
                if (roomCode.includes('?room=')) {
                    try {
                        const url = new URL(roomCode);
                        const p = url.searchParams.get('room');
                        if (p) roomCode = p;
                    } catch (e) { /* ignore */ }
                }

                // If code looks like our 6-char code
                if (roomCode && roomCode.length === 6) {
                    this.elements.roomCodeInput.value = roomCode;
                    this.showToast(`Tìm thấy mã: ${roomCode}`, 'success');
                    this.stopQRScanner();

                    // Auto join after a brief moment
                    setTimeout(() => this.joinRoom(), 500);
                    return;
                }
            }
        }

        requestAnimationFrame(() => this.scanQRCode());
    },

    stopQRScanner() {
        if (this.elements.qrVideo.srcObject) {
            this.elements.qrVideo.srcObject.getTracks().forEach(track => track.stop());
            this.elements.qrVideo.srcObject = null;
        }
        this.elements.qrScannerContainer.classList.remove('active');
        this.elements.btnStartScan.textContent = 'Bật Camera';
    },

    // Toast notifications
    showToast(message, type = 'info') {
        const existingToasts = Array.from(this.elements.toastContainer.children);
        // Check for any duplicate, including those currently exiting
        const duplicate = existingToasts.find(t => t.textContent === message);

        if (duplicate) {
            // Cancel pending removal
            const oldTimeoutId = parseInt(duplicate.dataset.timeoutId, 10);
            if (oldTimeoutId) clearTimeout(oldTimeoutId);

            // Resurrection logic: if exiting, bring it back
            if (duplicate.classList.contains('exiting')) {
                duplicate.classList.remove('exiting');
                duplicate.classList.add('visible');
                // Note: The exit timers/listeners in exitToast will check for 'exiting' class
                // before removing, so removing the class here saves the element.
            }

            // Set new timeout
            const newTimeoutId = setTimeout(() => this.exitToast(duplicate), 3000);
            duplicate.dataset.timeoutId = newTimeoutId;
            return;
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type} entering`;
        toast.textContent = message;

        this.elements.toastContainer.appendChild(toast);

        // Remove entering class and add visible class after animation
        toast.addEventListener('animationend', () => {
            if (!toast.classList.contains('exiting')) {
                toast.classList.remove('entering');
                toast.classList.add('visible');
            }
        }, { once: true });

        // Auto remove after delay
        const timeoutId = setTimeout(() => this.exitToast(toast), 3000);
        toast.dataset.timeoutId = timeoutId;
    },

    // Separate exit function to avoid race conditions
    exitToast(toast) {
        // Guard: already exiting or removed
        if (!toast.isConnected || toast.classList.contains('exiting')) return;

        toast.classList.remove('visible');
        toast.classList.remove('entering'); // Ensure entering state is cleared
        toast.classList.add('exiting');

        // Handler that checks for the correct animation
        const handleAnimationEnd = (e) => {
            if (e.animationName === 'toastSlideOut') {
                // Only remove if it is STILL exiting (was not resurrected)
                if (toast.classList.contains('exiting')) {
                    toast.remove();
                }
                toast.removeEventListener('animationend', handleAnimationEnd);
            }
        };

        toast.addEventListener('animationend', handleAnimationEnd);

        // Fallback removal in case animation doesn't fire or is interrupted
        setTimeout(() => {
            if (toast.isConnected && toast.classList.contains('exiting')) {
                toast.removeEventListener('animationend', handleAnimationEnd);
                toast.remove();
            }
        }, 400);
    }
};

// Initialize game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    Game.init();

    // Check for room code in URL (auto-join)
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    if (roomCode) {
        Game.showJoinModal();
    }
});
window.Game = Game;
