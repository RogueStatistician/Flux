import { useEffect } from 'react'

interface Props {
  x: number
  y: number
  onRename: () => void
  onDelete: () => void
  onClose: () => void
  showRename?: boolean
}

export function NodeContextMenu({ x, y, onRename, onDelete, onClose, showRename = true }: Props) {
  useEffect(() => {
    const handler = () => onClose()
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 9999,
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        overflow: 'hidden',
        minWidth: 130,
      }}
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
    >
      {showRename && (
        <>
          <MenuButton label="Rename" onClick={onRename} />
          <div style={{ height: 1, background: '#f3f4f6' }} />
        </>
      )}
      <MenuButton label="Delete" danger onClick={onDelete} />
    </div>
  )
}

function MenuButton({ label, danger = false, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', padding: '8px 14px',
        fontSize: 13, textAlign: 'left', background: 'none',
        border: 'none', cursor: 'pointer',
        color: danger ? '#ef4444' : '#374151',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? '#fef2f2' : '#f3f4f6' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
    >
      {label}
    </button>
  )
}
