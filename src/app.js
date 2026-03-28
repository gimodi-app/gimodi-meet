import './views/join.js';
import { initMeeting } from './views/meeting.js';
import { initChat } from './views/chat.js';

window.addEventListener('meet:joined', (e) => {
  initMeeting(e.detail);
  initChat();
});
