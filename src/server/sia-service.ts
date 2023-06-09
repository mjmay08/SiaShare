import config from 'config';
import fs from 'fs';
import fetch from 'node-fetch';
import { RequestInit } from 'node-fetch';

export class SiaService {
    private siaRootDir: string;
    private siaUrl: string;
    private siaPassword: string;

    constructor() {
        this.siaRootDir = config.get('siaRootDir');
        this.siaUrl = config.get('siaUrl');
        const apiPassword: string = config.get('siaAPIPassword');
        this.siaPassword = Buffer.from(`:${apiPassword}`).toString('base64');
    }

    public uploadFile(fileStream: fs.ReadStream, roomId: string, fileId: string) {

        const requestOptions: RequestInit = {
            method: 'PUT',
            body: fileStream,
            redirect: 'follow',
            headers: {
                'Authorization': `Basic ${this.siaPassword}`,
            }
        };
        // TODO: actually handle failure
        fetch(`${this.siaUrl}/api/worker/objects/${this.siaRootDir}/${roomId}/${fileId}`, requestOptions)
            .then(response => response.text())
            .then(result => console.log(result))
            .catch(error => console.log('error', error));
        
        // TODO: what to return??
    }

    public fetchFile(roomId: string, fileId: string): Promise<NodeJS.ReadableStream> {

        const requestOptions: RequestInit = {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'Authorization': `Basic ${this.siaPassword}`,
            }
        };
        // TODO: actually handle failure
        return fetch(`${this.siaUrl}/api/worker/objects/${this.siaRootDir}/${roomId}/${fileId}`, requestOptions)
            .then(response => { return response.body; })
            .catch(error => { return error; }); // TODO this isn't right for error case
    }
}