# Mularr

**Mularr** is a powerful integration for **aMule** that provides a functional web interface with a retro touch and bridges the gap between classic P2P and modern automation tools. It offers **qBittorrent-compatible APIs** and **Torznab indexers**, making it easy to use aMule with your favorite \*arr apps like Sonarr and Radarr.

---

## ✨ Key Features

- 🌐 **Retro-Style Web Interface**: A responsive UI with a nostalgic feel (Windows XP style). Includes multiple themes like Classic, Windows 11 (Experimental), and more. Built with [Chispa](https://github.com/joecarl/chispa).
- 🔗 **\*Arr Integration**: Native support for Sonarr/Radarr via qBittorrent API compatibility.
- 🔍 **Torznab Support**: Integrated indexer for easy searching.
- 📦 **Docker Ready**: Easy deployment using Docker and Docker Compose.
- 📱 **Telegram Notifications**: Get notified of your downloads directly on Telegram.
- 🛡️ **VPN Ready**: Built-in support for Gluetun health checks.
- 🗄️ **Lightweight**: High performance with Node.js and SQLite.

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

    # Have a look at docker-compose.example.yml for extended documentation
```

Run it with:

```bash
docker-compose up -d
```

Access the UI at `http://localhost:8940`.

---

## 📸 Screenshots

<p align="center">
  <img src="https://games.copinstar.com/img/mularr/mularr01.png" alt="Transfers">
  <img src="https://games.copinstar.com/img/mularr/mularr02.png" alt="Settings">
</p>

---

## 🛠️ Tech Stack

| Component       | Technology                                                            |
| :-------------- | :-------------------------------------------------------------------- |
| **Frontend**    | [Chispa](https://github.com/joecarl/chispa) + TypeScript + Vite       |
| **Backend**     | Node.js + Express + TypeScript                                        |
| **Database**    | SQLite ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) |
| **Integration** | aMule (amuled + amulecmd)                                             |

---

## ⚙️ Configuration (Environment Variables)

| Variable             | Description                  | Default                    |
| :------------------- | :--------------------------- | :------------------------- |
| `PORT`               | Backend listening port       | `8940`                     |
| `DATABASE_PATH`      | Path to the SQLite file      | `./database.sqlite`        |
| `AMULE_CONFIG_DIR`   | Directory for aMule config   | _Optional_                 |
| `TELEGRAM_BOT_TOKEN` | Bot token for notifications  | _Optional_                 |
| `TELEGRAM_CHAT_ID`   | Telegram chat ID             | _Required for TG_          |
| `TELEGRAM_TOPIC_ID`  | Telegram thread/topic ID     | _Optional_                 |
| `GLUETUN_ENABLED`    | Enable Gluetun health checks | `false`                    |
| `GLUETUN_API`        | Gluetun API endpoint         | `http://localhost:8000/v1` |

---

## 👨‍💻 Development Setup

If you want to contribute or run Mularr from source, follow these steps:

### 1. Repository Structure

- `backend/` – Express server and business logic.
- `frontend/` – Web application using Chispa.

> [!WARNING]
> Do **not** run `npm install` in the root folder. Install dependencies separately in `backend/` and `frontend/`.

### 2. Backend Setup

```bash
cd backend
npm install
npm run dev
```

The server will start at `http://localhost:8940`.

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Access the development server (Vite) at the provided URL (usually `http://localhost:5173`).

---

## 📦 Production Build

The included `Dockerfile` handles everything for you. It builds the frontend and bundles it with the backend for a single-image deployment.

```bash
docker build -t mularr .
```

---

## 🌐 API & Integration

Mularr provides several endpoints for external integrations:

- **qBittorrent API**: `/api/as-qbittorrent/api/v2/*` (Use this in Sonarr/Radarr).
- **Torznab Indexer**: `/api/as-torznab-indexer`.
- **System API**: `/api/system`.
- **aMule API**: `/api/amule/*`.

---

## 🤝 Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<p align="center">
  Made with ❤️ for the P2P Community
</p>
