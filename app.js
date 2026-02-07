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
    markedNumbers: new Set(),
    announcedRows: new Set(),
    waitingPlayers: new Set(),
    playerSheets: [],

    // Anti-spam timers
    _lastWaitAnnounce: 0,
    _lastClaimTime: 0,

    // Game logic constraints
    isDrawing: false,
    isJoining: false,
    isScanning: false,
    isMuted: false,
    autoDrawEnabled: false,
    autoDrawTimer: null,
    wakeLock: null,

    // User Preferences (Persisted)
    isDarkMode: false,
    preferredTheme: 'blue',
    sfxEnabled: true,
    ttsEnabled: true,

    // DOM Elements cache
    elements: {},

    // Initialize game
    init() {
        this.shoutPresets = [
            'Cay thế! 🌶️', 'Nhanh lên! ⏱️', 'Sắp KINH! 😱',
            'Hù! 👻', 'Số 35 đâu? 🐐', 'Alo alo 📞',
            'Run quá 🥶', 'Đen thôi 🌚', 'Nhà cái lừa! 🤥',
            'Chờ mãi! 💤', 'Ra số đẹp đi! ✨', 'Mãi keo 🤞'
        ];

        this.cacheElements();
        this.setupEventListeners();
        this.generateNumbersGrid('numbers-grid');
        this.generateNumbersGrid('player-numbers-grid', true);
        this.resetRemainingNumbers();
        this.loadSettings();
        this.initShoutMenu();
        this.setupTTSControls();
        this.setupBeforeUnload();

        if (window.AudioManager) AudioManager.init();
        console.log('Lô Tô game initialized');
    },

    setupBeforeUnload() {
        window.addEventListener('beforeunload', (e) => {
            const isPlayerActive = !P2P.isHost && P2P.hostConnection && this.gameStarted;
            const isHostActive = P2P.isHost && (this.players.size > 0 || this.gameStarted || this.calledNumbers.size > 0);

            if (isPlayerActive || isHostActive) {
                e.preventDefault();
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
            // CHANGED: Fixed data structure logic
            if (session.playerSheets) {
                this.playerSheets = session.playerSheets;
            } else if (session.playerTicket) {
                // Heuristic to check if it's already an array of sheets or a single ticket
                // Sheet array depth: 3 ( [ [ [row] ] ] )
                // Single ticket depth: 2 ( [ [row] ] )
                const isArrayOfSheets = Array.isArray(session.playerTicket)
                    && Array.isArray(session.playerTicket[0])
                    && Array.isArray(session.playerTicket[0][0]);

                this.playerSheets = isArrayOfSheets ? session.playerTicket : [session.playerTicket];
            } else {
                this.playerSheets = [];
            }

            if (!Array.isArray(this.playerSheets) || this.playerSheets.length === 0) {
                console.warn('[Session] Invalid player sheets, clearing session.');
                P2P.clearSession();
                return false;
            }

            this.currentTheme = this.preferredTheme || 'blue';
            this.markedNumbers = new Set();
            this.announcedRows.clear();
            this.renderPlayerTicket();

            this._setupPlayerCallbacks();

            // CHANGED: Pass previous peerId to link session
            await P2P.initPlayer(
                session.roomCode,
                session.playerName,
                this.playerSheets,
                session.peerId // Pass old ID
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
            if (data.sheets) {
                this.playerSheets = data.sheets;
            } else if (data.ticket) {
                // Legacy fallback
                this.playerSheets = [data.ticket];
            }

            if (!this.playerSheets || !Array.isArray(this.playerSheets)) {
                this.playerSheets = [];
            }

            this.calledNumbers = new Set(data.gameState.calledNumbers);
            this.gameStarted = data.gameState.gameStarted;

            this.renderPlayerTicket();
            this.syncState(this.calledNumbers, this.gameStarted);

            this.hideJoinModal();
            this.showScreen('player-screen');
            this.showToast(`Chào mừng ${data.name || ''}!`, 'success');

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

        P2P.onShout = (text, senderId) => {
            this.renderDanmaku(text, false);
        };

        P2P.onNumberDrawn = (number, text) => {
            if (!this.gameStarted) {
                this.gameStarted = true;
                this.elements.btnNewTicket.disabled = true;
                this.elements.btnNewTicket.title = "Đã khoá vé (Ván đang chơi)";
                this.elements.btnAddSheet.disabled = true;
                this.elements.btnAddSheet.title = "Không thể thêm tờ khi đang chơi";
            }

            this.calledNumbers.add(number);
            this.updateCurrentNumber(number);
            this.markNumberCalled(number);
            this.checkWinCondition();

            if (this.ttsEnabled) {
                TTS.announceNumber(number);
            }
            P2P.saveSession();
        };

        P2P.onEmote = (emoji, senderId) => {
            this.renderEmote(emoji);
        };
    },

    cacheElements() {
        this.elements = {
            homeScreen: document.getElementById('home-screen'),
            hostScreen: document.getElementById('host-screen'),
            playerScreen: document.getElementById('player-screen'),
            btnHost: document.getElementById('btn-host'),
            btnJoin: document.getElementById('btn-join'),
            btnBackHost: document.getElementById('btn-back-host'),
            roomCodeDisplay: document.getElementById('room-code-display'),
            btnCopyCode: document.getElementById('btn-copy-code'),
            qrCode: document.getElementById('qrcode'),
            playerCount: document.getElementById('player-count'),
            currentNumber: document.getElementById('current-number'),
            numberText: document.getElementById('number-text'),
            btnDraw: document.getElementById('btn-draw'),
            calledCount: document.getElementById('called-count'),
            numbersGrid: document.getElementById('numbers-grid'),
            btnBackPlayer: document.getElementById('btn-back-player'),
            connectionStatus: document.getElementById('connection-status'),
            playerCurrentNumber: document.getElementById('player-current-number'),
            playerTicket: document.getElementById('player-ticket'),
            btnNewTicket: document.getElementById('btn-new-ticket'),
            btnAddSheet: document.getElementById('btn-add-sheet'),
            paginationDots: document.getElementById('pagination-dots'),
            btnLoto: document.getElementById('btn-loto'),
            playerNumbersGrid: document.getElementById('player-numbers-grid'),
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
            ttsSpeed: document.getElementById('tts-speed'),
            speedValue: document.getElementById('speed-value'),
            ttsVolume: document.getElementById('tts-volume'),
            volumeValue: document.getElementById('volume-value'),
            toastContainer: document.getElementById('toast-container'),
            playerNameInput: document.getElementById('player-name-input'),
            autoDrawToggle: document.getElementById('auto-draw-toggle'),
            autoDrawInterval: document.getElementById('auto-draw-interval'),
            autoDrawSpeedContainer: document.getElementById('auto-draw-speed-container'),
            btnOpenShout: document.getElementById('btn-open-shout'),
            btnCloseShout: document.getElementById('btn-close-shout'),
            shoutModal: document.getElementById('shout-modal'),
            shoutGrid: document.getElementById('shout-grid'),
            danmakuContainer: document.getElementById('danmaku-container'),
            settingsModal: document.getElementById('settings-modal'),
            btnCloseSettings: document.getElementById('btn-close-settings'),
            btnSettingsHome: document.getElementById('btn-settings-home'),
            btnSettingsHost: document.getElementById('btn-settings-host'),
            btnSettingsPlayer: document.getElementById('btn-settings-player'),
            settingDarkMode: document.getElementById('setting-dark-mode'),
            settingThemeContainer: document.getElementById('setting-theme-container'),
            settingSfx: document.getElementById('setting-sfx'),
            settingTts: document.getElementById('setting-tts'),
            settingOnlineTts: document.getElementById('setting-online-tts'),
            btnResetApp: document.getElementById('btn-reset-app'),
            emoteBar: document.getElementById('emote-bar'),
            emoteContainer: document.getElementById('emote-container'),
            waitingListSection: document.getElementById('waiting-list-section'),
            waitingList: document.getElementById('waiting-list'),
            btnViewPlayers: document.getElementById('btn-view-players'),
            playerListModal: document.getElementById('player-list-modal'),
            btnClosePlayerList: document.getElementById('btn-close-player-list'),
            detailsPlayerList: document.getElementById('details-player-list'),
            restoreModal: document.getElementById('restore-modal'),
            btnConfirmRestore: document.getElementById('btn-confirm-restore'),
            btnRejectRestore: document.getElementById('btn-reject-restore'),
            restoreRoomCode: document.getElementById('restore-room-code')
        };
    },

    players: new Map(),

    setupEventListeners() {
        this.elements.btnHost.addEventListener('click', () => this.startAsHost());
        this.elements.btnJoin.addEventListener('click', () => this.showJoinModal());
        this.elements.btnBackHost.addEventListener('click', () => this.goHome());
        this.elements.btnCopyCode.addEventListener('click', () => this.copyRoomCode());
        this.elements.btnDraw.addEventListener('click', () => this.drawNumber());
        this.elements.btnBackPlayer.addEventListener('click', () => this.goHome());
        this.elements.btnNewTicket.addEventListener('click', () => this.generatePlayerTicket());
        if (this.elements.btnAddSheet) this.elements.btnAddSheet.addEventListener('click', () => this.addSheet(true));
        this.elements.btnLoto.addEventListener('click', () => this.claimLoto());
        this.elements.btnCloseJoin.addEventListener('click', () => this.hideJoinModal());
        this.elements.btnJoinRoom.addEventListener('click', () => this.joinRoom());
        this.elements.roomCodeInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        this.elements.btnStartScan.addEventListener('click', () => this.startQRScanner());
        this.elements.btnCloseWin.addEventListener('click', () => this.hideWinModal());
        this.elements.joinModal.addEventListener('click', (e) => {
            if (e.target === this.elements.joinModal) this.hideJoinModal();
        });
        this.elements.winModal.addEventListener('click', (e) => {
            if (e.target === this.elements.winModal) this.hideWinModal();
        });

        const openSettings = () => this.openSettings();
        if (this.elements.btnSettingsHome) this.elements.btnSettingsHome.addEventListener('click', openSettings);
        if (this.elements.btnSettingsHost) this.elements.btnSettingsHost.addEventListener('click', openSettings);
        if (this.elements.btnSettingsPlayer) this.elements.btnSettingsPlayer.addEventListener('click', openSettings);

        if (this.elements.btnCloseSettings) this.elements.btnCloseSettings.addEventListener('click', () => this.closeSettings());
        if (this.elements.settingsModal) {
            this.elements.settingsModal.addEventListener('click', (e) => {
                if (e.target === this.elements.settingsModal) this.closeSettings();
            });
        }
        if (this.elements.settingDarkMode) this.elements.settingDarkMode.addEventListener('change', (e) => this.toggleDarkMode(e.target.checked));
        if (this.elements.settingSfx) {
            this.elements.settingSfx.addEventListener('change', (e) => {
                this.sfxEnabled = e.target.checked;
                if (window.AudioManager) AudioManager.enabled = this.sfxEnabled;
                this.saveSettings();
            });
        }
        if (this.elements.settingTts) {
            this.elements.settingTts.addEventListener('change', (e) => {
                this.ttsEnabled = e.target.checked;
                this.saveSettings();
            });
        }
        if (this.elements.settingOnlineTts) {
            this.elements.settingOnlineTts.addEventListener('change', (e) => {
                TTS.setUseOnlineTTS(e.target.checked);
            });
        }
        if (this.elements.btnResetApp) this.elements.btnResetApp.addEventListener('click', () => this.resetApp());
        if (this.elements.settingThemeContainer) {
            this.elements.settingThemeContainer.querySelectorAll('.theme-swatch').forEach(swatch => {
                swatch.addEventListener('click', () => {
                    const theme = swatch.dataset.theme.replace('theme-', '');
                    this.setTheme(theme);
                });
            });
        }
        if (this.elements.autoDrawToggle) this.elements.autoDrawToggle.addEventListener('change', () => this.toggleAutoDraw());
        if (this.elements.autoDrawInterval) {
            this.elements.autoDrawInterval.addEventListener('change', () => {
                if (this.autoDrawEnabled) {
                    this.stopAutoDraw();
                    this.startAutoDraw();
                }
            });
        }
        document.querySelectorAll('.btn-emote').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const emoji = e.target.dataset.emoji || e.target.textContent;
                this.sendEmote(emoji);
            });
        });
        if (this.elements.btnOpenShout) {
            this.elements.btnOpenShout.addEventListener('click', () => {
                this.elements.shoutModal.classList.add('active');
            });
        }
        if (this.elements.btnCloseShout) {
            this.elements.btnCloseShout.addEventListener('click', () => {
                this.elements.shoutModal.classList.remove('active');
            });
        }
        if (this.elements.btnViewPlayers) {
            this.elements.btnViewPlayers.addEventListener('click', () => {
                this.elements.playerListModal.classList.add('active');
                this.updatePlayerListDetails();
            });
        }
        if (this.elements.btnClosePlayerList) {
            this.elements.btnClosePlayerList.addEventListener('click', () => {
                this.elements.playerListModal.classList.remove('active');
            });
        }
        if (this.elements.playerListModal) {
            this.elements.playerListModal.addEventListener('click', (e) => {
                if (e.target === this.elements.playerListModal) {
                    this.elements.playerListModal.classList.remove('active');
                }
            });
        }
    },

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

    startAutoDraw() {
        const interval = parseInt(this.elements.autoDrawInterval.value, 10);
        this.elements.btnDraw.classList.add('auto-drawing');
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

    stopAutoDraw() {
        if (this.autoDrawTimer) {
            clearInterval(this.autoDrawTimer);
            this.autoDrawTimer = null;
        }
        this.elements.btnDraw.classList.remove('auto-drawing');
        this.autoDrawEnabled = false;
    },

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

    resetRemainingNumbers() {
        this.remainingNumbers = Array.from({ length: 90 }, (_, i) => i + 1);
        this.shuffleArray(this.remainingNumbers);
    },

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
        if (screenId === 'player-screen') {
            this.elements.emoteBar.classList.remove('hidden');
        } else {
            this.elements.emoteBar.classList.add('hidden');
        }
    },

    sendEmote(emoji) {
        this.renderEmote(emoji);
        P2P.sendEmote(emoji);
    },

    renderEmote(emoji) {
        const MAX_EMOTES = 30;
        if (this.elements.emoteContainer.childElementCount >= MAX_EMOTES) {
            this.elements.emoteContainer.firstElementChild.remove();
        }
        const el = document.createElement('div');
        el.className = 'floating-emote';
        el.textContent = emoji;
        const startLeft = 10 + Math.random() * 80;
        el.style.left = `${startLeft}%`;
        const rotation = -20 + Math.random() * 40;
        el.style.transform = `rotate(${rotation}deg)`;
        this.elements.emoteContainer.appendChild(el);
        setTimeout(() => {
            if (el.parentNode) el.remove();
        }, 3000);
    },

    goHome() {
        if (P2P.isHost && this.players.size > 0) {
            if (!confirm('Bạn đang là chủ phòng. Nếu thoát, phòng sẽ bị huỷ và tất cả người chơi sẽ bị ngắt kết nối. Bạn chắc chắn muốn thoát?')) {
                return;
            }
        }
        if (this.autoDrawTimer) {
            this.stopAutoDraw();
            if (this.elements.autoDrawToggle) this.elements.autoDrawToggle.checked = false;
        }
        P2P.disconnect();
        this.reset();
        this.players.clear();
        this.waitingPlayers.clear();
        if (this.elements.waitingListSection) this.elements.waitingListSection.classList.add('hidden');
        this.releaseWakeLock();
        this.showScreen('home-screen');
    },

    updateWaitingList(playerId) {
        if (!this.elements.waitingList) return;
        this.waitingPlayers.add(playerId);
        if (this.waitingPlayers.size > 0) {
            this.elements.waitingListSection.classList.remove('hidden');
        }
        this.elements.waitingList.innerHTML = '';
        this.waitingPlayers.forEach(pid => {
            const player = this.players.get(pid);
            const name = player ? (player.name || `Player ${pid.substr(0, 4)}`) : 'Unknown';
            const item = document.createElement('div');
            item.className = 'waiting-item';
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-flag';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'waiting-name';
            nameSpan.textContent = name;
            item.appendChild(icon);
            item.appendChild(document.createTextNode(' '));
            item.appendChild(nameSpan);
            this.elements.waitingList.appendChild(item);
        });
    },

    updatePlayerListDetails() {
        if (this._updatePlayerListTimeout) clearTimeout(this._updatePlayerListTimeout);
        this._updatePlayerListTimeout = setTimeout(() => {
            if (!this.elements.detailsPlayerList) return;
            const connectedPlayers = Array.from(this.players.entries()).filter(([_, p]) => p.connected);

            // Update badge with connected count
            if (this.elements.playerCount) {
                this.elements.playerCount.textContent = connectedPlayers.length;
            }

            if (connectedPlayers.length === 0) {
                this.elements.detailsPlayerList.innerHTML = '<p class="empty-list-text">Chưa có người chơi nào.</p>';
                return;
            }

            this.elements.detailsPlayerList.innerHTML = '';
            connectedPlayers.forEach(([id, player]) => {
                const item = document.createElement('div');
                item.className = 'details-player-item';
                const name = player.name || `Người chơi ${id.substr(0, 4)}`;
                item.innerHTML = `<i class="fa-solid fa-user"></i> <span>${name}</span>`;
                this.elements.detailsPlayerList.appendChild(item);
            });
        }, 100);
    },

    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                this.wakeLock.addEventListener('release', () => {
                    this.wakeLock = null;
                });
            } catch (err) {
                console.warn(`${err.name}, ${err.message}`);
            }
        }
    },

    async releaseWakeLock() {
        if (this.wakeLock) {
            try {
                await this.wakeLock.release();
                this.wakeLock = null;
            } catch (err) {
                console.warn(`${err.name}, ${err.message}`);
            }
        }
    },

    // =============================================
    // HOST SESSION PERSISTENCE
    // =============================================

    saveHostState() {
        if (!P2P.isHost) return;
        const state = {
            roomCode: P2P.roomCode,
            calledNumbers: Array.from(this.calledNumbers),
            currentNumber: this.currentNumber,
            timestamp: Date.now()
        };
        sessionStorage.setItem('loto_host_state', JSON.stringify(state));
        console.log('[Host] State saved');
    },

    restoreHostState() {
        try {
            const data = sessionStorage.getItem('loto_host_state');
            if (!data) return null;
            const state = JSON.parse(data);

            // expire after 2 hours
            if (Date.now() - state.timestamp > 2 * 60 * 60 * 1000) {
                sessionStorage.removeItem('loto_host_state');
                return null;
            }
            return state;
        } catch (e) {
            console.error('Failed to restore host state', e);
            return null;
        }
    },

    clearHostState() {
        sessionStorage.removeItem('loto_host_state');
    },

    //HO-1: Save state on every draw
    //HO-2: Save state on player join? No need, players reconnect themselves.

    // =============================================
    // HOST FUNCTIONS
    // =============================================

    async startAsHost() {
        let savedState = this.restoreHostState();

        if (savedState) {
            this.elements.restoreRoomCode.textContent = savedState.roomCode;
            this.elements.restoreModal.classList.add('active');

            const choice = await new Promise(resolve => {
                const onConfirm = () => {
                    this.elements.restoreModal.classList.remove('active');
                    cleanup();
                    resolve('restore');
                };
                const onReject = () => {
                    this.elements.restoreModal.classList.remove('active');
                    cleanup();
                    resolve('new');
                };
                const cleanup = () => {
                    this.elements.btnConfirmRestore.removeEventListener('click', onConfirm);
                    this.elements.btnRejectRestore.removeEventListener('click', onReject);
                };
                this.elements.btnConfirmRestore.addEventListener('click', onConfirm);
                this.elements.btnRejectRestore.addEventListener('click', onReject);
            });

            if (choice === 'new') {
                this.clearHostState();
                savedState = null;
            }
        }

        await this._initHostLogic(savedState);
    },

    async _initHostLogic(savedState) {
        try {
            let roomCode;

            if (savedState) {
                this.showToast('Đang khôi phục phiên cũ...', 'info');
                try {
                    await P2P.initHost(0, savedState.roomCode);
                    roomCode = savedState.roomCode;

                    // Restore Game State
                    this.calledNumbers = new Set(savedState.calledNumbers);
                    this.currentNumber = savedState.currentNumber;

                    // Re-mark board
                    this.calledNumbers.forEach(num => {
                        const el = document.querySelector(`.number-cell[data-number="${num}"]`);
                        if (el) el.classList.add('active');
                    });

                    if (this.currentNumber) {
                        this.elements.currentNumber.querySelector('span').textContent = this.currentNumber;
                        this.elements.numberText.textContent = TTS.getNumberRhyme(this.currentNumber);
                    }

                    this.showToast('Đã khôi phục trạng thái!', 'success');
                } catch (err) {
                    console.error("Restore failed:", err);
                    this.showToast('Không thể khôi phục phiên cũ. Đang tạo phòng mới...', 'error');
                    this.clearHostState();
                    roomCode = await P2P.initHost();
                }
            } else {
                this.showToast('Đang tạo phòng...', 'info');
                roomCode = await P2P.initHost();
            }

            // CHANGED: Accept metadata in callback
            P2P.onPlayerJoin = (playerId, count, name, ticket, metadata) => {
                const playerData = this.handlePlayerJoin(playerId, name, ticket, metadata);
                this.updatePlayerListDetails();

                // Only announce real new joins or significant reconnects
                if (!playerData.isReconnect) {
                    if (window.AudioManager) AudioManager.playJoin();
                    const displayName = name || `Người chơi ${playerId.substr(0, 4)}`;
                    this.showToast(`${displayName} đã tham gia!`, 'success');
                } else {
                    // Verify if we should notify (e.g. they were gone for a while?)
                    // For now, silent reconnect to reduce jank
                    console.log('[Host] Silent reconnect for', playerData.name);
                }

                return playerData;
            };

            P2P.onPlayerLeave = (playerId, count) => {
                if (this.players.has(playerId)) {
                    this.players.get(playerId).connected = false;
                }
                this.updatePlayerListDetails();
            };

            let pendingWinners = [];
            let winProcessingTimeout = null;

            P2P.onWinClaim = (playerId) => {
                if (this.verifyWin(playerId)) {
                    if (this.autoDrawEnabled) {
                        this.stopAutoDraw();
                        this.elements.autoDrawToggle.checked = false;
                    }
                    const player = this.players.get(playerId);
                    const playerName = player ? (player.name || `Người chơi ${playerId.substr(0, 4)}`) : 'Người chơi';
                    if (!pendingWinners.includes(playerName)) {
                        pendingWinners.push(playerName);
                    }
                    if (!winProcessingTimeout) {
                        this.showToast('Có người Kinh! Đang chờ thêm người thắng cuộc...', 'success');
                        winProcessingTimeout = setTimeout(() => {
                            let combinedName = '';
                            if (pendingWinners.length === 1) {
                                combinedName = pendingWinners[0];
                            } else if (pendingWinners.length === 2) {
                                combinedName = `${pendingWinners[0]} và ${pendingWinners[1]}`;
                            } else {
                                const last = pendingWinners.pop();
                                combinedName = `${pendingWinners.join(', ')} và ${last}`;
                            }
                            P2P.confirmWin(combinedName);
                            this.showWin(combinedName);
                            pendingWinners = [];
                            winProcessingTimeout = null;
                        }, 2000);
                    }
                } else {
                    P2P.rejectWin(playerId);
                    const player = this.players.get(playerId);
                    const name = player ? player.name : 'Ai đó';
                    P2P.broadcastToast(`⚠️ ${name} đã KINH nhầm! Phạt đi! 🍺`, 'error');
                }
            };

            P2P.onTicketUpdate = (playerId, ticket) => {
                this.handleTicketUpdate(playerId, ticket);
            };

            P2P.onWaitSignal = (playerId) => {
                this.updateWaitingList(playerId);
            };

            this.generateQRCode(roomCode);
            this.elements.roomCodeDisplay.textContent = roomCode;
            this.elements.playerCount.textContent = '0';
            this.elements.btnDraw.disabled = false;
            this.gameStarted = false;

            this.showScreen('host-screen');
            this.showToast('Phòng đã sẵn sàng!', 'success');
            this.requestWakeLock();
            this.saveHostState();

        } catch (error) {
            console.error('Failed to start as host:', error);
            this.showToast('Không thể tạo phòng. Vui lòng thử lại.', 'error');
        }
    },

    generateQRCode(roomCode) {
        this.elements.qrCode.innerHTML = '';
        const url = `${window.location.href}?room=${roomCode}`;
        QRCode.toCanvas(url, {
            width: 250,
            margin: 2,
            color: { dark: '#1A0A0A', light: '#FFFFFF' }
        }, (error, canvas) => {
            if (error) return;
            this.elements.qrCode.appendChild(canvas);
        });
    },

    async copyRoomCode() {
        try {
            await navigator.clipboard.writeText(P2P.roomCode);
            this.showToast('Đã sao chép mã phòng!', 'success');
        } catch (error) {
            const input = document.createElement('input');
            input.value = P2P.roomCode;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            this.showToast('Đã sao chép mã phòng!', 'success');
        }
    },

    async drawNumber() {
        if (this.isDrawing) return;
        if (this.remainingNumbers.length === 0) {
            this.showToast('Đã hết số!', 'info');
            return;
        }

        this.isDrawing = true;
        this.elements.btnDraw.disabled = true;

        const ballContainer = document.querySelector('.number-ball-container');
        if (ballContainer) ballContainer.classList.add('shaking');

        if (window.AudioManager) AudioManager.playDraw();
        if (navigator.vibrate) navigator.vibrate(50);

        await new Promise(resolve => setTimeout(resolve, 400));

        if (ballContainer) ballContainer.classList.remove('shaking');

        const number = this.remainingNumbers.pop();
        this.calledNumbers.add(number);
        this.currentNumber = number;

        this.updateCurrentNumber(number);
        this.markNumberCalled(number);
        this.elements.calledCount.textContent = this.calledNumbers.size;

        P2P.broadcastNumber(number, TTS.numberToWords(number));
        await TTS.announceNumber(number);

        this.isDrawing = false;
        this.elements.btnDraw.disabled = false;
        this.saveHostState();
    },

    updateCurrentNumber(number) {
        const ball = P2P.isHost ? this.elements.currentNumber : this.elements.playerCurrentNumber;
        ball.querySelector('span').textContent = number;
        ball.classList.remove('new-number');
        void ball.offsetWidth;
        ball.classList.add('new-number');

        const rhyme = TTS.getNumberRhyme(number);
        if (P2P.isHost) {
            this.elements.numberText.textContent = rhyme;
        }
        const playerRhymeElement = document.getElementById('player-number-text');
        if (playerRhymeElement) {
            playerRhymeElement.textContent = rhyme;
        }
        if (this.elements.btnLoto) {
            this.elements.btnLoto.disabled = false;
        }
    },

    markNumberCalled(number, gridId = null) {
        const grids = gridId
            ? [document.getElementById(gridId)]
            : [this.elements.numbersGrid, this.elements.playerNumbersGrid];

        grids.forEach(grid => {
            if (!grid) return;
            const cell = grid.querySelector(`[data-number="${number}"]`);
            if (cell) cell.classList.add('called');
        });
    },

    // =============================================
    // PLAYER FUNCTIONS
    // =============================================

    showJoinModal() {
        this.elements.joinModal.classList.add('active');
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        if (roomCode) {
            this.elements.roomCodeInput.value = roomCode;
            this.elements.playerNameInput.focus();
            this.showToast('Nhập tên của bạn rồi bấm Tham Gia!', 'info');
        } else {
            this.elements.roomCodeInput.focus();
        }

        const savedName = localStorage.getItem('loto_username');
        if (savedName) {
            this.elements.playerNameInput.value = savedName;
        }
    },

    hideJoinModal() {
        this.elements.joinModal.classList.remove('active');
        this.stopQRScanner();
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

            this._setupPlayerCallbacks();

            let name = this.elements.playerNameInput.value.trim().substr(0, 20);
            if (!name) {
                name = this.generateRandomName();
                this.elements.playerNameInput.value = name;
            }
            localStorage.setItem('loto_username', name);

            this.playerSheets = [this.createSheetData()];
            this.currentTheme = ['blue', 'green', 'red', 'purple', 'yellow'][Math.floor(Math.random() * 5)];
            this.markedNumbers.clear();
            this.announcedRows.clear();
            this.renderPlayerTicket();

            await P2P.initPlayer(roomCode, name, this.playerSheets);

            this.showToast('Đang đăng ký vé với chủ xướng...', 'info');
            window.history.replaceState({}, document.title, window.location.pathname);
            this.requestWakeLock();

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

    createSheetData() {
        const COL_RANGES = [
            { start: 1, end: 9 }, { start: 10, end: 19 }, { start: 20, end: 29 },
            { start: 30, end: 39 }, { start: 40, end: 49 }, { start: 50, end: 59 },
            { start: 60, end: 69 }, { start: 70, end: 79 }, { start: 80, end: 90 }
        ];

        const colPools = COL_RANGES.map(range => {
            const pool = [];
            for (let n = range.start; n <= range.end; n++) pool.push(n);
            return this.shuffleArray(pool);
        });

        const sheet = [];
        for (let t = 0; t < 3; t++) {
            let ticket;
            let isValid = false;
            let attempts = 0;
            while (!isValid && attempts < 50) {
                try {
                    ticket = this.generateSingleTicket(COL_RANGES, colPools);
                    isValid = true;
                } catch (e) {
                    attempts++;
                }
            }
            if (!isValid) {
                ticket = Array(3).fill(null).map(() => Array(9).fill(null));
            }
            sheet.push(ticket);
        }
        return sheet;
    },

    generateSingleTicket(ranges, colPools = null) {
        let grid = Array(3).fill(null).map(() => Array(9).fill(null));
        let colCounts = Array(9).fill(0);

        for (let i = 0; i < 9; i++) colCounts[i]++;

        let extra = 6;
        while (extra > 0) {
            let col = Math.floor(Math.random() * 9);
            const poolSize = colPools ? colPools[col].length : 999;
            if (colCounts[col] < 3 && colCounts[col] < poolSize) {
                colCounts[col]++;
                extra--;
            }
        }

        const layout = this.solveLayout(colCounts);
        if (!layout) throw new Error("Could not solve layout");

        for (let c = 0; c < 9; c++) {
            const count = colCounts[c];
            let picks;
            if (colPools) {
                picks = colPools[c].splice(0, count);
            } else {
                const range = ranges[c];
                const pool = [];
                for (let n = range.start; n <= range.end; n++) pool.push(n);
                this.shuffleArray(pool);
                picks = pool.slice(0, count);
            }
            picks.sort((a, b) => a - b);
            let pickIdx = 0;
            for (let r = 0; r < 3; r++) {
                if (layout[r][c] === 1) {
                    grid[r][c] = picks[pickIdx++];
                }
            }
        }
        return grid;
    },

    solveLayout(colCounts) {
        const rows = [0, 0, 0];
        const grid = Array(3).fill(null).map(() => Array(9).fill(0));
        if (this.fillColumn(0, colCounts, rows, grid)) return grid;
        return null;
    },

    fillColumn(colIdx, colCounts, rows, grid) {
        if (colIdx === 9) return rows[0] === 5 && rows[1] === 5 && rows[2] === 5;
        const count = colCounts[colIdx];
        let options = [];
        if (count === 3) options = [[1, 1, 1]];
        else if (count === 2) options = [[1, 1, 0], [1, 0, 1], [0, 1, 1]];
        else if (count === 1) options = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        else options = [[0, 0, 0]];

        this.shuffleArray(options);

        for (let opt of options) {
            if (rows[0] + opt[0] <= 5 && rows[1] + opt[1] <= 5 && rows[2] + opt[2] <= 5) {
                rows[0] += opt[0];
                rows[1] += opt[1];
                rows[2] += opt[2];
                grid[0][colIdx] = opt[0];
                grid[1][colIdx] = opt[1];
                grid[2][colIdx] = opt[2];
                if (this.fillColumn(colIdx + 1, colCounts, rows, grid)) return true;
                rows[0] -= opt[0];
                rows[1] -= opt[1];
                rows[2] -= opt[2];
            }
        }
        return false;
    },

    // Handle new player joining (Host Side)
    // CHANGED: Added metadata support for reconnection
    handlePlayerJoin(playerId, name, data, metadata = {}) {
        let sheets = [];
        if (data && Array.isArray(data) && data.length > 0 && Array.isArray(data[0]) && Array.isArray(data[0][0])) {
            sheets = data;
        } else if (data && Array.isArray(data) && data.length === 3) {
            sheets = [data];
        } else {
            sheets = [this.createSheetData()];
        }

        // 1. RECONNECT SAME ID (Preferred method)
        if (this.players.has(playerId)) {
            console.log(`[Host] Player ${name} reconnected with same ID: ${playerId}`);
            const existing = this.players.get(playerId);
            const wasConnected = existing.connected;

            // Just update connection status
            existing.connected = true;
            if (name) existing.name = name; // Update name if changed

            // If they sent sheets, update them (unless game started)
            if (!this.gameStarted || !existing.sheets || existing.sheets.length === 0) {
                existing.sheets = sheets;
            }

            return { sheets: existing.sheets, name: existing.name, isReconnect: true, wasConnected };
        }

        // 2. RECONNECT WITH OLD ID (Migration method)
        if (metadata && metadata.lastSessionId && this.players.has(metadata.lastSessionId)) {
            console.log(`[Host] Reconnect detected for ${metadata.lastSessionId} -> ${playerId}`);
            const oldData = this.players.get(metadata.lastSessionId);

            // Migrate data to new ID
            this.players.set(playerId, {
                name: oldData.name,
                sheets: oldData.sheets, // Preserve original sheets
                connected: true
            });
            this.players.delete(metadata.lastSessionId);

            return { sheets: oldData.sheets, name: oldData.name, isReconnect: true, wasConnected: false };
        }

        // 3. NEW PLAYER
        let finalName = name;
        let counter = 2;
        let isDuplicate = true;
        while (isDuplicate) {
            isDuplicate = false;
            for (const [id, p] of this.players) {
                if (p.name === finalName && id !== playerId) {
                    isDuplicate = true;
                    break;
                }
            }
            if (isDuplicate) {
                finalName = `${name} (${counter})`;
                counter++;
            }
        }

        this.players.set(playerId, {
            name: finalName,
            sheets: sheets,
            connected: true
        });
        return { sheets, name: finalName, isReconnect: false };
    },

    handleTicketUpdate(playerId, sheets) {
        if (this.gameStarted) return;
        if (this.players.has(playerId)) {
            if (!Array.isArray(sheets)) return;
            const player = this.players.get(playerId);
            player.sheets = sheets;
        }
    },

    addSheet(notifyHost = true) {
        if (this.gameStarted) {
            this.showToast('Không thể thêm tờ khi ván đấu đang diễn ra!', 'error');
            return;
        }
        if (this.playerSheets.length >= 5) {
            this.showToast('Bạn chỉ được chơi tối đa 5 tờ!', 'warning');
            return;
        }
        const newSheet = this.createSheetData();
        this.playerSheets.push(newSheet);
        this.renderPlayerTicket();
        setTimeout(() => {
            if (this.elements.playerTicket) {
                this.elements.playerTicket.scrollTo({
                    left: this.elements.playerTicket.scrollWidth,
                    behavior: 'smooth'
                });
            }
        }, 100);
        if (notifyHost && window.P2P) P2P.sendTicketUpdate(this.playerSheets);
    },

    removeSheet(index) {
        if (this.gameStarted) {
            this.showToast('Không thể bỏ tờ khi ván đấu đang diễn ra!', 'error');
            return;
        }
        if (this.playerSheets.length <= 1) {
            this.showToast('Bạn phải giữ lại ít nhất 1 tờ!', 'warning');
            return;
        }
        this.playerSheets.splice(index, 1);
        this.reindexMarks(index);
        this.renderPlayerTicket();
        if (window.P2P) P2P.sendTicketUpdate(this.playerSheets);
    },

    reindexMarks(removedIndex) {
        const newMarks = new Set();
        this.markedNumbers.forEach(key => {
            const [s, t, n] = key.split('-').map(Number);
            if (s < removedIndex) {
                newMarks.add(key);
            } else if (s > removedIndex) {
                newMarks.add(`${s - 1}-${t}-${n}`);
            }
        });
        this.markedNumbers = newMarks;
    },

    generatePlayerTicket() {
        if (this.gameStarted) {
            this.showToast('Không thể đổi vé khi ván đấu đang diễn ra!', 'error');
            return;
        }
        this.playerSheets = [this.createSheetData()];
        this.currentTheme = ['blue', 'green', 'red', 'purple', 'yellow'][Math.floor(Math.random() * 5)];
        this.markedNumbers.clear();
        this.announcedRows.clear();
        this.renderPlayerTicket();
        if (window.P2P) {
            P2P.sendTicketUpdate(this.playerSheets);
            this.showToast('Đã đổi vé mới!', 'success');
        }
    },

    renderPlayerTicket() {
        if (!this.playerSheets) this.playerSheets = [];
        this.elements.playerTicket.innerHTML = '';
        this.elements.playerTicket.className = 'loto-carousel';

        this.playerSheets.forEach((sheetData, sheetIdx) => {
            const themes = ['blue', 'green', 'red', 'purple', 'yellow'];
            let baseParams = themes.indexOf(this.currentTheme);
            if (baseParams === -1) baseParams = 0;
            const sheetTheme = themes[(baseParams + sheetIdx) % themes.length];

            const sheetWrapper = document.createElement('div');
            sheetWrapper.className = `loto-sheet-wrapper theme-${sheetTheme}`;

            const sheetHeader = document.createElement('div');
            sheetHeader.className = 'sheet-header';

            const title = document.createElement('span');
            title.textContent = `Tờ ${sheetIdx + 1}`;
            title.className = 'sheet-title';

            const btnRemove = document.createElement('button');
            btnRemove.className = 'btn-remove-sheet';
            btnRemove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            btnRemove.onclick = (e) => {
                e.stopPropagation();
                if (confirm('Bạn có chắc muốn bỏ tờ này?')) this.removeSheet(sheetIdx);
            };

            if (this.playerSheets.length > 1) {
                sheetHeader.appendChild(title);
                sheetHeader.appendChild(btnRemove);
            } else {
                sheetHeader.appendChild(title);
                sheetHeader.style.justifyContent = 'center';
            }
            sheetWrapper.appendChild(sheetHeader);

            const sheetDiv = document.createElement('div');
            sheetDiv.className = 'loto-sheet';

            sheetData.forEach((ticketData, ticketIdx) => {
                const card = document.createElement('div');
                card.className = 'loto-card';
                const ticketGrid = document.createElement('div');
                ticketGrid.className = 'loto-ticket';

                ticketData.forEach((row, rowIdx) => {
                    row.forEach((num, colIdx) => {
                        const cell = document.createElement('div');
                        cell.className = 'ticket-cell';
                        cell.dataset.sheetIndex = sheetIdx;
                        cell.dataset.ticketIndex = ticketIdx;
                        cell.dataset.row = rowIdx;

                        if (num === null) {
                            cell.classList.add('empty');
                        } else {
                            const numSpan = document.createElement('span');
                            numSpan.textContent = num;
                            cell.appendChild(numSpan);
                            cell.dataset.number = num;
                            if (this.markedNumbers.has(`${sheetIdx}-${ticketIdx}-${num}`)) {
                                cell.classList.add('marked');
                            }
                            cell.addEventListener('click', () => this.toggleTicketMark(cell, sheetIdx, ticketIdx, num));
                        }
                        ticketGrid.appendChild(cell);
                    });
                });
                card.appendChild(ticketGrid);
                sheetDiv.appendChild(card);
            });
            sheetWrapper.appendChild(sheetDiv);
            this.elements.playerTicket.appendChild(sheetWrapper);
        });

        this.updatePaginationDots();
        this.checkWinCondition();
        if (!this.elements.playerTicket.onscroll) {
            this.elements.playerTicket.onscroll = this.debounce(() => {
                this.updatePaginationDots();
            }, 50);
        }
    },

    debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    },

    updatePaginationDots() {
        const dotsContainer = this.elements.paginationDots;
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';
        if (this.playerSheets.length <= 1) return;
        const scrollLeft = this.elements.playerTicket.scrollLeft;
        const width = this.elements.playerTicket.offsetWidth;
        const currentIndex = Math.round(scrollLeft / width);
        for (let i = 0; i < this.playerSheets.length; i++) {
            const dot = document.createElement('div');
            dot.className = `dot ${i === currentIndex ? 'active' : ''}`;
            dot.onclick = () => {
                const target = this.elements.playerTicket.children[i];
                if (target) target.scrollIntoView({ behavior: 'smooth' });
            };
            dotsContainer.appendChild(dot);
        }
    },

    toggleTicketMark(cell, sheetIdx, ticketIdx, num) {
        const key = `${sheetIdx}-${ticketIdx}-${num}`;
        if (this.markedNumbers.has(key)) {
            this.markedNumbers.delete(key);
            cell.classList.remove('marked');
        } else {
            this.markedNumbers.add(key);
            cell.classList.add('marked');
        }
        this.checkWinCondition();
    },

    checkWinCondition() {
        let hasWin = false;
        let isWaiting = false;

        // Reset near-win highlights
        document.querySelectorAll('.cell-near-win').forEach(el => el.classList.remove('cell-near-win'));

        for (let s = 0; s < this.playerSheets.length; s++) {
            const sheetData = this.playerSheets[s];
            if (!sheetData) continue;
            for (let t = 0; t < 3; t++) {
                const ticketData = sheetData[t];
                if (!ticketData) continue;
                for (let r = 0; r < 3; r++) {
                    const rowNumbers = ticketData[r].filter(n => n !== null);
                    let validMarkedCount = 0;

                    // Track cell elements for this row to apply partial highlights
                    const rowCellElements = [];

                    rowNumbers.forEach(n => {
                        const cell = document.querySelector(`[data-sheet-index="${s}"][data-ticket-index="${t}"][data-number="${n}"]`);
                        if (cell) rowCellElements.push(cell);

                        const isMarked = this.markedNumbers.has(`${s}-${t}-${n}`);
                        const isCalled = this.calledNumbers.has(n);
                        if (cell) {
                            if (isMarked && !isCalled) {
                                cell.classList.add('invalid-mark');
                            } else {
                                cell.classList.remove('invalid-mark');
                            }
                        }
                        if (isMarked && isCalled) validMarkedCount++;
                    });

                    const rowCells = document.querySelectorAll(`[data-sheet-index="${s}"][data-ticket-index="${t}"][data-row="${r}"]`);
                    // Note: rowCells based on data-row attribute might not exist if I didn't add it in renderPlayerTicket. 
                    // But standard approach in this codebase seems to rely on individual cells. 

                    const rowId = `${s}-${t}-${r}`;

                    if (validMarkedCount === 5) {
                        hasWin = true;
                        // rowCells.forEach(cell => cell.classList.add('winning-row')); // Original
                        if (rowCellElements.length > 0) rowCellElements.forEach(c => c.classList.add('winning-cell'));

                        this.announcedRows.delete(rowId);
                    } else if (validMarkedCount === 4) {
                        isWaiting = true;
                        // Start Near-Win Effect
                        if (rowCellElements.length > 0) rowCellElements.forEach(c => c.classList.add('cell-near-win'));

                        if (!this.announcedRows.has(rowId)) {
                            this.announceWaitState();
                            this.announcedRows.add(rowId);
                        }
                    }
                }
            }
        }
        this.elements.btnLoto.classList.toggle('highlight', hasWin);
        return hasWin;
    },

    announceWaitState() {
        if (this._lastWaitAnnounce && Date.now() - this._lastWaitAnnounce < 5000) return;
        this._lastWaitAnnounce = Date.now();
        P2P.broadcastWait();
        this.showToast('Bạn đang Đợi!', 'info');
    },

    generateRandomName() {
        const adjectives = ['Vui Vẻ', 'Ngáo Ngơ', 'Dễ Thương', 'Nhanh Trí', 'Siêu Quậy', 'Tí Hon', 'Khổng Lồ', 'Mũm Mĩm', 'Thông Thái', 'Lanh Chanh'];
        const animals = ['Mèo Mun', 'Cún Con', 'Gấu Trúc', 'Vịt Bầu', 'Thỏ Trắng', 'Sóc Nâu', 'Heo Mọi', 'Gà Con', 'Chim Cánh Cụt', 'Cá Voi', 'Hổ Con', 'Sư Tử', 'Khỉ Con'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const animal = animals[Math.floor(Math.random() * animals.length)];
        return `${animal} ${adj}`;
    },

    claimLoto() {
        const hasLocalWin = this.checkWinCondition();
        if (!hasLocalWin) {
            if (!confirm('⚠️ CẢNH BÁO: Vé của bạn CHƯA ĐỦ điều kiện thắng.\n\nNếu bạn cố tình báo "Kinh" sai, bạn sẽ bị bêu tên phạt trước toàn phòng.\n\nBạn có chắc chắn muốn "Kinh" không?')) {
                return;
            }
        }
        if (this._lastClaimTime && Date.now() - this._lastClaimTime < 5000) {
            this.showToast('Từ từ thôi! Đợi 5 giây nữa.', 'warning');
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
        if (!player || (!player.sheets && !player.ticket)) return false;
        const sheets = player.sheets || (player.ticket ? [player.ticket] : []);
        for (const sheet of sheets) {
            for (const ticket of sheet) {
                for (const row of ticket) {
                    const rowNumbers = row.filter(n => n !== null);
                    const allCalled = rowNumbers.every(n => this.calledNumbers.has(n));
                    if (allCalled) return true;
                }
            }
        }
        return false;
    },

    showWin(winnerName) {
        if (this.elements.winModal.classList.contains('active')) return;
        this.elements.winnerName.textContent = `${winnerName} đã thắng!`;
        this.elements.winModal.classList.add('active');
        if (window.AudioManager) AudioManager.playWin();
        if (this.ttsEnabled) TTS.announceWinner(winnerName);
        if (P2P.isHost) {
            const btnContainer = this.elements.winModal.querySelector('.modal-content');
            let btnPlayAgain = document.getElementById('btn-play-again');
            if (!btnPlayAgain) {
                btnPlayAgain = document.createElement('button');
                btnPlayAgain.id = 'btn-play-again';
                btnPlayAgain.className = 'btn-large btn-primary';
                btnPlayAgain.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Ván Mới';
                btnPlayAgain.style.marginTop = '1rem';
                btnPlayAgain.onclick = () => {
                    if (confirm('Bắt đầu ván mới? Tất cả số đã gọi sẽ bị xoá.')) {
                        this.resetGame();
                    }
                };
                this.elements.winnerName.parentElement.appendChild(btnPlayAgain);
            }
        }
    },

    hideWinModal() {
        this.elements.winModal.classList.remove('active');
    },

    syncState(calledNumbers, gameStarted) {
        this.calledNumbers = new Set(calledNumbers);
        this.gameStarted = gameStarted;
        if (this.gameStarted) {
            this.elements.btnNewTicket.disabled = true;
            this.elements.btnNewTicket.title = "Đã khoá vé (Ván đang chơi)";
            this.elements.btnAddSheet.disabled = true;
            this.elements.btnAddSheet.title = "Không thể thêm tờ khi đang chơi";
            this.elements.btnLoto.disabled = false;
        } else {
            this.elements.btnNewTicket.disabled = false;
            this.elements.btnNewTicket.title = "Đổi tất cả vé";
            this.elements.btnAddSheet.disabled = false;
            this.elements.btnAddSheet.title = "Thêm tờ mới";
            this.elements.btnLoto.disabled = true;
        }
        calledNumbers.forEach(num => this.markNumberCalled(num));
        this.checkWinCondition();
    },

    reset() {
        this.clearHostState();
        this.calledNumbers.clear();
        this.markedNumbers.clear();
        this.announcedRows.clear();
        this.gameStarted = false;
        this.isDrawing = false;
        this.isJoining = false;
        this.resetRemainingNumbers();
        this.playerSheets = [];
        this.playerTicket = null;
        if (this.elements.numbersGrid) document.querySelectorAll('.number-cell').forEach(c => c.classList.remove('called'));
        if (this.elements.calledCount) this.elements.calledCount.textContent = '0';
        if (this.elements.currentNumber) {
            this.elements.currentNumber.querySelector('span').textContent = '?';
            this.elements.currentNumber.classList.remove('new-number');
        }
        if (this.elements.numberText) this.elements.numberText.textContent = 'Bấm để bắt đầu';
        if (this.elements.btnDraw) this.elements.btnDraw.disabled = false;
        if (this.elements.btnNewTicket) {
            this.elements.btnNewTicket.disabled = false;
            this.elements.btnNewTicket.title = "Đổi tất cả vé";
        }
        if (this.elements.btnAddSheet) {
            this.elements.btnAddSheet.disabled = false;
            this.elements.btnAddSheet.title = "Thêm tờ mới";
        }
        if (this.elements.btnLoto) {
            this.elements.btnLoto.disabled = true;
            this.elements.btnLoto.textContent = '🎉 KINH!';
        }
        if (P2P.isHost) P2P.broadcastReset();
        this.waitingPlayers.clear();
        if (this.elements.waitingListSection) this.elements.waitingListSection.classList.add('hidden');
        if (this.elements.waitingList) this.elements.waitingList.innerHTML = '';
        if (this.elements.detailsPlayerList) this.elements.detailsPlayerList.innerHTML = '<p class="empty-list-text">Chưa có người chơi nào.</p>';
        if (this.elements.emoteContainer) this.elements.emoteContainer.innerHTML = '';
    },

    resetGame() {
        this.calledNumbers.clear();
        this.markedNumbers.clear();
        this.announcedRows.clear();
        this.gameStarted = false;
        this.isDrawing = false;
        this.resetRemainingNumbers();
        this._lastClaimTime = 0;
        this._lastWaitAnnounce = 0;
        this.hideWinModal();
        if (this.elements.numbersGrid) document.querySelectorAll('.number-cell').forEach(c => c.classList.remove('called'));
        if (this.elements.playerNumbersGrid) document.querySelectorAll('.number-cell').forEach(c => c.classList.remove('called'));
        document.querySelectorAll('.ticket-cell').forEach(c => {
            c.classList.remove('marked', 'winning-row', 'waiting-row', 'invalid-mark');
        });
        if (this.elements.calledCount) this.elements.calledCount.textContent = '0';
        if (this.elements.currentNumber) {
            this.elements.currentNumber.querySelector('span').textContent = '?';
            this.elements.currentNumber.classList.remove('new-number');
        }
        if (this.elements.numberText) this.elements.numberText.textContent = 'Bấm để bắt đầu';
        if (this.elements.btnDraw) this.elements.btnDraw.disabled = false;
        if (this.elements.btnLoto) {
            this.elements.btnLoto.disabled = true;
            this.elements.btnLoto.textContent = '🎉 KINH!';
            this.elements.btnLoto.classList.remove('highlight');
        }
        this.waitingPlayers.clear();
        if (this.elements.waitingListSection) this.elements.waitingListSection.classList.add('hidden');
        if (this.elements.waitingList) this.elements.waitingList.innerHTML = '';
        if (P2P.isHost) {
            P2P.broadcastReset();
            this.showToast('Đã bắt đầu ván mới!', 'success');
        } else {
            this.showToast('Chủ phòng đã bắt đầu ván mới!', 'info');
        }
    },

    initShoutMenu() {
        if (!this.elements.shoutGrid) return;
        this.elements.shoutGrid.innerHTML = '';
        this.shoutPresets.forEach(text => {
            const btn = document.createElement('button');
            btn.className = 'btn-shout-preset';
            btn.textContent = text;
            btn.onclick = () => {
                this.sendShout(text);
                this.elements.shoutModal.classList.remove('active');
            };
            this.elements.shoutGrid.appendChild(btn);
        });
    },

    sendShout(text) {
        this.renderDanmaku(text, true);
        P2P.sendShout(text);
    },

    renderDanmaku(text, isSelf = false) {
        if (!this.elements.danmakuContainer) return;
        const el = document.createElement('div');
        el.className = 'danmaku-item';
        el.textContent = text;
        const top = 10 + Math.random() * 80;
        const duration = 4 + Math.random() * 4;
        const fontSize = 1.2 + Math.random() * 0.8;
        el.style.top = `${top}%`;
        el.style.animation = `flyAcross ${duration}s linear forwards`;
        el.style.fontSize = `${fontSize}rem`;
        const colors = ['#FFFFFF', '#FE0302', '#FF7204', '#FFAA02', '#FFD302', '#CC0273', '#00CD00', '#00FFFF', '#33D8F0', '#89D5FF'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        el.style.color = randomColor;
        if (isSelf) el.classList.add('self');
        this.elements.danmakuContainer.appendChild(el);
        setTimeout(() => el.remove(), duration * 1000);
    },

    async startQRScanner() {
        if (this.isScanning) return;
        this.stopQRScanner();
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
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
            const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
            if (code) {
                let roomCode = code.data;
                if (roomCode.includes('?room=')) {
                    try {
                        const url = new URL(roomCode);
                        const p = url.searchParams.get('room');
                        if (p) roomCode = p;
                    } catch (e) { }
                }
                if (roomCode && roomCode.length === 6) {
                    this.isScanning = false;
                    this.stopQRScanner();
                    if (navigator.vibrate) navigator.vibrate(200);
                    this.elements.roomCodeInput.value = roomCode;
                    this.showToast(`Đã quét mã: ${roomCode}. Hãy nhập tên và Tham Gia!`, 'success');
                    this.elements.playerNameInput.focus();
                    return;
                }
            }
        }
        if (this.isScanning) requestAnimationFrame(() => this.scanQRCode());
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
                if (toast.classList.contains('exiting')) toast.remove();
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
    },

    loadSettings() {
        const settings = JSON.parse(localStorage.getItem('loto_settings') || '{}');
        this.isDarkMode = settings.darkMode === true;
        if (this.isDarkMode) {
            document.body.setAttribute('data-theme', 'dark');
            if (this.elements.settingDarkMode) this.elements.settingDarkMode.checked = true;
        } else {
            document.body.removeAttribute('data-theme');
            if (this.elements.settingDarkMode) this.elements.settingDarkMode.checked = false;
        }
        this.preferredTheme = settings.theme || 'blue';
        this.currentTheme = this.preferredTheme;
        this.updateThemeUI();
        this.sfxEnabled = settings.sfx !== false;
        this.ttsEnabled = settings.tts !== false;
        if (this.elements.settingSfx) this.elements.settingSfx.checked = this.sfxEnabled;
        if (this.elements.settingTts) this.elements.settingTts.checked = this.ttsEnabled;
        if (this.elements.settingOnlineTts) {
            const useOnline = localStorage.getItem('loto_use_online_tts') === 'true';
            this.elements.settingOnlineTts.checked = useOnline;
            TTS.setUseOnlineTTS(useOnline);
        }
        if (window.AudioManager) AudioManager.enabled = this.sfxEnabled;
    },

    saveSettings() {
        const settings = {
            darkMode: this.isDarkMode,
            theme: this.preferredTheme,
            sfx: this.sfxEnabled,
            tts: this.ttsEnabled
        };
        localStorage.setItem('loto_settings', JSON.stringify(settings));
    },

    toggleDarkMode(enabled) {
        this.isDarkMode = enabled;
        if (this.isDarkMode) {
            document.body.setAttribute('data-theme', 'dark');
        } else {
            document.body.removeAttribute('data-theme');
        }
        this.saveSettings();
    },

    setTheme(theme) {
        this.preferredTheme = theme;
        this.currentTheme = theme;
        this.updateThemeUI();
        this.saveSettings();
        if (this.playerSheets && this.playerSheets.length > 0) this.renderPlayerTicket();
    },

    updateThemeUI() {
        if (!this.elements.settingThemeContainer) return;
        const swatches = this.elements.settingThemeContainer.querySelectorAll('.theme-swatch');
        swatches.forEach(s => {
            if (s.dataset.theme === `theme-${this.preferredTheme}`) {
                s.classList.add('active');
            } else {
                s.classList.remove('active');
            }
        });
    },

    openSettings() {
        if (this.elements.settingsModal) this.elements.settingsModal.classList.add('active');
    },

    closeSettings() {
        if (this.elements.settingsModal) this.elements.settingsModal.classList.remove('active');
    },

    resetApp() {
        if (confirm('Bạn có chắc xoá toàn bộ dữ liệu (cài đặt, vé, tên)? Ứng dụng sẽ tải lại.')) {
            localStorage.clear();
            sessionStorage.clear();
            window.location.reload();
        }
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    Game.init();
    const hasSession = await Game.checkSessionAndReconnect();
    if (!hasSession) {
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        if (roomCode) Game.showJoinModal();
    }
});
window.Game = Game;

/* =============================================
   MUSIC PLAYER LOGIC
   ============================================= */
const MusicPlayer = {
    audio: new Audio(),
    playlist: [
        { name: "🎆 Tết Đong Đầy (Remix 2026)", src: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Monkeys%20Spinning%20Monkeys.mp3" },
        { name: "🌸 Xuân Họp Mặt (Trendy)", src: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Fretless.mp3" },
        { name: "💃 Lắng Nghe Mùa Xuân Về", src: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Carefree.mp3" }
    ],
    currentIndex: 0,
    isPlaying: false,
    playPromise: null,
    elements: {},

    init() {
        this.elements = {
            container: document.querySelector('.music-player'),
            btnPrev: document.getElementById('btn-music-prev'),
            btnPlay: document.getElementById('btn-music-play'),
            btnNext: document.getElementById('btn-music-next'),
            trackName: document.getElementById('music-track-name'),
            volume: document.getElementById('music-volume'),
            inputUrl: document.getElementById('music-url-input'), // Custom Input
            btnAdd: document.getElementById('btn-add-music')      // Custom Add Button
        };

        if (!this.elements.container) return;

        // Load Playlist from Storage if exists to persist custom tracks? 

        this.loadTrack(0);

        this.elements.btnPlay.addEventListener('click', () => this.togglePlay());
        this.elements.btnPrev.addEventListener('click', () => this.prevTrack());
        this.elements.btnNext.addEventListener('click', () => this.nextTrack());

        this.elements.volume.addEventListener('input', (e) => {
            this.audio.volume = e.target.value;
        });

        // Custom URL Events
        if (this.elements.btnAdd) {
            this.elements.btnAdd.addEventListener('click', () => this.addCustomTrack());
        }
        if (this.elements.inputUrl) {
            this.elements.inputUrl.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.addCustomTrack();
            });
        }

        this.audio.addEventListener('ended', () => this.nextTrack());
        this.audio.volume = 0.5;

        this.audio.onerror = (e) => {
            console.warn("Music load failed:", e);
            this.elements.trackName.textContent = "Lỗi tải nhạc (Thử bài khác)";
            this.isPlaying = false;
            this.updateUI();
        };
    },

    addCustomTrack() {
        const url = this.elements.inputUrl.value.trim();
        if (!url) return;

        // Basic validation or just try? 
        // Let's add it to playlist and play it immediately.
        const name = "Nhạc của bạn #" + (this.playlist.length + 1);
        this.playlist.push({ name: name, src: url });
        this.elements.inputUrl.value = '';

        // Switch to this new track
        this.loadTrack(this.playlist.length - 1);
        this.play();
        Game.showToast("Đã thêm bài hát mới!", "success");
    },

    loadTrack(index) {
        this.currentIndex = index;
        if (this.currentIndex >= this.playlist.length) this.currentIndex = 0;
        if (this.currentIndex < 0) this.currentIndex = this.playlist.length - 1;

        const track = this.playlist[this.currentIndex];
        this.audio.src = track.src;
        this.elements.trackName.textContent = track.name;
        this.updateUI();
    },

    async togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            await this.play();
        }
    },

    async play() {
        this.isPlaying = true;
        this.updateUI();
        try {
            this.playPromise = this.audio.play();
            await this.playPromise;
        } catch (e) {
            // Ignore AbortError caused by rapid track changes
            if (e.name !== 'AbortError') {
                console.error("Play failed:", e);
                this.isPlaying = false;
                this.updateUI();
                this.elements.trackName.textContent = "Không thể phát (Lỗi link/định dạng)";
            }
        }
    },

    pause() {
        this.isPlaying = false;
        this.updateUI();
        this.audio.pause();
    },

    updateUI() {
        const icon = this.elements.btnPlay.querySelector('i');
        if (this.isPlaying) {
            icon.className = 'fa-solid fa-pause';
        } else {
            icon.className = 'fa-solid fa-play';
        }
    },

    prevTrack() {
        this.pause(); // Ensure clean state transition
        this.loadTrack(this.currentIndex - 1);
        this.play();
    },

    nextTrack() {
        const wasPlaying = !this.audio.paused;
        this.loadTrack(this.currentIndex + 1);
        if (wasPlaying || this.isPlaying) this.play();
    }
};

// Remove the patch since we integrated it


/* =============================================
   GAME LOG LOGIC
   ============================================= */
const GameLog = {
    container: null,

    init() {
        this.container = document.getElementById('game-log');
    },

    log(message, type = 'System') {
        if (!this.container) return;
        const item = document.createElement('div');
        item.className = `log-item ${type}`;
        const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        item.innerHTML = `<strong>${time}</strong>: ${message}`;
        this.container.appendChild(item);

        // Limit log size to prevent memory issues
        if (this.container.children.length > 50) {
            this.container.removeChild(this.container.firstChild);
        }

        this.container.scrollTop = this.container.scrollHeight;
    }
};

// =============================================
//  EXTENSIONS & HOOKS
// =============================================

// Hook into Game.init
const _originalInit = Game.init;
Game.init = function () {
    _originalInit.call(this);
    MusicPlayer.init();

};

// Hook into Game.startAsHost to setup logging
const _originalStartAsHost = Game.startAsHost;
Game.startAsHost = async function () {
    await _originalStartAsHost.call(this);

    // Wrap P2P callbacks for logging
    const _originalOnPlayerJoin = P2P.onPlayerJoin;
    P2P.onPlayerJoin = (playerId, count, name, ticket, metadata) => {
        console.log("[Wrapper] Player Join:", playerId, name);
        const res = _originalOnPlayerJoin(playerId, count, name, ticket, metadata);
        console.log("[Wrapper] Result:", res);

        // Force update count if original didn't work (Safety Fallback)
        if (Game.elements && Game.elements.playerCount) {
            console.log("[Wrapper] Updating count to:", Game.players.size);
            Game.elements.playerCount.textContent = Game.players.size;
        }

        GameLog.log(`${name || 'Người chơi'} đã tham gia`, 'Join');
        return res;
        return res;
    };

    // Wrap onPlayerLeave to log and fix count
    const _originalOnPlayerLeave = P2P.onPlayerLeave;
    P2P.onPlayerLeave = (playerId, count) => {
        if (_originalOnPlayerLeave) _originalOnPlayerLeave(playerId, count);

        // Fix: Update with actual connected count from P2P, not Game.players.size
        if (Game.elements && Game.elements.playerCount) {
            console.log("[Wrapper] Player Leave. Count:", count);
            Game.elements.playerCount.textContent = count;
        }

        const player = Game.players.get(playerId);
        GameLog.log(`${(player && player.name) || 'Người chơi'} đã rời phòng`, 'Leave');
    };

    const _originalOnWinClaim = P2P.onWinClaim;
    P2P.onWinClaim = (playerId) => {
        const player = Game.players.get(playerId);
        const name = player ? player.name : 'Ai đó';
        GameLog.log(`🚨 ${name} BÁO KINH!`, 'Win');
        _originalOnWinClaim(playerId);
    };

    // Log initial message
    GameLog.log("Phòng đã mở. Mã phòng: " + P2P.roomCode, 'System');
};

// Hook into Game.drawNumber for logging
const _originalDrawNumber = Game.drawNumber;
Game.drawNumber = async function () {
    if (this.isDrawing) return;
    await _originalDrawNumber.call(this);
    if (this.currentNumber) {
        GameLog.log(`Số ${this.currentNumber} - ${TTS.numberToWords(this.currentNumber)}`, 'Draw');
    }
};

// Implement verifyWin with visual highlight
Game.verifyWin = function (playerId) {
    const player = this.players.get(playerId);
    if (!player) return false;

    // Check all sheets
    const sheets = player.sheets || (player.ticket ? [player.ticket] : []);
    for (let sIdx = 0; sIdx < sheets.length; sIdx++) {
        const sheet = sheets[sIdx];
        for (let tIdx = 0; tIdx < sheet.length; tIdx++) {
            const ticket = sheet[tIdx];
            for (let rIdx = 0; rIdx < ticket.length; rIdx++) {
                const row = ticket[rIdx];
                const rowNumbers = row.filter(n => n !== null);
                if (rowNumbers.length > 0 && rowNumbers.every(num => this.calledNumbers.has(num))) {
                    // Log details
                    console.log(`[WIN] Player ${player.name} won on Sheet ${sIdx + 1}, Ticket ${tIdx + 1}, Row ${rIdx + 1}: [${rowNumbers.join(', ')}]`);
                    GameLog.log(`Hàng thắng: ${rowNumbers.join(', ')}`, 'Win');
                    this.lastWinningRow = rowNumbers;
                    return true;
                }
            }
        }
    }
    return false;
};

// Hook into showWin to display winning numbers
const _originalShowWin = Game.showWin;
Game.showWin = function (winnerName) {
    _originalShowWin.call(this, winnerName);

    // Trigger Confetti
    if (window.Confetti && typeof window.Confetti.burst === 'function') {
        window.Confetti.burst();
    }

    if (this.lastWinningRow) {
        // Check if already displayed
        if (this.elements.winModal.querySelector('.winning-row-display')) {
            this.elements.winModal.querySelector('.winning-row-display').remove();
        }

        const winRowDiv = document.createElement('div');
        winRowDiv.className = 'winning-row-display';
        winRowDiv.style.margin = '1rem 0';
        winRowDiv.innerHTML = `<h3 style="color:var(--coral-dark);margin-bottom:0.5rem">Số trúng thưởng</h3>
                                <div class="win-numbers" style="display:flex;justify-content:center;gap:0.5rem">
                                    ${this.lastWinningRow.map(n =>
            `<span class="win-number" style="
                                            background:var(--success);
                                            color:white;
                                            padding:5px 10px;
                                            border-radius:50%;
                                            font-weight:bold;
                                            font-size:1.2rem;
                                            box-shadow:var(--shadow-sm);
                                         ">${n}</span>`
        ).join('')}
                                </div>`;

        const content = this.elements.winModal.querySelector('.modal-content');
        // Insert after the winner text (p#winner-name)
        const winnerText = this.elements.winnerName;
        if (winnerText && winnerText.parentNode) {
            winnerText.parentNode.insertBefore(winRowDiv, winnerText.nextSibling);
        } else {
            content.appendChild(winRowDiv);
        }

        this.lastWinningRow = null;
    }
};