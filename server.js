const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// رسالة بسيطة للتأكد من عمل السيرفر عند زيارة رابطه المباشر
app.get('/', (req, res) => {
    res.send('Trix Multiplayer Game Server is Running on Render!');
});

// إعداد السوكيت مع تفعيل CORS للسماح لـ Cloudflare بالاتصال
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const rooms = {};

// توليد أوراق اللعب
const suits = ['♥', '♦', '♣', '♠'];
function generateDeck() {
    let deck = [];
    suits.forEach(suit => {
        for (let i = 2; i <= 14; i++) {
            deck.push({ suit, value: i });
        }
    });
    return deck;
}

function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

io.on('connection', (socket) => {
    
    // إنشاء غرفة
    socket.on('create-room', (data) => {
        const { playerName, playerId } = data;
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        rooms[roomId] = {
            players: {},
            playerOrder: [],
            hands: {},
            scores: {},
            totalScores: {},
            kingIndex: 0,
            playedContracts: [],
            kingdomCount: 0,
            currentTrick: [],
            activeContract: null,
            currentTurnIndex: 0,
            doubledCards: {},
            gameState: 'waiting'
        };

        joinRoom(socket, roomId, playerName, playerId);
        socket.emit('room-created', { roomId: roomId });
    });

    // الانضمام لغرفة
    socket.on('join-room', (data) => {
        const { roomId, playerName, playerId } = data;
        const room = rooms[roomId];
        
        if (!room) return socket.emit('error', 'الغرفة غير موجودة. تأكد من الكود.');
        
        // إعادة الاتصال في حال تحديث الصفحة
        if (room.players[playerId]) {
            room.players[playerId].socketId = socket.id;
            socket.join(roomId);
            
            if (room.gameState === 'playing') {
                socket.emit('game-ready');
            }

            socket.emit('sync-game-state', {
                hands: room.hands[playerId] || [],
                scores: room.scores,
                activeContract: room.activeContract,
                currentTrick: room.currentTrick
            });
            return;
        }

        if (Object.keys(room.players).length >= 4) return socket.emit('error', 'عذراً، الغرفة ممتلئة (4 لاعبين).');
        
        socket.playerId = playerId;
        joinRoom(socket, roomId, playerName, playerId);
    });

    function joinRoom(socket, roomId, playerName, playerId) {
        const room = rooms[roomId];
        room.players[playerId] = { id: playerId, name: playerName, socketId: socket.id };
        room.playerOrder.push(playerId);
        room.totalScores[playerId] = 0;
        socket.join(roomId);

        io.to(roomId).emit('lobby-updated', Object.values(room.players).map(p => p.name));

        if (room.playerOrder.length === 4) {
            room.gameState = 'playing';
            io.to(roomId).emit('game-ready');
            startNewRound(roomId);
        }
    }

    function startNewRound(roomId) {
        const room = rooms[roomId];
        let deck = shuffle(generateDeck());
        room.currentTrick = [];
        room.doubledCards = {};
        
        room.playerOrder.forEach((pid, index) => {
            room.hands[pid] = deck.slice(index * 13, (index + 1) * 13);
            room.scores[pid] = 0;
            io.to(room.players[pid].socketId).emit('receive-cards', room.hands[pid]);
        });

        const kingId = room.playerOrder[room.kingIndex];
        io.to(room.players[kingId].socketId).emit('request-contract', room.playedContracts);
        io.to(roomId).emit('message', `بانتظار صاحب المملكة لاختيار العقد...`);
    }

    socket.on('select-contract', (data) => {
        const { roomId, contract, doubled } = data;
        const room = rooms[roomId];
        room.activeContract = contract;
        room.playedContracts.push(contract);
        room.currentTurnIndex = room.kingIndex;
        
        if (doubled) room.doubledCards = doubled;

        io.to(roomId).emit('contract-started', contract);
        io.to(roomId).emit('update-turn', room.playerOrder[room.currentTurnIndex]);
    });

    socket.on('play-card', (data) => {
        const { roomId, card, playerId } = data;
        const room = rooms[roomId];

        if (room.playerOrder[room.currentTurnIndex] !== playerId) return;

        room.hands[playerId] = room.hands[playerId].filter(c => !(c.suit === card.suit && c.value === card.value));
        room.currentTrick.push({ player: playerId, card: card });
        
        io.to(roomId).emit('card-played', { player: playerId, card: card });

        if (room.currentTrick.length === 4) {
            setTimeout(() => resolveTrick(roomId), 1500);
        } else {
            room.currentTurnIndex = (room.currentTurnIndex + 1) % 4;
            io.to(roomId).emit('update-turn', room.playerOrder[room.currentTurnIndex]);
        }
    });

    function resolveTrick(roomId) {
        const room = rooms[roomId];
        const leadingSuit = room.currentTrick[0].card.suit;
        let highestVal = -1;
        let winnerId = room.currentTrick[0].player;

        room.currentTrick.forEach(item => {
            if (item.card.suit === leadingSuit && item.card.value > highestVal) {
                highestVal = item.card.value;
                winnerId = item.player;
            }
        });

        let penalty = 0;
        room.currentTrick.forEach(item => {
            const cardKey = `${item.card.suit}-${item.card.value}`;
            if (room.activeContract === 'king' && item.card.suit === '♥' && item.card.value === 14) {
                penalty -= room.doubledCards[cardKey] ? 150 : 75;
            }
            if (room.activeContract === 'queens' && item.card.value === 12) {
                penalty -= room.doubledCards[cardKey] ? 50 : 25;
            }
            if (room.activeContract === 'dinari' && item.card.suit === '♦') penalty -= 10;
        });
        if (room.activeContract === 'ltoo') penalty -= 15;

        room.scores[winnerId] += penalty;
        room.currentTrick = [];
        room.currentTurnIndex = room.playerOrder.indexOf(winnerId);

        io.to(roomId).emit('trick-resolved', { winner: winnerId, scores: room.scores });

        if (room.hands[room.playerOrder[0]].length === 0) {
            handleRoundEnd(roomId);
        } else {
            io.to(roomId).emit('update-turn', room.playerOrder[room.currentTurnIndex]);
        }
    }

    function handleRoundEnd(roomId) {
        const room = rooms[roomId];
        room.playerOrder.forEach(pid => room.totalScores[pid] += room.scores[pid]);
        
        if (room.playedContracts.length === 5) {
            room.kingIndex++;
            room.kingdomCount++;
            room.playedContracts = [];
        }

        io.to(roomId).emit('round-ended', room.totalScores);

        if (room.kingdomCount === 4) {
            io.to(roomId).emit('game-over', room.totalScores);
        } else {
            setTimeout(() => startNewRound(roomId), 10000);
        }
    }
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});