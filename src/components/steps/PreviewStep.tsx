/**
 * Step 3: Preview & Validate
 *
 * MVP Foundation: shows transformation results in a table with colour-coded
 * rows (clean / warning / error). Summary statistics displayed above the table.
 */
import { useState } from 'react'
import { useAppStore } from '../../store/index.js'

type FilterMode = 'all' | 'errors' | 'warnings'

export function PreviewStep() {
  const result = useAppStore(s => s.result.transformResult)
  const profile = useAppStore(s => s.profileState.profile)
  const setCurrentStep = useAppStore(s => s.setCurrentStep)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [selectedRow, setSelectedRow] = useState<number | null>(null)

  if (!result || !profile) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-sm text-gray-500">No transformation result yet. Go back and run a transformation.</p>
      </div>
    )
  }

  const targetFields = profile.fieldMappings.map(fm => fm.targetField)

  const filteredRows = result.rows.filter(r => {
    if (filter === 'errors') return r.hasErrors
    if (filter === 'warnings') return !r.hasErrors && r.hasWarnings
    return true
  })

  const selectedRowResult = selectedRow !== null ? result.rows[selectedRow] : null

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Preview & Validate</h2>
        <p className="text-sm text-gray-500">
          Review the transformed output. Rows with errors will be excluded from export (skip policy).
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total',    value: result.totalRows,   colour: 'text-gray-900' },
          { label: 'Clean',    value: result.cleanRows,   colour: 'text-green-700'  },
          { label: 'Warnings', value: result.warningRows, colour: 'text-amber-600'  },
          { label: 'Errors',   value: result.errorRows,   colour: 'text-red-600'    },
        ].map(s => (
          <div key={s.label} className="bg-white border rounded-lg p-3">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-xl font-semibold ${s.colour}`}>{s.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-3">
        {(['all', 'errors', 'warnings'] as FilterMode[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={[
              'px-3 py-1 text-xs rounded-full font-medium transition-colors',
              filter === f
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            ].join(' ')}
          >
            {f === 'all' ? `All (${result.totalRows})` : f === 'errors' ? `Errors (${result.errorRows})` : `Warnings (${result.warningRows})`}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400">{filteredRows.length.toLocaleString()} rows shown</span>
      </div>

      <div className="flex gap-4">
        {/* Data grid */}
        <div className="flex-1 overflow-auto rounded-lg border border-gray-200" style={{ maxHeight: 420 }}>
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left text-gray-500 font-medium border-b w-10">#</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium border-b w-16">Status</th>
                {targetFields.map(f => (
                  <th key={f} className="px-3 py-2 text-left text-gray-700 font-medium border-b whitespace-nowrap">
                    {f}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice(0, 500).map((row) => {
                const rowBg = row.hasErrors
                  ? 'bg-red-50'
                  : row.hasWarnings
                  ? 'bg-amber-50'
                  : ''
                const isSelected = selectedRow === row.sourceIndex

                return (
                  <tr
                    key={row.sourceIndex}
                    onClick={() => setSelectedRow(isSelected ? null : row.sourceIndex)}
                    className={[
                      rowBg,
                      isSelected ? 'ring-2 ring-inset ring-blue-400' : '',
                      'cursor-pointer hover:brightness-95 transition-all',
                    ].join(' ')}
                  >
                    <td className="px-3 py-1 text-gray-400 border-b">{row.sourceIndex + 1}</td>
                    <td className="px-3 py-1 border-b">
                      {row.hasErrors ? (
                        <span className="text-red-600 font-medium">✗ Error</span>
                      ) : row.hasWarnings ? (
                        <span className="text-amber-600 font-medium">⚠ Warn</span>
                      ) : (
                        <span className="text-green-600">✓ OK</span>
                      )}
                    </td>
                    {targetFields.map(f => (
                      <td key={f} className="px-3 py-1 text-gray-700 border-b whitespace-nowrap max-w-40 overflow-hidden text-ellipsis">
                        {row.outputRow[f] || <span className="text-gray-300">—</span>}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredRows.length > 500 && (
            <p className="text-xs text-gray-400 text-center py-2">
              Showing first 500 of {filteredRows.length.toLocaleString()} rows.
            </p>
          )}
        </div>

        {/* Row detail panel */}
        {selectedRowResult && (
          <div className="w-80 shrink-0 bg-white border rounded-xl p-4 overflow-y-auto" style={{ maxHeight: 420 }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">
                Row {selectedRowResult.sourceIndex + 1} Detail
              </h3>
              <button onClick={() => setSelectedRow(null)} className="text-gray-400 hover:text-gray-600 text-xs">
                ✕
              </button>
            </div>

            {selectedRowResult.diagnostics.length === 0 ? (
              <p className="text-xs text-green-600">No issues — row is clean.</p>
            ) : (
              <div className="space-y-2">
                {selectedRowResult.diagnostics.map((d, i) => (
                  <div
                    key={i}
                    className={`p-2 rounded text-xs ${
                      d.severity === 'error'
                        ? 'bg-red-50 border border-red-200'
                        : d.severity === 'warn'
                        ? 'bg-amber-50 border border-amber-200'
                        : 'bg-gray-50 border border-gray-200'
                    }`}
                  >
                    <p className={`font-medium mb-0.5 ${
                      d.severity === 'error' ? 'text-red-700' : d.severity === 'warn' ? 'text-amber-700' : 'text-gray-700'
                    }`}>
                      {d.targetField}
                    </p>
                    <p className="text-gray-600">{d.message}</p>
                    {d.sourceValue && (
                      <p className="text-gray-400 font-mono mt-1">Source: "{d.sourceValue}"</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-6 flex justify-between">
        <button
          onClick={() => setCurrentStep('configure-mapping')}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border rounded-lg hover:bg-gray-50 transition-colors"
        >
          ← Back to Mapping
        </button>
        <button
          onClick={() => setCurrentStep('export')}
          className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          disabled={result.cleanRows === 0}
        >
          Next: Export →
        </button>
      </div>
    </div>
  )
}
