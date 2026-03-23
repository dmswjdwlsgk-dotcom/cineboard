import { useEffect, useState } from 'react'
import { X, Check, RefreshCw } from 'lucide-react'
import { generateSceneImage } from '../api/imageApi.js'
import Spinner from './ui/Spinner.jsx'

const SAMPLE_PROMPT = 'A Korean woman in traditional hanbok, standing in a palace courtyard at night, moonlight, emotional expression'
const CACHE_PREFIX = 'style_preview_'

export default function StylePreviewModal({ style, onClose, onSelect }) {
  const [imageUrl, setImageUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!style) return
    const cached = localStorage.getItem(CACHE_PREFIX + style.id)
    if (cached) {
      setImageUrl(cached)
    } else {
      generatePreview()
    }
  }, [style?.id])

  const generatePreview = async () => {
    setLoading(true)
    setError(null)
    try {
      const url = await generateSceneImage(SAMPLE_PROMPT, style, '16:9', 0)
      setImageUrl(url)
      localStorage.setItem(CACHE_PREFIX + style.id, url)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!style) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <img src={style.thumbnail} alt={style.label} className="w-12 h-8 object-cover rounded-lg flex-shrink-0" />
            <div>
              <h2 className="text-base font-bold text-gray-100">{style.label}</h2>
              <p className="text-xs text-gray-500 mt-0.5">화풍 미리보기</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Image area */}
        <div className="relative aspect-video bg-gray-950">
          <img
            src={style.thumbnail}
            alt={style.label}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Color palette */}
        <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-2">
          <span className="text-xs text-gray-600">팔레트</span>
          <div className="flex gap-1.5">
            {style.palette.map((color, i) => (
              <div
                key={i}
                className="w-5 h-5 rounded-full border border-gray-700/60"
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-700 text-sm text-gray-400 hover:bg-gray-800 transition-colors"
          >
            닫기
          </button>
          <button
            onClick={() => { onSelect(style.id); onClose() }}
            className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors"
          >
            <Check size={15} />
            이 스타일 선택
          </button>
        </div>
      </div>
    </div>
  )
}
