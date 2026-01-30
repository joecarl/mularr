# Mularr

amule + web ui + *arr apis integration

## 🚀 Características y Requisitos Detallados

### 1. Gestión de descargas


## 🛠️ Arquitectura y Tecnologías

### Frontend

-   **Vite + TypeScript**.
-   [**Chispa**](https://github.com/joecarl/chispa): Framework UI propio (ver [documentación](https://github.com/joecarl/chispa/blob/main/DOCUMENTATION.md) y [ejemplos](https://github.com/joecarl/chispa/tree/main/test/example)).
-   **CSS**: Estilos con ficheros `.css` (no se usa SASS en el proyecto). Después de instalar dependencias, se ejecuta `chispa-cli --compile-html` (está configurado en `postinstall`) para compilar los templates HTML a `dist`.

### Backend

-   **Node.js + Express + TypeScript**.
-   **SQLite (better-sqlite3)**: Persistencia de datos local.
-   **Axios**: Comunicación con APIs externas.

## 📂 Estructura del Proyecto

Este es un monorepo:

-   `backend/`: Lógica de servidor y API.
-   `frontend/`: Interfaz de usuario construida con Chispa.

> **⚠️ IMPORTANTE**: No ejecutar `npm install` en la raíz. Hacerlo siempre dentro de `/backend` o `/frontend`.

## 🌐 API (endpoints principales)

La aplicación expone los siguientes endpoints principales bajo `/api`:

-   `/api/tal` — gestión de tal



## ⚙️ Configuración y Ejecución

### 1. Backend

1. `cd backend`
2. `npm install`
3. Configurar `.env` (basado en `.env.example`) con variables como:
    - `???`

4. En desarrollo: `npm run dev` (usa `tsx watch`).
5. Para producción: `npm run build` y luego `node dist/index.js` (o usar la imagen Docker incluida).

### 2. Frontend

1. `cd frontend`
2. `npm install`
3. `npm run dev`

## 📝 Notas de Desarrollo

-   ???

## Docker implementation for Mularr

### How to build

From the root of the project:

```bash
docker build -t mularr .
```

### Configuration

The application expects several environment variables:

-   `PORT`: Port to listen on (default 8940)
