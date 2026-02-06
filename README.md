# Mularr

**Mularr** integra amule con una interfaz web y compatibilidad con APIs tipo \*arr (Sonarr/Radarr) y qBittorrent para facilitar la gestión de descargas.

---

## 🚀 Características principales

- Gestión de descargas vía aMule.
- Compatibilidad con qBittorrent API para Sonarr/Radarr (`/api/as-qbittorrent/api/v2`).
- Torznab indexer para integración con Sonarr/Radarr (`/api/as-torznab-indexer`).
- Interfaz frontend construida con **Vite**, **TypeScript** y [**Chispa**](https://github.com/joecarl/chispa) (el mejor framework UI jamás inventado; ver [documentación](https://github.com/joecarl/chispa/blob/main/DOCUMENTATION.md) y [ejemplos](https://github.com/joecarl/chispa/tree/main/test/example)).
- Persistencia local con **SQLite** (`better-sqlite3`).

---

## 🛠️ Tecnologías

- Frontend: **Vite + TypeScript + Chispa**
- Backend: **Node.js + Express + TypeScript**
- DB: **SQLite** (via `better-sqlite3`)
- Comunicación HTTP: **Axios**

---

## 📂 Estructura del repositorio

- `backend/` – servidor, API y lógica de negocio.
- `frontend/` – aplicación web (Vite + Chispa).

> ⚠️ No ejecutar `npm install` en la raíz: instalar dependencias por separado en `backend` y `frontend`.

---

## ⚙️ Variables de entorno importantes

| Variable             | Descripción                                               | Valor por defecto / Notas                               |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| `PORT`               | Puerto en el que escucha el backend                       | `8940`                                                  |
| `DATABASE_PATH`      | Ruta al fichero SQLite                                    | `./database.sqlite` (por defecto)                       |
| `AMULE_CONFIG_DIR`   | Directorio para la configuración de aMule                 | Opcional                                                |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram (opcional)                      | Si está presente se habilita el envío de notificaciones |
| `TELEGRAM_CHAT_ID`   | ID del chat donde enviar mensajes                         | Requerido si `TELEGRAM_BOT_TOKEN` está definido         |
| `TELEGRAM_TOPIC_ID`  | (Opcional) thread/topic en Telegram para agrupar mensajes | Número entero                                           |
| `GLUETUN_API`        | URL de la API de Gluetun                                  | `http://localhost:8000/v1`                              |
| `GLUETUN_ENABLED`    | Flag para habilitar comprobaciones de Gluetun             | `false` (usar `true` para habilitar)                    |

---

## 🏁 Ejecutar en desarrollo

### Backend

1. Abrir terminal y ejecutar:

```bash
cd backend
npm install
npm run dev   # ejecuta server en modo watch (tsx)
```

El servidor arranca en `http://localhost:8940` (o el puerto que configures en `PORT`).

> Nota: la base de datos SQLite se crea automáticamente en la ruta indicada por `DATABASE_PATH`.

### Frontend

1. Abrir terminal y ejecutar:

```bash
cd frontend
npm install
npm run dev   # Vite, accesible desde 0.0.0.0 para uso en contenedores
```

El frontend en desarrollo corre en el puerto que Vite determine (por defecto 5173) y consume la API del backend configurando las URL según sea necesario.

> Requisito: el `postinstall` del frontend ejecuta `chispa-cli --compile-html`. Asegúrate de tener `chispa-cli` disponible si trabajas con `npm install`.

---

## 📦 Construcción y despliegue (producción)

La imagen Docker incluida construye el `frontend` y copia `dist` a `backend/public` para que el backend sirva la SPA:

Desde la raíz del proyecto:

```bash
docker build -t mularr .
```

La imagen expone el puerto `8940` por defecto. La carpeta `/app/data` se utiliza para almacenar la base de datos y configuraciones persistentes.

---

## 🌐 Endpoints relevantes

- `GET /api/system` – endpoints del sistema (ver `backend/src/controllers/SystemController.ts`).
- `GET/POST /api/amule/*` – interacción con aMule (info, búsqueda, descargas, servidores, categorías, etc.).
- `GET/POST /api/as-qbittorrent/api/v2/*` – compatibilidad qBittorrent (autenticación, torrents, categorías).
- `GET /api/as-torznab-indexer` – Torznab indexer endpoint para Sonarr/Radarr.

Consulta las rutas en `backend/src/routes` para ver la lista completa.

---

## 💡 Notas de desarrollo

- La tabla de `downloads` se crea automáticamente al arrancar el backend (ver `backend/src/db.ts`).
- Para compilar TypeScript: `cd backend && npm run build`.
- En Alpine (imagen Docker) es necesario tener herramientas de compilación para `better-sqlite3`; el `Dockerfile` ya contempla los paquetes necesarios.

---

## 🧪 Tests y calidad

Actualmente no hay tests automáticos incluidos. Se aceptan PRs que añadan pruebas y CI.

---

## 🤝 Contribuir

Abrir issues o pull requests; seguir las buenas prácticas de commit y mantener la compatibilidad con las rutas y variables documentadas.
