# Mularr

**Mularr** integrates aMule with a web interface and provides \*arr-style (Sonarr/Radarr) and qBittorrent compatible APIs to simplify download management.

---

## 🚀 Key features

- Manage downloads via aMule.
- qBittorrent API compatibility for Sonarr/Radarr (`/api/as-qbittorrent/api/v2`).
- Torznab indexer for Sonarr/Radarr integration (`/api/as-torznab-indexer`).
- Frontend built with **Vite**, **TypeScript** and [**Chispa**](https://github.com/joecarl/chispa) (the best UI framework ever invented; see [documentation](https://github.com/joecarl/chispa/blob/main/DOCUMENTATION.md) and [examples](https://github.com/joecarl/chispa/tree/main/test/example)).
- Local persistence using **SQLite** (`better-sqlite3`).

---

## 🛠️ Technologies

- Frontend: **Vite + TypeScript + Chispa**
- Backend: **Node.js + Express + TypeScript**
- DB: **SQLite** (via `better-sqlite3`)
- HTTP client: **Axios**

---

## 📂 Repository structure

- `backend/` – server, API and business logic.
- `frontend/` – web application (Vite + Chispa).

> ⚠️ Do not run `npm install` in the repository root: install dependencies separately in `backend` and `frontend`.

---

## ⚙️ Important environment variables

| Variable             | Description                                        | Default / Notes                         |
| -------------------- | -------------------------------------------------- | --------------------------------------- |
| `PORT`               | Port the backend listens on                        | `8940`                                  |
| `DATABASE_PATH`      | Path to the SQLite database file                   | `./database.sqlite` (default)           |
| `AMULE_CONFIG_DIR`   | Directory for aMule configuration                  | Optional                                |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (optional)                      | Enables notifications when present      |
| `TELEGRAM_CHAT_ID`   | Chat ID to send messages to                        | Required if `TELEGRAM_BOT_TOKEN` is set |
| `TELEGRAM_TOPIC_ID`  | (Optional) Telegram thread/topic to group messages | Integer                                 |
| `GLUETUN_API`        | Gluetun API base URL                               | `http://localhost:8000/v1`              |
| `GLUETUN_ENABLED`    | Flag to enable Gluetun checks                      | `false` (set to `true` to enable)       |

---

## 🏁 Running in development

### Backend

1. Open a terminal and run:

```bash
cd backend
npm install
npm run dev   # runs the server in watch mode (tsx)
```

The server starts at `http://localhost:8940` (or the port configured in `PORT`).

> Note: the SQLite database file is created automatically at the path configured in `DATABASE_PATH`.

### Frontend

1. Open a terminal and run:

```bash
cd frontend
npm install
npm run dev   # Vite, accessible from 0.0.0.0 for container usage
```

The frontend runs on the port Vite assigns (default 5173) and consumes the backend API; configure URLs as needed.

> Requirement: the frontend `postinstall` runs `chispa-cli --compile-html`. Make sure `chispa-cli` is available when running `npm install`.

---

## 📦 Build and deployment (production)

The included Dockerfile builds the `frontend` and copies `dist` into `backend/public` so the backend serves the SPA:

From the repository root:

```bash
docker build -t mularr .
```

The image exposes port `8940` by default. The `/app/data` folder is used to store the database and persistent configuration.

---

## 🌐 Relevant endpoints

- `GET /api/system` – system endpoints (see `backend/src/controllers/SystemController.ts`).
- `GET/POST /api/amule/*` – aMule interactions (info, search, downloads, servers, categories, etc.).
- `GET/POST /api/as-qbittorrent/api/v2/*` – qBittorrent compatibility (authentication, torrents, categories).
- `GET /api/as-torznab-indexer` – Torznab indexer endpoint for Sonarr/Radarr.

Check the routes in `backend/src/routes` for the full list.

---

## 💡 Development notes

- The `downloads` table is created automatically when the backend starts (see `backend/src/db.ts`).
- To compile TypeScript: `cd backend && npm run build`.
- On Alpine (Docker), build tools are required for `better-sqlite3`; the `Dockerfile` already includes the necessary packages.

---

## 🧪 Tests and quality

There are no automated tests included at the moment. PRs adding tests and CI are welcome.

---

## 🤝 Contributing

Open issues or pull requests; follow good commit practices and keep compatibility with documented routes and environment variables.
