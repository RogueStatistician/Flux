import { useCallback } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react'

/**
 * Custom pipeline edge — renders the standard smoothstep arrow and, when the
 * edge is selected (clicked), shows a small ✕ button at the midpoint to delete it.
 */
export function PipelineEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
}: EdgeProps) {
  const { deleteElements } = useReactFlow()

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      deleteElements({ edges: [{ id }] })
    },
    [id, deleteElements],
  )

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {selected && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <button
              onClick={handleDelete}
              title="Delete connection"
              className="w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-400 hover:bg-red-50 hover:border-red-400 hover:text-red-500 flex items-center justify-center text-xs leading-none shadow transition-colors"
            >
              ✕
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
