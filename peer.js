/* =============================================
   LÔ TÔ - PEER-TO-PEER MODULE
   WebRTC connectivity via PeerJS
   ============================================= */

const P2P = {
    // PeerJS instance
    peer: null,

    // Connection state
    isHost: false,
    roomCode: null,
    connections: new Map(), // For host: Map of player connections
    hostConnection: null,   // For player: connection to host

    // Configuration
    config: {
        debug: 1,
        config: {
            // Disable trickle ICE for better compatibility
            iceTransportPolicy: 'all',
            iceServers: [
                // OpenRelay Project (Free Public TURN)
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                // Public STUN
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    },

    // Session Storage Key
    SESSION_KEY: 'loto_session',

    // Visibility state tracking
    _isPageHidden: false,
    _wasConnectedBeforeHidden: false,
    _lastPeerId: null, // Track previous ID for reconnection

    // Callbacks
    onPlayerJoin: null,
    onPlayerLeave: null,
    onNumberDrawn: null,
    onWinClaim: null,
    onConnected: null,
    onDisconnected: null,
    onWelcome: null,
    onTicketUpdate: null,
    onWinRejected: null,
    onWaitSignal: null,
    onEmote: null,
    onShout: null,
    onError: null,
    onReconnecting: null,
    onReconnected: null,

    // =============================================
    // SESSION PERSISTENCE HELPERS
    // =============================================

    saveSession() {
        if (this.isHost) return;

        const session = {
            roomCode: this.roomCode,
            playerName: this._playerName,
            // Save the actual sheets structure
            playerSheets: this._playerTicket,
            playerTicket: this._playerTicket, // Legacy fallback
            peerId: this.peer ? this.peer.id : null,
            timestamp: Date.now()
        };

        try {
            sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
            console.log('[Session] Saved:', session.roomCode);
        } catch (e) {
            console.warn('[Session] Failed to save:', e);
        }
    },

    loadSession() {
        try {
            const data = sessionStorage.getItem(this.SESSION_KEY);
            if (!data) return null;

            const session = JSON.parse(data);

            // Session expires after 1 hour
            const ONE_HOUR = 60 * 60 * 1000;
            if (Date.now() - session.timestamp > ONE_HOUR) {
                this.clearSession();
                return null;
            }

            console.log('[Session] Loaded:', session.roomCode);
            return session;
        } catch (e) {
            console.warn('[Session] Failed to load:', e);
            return null;
        }
    },

    clearSession() {
        try {
            sessionStorage.removeItem(this.SESSION_KEY);
            console.log('[Session] Cleared');
        } catch (e) {
            console.warn('[Session] Failed to clear:', e);
        }
    },

    hasRestoredSession() {
        const session = this.loadSession();
        return session !== null && session.roomCode && (session.playerSheets || session.playerTicket);
    },

    // =============================================
    // VISIBILITY API HANDLING
    // =============================================

    initVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this._isPageHidden = true;
                this._wasConnectedBeforeHidden = this.hostConnection && this.hostConnection.open;
            } else {
                this._isPageHidden = false;
                if (this._wasConnectedBeforeHidden && !this.isHost) {
                    setTimeout(() => this._checkConnectionHealth(), 500);
                }
            }
        });
    },

    _checkConnectionHealth() {
        if (!this.hostConnection || !this.hostConnection.open) {
            console.log('[Visibility] Connection lost, attempting reconnect...');
            if (this.onReconnecting) this.onReconnecting();
            this._attemptReconnect();
        } else {
            try {
                this.hostConnection.send({ type: 'ping' });
            } catch (e) {
                if (this.onReconnecting) this.onReconnecting();
                this._attemptReconnect();
            }
        }
    },

    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    },

    // Initialize as host
    async initHost(retryCount = 0, existingRoomCode = null) {
        this.isHost = true;

        if (existingRoomCode) {
            this.roomCode = existingRoomCode;
        } else if (retryCount > 0 || !this.roomCode) {
            this.roomCode = this.generateRoomCode();
        }

        return new Promise((resolve, reject) => {
            this.peer = new Peer(`loto-${this.roomCode}`, this.config);

            this.peer.on('open', (id) => {
                console.log('Host peer opened:', id);
                resolve(this.roomCode);
            });

            this.peer.on('connection', (conn) => {
                this.handleNewConnection(conn);
            });

            this.peer.on('error', (err) => {
                if (err.type === 'unavailable-id') {
                    if (retryCount < 5) {
                        this.peer.destroy();
                        console.log(`[P2P] ID unavailable, retrying (${retryCount + 1}/5)...`);
                        // Delay retry to allow previous ghost to clear
                        setTimeout(() => {
                            this.initHost(retryCount + 1, existingRoomCode).then(resolve).catch(reject);
                        }, 1500);
                    } else {
                        reject(new Error('Unable to claim Room Code (Taken).'));
                    }
                } else {
                    if (this.onError) this.onError(err);
                    reject(err);
                }
            });

            this.peer.on('disconnected', () => {
                if (this.peer && !this.peer.destroyed) this.peer.reconnect();
            });
        });
    },

    // Handle new player connection (host side)
    handleNewConnection(conn) {
        const name = conn.metadata ? conn.metadata.name : null;
        const ticket = conn.metadata ? conn.metadata.ticket : null;
        // Pass full metadata to support reconnect logic
        const metadata = conn.metadata || {};

        const onOpen = () => {
            this.connections.set(conn.peer, conn);

            let playerData = null;
            if (this.onPlayerJoin) {
                // CHANGED: Pass full metadata to callback
                playerData = this.onPlayerJoin(conn.peer, this.connections.size, name, ticket, metadata);
            }

            if (window.Game && playerData) {
                conn.send({
                    type: 'welcome',
                    name: playerData.name,
                    sheets: playerData.sheets, // Send back sheets
                    gameState: {
                        calledNumbers: Array.from(Game.calledNumbers),
                        gameStarted: Game.gameStarted
                    }
                });
            }
        };

        if (conn.open) {
            onOpen();
        } else {
            conn.on('open', onOpen);
        }

        conn.on('data', (data) => this.handleMessage(data, conn));
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            if (this.onPlayerLeave) this.onPlayerLeave(conn.peer, this.connections.size);
        });
        conn.on('error', (err) => {
            console.error('Connection error:', err);
            this.connections.delete(conn.peer);
        });
    },

    // Initialize as player
    async initPlayer(roomCode, name, ticket, preferredId = null) {
        this.isHost = false;
        this.roomCode = roomCode.toUpperCase();
        this._reconnectAttempts = 0;
        this._maxReconnectAttempts = 5;
        this._playerName = name;
        this._playerTicket = ticket;
        this._lastPeerId = preferredId; // Store for metadata usage

        // If we have a preferred ID, try to use it
        const peerOptions = { ...this.config };

        if (!this._visibilityHandlerInit) {
            this.initVisibilityHandler();
            this._visibilityHandlerInit = true;
        }

        return new Promise((resolve, reject) => {
            if (this.peer && !this.peer.destroyed) {
                // If we already have a peer, check if it matches our preferred ID
                if (preferredId && this.peer.id === preferredId) {
                    this._connectToHost(resolve, reject);
                    return;
                }
                this.peer.destroy();
            }

            // Create new peer, optionally with preferred ID
            this.peer = preferredId
                ? new Peer(preferredId, peerOptions)
                : new Peer(peerOptions);

            this.peer.on('open', (id) => {
                console.log('Player peer opened:', id);
                this._connectToHost(resolve, reject);
            });

            this.peer.on('error', (err) => {
                console.error('Peer error:', err);

                // If preferred ID is taken, fall back to random ID
                if (err.type === 'unavailable-id' && preferredId) {
                    console.warn('[P2P] Preferred ID unavailable, falling back to random ID');
                    this.peer.destroy();
                    this.initPlayer(roomCode, name, ticket, null).then(resolve).catch(reject);
                    return;
                }

                if (this.onError) this.onError(err);
                reject(err);
            });

            this.peer.on('disconnected', () => {
                if (this.peer && !this.peer.destroyed) this.peer.reconnect();
            });
        });
    },

    _connectToHost(resolve, reject) {
        const hostId = `loto-${this.roomCode}`;

        // CHANGED: Send lastSessionId in metadata so Host can identify us
        this.hostConnection = this.peer.connect(hostId, {
            reliable: true,
            metadata: {
                name: this._playerName,
                ticket: this._playerTicket,
                lastSessionId: this._lastPeerId // Critical for recovering session on host
            }
        });

        this.hostConnection.on('open', () => {
            console.log('Connected to host');
            this._reconnectAttempts = 0;
            this.saveSession(); // Update session with new current ID

            if (this._lastPeerId && this.onReconnected) {
                this.onReconnected();
            } else if (this.onConnected) {
                this.onConnected();
            }
            if (resolve) resolve();
        });

        this.hostConnection.on('data', (data) => this.handleMessage(data));

        this.hostConnection.on('close', () => {
            console.log('Disconnected from host');
            this._attemptReconnect();
        });

        this.hostConnection.on('error', (err) => {
            if (reject) reject(err);
        });

        setTimeout(() => {
            if (this.hostConnection && !this.hostConnection.open) {
                if (reject) reject(new Error('Connection timeout - room not found'));
            }
        }, 10000);
    },

    _attemptReconnect() {
        if (this._reconnectAttempts >= this._maxReconnectAttempts) {
            if (this.onDisconnected) this.onDisconnected();
            return;
        }

        this._reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 8000);

        if (window.Game) {
            Game.showToast(`Đang thử kết nối lại... (${this._reconnectAttempts}/${this._maxReconnectAttempts})`, 'info');
        }

        setTimeout(() => {
            if (this.peer && !this.peer.destroyed) {
                this._connectToHost(null, null);
            }
        }, delay);
    },

    handleMessage(data, conn = null) {
        switch (data.type) {
            case 'numberDrawn':
                if (this.onNumberDrawn) this.onNumberDrawn(data.number, data.text);
                break;
            case 'welcome':
                if (this.onWelcome) this.onWelcome(data);
                break;
            case 'winClaim':
                if (this.onWinClaim && this.isHost && conn) this.onWinClaim(conn.peer);
                break;
            case 'winConfirmed':
                if (window.Game) Game.showWin(data.winnerName);
                break;
            case 'winRejected':
                if (this.onWinRejected) this.onWinRejected();
                break;
            case 'ticketUpdate':
                if (this.onTicketUpdate && this.isHost) this.onTicketUpdate(conn.peer, data.ticket);
                break;
            case 'waitSignal':
                if (this.isHost) {
                    let playerName = data.playerId.substr(0, 4);
                    if (window.Game && window.Game.players.has(data.playerId)) {
                        playerName = window.Game.players.get(data.playerId).name;
                    }
                    const waitMsg = { type: 'toast', message: `⚠️ ${playerName} đang ĐỢI!`, style: 'warning' };
                    if (window.Game) Game.showToast(waitMsg.message, 'info');
                    this.connections.forEach((c) => { if (c.open) c.send(waitMsg); });
                    if (this.onWaitSignal) this.onWaitSignal(data.playerId);
                }
                break;
            case 'toast':
                if (window.Game) Game.showToast(data.message, data.style);
                break;
            case 'gameReset':
                if (window.Game) Game.resetGame();
                break;
            case 'ping':
                if (conn && conn.open) conn.send({ type: 'pong' });
                break;
            case 'emote':
                if (this.onEmote) this.onEmote(data.emoji, data.senderId);
                if (this.isHost) this.broadcastEmote(data.emoji, conn ? conn.peer : data.senderId);
                break;
            case 'shout':
                if (this.onShout) this.onShout(data.text, data.senderId);
                if (this.isHost) this.broadcastShout(data.text, conn ? conn.peer : data.senderId);
                break;
        }
    },

    broadcastNumber(number, text) {
        if (!this.isHost) return;
        const message = { type: 'numberDrawn', number, text };
        this.connections.forEach((conn) => { if (conn.open) conn.send(message); });
    },

    claimWin() {
        if (this.isHost || !this.hostConnection) return;
        this.hostConnection.send({ type: 'winClaim', playerId: this.peer.id });
    },

    confirmWin(winnerName) {
        if (!this.isHost) return;
        const message = { type: 'winConfirmed', winnerName };
        this.connections.forEach((conn) => { if (conn.open) conn.send(message); });
    },

    rejectWin(playerId) {
        if (!this.isHost) return;
        const conn = this.connections.get(playerId);
        if (conn && conn.open) conn.send({ type: 'winRejected' });
    },

    sendTicketUpdate(ticket) {
        if (this.isHost || !this.hostConnection) return;
        // CHANGED: Update local state so saveSession works correctly
        this._playerTicket = ticket;
        this.hostConnection.send({ type: 'ticketUpdate', ticket: ticket });
        this.saveSession();
    },

    broadcastReset() {
        if (!this.isHost) return;
        const message = { type: 'gameReset' };
        this.connections.forEach(conn => { if (conn.open) conn.send(message); });
    },

    broadcastWait() {
        if (this.isHost || !this.hostConnection) return;
        this.hostConnection.send({ type: 'waitSignal', playerId: this.peer.id });
    },

    broadcastToast(text, type = 'info') {
        if (!this.isHost) return;
        const message = { type: 'toast', message: text, style: type };
        this.connections.forEach(conn => { if (conn.open) conn.send(message); });
    },

    broadcastEmote(emoji, senderId) {
        if (!this.isHost) return;
        const message = { type: 'emote', emoji, senderId };
        this.connections.forEach((conn) => {
            if (conn.open && conn.peer !== senderId) conn.send(message);
        });
    },

    // Throttling to prevent spam
    _lastEmoteTime: 0,
    _lastShoutTime: 0,
    EMOTE_COOLDOWN: 1000, // 1 second
    SHOUT_COOLDOWN: 2000, // 2 seconds

    sendEmote(emoji) {
        const now = Date.now();
        if (now - this._lastEmoteTime < this.EMOTE_COOLDOWN) return;
        this._lastEmoteTime = now;

        if (this.isHost) {
            this.broadcastEmote(emoji, 'HOST');
        } else if (this.hostConnection) {
            this.hostConnection.send({ type: 'emote', emoji, senderId: this.peer.id });
        }
    },

    broadcastShout(text, senderId) {
        if (!this.isHost) return;
        const message = { type: 'shout', text, senderId };
        this.connections.forEach((conn) => {
            if (conn.open && conn.peer !== senderId) conn.send(message);
        });
    },

    sendShout(text) {
        const now = Date.now();
        if (now - this._lastShoutTime < this.SHOUT_COOLDOWN) return;
        this._lastShoutTime = now;

        if (this.isHost) {
            this.broadcastShout(text, 'HOST');
        } else if (this.hostConnection) {
            this.hostConnection.send({ type: 'shout', text, senderId: this.peer.id });
        }
    },

    disconnect(clearSessionData = true) {
        if (this.hostConnection) this.hostConnection.close();
        this.connections.forEach((conn) => conn.close());
        this.connections.clear();
        if (this.peer) this.peer.destroy();

        this.peer = null;
        this.hostConnection = null;
        this.isHost = false;
        this.roomCode = null;

        if (clearSessionData) this.clearSession();
    }
};

window.P2P = P2P;