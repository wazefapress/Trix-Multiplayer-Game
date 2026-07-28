const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// خدمة ملفات الواجهة الساكنة (index.html) تلقائياً
app.use(express.static(__dirname));

const rooms = {};

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    socket.on('create-room', (playerName) => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomCode] = {
            players: [{ id: socket.id, name: playerName, seat: 0 }],
            status: 'waiting'
        };
        socket.join(roomCode);
        socket.emit('room-created', { roomCode, seat: 0 });
        io.to(roomCode).emit('update-players', rooms[roomCode].players);
    });

    socket.on('join-room', ({ roomCode, playerName }) => {
        const room = rooms[roomCode];
        if (!room) {
            socket.emit('error-msg', 'الغرفة غير موجودة!');
            return;
        }
        if (room.players.length >= 4) {
            socket.emit('error-msg', 'الغرفة ممتلئة بالفعل!');
            return;
        }

        const seat = room.players.length;
        room.players.push({ id: socket.id, name: playerName, seat });
        socket.join(roomCode);

        socket.emit('room-joined', { roomCode, seat, players: room.players });
        io.to(roomCode).emit('update-players', room.players);

        if (room.players.length === 4) {
            room.status = 'playing';
            io.to(roomCode).emit('start-game', room.players);
        }
    });

    socket.on('play-card', ({ roomCode, card, nextTurn }) => {
        socket.to(roomCode).emit('card-played', { card, nextTurn });
    });

    socket.on('select-contract', ({ roomCode, contract, kingdomOwner }) => {
        socket.to(roomCode).emit('contract-selected', { contract, kingdomOwner });
    });

    // استقبال رسائل المحادثة وبثها للاعبين الآخرين في نفس الغرفة
    socket.on('send-chat-message', ({ roomCode, message, senderName }) => {
        socket.to(roomCode).emit('receive-chat-message', {
            sender: senderName || 'لاعب',
            text: message
        });
    });

    socket.on('disconnect', () => {
        console.log('قطع الاتصال:', socket.id);
        for (const roomCode in rooms) {
            rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
            if (rooms[roomCode].players.length === 0) {
                delete rooms[roomCode];
            } else {
                io.to(roomCode).emit('update-players', rooms[roomCode].players);
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل بنجاح على المنفذ ${PORT}`);
});