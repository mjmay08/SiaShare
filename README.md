# SiaShare
### SiaShare is an end-to-end encrypted file sharing service that uses the Sia decentralized storage network to store files.

## How It Works
#### Uploading
1. User selects some files to share.
2. A main secret key and salt is generated using https://github.com/SocketDev/wormhole-crypto.
3. Additional keys are dervied using HKDF SHA-256.
    1. An encryption key and salt for each file.
    2. An encryption key for the file metadata.
    3. A token which will be used for read access to the room.
4. A new room is created on the server. The server creates a room id and a write access token for the room. Both are returned to the client.
5. The shareable link given to the user. The format of the link is https://<domain_here>/{roomId}#{mainSecretKey} Since the mainSecretKey is a URL fragment it will never be sent to the server.
6. The client encrypts each file
7. A .torrent file is created per file being uploaded. This file is encrypted using a metadata key.
8. The encrypted .torrent files are uploaded to the server.
9. The client starts seeding the torrents using WebTorrent. This is what enables downloaders to start downloading a file before the uploader has even finished uploading it to the server.
10. All encrypted files are uploaded to the server using TUS.
    1. Once a file is uploaded to the server it will then be uploaded to the Sia network using renterd.

#### Downloading
1. The client takes the roomId and mainSecretKey from the URL.
2. The client asks the server for the salt corresponding to that room.
3. The client uses the mainSecretKey and salt to derive the same keys that were used for encrypting the files and metadata as well as the token for read access to the room.
4. The client then asks the server for all of the enrypted .torrent files and then decrypts them.
5. The list of files uploaded to the room is then shown to the user.
6. When the user selects a file to download WebTorrent is then used to coordinate the download.
    1. WebTorrent will check for peers (the uploader) if they are still seeding the file.
    2. It will also simultaneously use a WebSeed url to download the file from the server if the file has finished uploading. The download from the server will either serve the file from the local filesystem if it is still present, otherwise it will fetch the file from the Sia network using renterd.
7. WebTorrent verifies all pieces of the file match the expected hashes as it receives them.
8. The file is then decrypted.

## How To Run SiaShare
#### Prerequisites
- renterd running and ready to upload data (blockchain sync'd, autopilot configured, contracts formed, etc).
- node/npm installed

1. Clone or download the repo.
2. Run `npm install` to install the required node modules.
3. Set all configuration values needed in *config/default.json*
    1. TODO
4. Run `npm start`. This will start the express server which will serve both the static content used for the UI as well as the server.

## Acknowledgement
This work is supported by a [Sia Foundation](https://sia.tech/) grant.