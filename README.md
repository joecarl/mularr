<p align="">
  <img src="https://games.copinstar.com/img/mularr/mularr-logo.png?1" alt="Logo">
</p>

# Mularr

[![Docker Image](https://ghcr-badge.egpl.dev/joecarl/mularr/latest_tag?trim=major&label=ghcr.io%2Fjoecarl%2Fmularr&color=blue)](https://github.com/joecarl/mularr/pkgs/container/mularr)

[![Docker Pulls](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Fjoecarl%2Fmularr%2Fmularr&query=downloadCount&style=for-the-badge&logo=docker&label=Docker%20Pulls&color=2496ed)](https://github.com/joecarl/mularr/pkgs/container/mularr)

**Mularr** is a powerful integration for **aMule** that provides a functional web interface with a nostalgia-infused retro touch. It bridges the gap between classic P2P and modern automation tools by offering **qBittorrent-compatible APIs** and **Torznab indexers**, making it seamless to use aMule with apps like Sonarr and Radarr.

It also includes an extension to use the **Telegram Network** as a download provider. This requires a real account (not a bot) to access groups/channels with media files.

<p align="center">
  <img src="https://games.copinstar.com/img/mularr/screenshots/dashboard-xp.png" alt="Mularr dashboard (Windows XP theme)" width="49%">
  <img src="https://games.copinstar.com/img/mularr/screenshots/transfers-xp.png" alt="Transfers (Windows XP theme)" width="49%">
</p>

---

## Key Features

- **\*Arr Integration**: Native support for Sonarr/Radarr via qBittorrent & Torznab API compatibility.
- **Docker Ready**: Easy deployment using Docker and Docker Compose.
- **Telegram Integration**:
    - **Notifications**: Get notified of your downloads via a Telegram bot.
    - **Provider**: Use the Telegram network for searching and downloading files.
- 🛡️ **VPN Ready**: Built-in support for Gluetun health checks and automatic port updates.
- **Retro-Style Web Interface**: A fully responsive UI with a nostalgic Windows XP feel. Includes multiple themes like Classic, Windows 11, Hacker and Modern.
- **Built with [Chispa](https://github.com/joecarl/chispa).**

---

## Quick Start with Docker 🐳

The easiest way to get Mularr running is using Docker Compose:

```yml
services:
    mularr:
        image: ghcr.io/joecarl/mularr
        container_name: mularr
        restart: unless-stopped
        ports:
            - '8940:8940'
        volumes:
            - ./data:/app/data

    # Check docker-compose.example.yml for a full configuration guide
```

Run it with:

```bash
docker-compose up -d
```

Access the web UI at `http://localhost:8940`.

---

## Screenshots

Mularr ships with multiple themes:

### Modern & Hacker Mode

<p align="center">
  <img src="https://games.copinstar.com/img/mularr/screenshots/dashboard-modern.png" alt="Dashboard (Modern theme)" width="49%%">
  <img src="https://games.copinstar.com/img/mularr/screenshots/dashboard-hacker.png" alt="Dashboard (Hacker Mode theme)" width="49%%">
</p>
<p align="center"><sub>Dashboard view</sub></p>

### Windows XP

<p align="center">
  <img src="https://games.copinstar.com/img/mularr/screenshots/dashboard-xp.png" alt="Dashboard (Windows XP theme)" width="32%">
  <img src="https://games.copinstar.com/img/mularr/screenshots/transfers-xp.png" alt="Transfers (Windows XP theme)" width="32%">
  <img src="https://games.copinstar.com/img/mularr/screenshots/settings-xp.png" alt="Settings (Windows XP theme)" width="32%">
</p>
<p align="center"><sub> Dashboard, Transfers and Settings view</sub></p>
  
### Windows Classic

<p align="center">
  <img src="https://games.copinstar.com/img/mularr/screenshots/dashboard-classic.png" alt="Dashboard (Windows Classic theme)" width="32%%">
  <img src="https://games.copinstar.com/img/mularr/screenshots/transfers-classic.png" alt="Transfers (Windows Classic theme)" width="32%">
  <img src="https://games.copinstar.com/img/mularr/screenshots/settings-classic.png" alt="Settings (Windows Classic theme)" width="32%">
</p>
<p align="center"><sub> Dashboard, Transfers and Settings view</sub></p>

---

## Integrate with Sonarr / Radarr

You can configure Mularr as both an indexer and a download client.

> [!TIP]
> In Sonarr/Radarr's configuration forms, click **Show Advanced** to reveal all required fields.

To configure as indexer use the following settings:

- **Type**: Torznab
- **API Path**: `/api/as-torznab-indexer`

To configure as download client use the following settings:

- **Type**: qBittorrent
- **URL Base**: `/api/as-qbittorrent`

## Tech Stack

Mularr is built primarily with TypeScript.

| Component    | Technology                                                            |
| :----------- | :-------------------------------------------------------------------- |
| **Frontend** | [Chispa](https://github.com/joecarl/chispa) + Vite                    |
| **Backend**  | Node.js + Express                                                     |
| **Database** | SQLite ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) |

---

## 💻 Development Setup

If you want to contribute or run Mularr you need docker & VS Code devcontainers.
Open the project in the devcontainer and it automatically installs the needed dependencies.

Then you can start the application in dev mode:

### 1. Backend Setup

```bash
cd backend
npm run dev
```

### 2. Frontend Setup

```bash
cd frontend
npm run dev
```

---

## Production Build

The included `Dockerfile` handles everything for you. It builds the frontend and bundles it with the backend for a single-image deployment.

```bash
docker build -t mularr .
```

---

## Contributing

To contribute, follow the standard process:

1. Fork the Project
2. Create your feature branch & Commit your changes
3. Open a Pull Request

Any contributions you make are **greatly appreciated**.

---

## License

MIT

---

<p align="center">
  Made with ❤️ for the P2P Community
</p>
