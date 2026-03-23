import { useState, useEffect } from 'react'
import { Eye, EyeOff, Key, Trash2, CheckCircle, AlertCircle } from 'lucide-react'
import Modal from './ui/Modal.jsx'
import Button from './ui/Button.jsx'
import { getApiKey, saveApiKey, removeApiKey, hasApiKey } from '../api/gemini.js'

function validateApiKey(key) {
  if (!key) return { valid: false, message: 'API 키를 입력하세요.' }
  if (!key.startsWith('AIza')) return { valid: false, message: 'Gemini API 키는 "AIza"로 시작해야 합니다.' }
  if (key.length < 35 || key.length > 45) return { valid: false, message: 'API 키 길이가 올바르지 않습니다 (35-45자).' }
  return { valid: true, message: '유효한 형식의 API 키입니다.' }
}

export default function ApiKeyModal({ isOpen, onClose }) {
  const [inputKey, setInputKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [validation, setValidation] = useState(null)

  useEffect(() => {
    if (isOpen) {
      const existing = getApiKey()
      if (existing) {
        setInputKey(existing)
        setValidation(validateApiKey(existing))
      } else {
        setInputKey('')
        setValidation(null)
      }
      setSaved(false)
    }
  }, [isOpen])

  const handleChange = (e) => {
    const val = e.target.value.trim()
    setInputKey(val)
    setSaved(false)
    if (val) {
      setValidation(validateApiKey(val))
    } else {
      setValidation(null)
    }
  }

  const handleSave = () => {
    const result = validateApiKey(inputKey)
    if (!result.valid) {
      setValidation(result)
      return
    }
    saveApiKey(inputKey)
    setSaved(true)
    setTimeout(() => {
      onClose()
    }, 800)
  }

  const handleDelete = () => {
    removeApiKey()
    setInputKey('')
    setValidation(null)
    setSaved(false)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="API Key 설정">
      <div className="space-y-4">
        {/* Info box */}
        <div className="bg-blue-950/40 border border-blue-800/50 rounded-lg p-4 text-sm text-blue-300">
          <p className="font-medium mb-1">Gemini API 키 설정</p>
          <p className="text-blue-400/80">
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-200"
            >
              Google AI Studio
            </a>
            에서 발급받은 Gemini API 키를 입력하세요.
          </p>
          <p className="text-blue-400/60 mt-1 text-xs">
            API 키는 브라우저 localStorage에만 저장되며 외부로 전송되지 않습니다.
          </p>
        </div>

        {/* Input */}
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
            <button
              type="button"
              onClick={() => setShowKey(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Validation message */}
          {validation && (
            <div className={`mt-1.5 flex items-center gap-1.5 text-xs ${validation.valid ? 'text-emerald-400' : 'text-red-400'}`}>
              {validation.valid ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
              {validation.message}
            </div>
          )}
        </div>

        {/* Current status */}
        {hasApiKey() && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <CheckCircle size={12} className="text-emerald-500" />
            현재 API 키가 저장되어 있습니다
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saved}
            disabled={!inputKey || (validation && !validation.valid)}
            className="flex-1"
          >
            {saved ? '저장됨!' : '저장'}
          </Button>
          {hasApiKey() && (
            <Button
              variant="danger"
              onClick={handleDelete}
              title="API 키 삭제"
            >
              <Trash2 size={16} />
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
        </div>
      </div>
    </Modal>
  )
}
