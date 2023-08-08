import { BasePlugin, PluginOptions } from "@uppy/core";
import { Room } from "./room";
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
            const torrentFiles: any[] = [];
            const metadata: any = {};
            let torrentName: string = 'torrent';
            for (const fileID of fileIDs) {
                const file = this.uppy.getFile(fileID);
                const fileContent: any = file.data;
                const encryptedFilename: string = await this.room.getEncryptedFilename(file.name);
                fileContent.name = encryptedFilename;
                this.uppy.setFileMeta(fileID, { encryptedId: encryptedFilename });
                torrentFiles.push(fileContent);
                this.uppy.emit('preprocess-complete', file);
                
                // In single file cases we need to name the torrent the file's name
                // This is because webtorrent overwrites file names in single file cases
                if (fileIDs.length === 1) {
                    //torrentName = file.name;
                    torrentName = encryptedFilename;
                }
            }

            const client = new WebTorrent();
            // TODO: we need to start seeding before we even upload to the server
            // TODO: this means we need to upload metadata (with magnetURI) before upload via tus. And then update metadata later??
            const torrent = client.seed(torrentFiles, {
                //announceList: [['ws:localhost:3001']], // TODO: this needs to come from config
                announceList: [[]], // Uncomment this to force testing of web seed
                name: torrentName
            }, async (torrent) => {
                metadata.encryptedTorrent = await this.room.keychain.encryptMeta(torrent.torrentFile);
                const encryptedMetadataStr: string = Buffer.from(metadata.encryptedTorrent).toString('base64');
                await this.room.finalize(encryptedMetadataStr);
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