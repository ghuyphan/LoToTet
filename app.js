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
    announcedRows: new Set(), // Track rows that have already announced "Waiting"

    // Anti-spam timers
    _lastWaitAnnounce: 0,
    _lastClaimTime: 0,

    // Game logic constraints
    isDrawing: false, // Lock to prevent rapid draw clicks
    isJoining: false, // Lock to prevent multiple join attempts
    isScanning: false, // Control QR scanner loop
    isMuted: false, // Player mute state
    autoDrawEnabled: false, // Host auto-draw state
    autoDrawTimer: null, // Auto-draw interval timer

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
        this.setupBeforeUnload();

        console.log('Lô Tô game initialized');
    },

    // Setup beforeunload warning to prevent accidental exits
    setupBeforeUnload() {
        window.addEventListener('beforeunload', (e) => {
            // Only warn if player is in an active game
            if (!P2P.isHost && P2P.hostConnection && this.gameStarted) {
                e.preventDefault();
                // Modern browsers ignore custom messages, but we still need to set returnValue
                e.returnValue = 'Bạn đang trong ván chơi. Bạn có chắc muốn thoát?';
                return e.returnValue;
            }
        });
    },

    // Check for existing session and attempt to reconnect
    async checkSessionAndReconnect() {
        if (!P2P.hasRestoredSession()) return false;

        const session = P2P.loadSession();
        if (!session) return false;

        this.showToast('Đang kết nối lại...', 'info');
        console.log('[Session] Attempting to restore session:', session.roomCode);

        try {
            // Restore local state from session
            this.playerTicket = session.playerTicket;
            this.currentTheme = ['blue', 'green', 'red', 'purple', 'yellow'][Math.floor(Math.random() * 5)];
            this.markedNumbers = new Set();
            this.announcedRows.clear();
            this.renderPlayerTicket();

            // Setup P2P callbacks (same as joinRoom)
            this._setupPlayerCallbacks();

            // Attempt reconnection
            await P2P.initPlayer(
                session.roomCode,
                session.playerName,
                session.playerTicket,
                true // isReconnect flag
            );

            this.showScreen('player-screen');
            this.showToast('Đã kết nối lại thành công!', 'success');
            return true;

        } catch (error) {
            console.error('[Session] Reconnection failed:', error);
            P2P.clearSession();
            this.showToast('Không thể kết nối lại. Vui lòng tham gia lại.', 'error');
            return false;
        }
    },

    // Setup P2P callbacks for player (extracted for reuse)
    _setupPlayerCallbacks() {
        P2P.onConnected = () => {
            this.elements.connectionStatus.classList.add('connected');
            this.elements.connectionStatus.classList.remove('disconnected');
            this.elements.connectionStatus.querySelector('span:last-child').textContent = 'Đã kết nối';
        };

        P2P.onReconnecting = () => {
            this.elements.connectionStatus.classList.remove('connected');
            this.elements.connectionStatus.classList.add('disconnected');
            this.elements.connectionStatus.querySelector('span:last-child').textContent = 'Đang kết nối lại...';
            this.showToast('Mất kết nối, đang thử lại...', 'warning');
        };

        P2P.onReconnected = () => {
            this.elements.connectionStatus.classList.add('connected');
            this.elements.connectionStatus.classList.remove('disconnected');
            this.elements.connectionStatus.querySelector('span:last-child').textContent = 'Đã kết nối';
            this.showToast('Đã kết nối lại!', 'success');
        };

        P2P.onWelcome = (data) => {
            this.playerTicket = data.ticket;
            this.calledNumbers = new Set(data.gameState.calledNumbers);
            this.gameStarted = data.gameState.gameStarted;

            this.renderPlayerTicket();
            this.syncState(this.calledNumbers, this.gameStarted);

            this.hideJoinModal();
            this.showScreen('player-screen');
            this.showToast(`Chào mừng ${data.name || ''}!`, 'success');

            // Save session after welcome
            P2P.saveSession();
        };

        P2P.onDisconnected = () => {
            this.elements.connectionStatus.classList.remove('connected');
            this.elements.connectionStatus.classList.add('disconnected');
            this.elements.connectionStatus.querySelector('span:last-child').textContent = 'Mất kết nối';
            this.showToast('Mất kết nối với chủ xướng', 'error');
        };

        P2P.onWinRejected = () => {
            this.showToast('Vé không hợp lệ! Hãy kiểm tra lại các số đã đánh.', 'error');
            this.elements.btnLoto.disabled = false;
            this.elements.btnLoto.textContent = '🎉 KINH!';
            if (this._verifyTimeout) {
                clearTimeout(this._verifyTimeout);
                this._verifyTimeout = null;
            }
        };

        P2P.onNumberDrawn = (number, text) => {
            if (!this.gameStarted) {
                this.gameStarted = true;
                this.elements.btnNewTicket.disabled = true;
                this.elements.btnNewTicket.innerHTML = '<i class="fa-solid fa-lock"></i> Đã khoá vé';
            }

            this.calledNumbers.add(number);
            this.updateCurrentNumber(number);
            this.markNumberCalled(number);
            this.checkWinCondition();
            TTS.announceNumber(number);

            // Update saved session with new game state
            P2P.saveSession();
        };
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
            playerNameInput: document.getElementById('player-name-input'),

            // Mute button (Player)
            btnMute: document.getElementById('btn-mute'),

            // Auto-draw (Host)
            autoDrawToggle: document.getElementById('auto-draw-toggle'),
            autoDrawInterval: document.getElementById('auto-draw-interval'),
            autoDrawSpeedContainer: document.getElementById('auto-draw-speed-container')
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

        // Mute button (Player)
        if (this.elements.btnMute) {
            this.elements.btnMute.addEventListener('click', () => this.toggleMute());
        }

        // Auto-draw toggle (Host)
        if (this.elements.autoDrawToggle) {
            this.elements.autoDrawToggle.addEventListener('change', () => this.toggleAutoDraw());
        }
        if (this.elements.autoDrawInterval) {
            this.elements.autoDrawInterval.addEventListener('change', () => {
                // Restart auto-draw with new interval if it's currently running
                if (this.autoDrawEnabled) {
                    this.stopAutoDraw();
                    this.startAutoDraw();
                }
            });
        }
    },

    // Toggle mute for player (for playing in same room)
    toggleMute() {
        this.isMuted = !this.isMuted;

        if (this.isMuted) {
            TTS.setVolume(0);
            this.elements.btnMute.classList.add('muted');
            this.elements.btnMute.querySelector('i').className = 'fa-solid fa-volume-xmark';
            this.showToast('Đã tắt âm thanh', 'info');
        } else {
            TTS.setVolume(1);
            this.elements.btnMute.classList.remove('muted');
            this.elements.btnMute.querySelector('i').className = 'fa-solid fa-volume-high';
            this.showToast('Đã bật âm thanh', 'info');
        }
    },

    // Toggle auto-draw for host
    toggleAutoDraw() {
        this.autoDrawEnabled = this.elements.autoDrawToggle.checked;

        if (this.autoDrawEnabled) {
            this.startAutoDraw();
            this.elements.autoDrawSpeedContainer.style.display = 'flex';
            this.showToast('Tự động xướng số đã bật', 'success');
        } else {
            this.stopAutoDraw();
            this.elements.autoDrawSpeedContainer.style.display = 'none';
            this.showToast('Tự động xướng số đã tắt', 'info');
        }
    },

    // Start auto-draw timer
    startAutoDraw() {
        const interval = parseInt(this.elements.autoDrawInterval.value, 10);
        this.elements.btnDraw.classList.add('auto-drawing');

        // Draw immediately first, then start interval
        this.drawNumber();

        this.autoDrawTimer = setInterval(() => {
            if (this.remainingNumbers.length > 0 && !this.isDrawing) {
                this.drawNumber();
            } else if (this.remainingNumbers.length === 0) {
                this.stopAutoDraw();
                this.elements.autoDrawToggle.checked = false;
                this.showToast('Đã hết số!', 'info');
            }
        }, interval);
    },

    // Stop auto-draw timer
    stopAutoDraw() {
        if (this.autoDrawTimer) {
            clearInterval(this.autoDrawTimer);
            this.autoDrawTimer = null;
        }
        this.elements.btnDraw.classList.remove('auto-drawing');
        this.autoDrawEnabled = false;
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
        // Stop auto-draw if active
        if (this.autoDrawTimer) {
            this.stopAutoDraw();
            if (this.elements.autoDrawToggle) {
                this.elements.autoDrawToggle.checked = false;
            }
        }
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
                this.elements.playerCount.textContent = this.players.size;
            };

            P2P.onWinClaim = (playerId) => {
                // Verify win and announce
                if (this.verifyWin(playerId)) {
                    const player = this.players.get(playerId);
                    const listName = player ? (player.name || 'Người chơi') : 'Người chơi';
                    P2P.confirmWin(listName);
                    this.showWin(listName);
                } else {
                    // Notify the player their win was rejected
                    console.warn(`Invalid win claim from ${playerId}`);
                    P2P.rejectWin(playerId);
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

        // Check for room code in URL (from external QR scan)
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        if (roomCode) {
            this.elements.roomCodeInput.value = roomCode;
            this.elements.playerNameInput.focus();
            this.showToast('Nhập tên của bạn rồi bấm Tham Gia!', 'info');
        } else {
            this.elements.roomCodeInput.focus();
            this.startQRScanner();
        }
    },

    hideJoinModal() {
        this.elements.joinModal.classList.remove('active');
        this.stopQRScanner();

        // Clear room code from URL
        const url = new URL(window.location);
        if (url.searchParams.has('room')) {
            url.searchParams.delete('room');
            window.history.replaceState({}, document.title, url.pathname + url.search);
        }
    },

    async joinRoom(code = null) {
        if (this.isJoining) return;

        const roomCode = (code || this.elements.roomCodeInput.value).trim().toUpperCase();

        if (roomCode.length !== 6) {
            this.showToast('Mã phòng phải có 6 ký tự', 'error');
            return;
        }

        try {
            this.isJoining = true;
            this.elements.btnJoinRoom.disabled = true;
            this.elements.btnJoinRoom.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang vào...';
            this.showToast('Đang kết nối...', 'info');

            // Use shared callback setup
            this._setupPlayerCallbacks();

            const name = this.elements.playerNameInput.value.trim().substr(0, 20);
            this.playerTicket = this.createSheetData();
            this.currentTheme = ['blue', 'green', 'red', 'purple', 'yellow'][Math.floor(Math.random() * 5)];
            this.markedNumbers.clear();
            this.announcedRows.clear();
            this.renderPlayerTicket();

            await P2P.initPlayer(roomCode, name, this.playerTicket);

            this.showToast('Đang đăng ký vé với chủ xướng...', 'info');
            window.history.replaceState({}, document.title, window.location.pathname);

        } catch (error) {
            console.error('Failed to join room:', error);
            if (error.type === 'peer-unavailable') {
                this.showToast('Mã phòng không tồn tại. Vui lòng kiểm tra lại.', 'error');
            } else if (error.message && (error.message.includes('timeout') || error.message.includes('Could not connect'))) {
                this.showToast('Không thể kết nối. Nếu dùng 3G/4G, hãy thử chuyển sang cùng WiFi.', 'error');
            } else {
                this.showToast(`Lỗi kết nối: ${error.message || 'Không xác định'}`, 'error');
            }
        } finally {
            this.isJoining = false;
            this.elements.btnJoinRoom.disabled = false;
            this.elements.btnJoinRoom.innerHTML = '<i class="fas fa-sign-in-alt"></i> Tham Gia';
        }
    },

    // =============================================
    // AUTHENTIC LÔ TÔ TICKET GENERATOR
    // =============================================

    createSheetData() {
        // Standard Column Ranges for Vietnamese Lô Tô (1-90)
        const COL_RANGES = [
            { start: 1, end: 9 },   // Col 1
            { start: 10, end: 19 }, // Col 2
            { start: 20, end: 29 }, // Col 3
            { start: 30, end: 39 }, // Col 4
            { start: 40, end: 49 }, // Col 5
            { start: 50, end: 59 }, // Col 6
            { start: 60, end: 69 }, // Col 7
            { start: 70, end: 79 }, // Col 8
            { start: 80, end: 90 }  // Col 9
        ];

        // === SHARED POOL INITIALIZATION ===
        // Create a pool of all available numbers for each column (1-90)
        // We clone and shuffle this once per SHEET so tickets don't overlap.
        const colPools = COL_RANGES.map(range => {
            const pool = [];
            for (let n = range.start; n <= range.end; n++) pool.push(n);
            return this.shuffleArray(pool);
        });

        const sheet = [];

        // Generate 3 tickets using the SHARED pool
        for (let t = 0; t < 3; t++) {
            let ticket;
            let isValid = false;
            let attempts = 0;

            // Retry loop (cloning the pool state for retries isn't perfect but simple retries usually work for layout)
            // Note: If a retry fails after consuming numbers, we might run out. 
            // Better strategy: Pass a COPY of the current pool state for the *attempt*, 
            // and only commit the draw if successful. 
            // However, implementing "commit" logic is complex. 
            // Simplified approach: Since layout solving is separated from number drawing, 
            // we can solve layout first, then draw numbers. `generateSingleTicket` does both.
            // Let's modify `generateSingleTicket` to take the pool.

            while (!isValid && attempts < 50) {
                try {
                    // Critical: We must rely on the function to modify the pool IN PLACE 
                    // only if it succeeds. But `generateSingleTicket` throws if it fails layout.
                    // To avoid losing numbers on failed layout attempts, we pass a momentary clone?
                    // Actually, `solveLayout` (step 2) is the one that fails. 
                    // Step 3 (drawing numbers) happens AFTER layout is solved.
                    // So it is safe to pass the real pool. The pool is only touched in Step 3.

                    ticket = this.generateSingleTicket(COL_RANGES, colPools);
                    isValid = true;
                } catch (e) {
                    attempts++;
                    // If it failed in Step 2 (layout), pool wasn't touched. Retry is safe.
                    // If it failed in Step 3? current code doesn't throw in step 3.
                }
            }
            // Fallback (extremely rare)
            if (!isValid) {
                console.error("Failed to generate valid ticket, using fallback");
                ticket = Array(3).fill(null).map(() => Array(9).fill(null));
            }
            sheet.push(ticket);
        }
        return sheet;
    },

    generateSingleTicket(ranges, colPools = null) {
        // Initialize 3 rows x 9 cols with null
        let grid = Array(3).fill(null).map(() => Array(9).fill(null));
        let colCounts = Array(9).fill(0);

        // STEP 1: Ensure every column has at least 1 number
        // We have 15 numbers total. 9 columns.
        // Assign 1 slot to every column first.
        for (let i = 0; i < 9; i++) {
            colCounts[i]++;
        }

        // Distribute the remaining 6 numbers randomly across columns
        // Max numbers per column is 3 (since there are 3 rows)
        let extra = 6;
        while (extra > 0) {
            let col = Math.floor(Math.random() * 9);
            // Check if pool has enough numbers (if pool is provided)
            const poolSize = colPools ? colPools[col].length : 999;

            // Constraint: Max 3 per col AND we must have enough numbers left in pool
            if (colCounts[col] < 3 && colCounts[col] < poolSize) {
                colCounts[col]++;
                extra--;
            }
        }

        // STEP 2: Assign numbers to Rows to ensure EXACTLY 5 numbers per row.
        // This is a backtracking problem: Fit 'colCounts' into 3 rows of 5.
        const layout = this.solveLayout(colCounts);
        if (!layout) throw new Error("Could not solve layout");

        // STEP 3: Fill the layout with actual random numbers
        for (let c = 0; c < 9; c++) {
            const count = colCounts[c];

            let picks;
            if (colPools) {
                // Use the shared pool!
                // We MUST splice to remove them from future availability
                picks = colPools[c].splice(0, count);
            } else {
                // Legacy / Fallback independent mode
                const range = ranges[c];
                const pool = [];
                for (let n = range.start; n <= range.end; n++) pool.push(n);
                this.shuffleArray(pool);
                picks = pool.slice(0, count);
            }

            // Sort them (Standard Rule: Ascending)
            picks.sort((a, b) => a - b);

            // Place them into the reserved slots in the grid
            let pickIdx = 0;
            for (let r = 0; r < 3; r++) {
                if (layout[r][c] === 1) {
                    grid[r][c] = picks[pickIdx++];
                }
            }
        }

        return grid;
    },

    // Backtracking solver to fit column counts into 3 rows of 5
    solveLayout(colCounts) {
        const rows = [0, 0, 0]; // Current fill count for each row (max 5)
        const grid = Array(3).fill(null).map(() => Array(9).fill(0));

        if (this.fillColumn(0, colCounts, rows, grid)) {
            return grid;
        }
        return null;
    },

    fillColumn(colIdx, colCounts, rows, grid) {
        if (colIdx === 9) {
            // Success if all rows have exactly 5
            return rows[0] === 5 && rows[1] === 5 && rows[2] === 5;
        }

        const count = colCounts[colIdx];

        // Options for placing 'count' items in 3 rows
        let options = [];
        if (count === 3) options = [[1, 1, 1]];
        else if (count === 2) options = [[1, 1, 0], [1, 0, 1], [0, 1, 1]];
        else if (count === 1) options = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        else options = [[0, 0, 0]];

        this.shuffleArray(options); // Shuffle to keep tickets looking random

        for (let opt of options) {
            // Check if this option fits in the row limits (max 5 per row)
            if (rows[0] + opt[0] <= 5 && rows[1] + opt[1] <= 5 && rows[2] + opt[2] <= 5) {
                // Apply
                rows[0] += opt[0];
                rows[1] += opt[1];
                rows[2] += opt[2];
                grid[0][colIdx] = opt[0];
                grid[1][colIdx] = opt[1];
                grid[2][colIdx] = opt[2];

                // Recurse
                if (this.fillColumn(colIdx + 1, colCounts, rows, grid)) return true;

                // Backtrack
                rows[0] -= opt[0];
                rows[1] -= opt[1];
                rows[2] -= opt[2];
            }
        }
        return false;
    },

    // Handle new player joining (Host Side)
    handlePlayerJoin(playerId, name, ticket) {
        if (!ticket || !Array.isArray(ticket) || ticket.length !== 3) {
            ticket = this.createSheetData();
        }
        this.players.set(playerId, {
            name: name,
            ticket: ticket,
            connected: true
        });
        return { ticket, name };
    },

    // Handle ticket update from player (Host Side)
    handleTicketUpdate(playerId, ticket) {
        if (this.gameStarted) return;
        if (this.players.has(playerId)) {
            if (!ticket || !Array.isArray(ticket) || ticket.length !== 3) return;
            const player = this.players.get(playerId);
            player.ticket = ticket;
        }
    },

    // Generate player's lô tô ticket
    generatePlayerTicket() {
        if (this.gameStarted) {
            this.showToast('Không thể đổi vé khi ván đấu đang diễn ra!', 'error');
            return;
        }

        this.playerTicket = this.createSheetData();
        this.currentTheme = ['blue', 'green', 'red', 'purple', 'yellow'][Math.floor(Math.random() * 5)];
        this.markedNumbers.clear();
        this.announcedRows.clear();
        this.renderPlayerTicket();

        if (window.P2P) {
            P2P.sendTicketUpdate(this.playerTicket);
            this.showToast('Đã đổi vé mới!', 'success');
        }
    },

    // Render player ticket to DOM - Authentic Vietnamese Lô Tô Style
    renderPlayerTicket() {
        this.elements.playerTicket.innerHTML = '';

        const sheet = document.createElement('div');
        sheet.className = `loto-sheet theme-${this.currentTheme}`;

        const sheetHeader = document.createElement('div');
        sheetHeader.className = 'loto-sheet-header';
        sheetHeader.textContent = '★ TÂN TÂN - TỐT NHẤT ★';
        sheet.appendChild(sheetHeader);

        this.playerTicket.forEach((ticketData, ticketIdx) => {
            const card = document.createElement('div');
            card.className = 'loto-card';

            const ticketGrid = document.createElement('div');
            ticketGrid.className = 'loto-ticket';

            ticketData.forEach((row, rowIdx) => {
                row.forEach((num, colIdx) => {
                    const cell = document.createElement('div');
                    cell.className = 'ticket-cell';

                    // === FIX: Apply dataset to ALL cells (even empty ones) ===
                    cell.dataset.ticketIndex = ticketIdx;
                    cell.dataset.row = rowIdx;

                    if (num === null) {
                        cell.classList.add('empty');
                    } else {
                        const numSpan = document.createElement('span');
                        numSpan.textContent = num;
                        cell.appendChild(numSpan);

                        cell.dataset.number = num;

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
        this.checkWinCondition();
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

        for (let t = 0; t < 3; t++) {
            const ticketData = this.playerTicket[t];
            for (let r = 0; r < 3; r++) {
                const rowNumbers = ticketData[r].filter(n => n !== null);
                let validMarkedCount = 0;

                rowNumbers.forEach(n => {
                    const cell = document.querySelector(`[data-ticket-index="${t}"][data-number="${n}"]`);
                    const isMarked = this.markedNumbers.has(`${t}-${n}`);
                    const isCalled = this.calledNumbers.has(n);

                    if (cell) {
                        if (isMarked && !isCalled) {
                            cell.classList.add('invalid-mark');
                        } else {
                            cell.classList.remove('invalid-mark');
                        }
                    }

                    if (isMarked && isCalled) {
                        validMarkedCount++;
                    }
                });

                // Get DOM row cells (includes empty ones now)
                const rowCells = document.querySelectorAll(`[data-ticket-index="${t}"][data-row="${r}"]`);
                rowCells.forEach(cell => {
                    cell.classList.remove('winning-row', 'waiting-row');
                });

                const rowId = `${t}-${r}`;

                if (validMarkedCount === 5) {
                    hasWin = true;
                    rowCells.forEach(cell => cell.classList.add('winning-row'));
                    this.announcedRows.delete(rowId);
                } else if (validMarkedCount === 4) {
                    isWaiting = true;
                    rowCells.forEach(cell => cell.classList.add('waiting-row'));
                    if (!this.announcedRows.has(rowId)) {
                        this.announceWaitState();
                        this.announcedRows.add(rowId);
                    }
                }
            }
        }

        this.elements.btnLoto.disabled = !hasWin;
        if (!hasWin) this.elements.btnLoto.textContent = '🎉 KINH!';

        return hasWin;
    },

    announceWaitState() {
        if (this._lastWaitAnnounce && Date.now() - this._lastWaitAnnounce < 5000) return;
        this._lastWaitAnnounce = Date.now();
        P2P.broadcastWait();
        this.showToast('Bạn đang Đợi!', 'info');
    },

    claimLoto() {
        if (!this.checkWinCondition()) {
            this.showToast('Bạn chưa đủ điều kiện để Kinh!', 'error');
            return;
        }

        if (this._lastClaimTime && Date.now() - this._lastClaimTime < 10000) {
            this.showToast('Vui lòng đợi 10 giây trước khi Kinh lại!', 'warning');
            return;
        }
        this._lastClaimTime = Date.now();

        if (P2P.hostConnection) {
            this.showToast('Đang gửi yêu cầu kiểm vé...', 'info');
            this.elements.btnLoto.disabled = true;
            this.elements.btnLoto.textContent = '⏳ Đang kiểm vé...';
            P2P.claimWin();

            this._verifyTimeout = setTimeout(() => {
                if (this.elements.btnLoto.textContent === '⏳ Đang kiểm vé...') {
                    this.showToast('Không nhận được phản hồi từ chủ xướng. Thử lại.', 'warning');
                    this.elements.btnLoto.disabled = false;
                    this.elements.btnLoto.textContent = '🎉 KINH!';
                }
            }, 15000);
        }
    },

    verifyWin(playerId) {
        const player = this.players.get(playerId);
        if (!player || !player.ticket) return false;

        const sheetData = player.ticket;
        for (const ticket of sheetData) {
            for (const row of ticket) {
                const rowNumbers = row.filter(n => n !== null);
                const allCalled = rowNumbers.every(n => this.calledNumbers.has(n));
                if (allCalled) return true;
            }
        }
        return false;
    },

    showWin(winnerName) {
        if (this.elements.winModal.classList.contains('active')) return;
        this.elements.winnerName.textContent = `${winnerName} đã thắng!`;
        this.elements.winModal.classList.add('active');
        this.createConfetti();
        TTS.announceWinner(winnerName);
    },

    hideWinModal() {
        this.elements.winModal.classList.remove('active');
    },

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

    syncState(calledNumbers, gameStarted) {
        this.calledNumbers = new Set(calledNumbers);
        this.gameStarted = gameStarted;

        if (this.gameStarted) {
            this.elements.btnNewTicket.disabled = true;
            this.elements.btnNewTicket.innerHTML = '<i class="fa-solid fa-lock"></i> Đã khoá vé';
        } else {
            this.elements.btnNewTicket.disabled = false;
            this.elements.btnNewTicket.innerHTML = '<i class="fa-solid fa-rotate"></i> Đổi vé';
        }

        calledNumbers.forEach(num => {
            this.markNumberCalled(num);
        });

        this.checkWinCondition();
    },

    reset() {
        this.calledNumbers.clear();
        this.markedNumbers.clear();
        this.announcedRows.clear();
        this.resetRemainingNumbers();
        this.currentNumber = null;
        this.gameStarted = false;

        document.querySelectorAll('.number-cell').forEach(cell => {
            cell.classList.remove('called');
        });

        this.elements.currentNumber.querySelector('span').textContent = '?';
        this.elements.numberText.textContent = 'Bấm để bắt đầu';
        this.elements.calledCount.textContent = '0';
        this.elements.playerCurrentNumber.querySelector('span').textContent = '?';

        this.elements.btnNewTicket.disabled = false;
        this.elements.btnNewTicket.innerHTML = '<i class="fa-solid fa-rotate"></i> Đổi vé';

        if (P2P.isHost) {
            this.elements.btnDraw.disabled = false;
            P2P.broadcastReset();
        }
    },

    async startQRScanner() {
        if (this.isScanning) return;
        this.stopQRScanner();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });

            this.elements.qrVideo.srcObject = stream;
            this.elements.qrVideo.setAttribute('playsinline', true);
            this.elements.qrVideo.play();

            this.elements.qrScannerContainer.classList.add('active');
            this.elements.btnStartScan.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang quét...';
            this.elements.btnStartScan.disabled = true;

            this.isScanning = true;
            requestAnimationFrame(() => this.scanQRCode());

        } catch (error) {
            console.error('Camera error:', error);
            this.elements.btnStartScan.innerHTML = '<i class="fa-solid fa-camera"></i> Bật Camera';
            this.elements.btnStartScan.disabled = false;
            this.isScanning = false;
        }
    },

    scanQRCode() {
        if (!this.isScanning) return;
        const video = this.elements.qrVideo;

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
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
                let roomCode = code.data;
                if (roomCode.includes('?room=')) {
                    try {
                        const url = new URL(roomCode);
                        const p = url.searchParams.get('room');
                        if (p) roomCode = p;
                    } catch (e) { /* ignore */ }
                }

                if (roomCode && roomCode.length === 6) {
                    this.isScanning = false;
                    this.stopQRScanner();
                    if (navigator.vibrate) navigator.vibrate(200);

                    this.elements.roomCodeInput.value = roomCode;
                    this.showToast(`Tìm thấy mã: ${roomCode}`, 'success');
                    this.joinRoom(roomCode);
                    return;
                }
            }
        }

        if (this.isScanning) {
            requestAnimationFrame(() => this.scanQRCode());
        }
    },

    stopQRScanner() {
        this.isScanning = false;
        if (this.elements.qrVideo.srcObject) {
            this.elements.qrVideo.srcObject.getTracks().forEach(track => track.stop());
            this.elements.qrVideo.srcObject = null;
        }
        this.elements.qrScannerContainer.classList.remove('active');
        this.elements.btnStartScan.innerHTML = '<i class="fa-solid fa-camera"></i> Bật Camera';
        this.elements.btnStartScan.disabled = false;
    },

    showToast(message, type = 'info') {
        const existingToasts = Array.from(this.elements.toastContainer.children);
        const duplicate = existingToasts.find(t => t.textContent === message);

        if (duplicate) {
            const oldTimeoutId = parseInt(duplicate.dataset.timeoutId, 10);
            if (oldTimeoutId) clearTimeout(oldTimeoutId);

            if (duplicate.classList.contains('exiting')) {
                duplicate.classList.remove('exiting');
                duplicate.classList.add('visible');
            }

            const newTimeoutId = setTimeout(() => this.exitToast(duplicate), 3000);
            duplicate.dataset.timeoutId = newTimeoutId;
            return;
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type} entering`;
        toast.textContent = message;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');

        this.elements.toastContainer.appendChild(toast);

        toast.addEventListener('animationend', () => {
            if (!toast.classList.contains('exiting')) {
                toast.classList.remove('entering');
                toast.classList.add('visible');
            }
        }, { once: true });

        const timeoutId = setTimeout(() => this.exitToast(toast), 3000);
        toast.dataset.timeoutId = timeoutId;
    },

    exitToast(toast) {
        if (!toast.isConnected || toast.classList.contains('exiting')) return;

        toast.classList.remove('visible');
        toast.classList.remove('entering');
        toast.classList.add('exiting');

        const handleAnimationEnd = (e) => {
            if (e.animationName === 'toastSlideOut') {
                if (toast.classList.contains('exiting')) {
                    toast.remove();
                }
                toast.removeEventListener('animationend', handleAnimationEnd);
            }
        };

        toast.addEventListener('animationend', handleAnimationEnd);

        setTimeout(() => {
            if (toast.isConnected && toast.classList.contains('exiting')) {
                toast.removeEventListener('animationend', handleAnimationEnd);
                toast.remove();
            }
        }, 400);
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    Game.init();

    // Check for existing session to restore (e.g., after page refresh)
    const hasSession = await Game.checkSessionAndReconnect();

    // Only show join modal if no session was restored
    if (!hasSession) {
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        if (roomCode) {
            Game.showJoinModal();
        }
    }
});
window.Game = Game;