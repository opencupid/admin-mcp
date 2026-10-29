import { loadConfig } from './config.js'
import { createApp } from './server.js'

const config = loadConfig()
const app = createApp(config)

const httpServer = app.listen(config.PORT, config.HOST, () => {
  console.log(`opencupid admin MCP listening on http://${config.HOST}:${config.PORT}/mcp`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => httpServer.close(() => process.exit(0)))
}
