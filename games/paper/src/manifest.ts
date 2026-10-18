import { resolveResourceLimits, type GameCatalogEntry, type GameManifest } from '@si-arena/protocol'

export const paperManifest = {
  id: 'paper',
  name: '网格圈地',
  description: '离开领地，拉出尾迹，安全回城。用更好的路线圈下地图，也用一次截击决定胜负。',
  release: 'paper@0.0.0',
  botProtocolVersion: 1,
  minPlayers: 2,
  maxPlayers: 2,
  maxTicks: 600,
  config: { width: 40, height: 30, initialTerritorySize: 3 },
} satisfies GameManifest

export const paperCatalogEntry: GameCatalogEntry = {
  ...paperManifest,
  resolvedLimits: resolveResourceLimits(),
}
