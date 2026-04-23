import { useState } from 'react'
import { ChevronLeft, Youtube, Image as ImageIcon, Loader2, Copy, Check, Hash, FileText, Type, Download } from 'lucide-react'
import Button from '../ui/Button.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import { STYLES, MODELS } from '../../data/styles.js'
import { generateYoutubeMetadata } from '../../api/seoApi.js'
import { generateThumbnails } from '../../api/imageApi.js'
import { isApiReady } from '../../api/gemini.js'
import { exportZip } from '../../utils/exportZip.js'

function CopyButton({ text, label = '복사' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
    >
      {copied ? <><Check size={12} className="text-emerald-400" /><span className="text-emerald-400">복사됨</span></> : <><Copy size={12} />{label}</>}
    </button>
  )
}

export default function Step8_SEO() {
  const {
    scriptText, continuityBible, scenes, shortsClips, introClips,
    selectedStyleId, selectedModel, aspectRatio,
    youtubeMetadata, setMetadata,
    thumbnails, setThumbnails,
    bgmData, multiTrackBGM,
    setStep, setError, clearError,
  } = useAppStore()

  const error   = useAppStore(s => s.error)
  const style   = STYLES.find(s => s.id === selectedStyleId) || STYLES[0]
  const modelId = MODELS[selectedModel]?.id || MODELS[0].id

  const [loadingMeta, setLoadingMeta]     = useState(false)
  const [loadingThumbs, setLoadingThumbs] = useState(false)
  const [exporting, setExporting]         = useState(false)
  const [selectedTitleIdx, setSelectedTitleIdx] = useState(0)

  const handleGenMeta = async () => {
    if (!isApiReady()) { setError('API 키를 먼저 설정하세요.'); return }
    setLoadingMeta(true)
    clearError()
    try {
      const meta = await generateYoutubeMetadata(scriptText, continuityBible || { characters: [], environment: { description: '' }, tone: '' })
      setMetadata(meta)
    } catch (e) {
      setError(`SEO 생성 실패: ${e.message}`)
    } finally {
      setLoadingMeta(false)
    }
  }

  const handleGenThumbs = async () => {
    if (!isApiReady()) { setError('API 키를 먼저 설정하세요.'); return }
    if (!continuityBible) { setError('먼저 캐릭터 바이블을 생성하세요.'); return }
    setLoadingThumbs(true)
    clearError()
    try {
      const thumbs = await generateThumbnails(continuityBible, style, modelId, aspectRatio)
      setThumbnails(thumbs)
    } catch (e) {
      setError(`썸네일 생성 실패: ${e.message}`)
    } finally {
      setLoadingThumbs(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    clearError()
    try {
      await exportZip({
        scenes, shortsClips, introClips,
        continuityBible,
        youtubeMetadata,
        bgmData,
        multiTrackBGM,
        thumbnails,
      })
    } catch (e) {
      setError(`ZIP 내보내기 실패: ${e.message}`)
    } finally {
      setExporting(false)
    }
  }

  const downloadImage = (dataUrl, filename) => {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename
    a.click()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
          <Youtube size={22} className="text-red-400" />
          YouTube SEO & 썸네일
        </h1>
        <p className="text-gray-500 text-sm mt-1">유튜브 제목, 설명, 해시태그, 썸네일을 생성합니다.</p>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800/50 rounded-lg p-3 text-sm text-red-300 flex justify-between">
          <span>{error}</span>
          <button onClick={clearError} className="text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* SEO 생성 */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Type size={14} className="text-red-400" />
            YouTube SEO 메타데이터
          </h2>
          <Button onClick={handleGenMeta} disabled={loadingMeta || !scriptText} size="sm">
            {loadingMeta ? <Loader2 size={14} className="animate-spin" /> : <Youtube size={14} />}
            {youtubeMetadata ? '재생성' : 'SEO 생성'}
          </Button>
        </div>

        {youtubeMetadata && (
          <div className="space-y-4">
            {/* 제목 3개 */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Type size={11} /> 제목 (3개)
              </h3>
              {(youtubeMetadata.titles || []).map((title, i) => (
                <div
                  key={i}
                  onClick={() => setSelectedTitleIdx(i)}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedTitleIdx === i
                      ? 'bg-red-900/20 border-red-700/50'
                      : 'bg-gray-800/50 border-gray-700/50 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold ${
                      selectedTitleIdx === i ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400'
                    }`}>{i + 1}</span>
                    <span className={`text-sm ${selectedTitleIdx === i ? 'text-red-200' : 'text-gray-300'}`}>{title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${title.length > 30 ? 'text-yellow-400' : 'text-gray-600'}`}>{title.length}자</span>
                    <CopyButton text={title} />
                  </div>
                </div>
              ))}
            </div>

            {/* 설명 */}
            {youtubeMetadata.description && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText size={11} /> 설명란
                  </h3>
                  <CopyButton text={youtubeMetadata.description} />
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <p className="text-sm text-gray-300 whitespace-pre-line leading-relaxed">{youtubeMetadata.description}</p>
                  <p className="text-xs text-gray-600 mt-2">{youtubeMetadata.description.length}자</p>
                </div>
              </div>
            )}

            {/* 해시태그 */}
            {(youtubeMetadata.hashtags || []).length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Hash size={11} /> 해시태그
                  </h3>
                  <CopyButton text={youtubeMetadata.hashtags.join(' ')} label="전체 복사" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {youtubeMetadata.hashtags.map((tag, i) => (
                    <span
                      key={i}
                      onClick={() => navigator.clipboard.writeText(tag)}
                      className="text-xs bg-gray-800 border border-gray-700 text-blue-400 px-2 py-1 rounded-full cursor-pointer hover:border-blue-600 transition-colors"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 썸네일 텍스트 */}
            {(youtubeMetadata.thumbnailTexts || []).length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">썸네일 텍스트 (3종)</h3>
                <div className="grid grid-cols-3 gap-3">
                  {(['극적', '포스터', '클릭유발']).map((tone, i) => (
                    <div key={i} className="bg-gray-800/50 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-gray-500 mb-2">[{tone}]</p>
                      <p className="text-sm font-bold text-yellow-300">{youtubeMetadata.thumbnailTexts[i] || '-'}</p>
                      <div className="mt-2">
                        <CopyButton text={youtubeMetadata.thumbnailTexts[i] || ''} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 썸네일 생성 */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <ImageIcon size={14} className="text-purple-400" />
            썸네일 이미지 (3종)
          </h2>
          <div className="flex gap-2">
            <Button onClick={handleGenThumbs} disabled={loadingThumbs || !continuityBible} size="sm">
              {loadingThumbs ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
              {thumbnails.length > 0 ? '썸네일 재생성' : '썸네일 생성'}
            </Button>
          </div>
        </div>

        {thumbnails.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            {thumbnails.map((thumb, i) => {
              const labels = { DRAMATIC_CLIMAX: '드라마틱 클라이맥스', MOVIE_POSTER: '영화 포스터', CLICK_BAIT: '클릭베이트' }
              const label  = labels[thumb.label] || thumb.label
              return (
                <div key={i} className="space-y-2">
                  <div className="relative rounded-lg overflow-hidden bg-gray-800" style={{ aspectRatio: aspectRatio === '9:16' ? '9/16' : '16/9' }}>
                    {thumb.imageUrl ? (
                      <>
                        <img src={thumb.imageUrl} alt={label} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 flex items-end p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => downloadImage(thumb.imageUrl, `thumbnail_${thumb.label}.png`)}
                            className="w-full bg-black/60 hover:bg-black/80 text-white text-xs py-1 rounded flex items-center justify-center gap-1"
                          >
                            <Download size={11} /> 저장
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-red-400 text-xs text-center p-2">
                        {thumb.error || '생성 실패'}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-center text-gray-400">{label}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ZIP 내보내기 */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-300">전체 패키지 내보내기</h2>
            <p className="text-xs text-gray-500 mt-1">씬 이미지, SEO, BGM, 썸네일을 ZIP으로 묶어 다운로드합니다.</p>
          </div>
          <Button onClick={handleExport} disabled={exporting} size="sm" variant="secondary">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            ZIP 내보내기
          </Button>
        </div>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={() => setStep(7)}>
          <ChevronLeft size={16} /> 이전: BGM
        </Button>
      </div>
    </div>
  )
}
