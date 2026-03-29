import { useState, useEffect } from 'react'
import { Eye, EyeOff, Key, Trash2, CheckCircle, AlertCircle, Zap } from 'lucide-react'
import Modal from './ui/Modal.jsx'
import Button from './ui/Button.jsx'
import {
  getApiKey, saveApiKey, removeApiKey, hasApiKey,
  getVertexJson, saveVertexJson, removeVertexJson, hasVertexJson, getApiMode, setApiMode,
  getZImageToken, saveZImageToken, removeZImageToken, hasZImageToken,
} from '../api/gemini.js'

function validateApiKey(key) {
  if (!key) return { valid: false, message: 'API 키를 입력하세요.' }
  if (!key.startsWith('AIza')) return { valid: false, message: 'Gemini API 키는 "AIza"로 시작해야 합니다.' }
  if (key.length < 35 || key.length > 45) return { valid: false, message: 'API 키 길이가 올바르지 않습니다 (35-45자).' }
  return { valid: true, message: '유효한 형식의 API 키입니다.' }
}

const TABS = [
  { id: 'gemini', label: 'Gemini API' },
  { id: 'vertex', label: 'Vertex AI' },
  { id: 'zimage', label: 'Z-Image (KIE AI)' },
]

export default function ApiKeyModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('gemini')

  // Gemini tab
  const [inputKey, setInputKey]     = useState('')
  const [showKey, setShowKey]       = useState(false)
  const [saved, setSaved]           = useState(false)
  const [validation, setValidation] = useState(null)

  // Vertex tab
  const [vertexJson, setVertexJson]     = useState('')
  const [vertexSaved, setVertexSaved]   = useState(false)
  const [vertexError, setVertexError]   = useState(null)
  const [apiMode, setApiModeState]      = useState('gemini')

  // Z-Image tab
  const [zToken, setZToken]     = useState('')
  const [showZToken, setShowZToken] = useState(false)
  const [zSaved, setZSaved]     = useState(false)

  useEffect(() => {
    if (isOpen) {
      const existing = getApiKey()
      if (existing) { setInputKey(existing); setValidation(validateApiKey(existing)) }
      else { setInputKey(''); setValidation(null) }
      setSaved(false)

      const vJson = getVertexJson()
      setVertexJson(vJson ? JSON.stringify(vJson, null, 2) : '')
      setVertexSaved(false)
      setVertexError(null)
      setApiModeState(getApiMode())

      const tok = getZImageToken()
      setZToken(tok || '')
      setZSaved(false)
    }
  }, [isOpen])

  // ── Gemini handlers ──────────────────────────────────────────────────────
  const handleChange = (e) => {
    const val = e.target.value.trim()
    setInputKey(val)
    setSaved(false)
    setValidation(val ? validateApiKey(val) : null)
  }

  const handleSave = () => {
    const result = validateApiKey(inputKey)
    if (!result.valid) { setValidation(result); return }
    saveApiKey(inputKey)
    setSaved(true)
    setTimeout(() => onClose(), 800)
  }

  const handleDelete = () => {
    removeApiKey()
    setInputKey('')
    setValidation(null)
    setSaved(false)
  }

  // ── Vertex handlers ──────────────────────────────────────────────────────
  const handleVertexSave = () => {
    try {
      const parsed = JSON.parse(vertexJson)
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        setVertexError('project_id, client_email, private_key 필드가 필요합니다.')
        return
      }
      saveVertexJson(parsed)
      setApiMode('vertex')
      setApiModeState('vertex')
      setVertexSaved(true)
      setVertexError(null)
      setTimeout(() => onClose(), 800)
    } catch {
      setVertexError('유효한 JSON 형식이 아닙니다.')
    }
  }

  const handleVertexDelete = () => {
    removeVertexJson()
    setVertexJson('')
    setVertexSaved(false)
    setVertexError(null)
    if (apiMode === 'vertex') { setApiMode('gemini'); setApiModeState('gemini') }
  }

  const handleSwitchMode = (mode) => {
    setApiMode(mode)
    setApiModeState(mode)
  }

  // ── Z-Image handlers ─────────────────────────────────────────────────────
  const handleZSave = () => {
    if (!zToken.trim()) return
    saveZImageToken(zToken.trim())
    setZSaved(true)
    setTimeout(() => onClose(), 800)
  }

  const handleZDelete = () => {
    removeZImageToken()
    setZToken('')
    setZSaved(false)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="API 설정">
      {/* Tab bar */}
      <div className="flex gap-1 mb-5 bg-gray-800/60 rounded-lg p-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 text-xs py-2 px-2 rounded-md font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-purple-700 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Gemini Tab ── */}
      {activeTab === 'gemini' && (
        <div className="space-y-4">
          <div className="bg-blue-950/40 border border-blue-800/50 rounded-lg p-4 text-sm text-blue-300">
            <p className="font-medium mb-1">Gemini API 키 설정</p>
            <p className="text-blue-400/80">
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-200">
                Google AI Studio
              </a>
              에서 발급받은 Gemini API 키를 입력하세요.
            </p>
            <p className="text-blue-400/60 mt-1 text-xs">API 키는 브라우저 localStorage에만 저장되며 외부로 전송되지 않습니다.</p>
          </div>

          {apiMode === 'vertex' && (
            <div className="bg-amber-950/30 border border-amber-700/50 rounded-lg p-3 text-xs text-amber-300 flex items-center gap-2">
              <AlertCircle size={13} />
              현재 Vertex AI 모드입니다.
              <button onClick={() => handleSwitchMode('gemini')} className="underline hover:text-amber-100 ml-auto">Gemini 모드로 전환</button>
            </div>
          )}

          <div className="relative">
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              <Key size={14} className="inline mr-1" />
              API 키
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={inputKey}
                onChange={handleChange}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="AIza..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 pr-10 text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm font-mono"
              />
              <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {validation && (
              <div className={`mt-1.5 flex items-center gap-1.5 text-xs ${validation.valid ? 'text-emerald-400' : 'text-red-400'}`}>
                {validation.valid ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                {validation.message}
              </div>
            )}
          </div>

          {hasApiKey() && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <CheckCircle size={12} className="text-emerald-500" />
              현재 API 키가 저장되어 있습니다
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="primary" onClick={handleSave} loading={saved} disabled={!inputKey || (validation && !validation.valid)} className="flex-1">
              {saved ? '저장됨!' : '저장'}
            </Button>
            {hasApiKey() && (
              <Button variant="danger" onClick={handleDelete} title="API 키 삭제">
                <Trash2 size={16} />
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>취소</Button>
          </div>
        </div>
      )}

      {/* ── Vertex AI Tab ── */}
      {activeTab === 'vertex' && (
        <div className="space-y-4">
          <div className="bg-blue-950/40 border border-blue-800/50 rounded-lg p-4 text-sm text-blue-300">
            <p className="font-medium mb-1">Vertex AI 서비스 계정 JSON</p>
            <p className="text-blue-400/80 text-xs">Google Cloud Console에서 서비스 계정 JSON 키를 발급받아 붙여넣으세요. (project_id, client_email, private_key 필드 포함)</p>
          </div>

          {apiMode === 'vertex' && (
            <div className="bg-emerald-950/30 border border-emerald-700/50 rounded-lg p-2 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle size={13} />
              현재 Vertex AI 모드로 동작 중입니다.
              <button onClick={() => handleSwitchMode('gemini')} className="underline hover:text-emerald-100 ml-auto">Gemini 모드로 전환</button>
            </div>
          )}

          <textarea
            value={vertexJson}
            onChange={e => { setVertexJson(e.target.value); setVertexSaved(false); setVertexError(null) }}
            placeholder={'{\n  "project_id": "...",\n  "client_email": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n..."\n}'}
            rows={10}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 text-xs font-mono resize-none"
          />

          {vertexError && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle size={12} />{vertexError}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button variant="primary" onClick={handleVertexSave} loading={vertexSaved} disabled={!vertexJson} className="flex-1">
              {vertexSaved ? '저장됨! (Vertex 모드 전환)' : 'Vertex JSON 저장 및 전환'}
            </Button>
            {hasVertexJson() && (
              <Button variant="danger" onClick={handleVertexDelete} title="Vertex JSON 삭제">
                <Trash2 size={16} />
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>취소</Button>
          </div>
        </div>
      )}

      {/* ── Z-Image Tab ── */}
      {activeTab === 'zimage' && (
        <div className="space-y-4">
          <div className="bg-purple-950/40 border border-purple-800/50 rounded-lg p-4 text-sm text-purple-300">
            <p className="font-medium mb-1 flex items-center gap-2">
              <Zap size={14} />
              KIE AI (Z-Image Turbo) 토큰
            </p>
            <p className="text-purple-400/80 text-xs">
              KIE AI에서 발급받은 Bearer 토큰을 입력하세요. 이미지 모델에서 "Z-Image Turbo" 선택 시 사용됩니다.
            </p>
            <p className="text-purple-400/60 mt-1 text-xs">토큰은 브라우저 localStorage에만 저장되며 외부로 전송되지 않습니다.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              <Key size={14} className="inline mr-1" />
              KIE AI Bearer 토큰
            </label>
            <div className="relative">
              <input
                type={showZToken ? 'text' : 'password'}
                value={zToken}
                onChange={e => { setZToken(e.target.value); setZSaved(false) }}
                onKeyDown={e => e.key === 'Enter' && handleZSave()}
                placeholder="Bearer 토큰을 붙여넣으세요..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 pr-10 text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm font-mono"
              />
              <button type="button" onClick={() => setShowZToken(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showZToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {hasZImageToken() && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <CheckCircle size={12} className="text-emerald-500" />
              Z-Image 토큰이 저장되어 있습니다
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="primary" onClick={handleZSave} loading={zSaved} disabled={!zToken.trim()} className="flex-1">
              {zSaved ? '저장됨!' : '저장'}
            </Button>
            {hasZImageToken() && (
              <Button variant="danger" onClick={handleZDelete} title="토큰 삭제">
                <Trash2 size={16} />
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>취소</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
