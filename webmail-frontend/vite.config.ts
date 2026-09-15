import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Keep PDF fonts, character maps, and image decoders on this host. Their stable
// paths are used by PDF.js in production; development serves node_modules.
const pdfAssets = () => ({
  name: 'pdf-preview-assets',
  generateBundle(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: Buffer }) => void }) {
    const basePath = new URL('./node_modules/pdfjs-dist/', import.meta.url)
    const { version } = JSON.parse(readFileSync(new URL('package.json', basePath), 'utf8'))
    this.emitFile({ type: 'asset', fileName: `pdfjs/${version}/LICENSE`, source: readFileSync(new URL('LICENSE', basePath)) })
    for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
      const base = new URL(`./node_modules/pdfjs-dist/${directory}/`, import.meta.url)
      for (const filename of readdirSync(fileURLToPath(base))) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/${version}/${directory}/${filename}`,
          source: readFileSync(new URL(filename, base)) })
      }
    }
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pdfAssets()],
  build: {
    rolldownOptions: {
      output: {
        // Common Nginx MIME tables recognize .js but not .mjs. The PDF module
        // worker still uses module semantics; emit a JavaScript-served suffix.
        assetFileNames: asset => asset.names.some(name => name.endsWith('pdf.worker.min.mjs'))
          ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://127.0.0.1:20000',
      '/caldav': 'http://127.0.0.1:20000',
      '/Microsoft-Server-ActiveSync': 'http://127.0.0.1:20000',
      '/autodiscover': 'http://127.0.0.1:20000',
      '/.well-known': 'http://127.0.0.1:20000',
      '/uploads': 'http://127.0.0.1:20000',
    },
  }
})
