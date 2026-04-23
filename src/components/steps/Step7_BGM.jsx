import { useState } from 'react'
import { ChevronLeft, ChevronRight, Music, Loader2, Copy, Check } from 'lucide-react'
import Button from '../ui/Button.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import { generateGlobalBGM, generateMultiTrackBGM } from '../../api/bgmApi.js'
import { isApiReady } from '../../api/gemini.js'

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
    >
      {copied ? <><Check size={11} className="text-emerald-400" /><span className="text-emerald-400">복사됨</span></> : <><Copy size={11} />복사</>}
    </button>
  )
}

export default function Step7_BGM() {
  const {
    scriptText, continuityBible, scenes, detectedLanguage,
    bgmData, setBGM,
    multiTrackBGM, setMultiTrackBGM,
    setStep, setError, clearError,
  } = useAppStore()

  const error = useAppStore(s => s.error)

  const [loadingGlobal, setLoadingGlobal]     = useState(false)
  const [loadingMulti, setLoadingMulti]       = useState(false)
  const [activeTab, setActiveTab]             = useState('global')

  const handleGenGlobal = async () => {
    if (!isApiReady()) { setError('API 키를 먼저 설정하세요.'); return }
    setLoadingGlobal(true)
    clearError()
    try {
      const bgm = await generateGlobalBGM(scriptText, continuityBible, detectedLanguage)
      setBGM(bgm)
    } catch (e) {
      setError(`BGM 생성 실패: ${e.message}`)
    } finally {
      setLoadingGlobal(false)
    }
  }

  const handleGenMulti = async () => {
    if (!isApiReady()) { setError('API 키를 먼저 설정하세요.'); return }
    setLoadingMulti(true)
    clearError()
    try {
      const tracks = await generateMultiTrackBGM(scriptText, continuityBible, scenes, detectedLanguage)
      setMultiTrackBGM(tracks)
    } catch (e) {
      setError(`멀티트랙 BGM 생성 실패: ${e.message}`)
    } finally {
      setLoadingMulti(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
          <Music size={22} className="text-green-400" />
          BGM 큐시트
        </h1>
        <p className="text-gray-500 text-sm mt-1">대본 감정선 분석을 통한 AI 음악 생성 프롬프트를 만듭니다. (Suno AI 호환)</p>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800/50 rounded-lg p-3 text-sm text-red-300 flex justify-between">
          <span>{error}</span>
          <button onClick={clearError} className="text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-2 border-b border-gray-800">
        {[
          { id: 'global', label: '글로벌 테마 BGM' },
          { id: 'multi',  label: `멀티트랙 큐시트 (씬 ${scenes.length}개)` },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-green-500 text-green-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 글로벌 테마 BGM */}
      {activeTab === 'global' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">대본 전체 감정선을 분석하여 시그니처 BGM을 생성합니다.</p>
            <Button onClick={handleGenGlobal} disabled={loadingGlobal || !scriptText} size="sm">
              {loadingGlobal ? <Loader2 size={14} className="animate-spin" /> : <Music size={14} />}
              {bgmData ? 'BGM 재생성' : 'BGM 생성'}
            </Button>
          </div>

          {bgmData && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-green-300">{bgmData.titleKo}</h3>
                  <p className="text-sm text-gray-500 italic">{bgmData.titleEn}</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">한국어 음악 해설</h4>
                    <CopyButton text={bgmData.promptKo} />
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">{bgmData.promptKo}</p>
                </div>

                <div className="bg-gray-800/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Suno AI 프롬프트 (영어)</h4>
                    <CopyButton text={bgmData.promptEn} />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-green-300 font-mono leading-relaxed">{bgmData.promptEn}</p>
                    <span className={`text-xs ml-3 flex-shrink-0 ${bgmData.promptEn?.length > 900 ? 'text-red-400' : 'text-gray-500'}`}>
                      {bgmData.promptEn?.length || 0}/900자
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 멀티트랙 큐시트 */}
      {activeTab === 'multi' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">씬별 감정 분석을 통해 다중 트랙 BGM 큐시트를 생성합니다.</p>
            <Button onClick={handleGenMulti} disabled={loadingMulti || scenes.length === 0} size="sm">
              {loadingMulti ? <Loader2 size={14} className="animate-spin" /> : <Music size={14} />}
              {multiTrackBGM ? '멀티트랙 재생성' : '멀티트랙 생성'}
            </Button>
          </div>

          {Array.isArray(multiTrackBGM) && multiTrackBGM.length > 0 && (
            <div className="space-y-3">
              {multiTrackBGM.map((track, i) => (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        track.trackNumber === 0 ? 'bg-yellow-600/30 text-yellow-400 border border-yellow-600/50' : 'bg-green-900/30 text-green-400 border border-green-700/50'
                      }`}>
                        {track.trackNumber === 0 ? 'TITLE' : `TRACK ${track.trackNumber}`}
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-green-300">{track.titleKo}</h3>
                        <p className="text-xs text-gray-500">{track.titleEn}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>씬: {track.sceneRange}</span>
                      <span>감정: {track.emotionTag}</span>
                      <span>강도: {track.avgIntensity?.toFixed(1)}/10</span>
                      <span>{track.estimatedDuration}</span>
                    </div>
                  </div>

                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-500">한국어 해설</span>
                      <CopyButton text={track.promptKo} />
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">{track.promptKo}</p>
                  </div>

                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-500">Suno AI 프롬프트</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${track.promptEn?.length > 900 ? 'text-red-400' : 'text-gray-600'}`}>
                          {track.promptEn?.length || 0}/900
                        </span>
                        <CopyButton text={track.promptEn} />
                      </div>
                    </div>
                    <p className="text-xs text-green-300 font-mono leading-relaxed">{track.promptEn}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={() => setStep(6)}>
          <ChevronLeft size={16} /> 이전: 인트로
        </Button>
        <Button onClick={() => setStep(8)}>
          다음: SEO & 썸네일 <ChevronRight size={18} />
        </Button>
      </div>
    </div>
  )
}
