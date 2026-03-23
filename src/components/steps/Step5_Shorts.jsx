import { useState } from 'react'
import { ChevronLeft, ChevronRight, Smartphone, Loader2, RefreshCw, Download, Image as ImageIcon } from 'lucide-react'
import Button from '../ui/Button.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import { STYLES, MODELS } from '../../data/styles.js'
import { generateShortsFromScene } from '../../api/shortsApi.js'
import { generateSceneImage } from '../../api/imageApi.js'
import { hasApiKey } from '../../api/gemini.js'

export default function Step5_Shorts() {
  const {
    scenes, continuityBible, scriptText,
    selectedStyleId, selectedModel, aspectRatio,
    shortsClips, setShortsClips, addShortsClips,
    detectedLanguage,
    setStep, setError, clearError,
  } = useAppStore()

  const error  = useAppStore(s => s.error)
  const style  = STYLES.find(s => s.id === selectedStyleId) || STYLES[0]
  const modelId = MODELS[selectedModel]?.id || MODELS[0].id

  const [loadingSceneId, setLoadingSceneId] = useState(null)
  const [loadingAll, setLoadingAll]         = useState(false)
  const [clipCount, setClipCount]           = useState(3)
  const [loadingImageId, setLoadingImageId] = useState(null)

  // 씬 1개 → 쇼츠 변환
  const handleGenScene = async (scene, batchIdx) => {
    if (!hasApiKey()) { setError('API 키를 먼저 설정하세요.'); return }
    setLoadingSceneId(scene.id)
    clearError()
    try {
      const clips = await generateShortsFromScene(scene, continuityBible, style, detectedLanguage, clipCount, batchIdx)
      // 기존 이 씬 관련 클립 제거 후 추가
      setShortsClips([...shortsClips.filter(c => c.sourceSceneId !== scene.id), ...clips])
    } catch (e) {
      setError(`쇼츠 변환 실패: ${e.message}`)
    } finally {
      setLoadingSceneId(null)
    }
  }

  // 전체 씬 쇼츠 변환
  const handleGenAll = async () => {
    if (!hasApiKey()) { setError('API 키를 먼저 설정하세요.'); return }
    setLoadingAll(true)
    clearError()
    try {
      const allClips = []
      for (let i = 0; i < scenes.length; i++) {
        const clips = await generateShortsFromScene(scenes[i], continuityBible, style, detectedLanguage, clipCount, i + 1)
        allClips.push(...clips)
      }
      setShortsClips(allClips)
    } catch (e) {
      setError(`전체 쇼츠 변환 실패: ${e.message}`)
    } finally {
      setLoadingAll(false)
    }
  }

  // 클립 이미지 생성
  const handleGenImage = async (clip, clipIdx) => {
    if (!hasApiKey()) { setError('API 키를 먼저 설정하세요.'); return }
    setLoadingImageId(clip.id)
    try {
      const url = await generateSceneImage(clip, continuityBible, style, modelId, '9:16', false)
      setShortsClips(shortsClips.map(c => c.id === clip.id ? { ...c, imageUrl: url } : c))
    } catch (e) {
      setError(`이미지 생성 실패: ${e.message}`)
    } finally {
      setLoadingImageId(null)
    }
  }

  const sceneClipsMap = {}
  shortsClips.forEach(c => {
    if (!sceneClipsMap[c.sourceSceneId]) sceneClipsMap[c.sourceSceneId] = []
    sceneClipsMap[c.sourceSceneId].push(c)
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <Smartphone size={22} className="text-red-400" />
            쇼츠 변환 시퀀스
          </h1>
          <p className="text-gray-500 text-sm mt-1">씬을 9:16 세로형 쇼츠 클립으로 변환합니다.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">클립 수</label>
            <select
              value={clipCount}
              onChange={e => setClipCount(Number(e.target.value))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-gray-300"
            >
              {[2,3,4,5,6].map(n => <option key={n} value={n}>{n}개</option>)}
            </select>
          </div>
          <Button
            onClick={handleGenAll}
            disabled={loadingAll || scenes.length === 0}
            variant="danger"
            size="sm"
          >
            {loadingAll ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />}
            전체 씬 변환
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
        <div className="text-center py-12 text-gray-500">
          씬 시퀀스가 없습니다. 먼저 Step 4에서 씬을 생성하세요.
        </div>
      )}

      {/* 씬별 쇼츠 섹션 */}
      <div className="space-y-8">
        {scenes.map((scene, i) => {
          const sceneClips = sceneClipsMap[scene.id] || []
          const isLoading  = loadingSceneId === scene.id

          return (
            <div key={scene.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {/* 씬 헤더 */}
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
                  {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Smartphone size={12} />}
                  {sceneClips.length > 0 ? '재변환' : '쇼츠 변환'}
                </Button>
              </div>

              {/* 클립 그리드 */}
              {sceneClips.length > 0 && (
                <div className="p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {sceneClips.map((clip, ci) => (
                      <div key={clip.id} className="space-y-2">
                        {/* 세로형 이미지 영역 */}
                        <div className="relative bg-gray-800 rounded-lg overflow-hidden" style={{ aspectRatio: '9/16' }}>
                          {clip.imageUrl ? (
                            <img src={clip.imageUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <button
                                onClick={() => handleGenImage(clip, ci)}
                                disabled={loadingImageId === clip.id}
                                className="text-gray-500 hover:text-purple-400 transition-colors"
                                title="이미지 생성"
                              >
                                {loadingImageId === clip.id ? (
                                  <Loader2 size={20} className="animate-spin text-purple-400" />
                                ) : (
                                  <ImageIcon size={20} />
                                )}
                              </button>
                            </div>
                          )}
                          {/* 클립 번호 */}
                          <div className="absolute top-1 left-1 bg-black/60 rounded px-1 text-[9px] text-gray-300 font-bold">
                            #{ci + 1}
                          </div>
                          {/* hookType 뱃지 */}
                          {clip.hookType && (
                            <div className="absolute bottom-1 left-1 bg-red-600/80 rounded px-1 text-[8px] text-white font-bold uppercase">
                              {clip.hookType}
                            </div>
                          )}
                        </div>

                        {/* 클립 정보 */}
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

      {/* 네비게이션 */}
      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={() => setStep(4)}>
          <ChevronLeft size={16} /> 이전: 씬 시퀀스
        </Button>
        <Button onClick={() => setStep(6)}>
          다음: 인트로 시퀀스 <ChevronRight size={18} />
        </Button>
      </div>
    </div>
  )
}
