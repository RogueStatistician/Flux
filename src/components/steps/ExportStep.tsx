/**
 * Step 4: Export
 *
 * MVP Foundation: exports the transformed + validated rows to a Workday EIB
 * flat-sheet Excel file. Optionally includes a mapping documentation sheet.
 */
import { useState } from 'react'
import { useAppStore } from '../../store/index.js'
import { applyExportPolicy } from '../../engine/engine.js'
import { exportToEib, exportQualitySummary, getTargetFieldsFromProfile } from '../../export/eib.js'

function downloadBase64(base64: string, filename: string) {
  const byteChars = atob(base64)
  const byteNums = new Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) {
    byteNums[i] = byteChars.charCodeAt(i)
  }
  const byteArray = new Uint8Array(byteNums)
  const blob = new Blob([byteArray], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function ExportStep() {
  const result = useAppStore(s => s.result.transformResult)
  const profile = useAppStore(s => s.profileState.profile)
  const setCurrentStep = useAppStore(s => s.setCurrentStep)

  const [includeMappingDoc, setIncludeMappingDoc] = useState(false)
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle')
  const [exportMessage, setExportMessage] = useState('')

  if (!result || !profile) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-sm text-gray-500">No transformation result. Please run a transformation first.</p>
      </div>
    )
  }

  const policy = profile.settings.onValidationError
  const exportableRows = applyExportPolicy(result, policy)
  const targetFields = getTargetFieldsFromProfile(profile)

  const handleExport = () => {
    if (!exportableRows) {
      setExportStatus('error')
      setExportMessage('Export halted: rows with errors found and policy is set to "halt".')
      return
    }

    setExportStatus('exporting')
    try {
      // Main Workday file
      const eibResult = exportToEib({
        rows: exportableRows,
        profile,
        targetFields,
        includeMappingDoc,
      })
      downloadBase64(eibResult.base64, eibResult.suggestedFilename)

      // Quality summary
      const summaryResult = exportQualitySummary(result, profile)
      downloadBase64(summaryResult.base64, summaryResult.suggestedFilename)

      setExportStatus('done')
      setExportMessage(`Exported ${eibResult.rowsWritten.toLocaleString()} rows to ${eibResult.suggestedFilename}`)
    } catch (err) {
      setExportStatus('error')
      setExportMessage(err instanceof Error ? err.message : 'Export failed.')
    }
  }

  const readinessPercent = result.totalRows > 0
    ? Math.round((result.cleanRows / result.totalRows) * 100)
    : 0

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Export to Workday</h2>
        <p className="text-sm text-gray-500">
          Export the transformed data as a Workday-ready Excel file.
        </p>
      </div>

      {/* Export summary card */}
      <div className="bg-white border rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Export Summary</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs text-gray-500">Total rows processed</p>
            <p className="text-xl font-semibold text-gray-900">{result.totalRows.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Rows to be exported</p>
            <p className="text-xl font-semibold text-green-700">
              {exportableRows === null ? '0 (halted)' : exportableRows.length.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Rows with errors (excluded)</p>
            <p className={`text-xl font-semibold ${result.errorRows > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {result.errorRows.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Data readiness</p>
            <p className={`text-xl font-semibold ${readinessPercent >= 95 ? 'text-green-700' : readinessPercent >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
              {readinessPercent}%
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-100 rounded-full h-2 mb-4">
          <div
            className={`h-2 rounded-full transition-all ${
              readinessPercent >= 95 ? 'bg-green-500' : readinessPercent >= 80 ? 'bg-amber-400' : 'bg-red-400'
            }`}
            style={{ width: `${readinessPercent}%` }}
          />
        </div>

        {/* Options */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeMappingDoc}
            onChange={e => setIncludeMappingDoc(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm text-gray-700">Include Field Mapping Documentation sheet</span>
        </label>

        <div className="mt-2 text-xs text-gray-400">
          Validation error policy: <span className="font-mono text-gray-600">{policy}</span>
        </div>
      </div>

      {/* Output files info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <h3 className="text-sm font-semibold text-blue-800 mb-2">Files to be generated</h3>
        <ul className="space-y-1">
          <li className="text-sm text-blue-700">
            <span className="font-mono text-xs bg-blue-100 px-1.5 py-0.5 rounded">.xlsx</span>
            {' '}Workday EIB flat-sheet file (upload-ready)
          </li>
          <li className="text-sm text-blue-700">
            <span className="font-mono text-xs bg-blue-100 px-1.5 py-0.5 rounded">.xlsx</span>
            {' '}Data Quality Summary (statistics, error sample)
          </li>
          {includeMappingDoc && (
            <li className="text-sm text-blue-700">
              <span className="font-mono text-xs bg-blue-100 px-1.5 py-0.5 rounded">sheet</span>
              {' '}Field Mapping Documentation (included in EIB workbook)
            </li>
          )}
        </ul>
      </div>

      {/* Status message */}
      {exportStatus === 'done' && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700 font-medium">Export complete!</p>
          <p className="text-sm text-green-600 mt-0.5">{exportMessage}</p>
        </div>
      )}
      {exportStatus === 'error' && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700 font-medium">Export failed</p>
          <p className="text-sm text-red-600 mt-0.5">{exportMessage}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCurrentStep('preview')}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border rounded-lg hover:bg-gray-50 transition-colors"
        >
          ← Back to Preview
        </button>
        <button
          onClick={handleExport}
          disabled={exportStatus === 'exporting' || exportableRows === null || (exportableRows?.length ?? 0) === 0}
          className={[
            'px-6 py-2 text-sm font-medium rounded-lg transition-colors',
            exportStatus === 'done'
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed',
          ].join(' ')}
        >
          {exportStatus === 'exporting' ? 'Exporting…' : exportStatus === 'done' ? 'Export Again' : 'Export to Workday'}
        </button>
      </div>
    </div>
  )
}
