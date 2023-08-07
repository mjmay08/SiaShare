import express from 'express';
import crypto from 'crypto';
import BodyParser  from 'body-parser';
import path from 'path';
import config from 'config';
import { TusServer } from './tus-server.js';
import { SiaService } from './sia-service.js';
import { Metadata } from './metadata.js';
import { Server as BTServer } from 'bittorrent-tracker';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';

const localCacheDir = config.get('cacheDir'); // Where TUS caches files for now
const port = config.get('port');

const app = express();
const uploadApp = express();

// Set up static content server
const staticPath = path.resolve('dist/client');
app.use(express.static(staticPath));

// Set up db for metadata
const metadata = new Metadata();

// Set up Sia service
const siaService = new SiaService();

// Set up TUS server for handling uploads
const tusServer = new TusServer(localCacheDir);
tusServer.initialize(metadata, siaService);

// Set up Bittorrent Tracker
const tracker = new BTServer({
    http: false,
    udp: false,
    ws: true
});

// create application/json parser
var jsonParser = BodyParser.json()
// Set up cookie parser
app.use(cookieParser());

// Create room
app.post('/api/room', jsonParser, async function(req, res) {
    const readerAuthToken = req.body.readerAuthToken;
    const salt = req.body.salt;
    if (readerAuthToken === undefined || salt === undefined) {
        res.status(500).send('Missing salt or readerAuthToken');
    }
    const roomId = crypto.randomBytes(8).toString('hex');
    const writerAuthToken = crypto.randomBytes(20).toString('hex');
    try {
        await metadata.createRoom(roomId, writerAuthToken, readerAuthToken, salt);
    } catch (e) {
        console.log(e);
        res.status(500).send('Internal error');
    }
    res.send({
        id: roomId,
        writerAuthToken: writerAuthToken
    });
});

app.put('/api/room/:id', jsonParser, async function(req, res) {
    const roomId = req.params.id;
    console.log("Update room:");
    console.log(roomId);
    
    const writerAuthToken = req.body.writerAuthToken;
    const md = req.body.metadata;
    const room = await metadata.getRoomById(roomId);
    if (room === undefined || room.id === undefined) {
        throw { status_code: 400, body: `Room with id ${roomId} not found`}
    }
    if (room.writerAuthToken !== writerAuthToken) {
        throw { status_code: 403, body: `Incorrect writerAuthToken`}
    }
    try {
        metadata.updateRoomMetadata(roomId, md);
    } catch (e) {
        console.log(e);
        throw { status_code: 500, body: `Internal failure`}
    }
    res.json(req.body);
});

// This is the only API that does not require a reader or writer auth token
// Only return the salt for the room
app.get('/api/room/:id/salt', async function(req, res) {
    // TODO verify id valid
    const roomId = req.params.id;
    console.log(`Fetching salt for room: ${roomId}`);
    
    const room = await metadata.getRoomById(roomId);
    if (room === undefined || room.id === undefined) {
        throw { status_code: 400, body: `Room with id ${roomId} not found`}
    }
    res.json({ salt: room.salt });
});

app.get('/api/room/:id', jsonParser, async function(req, res) {
    // TODO verify id valid
    const roomId = req.params.id;
    console.log(`Fetching room: ${roomId}`);
    const readerAuthToken = req.headers['x-reader-auth-token'];
    if (readerAuthToken === undefined) {
        res.status(400).send('Missing readerAuthToken');
    }
    
    const room = await metadata.getRoomById(roomId);
    if (room === undefined || room.id === undefined) {
        throw { status_code: 400, body: `Room with id ${roomId} not found`}
    }
    if (room.readerAuthToken !== readerAuthToken) {
        throw { status_code: 403, body: `Incorrect readerAuthToken`}
    }
    res.cookie('authToken', readerAuthToken);
    res.json({ metadata: room.metadata });
});

app.get('/api/room/:id/files/:fileId', jsonParser, async function(req, res) {
    // TODO verify id valid
    const roomId = req.params.id;
    const fileId = req.params.fileId;
    console.log(`Fetching room: ${roomId}  file: ${fileId}`);
    const readerAuthToken = req.headers['x-reader-auth-token'];
    if (readerAuthToken === undefined) {
        res.status(400).send('Missing readerAuthToken');
    }
    
    const room = await metadata.getRoomById(roomId);
    if (room === undefined || room.id === undefined) {
        throw { status_code: 400, body: `Room with id ${roomId} not found`}
    }
    if (room.readerAuthToken !== readerAuthToken) {
        throw { status_code: 403, body: `Incorrect readerAuthToken`}
    }
    // TODO: verify fileId belongs to this roomId
    // Fetch file from FileStore cache directory
    const fileReadStream = tusServer.readFileFromFileStore(fileId);
    fileReadStream.on('error', function(err) {
        console.log('Failed to fetch file from FileStore cache, fetching from Sia');
        siaService.fetchFile(roomId, fileId).then((readableStream) => readableStream.pipe(res));
        console.log('Sucessfully returned file from Sia network');
     });
    fileReadStream.pipe(res);
});

uploadApp.all('*', tusServer.server.handle.bind(tusServer.server))
app.use('/api/tus/upload', uploadApp);

// Catch all, must be the last entry
app.get('*', function (request, response) {
    response.sendFile(path.resolve(staticPath, 'index.html'));
});
  

(async () => {
    // Set up the database
    await metadata.initialize();
    // Start the server after db is ready
    const expressServer = app.listen(port, '0.0.0.0', () => console.log(`Server running at http://localhost:${port}`));
    const wsServer = new WebSocketServer({server: expressServer});
    wsServer.on('connection', (ws) => tracker.onWebSocketConnection(ws));
    tracker.on('error', (err) => {
        console.log(err);
    });
})();
