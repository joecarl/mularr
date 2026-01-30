import { defineConfig } from 'vite';
import { chispaHtmlPlugin } from 'chispa/vite-plugin';

export default defineConfig({
	plugins: [chispaHtmlPlugin()],
	server: {
		proxy: {
			'/api': {
				target: 'http://localhost:8940',
				changeOrigin: true,
			},
		},
	},
});
