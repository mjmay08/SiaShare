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
import { parseRangeHeader } from './helpers.js';


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
    const writerAuthToken = crypto.randomBytes(16).toString('base64url');
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
    //const md = req.body.metadata;
    const room = await metadata.getRoomById(roomId);
    if (room === undefined || room.id === undefined) {
        throw { status_code: 400, body: `Room with id ${roomId} not found`}
    }
    if (room.writerAuthToken !== writerAuthToken) {
        throw { status_code: 403, body: `Incorrect writerAuthToken`}
    }
    try {
        metadata.updateRoomMetadata(roomId, req.body);
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
    res.json(room);
});

app.get('/api/room/:id/files/:tusId/download/*', jsonParser, async function(req, res) {
    // TODO verify id valid
    const roomId = req.params.id;
    const tusId = req.params.tusId;
    console.log(`Fetching room: ${roomId}  tusId: ${tusId}`);
    let readerAuthToken = req.headers['x-reader-auth-token'];
    console.log('after get header');
    if (readerAuthToken === undefined) {
        var cookie = req.cookies.authToken;
        if (cookie !== undefined) {
            readerAuthToken = cookie;
        } else {
            res.status(400).send('Missing readerAuthToken');
            return;
        }
    }
    
    const room = await metadata.getRoomById(roomId);
    if (room === undefined || room.id === undefined) {
        throw { status_code: 400, body: `Room with id ${roomId} not found`}
    }
    if (room.readerAuthToken !== readerAuthToken) {
        throw { status_code: 403, body: `Incorrect readerAuthToken`}
    }

    const rangeHeader = req.headers.range;

    const fetchFileFromSia = async () => {
        siaService.fetchFile(roomId, tusId, rangeHeader).then(
            (readableStream) => {
                readableStream.pipe(res);
                console.log('Sucessfully returned file from Sia network');
            },
             (err) =>  {
                console.log(err);
                res.status(404).send("Unable to return file");
            }
        );
    }

    try {
        const fileStats = tusServer.getFileStats(tusId);
        const [start, end] = parseRangeHeader(rangeHeader, fileStats.size);
        // TODO: verify fileId belongs to this roomId
        // Fetch file from FileStore cache directory
        const fileReadStream = tusServer.readFileWithRange(tusId, start, end);
        fileReadStream.on('error', function(err) {
            console.log('Failed to fetch file from FileStore cache, fetching from Sia');
            fetchFileFromSia();
        });
        res.status(206);
        res.set('Content-Length', `${end-start+1}`);
        res.set('Content-Range', 'bytes ' + start + '-' + end + '/' + fileStats.size);
        res.set('Content-Disposition', 'inline; filename=' + 'abc');
        res.set("Accept-Ranges", "bytes");
        fileReadStream.pipe(res);
    } catch (err) {
        // This would happen if the file no longer exists in tus FileStore
        console.log(err);
        fetchFileFromSia();
    }
});

app.get('/api/room/:id/files/:fileId/status', jsonParser, async function(req, res) {
    // TODO verify id valid
    const roomId = req.params.id;
    const fileId = req.params.fileId;
    console.log(`Fetching room: ${roomId}  file: ${fileId}`);
    let readerAuthToken = req.headers['x-reader-auth-token'];
    if (readerAuthToken === undefined) {
        var cookie = req.cookies.authToken;
        if (cookie !== undefined) {
            readerAuthToken = cookie;
        } else {
            res.status(400).send('Missing readerAuthToken');
            return;
        }
    }
    
    const room = await metadata.getRoomById(roomId);
    if (room === undefined || room.id === undefined) {
        throw { status_code: 400, body: `Room with id ${roomId} not found`}
    }
    if (room.readerAuthToken !== readerAuthToken) {
        throw { status_code: 403, body: `Incorrect readerAuthToken`}
    }
    
    const fileStatus = await metadata.getFile(roomId, fileId);
    console.log(`File status: ${JSON.stringify(fileStatus)}`);
    res.json(fileStatus);
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
