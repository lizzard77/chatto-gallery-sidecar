import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Dev: Vite auf :5173, alles Serverseitige geht an den Server mit PORT=8090 (siehe README)
const api = 'http://localhost:8090';
export default defineConfig({
  plugins: [svelte()],
  server: { proxy: Object.fromEntries(['/api', '/files', '/thumb', '/oauth', '/vendor'].map((p) => [p, api])) }
});
