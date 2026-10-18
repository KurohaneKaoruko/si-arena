import { buildApp } from './app.js'
import { readServerConfig } from './config.js'

const config = readServerConfig()
const app = buildApp({ logger: { level: config.logLevel } })
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close()
  })
}
try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
