import { useState, useRef } from 'react'
import { ChevronRight, ChevronLeft, Users, MapPin, Camera, Plus, Trash2, Upload, Scan, AlertTriangle, Edit3, Check, X, RefreshCw, Image, Download, ZoomIn } from 'lucide-react'
import Button from '../ui/Button.jsx'
import Spinner from '../ui/Spinner.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import { STYLES, MODELS } from '../../data/styles.js'
import { generateContinuityBible, analyzeCharacterImage } from '../../api/bibleApi.js'
import { generateImage } from '../../api/imageApi.js'
import { isApiReady } from '../../api/gemini.js'

function EditableField({ value, onChange, multiline = false, className = '' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const handleSave = () => {
    onChange(draft)
    setEditing(false)
  }

  const handleCancel = () => {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex gap-2 items-start">
        {multiline ? (
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={handleSave}
            className="flex-1 bg-gray-700 border border-purple-600 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none resize-none min-h-[60px]"
            autoFocus
          />
        ) : (
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={handleSave}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel() }}
            className={`flex-1 bg-gray-700 border border-purple-600 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none ${className}`}
            autoFocus
          />
        )}
        <button onMouseDown={e => { e.preventDefault(); handleSave() }} className="text-emerald-400 hover:text-emerald-300 flex-shrink-0 mt-1">
          <Check size={14} />
        </button>
        <button onMouseDown={e => { e.preventDefault(); handleCancel() }} className="text-red-400 hover:text-red-300 flex-shrink-0 mt-1">
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div
      className={`group flex items-start gap-1 cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-gray-700/40 transition-colors ${className}`}
      onClick={() => { setDraft(value); setEditing(true) }}
    >
      <span className="flex-1 text-sm text-gray-300">{value || <span className="text-gray-600 italic">클릭하여 편집</span>}</span>
      <Edit3 size={11} className="flex-shrink-0 mt-0.5 text-gray-700 group-hover:text-gray-500 transition-colors" />
    </div>
  )
}

export default function Step3_Bible() {
  const {
    scriptText, selectedStyleId, selectedModel, detectedLanguage,
    continuityBible, setBible,
    characterImages, setCharacterImage,
    setStep, setError, clearError,
  } = useAppStore()

  const [loading, setLoading] = useState(false)
  const [analyzingImages, setAnalyzingImages] = useState({})
  const [generatingCharImages, setGeneratingCharImages] = useState({})  // {idx: boolean}
  const [lightbox, setLightbox] = useState(null)  // {url, name}
  const fileInputRefs = useRef({})
  const error = useAppStore(s => s.error)

  const style = STYLES.find(s => s.id === selectedStyleId) || STYLES[0]

  const handleAnalyze = async () => {
    if (!isApiReady()) {
      setError('API 키가 설정되지 않았습니다.')
      return
    }
    clearError()
    setLoading(true)
    try {
      const bible = await generateContinuityBible(scriptText, style, detectedLanguage)
      setBible(bible)
    } catch (err) {
      setError('캐릭터 분석 실패: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const updateCharacter = (idx, field, value) => {
    if (!continuityBible) return
    const characters = [...continuityBible.characters]
    characters[idx] = { ...characters[idx], [field]: value }
    setBible({ ...continuityBible, characters })
  }

  const deleteCharacter = (idx) => {
    if (!continuityBible) return
    const characters = continuityBible.characters.filter((_, i) => i !== idx)
    setBible({ ...continuityBible, characters })
  }

  const addCharacter = () => {
    if (!continuityBible) return
    const newChar = {
      id: `char_${Date.now()}`,
      name: '새 캐릭터',
      role: '단역',
      age: '',
      gender: '미상',
      description: '',
      imagePromptKo: '',
      visualPrompt: '',
    }
    setBible({ ...continuityBible, characters: [...(continuityBible.characters || []), newChar] })
  }

  const handleImageUpload = async (idx, file) => {
    if (!file) return
    setAnalyzingImages(prev => ({ ...prev, [idx]: true }))
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = e => resolve(e.target.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const base64 = dataUrl.split(',')[1]
      const char = continuityBible?.characters?.[idx]

      // 이미지 즉시 표시 + 씬 생성 레퍼런스로 전달 (imageApi는 char.imageUrl 참조)
      updateCharacter(idx, 'charImageUrl', dataUrl)
      updateCharacter(idx, 'imageUrl', dataUrl)
      if (char?.name) setCharacterImage(char.name, dataUrl)

      // AI 분석으로 visualPrompt 업데이트
      const result = await analyzeCharacterImage(base64)
      updateCharacter(idx, 'imagePromptKo', result.imagePromptKo || '')
      updateCharacter(idx, 'visualPrompt', result.visualPrompt || '')
      if (result.age) updateCharacter(idx, 'age', result.age)
    } catch (err) {
      setError(`인물 분석 실패: ${err.message}`)
    } finally {
      setAnalyzingImages(prev => ({ ...prev, [idx]: false }))
    }
  }

  const handleGenerateCharImage = async (idx, char) => {
    if (!isApiReady()) { setError('API 키가 설정되지 않았습니다.'); return }
    setGeneratingCharImages(prev => ({ ...prev, [idx]: true }))
    try {
      const modelId = MODELS[selectedModel]?.id || MODELS[0].id
      const prompt = char.visualPrompt || char.imagePromptKo
        ? `Portrait of ${char.name}. ${char.visualPrompt || ''} ${char.imagePromptKo || ''}. Character portrait, full face visible, upper body shot, neutral background.`
        : `Portrait of a character named ${char.name}, ${char.role}, ${char.gender}, ${char.age}. Character portrait, upper body shot.`
      const url = await generateImage(prompt, style, modelId, '1:1', false)
      updateCharacter(idx, 'charImageUrl', url)
      updateCharacter(idx, 'imageUrl', url)
      setCharacterImage(char.name, url)
    } catch (err) {
      setError(`캐릭터 이미지 생성 실패: ${err.message}`)
    } finally {
      setGeneratingCharImages(prev => ({ ...prev, [idx]: false }))
    }
  }

  const handleGenerateAllCharImages = async () => {
    if (!isApiReady()) { setError('API 키가 설정되지 않았습니다.'); return }
    const characters = continuityBible?.characters || []
    for (let idx = 0; idx < characters.length; idx++) {
      const char = characters[idx]
      if (char.charImageUrl || characterImages[char.name]) continue
      await handleGenerateCharImage(idx, char)
    }
  }

  const handleDownloadCharImage = (url, name) => {
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.png`
    a.click()
  }

  const handleNext = () => {
    clearError()
    setStep(4)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">캐릭터 분석</h1>
        <p className="text-gray-500 text-sm mt-1">대본에서 캐릭터와 환경을 자동으로 추출하여 시각적 일관성을 확보합니다.</p>
      </div>

      {error && (
        <div className="flex items-start gap-3 bg-red-950/40 border border-red-800/50 rounded-lg p-4 text-sm text-red-300">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button onClick={clearError} className="text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* Analyze button */}
      {!continuityBible && !loading && (
        <button
          onClick={handleAnalyze}
          className="w-full py-8 border-2 border-dashed border-purple-700/50 rounded-2xl text-center hover:border-purple-600 hover:bg-purple-950/10 transition-all group"
        >
          <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">🎭</div>
          <div className="text-lg font-semibold text-purple-300 mb-1">캐릭터/환경 자동 분석 시작</div>
          <div className="text-sm text-gray-500">대본에서 등장인물, 배경, 카메라 스타일을 자동 추출합니다</div>
        </button>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Spinner size="xl" />
          <div className="text-gray-400 text-sm">대본 분석 중... 잠시 기다려주세요.</div>
          <div className="text-gray-600 text-xs">캐릭터, 환경, 로케이션을 추출하고 있습니다.</div>
        </div>
      )}

      {continuityBible && (
        <div className="space-y-5">
          {/* Re-analyze button */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-emerald-400 flex items-center gap-1.5">
              <Check size={14} />
              분석 완료
            </span>
            <Button variant="secondary" size="sm" onClick={handleAnalyze} loading={loading}>
              재분석
            </Button>
          </div>

          {/* Characters */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Users size={15} className="text-purple-400" />
                등장인물 ({(continuityBible.characters || []).length}명)
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateAllCharImages}
                  disabled={Object.values(generatingCharImages).some(Boolean)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-900/30 hover:bg-purple-900/50 border border-purple-700/40 text-purple-300 text-xs font-bold transition-all disabled:opacity-50"
                  title="이미지 없는 캐릭터 전체 생성"
                >
                  <Image size={12} />
                  전체 이미지 생성
                </button>
                <Button variant="ghost" size="sm" onClick={addCharacter}>
                  <Plus size={14} />
                  추가
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {(continuityBible.characters || []).map((char, idx) => (
                <div key={char.id || idx} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    {/* 캐릭터 이미지/아바타 영역 */}
                    <div className="flex-shrink-0">
                      {(() => {
                        const imgUrl = char.charImageUrl || characterImages[char.name]
                        return (
                          <div className="relative group">
                            <div
                              className="w-16 h-16 rounded-xl overflow-hidden bg-gray-700 border border-gray-600 cursor-pointer"
                              onClick={() => {
                                if (generatingCharImages[idx]) return
                                if (imgUrl) setLightbox({ url: imgUrl, name: char.name })
                                else handleGenerateCharImage(idx, char)
                              }}
                              title={imgUrl ? '클릭하여 크게 보기' : '클릭하여 이미지 생성'}
                            >
                              {imgUrl ? (
                                <>
                                  <img src={imgUrl} alt={char.name} className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                                    <ZoomIn size={16} className="text-white" />
                                  </div>
                                </>
                              ) : generatingCharImages[idx] ? (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Spinner size="sm" />
                                </div>
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-500 hover:text-purple-400 transition-colors">
                                  <Image size={16} />
                                  <span className="text-xs">생성</span>
                                </div>
                              )}
                            </div>
                            {/* 재생성 버튼 (이미지 있을 때만) */}
                            {imgUrl && !generatingCharImages[idx] && (
                              <button
                                onClick={() => handleGenerateCharImage(idx, char)}
                                title="재생성"
                                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-gray-600 hover:bg-purple-600 border border-gray-500 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <RefreshCw size={9} className="text-white" />
                              </button>
                            )}
                          </div>
                        )
                      })()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <EditableField
                          value={char.name}
                          onChange={v => updateCharacter(idx, 'name', v)}
                          className="font-semibold text-gray-200"
                        />
                        <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                          char.role === '주인공' ? 'bg-purple-900/60 text-purple-300' :
                          char.role === '조연' ? 'bg-blue-900/60 text-blue-300' :
                          'bg-gray-700/60 text-gray-400'
                        }`}>
                          {char.role}
                        </span>
                        <span className="text-xs text-gray-600">{char.age} · {char.gender}</span>
                      </div>

                      <div className="text-xs text-gray-400 leading-relaxed">
                        <label className="text-gray-600 block mb-0.5">캐릭터 설명</label>
                        <EditableField
                          value={char.description}
                          onChange={v => updateCharacter(idx, 'description', v)}
                          multiline
                        />
                      </div>

                      <div className="text-xs">
                        <label className="text-gray-600 block mb-0.5">이미지 프롬프트 (한국어)</label>
                        <EditableField
                          value={char.imagePromptKo}
                          onChange={v => updateCharacter(idx, 'imagePromptKo', v)}
                          multiline
                        />
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      {/* Image upload */}
                      <div>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          ref={el => fileInputRefs.current[idx] = el}
                          onChange={e => handleImageUpload(idx, e.target.files?.[0])}
                        />
                        <button
                          onClick={() => fileInputRefs.current[idx]?.click()}
                          title="참조 이미지 업로드"
                          className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-gray-400 hover:text-gray-200 transition-colors"
                        >
                          {analyzingImages[idx] ? <Spinner size="sm" /> : <Upload size={13} />}
                        </button>
                      </div>
                      {/* Download */}
                      {(char.charImageUrl || characterImages[char.name]) && (
                        <button
                          onClick={() => handleDownloadCharImage(char.charImageUrl || characterImages[char.name], char.name)}
                          title="이미지 다운로드"
                          className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-blue-700 flex items-center justify-center text-gray-400 hover:text-blue-200 transition-colors"
                        >
                          <Download size={13} />
                        </button>
                      )}
                      {/* Delete */}
                      <button
                        onClick={() => deleteCharacter(idx)}
                        className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-red-800 flex items-center justify-center text-gray-500 hover:text-red-300 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Environment */}
          {continuityBible.environment && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Camera size={15} className="text-purple-400" />
                세계관 / 환경
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-600 block mb-1">시대적 배경</label>
                  <EditableField
                    value={continuityBible.environment.period}
                    onChange={v => setBible({ ...continuityBible, environment: { ...continuityBible.environment, period: v } })}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600 block mb-1">분위기</label>
                  <EditableField
                    value={continuityBible.environment.mood}
                    onChange={v => setBible({ ...continuityBible, environment: { ...continuityBible.environment, mood: v } })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-gray-600 block mb-1">환경 설명</label>
                  <EditableField
                    value={continuityBible.environment.description}
                    onChange={v => setBible({ ...continuityBible, environment: { ...continuityBible.environment, description: v } })}
                    multiline
                  />
                </div>
              </div>
            </div>
          )}

          {/* Locations */}
          {continuityBible.locations?.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <MapPin size={15} className="text-purple-400" />
                로케이션 ({continuityBible.locations.length}개)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {continuityBible.locations.map((loc, i) => (
                  <div key={i} className="bg-gray-800/50 rounded-lg p-3">
                    <div className="text-sm font-medium text-gray-300">{loc.name}</div>
                    <div className="text-xs text-gray-500 mt-1">{loc.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Camera */}
          {continuityBible.camera && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2 mb-2">
                <Camera size={15} className="text-purple-400" />
                카메라 스타일
              </h2>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs bg-gray-800 text-gray-400 px-3 py-1 rounded-full">
                  {continuityBible.camera.style}
                </span>
                <span className="text-xs bg-gray-800 text-gray-400 px-3 py-1 rounded-full">
                  렌즈: {continuityBible.camera.lens}
                </span>
                <span className="text-xs bg-gray-800 text-gray-400 px-3 py-1 rounded-full">
                  {continuityBible.camera.movement}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <img src={lightbox.url} alt={lightbox.name} className="w-full rounded-2xl shadow-2xl" />
            <div className="absolute top-3 left-3 bg-black/60 text-white text-sm font-semibold px-3 py-1 rounded-full">
              {lightbox.name}
            </div>
            <div className="absolute top-3 right-3 flex gap-2">
              <button
                onClick={() => handleDownloadCharImage(lightbox.url, lightbox.name)}
                className="w-9 h-9 rounded-full bg-black/60 hover:bg-blue-600 flex items-center justify-center text-white transition-colors"
                title="다운로드"
              >
                <Download size={16} />
              </button>
              <button
                onClick={() => setLightbox(null)}
                className="w-9 h-9 rounded-full bg-black/60 hover:bg-gray-600 flex items-center justify-center text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={() => setStep(2)}>
          <ChevronLeft size={16} />
          이전: 스타일
        </Button>
        <Button
          onClick={handleNext}
          size="lg"
          disabled={!continuityBible}
        >
          씬 생성 시작
          <ChevronRight size={18} />
        </Button>
      </div>
    </div>
  )
}
