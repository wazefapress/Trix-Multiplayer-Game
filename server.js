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

// قراءة ملفات الواجهة من نفس المجلد الحالي مباشرة
app.use(express.static(__dirname));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`مستخدم متصل: ${socket.id}`);

    function generateRoomCode() {
        return Math.random().toString(36).substring(2, 7).toUpperCase();
    }

    socket.on('create-room', (playerName) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            host: socket.id,
            players: [{ id: socket.id, name: playerName, seat: 0 }],
            status: 'waiting'
        };
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.seat = 0;
        socket.emit('room-created', { roomCode, seat: 0 });
    });

    socket.on('join-room', ({ roomCode, playerName }) => {
        const room = rooms[roomCode];
        if (!room) {
            socket.emit('error-msg', 'الغرفة غير موجودة!');
            return;
        }
        if (room.players.length >= 4) {
            socket.emit('error-msg', 'الغرفة ممتلئة (4 لاعبين كحد أقصى)!');
            return;
        }
        if (room.status !== 'waiting') {
            socket.emit('error-msg', 'اللعبة قد بدأت بالفعل!');
            return;
        }

        const seat = room.players.length;
        room.players.push({ id: socket.id, name: playerName, seat: seat });
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.seat = seat;

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
        io.to(roomCode).emit('contract-selected', { contract, kingdomOwner });
    });

    socket.on('disconnect', () => {
        const roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode]) {
            rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
            if (rooms[roomCode].players.length === 0) {
                delete rooms[roomCode];
            } else {
                io.to(roomCode).emit('update-players', rooms[roomCode].players);
            }
        }
        console.log(`مستخدم غادر: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل على المنفذ ${PORT}`);
});