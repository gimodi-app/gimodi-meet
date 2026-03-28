import { marked } from 'marked';
import { connection } from '../services/server.js';

const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatCloseBtn = document.getElementById('chat-close-btn');
const btnChat = document.getElementById('btn-chat');
const chatBadge = document.getElementById('chat-badge');

let chatOpen = false;
let unreadCount = 0;

marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * Escapes HTML to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Renders a chat message and appends it to the message list.
 * @param {object} msg
 */
function renderMessage(msg) {
  const el = document.createElement('div');
  el.className = 'chat-message';

  const header = document.createElement('div');
  header.className = 'chat-msg-header';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'chat-msg-name';
  nameSpan.textContent = msg.nickname || 'Unknown';
  header.appendChild(nameSpan);

  const timeSpan = document.createElement('span');
  timeSpan.className = 'chat-msg-time';
  const date = new Date(msg.timestamp || Date.now());
  timeSpan.textContent = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  header.appendChild(timeSpan);

  el.appendChild(header);

  const body = document.createElement('div');
  body.className = 'chat-msg-body';
  body.innerHTML = marked.parse(escapeHtml(msg.content));
  el.appendChild(body);

  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Sends a chat message.
 */
function sendMessage() {
  const content = chatInput.value.trim();
  if (!content) {
    return;
  }
  connection.send('chat:send', { channelId: connection.channelId, content });
  chatInput.value = '';
}

/**
 * Toggles the chat panel.
 */
function toggleChat() {
  chatOpen = !chatOpen;
  chatPanel.hidden = !chatOpen;
  btnChat.classList.toggle('active', chatOpen);
  if (chatOpen) {
    unreadCount = 0;
    chatBadge.hidden = true;
    chatInput.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

/**
 * Initializes the chat view after joining.
 */
export function initChat() {
  btnChat.addEventListener('click', toggleChat);
  chatCloseBtn.addEventListener('click', toggleChat);
  chatSendBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  connection.addEventListener('chat:receive', (e) => {
    renderMessage(e.detail);
    if (!chatOpen) {
      unreadCount++;
      chatBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      chatBadge.hidden = false;
    }
  });

  connection.send('chat:subscribe', { channelId: connection.channelId });

  connection.request('chat:history', { channelId: connection.channelId }).then((data) => {
    const messages = data.messages || [];
    for (const msg of messages) {
      renderMessage(msg);
    }
  }).catch(() => {});
}
