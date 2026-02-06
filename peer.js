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
            // Disable trickle ICE for better compatibility (slower initial connection but more robust)
            iceTransportPolicy: 'all',
            iceServers: [
                // OpenRelay Project (Free Public TURN) - Enables 4G/5G/Strict network play
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
                // Google Public STUN
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' },
                { urls: 'stun:stun.services.mozilla.com' },
                { urls: 'stun:stun.voiparound.com:3478' },
                { urls: 'stun:stun.voipstunt.com:3478' }
            ]
        }
    },

    // Session Storage Key
    SESSION_KEY: 'loto_session',

    // Visibility state tracking
    _isPageHidden: false,
    _wasConnectedBeforeHidden: false,

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
    onWaitSignal: null, // New: Handler for wait signals
    onEmote: null, // New: Handler for receiving emotes
    onError: null,
    onReconnecting: null, // New: Called when attempting to reconnect
    onReconnected: null,  // New: Called when successfully reconnected

    // =============================================
    // SESSION PERSISTENCE HELPERS
    // =============================================

    saveSession() {
        if (this.isHost) return; // Only players need session persistence

        const session = {
            roomCode: this.roomCode,
            playerName: this._playerName,
            playerTicket: this._playerTicket,
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

    // Check if we have a valid session to restore
    hasRestoredSession() {
        const session = this.loadSession();
        return session !== null && session.roomCode && session.playerTicket;
    },

    // =============================================
    // VISIBILITY API HANDLING
    // =============================================

    initVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this._isPageHidden = true;
                this._wasConnectedBeforeHidden = this.hostConnection && this.hostConnection.open;
                console.log('[Visibility] Page hidden, was connected:', this._wasConnectedBeforeHidden);
            } else {
                this._isPageHidden = false;
                console.log('[Visibility] Page visible');

                // Check connection health after returning
                if (this._wasConnectedBeforeHidden && !this.isHost) {
                    setTimeout(() => this._checkConnectionHealth(), 500);
                }
            }
        });
    },

    _checkConnectionHealth() {
        if (!this.hostConnection || !this.hostConnection.open) {
            console.log('[Visibility] Connection lost while hidden, attempting reconnect...');
            if (this.onReconnecting) this.onReconnecting();
            this._attemptReconnect();
        } else {
            console.log('[Visibility] Connection still healthy');
            // Send a ping to verify connection is truly alive
            try {
                this.hostConnection.send({ type: 'ping' });
            } catch (e) {
                console.log('[Visibility] Ping failed, reconnecting...');
                if (this.onReconnecting) this.onReconnecting();
                this._attemptReconnect();
            }
        }
    },

    // Generate a random 6-character room code
    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing characters
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    },

    // Initialize as host
    async initHost(retryCount = 0) {
        this.isHost = true;
        // If retrying, generate a new code. Otherwise use existing or generate new.
        if (retryCount > 0 || !this.roomCode) {
            this.roomCode = this.generateRoomCode();
        }

        return new Promise((resolve, reject) => {
            // Create peer with room code as ID
            // NOTE: To support 3G/4G or symmetric NATs, you need to add a TURN server here.
            // e.g. { urls: 'turn:your-turn-server.com', username: '...', credential: '...' }
            this.peer = new Peer(`loto-${this.roomCode}`, this.config);

            this.peer.on('open', (id) => {
                console.log('Host peer opened:', id);
                resolve(this.roomCode);
            });

            this.peer.on('connection', (conn) => {
                this.handleNewConnection(conn);
            });

            this.peer.on('error', (err) => {
                console.error('Peer error:', err);
                if (err.type === 'unavailable-id') {
                    // ID taken, retry with new code
                    if (retryCount < 5) {
                        console.log('Room code taken, retrying...');
                        this.peer.destroy();
                        this.initHost(retryCount + 1).then(resolve).catch(reject);
                    } else {
                        reject(new Error('Unable to generate unique room code. Please try again.'));
                    }
                } else {
                    if (this.onError) this.onError(err);
                    reject(err);
                }
            });

            this.peer.on('disconnected', () => {
                console.log('Peer disconnected, attempting reconnect...');
                if (this.peer && !this.peer.destroyed) {
                    this.peer.reconnect();
                }
            });
        });
    },

    // Handle new player connection (host side)
    handleNewConnection(conn) {
        console.log('New connection from:', conn.peer);
        const name = conn.metadata ? conn.metadata.name : null;
        const ticket = conn.metadata ? conn.metadata.ticket : null;

        const onOpen = () => {
            console.log('Connection opened with:', conn.peer);
            console.log('Metadata:', conn.metadata);

            // Store connection
            this.connections.set(conn.peer, conn);

            // Notify host logic (app.js) and register ticket
            let playerData = null;
            if (this.onPlayerJoin) {
                console.log('Calling onPlayerJoin...');
                // onPlayerJoin now returns { ticket, name } (Ticket is just passed back thru)
                playerData = this.onPlayerJoin(conn.peer, this.connections.size, name, ticket);
                console.log('onPlayerJoin returned:', playerData ? 'Data' : 'Null');
            }

            // Send Welcome Packet (Ticket + Game State)
            if (window.Game && playerData) {
                console.log('Sending Welcome packet...');
                conn.send({
                    type: 'welcome',
                    name: playerData.name,
                    ticket: playerData.ticket,
                    gameState: {
                        calledNumbers: Array.from(Game.calledNumbers),
                        gameStarted: Game.gameStarted
                    }
                });
                console.log('Welcome packet sent');
            } else {
                console.warn('Cannot send welcome: Game instance or PlayerData missing');
            }
        };

        if (conn.open) {
            console.log('Connection already open, initializing immediately');
            onOpen();
        } else {
            conn.on('open', onOpen);
        }

        conn.on('data', (data) => {
            this.handleMessage(data, conn);
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            if (this.onPlayerLeave) {
                this.onPlayerLeave(conn.peer, this.connections.size);
            }
        });

        conn.on('error', (err) => {
            console.error('Connection level error:', err);
        });

        // Deep Debugging: Monitor ICE state
        if (conn.peerConnection) {
            conn.peerConnection.oniceconnectionstatechange = () => {
                const state = conn.peerConnection.iceConnectionState;
                console.log(`[ICE] Connection state change: ${state}`);

                if (state === 'failed' || state === 'disconnected') {
                    console.warn('[ICE] Connection failed. Likely a Firewall/NAT issue.');
                    if (window.Game) {
                        Game.showToast(`Kết nối không ổn định. Hãy đảm bảo cả 2 thiết bị cùng dùng chung WiFi!`, 'warning');
                    }
                }
            };

            conn.peerConnection.onconnectionstatechange = () => {
                console.log(`[Peers] Connection state change: ${conn.peerConnection.connectionState}`);
            };
        } else {
            console.warn('No underlying peerConnection found for debugging.');
        }

        conn.on('error', (err) => {
            console.error('Connection error:', err);
            this.connections.delete(conn.peer);
        });
    },

    // Initialize as player (join a room)
    async initPlayer(roomCode, name, ticket, isReconnect = false) {
        this.isHost = false;
        this.roomCode = roomCode.toUpperCase();
        this._reconnectAttempts = 0;
        this._maxReconnectAttempts = 5; // Increased from 3 for better resilience
        this._playerName = name;
        this._playerTicket = ticket;
        this._isReconnect = isReconnect;

        // Initialize visibility handler (only once)
        if (!this._visibilityHandlerInit) {
            this.initVisibilityHandler();
            this._visibilityHandlerInit = true;
        }

        return new Promise((resolve, reject) => {
            // Reuse existing peer if still valid
            if (this.peer && !this.peer.destroyed) {
                console.log('Reusing existing peer:', this.peer.id);
                this._connectToHost(resolve, reject);
                return;
            }

            // Create peer with random ID
            this.peer = new Peer(this.config);

            this.peer.on('open', (id) => {
                console.log('Player peer opened:', id);
                this._connectToHost(resolve, reject);
            });

            this.peer.on('error', (err) => {
                console.error('Peer error:', err);
                if (this.onError) this.onError(err);
                reject(err);
            });

            this.peer.on('disconnected', () => {
                console.log('Peer disconnected from signaling server, attempting reconnect...');
                if (this.peer && !this.peer.destroyed) {
                    this.peer.reconnect();
                }
            });
        });
    },

    // Internal method to connect to host (supports reconnection)
    _connectToHost(resolve, reject) {
        const hostId = `loto-${this.roomCode}`;
        const isReconnecting = this._reconnectAttempts > 0 || this._isReconnect;

        this.hostConnection = this.peer.connect(hostId, {
            reliable: true,
            metadata: {
                name: this._playerName,
                ticket: this._playerTicket,
                isReconnect: isReconnecting // Tell host this is a returning player
            }
        });

        this.hostConnection.on('open', () => {
            console.log('Connected to host', isReconnecting ? '(reconnect)' : '(new)');
            this._reconnectAttempts = 0; // Reset on successful connection
            this._isReconnect = false;

            // Save session for future reconnections
            this.saveSession();

            if (isReconnecting && this.onReconnected) {
                this.onReconnected();
            } else if (this.onConnected) {
                this.onConnected();
            }
            if (resolve) resolve();
        });

        this.hostConnection.on('data', (data) => {
            this.handleMessage(data);
        });

        this.hostConnection.on('close', () => {
            console.log('Disconnected from host');
            this._attemptReconnect();
        });

        this.hostConnection.on('error', (err) => {
            console.error('Connection to host failed:', err);
            if (reject) reject(err);
        });

        // Add timeout for connection
        setTimeout(() => {
            if (this.hostConnection && !this.hostConnection.open) {
                if (reject) reject(new Error('Connection timeout - room not found'));
            }
        }, 10000);
    },

    // Attempt to reconnect with exponential backoff
    _attemptReconnect() {
        if (this._reconnectAttempts >= this._maxReconnectAttempts) {
            console.log('Max reconnection attempts reached');
            if (this.onDisconnected) this.onDisconnected();
            return;
        }

        this._reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 8000); // 1s, 2s, 4s (max 8s)

        console.log(`Reconnection attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts} in ${delay}ms`);

        if (window.Game) {
            Game.showToast(`Đang thử kết nối lại... (${this._reconnectAttempts}/${this._maxReconnectAttempts})`, 'info');
        }

        setTimeout(() => {
            if (this.peer && !this.peer.destroyed) {
                this._connectToHost(null, null);
            }
        }, delay);
    },

    // Handle incoming messages
    handleMessage(data, conn = null) {
        console.log('Received:', data);

        switch (data.type) {
            case 'numberDrawn':
                if (this.onNumberDrawn) {
                    this.onNumberDrawn(data.number, data.text);
                }
                break;

            case 'welcome':
                if (this.onWelcome) {
                    this.onWelcome(data);
                }
                break;

            case 'gameState':
                // Keeping this for potential re-sync scenarios, 
                // but primary sync is now via 'welcome'
                if (window.Game) {
                    Game.syncState(data.calledNumbers, data.gameStarted);
                }
                break;

            case 'winClaim':
                if (this.onWinClaim && this.isHost && conn) {
                    // Use conn.peer (authoritative) instead of data.playerId (client-sent, can be null)
                    this.onWinClaim(conn.peer);
                }
                break;

            case 'winConfirmed':
                if (window.Game) {
                    Game.showWin(data.winnerName);
                }
                break;

            case 'winRejected':
                if (this.onWinRejected) {
                    this.onWinRejected();
                }
                break;

            case 'ticketUpdate':
                if (this.onTicketUpdate && this.isHost) {
                    this.onTicketUpdate(conn.peer, data.ticket);
                }
                break;

            case 'waitSignal':
                if (this.isHost) {
                    // Host acknowledges wait signal and broadcasts a toast to everyone
                    // We can reuse confirmWin logic but just for toast
                    const waitMsg = {
                        type: 'toast',
                        message: `Người chơi ${data.playerId.substr(0, 4)} đang ĐỢI!`,
                        style: 'info'
                    };

                    // Show for host
                    if (window.Game) Game.showToast(waitMsg.message, 'info');

                    // Broadcast to others
                    this.connections.forEach((conn) => {
                        if (conn.open) conn.send(waitMsg);
                    });

                    // Trigger Host UI update
                    if (this.onWaitSignal) {
                        this.onWaitSignal(data.playerId);
                    }
                }
                break;

            case 'toast':
                // Generic toast handler for clients
                if (window.Game) {
                    Game.showToast(data.message, data.style);
                }
                break;

            case 'gameReset':
                if (window.Game) {
                    Game.reset();
                }
                break;

            case 'ping':
                // Respond to ping with pong (for connection health checks)
                if (conn && conn.open) {
                    conn.send({ type: 'pong' });
                }
                break;

            case 'pong':
                // Connection is alive, nothing to do
                console.log('[Ping] Pong received, connection healthy');
                break;

            case 'emote':
                if (this.onEmote) {
                    this.onEmote(data.emoji, data.senderId); // Use senderId if available to position (optional features)
                }
                // If Host, propagate to others
                if (this.isHost) {
                    this.broadcastEmote(data.emoji, conn ? conn.peer : data.senderId);
                }
                break;
        }
    },

    // Broadcast number to all players (host only)
    broadcastNumber(number, text) {
        if (!this.isHost) return;

        const message = {
            type: 'numberDrawn',
            number: number,
            text: text
        };

        this.connections.forEach((conn) => {
            if (conn.open) {
                conn.send(message);
            }
        });
    },

    // Claim win (player only)
    claimWin() {
        if (this.isHost || !this.hostConnection) return;

        this.hostConnection.send({
            type: 'winClaim',
            playerId: this.peer.id
            // ticket: removed (Host Authority)
        });
    },

    // Confirm win to all players (host only)
    confirmWin(winnerName) {
        if (!this.isHost) return;

        const message = {
            type: 'winConfirmed',
            winnerName: winnerName
        };

        this.connections.forEach((conn) => {
            if (conn.open) {
                conn.send(message);
            }
        });
    },

    // Reject win for a specific player (host only)
    rejectWin(playerId) {
        if (!this.isHost) return;

        const conn = this.connections.get(playerId);
        if (conn && conn.open) {
            conn.send({ type: 'winRejected' });
        }
    },

    // Send ticket update (player only)
    sendTicketUpdate(ticket) {
        if (this.isHost || !this.hostConnection) return;

        this.hostConnection.send({
            type: 'ticketUpdate',
            ticket: ticket
        });
    },

    // Broadcast game reset (host only)
    broadcastReset() {
        if (!this.isHost) return;

        this.connections.forEach((conn) => {
            if (conn.open) {
                conn.send({ type: 'gameReset' });
            }
        });
    },

    // Broadcast wait signal (Player -> Host)
    broadcastWait() {
        if (this.isHost || !this.hostConnection) return;

        this.hostConnection.send({
            type: 'waitSignal',
            playerId: this.peer.id
        });
    },

    // Broadcast emote (Host -> All Players)
    broadcastEmote(emoji, senderId) {
        if (!this.isHost) return;

        const message = {
            type: 'emote',
            emoji: emoji,
            senderId: senderId
        };

        this.connections.forEach((conn) => {
            if (conn.open && conn.peer !== senderId) { // Don't echo back to sender if possible (optional)
                // Actually, simpler to echo to everyone including sender to sync timing? 
                // Or sender shows immediately.
                // Let's send to everyone except sender to save bandwidth, 
                // assuming sender shows it locally immediately.
                conn.send(message);
            }
        });
    },

    // Send emote (Player -> Host)
    sendEmote(emoji) {
        if (this.isHost) {
            // Host sending emote: Broadcast to all players
            this.broadcastEmote(emoji, 'HOST');
        } else if (this.hostConnection) {
            this.hostConnection.send({
                type: 'emote',
                emoji: emoji,
                senderId: this.peer.id
            });
        }
    },

    // Get player count
    getPlayerCount() {
        return this.connections.size;
    },

    // Disconnect and cleanup
    disconnect(clearSessionData = true) {
        if (this.hostConnection) {
            this.hostConnection.close();
        }

        this.connections.forEach((conn) => {
            conn.close();
        });
        this.connections.clear();

        if (this.peer) {
            this.peer.destroy();
        }

        this.peer = null;
        this.hostConnection = null;
        this.isHost = false;
        this.roomCode = null;

        // Clear session data (unless we're reconnecting)
        if (clearSessionData) {
            this.clearSession();
        }
    }
};
window.P2P = P2P;
