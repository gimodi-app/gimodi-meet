import { connection } from '../services/server.js';
import { voiceService } from '../services/voice.js';

const participantGrid = document.getElementById('participant-grid');
const screenShareView = document.getElementById('screen-share-view');
const screenShareVideo = document.getElementById('screen-share-video');
const screenShareLabel = document.getElementById('screen-share-label');

const btnMic = document.getElementById('btn-mic');
const btnDeafen = document.getElementById('btn-deafen');
const btnCam = document.getElementById('btn-cam');
const btnScreen = document.getElementById('btn-screen');
const btnLeave = document.getElementById('btn-leave');

/** @type {Map<string, {nickname: string, muted: boolean, deafened: boolean, webcamTrack: MediaStreamTrack|null, screenTrack: MediaStreamTrack|null}>} */
const participants = new Map();

/** @type {string|null} */
let activeScreenShareClientId = null;

/**
 * Generates initials from a nickname.
 * @param {string} name
 * @returns {string}
 */
function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Generates a consistent color from a string.
 * @param {string} str
 * @returns {string}
 */
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

/**
 * Creates or updates a participant card in the grid.
 * @param {string} clientId
 */
function renderParticipant(clientId) {
  const p = participants.get(clientId);
  if (!p) {
    return;
  }

  let card = document.getElementById(`participant-${clientId}`);
  if (!card) {
    card = document.createElement('div');
    card.id = `participant-${clientId}`;
    card.className = 'participant-card';
    participantGrid.appendChild(card);
  }

  const isSelf = clientId === connection.clientId;
  const talking = voiceService.isTalking(clientId);
  card.classList.toggle('talking', talking);
  card.classList.toggle('self', isSelf);

  const webcamTrack = p.webcamTrack;
  let videoEl = card.querySelector('video.webcam-video');

  if (webcamTrack) {
    if (!videoEl) {
      videoEl = document.createElement('video');
      videoEl.className = 'webcam-video';
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.muted = isSelf;
      card.prepend(videoEl);
    }
    if (videoEl.srcObject?.getVideoTracks()[0] !== webcamTrack) {
      videoEl.srcObject = new MediaStream([webcamTrack]);
    }
  } else if (videoEl) {
    videoEl.srcObject = null;
    videoEl.remove();
  }

  let avatar = card.querySelector('.participant-avatar');
  if (!avatar) {
    avatar = document.createElement('div');
    avatar.className = 'participant-avatar';
    avatar.style.backgroundColor = stringToColor(p.nickname);
    card.appendChild(avatar);
  }
  avatar.textContent = getInitials(p.nickname);
  avatar.hidden = !!webcamTrack;

  let nameEl = card.querySelector('.participant-name');
  if (!nameEl) {
    nameEl = document.createElement('div');
    nameEl.className = 'participant-name';
    card.appendChild(nameEl);
  }

  let statusIcons = '';
  if (p.muted || p.deafened) {
    statusIcons += '<span class="status-icon muted-icon" title="Stummgeschaltet">🔇</span>';
  }
  if (p.deafened) {
    statusIcons += '<span class="status-icon deafened-icon" title="Lautlos">🔕</span>';
  }

  nameEl.innerHTML = '';
  const nameText = document.createElement('span');
  nameText.textContent = p.nickname + (isSelf ? ' (Du)' : '');
  nameEl.appendChild(nameText);
  if (statusIcons) {
    const iconsSpan = document.createElement('span');
    iconsSpan.className = 'status-icons';
    iconsSpan.innerHTML = statusIcons;
    nameEl.appendChild(iconsSpan);
  }

  updateGridLayout();
}

/**
 * Removes a participant card.
 * @param {string} clientId
 */
function removeParticipantCard(clientId) {
  const card = document.getElementById(`participant-${clientId}`);
  if (card) {
    card.remove();
  }
  updateGridLayout();
}

/**
 * Updates the CSS grid layout based on participant count.
 */
function updateGridLayout() {
  const count = participantGrid.children.length;
  participantGrid.dataset.count = count;
}

/**
 * Shows a remote screen share.
 * @param {string} clientId
 * @param {MediaStreamTrack} track
 */
function showScreenShare(clientId, track) {
  activeScreenShareClientId = clientId;
  const p = participants.get(clientId);
  screenShareLabel.textContent = p ? `${p.nickname} is sharing their screen` : 'Screen is being shared';
  screenShareVideo.srcObject = new MediaStream([track]);
  screenShareView.hidden = false;
  participantGrid.classList.add('with-screen-share');
}

/**
 * Hides the screen share view.
 */
function hideScreenShare() {
  activeScreenShareClientId = null;
  screenShareVideo.srcObject = null;
  screenShareView.hidden = true;
  participantGrid.classList.remove('with-screen-share');
}

/**
 * Initializes the meeting view after joining.
 * @param {object} data - meet:welcome payload
 */
export async function initMeeting(data) {
  for (const p of data.participants) {
    participants.set(p.id, {
      nickname: p.nickname,
      muted: p.muted || false,
      deafened: p.deafened || false,
      webcamTrack: null,
      screenTrack: null,
    });
    renderParticipant(p.id);
  }

  try {
    await voiceService.setup();
    await voiceService.startMicrophone();
  } catch (err) {
    console.error('Voice setup failed:', err);
  }

  setupConnectionListeners();
  setupControlListeners();
}

/**
 * Wires up WebSocket event listeners for participant changes.
 */
function setupConnectionListeners() {
  connection.addEventListener('channel:user-joined', (e) => {
    const { clientId, nickname } = e.detail;
    participants.set(clientId, { nickname, muted: false, deafened: false, webcamTrack: null, screenTrack: null });
    renderParticipant(clientId);
    playAudio('join');
  });

  connection.addEventListener('channel:user-left', (e) => {
    const { clientId } = e.detail;
    participants.delete(clientId);
    voiceService.removeConsumersForClient(clientId);
    removeParticipantCard(clientId);
    if (activeScreenShareClientId === clientId) {
      hideScreenShare();
    }
    playAudio('leave');
  });

  connection.addEventListener('server:client-left', (e) => {
    const { clientId } = e.detail;
    participants.delete(clientId);
    voiceService.removeConsumersForClient(clientId);
    removeParticipantCard(clientId);
    if (activeScreenShareClientId === clientId) {
      hideScreenShare();
    }
  });

  connection.addEventListener('voice:mute-state', (e) => {
    const { clientId, muted, deafened } = e.detail;
    const p = participants.get(clientId);
    if (p) {
      p.muted = muted;
      p.deafened = deafened;
      renderParticipant(clientId);
    }
  });

  connection.addEventListener('screen:started', (e) => {
    const { clientId } = e.detail;
    const p = participants.get(clientId);
    if (p) {
      p.screenSharing = true;
    }
  });

  connection.addEventListener('screen:stopped', (e) => {
    const { clientId } = e.detail;
    const p = participants.get(clientId);
    if (p) {
      p.screenSharing = false;
    }
    if (activeScreenShareClientId === clientId) {
      hideScreenShare();
    }
  });

  voiceService.addEventListener('new-consumer', (e) => {
    const { consumer, clientId, kind, screen, screenAudio, webcam } = e.detail;

    if (screen && kind === 'video') {
      showScreenShare(clientId, consumer.track);
      return;
    }

    if (screen && screenAudio) {
      const audio = new Audio();
      audio.srcObject = new MediaStream([consumer.track]);
      audio.play().catch(() => {});
      return;
    }

    if (webcam && kind === 'video') {
      const p = participants.get(clientId);
      if (p) {
        p.webcamTrack = consumer.track;
        renderParticipant(clientId);
      }
      return;
    }

    if (kind === 'audio') {
      const audio = new Audio();
      audio.srcObject = new MediaStream([consumer.track]);
      audio.play().catch(() => {});
    }
  });

  voiceService.addEventListener('consumer-closed', (e) => {
    const { clientId, screen, webcam, kind } = e.detail;
    if (screen && kind === 'video' && activeScreenShareClientId === clientId) {
      hideScreenShare();
    }
    if (webcam && kind === 'video') {
      const p = participants.get(clientId);
      if (p) {
        p.webcamTrack = null;
        renderParticipant(clientId);
      }
    }
  });

  voiceService.addEventListener('talking-changed', () => {
    for (const clientId of participants.keys()) {
      renderParticipant(clientId);
    }
  });

  voiceService.addEventListener('webcam-started', (e) => {
    const p = participants.get(connection.clientId);
    if (p) {
      p.webcamTrack = e.detail.track;
      renderParticipant(connection.clientId);
    }
  });

  voiceService.addEventListener('webcam-stopped', () => {
    const p = participants.get(connection.clientId);
    if (p) {
      p.webcamTrack = null;
      renderParticipant(connection.clientId);
    }
  });

  voiceService.addEventListener('screen-started', () => {
    btnScreen.classList.add('active');
  });

  voiceService.addEventListener('screen-stopped', () => {
    btnScreen.classList.remove('active');
  });

  connection.addEventListener('disconnected', () => {
    document.getElementById('meeting-screen').classList.remove('active');
    document.getElementById('join-screen').classList.add('active');
  });
}

/**
 * Sets up the control bar button listeners.
 */
function setupControlListeners() {
  btnMic.addEventListener('click', () => {
    voiceService.toggleMute();
    btnMic.classList.toggle('off', voiceService.isMuted);
  });

  btnDeafen.addEventListener('click', () => {
    voiceService.toggleDeafen();
    btnDeafen.classList.toggle('off', voiceService.isDeafened);
    btnMic.classList.toggle('off', voiceService.isMuted || voiceService.isDeafened);
  });

  btnCam.addEventListener('click', async () => {
    if (voiceService.isWebcamOn) {
      voiceService.stopWebcam();
      btnCam.classList.remove('active');
    } else {
      try {
        await voiceService.startWebcam();
        btnCam.classList.add('active');
      } catch (err) {
        console.error('Webcam failed:', err);
      }
    }
  });

  btnScreen.addEventListener('click', async () => {
    if (voiceService.isScreenSharing) {
      voiceService.stopScreenShare();
    } else {
      try {
        await voiceService.startScreenShare();
      } catch (err) {
        if (err.name !== 'NotAllowedError') {
          console.error('Screen share failed:', err);
        }
      }
    }
  });

  btnLeave.addEventListener('click', () => {
    voiceService.cleanup();
    connection.disconnect();
    window.close();
    window.location.href = '/meet';
  });
}

/**
 * Plays a UI sound effect.
 * @param {'join'|'leave'} type
 */
function playAudio(type) {
  // Placeholder - can add sound files later
}
