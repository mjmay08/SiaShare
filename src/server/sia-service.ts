import config from 'config';
import fs from 'fs';
import fetch from 'node-fetch';
import { RequestInit } from 'node-fetch';

export class SiaService {
  private siaRootDir: string;
  private siaBucket: string;
  private siaUrl: string;
  private siaPassword: string;

  constructor() {
    this.siaRootDir = config.get('siaRootDir');
    this.siaBucket = config.get('siaBucket');
    this.siaUrl = config.get('siaUrl');
    const apiPassword: string = config.get('siaAPIPassword');
    this.siaPassword = Buffer.from(`:${apiPassword}`).toString('base64');
    if (this.siaBucket?.length) {
      this.createBucketIfDoesntExist(this.siaBucket);
    }
  }

  public uploadFile(fileStream: fs.ReadStream, roomId: string, fileId: string) {
    const requestOptions: RequestInit = {
      method: 'PUT',
      body: fileStream,
      redirect: 'follow',
      headers: {
        Authorization: `Basic ${this.siaPassword}`
      }
    };
    let url: string = `${this.siaUrl}/api/worker/objects/${this.siaRootDir}/${roomId}/${fileId}`;
    if (this.siaBucket?.length) {
      url += `?bucket=${this.siaBucket}`;
    }
    // TODO: actually handle failure
    fetch(url, requestOptions)
      .then((response) => response.text())
      .then((result) => console.log(result))
      .catch((error) => console.log('error', error));

    // TODO: what to return??
  }

  public fetchFile(roomId: string, fileId: string, rangeHeader: string): Promise<NodeJS.ReadableStream> {
    const requestOptions: RequestInit = {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Authorization: `Basic ${this.siaPassword}`,
        Range: rangeHeader
      }
    };
    let url: string = `${this.siaUrl}/api/worker/objects/${this.siaRootDir}/${roomId}/${fileId}`;
    if (this.siaBucket?.length) {
      url += `?bucket=${this.siaBucket}`;
    }
    // TODO: actually handle failure
    return fetch(url, requestOptions).then((response) => {
      if (response.status === 404) {
        console.log('File not found on sia network');
        return Promise.reject();
      }
      return response.body;
    });
  }

  // Return a promise that resolves to true if the room was successfully deleted or it has already been deleted
  // or resolves to false if the request failed (for example if renterd isn't running)
  public deleteRoom(roomId: string): Promise<boolean> {
    const requestOptions: RequestInit = {
      method: 'DELETE',
      redirect: 'follow',
      headers: {
        Authorization: `Basic ${this.siaPassword}`
      }
    };
    let url: string = `${this.siaUrl}/api/worker/objects/${this.siaRootDir}/${roomId}?batch=true`;
    if (this.siaBucket?.length) {
      url += `&bucket=${this.siaBucket}`;
    }
    return fetch(url, requestOptions)
      .then((response) => {
        if (response.status === 404) {
          console.log(`deleteRoom (${roomId}): room not found on sia network`);
        } else {
          console.log(`deleteRoom (${roomId}) status: ${response.status}`);
        }
        return true;
      })
      .catch((error) => {
        console.log(error);
        return false;
      });
  }

  private createBucketIfDoesntExist(bucketName: string): void {
    const requestOptions: RequestInit = {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Authorization: `Basic ${this.siaPassword}`
      }
    };
    fetch(`${this.siaUrl}/api/bus/buckets/${bucketName}`, requestOptions).then((response) => {
      if (response.status === 404) {
        // Bucket doesn't exist, create it
        console.log(`Bucket ${bucketName} not found, creating...`);
        const requestOptions: RequestInit = {
          method: 'POST',
          redirect: 'follow',
          headers: {
            Authorization: `Basic ${this.siaPassword}`
          },
          body: JSON.stringify({
            name: bucketName
          })
        };
        fetch(`${this.siaUrl}/api/bus/buckets`, requestOptions).then((response) => {
          if (response.status !== 200) {
            console.error('Failed to create bucket');
            throw Error('Failed to create bucket');
          }
        });
      }
    });
  }
}
