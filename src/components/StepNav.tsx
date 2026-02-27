import type { AppStep } from '../store/index.js'
import { useAppStore } from '../store/index.js'

const STEPS: { id: AppStep; label: string; description: string }[] = [
  { id: 'load-source',       label: '1. Load Source',      description: 'Import SF export file' },
  { id: 'configure-mapping', label: '2. Map Fields',       description: 'Configure transformation' },
  { id: 'preview',           label: '3. Preview',          description: 'Review & validate output' },
  { id: 'export',            label: '4. Export',           description: 'Save Workday file' },
]

const STEP_ORDER: AppStep[] = ['load-source', 'configure-mapping', 'preview', 'export']

interface StepNavProps {
  currentStep: AppStep
}

export function StepNav({ currentStep }: StepNavProps) {
  const source = useAppStore(s => s.source)
  const profileState = useAppStore(s => s.profileState)
  const result = useAppStore(s => s.result)
  const setCurrentStep = useAppStore(s => s.setCurrentStep)

  const currentIndex = STEP_ORDER.indexOf(currentStep)

  function canNavigateTo(stepId: AppStep): boolean {
    const targetIndex = STEP_ORDER.indexOf(stepId)
    // Can always go back.
    if (targetIndex <= currentIndex) return true
    // Can go forward only if prerequisites are met.
    if (stepId === 'configure-mapping') return !!source.parseResult
    if (stepId === 'preview') return !!source.parseResult && !!profileState.profile
    if (stepId === 'export') return !!result.transformResult
    return false
  }

  return (
    <nav className="bg-gray-50 border-b px-6 py-0">
      <ol className="flex">
        {STEPS.map((step, idx) => {
          const isCurrent = step.id === currentStep
          const isDone = STEP_ORDER.indexOf(step.id) < currentIndex
          const isClickable = canNavigateTo(step.id)

          return (
            <li key={step.id} className="flex items-center">
              <button
                onClick={() => isClickable && setCurrentStep(step.id)}
                disabled={!isClickable}
                className={[
                  'flex items-center gap-2 px-4 py-3 text-sm transition-colors',
                  isCurrent
                    ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                    : isDone
                    ? 'text-green-600 hover:text-green-700'
                    : isClickable
                    ? 'text-gray-600 hover:text-gray-800'
                    : 'text-gray-400 cursor-not-allowed',
                ].join(' ')}
              >
                <span className={[
                  'w-5 h-5 rounded-full text-xs font-semibold flex items-center justify-center',
                  isCurrent
                    ? 'bg-blue-600 text-white'
                    : isDone
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-300 text-gray-600',
                ].join(' ')}>
                  {isDone ? '✓' : idx + 1}
                </span>
                <span className="hidden sm:block">{step.label}</span>
              </button>
              {idx < STEPS.length - 1 && (
                <span className="text-gray-300 mx-1">›</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
