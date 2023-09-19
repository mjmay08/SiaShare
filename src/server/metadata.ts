import config from 'config';
import path from 'path';
import * as open from 'sqlite';
import sqlite3 from 'sqlite3';

export class Metadata {

    private db: open.Database;
    private dbPath: string;
    private readonly dbFilename: string = 'siashare.db';

    constructor() {
        this.dbPath = path.join(config.get('dbDir'), this.dbFilename);
    }

    public async initialize() {
        // open the database
        this.db = await open.open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });
        // Create tables if needed
        await this.setUpDB();
    }
    
    public async createRoom(roomId, writerAuthToken, readerAuthToken, salt) {
        await this.db.exec(`INSERT INTO rooms (id, writerAuthToken, readerAuthToken, salt) VALUES('${roomId}', '${writerAuthToken}', '${readerAuthToken}', '${salt}');`);
    }
    
    public async getRoomById(roomId) {
        const room = await this.db.get('SELECT * FROM rooms WHERE id = ?', `${roomId}`);
        return room;
    }
    
    public async updateRoomMetadata(roomId, metadata) {
        let updateString = 'UPDATE rooms ';
        if (metadata.encryptedTorrent !== undefined) {
            updateString += `SET encryptedTorrent = '${metadata.encryptedTorrent}' `;
        }
        if (metadata.uploadComplete !== undefined) {
            updateString += `SET uploadComplete = '${metadata.uploadComplete ? 1 : 0} `;
        }
        updateString += `WHERE id = '${roomId}'`;
        await this.db.exec(updateString);
    }

    public async addFileToRoom(roomId: string, tusId: string, fileId: string, status: boolean) {
        const statusInt: number = status ? 1 : 0;
        await this.db.exec(`INSERT INTO files (tusId, roomId, fileId, status) VALUES('${tusId}', '${roomId}', '${fileId}', ${statusInt});`);
    }

    public async getFile(roomId, fileId) {
        const file = await this.db.get(`SELECT * FROM files WHERE fileId = '${fileId}' AND roomId = '${roomId}' LIMIT 1`);
        return file;
    }

    public async updateFileStatus(roomId: string, tusId: string, fileId: string, status: boolean) {
        const statusInt: number = status ? 1 : 0;
        await this.db.exec(`UPDATE files SET status = ${statusInt} WHERE tusId = '${tusId}' AND roomId = '${roomId}' AND fileId = '${fileId}';`);
    }

    private async setUpDB() {
        await this.db.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, writerAuthToken TEXT NOT NULL, readerAuthToken TEXT NOT NULL, salt TEXT NOT NULL, encryptedTorrent TEXT);');
        await this.db.exec('CREATE TABLE IF NOT EXISTS files (tusId TEXT PRIMARY KEY, roomId TEXT NOT NULL, fileId TEXT NOT NULL, status INTEGER NOT NULL, FOREIGN KEY (roomId) REFERENCES rooms (id));');
    }
}