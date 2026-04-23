import { useState } from 'react'
import { ChevronLeft, Copy, Check, Download, Youtube, Music, Image, Package, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import Button from '../ui/Button.jsx'
import Spinner from '../ui/Spinner.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import { STYLES, MODELS } from '../../data/styles.js'
import { generateYoutubeMetadata, generateGlobalBGM, generateMultiTrackBGM } from '../../api/metadataApi.js'
import { generateThumbnail } from '../../api/imageApi.js'
import { exportZip } from '../../utils/exportZip.js'
import { isApiReady } from '../../api/gemini.js'
import { GENRES } from '../../data/genres.js'

function CopyButton({ text, label = '복사' }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
    >
      {copied ? <><Check size={12} className="text-emerald-400" /><span className="text-emerald-400">복사됨</span></> : <><Copy size={12} />{label}</>}
    </button>
  )
}

export default function Step5_Export() {
  const {
    scriptText, selectedGenre, selectedSubGenre, selectedStyleId, selectedModel,
    continuityBible, scenes, shortsClips, introClips,
    youtubeMetadata, setMetadata,
    bgmData, setBGM,
    multiTrackBGM, setMultiTrackBGM,
    thumbnails, setThumbnails,
    setStep, setError, clearError,
    characterImages,
  } = useAppStore()

  const [loadingMeta, setLoadingMeta] = useState(false)
  const [loadingBGM, setLoadingBGM] = useState(false)
  const [loadingMultiBGM, setLoadingMultiBGM] = useState(false)
  const [loadingThumbs, setLoadingThumbs] = useState(false)
  const [exporting, setExporting] = useState(false)

  const error = useAppStore(s => s.error)
  const style = STYLES.find(s => s.id === selectedStyleId) || STYLES[0]
  const modelId = MODELS[selectedModel]?.id || MODELS[0].id

  const genreLabel = selectedGenre
    ? `${selectedGenre.label}${selectedSubGenre ? ' > ' + selectedSubGenre.label : ''}`
    : '장르 미선택'

  const checkApiKey = () => {
    if (!isApiReady()) {
      setError('API 키가 설정되지 않았습니다.')
      return false
    }
    return true
  }

  const handleGenerateMetadata = async () => {
    if (!checkApiKey()) return
    clearError()
    setLoadingMeta(true)
    try {
      const meta = await generateYoutubeMetadata(scriptText, continuityBible || {}, genreLabel)
      setMetadata(meta)
    } catch (err) {
      setError('메타데이터 생성 실패: ' + err.message)
    } finally {
      setLoadingMeta(false)
    }
  }

  const handleGenerateBGM = async () => {
    if (!checkApiKey()) return
    clearError()
    setLoadingBGM(true)
    try {
      const bgm = await generateGlobalBGM(scriptText, genreLabel)
      setBGM(bgm)
    } catch (err) {
      setError('BGM 생성 실패: ' + err.message)
    } finally {
      setLoadingBGM(false)
    }
  }

  const handleGenerateMultiBGM = async () => {
    if (!checkApiKey() || scenes.length === 0) return
    clearError()
    setLoadingMultiBGM(true)
    try {
      const tracks = await generateMultiTrackBGM(scenes)
      setMultiTrackBGM(tracks)
    } catch (err) {
      setError('멀티트랙 BGM 생성 실패: ' + err.message)
    } finally {
      setLoadingMultiBGM(false)
    }
  }

  const handleGenerateThumbnails = async () => {
    if (!checkApiKey()) return
    clearError()
    setLoadingThumbs(true)
    try {
      // Use first scene with image as base, or generate from bible
      const mainPrompt = scenes.find(s => s.imagePrompt)?.imagePrompt ||
        `${continuityBible?.characters?.[0]?.visualPrompt || 'Main character'} in a dramatic scene. ${style.prompt}`
      const thumbs = await generateThumbnail({ main: mainPrompt }, style, modelId)
      setThumbnails(thumbs)
    } catch (err) {
      setError('썸네일 생성 실패: ' + err.message)
    } finally {
      setLoadingThumbs(false)
    }
  }

  const handleExportZip = async () => {
    clearError()
    setExporting(true)
    try {
      await exportZip({
        scenes,
        shortsClips,
        introClips,
        thumbnails,
        continuityBible: continuityBible || {},
        youtubeMetadata,
        bgmData,
        multiTrackBGM,
        scriptText,
        characterImages: characterImages || {},
        selectedStyleId,
      })
    } catch (err) {
      setError('ZIP 내보내기 실패: ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  const zipContents = [
    scenes.filter(s => s.imageUrl).length > 0 && `씬 이미지 ${scenes.filter(s => s.imageUrl).length}장 (scenes/)`,
    shortsClips.filter(s => s.imageUrl).length > 0 && `쇼츠 클립 ${shortsClips.filter(s => s.imageUrl).length}장 (shorts/)`,
    introClips.filter(s => s.imageUrl).length > 0 && `인트로 클립 ${introClips.filter(s => s.imageUrl).length}장 (intro/)`,
    thumbnails.filter(t => t.imageUrl).length > 0 && `썸네일 ${thumbnails.filter(t => t.imageUrl).length}장 (thumbnails/)`,
    scenes.length > 0 && 'metadata/scenes.json',
    continuityBible && 'metadata/bible.json',
    youtubeMetadata && 'metadata/youtube_seo.json',
    bgmData && 'metadata/bgm.json',
    scriptText && 'script.txt',
    'report.html',
  ].filter(Boolean)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">내보내기</h1>
        <p className="text-gray-500 text-sm mt-1">YouTube SEO, BGM, 썸네일을 생성하고 전체를 ZIP으로 다운로드합니다.</p>
      </div>

      {error && (
        <div className="flex items-start gap-3 bg-red-950/40 border border-red-800/50 rounded-lg p-4 text-sm text-red-300">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button onClick={clearError} className="text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* YouTube Metadata */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-300 flex items-center gap-2">
            <Youtube size={16} className="text-red-500" />
            YouTube SEO 메타데이터
          </h2>
          <Button
            onClick={handleGenerateMetadata}
            loading={loadingMeta}
            variant={youtubeMetadata ? 'secondary' : 'primary'}
            size="sm"
          >
            {youtubeMetadata ? <><RefreshCw size={13} />재생성</> : '생성'}
          </Button>
        </div>

        {youtubeMetadata ? (
          <div className="space-y-4">
            {/* Titles */}
            <div>
              <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">제목 후보 3개</h3>
              <div className="space-y-2">
                {(youtubeMetadata.titles || []).map((title, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-4 py-3">
                    <span className="text-xs text-purple-500 font-bold flex-shrink-0">#{i + 1}</span>
                    <span className="flex-1 text-sm text-gray-200">{title}</span>
                    <CopyButton text={title} />
                  </div>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-gray-500 uppercase">설명란</h3>
                <CopyButton text={youtubeMetadata.description || ''} />
              </div>
              <div className="bg-gray-800/50 rounded-lg px-4 py-3 text-sm text-gray-400 leading-relaxed max-h-48 overflow-y-auto font-mono text-xs">
                {youtubeMetadata.description || ''}
              </div>
            </div>

            {/* Hashtags */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-gray-500 uppercase">해시태그</h3>
                <CopyButton text={(youtubeMetadata.hashtags || []).join(' ')} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(youtubeMetadata.hashtags || []).map((tag, i) => (
                  <span key={i} className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded-full">{tag}</span>
                ))}
              </div>
            </div>

            {/* Thumbnail texts */}
            {youtubeMetadata.thumbnailTexts?.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">썸네일 텍스트 후보</h3>
                <div className="flex gap-2 flex-wrap">
                  {youtubeMetadata.thumbnailTexts.map((text, i) => (
                    <div key={i} className="flex items-center gap-2 bg-yellow-900/30 border border-yellow-800/40 rounded-lg px-3 py-1.5">
                      <span className="text-sm font-bold text-yellow-300">{text}</span>
                      <CopyButton text={text} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-600 italic">메타데이터를 생성하면 YouTube 최적화 제목, 설명, 해시태그가 생성됩니다.</p>
        )}
      </div>

      {/* BGM */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-300 flex items-center gap-2">
            <Music size={16} className="text-purple-400" />
            BGM 프롬프트
          </h2>
          <div className="flex gap-2">
            <Button
              onClick={handleGenerateBGM}
              loading={loadingBGM}
              variant={bgmData ? 'secondary' : 'primary'}
              size="sm"
            >
              {bgmData ? '재생성' : '전체 BGM 생성'}
            </Button>
            {scenes.length > 0 && (
              <Button
                onClick={handleGenerateMultiBGM}
                loading={loadingMultiBGM}
                variant="secondary"
                size="sm"
              >
                멀티트랙
              </Button>
            )}
          </div>
        </div>

        {bgmData ? (
          <div className="space-y-4">
            {/* Global BGM card */}
            <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-base font-semibold text-gray-200">{bgmData.titleKo}</div>
                  <div className="text-sm text-gray-500">{bgmData.titleEn}</div>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <span className="text-xs bg-purple-900/60 text-purple-300 px-2 py-0.5 rounded-full">{bgmData.genre}</span>
                  <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">{bgmData.tempo}</span>
                </div>
              </div>
              <p className="text-xs text-gray-500">{bgmData.mood}</p>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-600">AI 음악 생성 프롬프트 (영어)</span>
                  <CopyButton text={bgmData.promptEn || ''} />
                </div>
                <div className="bg-gray-700/50 rounded-lg p-3 text-xs text-gray-400 font-mono leading-relaxed max-h-24 overflow-y-auto">
                  {bgmData.promptEn}
                </div>
              </div>
            </div>

            {/* Multi-track BGM */}
            {multiTrackBGM?.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">멀티트랙 ({multiTrackBGM.length}트랙)</h3>
                <div className="space-y-2">
                  {multiTrackBGM.map((track, i) => (
                    <div key={i} className="bg-gray-800/40 rounded-lg p-3 flex items-start gap-3">
                      <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded flex-shrink-0">{track.sceneRange}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-300">{track.titleKo}</div>
                        <div className="text-xs text-gray-600 mt-0.5">{track.mood} · {track.tempo}</div>
                      </div>
                      <CopyButton text={track.promptEn || ''} label="프롬프트" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-600 italic">BGM 생성 버튼을 클릭하면 Suno AI / Udio 등에 사용할 수 있는 음악 프롬프트가 생성됩니다.</p>
        )}
      </div>

      {/* Thumbnails */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-300 flex items-center gap-2">
            <Image size={16} className="text-blue-400" />
            썸네일 (3종)
          </h2>
          <Button
            onClick={handleGenerateThumbnails}
            loading={loadingThumbs}
            variant={thumbnails.length > 0 ? 'secondary' : 'primary'}
            size="sm"
          >
            {thumbnails.length > 0 ? '재생성' : '3종 썸네일 생성'}
          </Button>
        </div>

        {thumbnails.length > 0 ? (
          <div className="grid grid-cols-3 gap-3">
            {thumbnails.map((thumb, i) => (
              <div key={i} className="space-y-2">
                <div className="aspect-video bg-gray-800 rounded-lg overflow-hidden relative group">
                  {thumb.imageUrl ? (
                    <>
                      <img src={thumb.imageUrl} alt={thumb.label} className="w-full h-full object-cover" />
                      <a
                        href={thumb.imageUrl}
                        download={`thumbnail_${thumb.type}.png`}
                        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      >
                        <Download size={20} className="text-white" />
                      </a>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-red-500 text-xs text-center p-2">
                      {thumb.error || '생성 실패'}
                    </div>
                  )}
                </div>
                <div className="text-xs text-center text-gray-500">{thumb.label}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-600 italic">썸네일 3종 (드라마틱 / 포스터 / 클릭베이트 스타일)이 생성됩니다.</p>
        )}
      </div>

      {/* ZIP Export */}
      <div className="bg-gradient-to-br from-purple-950/40 to-gray-900 border border-purple-800/30 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-300 flex items-center gap-2">
          <Package size={16} className="text-purple-400" />
          전체 다운로드 (ZIP)
        </h2>

        {zipContents.length > 0 && (
          <div className="bg-gray-800/50 rounded-lg p-3 space-y-1">
            <p className="text-xs font-medium text-gray-500 mb-2">포함 내용:</p>
            {zipContents.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
                <Check size={10} className="text-emerald-500 flex-shrink-0" />
                {item}
              </div>
            ))}
          </div>
        )}

        <Button
          onClick={handleExportZip}
          loading={exporting}
          size="xl"
          className="w-full"
          disabled={zipContents.length === 0}
        >
          <Download size={20} />
          {exporting ? 'ZIP 생성 중...' : '전체 다운로드 (ZIP)'}
        </Button>
      </div>

      {/* Navigation */}
      <div className="flex justify-start pt-2">
        <Button variant="secondary" onClick={() => setStep(4)}>
          <ChevronLeft size={16} />
          이전: 씬 생성
        </Button>
      </div>
    </div>
  )
}
