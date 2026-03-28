import { connection } from '../services/server.js';
import { generateGuestIdentity } from '../services/identity.js';

const joinScreen = document.getElementById('join-screen');
const meetingScreen = document.getElementById('meeting-screen');
const joinTitle = document.getElementById('join-title');
const joinSubtitle = document.getElementById('join-subtitle');
const joinError = document.getElementById('join-error');
const joinForm = document.getElementById('join-form');
const joinLoading = document.getElementById('join-loading');
const joinInvalid = document.getElementById('join-invalid');
const nicknameInput = document.getElementById('nickname-input');
const joinBtn = document.getElementById('join-btn');

let inviteId = null;
let serverAddress = null;

/**
 * Extracts the invite ID from the current URL path.
 * Expected format: /meet/invite/{id}
 * @returns {string|null}
 */
function getInviteIdFromUrl() {
  const match = window.location.pathname.match(/\/meet\/invite\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Derives the WebSocket server address from the current page URL.
 * @returns {string}
 */
function getServerAddress() {
  return window.location.host;
}

/**
 * Validates the invite via the HTTP API.
 */
async function validateInvite() {
  inviteId = getInviteIdFromUrl();
  serverAddress = getServerAddress();

  if (!inviteId) {
    showInvalid();
    return;
  }

  try {
    const resp = await fetch(`/meet/api/invite/${inviteId}`);
    const data = await resp.json();

    if (!data.valid) {
      showInvalid();
      return;
    }

    joinLoading.hidden = true;
    joinSubtitle.textContent = data.channelName;
    joinForm.hidden = false;
    nicknameInput.focus();
  } catch {
    showInvalid();
  }
}

/**
 * Shows the invalid invite message.
 */
function showInvalid() {
  joinLoading.hidden = true;
  joinInvalid.hidden = false;
}

/**
 * Shows an error message on the join screen.
 * @param {string} msg
 */
function showError(msg) {
  joinError.textContent = msg;
  joinError.hidden = false;
  joinBtn.disabled = false;
}

/**
 * Attempts to join the meeting.
 */
async function doJoin() {
  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    showError('Please enter a name.');
    return;
  }

  joinError.hidden = true;
  joinBtn.disabled = true;

  try {
    const { publicKey } = await generateGuestIdentity(nickname);
    const data = await connection.connect(serverAddress, inviteId, nickname, publicKey);
    joinScreen.classList.remove('active');
    meetingScreen.classList.add('active');
    window.dispatchEvent(new CustomEvent('meet:joined', { detail: data }));
  } catch (err) {
    showError(err.message || 'Connection failed.');
  }
}

joinBtn.addEventListener('click', doJoin);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    doJoin();
  }
});

validateInvite();
