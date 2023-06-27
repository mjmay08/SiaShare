import { BasePlugin, PluginOptions } from "@uppy/core";
import { Room, RoomMetadata } from "./room";
import { fromByteArray, toByteArray } from 'base64-js'

export interface UppyEncryptionOptions extends PluginOptions {
    onBeforeEncryption: () => Promise<Room>;
}

export class UppyEncryption extends BasePlugin<UppyEncryptionOptions> {
    
    private room: Room;
    private opts: UppyEncryptionOptions;
    private encoder = new TextEncoder();

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
                    this.uppy.setFileState(fileID, { data: encryptedBlob});
                });
            }).catch((err) => {
                this.uppy.log("UppyEncryption error: " + err);
                // TODO: this should fail the upload
            });
        });

        const emitPreprocessCompleteForAll = () => {
            fileIDs.forEach((fileID) => {
                const file = this.uppy.getFile(fileID);
                this.uppy.emit('preprocess-complete', file);
            });
        };

        // Why emit `preprocess-complete` for all files at once, instead of
        // above when each is processed?
        // Because it leads to StatusBar showing a weird “upload 6 files” button,
        // while waiting for all the files to complete pre-processing.
        return Promise.all(promises).then(emitPreprocessCompleteForAll);
    };

    finalizeUpload = async (fileIDs: string[]) => {
        console.debug('Finalizing upload');
        const metadata: RoomMetadata = {
            files: []
        };
        fileIDs.map((fileID) => {
            const file = this.uppy.getFile(fileID);
            const tusId = file.response.uploadURL.split('/').slice(-1)[0];
            metadata.files.push({
               id: tusId,
               name: file.name,
               size: file.size 
            });
        });
        const metadataString = JSON.stringify(metadata);
        
        const metaAsUint8Array: Uint8Array = this.encoder.encode(metadataString);
        const encryptedMetadata: Uint8Array = await this.room.keychain.encryptMeta(metaAsUint8Array);
        const encryptedMetadataStr: string = fromByteArray(encryptedMetadata);

        await this.room.finalize(encryptedMetadataStr);
        // TODO
        // Call API to wait on files being successfully uploaded to Sia https://uppy.io/docs/guides/building-plugins/
    }
}