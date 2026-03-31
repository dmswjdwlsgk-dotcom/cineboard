import { useState, useRef } from 'react'
import { ChevronRight, ChevronLeft, Check, Search, Zap, Star, Edit3, Upload, X } from 'lucide-react'
import Button from '../ui/Button.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import { STYLES, MODELS } from '../../data/styles.js'
import StylePreviewModal from '../StylePreviewModal.jsx'

const ASPECT_RATIOS = [
  { id: '16:9', label: '16:9 가로형', desc: '유튜브/영화/드라마' },
  { id: '9:16', label: '9:16 세로형', desc: '쇼츠/릴스/틱톡' },
]

const VISUAL_MODES = [
  { id: 'auto',       label: '🤖 오토',         desc: 'AI가 씬별 자동 판단' },
  { id: 'character',  label: '👤 캐릭터',        desc: '인물 중심 드라마틱 연출' },
  { id: 'content',    label: '📊 콘텐츠',        desc: '정보 전달 최적화' },
  { id: 'infoviz',    label: '📈 인포비즈',      desc: '인포그래픽/데이터 시각화' },
  { id: 'immersive',  label: '🌍 이머시브',      desc: '배경/환경 몰입형' },
  { id: 'docu',       label: '🎙️ 다큐',          desc: '다큐멘터리 스타일' },
  { id: 'webtoon',    label: '🎨 웹툰',          desc: '웹툰/만화 스타일' },
  { id: 'mv',         label: '🎵 뮤직비디오',    desc: 'MV/감성 영상 스타일' },
  { id: 'documix',    label: '📰 다큐믹스',       desc: '실사 다큐 + 정보 그래픽 혼합' },
]

const FIXED_CHAR_STYLES = [
  { id: 'countryball', label: '🌐 국가공',    desc: '공 모양 국기 캐릭터' },
  { id: 'stickman',    label: '🖊️ 막대인간',  desc: '심플 스틱맨' },
  { id: 'mascot',      label: '🐻 마스코트',  desc: '샘플 이미지로 고정' },
  { id: 'chibi',       label: '🌸 치비',      desc: 'SD/치비 애니 스타일' },
  { id: 'custom',      label: '🎨 커스텀',    desc: '샘플 이미지 스타일 추출' },
]

export default function Step2_Style() {
  const {
    selectedStyleId, setStyle,
    selectedModel, setModel,
    imageEngine, setImageEngine,
    aspectRatio, setAspectRatio,
    visualMode, setVisualMode,
    isFixedCharMode, setFixedCharMode,
    fixedCharStyleType, setFixedCharStyleType,
    fixedCharSampleImage, setFixedCharSampleImage,
    setStep, setError, clearError,
  } = useAppStore()

  const [previewStyle, setPreviewStyle] = useState(null)
  const sampleImgRef = useRef(null)

  const handleNext = () => {
    if (!selectedStyleId) {
      setError('스타일을 선택해주세요.')
      return
    }
    clearError()
    setStep(3)
  }

  const handleModelChange = (idx) => {
    setModel(idx)
    setImageEngine(MODELS[idx]?.id || MODELS[0].id)
  }

  const handleSampleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setFixedCharSampleImage(ev.target.result)
    reader.readAsDataURL(file)
  }

  const error = useAppStore(s => s.error)

  const needsSampleImage = fixedCharStyleType === 'mascot' || fixedCharStyleType === 'custom'

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

      {/* 비주얼 모드 */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">비주얼 모드</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {VISUAL_MODES.map(mode => (
            <button
              key={mode.id}
              onClick={() => setVisualMode(mode.id)}
              className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all
                ${visualMode === mode.id
                  ? 'bg-indigo-900/30 border-indigo-500'
                  : 'bg-gray-800/40 border-gray-700 hover:border-gray-600'
                }`}
            >
              <div className={`text-sm font-semibold ${visualMode === mode.id ? 'text-indigo-300' : 'text-gray-300'}`}>
                {mode.label}
              </div>
              <div className="text-xs text-gray-500 mt-0.5 leading-tight">{mode.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 캐릭터 고정 모드 */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">캐릭터 고정 모드</h2>
          <button
            onClick={() => setFixedCharMode(!isFixedCharMode)}
            className={`relative w-10 h-5 rounded-full transition-colors ${isFixedCharMode ? 'bg-purple-600' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isFixedCharMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {isFixedCharMode && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">모든 씬의 캐릭터를 특정 스타일로 고정합니다.</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {FIXED_CHAR_STYLES.map(style => (
                <button
                  key={style.id}
                  onClick={() => setFixedCharStyleType(style.id)}
                  className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all
                    ${fixedCharStyleType === style.id
                      ? 'bg-purple-900/30 border-purple-500'
                      : 'bg-gray-800/40 border-gray-700 hover:border-gray-600'
                    }`}
                >
                  <div className={`text-sm font-semibold ${fixedCharStyleType === style.id ? 'text-purple-300' : 'text-gray-300'}`}>
                    {style.label}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 leading-tight">{style.desc}</div>
                </button>
              ))}
            </div>

            {/* 샘플 이미지 업로드 (mascot/custom) */}
            {needsSampleImage && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-gray-400">
                  {fixedCharStyleType === 'mascot'
                    ? '마스코트 참조 이미지를 업로드하세요. 이 스타일로 모든 캐릭터를 고정합니다.'
                    : '스타일 참조 이미지를 업로드하세요. 이미지의 아트 스타일을 추출해 모든 씬에 적용합니다.'}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => sampleImgRef.current?.click()}
                    className="flex items-center gap-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded-lg transition-colors"
                  >
                    <Upload size={13} />
                    이미지 선택
                  </button>
                  {fixedCharSampleImage && (
                    <>
                      <img src={fixedCharSampleImage} alt="sample" className="w-12 h-12 object-cover rounded-lg border border-gray-600" />
                      <button onClick={() => setFixedCharSampleImage(null)} className="text-gray-500 hover:text-red-400">
                        <X size={14} />
                      </button>
                    </>
                  )}
                  <input
                    ref={sampleImgRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleSampleImageUpload}
                  />
                </div>
              </div>
            )}
          </div>
        )}
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

                <div className="w-full aspect-video rounded-lg overflow-hidden mb-3 bg-gray-800">
                  <img
                    src={style.thumbnail}
                    alt={style.label}
                    className="w-full h-full object-cover"
                  />
                </div>

                <div className={`text-sm font-semibold leading-tight ${isSelected ? 'text-purple-300' : 'text-gray-300'}`}>
                  {style.label}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Model selection */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">이미지 생성 모델</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                onChange={() => handleModelChange(i)}
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
            <img
              src={STYLES.find(s => s.id === selectedStyleId)?.thumbnail}
              alt=""
              className="w-16 h-10 object-cover rounded-lg flex-shrink-0"
            />
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
