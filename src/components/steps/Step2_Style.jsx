import { useState } from 'react'
import { ChevronRight, ChevronLeft, Check, Search, Zap, Star, Edit3 } from 'lucide-react'
import Button from '../ui/Button.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import { STYLES, MODELS } from '../../data/styles.js'
import StylePreviewModal from '../StylePreviewModal.jsx'

const ASPECT_RATIOS = [
  { id: '16:9', label: '16:9 가로형', desc: '유튜브/영화/드라마' },
  { id: '9:16', label: '9:16 세로형', desc: '쇼츠/릴스/틱톡' },
]

const MODES = [
  { id: 'normal',    label: '일반 모드',        desc: 'AI 자동 씬 생성',         icon: Zap },
  { id: 'editorial', label: '에디토리얼 모드',   desc: '인포그래픽 콘텐츠 최적화', icon: Star },
  { id: 'precision', label: '정밀 편집 모드',    desc: '씬별 수동 조정 가능',      icon: Edit3 },
]

export default function Step2_Style() {
  const {
    selectedStyleId, setStyle,
    selectedModel, setModel,
    aspectRatio, setAspectRatio,
    currentMode, setCurrentMode,
    setStep, setError, clearError,
  } = useAppStore()

  const [previewStyle, setPreviewStyle] = useState(null)

  const handleNext = () => {
    if (!selectedStyleId) {
      setError('스타일을 선택해주세요.')
      return
    }
    clearError()
    setStep(3)
  }

  const error = useAppStore(s => s.error)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">스타일 선택</h1>
        <p className="text-gray-500 text-sm mt-1">스토리보드의 시각적 스타일을 선택하세요.</p>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800/50 rounded-lg p-3 text-sm text-red-300 flex justify-between">
          <span>{error}</span>
          <button onClick={clearError} className="text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* 생성 모드 선택 */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">생성 모드</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {MODES.map(mode => {
            const Icon = mode.icon
            return (
              <label
                key={mode.id}
                className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all
                  ${currentMode === mode.id
                    ? 'bg-indigo-900/30 border-indigo-500'
                    : 'bg-gray-800/40 border-gray-700 hover:border-gray-600'
                  }`}
              >
                <input
                  type="radio"
                  name="mode"
                  checked={currentMode === mode.id}
                  onChange={() => setCurrentMode(mode.id)}
                  className="mt-0.5 accent-indigo-500"
                />
                <div className="flex items-start gap-2">
                  <Icon size={14} className={currentMode === mode.id ? 'text-indigo-400 mt-0.5' : 'text-gray-500 mt-0.5'} />
                  <div>
                    <div className={`text-sm font-semibold ${currentMode === mode.id ? 'text-indigo-300' : 'text-gray-300'}`}>{mode.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{mode.desc}</div>
                  </div>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {/* Style grid */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">비주얼 스타일 ({STYLES.length}개)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {STYLES.map(style => {
            const isSelected = selectedStyleId === style.id
            return (
              <div
                key={style.id}
                onClick={() => setStyle(style.id)}
                className={`
                  relative group p-4 rounded-xl border text-left transition-all duration-150 cursor-pointer
                  ${isSelected
                    ? 'bg-purple-900/30 border-purple-500 ring-2 ring-purple-500/40'
                    : 'bg-gray-900 border-gray-800 hover:border-gray-600 hover:bg-gray-900/80'
                  }
                `}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2 w-5 h-5 bg-purple-600 rounded-full flex items-center justify-center">
                    <Check size={11} className="text-white" />
                  </div>
                )}

                {!isSelected && (
                  <button
                    onClick={e => { e.stopPropagation(); setPreviewStyle(style) }}
                    title="화풍 미리보기"
                    className="absolute top-2 right-2 w-6 h-6 bg-gray-700/80 hover:bg-purple-600 rounded-md flex items-center justify-center text-gray-400 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Search size={11} />
                  </button>
                )}

                <div className="text-xs text-gray-500 mb-1 font-mono">{style.id}</div>

                <div className={`text-sm font-semibold mb-2 leading-tight ${isSelected ? 'text-purple-300' : 'text-gray-300'}`}>
                  {style.label}
                </div>

                <div className="flex gap-1 mb-2">
                  {style.palette.map((color, i) => (
                    <div
                      key={i}
                      className="w-4 h-4 rounded-full border border-gray-700/60 flex-shrink-0"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>

                <div className="text-xs text-gray-600 line-clamp-2 leading-relaxed group-hover:text-gray-500 transition-colors">
                  {style.prompt.slice(0, 60)}...
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Model selection */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">이미지 생성 모델</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {MODELS.map((model, i) => (
            <label
              key={i}
              className={`
                flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all
                ${selectedModel === i
                  ? 'bg-purple-900/30 border-purple-600'
                  : 'bg-gray-800/40 border-gray-700 hover:border-gray-600'
                }
              `}
            >
              <input
                type="radio"
                name="model"
                checked={selectedModel === i}
                onChange={() => setModel(i)}
                className="mt-0.5 accent-purple-500"
              />
              <div>
                <div className={`text-sm font-semibold ${selectedModel === i ? 'text-purple-300' : 'text-gray-300'}`}>
                  {model.label}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{model.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Aspect ratio */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">화면 비율</h2>
        <div className="grid grid-cols-2 gap-3">
          {ASPECT_RATIOS.map(ratio => (
            <label
              key={ratio.id}
              className={`
                flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all
                ${aspectRatio === ratio.id
                  ? 'bg-purple-900/30 border-purple-600'
                  : 'bg-gray-800/40 border-gray-700 hover:border-gray-600'
                }
              `}
            >
              <input
                type="radio"
                name="ratio"
                checked={aspectRatio === ratio.id}
                onChange={() => setAspectRatio(ratio.id)}
                className="accent-purple-500"
              />
              <div>
                <div className={`text-sm font-semibold ${aspectRatio === ratio.id ? 'text-purple-300' : 'text-gray-300'}`}>
                  {ratio.label}
                </div>
                <div className="text-xs text-gray-500">{ratio.desc}</div>
              </div>
              {/* Ratio visual */}
              <div className="ml-auto">
                {ratio.id === '16:9' ? (
                  <div className="w-10 h-6 border-2 border-gray-600 rounded" />
                ) : (
                  <div className="w-5 h-9 border-2 border-gray-600 rounded" />
                )}
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Selected preview */}
      {selectedStyleId && (
        <div className="bg-gray-900/50 border border-purple-900/40 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">선택된 스타일</p>
          <div className="flex items-start gap-3">
            <span className="text-2xl">{STYLES.find(s => s.id === selectedStyleId)?.thumbnail}</span>
            <div>
              <p className="text-sm font-semibold text-purple-300">
                {STYLES.find(s => s.id === selectedStyleId)?.label}
              </p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                {STYLES.find(s => s.id === selectedStyleId)?.prompt.slice(0, 100)}...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={() => setStep(1)}>
          <ChevronLeft size={16} />
          이전: 대본
        </Button>
        <Button onClick={handleNext} size="lg" disabled={!selectedStyleId}>
          다음: 캐릭터 분석
          <ChevronRight size={18} />
        </Button>
      </div>

      {/* Style preview modal */}
      {previewStyle && (
        <StylePreviewModal
          style={previewStyle}
          onClose={() => setPreviewStyle(null)}
          onSelect={id => { setStyle(id); setPreviewStyle(null) }}
        />
      )}
    </div>
  )
}
