import express from 'express';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import BodyParser  from 'body-parser';
import path from 'path';
import config from 'config';
import fs from 'fs';
import { TusServer } from './tus-server.js';
import { SiaService } from './sia-service.js';
import { Metadata } from './metadata.js';
import { Server as BTServer } from 'bittorrent-tracker';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import { parseRangeHeader } from './helpers.js';
import { generateCert } from './generateLocalhostCert.js';
import { cleanup } from './cleanup.js';

const localCacheDir = config.get('cacheDir'); // Where TUS caches files for now
const host = config.get('host');
const port = config.get('port');
const generateCertEnabled = config.get('generateCert');

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
const jsonParser = BodyParser.json()
// Set up cookie parser
app.use(cookieParser());

// Create room
app.post('/api/room', jsonParser, async function(req, res) {
    const readerAuthToken = req.body.readerAuthToken;
    const salt = req.body.salt;
    if (readerAuthToken === undefined || salt === undefined) {
        res.status(500).send({ error: 'Missing salt or readerAuthToken' });
        return;
    }
    const roomId = crypto.randomBytes(8).toString('hex');
    const writerAuthToken = crypto.randomBytes(16).toString('base64url');
    try {
        await metadata.createRoom(roomId, writerAuthToken, readerAuthToken, salt);
    } catch (e) {
        console.log(e);
        res.status(500).send({ error: 'Internal error' });
        return;
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
        res.status(400).send({ error: `Room with id ${roomId} not found` });
        return;
    }
    if (room.writerAuthToken !== writerAuthToken) {
        res.status(403).send({ error: `Incorrect writerAuthToken` });
        return;
    }
    try {
        metadata.updateRoomMetadata(roomId, req.body);
    } catch (e) {
        console.log(e);
        res.status(500).send({ error: "Unknown failure" });
        return;
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
        res.status(400).send({ error: `Room with id ${roomId} not found` });
        return;
    }
    res.json({ salt: room.salt });
});

app.get('/api/room/:id', jsonParser, async function(req, res) {
    // TODO verify id valid
    const roomId = req.params.id;
    console.log(`Fetching room: ${roomId}`);
    const readerAuthToken = req.headers['x-reader-auth-token'];
    if (readerAuthToken === undefined) {
        res.status(400).send({ error: 'Missing readerAuthToken' });
        return;
    }
    
    const room = await metadata.getRoomById(roomId);
    if (room === undefined || room.id === undefined) {
        res.status(400).send({ error: `Room with id ${roomId} not found` });
        return;
    }
    if (room.readerAuthToken !== readerAuthToken) {
        res.status(403).send({ error: `Incorrect readerAuthToken` });
        return;
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
        const cookie = req.cookies.authToken;
        if (cookie !== undefined) {
            readerAuthToken = cookie;
        } else {
            res.status(400).send({ error: 'Missing readerAuthToken' });
            return;
        }
    }
    
    const room = await metadata.getRoomById(roomId);
    if (room === undefined || room.id === undefined) {
        res.status(400).send({ error: `Room with id ${roomId} not found` });
        return;
    }
    if (room.readerAuthToken !== readerAuthToken) {
        res.status(403).send({ error: `Incorrect readerAuthToken` });
        return;
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
                res.status(404).send({ error: "Unable to return file" });
            }
        );
    }

    try {
        const fileStats = tusServer.getFileStats(tusId);
        const [start, end] = parseRangeHeader(rangeHeader, fileStats.size);
        // TODO: verify fileId belongs to this roomId
        // Fetch file from FileStore cache directory
        const fileReadStream = tusServer.readFileWithRange(tusId, start, end);
        fileReadStream.on('error', function() {
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
        const cookie = req.cookies.authToken;
        if (cookie !== undefined) {
            readerAuthToken = cookie;
        } else {
            res.status(400).send({ error: 'Missing readerAuthToken' });
            return;
        }
    }
    
    const room = await metadata.getRoomById(roomId);
    if (room === undefined || room.id === undefined) {
        res.status(400).send({ error: `Room with id ${roomId} not found` });
        return;
    }
    if (room.readerAuthToken !== readerAuthToken) {
        res.status(403).send({ error: `Incorrect readerAuthToken` });
        return;
    }
    
    const fileStatus = await metadata.getFile(roomId, fileId);
    console.log(`File status: ${JSON.stringify(fileStatus)}`);
    res.json(fileStatus);
});

uploadApp.use((req, res, next) => {
    //req.headers['x-forwarded-proto'] = 'http';
    next();
});
uploadApp.all('*', tusServer.server.handle.bind(tusServer.server))
app.use('/api/tus/upload', uploadApp);

// Catch all, must be the last entry
app.get('*', function (request, response) {
    response.sendFile(path.resolve(staticPath, 'index.html'));
});

(async () => {
    let useHttps: boolean = true;
    // Generate cert for localhost. This is temporary.
    if (generateCertEnabled === true) {
        await generateCert(host);
    }
    const options: https.ServerOptions = {};
    try {
        options.key = fs.readFileSync('temp/certs/key.pem');
        options.cert = fs.readFileSync('temp/certs/cert.cert');
    } catch (err) {
        console.log('Failed to read certificate, will not run with https: ' + err);
        useHttps = false;
    }
    // Set up the database
    await metadata.initialize();
    // Start the server after db is ready
    let expressServer;
    if (useHttps) {
        expressServer = https.createServer(options, app).listen(port, host, () => console.log(`Server running at https://${host}:${port}`));
    } else {
        expressServer = http.createServer(app).listen(port, host, () => console.log(`Server running at http://${host}:${port}`));
    }
    const wsServer = new WebSocketServer({server: expressServer});
    wsServer.on('connection', (ws) => tracker.onWebSocketConnection(ws));
    tracker.on('error', (err) => {
        console.log(err);
    });

    // Kick off cleanup task
    setInterval(() => {
        try {
            cleanup(metadata, tusServer, siaService);
        } catch (error) {
            console.error('Failed in cleanup task: ' + error);
        }
    }, 1000 * 60 * 5); // Run cleanup task every 5 minutes
})();
