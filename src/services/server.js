const HEARTBEAT_INTERVAL = 8000;
const REQUEST_TIMEOUT = 10000;

/**
 * Lightweight WebSocket client for Gimodi Meet.
 * Connects via meet:join instead of server:connect.
 */
class MeetConnection extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.clientId = null;
    this.userId = null;
    this.channelId = null;
    this.channelName = null;
    this.permissions = new Set();
    this._requestId = 0;
    this._pendingRequests = new Map();
    this._heartbeatInterval = null;
  }

  /**
   * @param {string} address
   * @param {string} inviteId
   * @param {string} nickname
   * @returns {Promise<object>}
   */
  connect(address, inviteId, nickname) {
    return new Promise((resolve, reject) => {
      let url = address;
      if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        url = `wss://${url}`;
      }

      let settled = false;
      const settle = (fn, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        fn(value);
      };

      const timer = setTimeout(() => {
        settle(reject, new Error('Connection timed out.'));
        this.ws?.close();
      }, 15000);

      this.ws = new WebSocket(url);

      this.ws.onopen = async () => {
        try {
          const data = await this.request('meet:join', { inviteId, nickname });
          this.clientId = data.clientId;
          this.userId = data.userId;
          this.channelId = data.channelId;
          this.channelName = data.channelName;
          this.permissions = new Set(data.permissions || []);
          this._startHeartbeat();
          settle(resolve, data);
        } catch (err) {
          settle(reject, err);
        }
      };

      this.ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        this._handleMessage(msg);
      };

      this.ws.onclose = () => {
        this._stopHeartbeat();
        this._rejectPending('Connection closed');
        this.dispatchEvent(new CustomEvent('disconnected'));
      };

      this.ws.onerror = () => {
        settle(reject, new Error('WebSocket connection failed'));
      };
    });
  }

  /**
   * @param {string} type
   * @param {object} [data]
   * @returns {Promise<object>}
   */
  request(type, data = {}) {
    return new Promise((resolve, reject) => {
      const id = String(++this._requestId);
      this._pendingRequests.set(id, { resolve, reject });
      this.send(type, data, id);
      setTimeout(() => {
        if (this._pendingRequests.has(id)) {
          this._pendingRequests.delete(id);
          reject(new Error(`Request ${type} timed out`));
        }
      }, REQUEST_TIMEOUT);
    });
  }

  /**
   * @param {string} type
   * @param {object} [data]
   * @param {string} [id]
   */
  send(type, data = {}, id) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data, ...(id && { id }) }));
    }
  }

  disconnect() {
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._rejectPending('Disconnected');
    this.dispatchEvent(new CustomEvent('disconnected'));
  }

  /** @private */
  _handleMessage(msg) {
    const { type, data, id } = msg;

    if (type === 'server:ping') {
      return;
    }

    if (id && this._pendingRequests.has(id)) {
      const { resolve, reject } = this._pendingRequests.get(id);
      this._pendingRequests.delete(id);
      if (type === 'server:error') {
        const err = new Error(data.message || data.code);
        err.code = data.code;
        reject(err);
      } else {
        resolve(data);
      }
      return;
    }

    if (type === 'server:kicked' || type === 'server:banned' || type === 'server:shutdown') {
      this.disconnect();
    }

    this.dispatchEvent(new CustomEvent(type, { detail: data }));
  }

  /** @private */
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatInterval = setInterval(() => {
      this.send('server:ping');
    }, HEARTBEAT_INTERVAL);
  }

  /** @private */
  _stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

  /** @private */
  _rejectPending(reason) {
    for (const { reject } of this._pendingRequests.values()) {
      reject(new Error(reason));
    }
    this._pendingRequests.clear();
  }
}

export const connection = new MeetConnection();
