import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const buildId = Date.now().toString(36)

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'app-build-id',
      transformIndexHtml(html) {
        return html.replace('</head>', `<meta name="app-build-id" content="${buildId}"></head>`)
      },
    },
  ],
  server: {
    allowedHosts: true,
  },
})
