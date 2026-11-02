import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

/** Окно «База» (desktop.html) в обычном браузере: мост секретаря поднимается при первом
 *  подключении страницы, сообщения — потоком /bridge/events, команды — POST /bridge/send.
 *  В настольной программе этот путь не нужен: мост держит само окно (src/desktop/bridge.ts). */
function bridgeDev(): Plugin {
  let proc: ChildProcessWithoutNullStreams | null = null
  let ready = false
  const clients = new Set<import('node:http').ServerResponse>()
  const broadcast = (line: string) => {
    for (const c of clients) c.write(`data: ${line}\n\n`)
  }
  const start = () => {
    if (proc) return
    proc = spawn('node', ['scripts/secretary.mjs', 'bridge'], { cwd: process.cwd() })
    createInterface({ input: proc.stdout }).on('line', (line) => {
      if (line.includes('"event":"ready"')) ready = true
      broadcast(line)
    })
    proc.on('exit', () => {
      proc = null
      ready = false
      broadcast(JSON.stringify({ event: 'down' }))
    })
  }
  return {
    name: 'bridge-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/bridge/events', (_req, res) => {
        start()
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        clients.add(res)
        if (ready) res.write(`data: ${JSON.stringify({ event: 'ready' })}\n\n`)
        res.on('close', () => clients.delete(res))
      })
      server.middlewares.use('/bridge/send', (req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          proc?.stdin.write(body.replace(/\n/g, ' ') + '\n')
          res.end('ok')
        })
      })
      server.httpServer?.on('close', () => proc?.stdin.end())
    },
  }
}

// https://vite.dev/config/
// base: './' — относительные пути к ресурсам, чтобы приложение работало
// и в корне домена, и в подпапке GitHub Pages (https://<user>.github.io/notedocal/).
export default defineConfig({
  base: './',
  plugins: [react(), bridgeDev()],
})
