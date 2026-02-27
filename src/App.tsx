import { useAppStore } from './store/index.js'
import { StepNav } from './components/StepNav.js'
import { LoadSourceStep } from './components/steps/LoadSourceStep.js'
import { ConfigureMappingStep } from './components/steps/ConfigureMappingStep.js'
import { PreviewStep } from './components/steps/PreviewStep.js'
import { ExportStep } from './components/steps/ExportStep.js'

export default function App() {
  const currentStep = useAppStore(s => s.ui.currentStep)
  const globalError = useAppStore(s => s.ui.globalError)
  const setGlobalError = useAppStore(s => s.setGlobalError)

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-white px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">SF</span>
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">SF2WD</h1>
            <p className="text-xs text-gray-500">SuccessFactors → Workday Migration Tool</p>
          </div>
        </div>
        <span className="text-xs text-gray-400 font-mono">v0.1.0 — MVP Foundation</span>
      </header>

      {/* Step navigation */}
      <StepNav currentStep={currentStep} />

      {/* Global error banner */}
      {globalError && (
        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start justify-between">
          <p className="text-sm text-red-700">{globalError}</p>
          <button
            onClick={() => setGlobalError(null)}
            className="ml-3 text-red-400 hover:text-red-600 text-xs shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {currentStep === 'load-source' && <LoadSourceStep />}
        {currentStep === 'configure-mapping' && <ConfigureMappingStep />}
        {currentStep === 'preview' && <PreviewStep />}
        {currentStep === 'export' && <ExportStep />}
      </main>
    </div>
  )
}
