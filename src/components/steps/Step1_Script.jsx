import { useState, useCallback } from 'react'
import { Sparkles, Wand2, FileText, AlertTriangle, Star, ChevronRight, Loader2, Copy, Check, RefreshCw, Film } from 'lucide-react'
import Button from '../ui/Button.jsx'
import Spinner from '../ui/Spinner.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import { GENRES, TONES, VIEWPOINTS, SCRIPT_LENGTHS } from '../../data/genres.js'
import { suggestTopics, generateSynopsis, generateFullScript, factCheckScript, fixFactCheckScript } from '../../api/scriptApi.js'
import { detectLanguage } from '../../utils/languageDetect.js'
import { isApiReady } from '../../api/gemini.js'

const TABS = ['직접입력', 'AI 소재추천', 'AI 대본생성']

function ViralScore({ score }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={10}
          className={i < Math.round(score / 2) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-700 fill-gray-700'}
        />
      ))}
      <span className="text-xs text-gray-500 ml-1">{score}/10</span>
    </div>
  )
}

export default function Step1_Script() {
  const {
    scriptText, setScriptText,
    selectedGenre, setGenre,
    selectedSubGenre, setSubGenre,
    selectedTone, setTone,
    selectedViewpoint, setViewpoint,
    selectedLength, setLength,
    setDetectedLanguage,
    targetSceneCount, setTargetSceneCount,
    setStep, setError, clearError,
  } = useAppStore()

  const [activeTab, setActiveTab] = useState(0)
  const [activeGenreTab, setActiveGenreTab] = useState(0)

  // AI 소재 추천 상태
  const [topics, setTopics] = useState([])
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [selectedTopic, setSelectedTopic] = useState(null)
  const [synopses, setSynopses] = useState([])
  const [loadingSynopsis, setLoadingSynopsis] = useState(false)
  const [selectedSynopsis, setSelectedSynopsis] = useState(null)
  const [generatingScript, setGeneratingScript] = useState(false)

  // AI 대본생성 상태
  const [freePrompt, setFreePrompt] = useState('')
  const [generatingFreeScript, setGeneratingFreeScript] = useState(false)

  // 팩트체크 상태
  const [factChecking, setFactChecking] = useState(false)
  const [factResults, setFactResults]   = useState(null)
  const [fixingFact, setFixingFact]     = useState(false)

  const [copied, setCopied] = useState(false)

  const checkApiKey = () => {
    if (!isApiReady()) {
      setError('API 키가 설정되지 않았습니다. 우측 상단의 API Key 버튼을 클릭하여 설정해주세요.')
      return false
    }
    return true
  }

  const currentGenre = GENRES[activeGenreTab]
  const genreLabel = selectedGenre
    ? `${selectedGenre.label}${selectedSubGenre ? ' > ' + selectedSubGenre.label : ''}`
    : '장르 미선택'

  const handleSuggestTopics = async () => {
    if (!checkApiKey()) return
    if (!selectedGenre) { setError('먼저 장르를 선택해주세요.'); return }
    clearError()
    setLoadingTopics(true)
    setTopics([])
    setSelectedTopic(null)
    setSynopses([])
    try {
      const result = await suggestTopics(genreLabel)
      setTopics(Array.isArray(result) ? result : [])
    } catch (err) {
      setError('소재 추천 실패: ' + err.message)
    } finally {
      setLoadingTopics(false)
    }
  }

  const handleSelectTopic = async (topic) => {
    setSelectedTopic(topic)
    setSynopses([])
    setSelectedSynopsis(null)
    clearError()
    setLoadingSynopsis(true)
    try {
      const result = await generateSynopsis(genreLabel, topic)
      setSynopses(Array.isArray(result) ? result : [])
    } catch (err) {
      setError('시놉시스 생성 실패: ' + err.message)
    } finally {
      setLoadingSynopsis(false)
    }
  }

  const handleGenerateScriptFromSynopsis = async () => {
    if (!selectedSynopsis) return
    clearError()
    setGeneratingScript(true)
    const targetChars = selectedLength?.chars || 6000
    const prompt = `장르: ${genreLabel}
제목: ${selectedSynopsis.title}
접근 방식: ${selectedSynopsis.approach}
시놉시스: ${selectedSynopsis.synopsis}
주요 반전: ${(selectedSynopsis.keyTwists || []).join(', ')}
톤: ${selectedTone?.label || ''}
시점: ${selectedViewpoint?.label || ''}
분량: 약 ${targetChars}자`

    try {
      const script = await generateFullScript(prompt, targetChars)
      setScriptText(script)
      const lang = detectLanguage(script)
      setDetectedLanguage(lang)
    } catch (err) {
      setError('대본 생성 실패: ' + err.message)
    } finally {
      setGeneratingScript(false)
    }
  }

  const handleGenerateFreeScript = async () => {
    if (!freePrompt.trim()) return
    if (!checkApiKey()) return
    clearError()
    setGeneratingFreeScript(true)
    const targetChars = selectedLength?.chars || 6000
    const prompt = `장르: ${genreLabel}
요청: ${freePrompt}
톤: ${selectedTone?.label || '자연스럽게'}
시점: ${selectedViewpoint?.label || '전지적 작가 시점'}
분량: 약 ${targetChars}자`

    try {
      const script = await generateFullScript(prompt, targetChars)
      setScriptText(script)
      const lang = detectLanguage(script)
      setDetectedLanguage(lang)
      setActiveTab(0)
    } catch (err) {
      setError('대본 생성 실패: ' + err.message)
    } finally {
      setGeneratingFreeScript(false)
    }
  }

  const handleFactCheck = async () => {
    if (!scriptText.trim()) return
    if (!checkApiKey()) return
    clearError()
    setFactChecking(true)
    setFactResults(null)
    try {
      const results = await factCheckScript(scriptText)
      setFactResults(Array.isArray(results) ? results : [])
    } catch (err) {
      setError('팩트체크 실패: ' + err.message)
    } finally {
      setFactChecking(false)
    }
  }

  const handleFixFactCheck = async () => {
    if (!factResults || factResults.length === 0) return
    if (!checkApiKey()) return
    clearError()
    setFixingFact(true)
    try {
      const fixed = await fixFactCheckScript(scriptText, factResults)
      setScriptText(fixed)
      setFactResults(null)
    } catch (err) {
      setError('자동 수정 실패: ' + err.message)
    } finally {
      setFixingFact(false)
    }
  }

  const handleNext = () => {
    if (!scriptText.trim()) {
      setError('대본을 입력하거나 생성해주세요.')
      return
    }
    clearError()
    const lang = detectLanguage(scriptText)
    setDetectedLanguage(lang)
    setStep(2)
  }

  const handleCopyScript = () => {
    navigator.clipboard.writeText(scriptText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const error = useAppStore(s => s.error)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">대본 입력</h1>
        <p className="text-gray-500 text-sm mt-1">장르를 선택하고 대본을 입력하거나 AI로 생성하세요.</p>
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-start gap-3 bg-red-950/40 border border-red-800/50 rounded-lg p-4 text-sm text-red-300">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button onClick={clearError} className="text-red-500 hover:text-red-300 flex-shrink-0">✕</button>
        </div>
      )}

      {/* Genre selection */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">장르 선택</h2>

        {/* Category tabs */}
        <div className="flex gap-2 flex-wrap">
          {GENRES.map((g, i) => (
            <button
              key={g.id}
              onClick={() => setActiveGenreTab(i)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeGenreTab === i
                  ? 'bg-purple-700 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {g.emoji} {g.label}
            </button>
          ))}
        </div>

        {/* Sub-genre cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {currentGenre.subGenres.map(sub => {
            const isSelected = selectedSubGenre?.id === sub.id && selectedGenre?.id === currentGenre.id
            return (
              <button
                key={sub.id}
                onClick={() => {
                  setGenre(currentGenre)
                  setSubGenre(sub)
                }}
                className={`px-3 py-2 rounded-lg text-sm text-left transition-all ${
                  isSelected
                    ? 'bg-purple-700/60 border border-purple-500 text-purple-200'
                    : 'bg-gray-800/60 border border-gray-700/50 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                }`}
              >
                {sub.label}
              </button>
            )
          })}
        </div>

        {selectedGenre && (
          <div className="text-xs text-purple-400">
            선택됨: {genreLabel}
          </div>
        )}
      </div>

      {/* Tone / Viewpoint / Length */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">톤</label>
          <select
            value={selectedTone?.id || ''}
            onChange={e => setTone(TONES.find(t => t.id === e.target.value) || null)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">톤 선택...</option>
            {TONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">시점</label>
          <select
            value={selectedViewpoint?.id || ''}
            onChange={e => setViewpoint(VIEWPOINTS.find(v => v.id === e.target.value) || null)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">시점 선택...</option>
            {VIEWPOINTS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">분량</label>
          <select
            value={selectedLength?.id || ''}
            onChange={e => setLength(SCRIPT_LENGTHS.find(l => l.id === e.target.value) || null)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">분량 선택...</option>
            {SCRIPT_LENGTHS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
      </div>

      {/* Script tabs */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {/* Tab header */}
        <div className="flex border-b border-gray-800">
          {TABS.map((tab, i) => (
            <button
              key={i}
              onClick={() => setActiveTab(i)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === i
                  ? 'bg-purple-950/40 text-purple-300 border-b-2 border-purple-500'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/40'
              }`}
            >
              {i === 0 && <FileText size={14} className="inline mr-1.5" />}
              {i === 1 && <Sparkles size={14} className="inline mr-1.5" />}
              {i === 2 && <Wand2 size={14} className="inline mr-1.5" />}
              {tab}
            </button>
          ))}
        </div>

        <div className="p-5">
          {/* Tab 0: 직접입력 */}
          {activeTab === 0 && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">
                  {scriptText.length > 0 ? `${scriptText.length.toLocaleString()}자` : '대본을 입력하세요'}
                </span>
                {scriptText && (
                  <button
                    onClick={handleCopyScript}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300"
                  >
                    {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    {copied ? '복사됨' : '복사'}
                  </button>
                )}
              </div>
              <textarea
                value={scriptText}
                onChange={e => setScriptText(e.target.value)}
                placeholder="여기에 대본을 직접 입력하거나 붙여넣으세요.&#10;&#10;형식 예시:&#10;씬 1. INT. 아파트 거실 - 낮&#10;&#10;김민준(30대, 지친 표정)이 소파에 앉아 있다.&#10;&#10;김민준: (혼잣말로) 이렇게 살면 안 되는데..."
                className="w-full h-64 bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none font-mono leading-relaxed"
              />
            </div>
          )}

          {/* Tab 1: AI 소재추천 */}
          {activeTab === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSuggestTopics}
                  loading={loadingTopics}
                  disabled={loadingTopics}
                  variant="primary"
                >
                  <Sparkles size={15} />
                  소재 추천받기
                </Button>
                <span className="text-xs text-gray-600">장르: {genreLabel}</span>
              </div>

              {/* Topics */}
              {topics.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">소재를 클릭하면 시놉시스를 자동 생성합니다</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {topics.map((topic, i) => (
                      <button
                        key={i}
                        onClick={() => handleSelectTopic(topic)}
                        className={`text-left p-3 rounded-lg border transition-all ${
                          selectedTopic?.title === topic.title
                            ? 'bg-purple-900/40 border-purple-600'
                            : 'bg-gray-800/60 border-gray-700 hover:border-purple-700/60'
                        }`}
                      >
                        <div className="font-medium text-sm text-gray-200 mb-1">{topic.title}</div>
                        <div className="text-xs text-gray-500 mb-2 line-clamp-2">{topic.hook}</div>
                        <ViralScore score={topic.viralScore || 5} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Loading synopsis */}
              {loadingSynopsis && (
                <div className="flex items-center gap-3 text-sm text-gray-400 py-4">
                  <Spinner size="sm" />
                  시놉시스 생성 중...
                </div>
              )}

              {/* Synopses */}
              {synopses.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">시놉시스를 선택하세요</p>
                  {synopses.map((syn, i) => (
                    <div
                      key={i}
                      onClick={() => setSelectedSynopsis(syn)}
                      className={`p-4 rounded-lg border cursor-pointer transition-all ${
                        selectedSynopsis?.id === syn.id
                          ? 'bg-purple-900/40 border-purple-500'
                          : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-purple-400 text-xs font-bold flex-shrink-0 mt-0.5">#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-gray-200">{syn.title}</div>
                          <div className="text-xs text-purple-400 mt-0.5">{syn.approach}</div>
                          <div className="text-xs text-gray-400 mt-1.5 leading-relaxed">{syn.synopsis}</div>
                          {syn.keyTwists?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {syn.keyTwists.map((twist, j) => (
                                <span key={j} className="text-xs bg-gray-700/60 text-gray-400 px-2 py-0.5 rounded-full">
                                  {twist}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  <Button
                    onClick={handleGenerateScriptFromSynopsis}
                    loading={generatingScript}
                    disabled={!selectedSynopsis || generatingScript}
                    variant="primary"
                    size="lg"
                    className="w-full mt-2"
                  >
                    <Wand2 size={16} />
                    {generatingScript ? '대본 생성 중...' : '선택한 시놉시스로 대본 생성'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: AI 대본생성 */}
          {activeTab === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">원하는 내용을 자유롭게 입력하면 AI가 대본을 작성합니다.</p>
              <textarea
                value={freePrompt}
                onChange={e => setFreePrompt(e.target.value)}
                placeholder="예: 30대 직장인이 갑자기 10년 전으로 타임슬립되어 과거의 자신을 만나는 이야기. 현재의 후회를 과거에서 해결하려 하지만 예상치 못한 나비효과가 발생한다."
                className="w-full h-32 bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none leading-relaxed"
              />
              <Button
                onClick={handleGenerateFreeScript}
                loading={generatingFreeScript}
                disabled={!freePrompt.trim() || generatingFreeScript}
                variant="primary"
                size="lg"
                className="w-full"
              >
                <Wand2 size={16} />
                {generatingFreeScript ? '대본 생성 중... (잠시 기다려주세요)' : 'AI 대본 생성'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Script preview (if generated via AI tabs) */}
      {scriptText && activeTab !== 0 && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-400">생성된 대본 미리보기</span>
            <button
              onClick={() => setActiveTab(0)}
              className="text-xs text-purple-400 hover:text-purple-300"
            >
              전체 보기 / 편집
            </button>
          </div>
          <pre className="text-xs text-gray-400 font-mono leading-relaxed line-clamp-6 overflow-hidden">
            {scriptText.slice(0, 400)}{scriptText.length > 400 ? '...' : ''}
          </pre>
        </div>
      )}

      {/* Fact check */}
      {scriptText && (
        <div className="space-y-3">
          <Button
            onClick={handleFactCheck}
            loading={factChecking}
            variant="secondary"
            size="sm"
          >
            <AlertTriangle size={14} />
            {factChecking ? '팩트체크 중...' : '팩트체크'}
          </Button>

          {factResults !== null && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <AlertTriangle size={14} className="text-yellow-500" />
                팩트체크 결과 ({factResults.length}건)
              </h3>
              {factResults.length === 0 ? (
                <p className="text-sm text-emerald-400">특별한 오류가 발견되지 않았습니다.</p>
              ) : (
                <div className="space-y-2">
                  {factResults.map((item, i) => (
                    <div key={i} className="bg-gray-800/50 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 ${
                          item.verdict === 'TRUE'      ? 'bg-emerald-900/60 text-emerald-400' :
                          item.verdict === 'FALSE'     ? 'bg-red-900/60 text-red-400' :
                          item.verdict === 'UNCERTAIN' ? 'bg-yellow-900/60 text-yellow-400' :
                          item.verdict === '사실'      ? 'bg-emerald-900/60 text-emerald-400' :
                          item.verdict === '오류'      ? 'bg-red-900/60 text-red-400' :
                          item.verdict === '불확실'    ? 'bg-yellow-900/60 text-yellow-400' :
                          'bg-gray-700 text-gray-400'
                        }`}>
                          {item.verdict}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-300 font-medium">{item.claim}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{item.explanation}</div>
                          {item.source && (
                            <div className="text-xs text-gray-600 mt-0.5">출처: {item.source}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {factResults.some(r => r.verdict === 'FALSE' || r.verdict === 'UNCERTAIN' || r.verdict === '오류' || r.verdict === '불확실') && (
                    <Button
                      onClick={handleFixFactCheck}
                      loading={fixingFact}
                      variant="primary"
                      size="sm"
                      className="mt-2 w-full"
                    >
                      <Wand2 size={14} />
                      {fixingFact ? '대본 자동 수정 중...' : 'AI로 대본 자동 수정'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 씬 개수 설정 */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <Film size={14} className="text-purple-400" />
            생성할 씬 개수
          </label>
          <span className="text-sm font-mono text-purple-300">
            {targetSceneCount === null ? 'AI 자동' : `${targetSceneCount}개`}
          </span>
        </div>

        {/* AI 자동 토글 */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTargetSceneCount(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              targetSceneCount === null
                ? 'bg-purple-700 border-purple-600 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
            }`}
          >
            ✨ AI 자동
          </button>
          <span className="text-xs text-gray-600">또는 직접 설정:</span>
        </div>

        {/* 슬라이더 */}
        <div className="space-y-1">
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={targetSceneCount ?? 20}
            onChange={e => setTargetSceneCount(Number(e.target.value))}
            className="w-full accent-purple-500"
          />
          <div className="flex justify-between text-xs text-gray-600">
            <span>5개</span>
            <span>25개</span>
            <span>50개</span>
            <span>75개</span>
            <span>100개</span>
          </div>
        </div>

        <p className="text-xs text-gray-600">
          {targetSceneCount === null
            ? 'AI가 대본 길이에 맞게 씬 개수를 자동으로 결정합니다.'
            : `최대 ${targetSceneCount}개 씬으로 분할됩니다. 대본이 짧으면 실제 씬 수가 적을 수 있습니다.`
          }
        </p>
      </div>

      {/* Next button */}
      <div className="flex justify-end pt-2">
        <Button
          onClick={handleNext}
          size="lg"
          disabled={!scriptText.trim()}
        >
          다음 단계: 스타일 선택
          <ChevronRight size={18} />
        </Button>
      </div>
    </div>
  )
}
