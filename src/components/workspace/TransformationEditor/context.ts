import { createContext } from 'react'

export interface EditorContextValue {
  /** Called when user clicks on a MapOperatorNode to open the field-rule panel. */
  onMapNodeClick: (mapNodeId: string, targetObjectId: string) => void
  /** Called when user clicks on a JoinOperatorNode to open the join config panel. */
  onJoinNodeClick: (joinNodeId: string) => void
  /** Called when user clicks on a FilterOperatorNode to open the filter config panel. */
  onFilterNodeClick: (filterNodeId: string) => void
}

export const EditorContext = createContext<EditorContextValue | null>(null)
