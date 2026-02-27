/**
 * Step 2: Configure Mapping
 *
 * MVP Foundation: JSON profile loader + basic field mapping display.
 * The full visual drag-and-drop editor is a v0.2 feature.
 */
import { useState } from 'react'
import { useAppStore } from '../../store/index.js'
import { ProfileSchema } from '../../engine/schema.js'
import { transform, applyExportPolicy } from '../../engine/engine.js'
import { getTargetFieldsFromProfile } from '../../export/eib.js'

function RuleBadge({ ruleType }: { ruleType: string }) {
  const colours: Record<string, string> = {
    direct:      'bg-blue-100 text-blue-700',
    constant:    'bg-purple-100 text-purple-700',
    lookup:      'bg-amber-100 text-amber-700',
    concat:      'bg-green-100 text-green-700',
    dateFormat:  'bg-orange-100 text-orange-700',
    split:       'bg-pink-100 text-pink-700',
    conditional: 'bg-teal-100 text-teal-700',
    regex:       'bg-red-100 text-red-700',
    expr:        'bg-gray-100 text-gray-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${colours[ruleType] ?? 'bg-gray-100 text-gray-600'}`}>
      {ruleType}
    </span>
  )
}

export function ConfigureMappingStep() {
  const source = useAppStore(s => s.source)
  const profileState = useAppStore(s => s.profileState)
  const setProfile = useAppStore(s => s.setProfile)
  const setProfileError = useAppStore(s => s.profileState.profileError)
  const setCurrentStep = useAppStore(s => s.setCurrentStep)
  const setTransformResult = useAppStore(s => s.setTransformResult)
  const setTransformError = useAppStore(s => s.setTransformError)
  const setIsTransforming = useAppStore(s => s.setIsTransforming)
  const setTransformProgress = useAppStore(s => s.setTransformProgress)
  const storeSetProfileError = useAppStore(s => s.setProfileError)

  const [jsonText, setJsonText] = useState('')
  const [isRunning, setIsRunning] = useState(false)

  const handleLoadJson = () => {
    storeSetProfileError(null)
    try {
      const raw = JSON.parse(jsonText)
      const parsed = ProfileSchema.parse(raw)
      setProfile(parsed, null)
    } catch (err) {
      storeSetProfileError(
        err instanceof Error ? err.message : 'Invalid profile JSON.'
      )
    }
  }

  const handleLoadBuiltIn = async () => {
    storeSetProfileError(null)
    try {
      // In a real Electron session we'd use window.electronAPI.getResourcePath.
      // For the MVP, we load from the bundled profile via fetch (dev mode only).
      const resp = await fetch('/profiles/sf-to-wd/ec-worker-to-eib-worker.json')
      if (!resp.ok) throw new Error('Could not load built-in starter profile.')
      const raw = await resp.json()
      const parsed = ProfileSchema.parse(raw)
      setProfile(parsed, null)
      setJsonText(JSON.stringify(raw, null, 2))
    } catch (err) {
      storeSetProfileError(
        err instanceof Error ? err.message : 'Failed to load built-in profile.'
      )
    }
  }

  const handleTransform = () => {
    if (!source.parseResult || !profileState.profile) return
    setIsTransforming(true)
    setTransformProgress(0)
    setIsRunning(true)

    try {
      const result = transform(
        source.parseResult.rows,
        profileState.profile,
        (progress) => setTransformProgress(progress.percentage),
      )
      setTransformResult(result)
      setCurrentStep('preview')
    } catch (err) {
      setTransformError(err instanceof Error ? err.message : 'Transformation failed.')
    } finally {
      setIsRunning(false)
      setIsTransforming(false)
    }
  }

  const profile = profileState.profile
  const profileError = profileState.profileError

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Configure Field Mapping</h2>
        <p className="text-sm text-gray-500">
          Load a JSON mapping profile or paste one directly. The starter profile for SF → WD covers ~25 standard fields.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile loader */}
        <div className="bg-white border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Load Profile</h3>

          <button
            onClick={handleLoadBuiltIn}
            className="w-full mb-3 px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 text-sm rounded-lg hover:bg-blue-100 transition-colors text-left"
          >
            <span className="font-medium">Use Starter Profile</span>
            <span className="block text-xs text-blue-500 mt-0.5">
              SF EC Worker → Workday EIB Worker (~25 pre-configured mappings)
            </span>
          </button>

          <div className="relative">
            <div className="absolute inset-x-0 -top-px flex justify-center">
              <span className="bg-white px-2 text-xs text-gray-400">or paste JSON</span>
            </div>
            <div className="border-t my-4" />
          </div>

          <textarea
            value={jsonText}
            onChange={e => setJsonText(e.target.value)}
            placeholder={'{\n  "profileId": "my-profile",\n  ...\n}'}
            className="w-full h-48 text-xs font-mono border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
          />

          <button
            onClick={handleLoadJson}
            disabled={!jsonText.trim()}
            className="mt-2 w-full px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Validate & Load Profile
          </button>

          {profileError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs text-red-700 font-medium">Profile Error</p>
              <p className="text-xs text-red-600 mt-1 font-mono whitespace-pre-wrap">{profileError}</p>
            </div>
          )}
        </div>

        {/* Profile summary / field mappings */}
        <div className="bg-white border rounded-xl p-5">
          {profile ? (
            <>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">Active Profile</h3>
                  <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded">
                    ✓ Valid
                  </span>
                </div>
                <p className="text-xs text-gray-500">{profile.description}</p>
                <div className="flex gap-4 mt-2 text-xs text-gray-500">
                  <span>Source: <span className="font-mono text-gray-700">{profile.source.system}/{profile.source.template}</span></span>
                </div>
                <div className="flex gap-4 mt-1 text-xs text-gray-500">
                  <span>Target: <span className="font-mono text-gray-700">{profile.target.system}/{profile.target.template}</span></span>
                </div>
              </div>

              <div className="border-t pt-3">
                <p className="text-xs font-medium text-gray-600 mb-2">
                  Field Mappings ({profile.fieldMappings.length})
                </p>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {profile.fieldMappings.map((fm, i) => (
                    <div key={i} className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50">
                      <span className="text-xs font-mono text-gray-700 truncate flex-1">
                        {fm.targetField}
                      </span>
                      <RuleBadge ruleType={fm.rule.type} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center py-8">
              <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                <span className="text-xl">🗺️</span>
              </div>
              <p className="text-sm text-gray-500">No profile loaded yet.</p>
              <p className="text-xs text-gray-400 mt-1">Load a starter profile or paste your JSON above.</p>
            </div>
          )}
        </div>
      </div>

      {/* Transform button */}
      {profile && source.parseResult && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Ready to transform <span className="font-medium">{source.parseResult.stats.rowCount.toLocaleString()} rows</span> using this profile.
          </p>
          <button
            onClick={handleTransform}
            disabled={isRunning}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRunning ? 'Transforming…' : 'Run Transformation →'}
          </button>
        </div>
      )}
    </div>
  )
}
