import { Device } from 'mediasoup-client';
import { connection } from './server.js';

/**
 * Manages mediasoup voice, webcam, and screen share for Meet.
 */
class MeetVoiceService extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.micProducer = null;
    this.webcamProducer = null;
    this.screenVideoProducer = null;
    this.screenAudioProducer = null;
    /** @type {Map<string, {consumer: object, clientId: string, kind: string, screen: boolean, screenAudio: boolean, webcam: boolean}>} */
    this._consumers = new Map();
    this._muted = false;
    this._deafened = false;
    this._talkingClients = new Set();
    this._audioContext = null;
    this._analysers = new Map();
    this._vadTimer = null;
  }

  /**
   * Sets up the mediasoup Device and transports after joining a channel.
   */
  async setup() {
    const { routerRtpCapabilities } = await connection.request('voice:get-rtp-capabilities');
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities });

    await connection.request('voice:rtp-capabilities', {
      rtpCapabilities: this.device.rtpCapabilities,
    });

    await this._createTransports();
  }

  /** @private */
  async _createTransports() {
    const sendData = await connection.request('voice:create-transport', { direction: 'send' });
    this.sendTransport = this.device.createSendTransport({
      id: sendData.id,
      iceParameters: sendData.iceParameters,
      iceCandidates: sendData.iceCandidates,
      dtlsParameters: sendData.dtlsParameters,
    });

    this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      connection.request('voice:connect-transport', { transportId: this.sendTransport.id, dtlsParameters })
        .then(callback).catch(errback);
    });

    this.sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      connection.request('voice:produce', { transportId: this.sendTransport.id, kind, rtpParameters, appData })
        .then(({ producerId }) => callback({ id: producerId })).catch(errback);
    });

    const recvData = await connection.request('voice:create-transport', { direction: 'recv' });
    this.recvTransport = this.device.createRecvTransport({
      id: recvData.id,
      iceParameters: recvData.iceParameters,
      iceCandidates: recvData.iceCandidates,
      dtlsParameters: recvData.dtlsParameters,
    });

    this.recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      connection.request('voice:connect-transport', { transportId: this.recvTransport.id, dtlsParameters })
        .then(callback).catch(errback);
    });

    connection.addEventListener('voice:consume', (e) => this._handleConsume(e.detail));
  }

  /**
   * Starts the microphone and produces audio.
   */
  async startMicrophone() {
    if (!this.sendTransport) {
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];

    this._monitorTrack(connection.clientId, track.clone());

    this.micProducer = await this.sendTransport.produce({ track });
    this.micProducer.on('transportclose', () => { this.micProducer = null; });

    if (this._muted || this._deafened) {
      this.micProducer.pause();
    }
    this._broadcastMuteState();
  }

  /**
   * Stops the microphone producer.
   */
  stopMicrophone() {
    if (this.micProducer) {
      this.micProducer.close();
      this.micProducer = null;
    }
    this._stopMonitorTrack(connection.clientId);
  }

  /**
   * Toggles mute state.
   * @returns {boolean} Whether now muted
   */
  toggleMute() {
    this._muted = !this._muted;
    if (this.micProducer) {
      this._muted ? this.micProducer.pause() : this.micProducer.resume();
    }
    this._broadcastMuteState();
    this.dispatchEvent(new CustomEvent('mute-changed', { detail: { muted: this._muted } }));
    return this._muted;
  }

  /**
   * Toggles deafen state.
   * @returns {boolean} Whether now deafened
   */
  toggleDeafen() {
    this._deafened = !this._deafened;
    for (const { consumer } of this._consumers.values()) {
      if (consumer.kind === 'audio') {
        this._deafened ? consumer.pause() : consumer.resume();
      }
    }
    if (this._deafened && this.micProducer && !this.micProducer.paused) {
      this.micProducer.pause();
    } else if (!this._deafened && !this._muted && this.micProducer?.paused) {
      this.micProducer.resume();
    }
    this._broadcastMuteState();
    this.dispatchEvent(new CustomEvent('deafen-changed', { detail: { deafened: this._deafened } }));
    return this._deafened;
  }

  get isMuted() { return this._muted; }
  get isDeafened() { return this._deafened; }

  /**
   * Starts webcam and produces video.
   */
  async startWebcam() {
    if (!this.sendTransport) {
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
    });
    const track = stream.getVideoTracks()[0];

    this.webcamProducer = await this.sendTransport.produce({
      track,
      appData: { webcam: true },
      encodings: [{ maxBitrate: 500000 }],
    });

    this.webcamProducer.on('transportclose', () => { this.webcamProducer = null; });
    connection.send('webcam:start');
    this.dispatchEvent(new CustomEvent('webcam-started', { detail: { track } }));
  }

  /**
   * Stops webcam producer.
   */
  stopWebcam() {
    if (this.webcamProducer) {
      this.webcamProducer.close();
      this.webcamProducer = null;
    }
    connection.send('webcam:stop');
    this.dispatchEvent(new CustomEvent('webcam-stopped'));
  }

  /**
   * Starts screen sharing.
   */
  async startScreenShare() {
    if (!this.sendTransport) {
      return;
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: true,
    });

    const videoTrack = stream.getVideoTracks()[0];
    this.screenVideoProducer = await this.sendTransport.produce({
      track: videoTrack,
      appData: { screen: true },
      encodings: [{ maxBitrate: 2000000 }],
    });
    this.screenVideoProducer.on('transportclose', () => { this.screenVideoProducer = null; });

    videoTrack.onended = () => this.stopScreenShare();

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      this.screenAudioProducer = await this.sendTransport.produce({
        track: audioTrack,
        appData: { screen: true, screenAudio: true },
      });
      this.screenAudioProducer.on('transportclose', () => { this.screenAudioProducer = null; });
    }

    connection.send('screen:start');
    this.dispatchEvent(new CustomEvent('screen-started'));
  }

  /**
   * Stops screen sharing.
   */
  stopScreenShare() {
    if (this.screenVideoProducer) {
      this.screenVideoProducer.close();
      this.screenVideoProducer = null;
    }
    if (this.screenAudioProducer) {
      this.screenAudioProducer.close();
      this.screenAudioProducer = null;
    }
    connection.send('screen:stop');
    this.dispatchEvent(new CustomEvent('screen-stopped'));
  }

  get isScreenSharing() { return !!this.screenVideoProducer; }
  get isWebcamOn() { return !!this.webcamProducer; }

  /**
   * @param {string} clientId
   * @returns {boolean}
   */
  isTalking(clientId) {
    return this._talkingClients.has(clientId);
  }

  /**
   * Removes all consumers for a disconnected client.
   * @param {string} clientId
   */
  removeConsumersForClient(clientId) {
    for (const [id, entry] of this._consumers) {
      if (entry.clientId === clientId) {
        entry.consumer.close();
        this._consumers.delete(id);
      }
    }
    this._stopMonitorTrack(clientId);
  }

  /**
   * Cleans up all voice resources.
   */
  cleanup() {
    this.stopMicrophone();
    this.stopWebcam();
    this.stopScreenShare();
    for (const { consumer } of this._consumers.values()) {
      consumer.close();
    }
    this._consumers.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    this._stopVAD();
    for (const entry of this._analysers.values()) {
      entry.analyser.disconnect();
    }
    this._analysers.clear();
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
    }
  }

  /** @private */
  async _handleConsume(data) {
    const { consumerId, producerId, kind, rtpParameters, clientId, nickname, screen, screenAudio, webcam } = data;

    if (!this.recvTransport) {
      return;
    }

    const consumer = await this.recvTransport.consume({ id: consumerId, producerId, kind, rtpParameters });
    this._consumers.set(consumerId, { consumer, clientId, kind, screen: !!screen, screenAudio: !!screenAudio, webcam: !!webcam });

    if (kind === 'audio' && !screenAudio) {
      this._monitorTrack(clientId, consumer.track.clone());
    }

    consumer.on('producerclose', () => {
      this._consumers.delete(consumerId);
      this.dispatchEvent(new CustomEvent('consumer-closed', {
        detail: { consumerId, clientId, kind, screen: !!screen, screenAudio: !!screenAudio, webcam: !!webcam },
      }));
    });

    await connection.request('voice:consumer-resume', { consumerId });

    this.dispatchEvent(new CustomEvent('new-consumer', {
      detail: { consumer, clientId, nickname, kind, screen: !!screen, screenAudio: !!screenAudio, webcam: !!webcam },
    }));
  }

  /** @private */
  _broadcastMuteState() {
    const muted = this._muted || this._deafened;
    connection.send('voice:mute-state', { muted, deafened: this._deafened });
  }

  /** @private */
  _getAudioContext() {
    if (!this._audioContext) {
      this._audioContext = new AudioContext();
    }
    return this._audioContext;
  }

  /** @private */
  _monitorTrack(clientId, track) {
    this._stopMonitorTrack(clientId);
    const ctx = this._getAudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    this._analysers.set(clientId, { analyser, source, track });
    this._startVAD();
  }

  /** @private */
  _stopMonitorTrack(clientId) {
    const entry = this._analysers.get(clientId);
    if (entry) {
      entry.source.disconnect();
      entry.track.stop();
      this._analysers.delete(clientId);
    }
  }

  /** @private */
  _startVAD() {
    if (this._vadTimer) {
      return;
    }
    const dataArray = new Uint8Array(128);
    this._vadTimer = setInterval(() => {
      let changed = false;
      for (const [clientId, { analyser }] of this._analysers) {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const talking = avg > 15;
        const was = this._talkingClients.has(clientId);
        if (talking && !was) {
          this._talkingClients.add(clientId);
          changed = true;
        } else if (!talking && was) {
          this._talkingClients.delete(clientId);
          changed = true;
        }
      }
      if (changed) {
        this.dispatchEvent(new CustomEvent('talking-changed'));
      }
    }, 100);
  }

  /** @private */
  _stopVAD() {
    if (this._vadTimer) {
      clearInterval(this._vadTimer);
      this._vadTimer = null;
    }
    this._talkingClients.clear();
  }
}

export const voiceService = new MeetVoiceService();
