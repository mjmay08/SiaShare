import Uppy, { Restrictions, UppyFile } from '@uppy/core';
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
import { RoomDatabase } from './roomDb';

const apiBase = window.location.origin + '/api/';
let room: Room;
let uppy: Uppy;

const db = new RoomDatabase();

if (window.location.pathname.length > 1) {
  // Existing room. Try to load
  const roomId = window.location.pathname.replace('/', '');
  const key = window.location.hash.replace('#', '');
  console.log('Existing room: ' + roomId);
  console.log('Key: ' + key);
  room = new Room(db);
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
            const span = document.createElement('span');
            span.classList.add('small');
            btn.appendChild(span);
            span.innerHTML = 'download';
            btn.onclick = function () {
              const progressBar = showFileAsDownloading(btn);
              room.downloadFile(
                file.id,
                (progress: number) => onFileDownloadProgress(progressBar, progress),
                () => onDownloadComplete(btn, progressBar)
              );
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
  room = new Room(db);
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
  const shareURL = getShareLink(roomId, mainKey);
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

function getShareLink(roomId: string, key: string): string {
  return window.location.href + roomId + '#' + key;
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

function getUploadRestrictions(config: SiaShareConfig): Restrictions {
  return {
    maxFileSize: config.maxFileSize !== 0 ? config.maxFileSize : undefined,
    maxTotalFileSize: config.maxTotalFileSize !== 0 ? config.maxTotalFileSize : undefined,
    maxNumberOfFiles: config.maxNumberOfFiles !== 0 ? config.maxNumberOfFiles : undefined
  };
}

function getDashboardNote(config: SiaShareConfig): string {
  if (config.maxFileSize === 0 && config.maxTotalFileSize === 0 && config.maxNumberOfFiles === 0) {
    return '';
  }
  let note: string = 'Uploads are restricted to: ';
  if (config.maxFileSize !== 0) {
    note += `${formatBytes(config.maxFileSize)} per file, `;
  }
  if (config.maxTotalFileSize !== 0) {
    note += `${formatBytes(config.maxTotalFileSize)} for all files combined, `;
  }
  if (config.maxNumberOfFiles !== 0) {
    note += `${config.maxNumberOfFiles} files`;
  }
  if (note.endsWith(', ')) {
    note = note.substring(0, note.lastIndexOf(', '));
  }
  note += '.';
  return note;
}

function initializeDashboard(config: SiaShareConfig): void {
  document.getElementById('upload-view-inner').style.display = 'flex';
  showHidePasswordInput(config.passwordRequired);
  getAllRecentRooms();
  uppy = new Uppy({
    allowMultipleUploadBatches: false,
    restrictions: getUploadRestrictions(config),
    onBeforeUpload: () => verifyPasswordEntered(config.passwordRequired)
  })
    .use(Dashboard, {
      inline: true,
      target: '#uploader',
      proudlyDisplayPoweredByUppy: false,
      theme: 'dark',
      hideRetryButton: true,
      hideCancelButton: true,
      note: getDashboardNote(config),
      height: 400
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
      document.getElementById('upload-view-inner').style.display = 'none';
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

function showFileAsDownloading(btn: HTMLButtonElement): HTMLDivElement {
  btn.style.display = 'none';
  const progressBar = document.createElement('div');
  progressBar.classList.add('progress-container');
  const progressBarInternal = document.createElement('div');
  progressBarInternal.classList.add('progress');
  progressBar.appendChild(progressBarInternal);
  btn.parentNode.insertBefore(progressBar, btn);
  return progressBarInternal;
}

function onFileDownloadProgress(progressBar: HTMLDivElement, progress): void {
  console.log(progress);
  progressBar.style.width = `${progress * 100}%`;
}

function onDownloadComplete(btn: HTMLButtonElement, progressBar: HTMLDivElement): void {
  if (document.contains(btn)) {
    btn.style.display = 'flex';
  }
  progressBar.parentElement.remove();
}

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

async function getAllRecentRooms(): Promise<void> {
  try {
    document.getElementById('recent-rooms').style.display = 'none';
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    // Delete rooms older than 24 hours to clear up indexeddb
    await db.rooms.where('creationTime').below(oneDayAgo).delete();
    // Fetch all recent rooms for display
    const recentRooms = await db.rooms.where('creationTime').above(oneDayAgo).toArray();
    const recentRoomsParent = document.getElementById('recent-room-list');
    while (recentRoomsParent.firstChild) {
      recentRoomsParent.removeChild(recentRoomsParent.lastChild);
    }
    recentRooms.forEach((room) => {
      const roomDiv = document.createElement('div');
      roomDiv.classList.add('recent-room-item');

      const row1Div = document.createElement('div');
      row1Div.classList.add('row1');
      const filesDiv = document.createElement('div');
      filesDiv.classList.add('files');
      filesDiv.textContent = room.files.join(', ');
      const deleteIcon = document.createElement('button');
      deleteIcon.innerText = 'X';
      deleteIcon.classList.add('remove-row');
      deleteIcon.onclick = function () {
        console.log(`Remove room ${room.id} from recent rooms`);
        db.rooms.delete(room.id);
        getAllRecentRooms();
      };
      row1Div.appendChild(filesDiv);
      row1Div.appendChild(deleteIcon);

      const row2Div = document.createElement('div');
      row2Div.classList.add('row2');
      const openLink = document.createElement('button');
      openLink.innerText = 'Open';
      openLink.onclick = function () {
        window.open(getShareLink(room.id, room.key), '_blank').focus();
      };
      const copyLink = document.createElement('button');
      copyLink.onclick = function () {
        navigator.clipboard.writeText(getShareLink(room.id, room.key));
      };
      copyLink.innerText = 'Copy Link';
      row2Div.appendChild(openLink);
      row2Div.appendChild(copyLink);

      roomDiv.appendChild(row1Div);
      roomDiv.appendChild(row2Div);
      recentRoomsParent.appendChild(roomDiv);
    });
    // Only show if there are recent rooms
    if (recentRooms?.length) {
      document.getElementById('recent-rooms').style.display = 'block';
    }
  } catch (ex) {
    console.log(ex);
  }
}

interface SiaShareConfig {
  passwordRequired: boolean;
  maxFileSize?: number;
  maxTotalFileSize?: number;
  maxNumberOfFiles?: number;
}
