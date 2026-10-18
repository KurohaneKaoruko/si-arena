export type PaperDirection = 'up' | 'right' | 'down' | 'left'
export type PaperAction = { type: 'move'; direction: PaperDirection } | { type: 'idle' }

export interface PaperPlayer {
  id: string
  slot: 0 | 1
  alive: boolean
  position: { x: number; y: number } | null
}

export interface PaperState {
  tick: number
  width: 40
  height: 30
  maxTicks: 600
  territory: number[]
  trails: number[]
  players: [PaperPlayer, PaperPlayer]
  rngState: number
}

export interface PaperObservation extends PaperState {
  selfId: string
  selfSlot: 0 | 1
}
