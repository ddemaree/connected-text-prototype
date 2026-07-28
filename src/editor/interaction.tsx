import { createContext, useContext } from 'react'
import type { NodeId } from '../model/types'

export interface InteractionApi {
  onNodePointerDown: (e: React.PointerEvent, id: NodeId) => void
}

export const InteractionContext = createContext<InteractionApi>({
  onNodePointerDown: () => {},
})

export function useInteraction() {
  return useContext(InteractionContext)
}

/** Small deterministic hash for mixing ids into generator seeds. */
export function hashId(id: string): number {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0
  return Math.abs(h) % 100000
}
