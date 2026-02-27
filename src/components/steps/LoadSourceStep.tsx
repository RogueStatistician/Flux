/**
 * Step 1: Load Source File
 *
 * Allows the user to drag-and-drop or file-pick a SuccessFactors Excel/CSV export.
 * Parses the file and displays source statistics and a data preview.
 */
import { useRef, useState, useCallback } from 'react'
import { useAppStore } from '../../store/index.js'
import { parseFile } from '../../ingestion/parser.js'
import type { ParseResult } from '../../engine/types.js'

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv']
const ACCEPTED_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
]

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function SourceStats({ parseResult }: { parseResult: ParseResult }) {
  const { stats } = parseResult
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      {[
        { label: 'Total Rows',   value: formatNumber(stats.rowCount) },
        { label: 'Columns',      value: formatNumber(stats.columnCount) },
        { label: 'Sparse Cols',  value: formatNumber(stats.sparseColumns.length), warn: stats.sparseColumns.length > 0 },
        { label: 'Duplicate Rows', value: formatNumber(stats.duplicateCount), warn: stats.duplicateCount > 0 },
      ].map(stat => (
        <div key={stat.label} className="bg-white border rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
          <p className={`text-2xl font-semibold ${stat.warn ? 'text-amber-600' : 'text-gray-900'}`}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  )
}

function DataPreview({ parseResult }: { parseResult: ParseResult }) {
  const { rows, stats } = parseResult
  const PREVIEW_LIMIT = 50
  const preview = rows.slice(0, PREVIEW_LIMIT)

  if (stats.columns.length === 0) {
    return <p className="text-sm text-gray-500">No columns detected.</p>
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-2">
        Showing first {Math.min(PREVIEW_LIMIT, stats.rowCount)} of {formatNumber(stats.rowCount)} rows.
        Sheet: <span className="font-mono text-gray-700">{parseResult.sheetName}</span>
      </p>
      <div className="overflow-auto rounded-lg border border-gray-200" style={{ maxHeight: 320 }}>
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left text-gray-500 font-medium border-b w-12">#</th>
              {stats.columns.map(col => (
                <th
                  key={col}
                  className={`px-3 py-2 text-left font-medium border-b whitespace-nowrap ${
                    stats.sparseColumns.includes(col) ? 'text-amber-600' : 'text-gray-700'
                  }`}
                >
                  {col}
                  {stats.sparseColumns.includes(col) && (
                    <span className="ml-1 text-amber-400" title=">10% empty">⚠</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, idx) => (
              <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                <td className="px-3 py-1 text-gray-400 border-b">{idx + 1}</td>
                {stats.columns.map(col => (
                  <td key={col} className="px-3 py-1 text-gray-700 border-b whitespace-nowrap max-w-48 overflow-hidden text-ellipsis">
                    {row[col] || <span className="text-gray-300">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function LoadSourceStep() {
  const setSourceFile = useAppStore(s => s.setSourceFile)
  const setParseResult = useAppStore(s => s.setParseResult)
  const setParseError = useAppStore(s => s.setParseError)
  const setIsParsing = useAppStore(s => s.setIsParsing)
  const setCurrentStep = useAppStore(s => s.setCurrentStep)

  const source = useAppStore(s => s.source)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFile = useCallback(async (file: File) => {
    setSourceFile(null, file.name)
    setIsParsing(true)
    setParseError(null)

    try {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      // Convert to base64 for the parser
      let binary = ''
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binary)

      const result = parseFile(base64)
      setParseResult(result)
      setSourceFile(null, file.name)
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Failed to parse file. Please check the file format.'
      )
    }
  }, [setSourceFile, setIsParsing, setParseError, setParseResult])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Load Source File</h2>
        <p className="text-sm text-gray-500">
          Import your SAP SuccessFactors Employee Central export (.xlsx, .xls, or .csv).
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={[
          'border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors mb-6',
          isDragging
            ? 'border-blue-400 bg-blue-50'
            : source.parseResult
            ? 'border-green-300 bg-green-50'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100',
        ].join(' ')}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          onChange={handleInputChange}
          className="hidden"
        />

        {source.isParsing ? (
          <div>
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-600">Parsing file…</p>
          </div>
        ) : source.parseResult ? (
          <div>
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-green-600 text-lg">✓</span>
            </div>
            <p className="text-sm font-medium text-green-700">{source.fileName}</p>
            <p className="text-xs text-gray-500 mt-1">Click or drop to replace</p>
          </div>
        ) : (
          <div>
            <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">📄</span>
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">
              Drop your SuccessFactors export here
            </p>
            <p className="text-xs text-gray-500">
              or click to browse — .xlsx, .xls, .csv supported
            </p>
          </div>
        )}
      </div>

      {/* Parse error */}
      {source.parseError && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700 font-medium">Parse Error</p>
          <p className="text-sm text-red-600 mt-1">{source.parseError}</p>
        </div>
      )}

      {/* Stats and preview */}
      {source.parseResult && (
        <>
          <SourceStats parseResult={source.parseResult} />
          <DataPreview parseResult={source.parseResult} />

          {/* Next step */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => setCurrentStep('configure-mapping')}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Next: Configure Mapping →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
