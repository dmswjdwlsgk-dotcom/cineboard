import { useState } from 'react'
import { ChevronLeft, ChevronRight, Film, Loader2, Image as ImageIcon } from 'lucide-react'
import Button from '../ui/Button.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import { STYLES, MODELS } from '../../data/styles.js'
import { generateIntroExpansion } from '../../api/introApi.js'
import { generateSceneImage } from '../../api/imageApi.js'
import { hasApiKey } from '../../api/gemini.js'

export default function Step6_Intro() {
  const {
    scenes, continuityBible,
    selectedStyleId, selectedModel, aspectRatio,
    introClips, setIntroClips, addIntroClips,
    detectedLanguage,
    setStep, setError, clearError,
  } = useAppStore()

  const error   = useAppStore(s => s.error)
  const style   = STYLES.find(s => s.id === selectedStyleId) || STYLES[0]
  const modelId = MODELS[selectedModel]?.id || MODELS[0].id

  const [loadingSceneId, setLoadingSceneId] = useState(null)
  const [loadingAll, setLoadingAll]         = useState(false)
  const [clipCount, setClipCount]           = useState(4)
  const [loadingImageId, setLoadingImageId] = useState(null)

  const handleGenScene = async (scene, batchIdx) => {
    if (!hasApiKey()) { setError('API 키를 먼저 설정하세요.'); return }
    setLoadingSceneId(scene.id)
    clearError()
    try {
      const clips = await generateIntroExpansion(scene, continuityBible, style, detectedLanguage, clipCount, batchIdx)
      setIntroClips([...introClips.filter(c => c.sourceSceneId !== scene.id), ...clips])
    } catch (e) {
      setError(`인트로 확장 실패: ${e.message}`)
    } finally {
      setLoadingSceneId(null)
    }
  }

  const handleGenAll = async () => {
    if (!hasApiKey()) { setError('API 키를 먼저 설정하세요.'); return }
    setLoadingAll(true)
    clearError()
    try {
      const allClips = []
      for (let i = 0; i < scenes.length; i++) {
        const clips = await generateIntroExpansion(scenes[i], continuityBible, style, detectedLanguage, clipCount, i + 1)
        allClips.push(...clips)
      }
      setIntroClips(allClips)
    } catch (e) {
      setError(`전체 인트로 생성 실패: ${e.message}`)
    } finally {
      setLoadingAll(false)
    }
  }

  const handleGenImage = async (clip) => {
    if (!hasApiKey()) { setError('API 키를 먼저 설정하세요.'); return }
    setLoadingImageId(clip.id)
    // 클립에 로딩 상태 표시
    setIntroClips(useAppStore.getState().introClips.map(c =>
      c.id === clip.id ? { ...c, imageError: null } : c
    ))
    try {
      const url = await generateSceneImage(clip, continuityBible, style, modelId, aspectRatio, false)
      // getState()로 최신 상태 읽어서 stale 클로저 방지
      setIntroClips(useAppStore.getState().introClips.map(c =>
        c.id === clip.id ? { ...c, imageUrl: url, imageError: null } : c
      ))
    } catch (e) {
      setIntroClips(useAppStore.getState().introClips.map(c =>
        c.id === clip.id ? { ...c, imageError: e.message } : c
      ))
    } finally {
      setLoadingImageId(null)
    }
  }

  const sceneClipsMap = {}
  introClips.forEach(c => {
    if (!sceneClipsMap[c.sourceSceneId]) sceneClipsMap[c.sourceSceneId] = []
    sceneClipsMap[c.sourceSceneId].push(c)
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <Film size={22} className="text-orange-400" />
            인트로 시퀀스
          </h1>
          <p className="text-gray-500 text-sm mt-1">씬을 후킹·텐션·클리프행어 구조의 인트로 클립으로 확장합니다.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">클립 수</label>
            <select
              value={clipCount}
              onChange={e => setClipCount(Number(e.target.value))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-gray-300"
            >
              {[2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}개</option>)}
            </select>
          </div>
          <Button
            onClick={handleGenAll}
            disabled={loadingAll || scenes.length === 0}
            size="sm"
          >
            {loadingAll ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
            전체 씬 인트로 생성
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800/50 rounded-lg p-3 text-sm text-red-300 flex justify-between">
          <span>{error}</span>
          <button onClick={clearError} className="text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {scenes.length === 0 && (
        <div className="text-center py-12 text-gray-500">씬 시퀀스가 없습니다. 먼저 Step 4에서 씬을 생성하세요.</div>
      )}

      <div className="space-y-8">
        {scenes.map((scene, i) => {
          const sceneClips = sceneClipsMap[scene.id] || []
          const isLoading  = loadingSceneId === scene.id

          return (
            <div key={scene.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-gray-800">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 font-mono bg-gray-800 px-2 py-0.5 rounded">S{String(i + 1).padStart(2,'0')}</span>
                  <p className="text-sm text-gray-300 line-clamp-1">{scene.action}</p>
                </div>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => handleGenScene(scene, i + 1)}
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
                  {sceneClips.length > 0 ? '재생성' : '인트로 생성'}
                </Button>
              </div>

              {sceneClips.length > 0 && (
                <div className="p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                    {sceneClips.map((clip, ci) => (
                      <div key={clip.id} className="space-y-2">
                        <div className="relative bg-gray-800 rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                          {clip.imageUrl ? (
                            <img src={clip.imageUrl} alt="" className="w-full h-full object-cover" />
                          ) : clip.imageError ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2">
                              <span className="text-red-400 text-[9px] text-center line-clamp-2">{clip.imageError}</span>
                              <button
                                onClick={() => handleGenImage(clip)}
                                className="text-[9px] text-red-300 bg-red-900/40 border border-red-800 px-2 py-0.5 rounded hover:bg-red-900/60"
                              >재시도</button>
                            </div>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <button
                                onClick={() => handleGenImage(clip)}
                                disabled={loadingImageId === clip.id}
                                className="text-gray-500 hover:text-orange-400 transition-colors"
                              >
                                {loadingImageId === clip.id ? (
                                  <Loader2 size={16} className="animate-spin text-orange-400" />
                                ) : (
                                  <ImageIcon size={16} />
                                )}
                              </button>
                            </div>
                          )}
                          <div className="absolute top-1 left-1 bg-black/60 rounded px-1 text-[9px] text-gray-300 font-bold">#{ci + 1}</div>
                          {clip.hookType && (
                            <div className="absolute bottom-1 left-1 bg-orange-600/80 rounded px-1 text-[8px] text-white font-bold uppercase">
                              {clip.hookType}
                            </div>
                          )}
                        </div>
                        <div className="text-xs">
                          <p className="text-gray-400 line-clamp-2">{clip.action}</p>
                          {clip.dialogue && (
                            <p className="text-gray-600 mt-1 italic line-clamp-1">"{clip.dialogue}"</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={() => setStep(5)}>
          <ChevronLeft size={16} /> 이전: 쇼츠
        </Button>
        <Button onClick={() => setStep(7)}>
          다음: BGM 큐시트 <ChevronRight size={18} />
        </Button>
      </div>
    </div>
  )
}
