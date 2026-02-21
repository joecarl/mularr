# Mularr

**Mularr** is a powerful integration for **aMule** that provides a functional web interface with a nostalgia-infused retro touch. It bridges the gap between classic P2P and modern automation tools by offering **qBittorrent-compatible APIs** and **Torznab indexers**, making it seamless to use aMule with modern apps like Sonarr and Radarr.

It also includes an extension to use the **Telegram Network** as a download provider. This requires a real account (not a bot) to access groups/channels with media files.

---

## ✨ Key Features

- 🌐 **Retro-Style Web Interface**: A fully responsive UI with a nostalgic Windows XP feel. Includes multiple themes like Classic and Windows 11 (Experimental). Built with [Chispa](https://github.com/joecarl/chispa).
- 🔗 **\*Arr Integration**: Native support for Sonarr/Radarr via qBittorrent & Torznab API compatibility.
- 📦 **Docker Ready**: Easy deployment using Docker and Docker Compose.
- 📬 **Telegram Integration**:
    - **Notifications**: Get notified of your downloads via a Telegram bot.
    - **Provider**: Use the Telegram network for searching and downloading files.
- 🛡️ **VPN Ready**: Built-in support for Gluetun health checks and automatic port updates.
- 🗄️ **Lightweight & Fast**: High performance built with Node.js and SQLite.

---

## 🚀 Quick Start with Docker

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

## 📸 Screenshots

<p align="center">
  <img src="https://games.copinstar.com/img/mularr/mularr01.png" alt="Transfers">
  <img src="https://games.copinstar.com/img/mularr/mularr02.png" alt="Settings">
</p>

---

## Integrate with Sonarr / Radarr

You can configure Mularr as both an indexer and a download client.

To configure as indexer use the following settings:

- **Type**: Torznab
- **API Path**: `/api/as-torznab-indexer`

To configure as download client use the following settings:

- **Type**: qBittorrent
- **URL Base**: `/api/as-qbittorrent`

## 🛠️ Tech Stack

Mularr is built primarily with TypeScript.

| Component    | Technology                                                            |
| :----------- | :-------------------------------------------------------------------- |
| **Frontend** | [Chispa](https://github.com/joecarl/chispa) + Vite                    |
| **Backend**  | Node.js + Express                                                     |
| **Database** | SQLite ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) |

---

## 👨‍💻 Development Setup

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

> [!WARNING]
> Do **not** run `npm install` in the root folder. Install dependencies separately in `backend/` and `frontend/`.

---

## 📦 Production Build

The included `Dockerfile` handles everything for you. It builds the frontend and bundles it with the backend for a single-image deployment.

```bash
docker build -t mularr .
```

---

## 🤝 Contributing

To contribute, follow the standard process:

1. Fork the Project
2. Create your feature branch & Commit your changes
3. Open a Pull Request

Any contributions you make are **greatly appreciated**.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<p align="center">
  Made with ❤️ for the P2P Community
</p>
