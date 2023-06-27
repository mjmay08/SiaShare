import { Keychain } from 'wormhole-crypto'
import { fromByteArray, toByteArray } from 'base64-js'

export type RoomMetadata = {
    files: Array<{id: string, name: string, size: number}>
}

export class Room {
    
    public id: string;
    public writerAuthToken: string;
    public keychain: Keychain;
    private readonly API_BASE = window.location.origin + '/api/';
    private metadata: RoomMetadata;

    async create(id?: string, key?: any) {
        if (key && id) {
            console.debug(`Attempting to open room: ${id}`);
            // Existing room, ask the server for the salt corresponding to this room id
            const salt: string = await this.fetchSaltForRoom(id);
            // Create keychain
            this.keychain = new Keychain(key, salt);
            // Fetch room metadata
            this.metadata =  await this.fetchRoomMetadata(id);
            this.id = id;
        } else {
            // Creating a new room
            this.keychain = new Keychain();
            console.debug('Creating new room');
            const response = await fetch(this.API_BASE + 'room', {
                method: 'post',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    readerAuthToken: await this.keychain.authTokenB64(),
                    salt: this.keychain.saltB64
                })
            });
            const room = await response.json();
            this.id = room.id;
            this.writerAuthToken = room.writerAuthToken;
        }
    }

    async finalize(encryptedMetadata: string) {
        const response = await fetch(this.API_BASE + 'room/' + this.id, {
            method: 'put',
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                metadata: encryptedMetadata,
                writerAuthToken: this.writerAuthToken
            })
        });
    }

    public getFiles(): {id: string}[] {
        return this.metadata.files;
    }

    public async downloadFile(fileId) {
        const fileName: string | undefined = this.metadata.files.find((file) => file.id === fileId)?.name;
        if (!fileName) {
            throw new Error('Unknown file');
        }
        const getFileResponse = await fetch(this.API_BASE + 'room/' + this.id + "/files/" + fileId, {
            method: 'get',
            headers: { 
                "Content-Type": "application/json",
                "x-reader-auth-token": await this.keychain.authTokenB64()
            }
        });
        var windowUrl = window.URL || window.webkitURL;
        var decryptedFile = await this.decryptFile(getFileResponse.body);
        var url = windowUrl.createObjectURL(decryptedFile);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        windowUrl.revokeObjectURL(url);
    }

    private async decryptFile(file: ReadableStream): Promise<Blob> {
        const decryptedStream: ReadableStream = await this.keychain.decryptStream(file);
        return await new Response(decryptedStream).blob();
    }

    private async fetchSaltForRoom(id: string): Promise<string> {
        const response = await fetch(this.API_BASE + 'room/' + id + '/salt', {
            method: 'get'
        });
        const saltResponse = await response.json();
        return saltResponse.salt;
    }

    private async fetchRoomMetadata(id: string): Promise<RoomMetadata> {
        const getRoomResponse = await fetch(this.API_BASE + 'room/' + id, {
            method: 'get',
            headers: { 
                "Content-Type": "application/json",
                "x-reader-auth-token": await this.keychain.authTokenB64()
            }
        });
        const room = await getRoomResponse.json();

        const encryptedMetadata = room.metadata;
        const encryptedMetadataByteArray: Uint8Array = toByteArray(encryptedMetadata);
        const decryptedMetadataByteArray: Uint8Array = await this.keychain.decryptMeta(encryptedMetadataByteArray);
        const decryptedMetadataString: string = new TextDecoder().decode(decryptedMetadataByteArray);
        return JSON.parse(decryptedMetadataString);
    }
}