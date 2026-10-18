import Fastify from 'fastify'
import { gameCatalog } from './games.js'

export function buildApp(options: { logger?: boolean | { level: string } } = {}) {
  const app = Fastify({ logger: options.logger ?? false })
  app.get('/health', async () => ({ status: 'ok', service: 'si-arena-server' }))
  app.get('/api/games', async () => ({ games: [...gameCatalog.values()] }))
  app.get<{ Params: { gameId: string } }>('/api/games/:gameId', async (request, reply) => {
    const game = gameCatalog.get(request.params.gameId)
    if (!game) return reply.code(404).send({ code: 'GAME_NOT_FOUND', message: '游戏不存在' })
    return game
  })
  return app
}
