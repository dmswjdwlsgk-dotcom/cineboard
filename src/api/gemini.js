import { GoogleGenAI } from '@google/genai'
import { HarmCategory, HarmBlockThreshold } from '@google/genai'

// ─── 스토리지 키 ───────────────────────────────────────────────────────────────
const API_KEY_STORAGE  = 'cineboard_user_gemini_api_key'
const API_MODE_STORAGE = 'cineboard_api_mode'
const VERTEX_JSON_KEY  = 'cineboard_vertex_json'

// ─── API 키 관리 ───────────────────────────────────────────────────────────────
export function getApiKey() {
  try {
    const encoded = localStorage.getItem(API_KEY_STORAGE)
    if (!encoded) return null
    const key = atob(encoded).trim()
    if (key.length < 30 || key.length > 50) return null
    if (!key.startsWith('AIza')) return null
    if (!/^[A-Za-z0-9_-]+$/.test(key)) return null
    return key
  } catch {
    return null
  }
}

export function saveApiKey(key) {
  if (key) {
    try {
      localStorage.setItem(API_KEY_STORAGE, btoa(key.trim()))
    } catch (e) {
      console.error('[API_KEY] Failed to save:', e)
    }
  }
}

export function removeApiKey() {
  localStorage.removeItem(API_KEY_STORAGE)
}

export function hasApiKey() {
  return !!getApiKey()
}

// ─── API 모드 (gemini / vertex) ────────────────────────────────────────────────
export function getApiMode() {
  return localStorage.getItem(API_MODE_STORAGE) || 'gemini'
}

export function setApiMode(mode) {
  localStorage.setItem(API_MODE_STORAGE, mode)
}

// ─── Vertex AI JSON ────────────────────────────────────────────────────────────
export function getVertexJson() {
  try {
    const raw = localStorage.getItem(VERTEX_JSON_KEY)
    if (!raw) return null
    try {
      return JSON.parse(decodeURIComponent(atob(raw)))
    } catch {
      try {
        const parsed = JSON.parse(raw)
        if (parsed.project_id) { saveVertexJson(parsed); return parsed }
      } catch {}
    }
  } catch (e) {
    console.error('[VERTEX] Failed to read JSON:', e)
  }
  return null
}

export function saveVertexJson(json) {
  try {
    localStorage.setItem(VERTEX_JSON_KEY, btoa(encodeURIComponent(JSON.stringify(json))))
  } catch (e) {
    console.error('[VERTEX] Failed to save JSON:', e)
  }
}

export function removeVertexJson() {
  localStorage.removeItem(VERTEX_JSON_KEY)
}

export function hasVertexJson() {
  return !!localStorage.getItem(VERTEX_JSON_KEY)
}

// ─── Vertex AI JWT / 액세스 토큰 ──────────────────────────────────────────────
let _vertexToken = null
let _vertexTokenExpiry = 0

function base64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function getVertexAccessToken(serviceAccount) {
  if (_vertexToken && Date.now() < _vertexTokenExpiry - 60000) return _vertexToken

  const header  = { alg: 'RS256', typ: 'JWT' }
  const now     = Math.floor(Date.now() / 1000)
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  }

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`

  const pemClean = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\n/g, '').replace(/\r/g, '')

  const binary  = atob(pemClean)
  const keyData = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) keyData[i] = binary.charCodeAt(i)

  const key = await crypto.subtle.importKey(
    'pkcs8', keyData.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig     = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const jwt     = `${unsigned}.${base64url(String.fromCharCode(...new Uint8Array(sig)))}`

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Vertex token error: ${JSON.stringify(data)}`)

  _vertexToken       = data.access_token
  _vertexTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000
  return _vertexToken
}

// ─── fetch 인터셉터 (Vertex mode: x-goog-api-key 헤더 제거) ──────────────────
let _fetchPatched = false
function patchFetch() {
  if (_fetchPatched) return
  _fetchPatched = true
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.toString()
      : input.url
    if (url.includes('aiplatform.googleapis.com')) {
      if (init?.headers) {
        if (init.headers instanceof Headers) init.headers.delete('x-goog-api-key')
        else if (Array.isArray(init.headers)) {
          init.headers = init.headers.filter(([k]) => k.toLowerCase() !== 'x-goog-api-key')
        } else if (typeof init.headers === 'object') {
          delete init.headers['x-goog-api-key']
          delete init.headers['X-Goog-Api-Key']
        }
      }
    }
    return original(input, init)
  }
}

// ─── 클라이언트 생성 ───────────────────────────────────────────────────────────
export async function createClient() {
  if (getApiMode() === 'vertex') {
    const sa = getVertexJson()
    if (!sa) throw new Error('Vertex AI 서비스 계정 JSON이 등록되지 않았습니다.\n우측 상단 API 설정에서 등록해주세요.')
    const token  = await getVertexAccessToken(sa)
    const region = 'us-central1'
    patchFetch()
    return new GoogleGenAI({
      apiKey: 'VERTEX_MODE',
      httpOptions: {
        baseUrl:    `https://${region}-aiplatform.googleapis.com`,
        apiVersion: `v1beta1/projects/${sa.project_id}/locations/${region}/publishers/google`,
        headers:    { Authorization: `Bearer ${token}` },
      },
    })
  }

  const key = getApiKey()
  if (!key) throw new Error('API 키가 설정되지 않았습니다.\n우측 상단 API Key 버튼을 눌러 키를 입력해주세요.')
  return new GoogleGenAI({ apiKey: key })
}

// ─── 안전 설정 ────────────────────────────────────────────────────────────────
export const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH',        threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',  threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT',  threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY',    threshold: 'BLOCK_NONE' },
]

// ─── 안전 fallback 포함 generateContent 래퍼 ─────────────────────────────────
export async function safeGenerate(client, params, label) {
  const sanitize = (contents, level) => {
    const risky = /(bows respectfully|arrogant|looking down at|submissive|kneeling|begging|crying|trembling|굴복|절|무릎|아래로|거만한|내려다보는|굽신|slap|slaps|slapping|hit|punch|strike|assault|attack|strangle|choke|throw|shove|grab|뺨을|밀치|때리|치다|폭력|대치|공격|던지|부수|멱살|목을 졸|blood|kill|murder|violenc|violent|weapon|knife|gun|sword|dead|death|dying|dies|deceased|corpse|lifeless|postpartum|fever|newborn|infant|baby being born|childbirth|giving birth|scream|terror|fear|fury|angry|anger|피|죽이|살해|무기|칼|총|검|비명|공포|두려움|분노|격노|화내|죽음|시체|참혹|산욕|임종|숨을 거두|세상을 떠|갓난|신생아|출산|해산)/gi
    const safe = t => t.replace(risky, 'solemn historical moment')
    const suffix = `\n[Safe Level ${level}: static theatrical portrait. Hash: ${Math.random().toString(36).slice(7)}]`
    if (typeof contents === 'string') return safe(contents) + suffix
    if (contents?.parts) return { ...contents, parts: [...contents.parts.map(p => p.text ? { ...p, text: safe(p.text) } : p), { text: suffix }] }
    return contents
  }

  for (let level = 1; level <= 3; level++) {
    try {
      const p = level === 1 ? params : { ...params, contents: sanitize(params.contents, level) }
      if (level > 1) console.warn(`[SAFETY FALLBACK L${level}] ${label}`)
      const res = await client.models.generateContent(p)
      if (res?.candidates?.length) return res
      if (level < 3) continue
    } catch (err) {
      const msg = err.message || ''
      if ((msg.toLowerCase().includes('safety') || msg.includes('blocked') || msg.includes('RECITATION') || msg.includes('EMPTY_RESPONSE')) && level < 3) continue
      throw err
    }
  }
  return null
}

// ─── 재시도 래퍼 (원본 Le 함수 이식) ─────────────────────────────────────────
export async function withRetry(fn, maxRetries = 3, label = 'API') {
  let lastErr
  let retries = maxRetries
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg    = err.message || ''
      const status = err.status || err.httpStatusCode || 0

      if (msg.includes('API 키') || msg.includes('PERMISSION_DENIED') || msg.includes('UNAUTHENTICATED')) throw err

      const is429 = status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
      const isTokenLimit = is429 && (msg.includes('token') || msg.includes('Token') || msg.includes('input_token') || msg.includes('output_token'))
      const isContextLimit = msg.includes('context') && (msg.includes('length') || msg.includes('exceeded') || msg.includes('limit'))
      const isDailyLimit = msg.includes('GenerateContent request count per day') || (msg.includes('PerDay') && msg.includes('quota'))

      if (isContextLimit) { console.error(`[CONTEXT LIMIT] ${label}`); throw err }
      if (isDailyLimit)   { console.error(`[DAILY LIMIT] ${label}`);   throw err }

      const is503 = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('overloaded')
      const isRateLimit = is429 && !isTokenLimit && !isContextLimit

      // 재시도 횟수 자동 확장
      if ((is503 || isRateLimit) && retries < 5) {
        retries = 5
        console.warn(`[RESILIENCE] ${label} — 재시도 횟수 확장: ${maxRetries} → ${retries}`)
      }

      if (attempt >= retries) { console.error(`[RETRY FAILED] ${label} after ${retries} attempts`); throw err }

      if (isRateLimit) {
        const wait = attempt * 30000
        console.warn(`[RATE LIMIT] ${label} — ${wait / 1000}초 대기 (${attempt}/${retries})`)
        await new Promise(r => setTimeout(r, wait))
      } else if (is503) {
        console.warn(`[SERVER OVERLOAD] ${label} — 10초 대기 (${attempt}/${retries})`)
        await new Promise(r => setTimeout(r, 10000))
      } else {
        const wait = Math.pow(2, attempt - 1) * 1000
        await new Promise(r => setTimeout(r, wait))
      }
    }
  }
  throw lastErr
}

// ─── 타임아웃 래퍼 ────────────────────────────────────────────────────────────
export function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`[TIMEOUT] ${label} — ${ms / 1000}초 초과`)), ms)),
  ])
}

// ─── JSON 파싱 헬퍼 ───────────────────────────────────────────────────────────
export function parseJson(text, label, fallback) {
  let raw = (text || '').trim()
  const block = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (block) raw = block[1]
  raw = raw.replace(/^[^{[]+/, '').replace(/[^}\]]+$/, '')
  try {
    return JSON.parse(raw)
  } catch {
    console.error(`[JSON PARSE ERROR] ${label}: ${(text || '').slice(0, 100)}`)
    if (Array.isArray(fallback)) {
      try {
        const s = raw.indexOf('['), e = raw.lastIndexOf('}')
        if (s !== -1 && e !== -1 && s < e) {
          const recovered = JSON.parse(raw.substring(s, e + 1) + ']')
          if (Array.isArray(recovered) && recovered.length > 0) {
            console.warn(`[JSON REPAIR] Recovered ${recovered.length} items`)
            return recovered
          }
        }
      } catch {}
    }
    return fallback
  }
}
