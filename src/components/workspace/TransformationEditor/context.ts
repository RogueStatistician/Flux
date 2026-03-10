import { createContext } from 'react'

export interface EditorContextValue {
  /** Called when user clicks on a MapOperatorNode to open the field-rule panel. */
  onMapNodeClick: (mapNodeId: string, targetObjectId: string) => void
  /** Called when user clicks on a JoinOperatorNode to open the join config panel. */
  onJoinNodeClick: (joinNodeId: string) => void
  /** Called when user clicks on a FilterOperatorNode to open the filter config panel. */
  onFilterNodeClick: (filterNodeId: string) => void
  /** Called when user clicks on a DeduplicateOperatorNode to open the dedup config panel. */
  onDedupNodeClick: (dedupNodeId: string) => void
  /** Called when user clicks the "+" button on an AppendOperatorNode to add an input slot. */
  onAppendAddInput: (appendNodeId: string) => void
  /** Called when a user commits a new label for any operator node. */
  onNodeRename: (nodeId: string, label: string) => void
}

export const EditorContext = createContext<EditorContextValue | null>(null)
