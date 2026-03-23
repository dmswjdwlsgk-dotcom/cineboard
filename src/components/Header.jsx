import { useState } from 'react'
import { Key, Film, RotateCcw, Download } from 'lucide-react'
import { hasApiKey } from '../api/gemini.js'
import { useAppStore } from '../store/useAppStore.js'
import VrewExportModal from './VrewExportModal.jsx'

const STEP_LABELS = ['대본', '스타일', '캐릭터', '씬생성', '내보내기']

export default function Header({ onApiKeyClick }) {
  const currentStep = useAppStore(s => s.currentStep)
  const resetAll = useAppStore(s => s.resetAll)
  const scenes = useAppStore(s => s.scenes)
  const apiKeySet = hasApiKey()
  const [confirming, setConfirming] = useState(false)
  const [showVrewModal, setShowVrewModal] = useState(false)
  const hasImages = scenes.some(s => s.imageUrl)

  const handleReset = () => {
    if (!confirming) {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 3000)
      return
    }
    resetAll()
    setConfirming(false)
  }

  return (
    <header className="sticky top-0 z-40 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-purple-600 rounded-lg flex items-center justify-center">
            <Film size={16} className="text-white" />
          </div>
          <span className="font-bold text-lg text-gray-100 tracking-tight">도도진의 AI</span>
        </div>

        {/* Step indicator */}
        <div className="hidden md:flex items-center gap-1 text-xs text-gray-500">
          <span>Step {currentStep}/5</span>
          <span className="mx-1 text-gray-700">·</span>
          <span className="text-purple-400 font-medium">{STEP_LABELS[currentStep - 1]}</span>
        </div>

        <div className="flex items-center gap-2">
        {/* 새 프로젝트 버튼 */}
        <button
          onClick={handleReset}
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
            border transition-all duration-150
            ${confirming
              ? 'bg-red-900/50 border-red-600 text-red-300 hover:bg-red-900/70 animate-pulse'
              : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:bg-gray-700/60 hover:text-gray-200'
            }
          `}
          title="새 프로젝트 (모든 데이터 초기화)"
        >
          <RotateCcw size={14} />
          <span className="hidden sm:inline">
            {confirming ? '한 번 더 누르면 초기화' : '새 프로젝트'}
          </span>
        </button>

        {/* Vrew 내보내기 버튼 */}
        <button
          onClick={() => setShowVrewModal(true)}
          disabled={!hasImages}
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
            border transition-colors duration-150
            ${hasImages
              ? 'bg-blue-900/40 border-blue-800/60 text-blue-300 hover:bg-blue-900/60'
              : 'bg-gray-800/40 border-gray-700/60 text-gray-600 cursor-not-allowed'
            }
          `}
          title={hasImages ? 'Vrew 프로젝트로 내보내기' : '먼저 씬 이미지를 생성해주세요'}
        >
          <Download size={14} />
          <span className="hidden sm:inline">Vrew 내보내기</span>
        </button>

        {/* API Key button */}
        <button
          onClick={onApiKeyClick}
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
            border transition-colors duration-150
            ${apiKeySet
              ? 'bg-emerald-900/40 border-emerald-800/60 text-emerald-400 hover:bg-emerald-900/60'
              : 'bg-red-900/30 border-red-800/50 text-red-400 hover:bg-red-900/50'
            }
          `}
        >
          <Key size={14} />
          <span className="hidden sm:inline">
            {apiKeySet ? 'API Key ✓' : 'API Key 미설정'}
          </span>
        </button>
        </div>
      </div>
      <VrewExportModal isOpen={showVrewModal} onClose={() => setShowVrewModal(false)} />
    </header>
  )
}
