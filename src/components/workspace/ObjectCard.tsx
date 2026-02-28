import type { DataObject } from '../../types/index.js'

interface Props {
  object: DataObject
  onClick: () => void
  onDelete: () => void
}

export function ObjectCard({ object, onClick, onDelete }: Props) {
  const isSource = object.role === 'source'

  return (
    <div
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group relative"
    >
      {/* Role badge */}
      <span className={[
        'absolute top-3 right-3 text-xs font-semibold px-2 py-0.5 rounded-full',
        isSource
          ? 'bg-blue-100 text-blue-700'
          : 'bg-emerald-100 text-emerald-700',
      ].join(' ')}>
        {isSource ? 'SOURCE' : 'TARGET'}
      </span>

      {/* Name */}
      <p className="text-sm font-semibold text-gray-800 pr-16 truncate group-hover:text-blue-700 transition-colors">
        {object.name}
      </p>

      {/* System name */}
      {object.systemName && (
        <p className="text-xs text-gray-400 mt-0.5 truncate">{object.systemName}</p>
      )}

      {/* Stats */}
      <div className="flex gap-4 mt-3">
        {isSource && object.rowCount !== undefined && (
          <Stat label="Rows" value={object.rowCount.toLocaleString()} />
        )}
        {object.fileName && (
          <Stat label="File" value={object.fileName} truncate />
        )}
      </div>

      {/* Delete button */}
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="absolute bottom-3 right-3 text-xs text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
        title="Delete object"
      >
        ✕
      </button>
    </div>
  )
}

function Stat({ label, value, truncate }: { label: string; value: string | number; truncate?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={['text-xs font-medium text-gray-700', truncate ? 'truncate max-w-[120px]' : ''].join(' ')}>
        {value}
      </p>
    </div>
  )
}
