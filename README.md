# Gimodi Meet

Browser-based meeting client for Gimodi. Users join a voice channel via invite link -- no installation, no account required. Provides audio, webcam, screen sharing, and channel chat in a Discord/Teams-like meeting UI.

## Quick Start

```bash
npm install
npm run build
```

The build output is in `dist/`. Point `GIMODI_MEET_PATH` to it so the server can serve it.

## Development

```bash
npm run dev      # Watch mode (rebuilds on file changes)
npm run serve    # Build + serve locally
```

## Deployment

### Embedded in Gimodi Server

Set the `GIMODI_MEET_PATH` environment variable on the server to the `dist/` directory:

```bash
GIMODI_MEET_PATH=/path/to/gimodi-meet/dist
```

The server will serve the meet client at `/meet`. Invite links will be accessible at `https://your-server:6833/meet/invite/{id}`.

### Standalone

Serve the `dist/` directory with any static file server (nginx, caddy, etc.) and configure `GIMODI_MEET_URL` on the server to point to the standalone URL so the client generates correct invite links.

### CI / Releases

The GitHub Actions workflow builds the meet client on every push to `meet/` and uploads the `dist/` as an artifact. On version tags (`v*`), a release is created with `gimodi-meet-{version}.tar.gz` attached.

## How It Works

1. A user with the `meet.create_invite` permission creates an invite link for a channel (via the Gimodi client context menu)
2. The invited user opens the link in a browser
3. They enter a nickname and click join
4. The server creates a guest identity, assigns the `guest` role, and places them in the channel
5. Audio, webcam, screen share, and chat are available -- the guest sees only the meeting, not the full server

## Features

- Voice chat (mediasoup WebRTC)
- Webcam with participant video cards
- Screen sharing with focused view
- Channel chat with markdown support
- Speaking indicators (voice activity detection)
- Responsive layout (desktop + mobile)
- No installation required -- runs in any modern browser

## Requirements

- Node.js >= 18 (for building)
- Gimodi Server with mediasoup configured
