import Uppy, { UppyFile } from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import Tus from '@uppy/tus';
import { UppyEncryption } from './uppy-encryption';
import type { HttpRequest } from 'tus-js-client'
import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';
import { Room } from './room';
import './index.css';
import QRCode from 'qrcode';

const apiBase = window.location.origin + '/api/';
let room: Room;

if (window.location.pathname.length > 1) {
  // Existing room. Try to load
  const roomId = window.location.pathname.replace('/', '');
  const key = window.location.hash.replace('#', '');
  console.log("Existing room: " + roomId);
  console.log("Key: " + key);
  room = new Room();
  room.join(roomId, key).then(() => {
    room.getFiles().then((files) => files?.forEach((file) => {
      const li = document.createElement('li');
      li.classList.add('file-item');
      const div = document.createElement('div');
      div.classList.add('filename');
      div.appendChild(document.createTextNode(file.name))
      li.appendChild(div);
      const btn = document.createElement('button');
      btn.classList.add('button-64');
      btn.innerHTML = 'download';
      btn.onclick = function() {
        room.downloadFile(file.id);
      }
      li.appendChild(btn);
      document.getElementById('file-list')?.appendChild(li);
    }));
    document.getElementById('download-view').style.display = "block";
  });
} else {
  const uppy = new Uppy({allowMultipleUploadBatches: false})
  .use(Dashboard, { inline: true, target: '#uploader', proudlyDisplayPoweredByUppy: false, theme: 'dark' })
  .use(Tus, { endpoint: apiBase + 'tus/upload', allowedMetaFields: [], onBeforeRequest: setTusHeaders, removeFingerprintOnSuccess: true })
  .use(UppyEncryption, { onBeforeEncryption: beforeUpload });

  uppy.on('complete', (result) => {
    console.log('successful files:', result.successful);
    console.log('failed files:', result.failed);
    uppy.close();
  });
}

async function beforeUpload(): Promise<Room> {
  room = new Room();
  await room.create();
  room.afterFinalize(() => {
    showShareView(room.id, room.keychain.keyB64);
  });
  return Promise.resolve(room);
}

async function setTusHeaders(req: HttpRequest, file: UppyFile) {
  console.log("setTusHeaders: " + room.id);
  req.setHeader('x-room-id', room.id);
  req.setHeader('x-writer-auth-token', room.writerAuthToken);
  req.setHeader('x-file-id', (<any>file.meta).encryptedId);
}

function showShareView(roomId, mainKey) {
    // Set Share link
    const shareURL = window.location.href + roomId + '#' + mainKey;
    (<HTMLInputElement>document.getElementById("share-url")).value = shareURL;
    // Set up copy link button
    const copyLinkBtn = document.getElementById('copyLink');
    if (copyLinkBtn){
      copyLinkBtn.onclick = function() {
        navigator.clipboard.writeText(shareURL);
      }
    }
    // Set up QR code
    const showQRBtn = document.getElementById('showQR');
    const qrModal = document.getElementById('qrModal');
    const qrModalClose = document.getElementById('qrModalClose');
    if (showQRBtn && qrModal && qrModalClose) {
      showQRBtn.onclick = function() {
        qrModal.style.display = "block";
      }
      qrModalClose.onclick = function() {
        qrModal.style.display = "none";
      }
      window.onclick = function(event) {
        if (event.target == qrModal) {
          qrModal.style.display = "none";
        }
      }
    }
    var canvas = document.getElementById('canvas');
    QRCode.toCanvas(canvas, shareURL);
    // Display the Share View
    document.getElementById("share-view").style.display = "flex";
}
