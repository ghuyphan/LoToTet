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

    // Callbacks
    onPlayerJoin: null,
    onPlayerLeave: null,
    onNumberDrawn: null,
    onWinClaim: null,
    onConnected: null,
    onDisconnected: null,
    onWelcome: null, // New callback
    onTicketUpdate: null, // Host side callback
    onError: null,

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
    async initPlayer(roomCode, name, ticket) {
        this.isHost = false;
        this.roomCode = roomCode.toUpperCase();

        return new Promise((resolve, reject) => {
            // Create peer with random ID
            this.peer = new Peer(this.config);

            this.peer.on('open', (id) => {
                console.log('Player peer opened:', id);

                // Connect to host with metadata (Name + Ticket)
                const hostId = `loto-${this.roomCode}`;
                this.hostConnection = this.peer.connect(hostId, {
                    reliable: true,
                    metadata: {
                        name: name,
                        ticket: ticket
                    }
                });

                this.hostConnection.on('open', () => {
                    console.log('Connected to host');
                    if (this.onConnected) this.onConnected();
                    resolve();
                });

                this.hostConnection.on('data', (data) => {
                    this.handleMessage(data);
                });

                this.hostConnection.on('close', () => {
                    console.log('Disconnected from host');
                    if (this.onDisconnected) this.onDisconnected();
                });

                this.hostConnection.on('error', (err) => {
                    console.error('Connection to host failed:', err);
                    reject(err);
                });

                // Add timeout for connection
                setTimeout(() => {
                    if (!this.hostConnection.open) {
                        reject(new Error('Connection timeout - room not found'));
                    }
                }, 10000);
            });

            this.peer.on('error', (err) => {
                console.error('Peer error:', err);
                if (this.onError) this.onError(err);
                reject(err);
            });
        });
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
                if (this.onWinClaim && this.isHost) {
                    this.onWinClaim(data.playerId, data.ticket);
                }
                break;

            case 'winConfirmed':
                if (window.Game) {
                    Game.showWin(data.winnerName);
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

    // Get player count
    getPlayerCount() {
        return this.connections.size;
    },

    // Disconnect and cleanup
    disconnect() {
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
    }
};
window.P2P = P2P;
