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
- Renterd running and ready to upload data (blockchain sync'd, autopilot configured, contracts formed, etc).
- Node/npm installed (if running without using docker).
- Docker (if running the docker container).
- A reverse proxy (e.g. Caddy) is required and must be configured with an SSL certificate.

#### Development
1. Clone or download the repo.
2. Run `npm install` to install the required node modules.
3. Set all configuration values needed in *config/default.json*
4. Run `npm start`. This will start the express server which will serve both the static content used for the UI as well as the server.
5. Open browser and go to https://<host>:<port> where host and port are the values from *config/default.json*

#### Production (using Node)
1. Clone or download the repo.
2. Run `npm ci` to install the required node modules.
3. Set all configuration values needed in *config/default.json*
4. Run `npm run build` and then `npm run prod`.
5. Configure reverse proxy with host and port values from *config/default.json*.
6. Open browser to whatever host/port the reverse proxy is listening on.

#### Production (building Docker image)
1. Clone or download the repo.
2. Run `npm ci` to install the required node modules.
3. Run `npm run build`.
4. Run `docker build -t siashare .`.

#### Production (running Docker iamge)
1. Build *siashare* Docker image using the instruction above or download from Github releases (TODO)
2. Run `docker run -p 8081:8080 -v C:\\temp:/siashare-data siashare:0.0.21` where `8081` is the port you want to bind to on you local host and `C:\\temp` is the local volume you want to mount into the container to persist the SiaShare db and cache of uploaded files.
3. Configure reverse proxy to point to whatever port you specified in place of `8081` in the example above.
4. Open browser to whatever host/port the reverse proxy is listening on.

## Acknowledgement
This work is supported by a [Sia Foundation](https://sia.tech/) grant.