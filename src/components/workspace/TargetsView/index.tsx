import { useState, useEffect, useCallback } from 'react'
import type { DataObject } from '../../../types/index.js'
import { ObjectCard } from '../ObjectCard.js'
import { ImportWizard } from '../ImportWizard.js'
import { ObjectDetailOverlay } from '../ObjectDetailOverlay.js'

type AddMode = 'upload' | 'manual'

export function TargetsView() {
  const [objects, setObjects] = useState<DataObject[]>([])
  const [loading, setLoading] = useState(true)
  const [wizardFilePath, setWizardFilePath] = useState<string | null>(null)
  const [showWizard, setShowWizard] = useState(false)
  const [selectedObject, setSelectedObject] = useState<DataObject | null>(null)

  const load = useCallback(() => {
    window.electronAPI.listObjects('target').then(setObjects).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const openWizard = async (mode: AddMode) => {
    if (mode === 'upload') {
      const result = await window.electronAPI.openFile({
        title: 'Select target template',
        filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths[0]) return
      setWizardFilePath(result.filePaths[0])
    } else {
      setWizardFilePath(null) // manual mode — no file
    }
    setShowWizard(true)
  }

  const handleWizardDone = (obj: DataObject) => {
    setShowWizard(false)
    setWizardFilePath(null)
    setObjects(prev => [...prev, obj])
  }

  const handleDelete = async (id: string) => {
    await window.electronAPI.deleteObject(id)
    setObjects(prev => prev.filter(o => o.id !== id))
    if (selectedObject?.id === id) setSelectedObject(null)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="px-6 py-4 border-b bg-white shrink-0 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Targets</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Target templates — schema that defines your output format
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => openWizard('upload')}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
          >
            ↓ Upload template
          </button>
          <button
            onClick={() => openWizard('manual')}
            className="px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            + Define manually
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-center text-gray-300 text-sm mt-20">Loading…</div>
        ) : objects.length === 0 ? (
          <EmptyState onUpload={() => openWizard('upload')} onManual={() => openWizard('manual')} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {objects.map(obj => (
              <ObjectCard
                key={obj.id}
                object={obj}
                onClick={() => setSelectedObject(obj)}
                onDelete={() => handleDelete(obj.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Wizard overlay */}
      {showWizard && (
        <ImportWizard
          role="target"
          filePath={wizardFilePath}
          onDone={handleWizardDone}
          onCancel={() => { setShowWizard(false); setWizardFilePath(null) }}
        />
      )}

      {/* Detail overlay */}
      {selectedObject && (
        <ObjectDetailOverlay
          object={selectedObject}
          onClose={() => setSelectedObject(null)}
          onObjectUpdated={updated => {
            setObjects(prev => prev.map(o => o.id === updated.id ? updated : o))
            setSelectedObject(updated)
          }}
        />
      )}
    </div>
  )
}

function EmptyState({ onUpload, onManual }: { onUpload: () => void; onManual: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-64 text-center">
      <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mb-4 text-2xl">↓</div>
      <p className="text-sm font-medium text-gray-500">No target objects yet</p>
      <p className="text-xs text-gray-400 mt-1 mb-4">Upload a template file or define the schema manually</p>
      <div className="flex gap-2">
        <button onClick={onUpload} className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors">
          Upload template
        </button>
        <button onClick={onManual} className="px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          Define manually
        </button>
      </div>
    </div>
  )
}
