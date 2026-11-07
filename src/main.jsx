import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'

if ('serviceWorker' in navigator) {
  const buildId = document.querySelector('meta[name="app-build-id"]')?.content
  const workerUrl = buildId ? `/sw.js?build=${encodeURIComponent(buildId)}` : '/sw.js'
  window.addEventListener('load', () => navigator.serviceWorker.register(workerUrl).catch((error) => {
    console.error('Unable to register notification service worker:', error)
  }))
}
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: false,
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
