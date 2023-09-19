import { Server, Upload } from '@tus/server';
import { FileStore } from '@tus/file-store';
import type http from 'node:http';
import fs from 'fs';
import path from 'path';
import { SiaService } from './sia-service.js';
import { Metadata } from './metadata.js';

export class TusServer {

    public server: Server;
    private siaService: SiaService;
    private metadata: Metadata;

    constructor(public localCacheDir: string) {}
  
    public initialize(metadata: Metadata, siaService: SiaService): void {
        this.metadata = metadata;
        this.siaService = siaService;
        this.server = new Server({
            path: '/api/tus/upload',
            // TODO: check out expirationPeriodInMilliseconds for FileStore
            datastore: new FileStore({directory: this.localCacheDir}),
            respectForwardedHeaders: true,
            onUploadCreate: this.onUploadCreate,
            onUploadFinish: this.onUploadFinish
        });
    }

    public readFileFromFileStore(fileId: string) {
        return (this.server.datastore as FileStore).read(fileId);
    }

    public readFileWithRange(fileId: string, start: number, end: number) {
        return fs.createReadStream(path.join((this.server.datastore as FileStore).directory, fileId), { start, end});
    }

    public getFileStats(fileId: string) {
        return fs.statSync(path.join((this.server.datastore as FileStore).directory, fileId));
    }

    private onUploadCreate = async (req: http.IncomingMessage, res: http.ServerResponse<http.IncomingMessage>, upload: Upload) => {
        console.log("Uploading to room: " + req.headers['x-room-id']);
        const roomId: string = req.headers['x-room-id'] as string;
        if (!roomId) {
            throw { status_code: 400, body: "Missing/invalid x-room-id header" };
        }
        const writerAuthToken: string = req.headers['x-writer-auth-token'] as string;
        if (!writerAuthToken) {
            throw { status_code: 400, body: "Missing/invalid x-writer-auth-token header"}
        }
        const fileId: string = req.headers['x-file-id'] as string;
        if (!fileId) {
            throw { status_code: 400, body: "Missing/invalid x-file-id header"}
        }

        const room = await this.metadata.getRoomById(roomId);
        if (room === undefined || room.id === undefined) {
            throw { status_code: 400, body: `Room with id ${roomId} not found`}
        }
        if (room.writerAuthToken !== writerAuthToken) {
            throw { status_code: 403, body: `Incorrect writerAuthToken`}
        }

        // Add file to db
        await this.metadata.addFileToRoom(roomId, upload.id, fileId, false);

        return res;
    }

    private onUploadFinish = async (req: http.IncomingMessage, res: http.ServerResponse<http.IncomingMessage>, upload: Upload) => {
        console.log("Upload complete... sending to Sia");
        const roomId: string = req.headers['x-room-id'] as string;
        const filePath = path.join(this.localCacheDir, upload.id);
        const readStream = fs.createReadStream(filePath);
        const fileId: string = req.headers['x-file-id'] as string;
        if (!fileId) {
            throw { status_code: 400, body: "Missing/invalid x-file-id header"}
        }

        await this.metadata.updateFileStatus(roomId, upload.id, fileId, true);

        this.siaService.uploadFile(readStream, roomId, upload.id);

        return res;
    }
}