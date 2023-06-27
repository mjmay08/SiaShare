import config from 'config';
import * as open from 'sqlite';
import sqlite3 from 'sqlite3';

export class Metadata {

    private db: open.Database;
    private dbPath: string;
    private readonly dbFilename: string = 'siashare.db';

    constructor() {
        this.dbPath = config.get('dbDir') + `\\${this.dbFilename}`;
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
        await this.db.exec(`UPDATE rooms SET metadata = '${metadata}' WHERE id = '${roomId}'`);
    }

    private async setUpDB() {
        await this.db.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, writerAuthToken TEXT NOT NULL, readerAuthToken TEXT NOT NULL, salt TEXT NOT NULL, metadata TEXT);');
    }
}