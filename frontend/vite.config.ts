import { defineConfig } from 'vite';
import { chispaHtmlPlugin } from 'chispa/vite-plugin';

export default defineConfig({
	plugins: [chispaHtmlPlugin()],
});
