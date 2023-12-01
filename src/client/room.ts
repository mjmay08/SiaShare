import { Keychain } from 'wormhole-crypto';
import { toByteArray } from 'base64-js';
import WebTorrent from 'webtorrent/dist/webtorrent.min.js';
import nodeToWebStream from 'readable-stream-node-to-web';
import parseTorrent from 'parse-torrent';
import base64 from 'base64-js';

export type RoomMetadataResponse = {
  torrents: parseTorrent.Instance[];
};

export type RoomMetadataRequest = {
  torrents: string[];
};

export class Room {
  public id: string;
  public writerAuthToken: string;
  public keychain: Keychain;
  private readonly API_BASE = window.location.origin + '/api/';
  private metadata: RoomMetadataResponse;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private afterFinalizeCallback: () => void;

  async create() {
    // Creating a new room
    this.keychain = new Keychain();
    console.debug('Creating new room');
    const response = await fetch(this.API_BASE + 'room', {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        readerAuthToken: await this.keychain.authTokenB64(),
        salt: this.keychain.saltB64
      })
    });
    const room = await response.json();
    this.id = room.id;
    this.writerAuthToken = room.writerAuthToken;
    this.keychain.setAuthToken(this.writerAuthToken);
  }

  async finalize(encryptedTorrent: string) {
    await fetch(this.API_BASE + 'room/' + this.id, {
      method: 'put',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        encryptedTorrent,
        writerAuthToken: this.writerAuthToken
      })
    });
    this.afterFinalizeCallback();
  }

  public afterFinalize(callback: () => void) {
    this.afterFinalizeCallback = callback;
  }

  async join(id: string, key: string) {
    console.debug(`Attempting to join room: ${id}`);
    // Existing room, ask the server for the salt corresponding to this room id
    const salt: string = await this.fetchSaltForRoom(id);
    // Create keychain
    this.keychain = new Keychain(key, salt);
    // Fetch room metadata
    this.metadata = await this.fetchRoomMetadata(id);
    this.id = id;
  }

  public async getFiles(): Promise<{ name: string; id: string }[] | undefined> {
    const files: { name: string; id: string }[] = [];
    for (const torrent of this.metadata.torrents) {
      const id: string = torrent.files[0].name;
      const name = await this.getDecryptedFilename(id);
      files.push({ name, id });
    }
    return files;
  }

  public async downloadFile(fileId) {
    // First attempt to download directly from peers using WebRTC
    const client = new WebTorrent();
    client.on('error', function (err) {
      console.log(err);
    });
    const matchingTorrent = this.metadata.torrents.find((torrent) => torrent.files[0].name === fileId);
    const torrent = client.add(matchingTorrent, async (torrent) => {
      const file = torrent.files.find(function (file) {
        return file.name === fileId;
      });
      const windowUrl = window.URL || window.webkitURL;
      const decryptedFile = await this.decryptFile(nodeToWebStream(file.createReadStream()));
      const url = windowUrl.createObjectURL(decryptedFile);
      const anchor = document.createElement('a');
      anchor.href = url;
      const decryptedFilename = await this.getDecryptedFilename(file.name);
      anchor.download = decryptedFilename;
      anchor.click();
      windowUrl.revokeObjectURL(url);
    });
    torrent.on('download', function (bytes) {
      console.log('just downloaded: ' + bytes);
      console.log('total downloaded: ' + torrent.downloaded);
      console.log('download speed: ' + torrent.downloadSpeed);
      console.log('progress: ' + torrent.progress);
    });
    torrent.on('error', function (err) {
      console.log(err);
    });
    torrent.on('warning', function (err) {
      console.log(err);
    });

    // TODO need to periodically call this API until the file status is "uploaded". Right now this is assuming the file is already uploaded the first time
    const fileStatusResponse = await fetch(this.API_BASE + 'room/' + this.id + '/files/' + fileId + '/status', {
      method: 'get',
      headers: {
        'x-reader-auth-token': await this.keychain.authTokenB64()
      }
    });
    const fileStatus = await fileStatusResponse.json();
    console.log(`File status: ${JSON.stringify(fileStatus)}`);
    const webSeedUrl = this.API_BASE + 'room/' + this.id + '/files/' + fileStatus.tusId + '/download/';
    torrent.addWebSeed(webSeedUrl); // Comment this out to force testing of WebRTC peer transfer
  }

  public async getEncryptedFilename(filename: string): Promise<string> {
    const temp1 = this.encoder.encode(filename);
    const temp: Uint8Array = await this.keychain.encryptMeta(temp1);
    return base64.fromByteArray(temp).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  public async getDecryptedFilename(encryptedFilename: string): Promise<string> {
    let replacedChars = encryptedFilename.replace(/-/g, '+').replace(/_/g, '/');
    if (replacedChars.length % 4 !== 0) replacedChars += '='.repeat(4 - (replacedChars.length % 4));
    const byteArray = base64.toByteArray(replacedChars);
    const decryptedByteArray = await this.keychain.decryptMeta(byteArray);
    return this.decoder.decode(decryptedByteArray);
  }

  private async decryptFile(file: ReadableStream): Promise<Blob> {
    const decryptedStream: ReadableStream = await this.keychain.decryptStream(file);
    return await new Response(decryptedStream).blob();
  }

  private async fetchSaltForRoom(id: string): Promise<string> {
    const response = await fetch(this.API_BASE + 'room/' + id + '/salt', {
      method: 'get'
    }).then((response) => {
      if (!response.ok) {
        throw response;
      }
      return response;
    });
    const saltResponse = await response.json();
    return saltResponse.salt;
  }

  private async fetchRoomMetadata(id: string): Promise<RoomMetadataResponse> {
    const getRoomResponse = await fetch(this.API_BASE + 'room/' + id, {
      method: 'get',
      headers: {
        'Content-Type': 'application/json',
        'x-reader-auth-token': await this.keychain.authTokenB64()
      }
    }).then((response) => {
      if (!response.ok) {
        throw response;
      }
      return response;
    });
    const room = await getRoomResponse.json();

    const metadata: RoomMetadataResponse = { torrents: [] };

    const encryptedTorrents: string[] = room.encryptedTorrent.split('.');
    for (const encryptedTorrent of encryptedTorrents) {
      const encryptedTorrentByteArray: Uint8Array = toByteArray(encryptedTorrent);
      const decryptedTorrentByteArray: Uint8Array = await this.keychain.decryptMeta(encryptedTorrentByteArray);
      const torrentFile = Buffer.from(decryptedTorrentByteArray);
      const parsedTorrent = await parseTorrent(torrentFile);
      metadata.torrents.push(parsedTorrent as parseTorrent.Instance);
    }
    return metadata;
  }
}
