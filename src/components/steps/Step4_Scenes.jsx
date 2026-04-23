import { useState, useEffect, useRef } from 'react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { ChevronRight, ChevronLeft, Play, RefreshCw, Copy, Check, Image, AlertTriangle, Zap, Edit3, Upload, FileText, Download } from 'lucide-react'
import Button from '../ui/Button.jsx'
import Spinner from '../ui/Spinner.jsx'
import ProgressBar from '../ui/ProgressBar.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import { STYLES, MODELS } from '../../data/styles.js'
import { generateAllScenes, generateSingleSceneInfo, regenerateScene } from '../../api/sceneApi.js'
import { generateSceneImage } from '../../api/imageApi.js'
import { LANG_CONFIGS } from '../../data/languages.js'
import { isApiReady } from '../../api/gemini.js'

function SceneCard({ scene, idx, onRegenerateImage, onRegenerateScene, onCopyPrompt, copiedIdx, onSavePrompt, aspectRatio, onSaveImage }) {
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')

  const shotTypeColors = {
    'close-up': 'bg-blue-900/60 text-blue-300',
    'medium': 'bg-green-900/60 text-green-300',
    'wide': 'bg-orange-900/60 text-orange-300',
    'extreme-close-up': 'bg-red-900/60 text-red-300',
    'aerial': 'bg-purple-900/60 text-purple-300',
    'POV': 'bg-yellow-900/60 text-yellow-300',
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden group hover:border-gray-700 transition-colors">
      {/* Image area */}
      <div className={`relative bg-gray-800 ${aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`}>
        {scene.imageUrl ? (
          <img
            src={scene.imageUrl}
            alt={`씬 ${idx + 1}`}
            className="w-full h-full object-cover"
          />
        ) : scene.imageError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-3">
            <AlertTriangle size={20} className="text-red-500" />
            <p className="text-xs text-red-400 line-clamp-2">{scene.imageError}</p>
            <button
              onClick={() => onRegenerateImage(idx)}
              className="text-xs bg-red-900/40 border border-red-800 text-red-300 px-3 py-1 rounded-lg hover:bg-red-900/60 transition-colors flex items-center gap-1"
            >
              <RefreshCw size={11} />
              재시도
            </button>
          </div>
        ) : scene.generating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Spinner size="md" />
            <span className="text-xs text-gray-500">이미지 생성 중...</span>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="text-gray-700 text-2xl">🖼️</div>
            <button
              onClick={() => onRegenerateImage(idx)}
              className="text-xs bg-gray-700/80 text-gray-400 px-3 py-1 rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-1"
            >
              <Image size={11} />
              이미지 생성
            </button>
          </div>
        )}

        {/* Scene number badge */}
        <div className="absolute top-2 left-2 bg-black/70 text-white text-xs font-mono px-2 py-0.5 rounded-md">
          씬 {idx + 1}
        </div>

        {/* Action buttons (show on hover) */}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {scene.imageUrl && (
            <button
              onClick={() => onSaveImage(idx)}
              title="이미지 저장"
              className="w-6 h-6 bg-black/70 hover:bg-emerald-700 rounded flex items-center justify-center text-white transition-colors"
            >
              <Download size={11} />
            </button>
          )}
          <button
            onClick={() => onRegenerateImage(idx)}
            title="이미지 재생성"
            className="w-6 h-6 bg-black/70 hover:bg-purple-700 rounded flex items-center justify-center text-white transition-colors"
          >
            <Image size={11} />
          </button>
          <button
            onClick={() => onRegenerateScene(idx)}
            title="씬 재생성"
            className="w-6 h-6 bg-black/70 hover:bg-blue-700 rounded flex items-center justify-center text-white transition-colors"
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        {/* Shot type + duration */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full ${shotTypeColors[scene.shotType] || 'bg-gray-700 text-gray-400'}`}>
            {scene.shotType || 'medium'}
          </span>
          <span className="text-xs text-gray-600">{scene.duration || ''}</span>
          {scene.setting && (
            <span className="text-xs text-gray-700 truncate">{scene.setting.slice(0, 20)}</span>
          )}
        </div>

        {/* Action */}
        {scene.action && (
          <p className="text-sm font-medium text-gray-300 line-clamp-2 leading-snug">{scene.action}</p>
        )}

        {/* Dialogue */}
        {scene.dialogue && (
          <p className="text-xs text-purple-300/80 italic line-clamp-2">"{scene.dialogue}"</p>
        )}

        {/* Copy prompt */}
        {scene.imagePrompt && (
          <button
            onClick={() => onCopyPrompt(idx, scene.imagePrompt)}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            {copiedIdx === idx ? (
              <><Check size={11} className="text-emerald-400" /><span className="text-emerald-400">복사됨</span></>
            ) : (
              <><Copy size={11} />이미지 프롬프트 복사</>
            )}
          </button>
        )}

        {/* 프롬프트 수정 */}
        {scene.imagePrompt && (
          <div className="pt-1 border-t border-gray-800">
            {editingPrompt ? (
              <div className="space-y-2">
                <textarea
                  value={promptDraft}
                  onChange={e => setPromptDraft(e.target.value)}
                  className="w-full h-24 bg-gray-800 border border-purple-600 rounded-lg px-3 py-2 text-xs text-gray-300 resize-none focus:outline-none focus:ring-1 focus:ring-purple-500 leading-relaxed"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { onSavePrompt(idx, promptDraft); setEditingPrompt(false) }}
                    className="flex-1 text-xs bg-purple-700 hover:bg-purple-600 text-white py-1.5 rounded-lg transition-colors"
                  >
                    저장
                  </button>
                  <button
                    onClick={() => setEditingPrompt(false)}
                    className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 py-1.5 rounded-lg transition-colors"
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setPromptDraft(scene.imagePrompt); setEditingPrompt(true) }}
                className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors"
              >
                <Edit3 size={11} />
                프롬프트 수정
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Step4_Scenes() {
  const {
    scriptText, selectedStyleId, selectedModel, imageEngine, aspectRatio,
    continuityBible, detectedLanguage,
    scenes, setScenes, updateScene,
    generationProgress, setProgress,
    isGenerating, setGenerating,
    targetSceneCount, currentMode, visualMode, isEditorialMode,
    isFixedCharMode, fixedCharStyleType, fixedCharSampleImage,
    setStep, setError, clearError,
  } = useAppStore()

  const [copiedIdx, setCopiedIdx]           = useState(null)
  const [generatingImages, setGeneratingImages] = useState(false)
  const bulkImgRef = useRef(null)

  // 이전 세션에서 isGenerating이 stuck된 경우 초기화
  useEffect(() => {
    if (isGenerating) setGenerating(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const style   = STYLES.find(s => s.id === selectedStyleId) || STYLES[0]
  const modelId = imageEngine || MODELS[selectedModel]?.id || MODELS[0].id
  const error   = useAppStore(s => s.error)

  // editorial 모드 결정 (content/infoviz/docu → editorial 프롬프트 사용)
  const EDITORIAL_MODES = new Set(['content', 'infoviz', 'docu'])
  const effectiveMode = EDITORIAL_MODES.has(visualMode) ? 'editorial' : 'normal'

  const fixedCharArgs = isFixedCharMode
    ? [fixedCharStyleType || 'countryball', fixedCharSampleImage || null]
    : [null, null]

  const handleGenerateAllScenes = async () => {
    if (!isApiReady()) { setError('API 키가 설정되지 않았습니다.'); return }
    clearError()
    setGenerating(true)
    setProgress(0, 0)
    try {
      const result = await generateAllScenes(
        scriptText,
        continuityBible || { characters: [], environment: {}, locations: [], camera: {} },
        style,
        detectedLanguage,
        (current, total) => setProgress(current, total),
        targetSceneCount ?? 30,
        effectiveMode,
        visualMode,
        isEditorialMode
      )
      setScenes(result)
      setProgress(result.length, result.length)
    } catch (err) {
      setError('씬 생성 실패: ' + err.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateAllImages = async () => {
    if (!isApiReady()) { setError('API 키가 설정되지 않았습니다.'); return }
    clearError()
    setGeneratingImages(true)

    const sceneList = [...scenes]
    let completed = 0

    for (let idx = 0; idx < sceneList.length; idx++) {
      const scene = sceneList[idx]
      if (!scene?.imagePrompt && !scene?.imagePromptKo && !scene?.action) {
        completed++
        setProgress(completed, sceneList.length)
        continue
      }
      updateScene(idx, { generating: true, imageError: null })
      try {
        const url = await generateSceneImage(
          scene,
          continuityBible || { characters: [] },
          style,
          modelId,
          aspectRatio,
          false,
          currentMode,
          ...fixedCharArgs
        )
        updateScene(idx, { imageUrl: url, generating: false, imageError: null })
      } catch (err) {
        updateScene(idx, { imageError: err.message, generating: false })
      }
      completed++
      setProgress(completed, sceneList.length)
      if (idx < sceneList.length - 1) {
        const isZImage = modelId === 'z-image-turbo'
        await new Promise(r => setTimeout(r, isZImage ? 500 : 1000))
      }
    }

    setGeneratingImages(false)
    setProgress(sceneList.length, sceneList.length)
  }

  const handleRegenerateImage = async (idx) => {
    const scene = scenes[idx]
    if (!scene?.imagePrompt && !scene?.imagePromptKo && !scene?.action) return
    clearError()
    updateScene(idx, { generating: true, imageError: null })
    try {
      const url = await generateSceneImage(
        scene,
        continuityBible || { characters: [] },
        style,
        modelId,
        aspectRatio,
        false,
        currentMode,
        ...fixedCharArgs
      )
      updateScene(idx, { imageUrl: url, generating: false, imageError: null })
    } catch (err) {
      updateScene(idx, { imageError: err.message, generating: false })
    }
  }

  const handleRegenerateScene = async (idx) => {
    if (!isApiReady()) return
    clearError()
    const langConfig = LANG_CONFIGS[detectedLanguage] || LANG_CONFIGS.ko
    updateScene(idx, { generating: true })
    try {
      const sceneRef = scenes[idx] || {}
      const newInfo = await generateSingleSceneInfo(
        sceneRef,
        continuityBible || { characters: [], environment: {}, locations: [], camera: {} },
        style,
        langConfig
      )
      updateScene(idx, { ...newInfo, generating: false, imageUrl: null, imageError: null })
    } catch (err) {
      updateScene(idx, { generating: false, imageError: err.message })
    }
  }

  const handleBulkImageImport = async (e) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const updatedScenes = [...scenes]
    let matched = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const m = file.name.match(/P[-_]?(\d+)/i)
      if (m) {
        const sceneIdx = parseInt(m[1], 10) - 1
        if (sceneIdx >= 0 && sceneIdx < updatedScenes.length) {
          const dataUrl = await new Promise(resolve => {
            const reader = new FileReader()
            reader.onload = ev => resolve(ev.target.result)
            reader.readAsDataURL(file)
          })
          updatedScenes[sceneIdx] = { ...updatedScenes[sceneIdx], imageUrl: dataUrl, generating: false, imageError: null }
          matched++
        }
      }
    }
    if (matched > 0) {
      setScenes(updatedScenes)
      alert(`✅ 총 ${matched}장의 외부 이미지가 씬에 일괄 등록되었습니다.`)
    } else {
      alert('❌ 파일명에서 P1, P2 등 씬 번호를 찾을 수 없거나 매칭되는 씬이 없습니다.\n(예시 파일명: P01_image.png)')
    }
    e.target.value = ''
  }

  const handleExtractPrompts = (type = 'main') => {
    const sceneList = type === 'shorts' ? [] : scenes // shorts/intro는 미구현시 빈 배열
    if (sceneList.length === 0) { alert('다운로드할 프롬프트가 없습니다.'); return }

    const bible = continuityBible || { characters: [], environment: {} }
    const isEditorial = effectiveMode === 'editorial'
    const tagPrefix  = isEditorial ? 'KEY' : 'ACTOR'

    // ACTOR 태그 → 실제 이름 치환
    const replaceActorTags = (text) => {
      if (!text || !bible) return text || ''
      let result = text
      ;(bible.characters || []).forEach((char, i) => {
        const letter = String.fromCharCode(65 + i)
        ;[
          new RegExp(`\\[${tagPrefix}-${letter}\\]`, 'gi'),
          new RegExp(`\\(${tagPrefix}-${letter}\\)`, 'gi'),
          new RegExp(`${tagPrefix}[-_]${letter}`, 'gi'),
          new RegExp(`${tagPrefix}${letter}`, 'gi'),
        ].forEach(re => { result = result.replace(re, `@${char.name}`) })
      })
      return result
    }

    // 완성 이미지 프롬프트 조립
    const buildFullPrompt = (scene) => {
      const styleStr = style.prompt.replace(/\n+/g, ' ').trim()
      const envStr   = (bible.environment?.visualPrompt || '').replace(/\n+/g, ' ').trim()
      const sceneStr = replaceActorTags(scene.imagePrompt || '').replace(/\n+/g, ' ').trim()
      let full = [styleStr, envStr, sceneStr, 'cinematic lighting, 8k resolution, 100% full bleed, absolutely no text or watermarks']
        .filter(Boolean).join(', ')
      if (isEditorial && scene.screenText) {
        full += `, include text overlay EXACTLY as: "${scene.screenText}"`
      }
      return full.replace(/\s{2,}/g, ' ')
    }

    // 파일명 prefix
    const date   = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const prefix = `${date}_${type}`

    const download = (content, filename) => {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const a    = document.createElement('a')
      a.href     = URL.createObjectURL(blob)
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    }

    // IMG.txt — 완성 이미지 프롬프트
    const imgContent = sceneList.map(s => `--- ${s.id} ---\n${buildFullPrompt(s)}`).join('\n\n')
    download(imgContent, `${prefix}_IMG.txt`)

    // GROK.txt — 이미지+영상+대사 (Grok/AI영상툴용), 500ms 후
    setTimeout(() => {
      const grokContent = sceneList.map(s => {
        const imgPart    = replaceActorTags(s.imagePrompt || '').replace(/\n+/g, ' ').trim()
        const motionPart = s.videoPromptEn ? `Motion: ${replaceActorTags(s.videoPromptEn).replace(/\n+/g, ' ').trim()}` : ''
        const dialogPart = s.dialogue ? `Speech Dialog (Korean): "${replaceActorTags(s.dialogue).replace(/\n+/g, ' ').trim()}"` : ''
        const combined   = [imgPart, motionPart, dialogPart].filter(Boolean).join(', ')
        return `--- ${s.id} ---\n${combined}`
      }).join('\n\n')
      download(grokContent, `${prefix}_GROK.txt`)
    }, 500)
  }

  const handleSaveImage = (idx) => {
    const scene = scenes[idx]
    if (!scene?.imageUrl) return
    const a = document.createElement('a')
    a.href = scene.imageUrl
    a.download = `scene_${String(idx + 1).padStart(2, '0')}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleSaveAllImages = async () => {
    const withImages = scenes.filter(s => s.imageUrl)
    if (withImages.length === 0) { alert('저장할 이미지가 없습니다.'); return }
    const zip = new JSZip()
    withImages.forEach((scene, i) => {
      const idx = scenes.indexOf(scene)
      const base64 = scene.imageUrl.split(',')[1]
      zip.file(`scene_${String(idx + 1).padStart(2, '0')}.png`, base64, { base64: true })
    })
    const blob = await zip.generateAsync({ type: 'blob' })
    saveAs(blob, `scenes_${new Date().toISOString().slice(0, 10)}.zip`)
  }

  const handleCopyPrompt = (idx, prompt) => {
    navigator.clipboard.writeText(prompt)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  const progressPct = generationProgress.total > 0
    ? (generationProgress.current / generationProgress.total) * 100
    : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">씬 생성</h1>
        <p className="text-gray-500 text-sm mt-1">대본을 씬별 스토리보드로 변환합니다.</p>
      </div>

      {error && (
        <div className="flex items-start gap-3 bg-red-950/40 border border-red-800/50 rounded-lg p-4 text-sm text-red-300">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button onClick={clearError} className="text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* Generate buttons */}
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={handleGenerateAllScenes}
          loading={isGenerating}
          disabled={isGenerating || generatingImages}
          size="lg"
          variant="primary"
        >
          <Zap size={16} />
          {scenes.length > 0 ? '씬 전체 재생성' : '전체 씬 생성 시작'}
        </Button>

        {scenes.length > 0 && (
          <Button
            onClick={handleGenerateAllImages}
            loading={generatingImages}
            disabled={isGenerating || generatingImages}
            variant="secondary"
            size="lg"
          >
            <Image size={16} />
            {generatingImages ? '이미지 생성 중...' : '전체 이미지 생성'}
          </Button>
        )}

        {scenes.length > 0 && (
          <>
            <Button
              onClick={() => bulkImgRef.current?.click()}
              disabled={isGenerating || generatingImages}
              variant="secondary"
              size="lg"
            >
              <Upload size={16} />
              외부 이미지 일괄등록
            </Button>
            <input
              ref={bulkImgRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleBulkImageImport}
            />

            <button
              onClick={() => handleExtractPrompts('main')}
              disabled={isGenerating || generatingImages}
              className="flex flex-col items-center gap-0.5 bg-amber-900/20 hover:bg-amber-900/40 text-amber-500 font-bold py-2 px-4 rounded-xl border border-amber-700/30 transition-all disabled:opacity-50 text-xs"
            >
              <div className="flex items-center gap-1.5">
                <FileText size={13} />
                <span>프롬프트 추출</span>
              </div>
              <span className="text-[9px] text-amber-500/70 font-medium">AutoFlow용 (.txt)</span>
            </button>

            {scenes.some(s => s.imageUrl) && (
              <button
                onClick={handleSaveAllImages}
                disabled={isGenerating || generatingImages}
                className="flex flex-col items-center gap-0.5 bg-emerald-900/20 hover:bg-emerald-900/40 text-emerald-400 font-bold py-2 px-4 rounded-xl border border-emerald-700/30 transition-all disabled:opacity-50 text-xs"
              >
                <div className="flex items-center gap-1.5">
                  <Download size={13} />
                  <span>이미지 일괄저장</span>
                </div>
                <span className="text-[9px] text-emerald-400/70 font-medium">(.zip)</span>
              </button>
            )}
          </>
        )}
      </div>

      {/* Progress */}
      {(isGenerating || generatingImages) && generationProgress.total > 0 && (
        <ProgressBar
          value={progressPct}
          label={`${generationProgress.current} / ${generationProgress.total} 씬 처리 중`}
        />
      )}

      {/* Scene count */}
      {scenes.length > 0 && (
        <div className="text-sm text-gray-500">
          총 <span className="text-purple-400 font-semibold">{scenes.length}개</span> 씬
          {scenes.filter(s => s.imageUrl).length > 0 && (
            <> · 이미지 <span className="text-emerald-400">{scenes.filter(s => s.imageUrl).length}개</span> 완료</>
          )}
        </div>
      )}

      {/* Scene grid */}
      {scenes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {scenes.map((scene, idx) => (
            <SceneCard
              key={scene.id || idx}
              scene={scene}
              idx={idx}
              onRegenerateImage={handleRegenerateImage}
              onRegenerateScene={handleRegenerateScene}
              onCopyPrompt={handleCopyPrompt}
              copiedIdx={copiedIdx}
              onSavePrompt={(i, newPrompt) => updateScene(i, { imagePrompt: newPrompt })}
              onSaveImage={handleSaveImage}
              aspectRatio={aspectRatio}
            />
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={() => setStep(3)}>
          <ChevronLeft size={16} />
          이전: 캐릭터
        </Button>
        <Button
          onClick={() => { clearError(); setStep(5) }}
          size="lg"
          disabled={scenes.length === 0}
        >
          다음: 쇼츠 변환
          <ChevronRight size={18} />
        </Button>
      </div>
    </div>
  )
}
