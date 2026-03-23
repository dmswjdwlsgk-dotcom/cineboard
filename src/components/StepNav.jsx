import { Check } from 'lucide-react'
import { useAppStore } from '../store/useAppStore.js'

const STEPS = [
  { num: 1, label: '대본', sublabel: '장르 & 스크립트' },
  { num: 2, label: '스타일', sublabel: '비주얼 프리셋' },
  { num: 3, label: '캐릭터', sublabel: '연속성 바이블' },
  { num: 4, label: '씬 생성', sublabel: '스토리보드' },
  { num: 5, label: '쇼츠', sublabel: '9:16 변환' },
  { num: 6, label: '인트로', sublabel: '후킹 시퀀스' },
  { num: 7, label: 'BGM', sublabel: '큐시트' },
  { num: 8, label: 'SEO', sublabel: '유튜브 최적화' },
]

export default function StepNav() {
  const currentStep = useAppStore(s => s.currentStep)
  const setStep = useAppStore(s => s.setStep)

  // 완료 여부 판단
  const scriptText = useAppStore(s => s.scriptText)
  const selectedStyleId = useAppStore(s => s.selectedStyleId)
  const continuityBible = useAppStore(s => s.continuityBible)
  const scenes = useAppStore(s => s.scenes)

  const isCompleted = (stepNum) => {
    if (stepNum < currentStep) return true
    if (stepNum === 1 && scriptText) return true
    if (stepNum === 2 && selectedStyleId) return true
    if (stepNum === 3 && continuityBible) return true
    if (stepNum === 4 && scenes.length > 0) return true
    return false
  }

  const canNavigate = (stepNum) => {
    if (stepNum <= currentStep) return true
    if (stepNum === 2 && scriptText) return true
    if (stepNum === 3 && selectedStyleId) return true
    if (stepNum === 4 && continuityBible) return true
    if (stepNum >= 5 && scenes.length > 0) return true
    return false
  }

  return (
    <nav className="bg-gray-950 border-b border-gray-800/60">
      <div className="max-w-7xl mx-auto px-4">
        <ol className="flex items-stretch">
          {STEPS.map((step, idx) => {
            const isCurrent = step.num === currentStep
            const completed = isCompleted(step.num) && !isCurrent
            const clickable = canNavigate(step.num)

            return (
              <li
                key={step.num}
                className={`
                  flex-1 relative flex
                  ${idx < STEPS.length - 1 ? 'after:absolute after:right-0 after:top-1/2 after:-translate-y-1/2 after:w-px after:h-6 after:bg-gray-800' : ''}
                `}
              >
                <button
                  onClick={() => clickable && setStep(step.num)}
                  disabled={!clickable}
                  className={`
                    w-full flex items-center gap-2.5 px-3 py-3
                    text-left transition-colors duration-150
                    disabled:cursor-not-allowed
                    ${isCurrent ? 'bg-purple-950/30' : ''}
                    ${clickable && !isCurrent ? 'hover:bg-gray-900/50 cursor-pointer' : ''}
                  `}
                >
                  {/* Step number / check */}
                  <div
                    className={`
                      w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold
                      ${isCurrent ? 'bg-purple-600 text-white' : ''}
                      ${completed ? 'bg-emerald-700 text-white' : ''}
                      ${!isCurrent && !completed ? 'bg-gray-800 text-gray-500' : ''}
                    `}
                  >
                    {completed ? <Check size={12} /> : step.num}
                  </div>
                  {/* Labels */}
                  <div className="hidden sm:block min-w-0">
                    <div
                      className={`text-xs font-semibold truncate ${
                        isCurrent ? 'text-purple-300' : completed ? 'text-emerald-400' : 'text-gray-500'
                      }`}
                    >
                      {step.label}
                    </div>
                    <div className="text-xs text-gray-600 truncate hidden lg:block">
                      {step.sublabel}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </nav>
  )
}
