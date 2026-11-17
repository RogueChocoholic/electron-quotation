import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: qasset:; font-src 'self' data:"

/**
 * Adds the Content-Security-Policy to the built page. It is left out while developing,
 * because the dev server's hot-reload relies on an inline script the policy would block.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }
    ]
  }
}

export default defineConfig({
  main: { resolve: { alias } },
  preload: { resolve: { alias } },
  renderer: { resolve: { alias }, plugins: [react(), contentSecurityPolicy()] }
})
