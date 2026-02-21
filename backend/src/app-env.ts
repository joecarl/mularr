import { readFileSync } from 'fs';
import path from 'path/posix';

export interface AppManifest {
	version: string;
}

export const __APP_MANIFEST__ = JSON.parse(readFileSync(path.join(__dirname, '../../app-manifest.json'), 'utf-8')) as AppManifest;

// TODO: cargar aqui también las variables de entorno
export const __APP_CONFIG__ = {};
