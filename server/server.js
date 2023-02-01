const express = require("express");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const twilio = require("twilio");

///////
const PORT = process.env.PORT || 5002;
///////
const app = express();
const server = http.createServer(app);
app.use(cors());
//////////////////
let connectedUsers = [];
let rooms = [];

/**
 * model
 * connectedUsers = [user1, user2,...]
 * user1 = newUser
 * newUser = {
    identity,
    id: uuidv4(),
    socketId: socket.id,
    roomId: roomId,
  };
 * rooms = [room1, room2, room3];
 * room1 = {
    id: roomId,
    connectedUsers: [newUser],
  };
 */

//create route to check room exists
app.get("/api/room-exists/:roomId", (req, res) => {
  //todo

  const { roomId } = req.params;
  //console.log("tìm roomid ::: ", roomId);
  const room = rooms.find((room) => room.id === roomId);

  if (room) {
    //send response that room exists
    if (room.connectedUsers.length > 3) {
      return res.send({ roomExists: true, full: true });
    } else {
      return res.send({ roomExists: true, full: false });
    }
  } else {
    //send response that room not exists

    return res.send({ roomExists: false });
  }
});

////////////////////TURN SEVER
app.get("/api/get-turn-credentials", (req, res) => {
  // đoạn này nếu publish sẽ bị block
  //const accountSid = "ACf0bd24b02e9a5b2279f17fd5b03171e8";
  //const authToken = "ce93ac86e50b1e70f6b7279b5b51c6d7";
  ///
  const client = twilio(accountSid, authToken);

  try {
    client.tokens.create().then((token) => {
      responseToken = token;
      res.send({ token });
    });
  } catch (error) {
    console.log("lổi twilio :: ", error);
    res.send({ token: null });
  }
});
////////////////////END TURN SERVER ///////////////////////

//////////////////
const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("user connected on server :: ", socket.id);

  socket.on("create-new-room", (data) => {
    // console.log("host is creating room ::", data);
    createNewRoomHandler(data, socket);
  });

  socket.on("join-room", (data) => {
    //todo
    joinRoomHandler(data, socket);
  });

  socket.on("conn-signal", (data) => {
    //todo
    signalingHanlder(data, socket);
  });
  socket.on("conn-init", (data) => {
    initializeConnectionHandler(data, socket);
  });
  socket.on("disconnect", () => {
    disconnectHandler(socket);
  });
});

const createNewRoomHandler = (data, socket) => {
  console.log("host is creating a new room ->createNewRoomHandler :: ", data);

  const { identity, onlyAudio } = data;
  const roomId = uuidv4();

  // create new user
  const newUser = {
    identity,
    id: uuidv4(),
    socketId: socket.id,
    roomId: roomId,
    onlyAudio,
  };

  ///push that user to connectedUsers
  //connectedUsers = [...connectedUsers, newUser];
  connectedUsers = checkUniqueElementArrays(connectedUsers, socket.id, newUser);

  /// create new room
  const newRoom = {
    id: roomId,
    connectedUsers: [newUser],
  };

  ///join socket io room
  socket.join(roomId); // socket.join(roomId); === socket.to(socketid).emit("room-id",{roomId})

  ///
  rooms = [...rooms, newRoom];

  /// emit to that client that create room ( vì đã có dòng trên, nên không cần truyền nữa)
  socket.emit("room-id", { roomId });

  // emit an event to all users  connected to that room about new users who has right in this room
  socket.emit("room-update", { connectedUsers: newRoom.connectedUsers });
};

const joinRoomHandler = (data, socket) => {
  console.log("user in joining room -> joinRoomHandler :: ", data);
  //todo
  const { roomId, identity, onlyAudio } = data;

  // create new user
  const newUser = {
    identity,
    id: uuidv4(),
    socketId: socket.id,
    roomId,
    onlyAudio,
  };
  // join room as use which is trying to join room
  const room = rooms.find((room) => room.id === roomId);

  if (room) {
    //987
    //room.connectedUsers = [...room.connectedUsers, newUser];
    room.connectedUsers = checkUniqueElementArrays(
      room.connectedUsers,
      socket.id,
      newUser
    );
    // join socket.io room
    socket.join(roomId);

    /// add new user to connected users
    //connectedUsers = [...connectedUsers, newUser];
    connectedUsers = checkUniqueElementArrays(
      connectedUsers,
      socket.id,
      newUser
    );
    //////////////////////WEBRTC HANDLER /////////////

    //emit to all user that i am ready prepare
    room.connectedUsers.forEach((user) => {
      if (user.socketId !== socket.id) {
        const data = {
          connUserSocketId: socket.id,
        };

        io.to(user.socketId).emit("conn-prepare", data);
      }
    });
    /////////////////////////////////////////////////
    /// phát đến tất cả user trong 1 room
    io.to(roomId).emit("room-update", { connectedUsers: room.connectedUsers });
  }
};

const disconnectHandler = (socket) => {
  //todo  : find if user is registered , then will remove him from room and connectedUsers
  const user = connectedUsers.find((user) => user.socketId === socket.id);

  //console.log("đã tìm user :: ", user);
  if (user) {
    //remove user from room
    const room = rooms.find((room) => room.id === user.roomId);

    //console.log("room chưa remove :: ", room.connectedUsers);
    room.connectedUsers = room.connectedUsers.filter(
      (user) => user.socketId !== socket.id
    );
    //console.log("room đã remove :: ", room.connectedUsers);
    // leave socket io room
    socket.leave(user.roomId);

    //todo: close the room if users in room is 0
    if (room.connectedUsers.length > 0) {
      // emit an event to all rest of users that having a user disconnected
      io.to(room.id).emit("user-disconnected", { socketId: socket.id });
      //emit an event to all rest of users
      io.to(room.id).emit("room-update", {
        connectedUsers: room.connectedUsers,
      });
    } else {
      rooms = rooms.filter((r) => r.id !== room.id);
    }
  }
};

const signalingHanlder = (data, socket) => {
  //todo: phát data của các thành viên, về cho chính chủ,
  const { connUserSocketId, signal } = data;
  const signalingData = { signal, connUserSocketId: socket.id };
  io.to(connUserSocketId).emit("conn-signal", signalingData);
};

// information from cients who have prepared for incoming connection
const initializeConnectionHandler = (data, socket) => {
  //todo
  const { connUserSocketId } = data;
  const initData = { connUserSocketId: socket.id };
  io.to(connUserSocketId).emit("conn-init", initData);
};
///////

server.listen(PORT, () => {
  console.log(`The server is running on the port: ${PORT}`);
});

const checkUniqueElementArrays = (hn_arr, socketId, newEl) => {
  if (hn_arr) {
    const tmp_el = hn_arr.find((el) => el.socketId === socketId);
    if (tmp_el) {
      return hn_arr;
    } else {
      hn_arr = [...hn_arr, newEl];
      return hn_arr;
    }
  }
};
