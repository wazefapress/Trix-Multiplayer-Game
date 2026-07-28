const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// تقديم الملفات الثابتة (index.html, الأصوات, الصور)
app.use(express.static(__dirname));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`لاعب متصل: ${socket.id}`);

    // الانضمام لغرفة لعب
    socket.on('join-room', ({ roomCode, playerName }) => {
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                players: [],
                gameState: null
            };
        }

        const room = rooms[roomCode];
        let seat = room.players.findIndex(p => p.id === socket.id);

        if (seat === -1 && room.players.length < 4) {
            seat = room.players.length;
            room.players.push({
                id: socket.id,
                name: playerName || `لاعب ${seat + 1}`,
                seat: seat
            });
        }

        socket.emit('room-joined', {
            seat: seat,
            players: room.players,
            roomCode: roomCode
        });

        io.to(roomCode).emit('update-players', room.players);
    });

    // إشارة رمي ورقة من لاعب
    socket.on('play-card', ({ roomCode, card, playerIdx, nextTurn }) => {
        socket.to(roomCode).emit('card-played', { card, playerIdx, nextTurn });
    });

    // تمرير الدور التلقائي عند عدم توفر أوراق صالحة أو انتهاء أوراق اللاعب
    socket.on('pass-turn', ({ roomCode, nextTurn }) => {
        socket.to(roomCode).emit('turn-passed', { nextTurn });
    });

    // اختيار عقد اللعب
    socket.on('select-contract', ({ roomCode, contract, kingdomOwner }) => {
        io.to(roomCode).emit('contract-selected', { contract, kingdomOwner });
    });

    // إشارة نهاية الجولة ونقل النتائج وتحديث الحالة لباقي اللاعبين
    socket.on('round-ended', ({ roomCode, gameState }) => {
        if (rooms[roomCode]) {
            rooms[roomCode].gameState = gameState;
        }
        // إرسال لجميع من في الغرفة عدا المُرسل
        socket.to(roomCode).emit('round-ended-sync', { gameState });
    });

    // إشارة بداية جولة جديدة
    socket.on('start-round', ({ roomCode, gameState }) => {
        if (rooms[roomCode]) {
            rooms[roomCode].gameState = gameState;
        }
        io.to(roomCode).emit('round-started', gameState);
    });

    // استقبال وإرسال رسائل الشات
    socket.on('send-chat-message', ({ roomCode, message, senderName }) => {
        socket.to(roomCode).emit('receive-chat-message', {
            sender: senderName,
            text: message
        });
    });

    // التعامل مع قطع الاتصال
    socket.on('disconnect', () => {
        console.log(`لاعب غادر: ${socket.id}`);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                io.to(roomCode).emit('update-players', room.players);
                if (room.players.length === 0) {
                    delete rooms[roomCode];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`سيرفر التركس يعمل بنجاح على المنفذ ${PORT}`);
});