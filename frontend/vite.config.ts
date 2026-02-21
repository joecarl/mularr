import { defineConfig } from 'vite';
import { chispaHtmlPlugin } from 'chispa/vite-plugin';
import manifest from '../app-manifest.json';

export default defineConfig({
	plugins: [chispaHtmlPlugin()],
	define: {
		__APP_MANIFEST__: JSON.stringify(manifest),
	},
	server: {
		proxy: {
			'/api': {
				target: 'http://localhost:8940',
				changeOrigin: true,
			},
		},
	},
});
