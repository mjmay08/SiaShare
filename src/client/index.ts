import Uppy, { UppyFile } from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import Tus from '@uppy/tus';
import Audio from '@uppy/audio';
import ScreenCapture from '@uppy/screen-capture';
import Webcam from '@uppy/webcam';
import { UppyEncryption } from './uppy-encryption';
import type { HttpRequest } from 'tus-js-client';
import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';
import '@uppy/audio/dist/style.min.css';
import '@uppy/screen-capture/dist/style.min.css';
import '@uppy/webcam/dist/style.min.css';
import { Room } from './room';
import './index.css';
import QRCode from 'qrcode';

const apiBase = window.location.origin + '/api/';
let room: Room;
let uppy: Uppy;

if (window.location.pathname.length > 1) {
  // Existing room. Try to load
  const roomId = window.location.pathname.replace('/', '');
  const key = window.location.hash.replace('#', '');
  console.log('Existing room: ' + roomId);
  console.log('Key: ' + key);
  room = new Room();
  room.join(roomId, key).then(
    () => {
      room.getFiles().then(
        (files) =>
          files?.forEach((file) => {
            const li = document.createElement('li');
            li.classList.add('file-item');
            const div = document.createElement('div');
            div.classList.add('filename');
            div.appendChild(document.createTextNode(file.name));
            li.appendChild(div);
            const btn = document.createElement('button');
            btn.classList.add('button-64');
            btn.innerHTML = 'download';
            btn.onclick = function () {
              room.downloadFile(file.id);
            };
            li.appendChild(btn);
            document.getElementById('file-list')?.appendChild(li);
          })
      );
      document.getElementById('download-view').style.display = 'block';
    },
    () => {
      alert('Failed to load room');
    }
  );
} else {
  getSiaShareConfig().then((config) => {
    initializeDashboard(config);
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
  console.log('setTusHeaders: ' + room.id);
  req.setHeader('x-room-id', room.id);
  req.setHeader('x-writer-auth-token', room.writerAuthToken);
  req.setHeader('x-file-id', <string>file.meta.encryptedId);
  req.setHeader('Authorization', getEnteredPassword());
}

function showShareView(roomId, mainKey) {
  // Set Share link
  const shareURL = window.location.href + roomId + '#' + mainKey;
  (<HTMLInputElement>document.getElementById('share-url')).value = shareURL;
  // Set up copy link button
  const copyLinkBtn = document.getElementById('copyLink');
  if (copyLinkBtn) {
    copyLinkBtn.onclick = function () {
      navigator.clipboard.writeText(shareURL);
    };
  }
  // Set up QR code
  const showQRBtn = document.getElementById('showQR');
  const qrModal = document.getElementById('qrModal');
  const qrModalClose = document.getElementById('qrModalClose');
  if (showQRBtn && qrModal && qrModalClose) {
    showQRBtn.onclick = function () {
      qrModal.style.display = 'block';
    };
    qrModalClose.onclick = function () {
      qrModal.style.display = 'none';
    };
    window.onclick = function (event) {
      if (event.target == qrModal) {
        qrModal.style.display = 'none';
      }
    };
  }
  const canvas = document.getElementById('canvas');
  QRCode.toCanvas(canvas, shareURL);
  // Display the Share View
  document.getElementById('share-view').style.display = 'flex';
}

/**
 * Fetch any configuration information.
 * Right now this just checks if a password is required for upload.
 * In the future this might also fetch upload restrictions such as file size, total size, or number of files.
 */
async function getSiaShareConfig(): Promise<SiaShareConfig> {
  const siaShareConfig = await fetch(apiBase + 'config', {
    method: 'get'
  });
  return await siaShareConfig.json();
}

function showHidePasswordInput(show: boolean): void {
  document.getElementById('password-input').style.display = show ? 'flex' : 'none';
}

function verifyPasswordEntered(passwordRequired: boolean): boolean {
  if (passwordRequired && !getEnteredPassword().length) {
    uppy.info('A password is required to upload. Please enter password above.', 'error', 5000);
    return false;
  }
  return true;
}

function getEnteredPassword(): string {
  return (document.getElementById('password') as HTMLInputElement).value;
}

function initializeDashboard(config: SiaShareConfig): void {
  showHidePasswordInput(config.passwordRequired);
  uppy = new Uppy({
    allowMultipleUploadBatches: false,
    onBeforeUpload: () => verifyPasswordEntered(config.passwordRequired)
  })
    .use(Dashboard, {
      inline: true,
      target: '#uploader',
      proudlyDisplayPoweredByUppy: false,
      theme: 'dark',
      hideRetryButton: true,
      hideCancelButton: true
    })
    .use(Tus, {
      endpoint: apiBase + 'tus/upload',
      allowedMetaFields: [],
      onBeforeRequest: setTusHeaders,
      removeFingerprintOnSuccess: true
    })
    .use(UppyEncryption, { onBeforeEncryption: beforeUpload })
    .use(ScreenCapture, { target: Dashboard })
    .use(Audio, { target: Dashboard, showAudioSourceDropdown: true })
    .use(Webcam, { target: Dashboard, showVideoSourceDropdown: true, showRecordingLength: true });

  uppy.on('complete', (result) => {
    if (result.failed.length > 0) {
      document.getElementById('share-view').style.display = 'none';
    } else {
      showHidePasswordInput(false);
      uppy.close();
      document.getElementById('upload-success').style.display = 'flex';
    }
  });
  uppy.on('upload-error', (_file, error) => {
    // Tus error has a bunch of extra details, just display incorrect password message
    if (error.message.includes('Incorrect password')) {
      error.message = 'Incorrect password';
    }
  });
}

interface SiaShareConfig {
  passwordRequired: boolean;
}
