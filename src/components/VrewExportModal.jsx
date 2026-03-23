import { useState } from 'react'
import { X, Film, Type, Zap, Download, Info } from 'lucide-react'
import { useAppStore } from '../store/useAppStore.js'
import { exportVrew } from '../utils/exportVrew.js'
import Spinner from './ui/Spinner.jsx'

const CAPTION_PRESETS = [
  { id: 'cinematic', label: '시네마틱', desc: '흰색 텍스트, 하단 자막', preview: 'text-white' },
  { id: 'youtube_shorts', label: '쇼츠', desc: '노란 텍스트, 중앙 강조', preview: 'text-yellow-400' },
  { id: 'documentary', label: '다큐', desc: '흰색 텍스트, 반투명 배경', preview: 'text-gray-200' },
]

export default function VrewExportModal({ isOpen, onClose }) {
  const { scenes, aspectRatio } = useAppStore()
  const [editMode, setEditMode] = useState('split')
  const [captionPreset, setCaptionPreset] = useState('cinematic')
  const [enableAnimation, setEnableAnimation] = useState(true)
  const [maxChars, setMaxChars] = useState(35)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState(null)

  const scenesWithImages = scenes.filter(s => s.imageUrl)

  if (!isOpen) return null

  const handleExport = async () => {
    if (scenesWithImages.length === 0) {
      setError('이미지가 생성된 씬이 없습니다. 씬 생성 후 다시 시도해주세요.')
      return
    }
    setExporting(true)
    setError(null)
    try {
      await exportVrew(scenesWithImages, {
        editMode,
        maxCharsPerClip: maxChars,
        captionPreset,
        enableAnimation,
        aspectRatio,
        smartMerge: true,
      })
      onClose()
    } catch (err) {
      setError('내보내기 실패: ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <Film size={14} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-100">Vrew 내보내기</h2>
              <p className="text-xs text-gray-500">.vrew 파일로 다운로드</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* 씬 수 안내 */}
          <div className="flex items-center gap-2 bg-blue-950/30 border border-blue-900/50 rounded-lg px-3 py-2">
            <Info size={13} className="text-blue-400 flex-shrink-0" />
            <span className="text-xs text-blue-300">
              이미지 생성된 씬 <strong>{scenesWithImages.length}개</strong> / 전체 {scenes.length}개 포함됩니다.
            </span>
          </div>

          {/* 클립 분할 모드 */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
              <Type size={12} />
              클립 분할 모드
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'split', label: '문장 단위', desc: '권장 · 자연스러운 분할' },
                { id: 'single', label: '단일 클립', desc: '씬당 하나의 클립' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setEditMode(opt.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    editMode === opt.id
                      ? 'bg-blue-900/40 border-blue-600 text-blue-200'
                      : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  <div className="text-xs font-semibold">{opt.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 자막 최대 글자수 (문장 분할 모드에서만) */}
          {editMode === 'split' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">자막 최대 글자수</label>
                <span className="text-sm font-mono text-blue-300">{maxChars}자</span>
              </div>
              <input
                type="range"
                min={15}
                max={60}
                step={5}
                value={maxChars}
                onChange={e => setMaxChars(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-600">
                <span>15자</span>
                <span>35자 (기본)</span>
                <span>60자</span>
              </div>
            </div>
          )}

          {/* Ken Burns 애니메이션 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={13} className="text-yellow-500" />
              <div>
                <div className="text-xs font-semibold text-gray-300">Ken Burns 애니메이션</div>
                <div className="text-xs text-gray-500">이미지에 줌/이동 효과 적용</div>
              </div>
            </div>
            <button
              onClick={() => setEnableAnimation(v => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors ${enableAnimation ? 'bg-yellow-500' : 'bg-gray-700'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${enableAnimation ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {/* 자막 스타일 */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">자막 스타일</label>
            <div className="grid grid-cols-3 gap-2">
              {CAPTION_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => setCaptionPreset(preset.id)}
                  className={`p-2.5 rounded-xl border text-center transition-all ${
                    captionPreset === preset.id
                      ? 'bg-gray-700 border-blue-600'
                      : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className={`text-sm font-bold mb-0.5 ${preset.preview}`}>가나다</div>
                  <div className="text-xs text-gray-300 font-medium">{preset.label}</div>
                  <div className="text-xs text-gray-600 mt-0.5 leading-tight">{preset.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 pt-0 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || scenesWithImages.length === 0}
            className="flex-2 flex-[2] flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            {exporting ? (
              <><Spinner size="sm" />내보내는 중...</>
            ) : (
              <><Download size={15} />.vrew 다운로드</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
