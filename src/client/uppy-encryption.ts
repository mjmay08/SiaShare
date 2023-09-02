import { BasePlugin, PluginOptions } from "@uppy/core";
import { Room, RoomMetadataRequest } from "./room";
import WebTorrent from 'webtorrent/dist/webtorrent.min.js'

export interface UppyEncryptionOptions extends PluginOptions {
    onBeforeEncryption: () => Promise<Room>;
}

export class UppyEncryption extends BasePlugin<UppyEncryptionOptions> {
    
    private room: Room;
    private opts: UppyEncryptionOptions;

    constructor(uppy, opts: UppyEncryptionOptions) {
        super(uppy, opts);
        this.id = opts.id || 'UppyEncryption';
        this.type = 'UppyEncryption';
        this.opts = opts;
    }

    install() {
        this.uppy.addPreProcessor(this.prepareUpload);
        this.uppy.addPostProcessor(this.finalizeUpload);
    }

    uninstall() {
        this.uppy.removePreProcessor(this.prepareUpload);
        this.uppy.removePostProcessor(this.finalizeUpload);
    }

    prepareUpload = async (fileIDs) => {
        this.room = await this.opts.onBeforeEncryption();
        const promises = fileIDs.map((fileID) => {
            const file = this.uppy.getFile(fileID);
            this.uppy.emit('preprocess-progress', file, {
                mode: 'indeterminate',
                message: 'Encrypting files',
            });
            return this.room.keychain.encryptStream(file.data.stream()).then((encryptedStream: ReadableStream) => {
                return new Response(encryptedStream).blob().then((encryptedBlob: Blob) => {
                    this.uppy.setFileState(fileID, { data: encryptedBlob}); //ENCRYPTED
                    //this.uppy.setFileState(fileID, { data: file.data}); // UNENCRYPTED - ONLY FOR TESTING
                });
            }).catch((err) => {
                this.uppy.log("UppyEncryption error: " + err);
                // TODO: this should fail the upload
            });
        });

        const afterEncryptionComplete = async () => {
            const client = new WebTorrent();
            const promises: Promise<Buffer>[] = await fileIDs.map(async (fileID) => {
                const file = this.uppy.getFile(fileID);
                const fileContent: any = file.data;
                const encryptedFilename: string = await this.room.getEncryptedFilename(file.name);
                fileContent.name = encryptedFilename;
                this.uppy.setFileMeta(fileID, { encryptedId: encryptedFilename });
                this.uppy.emit('preprocess-complete', file);
                // Since we are always using single file torrents, the torrent name will also be used for the file name
                const torrentName = encryptedFilename;

                return new Promise<Buffer>(function(resolve, reject) {
                    let trackerURL: string = `wss:${window.location.host}`;
                    if (window.location.port) {
                        trackerURL = trackerURL +  `:${window.location.port}`;
                    }
                    client.seed(fileContent, {
                        announceList: [[trackerURL]],
                        //announceList: [[]], // Uncomment this to force testing of web seed
                        name: torrentName
                    }, async (torrent) => {
                        
                        resolve(torrent.torrentFile);
                    });
                });
            });
            return Promise.all(promises).then(async (buffers: Buffer[]) => {
                // At this point all files are being seeded, update the metadata for the room.
                const metadata: RoomMetadataRequest = { 
                    torrents: []
                };
                await Promise.all(buffers.map(async (buffer) => {
                    const encryptedTorrent: Uint8Array = await this.room.keychain.encryptMeta(buffer);
                    const encryptedTorrentStr: string = Buffer.from(encryptedTorrent).toString('base64');
                    metadata.torrents.push(encryptedTorrentStr);
                }));
                // Easiest to save as a single string so join all torrent strings using a period since that isn't part of the base64 character set
                const concatenatedTorrentString = metadata.torrents.join('.');
                await this.room.finalize(concatenatedTorrentString);
            }, (err) => {
                console.log(err);
            });
        };

        // Why emit `preprocess-complete` for all files at once, instead of
        // above when each is processed?
        // Because it leads to StatusBar showing a weird “upload 6 files” button,
        // while waiting for all the files to complete pre-processing.
        return Promise.all(promises).then(afterEncryptionComplete);
    };

    finalizeUpload = async (fileIDs: string[]) => {
        console.debug('Finalizing upload');
        // TODO
        // Call API to wait on files being successfully uploaded to Sia https://uppy.io/docs/guides/building-plugins/
    }
}