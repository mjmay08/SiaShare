import Uppy, { UppyFile } from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import Tus from '@uppy/tus';
import { UppyEncryption } from './uppy-encryption';
import type { HttpRequest } from 'tus-js-client'

import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';
import { Room } from './room';
import './index.css';

const apiBase = window.location.origin + '/api/';
let room: Room;

if (window.location.pathname.length > 1) {
  // Existing room. Try to load
  const roomId = window.location.pathname.replace('/', '');
  const key = window.location.hash.replace('#', '');
  console.log("Existing room: " + roomId);
  console.log("Key: " + key);
  room = new Room();
  room.create(roomId, key).then(() => {
    room.getFiles().forEach((file) => {
      const li = document.createElement('li');
      li.appendChild(document.createTextNode(file.id))
      const btn = document.createElement('button');
      btn.innerHTML = 'download';
      btn.onclick = function() {
        room.downloadFile(file.id);
      }
      li.appendChild(btn);
      document.getElementById('file-list')?.appendChild(li);
    });
    document.getElementById('download-view').style.display = "block";
  });
} else {
  const uppy = new Uppy()
  .use(Dashboard, { inline: true, target: 'body', proudlyDisplayPoweredByUppy: false })
  .use(Tus, { endpoint: apiBase + 'tus/upload', allowedMetaFields: [], onBeforeRequest: setTusHeaders })
  .use(UppyEncryption, { onBeforeEncryption: beforeUpload });

  uppy.on('complete', (result) => {
    console.log('successful files:', result.successful);
    console.log('failed files:', result.failed);
    uppy.close();
    showShareURL(room.id, room.keychain.keyB64);
  });
}

async function beforeUpload(): Promise<Room> {
  room = new Room();
  await room.create();
  return Promise.resolve(room);
}

async function setTusHeaders(req: HttpRequest, file: UppyFile) {
  console.log("setTusHeaders: " + room.id);
  req.setHeader('x-room-id', room.id);
  req.setHeader('x-writer-auth-token', room.writerAuthToken);
}

function showShareURL(roomId, mainKey) {
    const shareURL = window.location.href + roomId + '#' + mainKey;
    (<HTMLInputElement>document.getElementById("share-url")).value = shareURL;
    document.getElementById("share-box").style.display = "block";
}
