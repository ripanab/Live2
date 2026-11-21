const express = require('express');
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// In-memory room state
const rooms = {};

function getRoom(roomKey) {
  if (!rooms[roomKey]) {
    rooms[roomKey] = {
      users: {},
      signals: {},
      chat: [],
      boardStrokes: [],
      kicked: {}
    };
  }
  return rooms[roomKey];
}

// Clean up disconnected users & empty rooms every 5 seconds
setInterval(() => {
  const now = Date.now();
  for (const key in rooms) {
    const room = rooms[key];
    for (const id in room.users) {
      if (now - room.users[id].lastSeen > 12000) {
        delete room.users[id];
        delete room.signals[id];
      }
    }
    if (Object.keys(room.users).length === 0) {
      delete rooms[key];
    }
  }
}, 5000);

// 1. Join Room
app.post('/api/join', (req, res) => {
  const { roomName, passcode, userId, userName, role } = req.body;
  const roomKey = `${roomName.trim().toLowerCase()}::${passcode.trim()}`;
  const room = getRoom(roomKey);

  if (room.kicked[userId]) {
    return res.status(403).json({ error: 'You were removed by the teacher.' });
  }

  room.users[userId] = {
    name: userName || 'Student',
    role: role === 'teacher' ? 'teacher' : 'student',
    lastSeen: Date.now(),
    hand: false,
    forceMute: false
  };
  if (!room.signals[userId]) room.signals[userId] = [];

  const existingUsers = {};
  for (const id in room.users) {
    if (id !== userId) existingUsers[id] = room.users[id];
  }

  res.json({
    users: existingUsers,
    chat: room.chat.slice(-40),
    boardStrokes: room.boardStrokes
  });
});

// 2. WebRTC Signaling
app.post('/api/signal', (req, res) => {
  const { roomName, passcode, sender, target, signal } = req.body;
  const roomKey = `${roomName.trim().toLowerCase()}::${passcode.trim()}`;
  const room = getRoom(roomKey);

  if (room.signals[target]) {
    room.signals[target].push({ sender, signal });
  }
  res.json({ ok: true });
});

// 3. Actions (Chat, Hand Raise, Whiteboard, Teacher Controls)
app.post('/api/action', (req, res) => {
  const { roomName, passcode, userId, userName, type, text, hand, targetId, stroke } = req.body;
  const roomKey = `${roomName.trim().toLowerCase()}::${passcode.trim()}`;
  const room = getRoom(roomKey);
  const actor = room.users[userId];

  if (!actor) return res.status(403).json({ error: 'Not in room' });

  if (type === 'chat' && text) {
    room.chat.push({
      id: Date.now() + Math.random(),
      sender: userName,
      role: actor.role,
      text: text.slice(0, 300)
    });
    if (room.chat.length > 60) room.chat.shift();
  } else if (type === 'hand') {
    actor.hand = !!hand;
  } else if (type === 'draw' && stroke) {
    room.boardStrokes.push(stroke);
    if (room.boardStrokes.length > 1500) room.boardStrokes.splice(0, 300);
  } else if (type === 'clearBoard' && actor.role === 'teacher') {
    room.boardStrokes = [];
  } else if (type === 'muteAll' && actor.role === 'teacher') {
    for (const id in room.users) {
      if (room.users[id].role !== 'teacher') {
        room.users[id].forceMute = true;
      }
    }
  } else if (type === 'muteUser' && actor.role === 'teacher' && room.users[targetId]) {
    room.users[targetId].forceMute = true;
  } else if (type === 'kickUser' && actor.role === 'teacher' && room.users[targetId]) {
    room.kicked[targetId] = true;
    delete room.users[targetId];
    delete room.signals[targetId];
  }

  res.json({ ok: true });
});

// 4. Poll State
app.get('/api/poll', (req, res) => {
  const { roomName, passcode, userId } = req.query;
  const roomKey = `${roomName.trim().toLowerCase()}::${passcode.trim()}`;
  const room = getRoom(roomKey);

  if (room.kicked[userId]) {
    return res.json({ kicked: true });
  }

  if (room.users[userId]) {
    room.users[userId].lastSeen = Date.now();
  }

  const signals = room.signals[userId] || [];
  room.signals[userId] = [];

  const forceMute = room.users[userId] ? room.users[userId].forceMute : false;
  if (room.users[userId]) room.users[userId].forceMute = false;

  res.json({
    kicked: false,
    forceMute,
    signals,
    users: room.users,
    chat: room.chat.slice(-40),
    boardStrokes: room.boardStrokes
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Live Class Server running on port ${PORT}`);
});
