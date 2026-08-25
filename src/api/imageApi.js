import { createClient, SAFETY_SETTINGS, withRetry, safeGenerate, withTimeout, getZImageToken, resolveModelId } from './gemini.js'
import { detectLanguage } from '../data/languages.js'

const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image'

// 정보 상자/말풍선/그래프 라벨처럼 이미지 안 텍스트가 스타일 핵심인 스타일들 —
// 기본 "텍스트 절대 금지" 규칙에서 제외한다.
const TEXT_ALLOWED_STYLE_IDS = new Set(['issue_youtube', 'bright_info'])

// ─── 왕족 복식 판별 — 왕(익선관/곤룡포)과 왕비/대비(활옷·원삼/봉황)를 구분 ─────
// 이전엔 "왕비"도 "왕"에 포함돼 매칭되면서 왕 전용 익선관+곤룡포를 왕비한테도
// 그대로 붙이던 버그가 있었음 — 여성 왕족 키워드를 먼저 검사해 분리한다.
//
// ⚠️ 익선관·곤룡포·활옷·원삼은 한국 왕조 전용 복식이다. 그런데 왕족 키워드만 보고
// 태그를 붙이다 보니 세계사 대본에도 조선 관복이 붙는 사고가 났다("세 종교는 어디서
// 갈라졌나" 대본 — 콘스탄티누스 황제, 에드워드 1세, 필리프 4세가 전부 곤룡포 차림으로
// 생성됨). 원인이 두 겹이었다:
//   (1) 왕(?!비|후)가 "왕국/왕조/왕권"의 왕까지 매칭 — 왕이 등장하지도 않는 씬에 태그가 붙음
//   (2) 매칭되면 시대·지역 판별 없이 무조건 한국 복식을 지정
// 애매한 호칭(왕/대왕/황제/king/queen)은 한국 왕조 맥락이 확인될 때만 태그를 붙이고,
// 외국 군주 신호가 있으면 붙이지 않는다. 한국 전용 호칭(세자/임금/전하/주상/중전 등)은
// 그 자체가 한국 맥락이므로 그대로 통과시킨다.

// 한국에서만 쓰는 왕실 호칭 — 이것만으로 한국 맥락이 확정된다
// ⚠️ 여기 있는 호칭은 한국 맥락 확인 없이 곧바로 조선 복식을 확정시킨다. 그래서
//    일반명사·다른 문화권과 겹치는 단어를 넣으면 안 된다. 실측(손자병법 대본):
//      임금 11회 — "제나라 임금", "임금의 명이라도" (고전 번역의 일반 군주 호칭)
//      대군  4회 — "십만 대군"(大軍)이지 대군(大君)이 아니다
//      전하  3회 — "자료마다 다르게 전하는데"
//    셋 다 빼고 한국 왕조에서만 쓰는 호칭만 남긴다. 넘어간 호칭은 AMBIG_KING에서
//    한국 맥락이 확인될 때만 태그가 붙는다. (c40828e에서 languages.js에 적용한 것과
//    같은 정리 — 그때 imageApi.js가 누락됐다.)
const KR_ONLY_KING  = /(?<!납)세자|주상|상왕|대군마마|중전마마/i
const KR_ONLY_QUEEN = /왕비|중전|왕후|대비|빈궁|후궁/i
// 여러 문화권에 공통인 호칭 — 한국 맥락이 따로 확인돼야 한다
const AMBIG_KING    = /왕(?!비|후|국|조|권|좌|위|실|족|가)|대왕|황제|임금|국왕|전하(?![는죠지고며])|\bking\b|crown prince|emperor/i
const AMBIG_QUEEN   = /황후|\bqueen\b|empress/i
// 한국 왕조 맥락 신호
const KOREAN_CONTEXT = /조선|고려|신라|백제|고구려|발해|가야|대한제국|한양|도성|경복궁|창덕궁|한복|사극|양반|사대부|joseon|goryeo|silla|korean|minhwa|hanbok|sageuk/i
// 외국 군주 신호 — 있으면 한국 복식을 붙이지 않는다
const FOREIGN_MONARCH = /로마|비잔틴|스페인|프랑스|영국|잉글랜드|독일|오스트리아|러시아|오스만|투르크|술탄|파라오|이집트|바빌론|메소포타미아|페르시아|아시리아|유럽|중국|명나라|청나라|일본|막부|천황|쇼군|교황|차르|합스부르크|칼리프|무굴|\broman\b|\bbyzantine\b|spanish|french|english|british|german|ottoman|sultan|pharaoh|\bpope\b|\btsar\b|caliph|mughal|persian|babylon|mesopotam/i

const ROYAL_KEYWORDS = /왕(?!자녀|실)|세자|왕비|중전|왕후|대왕|황제|황후|임금|전하|주상|대비|상왕|\bking\b|\bqueen\b|crown prince/i

function getRoyalAttireTag(text) {
  const t = text || ''
  // 한국 전용 호칭이면 맥락 확인 없이 통과
  const krKing  = KR_ONLY_KING.test(t)
  const krQueen = KR_ONLY_QUEEN.test(t)
  let isQueen = krQueen
  let isKing  = !krQueen && krKing
  if (!isQueen && !isKing) {
    // 애매한 호칭 — 한국 맥락이 있고 외국 군주 신호가 없을 때만
    if (FOREIGN_MONARCH.test(t) || !KOREAN_CONTEXT.test(t)) return ''
    isQueen = AMBIG_QUEEN.test(t)
    isKing  = !isQueen && AMBIG_KING.test(t)
  }
  if (isQueen) {
    return ' [👑ROYALTY (QUEEN / QUEEN CONSORT / DOWAGER) — CONTEXT-DEPENDENT ATTIRE: In formal/official scenes (throne room, court, ceremonies) → 활옷(hwarot, ornate crimson ceremonial robe with wide sleeves) or 원삼(wonsam, formal court robe), richly embroidered with 봉황(phoenix) motifs in gold, elaborate ceremonial headdress (족두리 or 대수) with ornaments. ⚠️ NEVER 익선관 (that headwear is King-only) and NEVER 곤룡포 dragon robe (that is King-only attire). In private/informal scenes → elegant 당의(dangui) or formal hanbok appropriate to her rank. Use scene context to decide.]'
  }
  if (isKing) {
    return ' [👑ROYALTY (KING) — CONTEXT-DEPENDENT ATTIRE: In formal/official scenes (throne room, court, ceremonies) → 익선관(翼善冠, tall black dome cap, two small rear flaps) + 곤룡포(ENTIRELY VERMILLION RED dragon robe — ⚠️ ZERO blue fabric anywhere: NO blue inner sleeves, NO blue undershirt, NO blue visible at wrists or neckline — white inner collar ONLY). ⚠️ HAIR: ALL hair is completely hidden inside the 익선관 — NO hair visible hanging down outside the cap, NO flowing hair on sides or back. In private/informal/pre-coronation scenes → appropriate 평상복 or 도포. Use scene context to decide. When wearing royal headwear, it MUST be 익선관, NEVER 사모.]'
  }
  return ''
}

// ─── {{TEXT_LANG}} 플레이스홀더 치환 (텍스트가 그림 소재인 스타일 전용) ───────
// 대본 원문 언어를 감지해 스타일 프롬프트 속 이미지 내 텍스트 언어를 맞춘다.
// 해당 플레이스홀더가 없는 스타일(대부분)은 영향받지 않는다.
const TEXT_LANG_NAMES = {
  ko: '한국어(Korean)', en: '영어(English)', ja: '일본어(Japanese)', zh: '중국어(Chinese)',
  th: '태국어(Thai)', hi: '힌디어(Hindi)', ar: '아랍어(Arabic)', vi: '베트남어(Vietnamese)',
  es: '스페인어(Spanish)', pt: '포르투갈어(Portuguese)',
}

function resolveTextLangPlaceholder(stylePrompt, scriptSample) {
  if (!stylePrompt.includes('{{TEXT_LANG}}')) return stylePrompt
  const lang = detectLanguage(scriptSample || '')
  const langName = TEXT_LANG_NAMES[lang] || TEXT_LANG_NAMES.ko
  return stylePrompt.replaceAll('{{TEXT_LANG}}', langName)
}
const SMART_BACKOFF_MODELS = ['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image'] // 나노바나나 2 (라이트+일반) — 둘 다 동일한 429 이슈 확인됨
const ZIMAGE_API_BASE     = 'https://api.kie.ai/api/v1'
const ZIMAGE_UPLOAD_URL   = 'https://kieai.redpandaai.co/api/file-stream-upload'
const ZIMAGE_MAX_PROMPT   = 800

// 업로드 캐시 (2시간)
const _uploadCache = new Map()

// ─── 모델별 이미지 설정 ───────────────────────────────────────────────────────
function getImageConfig(model, aspectRatio) {
  const isPro    = model === 'gemini-3-pro-image'
  const isFlash2 = model === 'gemini-3.1-flash-image'
  return {
    aspectRatio,
    numberOfImages: 1,
    ...(isPro    ? { imageSize: '2K' } : {}),
    ...(isFlash2 ? { imageSize: '1K' } : {}),
  }
}

function getThinkingConfig(model) {
  return model === 'gemini-3-pro-image' ? { thinkingConfig: { thinkingBudget: 1024 } } : {}
}

function getTimeout(model) {
  return model === 'gemini-3-pro-image' ? 120000 : 60000
}

// ─── 고정 캐릭터 스타일 프롬프트 ─────────────────────────────────────────────
const FIXED_CHAR_PROMPTS = {
  countryball: `[🌐 COUNTRYBALL / POLANDBALL CHARACTER STYLE — MANDATORY]
⚠️ ALL characters in this scene MUST be rendered as PERFECTLY SPHERICAL BALLS with no exceptions.
[BODY SHAPE]: perfectly round sphere with flag pattern wrapping the entire surface. NO arms, NO legs attached to body — only very short thin black line limbs.
[EYES]: black sunglasses or large round white eyes with small black dot pupils. NO realistic eyes.
[LIMBS]: very short thin BLACK LINES protruding from the sphere sides (arms) and bottom (legs). Small black circles or ovals for hands and feet.
[CULTURAL ATTIRE]: Korea=Gat hat or Dobok, USA=Cowboy hat or top hat, Japan=Samurai kabuto or school uniform, UK=Bowler hat, China=Conical straw hat, France=Beret, Germany=Pickelhaube.
[ART STYLE]: 2D vector cartoon, clean bold black outlines, flat vibrant colors, minimal shading. NO photorealism. NO 3D rendering.
[SCENE ADAPTATION]: Countryball characters interact with environment props and objects normally. Objects remain realistic; ONLY characters are balls.`,

  stickman: `[🖊️ STICKMAN CHARACTER STYLE — MANDATORY]
⚠️ ALL characters in this scene MUST be rendered as classic STICK FIGURES.
[BODY]: simple circle head + straight vertical line body. NO detailed facial features except minimal dot eyes and simple curve smile/frown.
[LIMBS]: straight or slightly bent line arms and legs. Simple oval or mitten-shape hands. Simple oval feet.
[CLOTHING]: optional minimal color fill or simple geometric clothing shapes (colored rectangle for shirt, colored rectangle for pants).
[ART STYLE]: clean black lines on white or colored background, 2D flat illustration. Retro doodle/whiteboard aesthetic.
[SCENE ADAPTATION]: Stickman characters interact with fully detailed environments. Objects remain realistic; ONLY characters are stickmen.`,

  mascot: `[🐻 CUSTOM MASCOT STYLE — MANDATORY]
⚠️ ALL characters in this scene MUST be rendered in the EXACT visual style of the provided reference mascot character.
[STYLE LOCK]: Replicate the reference character's design precisely — same shape language, color palette, facial proportions, limb style, and overall art style. NO deviation.
[CONSISTENCY]: Every character in every scene must maintain identical visual design to the reference. Only poses and expressions change.
[ART STYLE]: Match the reference image exactly — whether it's flat vector, 3D render, watercolor, or any other style.`,

  chibi: `[🌸 CHIBI / SUPER-DEFORMED STYLE — MANDATORY]
⚠️ ALL characters in this scene MUST be rendered in CHIBI / SUPER-DEFORMED proportions.
[HEAD]: oversized head taking up 40-50% of total body height. Large expressive eyes (60-70% of face area). Tiny simple nose. Small mouth.
[BODY]: very short stubby body, tiny hands and feet. Maximum 2-3 head heights total.
[EXPRESSION]: exaggerated emotional expressions — huge sparkling eyes when happy, cross-shaped pupils when angry, waterfall tears when sad, sweat drops for embarrassment.
[ART STYLE]: clean anime line art, flat cel-shading, vibrant pastel colors, soft rounded shapes everywhere. NO realistic anatomy.
[SCENE ADAPTATION]: Chibi characters interact with normal-scale environments (making them appear even cuter by contrast).`,

  custom: `[🎨 CUSTOM REFERENCE STYLE — MANDATORY]
⚠️ ALL characters in this scene MUST be rendered in the EXACT visual style shown in the provided sample image.
[STYLE EXTRACTION]: Analyze the sample image carefully — replicate its art style, line weight, coloring technique, shading approach, and character design language precisely.
[CONSISTENCY]: Apply this extracted style uniformly to ALL characters in the scene. Maintain identical art style across all scenes.`,
}

function getFixedCharPrompt(fixedCharStyleType, fixedCharSampleImage) {
  const base = FIXED_CHAR_PROMPTS[fixedCharStyleType] || FIXED_CHAR_PROMPTS.countryball
  if ((fixedCharStyleType === 'custom' || fixedCharStyleType === 'mascot') && fixedCharSampleImage) {
    return base // 참조 이미지는 contents에 별도 삽입됨
  }
  return base
}

// ─── Z-Image: base64 → URL 업로드 ─────────────────────────────────────────────
async function uploadImageToZImage(base64DataUrl) {
  const cacheKey = base64DataUrl.slice(0, 100)
  const cached   = _uploadCache.get(cacheKey)
  if (cached && cached.expiry > Date.now()) return cached.url

  const token = getZImageToken()
  if (!token) throw new Error('Z-Image 토큰이 없습니다. API 설정에서 KIE AI 토큰을 입력해주세요.')

  const [header, data] = base64DataUrl.split(',')
  const mimeMatch      = header.match(/data:([^;]+)/)
  const mimeType       = mimeMatch ? mimeMatch[1] : 'image/png'
  const ext            = mimeType.split('/')[1] || 'png'
  const fileName       = `ref_${Date.now()}.${ext}`

  const binary  = atob(data)
  const bytes   = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: mimeType })

  const formData = new FormData()
  formData.append('file', blob, fileName)

  const res = await fetch(ZIMAGE_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  })
  if (!res.ok) throw new Error(`이미지 업로드 실패: HTTP ${res.status}`)
  const json = await res.json()
  const url  = json.data?.url || json.url
  if (!url) throw new Error('이미지 업로드 실패: URL을 받지 못했습니다.')

  _uploadCache.set(cacheKey, { url, expiry: Date.now() + 2 * 60 * 60 * 1000 })
  return url
}

// ─── Z-Image: 프롬프트 길이 제한 ──────────────────────────────────────────────
function truncatePrompt(text, maxLen = ZIMAGE_MAX_PROMPT) {
  if (text.length <= maxLen) return text
  const truncated = text.slice(0, maxLen)
  const lastSpace = truncated.lastIndexOf(' ')
  return lastSpace > maxLen * 0.8 ? truncated.slice(0, lastSpace) : truncated
}

// ─── Z-Image: 태스크 생성 + 폴링 ──────────────────────────────────────────────
async function generateZImage(prompt, aspectRatio = '16:9', imageUrl = null, denoise = 0.65) {
  const token = getZImageToken()
  if (!token) throw new Error('Z-Image 토큰이 없습니다. API 설정에서 KIE AI 토큰을 입력해주세요.')

  const truncatedPrompt = truncatePrompt(prompt)
  const arMap = { '16:9': '16:9', '9:16': '9:16', '1:1': '1:1' }
  const ar    = arMap[aspectRatio] || '16:9'

  const input = { prompt: truncatedPrompt, aspect_ratio: ar, nsfw_checker: true }
  if (imageUrl) { input.image_url = imageUrl; input.denoise = denoise }

  const createRes = await fetch(`${ZIMAGE_API_BASE}/jobs/createTask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ model: 'z-image', input }),
  })
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '')
    throw new Error(`Z-Image 태스크 생성 실패: HTTP ${createRes.status} — ${errText.slice(0, 100)}`)
  }
  const createData = await createRes.json()
  const taskId     = createData?.data?.taskId
  if (!taskId) throw new Error('Z-Image 태스크 ID를 받지 못했습니다.')

  // 폴링 (30회 × 1초)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const pollRes = await fetch(`${ZIMAGE_API_BASE}/jobs/recordInfo?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!pollRes.ok) continue
    const pollData = await pollRes.json()
    const rec      = pollData?.data || pollData
    const state    = rec?.state || rec?.status

    if (state === 'success') {
      let resultUrl = null
      try {
        const parsed = typeof rec.resultJson === 'string' ? JSON.parse(rec.resultJson) : rec.resultJson
        resultUrl    = parsed?.resultUrls?.[0] || rec?.resultUrls?.[0]
      } catch {
        resultUrl = rec?.resultUrls?.[0]
      }
      if (!resultUrl) throw new Error('Z-Image 결과 URL을 파싱할 수 없습니다.')
      return resultUrl
    }
    if (state === 'failed') {
      throw new Error(`Z-Image 생성 실패: ${rec?.failMsg || rec?.failCode || '알 수 없는 오류'}`)
    }
  }
  throw new Error('Z-Image 생성 시간 초과 (30초)')
}

// ─── 씬 이미지 생성 ───────────────────────────────────────────────────────────
export async function generateSceneImage(
  scene,
  bible,
  stylePreset,
  model            = DEFAULT_IMAGE_MODEL,
  aspectRatio      = '16:9',
  useReferenceImages = false,
  currentMode      = 'normal',
  fixedCharStyleType   = null,
  fixedCharSampleImage = null,
) {
  const isZImage = model === 'z-image-turbo'
  model = resolveModelId(model)

  // ── Z-Image 엔진 분기 ──────────────────────────────────────────────────────
  if (isZImage) {
    return generateSceneImageZImage(scene, bible, stylePreset, aspectRatio, currentMode, fixedCharStyleType, fixedCharSampleImage)
  }

  // ── Gemini 엔진 ────────────────────────────────────────────────────────────
  const client = await createClient()

  // {{TEXT_LANG}} 플레이스홀더가 있는 스타일만 대본 원문 언어로 치환 (그 외 스타일은 무영향)
  const resolvedStylePrompt = resolveTextLangPlaceholder(
    stylePreset.prompt,
    scene.scriptReference || scene.dialogue || scene.setting || ''
  )

  // 고정 캐릭터 모드
  const fixedCharPrompt = fixedCharStyleType ? getFixedCharPrompt(fixedCharStyleType, fixedCharSampleImage) : null

  // 캐릭터 참조 이미지 수집 (I2I)
  const referenceImages = []

  // custom/mascot 고정 캐릭터 샘플 이미지
  if (fixedCharSampleImage && (fixedCharStyleType === 'custom' || fixedCharStyleType === 'mascot')) {
    try {
      const data = await resizeBase64Image(fixedCharSampleImage, 512)
      if (data) {
        referenceImages.push({ text: '[STYLE REFERENCE — MANDATORY]: This is the character/mascot style you MUST replicate for ALL characters.' })
        referenceImages.push({ inlineData: { mimeType: 'image/png', data } })
      }
    } catch (e) {
      console.warn('⚠️ 고정캐릭터 샘플 이미지 처리 실패:', e)
    }
  }

  if (useReferenceImages && bible.characters && !fixedCharStyleType) {
    // ⚠️ 이름 완전일치(c.name === name) 대신 resolveSceneCharacters의 유연한 매칭(조사 제거 + 부분일치)을 사용.
    // 씬마다 "정약용"/"다산"/"다산 정약용"처럼 표기가 조금씩 달라져도 참조 이미지가 정상 첨부되도록.
    const sceneChars = resolveSceneCharacters(scene, bible)

    for (const char of sceneChars) {
      const refImg = char.referenceThumb || char.imageUrl
      if (refImg && refImg.startsWith('data:image/')) {
        try {
          const charIdx = bible.characters.findIndex(c => c.name === char.name)
          const tag     = `ACTOR-${String.fromCharCode(65 + charIdx)}`
          const data    = await resizeBase64Image(refImg, 256)
          if (data) {
            referenceImages.push({ text: `[${tag}, reference age ${char.age}${char.gender ? `, gender ${char.gender}` : ''}] Preserve core face identity (bone structure, eye shape, facial features) — but this is a REFERENCE for identity, not a literal age lock. If the scene description below explicitly indicates a different life stage (younger: unlined skin, dark full hair, leaner; older: grey/white hair, wrinkles, frailer build), age the face UP or DOWN accordingly while keeping it recognizably the same person. Act the scene naturally.` })
            referenceImages.push({ inlineData: { mimeType: 'image/png', data } })
          }
        } catch (e) {
          console.warn(`⚠️ 참조 이미지 처리 실패 (${char.name}):`, e)
        }
      }
    }
  }

  // 캐릭터 외형 정보
  const sceneChars = resolveSceneCharacters(scene, bible)
  const castInfo   = sceneChars.length > 0
    ? sceneChars.map((c, i) => {
        const idx = bible.characters.findIndex(b => b.name === c.name)
        const tag = `ACTOR-${String.fromCharCode(65 + (idx !== -1 ? idx : i))}`
        const protagonist = c.isProtagonist ? ' [★PROTAGONIST]' : ''
        const royalTag = getRoyalAttireTag(`${c.description || ''} ${c.name || ''} ${scene.setting || ''} ${stylePreset.id || ''}`)
        return `[${tag}]${protagonist}${royalTag} AGE: ${c.age}${c.gender ? `, GENDER: ${c.gender}` : ''}. APPEARANCE: ${c.visualPrompt}`
      }).join('\n')
    : '(no specific characters - focus on environment and atmosphere)'

  const consistencyNote = referenceImages.length > 0 && !fixedCharStyleType
    ? `[CHARACTER CONSISTENCY (CRITICAL)]: You MUST strictly maintain the visual identity of the characters provided in the reference images. Their HAIR STYLE, HAIR COLOR, EYE SHAPE, and DISTINCTIVE OUTFIT MUST remain identical to the reference image in every single scene.`
    : `[CHARACTER CONSISTENCY]: Maintain each character's described appearance exactly — same hair, outfit, beard, body.`

  const charCount    = sceneChars.length
  const charCountStr = charCount > 0 ? String(charCount) : ''
  const noExtraMode  = scene.excludeExtras ? `[ISOLATION MODE - STRICT]: THE USER HAS DISABLED EXTRAS. ABSOLUTELY NO BACKGROUND CHARACTERS. YOU MUST RENDER EXACTLY ${charCountStr} PERSON/PEOPLE.` : ''

  const textRule = TEXT_ALLOWED_STYLE_IDS.has(stylePreset.id)
    ? `⚠️ [ON-IMAGE TEXT — ALLOWED FOR THIS STYLE]:
- This style's info boxes, speech bubbles, graph labels, and keyword callouts described in the imagePrompt SHOULD be rendered as clean, legible in-image typography.
- Do NOT render random unrelated text, watermarks, or signatures — ONLY the specific text elements described in the imagePrompt.`
    : `⚠️ [imagePrompt ABSOLUTE PROHIBITION — NO EXCEPTIONS]:
- NO visible text, letters, words, signs, signage, banners, posters, newspapers, books with visible text, chalkboards, whiteboards, or any surface displaying readable characters.
- NO subtitles, captions, title cards, watermarks in the scene description.
- The scene must be PURELY VISUAL — zero textual elements in the rendered frame.`

  const imagePromptText = scene.imagePrompt || scene.imagePromptKo || ''
  const actionText      = scene.action || ''

  // 샷 타입 → 강제 프레이밍 규칙 (scene.shotType만 사용 — imagePromptText 오염 방지)
  const shotFramingRule = (() => {
    const st = (scene.shotType || '').toLowerCase()
    if (/extreme.?wide|establishing/.test(st))
      return '⚠️ MANDATORY FRAMING — EXTREME WIDE SHOT: Characters are TINY (under 15% of frame height). Landscape/architecture fills 85%+ of frame. Do NOT crop or zoom in on faces.'
    if (/wide/.test(st))
      return '⚠️ MANDATORY FRAMING — WIDE SHOT: Full bodies visible head-to-toe. Environment fills at least 50% of frame. Characters are NOT dominant — they exist within the space.'
    if (/full shot/.test(st))
      return '⚠️ MANDATORY FRAMING — FULL SHOT: Entire body from top of head to feet visible with clear space above and below. Do NOT crop at waist or chest.'
    if (/medium.?wide/.test(st))
      return '⚠️ MANDATORY FRAMING — MEDIUM-WIDE SHOT: Characters visible from knees up. Substantial environment visible on all sides.'
    if (/over.?the.?shoulder|ots/.test(st))
      return '⚠️ MANDATORY FRAMING — OVER-THE-SHOULDER: One character\'s shoulder/back occupies foreground. The other character faces camera. BOTH characters visible in same frame.'
    if (/two.?shot|2.?shot/.test(st))
      return '⚠️ MANDATORY FRAMING — TWO-SHOT: BOTH characters visible together in the same frame, side by side or facing each other. Do NOT isolate one character.'
    if (/bird.?s.?eye|top.?down/.test(st))
      return '⚠️ MANDATORY FRAMING — BIRD\'S EYE VIEW: Camera looks straight down from above. Figures appear flat against ground.'
    if (/extreme.?close/.test(st))
      return '⚠️ MANDATORY FRAMING — EXTREME CLOSE-UP: Face fills the entire frame. NOTHING ELSE — no room, no other characters, no wide environment visible.'
    if (/close.?up|closeup/.test(st))
      return '⚠️ MANDATORY FRAMING — CLOSE-UP: Face and upper chest ONLY. Framed tightly. NOT waist-up. NOT full body.'
    if (/medium/.test(st))
      return '⚠️ MANDATORY FRAMING — MEDIUM SHOT: Waist-up framing. NOT full body, NOT close-up face.'
    return ''
  })()

  // wide/group 샷일 때만 배경 인물 유도 (scene.shotType만 사용)
  const backgroundExtrasNote = (() => {
    const st = (scene.shotType || '').toLowerCase()
    const isWide = /wide|full shot|establishing|bird|two.?shot/.test(st)
    if (!isWide) return ''
    return '[BACKGROUND ATMOSPHERE — MANDATORY FOR WIDE SHOTS]: Populate the space with period-appropriate anonymous background figures (guards, officials, servants, soldiers, courtiers, civilians — matching the era and setting). These figures should be faceless/generic extras that create depth and a lived-in world. Do NOT leave the background empty.'
  })()

  // 에디토리얼 모드
  if (currentMode === 'editorial') {
    const editorialPrompt = `[STYLE] ${resolvedStylePrompt}

[EDITORIAL / INFOGRAPHIC IMAGE]
${imagePromptText || actionText}

[INFOGRAPHIC RULES]:
- Clean, professional infographic or data visualization layout.
- Text labels, charts, graphs, icons, timelines, maps ARE ALLOWED and encouraged.
- ⚠️ CRITICAL LANGUAGE RULE: ALL text visible in the image (labels, titles, annotations, captions, numbers) MUST be written in KOREAN (한국어). DO NOT use English text anywhere in the image.
- 100% FULL BLEED canvas. NO letterboxing, NO black bars, NO white borders.
- ONE UNIFIED SINGLE FRAME ONLY. NO split screen.
- High contrast, easy-to-read Korean typography.
- Professional news/editorial photography or infographic design aesthetic.`.trim()

    return withRetry(async () => {
      const timeoutMs = getTimeout(model)
      const res = await withTimeout(
        safeGenerate(client, {
          model,
          contents: editorialPrompt,
          config: {
            safetySettings: SAFETY_SETTINGS,
            responseModalities: ['IMAGE'],
            imageConfig: getImageConfig(model, aspectRatio),
            ...getThinkingConfig(model),
          },
        }, `generateSceneImage[editorial](${scene.id})`),
        timeoutMs,
        `generateSceneImage[editorial](${scene.id})`
      )
      if (!res?.candidates?.length) throw new Error(`이미지 생성 실패 (Scene ${scene.id}): AI가 빈 응답을 반환했습니다.`)
      const imgPart = res.candidates[0]?.content?.parts?.find(p => p.inlineData && !p.thought)
      if (!imgPart) throw new Error(`이미지 생성 실패 (Scene ${scene.id}): 안전 필터에 의해 차단되었거나 응답이 비어있습니다.`)
      return `data:image/png;base64,${imgPart.inlineData.data}`
    }, 5, `generateSceneImage[editorial](${scene.id})`, { model, smartBackoff: SMART_BACKOFF_MODELS.includes(model) })
  }

  const compositePrompt = `[STYLE] ${resolvedStylePrompt} (NON-NEGOTIABLE)
${fixedCharPrompt ? `\n${fixedCharPrompt}\n` : ''}
${shotFramingRule ? `${shotFramingRule}\n` : ''}[CONTEXT] "${(scene.dialogue || scene.scriptReference || '').slice(0, 150).replace(/"/g, "'")}"
[WORLD] ${bible.environment?.visualPrompt || ''}
${scene.setting ? `[LOCATION]: ${scene.setting}` : ''}

${sceneChars.length > 0 ? `[CAST]\n${castInfo}` : '[NO HUMAN FIGURES - Environment shot]'}
${consistencyNote}
⚠️ KOREAN ROYAL ATTIRE — READ SCENE CONTEXT: If the scene is formal/official (throne room, court, royal ceremony, public setting) → king wears 익선관(翼善冠, tall black dome cap, two small rear flaps, NO wide side wings) + 곤룡포(ENTIRELY VERMILLION RED robe — ⚠️ ABSOLUTE RULE: NO blue fabric anywhere on the garment. NO blue inner sleeves. NO blue undershirt showing at wrists or collar. The ONLY non-red color allowed is the white inner collar and gold dragon embroidery). If the scene is private, informal, or pre-coronation → king may wear 평상복, 도포, or other period-appropriate casual attire. Officials/ministers always wear 사모(紗帽, wide flat horizontal side wings) + 관복, NEVER 익선관.
[CRITICAL GROUNDING]: ALL characters MUST be physically grounded in the 3D space of the CURRENT LOCATION.
${backgroundExtrasNote ? `\n${backgroundExtrasNote}\n` : ''}
[SHOT PARAMETERS] ${imagePromptText}

[ACTION] ${actionText}
- Hands/eyes convey emotion.
- NO EYE CONTACT WITH CAMERA. NEVER look directly at the viewer.
- ALL characters are ADULTS. NO violence, blood, or gore. Safe, PG-13 drama.

[COMPOSITION]
CRITICAL LAYOUT MANDATE: The output MUST perfectly fill the entire canvas space (100% FULL BLEED).
ABSOLUTELY NO LETTERBOXING, NO BLACK BARS, and NO WHITE BORDERS.
ONE UNIFIED SINGLE FRAME ONLY. NO picture-in-picture, NO split screen.
${noExtraMode}
${textRule}`.trim()

  const contents = referenceImages.length > 0
    ? { role: 'user', parts: [...referenceImages, { text: compositePrompt }] }
    : compositePrompt

  return withRetry(async () => {
    const timeoutMs = getTimeout(model)
    const res = await withTimeout(
      safeGenerate(client, {
        model,
        contents,
        config: {
          safetySettings: SAFETY_SETTINGS,
          responseModalities: ['IMAGE'],
          imageConfig: getImageConfig(model, aspectRatio),
          ...getThinkingConfig(model),
        },
      }, `generateSceneImage(${scene.id})`),
      timeoutMs,
      `generateSceneImage(${scene.id})`
    )

    if (!res?.candidates?.length) throw new Error(`이미지 생성 실패 (Scene ${scene.id}): AI가 빈 응답을 반환했습니다.`)
    const imgPart = res.candidates[0]?.content?.parts?.find(p => p.inlineData && !p.thought)
    if (!imgPart) throw new Error(`이미지 생성 실패 (Scene ${scene.id}): 안전 필터에 의해 차단되었거나 응답이 비어있습니다.`)
    return `data:image/png;base64,${imgPart.inlineData.data}`
  }, 5, `generateSceneImage(${scene.id})`, { model, smartBackoff: SMART_BACKOFF_MODELS.includes(model) })
}

// ─── Z-Image 씬 이미지 생성 ───────────────────────────────────────────────────
async function generateSceneImageZImage(scene, bible, stylePreset, aspectRatio, currentMode, fixedCharStyleType, fixedCharSampleImage) {
  const resolvedStylePrompt = resolveTextLangPlaceholder(
    stylePreset.prompt,
    scene.scriptReference || scene.dialogue || scene.setting || ''
  )
  const sceneChars = resolveSceneCharacters(scene, bible)

  const castInfo = sceneChars.length > 0
    ? sceneChars.map(c => {
        // ⚠️ KING_KEYWORDS/QUEEN_KEYWORDS는 어디에도 정의돼 있지 않았다(ReferenceError).
        //    문화권 판별이 들어간 getRoyalAttireTag 하나로 통일한다.
        const royalTag = getRoyalAttireTag(`${c.description || ''} ${c.name || ''} ${scene.setting || ''} ${stylePreset.id || ''}`)
        const isKing  = royalTag.includes('ROYALTY (KING)')
        const isQueen = !isKing && royalTag.includes('QUEEN')
        // 곤룡포 태그가 붙은 인물에게만 파랑→주홍 치환. 예전엔 무조건 치환해서
        // 조선과 무관한 인물의 파란 옷까지 주홍으로 바뀌었다.
        let vp = isKing
          ? (c.visualPrompt || '').replace(/\b(blue|azure|indigo|cobalt|청색|파란|파랑)\b/gi, 'vermillion red')
          : (c.visualPrompt || '')
        const costumeTag = isKing
          ? ', ENTIRELY VERMILLION RED 곤룡포 robe — NO blue fabric anywhere, ALL hair hidden inside 익선관 — NO flowing hair visible'
          : isQueen
          ? ', formal 활옷/원삼 robe with gold phoenix (봉황) embroidery — NEVER 익선관 or 곤룡포 (those are King-only)'
          : ''
        return `${c.name}: ${vp}${costumeTag}`
      }).join(', ')
    : ''

  const fixedCharPrompt = fixedCharStyleType ? getFixedCharPrompt(fixedCharStyleType, fixedCharSampleImage) : ''

  // imagePrompt에서도 곤룡포 관련 blue 제거 — 단 곤룡포 태그가 실제로 붙은 씬에서만.
  // 예전엔 ROYAL_KEYWORDS만 보고 치환해서, 조선과 무관한 대본의 파란 옷·파란 소매까지
  // 주홍으로 바뀌던 문제가 있었다.
  let imagePromptText = scene.imagePrompt || scene.imagePromptKo || ''
  if (castInfo.includes('👑ROYALTY (KING)')) {
    imagePromptText = imagePromptText.replace(/\b(blue|azure|cobalt)\b(?=.*(?:sleeve|robe|inner|cuff|collar|fabric))/gi, 'vermillion red')
  }
  const actionText = scene.action || ''

  let prompt = ''
  if (currentMode === 'editorial') {
    prompt = `${resolvedStylePrompt}, ${imagePromptText || actionText}, professional infographic layout, Korean text labels allowed, full bleed, no borders`
  } else {
    prompt = [
      resolvedStylePrompt,
      fixedCharPrompt,
      castInfo ? `Characters: ${castInfo}` : '',
      scene.setting ? `Location: ${scene.setting}` : '',
      imagePromptText,
      actionText,
      'full bleed, no borders, no letterboxing, single frame',
    ].filter(Boolean).join('. ')
  }

  // 고정캐릭터 샘플 이미지 업로드 (I2I)
  let uploadedImageUrl = null
  if (fixedCharSampleImage && (fixedCharStyleType === 'custom' || fixedCharStyleType === 'mascot')) {
    try {
      uploadedImageUrl = await uploadImageToZImage(fixedCharSampleImage)
    } catch (e) {
      console.warn('⚠️ Z-Image 샘플 이미지 업로드 실패, I2I 없이 진행:', e)
    }
  }

  return generateZImage(prompt, aspectRatio, uploadedImageUrl, 0.65)
}

// ─── 단순 이미지 생성 ─────────────────────────────────────────────────────────
export async function generateImage(promptText, stylePreset, model = DEFAULT_IMAGE_MODEL, aspectRatio = '16:9', allowText = false) {
  const resolvedStylePrompt = resolveTextLangPlaceholder(stylePreset.prompt, promptText)
  if (model === 'z-image-turbo') {
    const prompt = `${resolvedStylePrompt}, ${promptText}, full bleed, no borders, single frame`
    return generateZImage(prompt, aspectRatio)
  }
  model = resolveModelId(model)

  const client  = await createClient()
  const textRule = allowText
    ? 'Clean infographic text MAY be included if relevant to the content. NO random watermarks or signatures.'
    : 'The image MUST NOT contain ANY text, typography, letters, watermarks, or signatures. PURE VISUALS ONLY.'
  const fullPrompt = `${resolvedStylePrompt}, ${promptText}, CRITICAL FRAME MANDATE: 100% FULL BLEED canvas. ABSOLUTELY NO LETTERBOXING, NO BLACK BARS, and NO WHITE BORDERS. Do NOT simulate a cinematic crop by drawing bars. ${textRule} ONE UNIFIED SINGLE FRAME ONLY. NO split screen.`

  return withRetry(async () => {
    const timeoutMs = getTimeout(model)
    const res = await withTimeout(
      safeGenerate(client, {
        model,
        contents: fullPrompt,
        config: {
          safetySettings: SAFETY_SETTINGS,
          responseModalities: ['IMAGE'],
          imageConfig: getImageConfig(model, aspectRatio),
          ...getThinkingConfig(model),
        },
      }, 'generateImage'),
      timeoutMs,
      'generateImage'
    )
    if (!res?.candidates?.length) throw new Error('이미지 생성 실패: AI가 빈 응답을 반환했습니다.')
    const imgPart = res.candidates[0]?.content?.parts?.find(p => p.inlineData && !p.thought)
    if (!imgPart) return ''
    return `data:image/png;base64,${imgPart.inlineData.data}`
  }, 3, 'generateImage', { model, smartBackoff: SMART_BACKOFF_MODELS.includes(model) })
}

// ─── 썸네일 생성 3종 ──────────────────────────────────────────────────────────
export async function generateThumbnails(bible, stylePreset, model = DEFAULT_IMAGE_MODEL, aspectRatio = '16:9') {
  model = resolveModelId(model)
  const client = await createClient()
  const resolvedStylePrompt = resolveTextLangPlaceholder(
    stylePreset.prompt,
    bible.characters.map(c => c.name).join(' ')
  )

  const castInfo = bible.characters.slice(0, 3).map((c, i) => {
    const tag = `ACTOR-${String.fromCharCode(65 + i)}`
    return `[${tag}: ${c.name}] ${c.age}${c.gender ? `, ${c.gender}` : ''}, ${c.visualPrompt}`
  }).join('\n')

  const ratioLabel = aspectRatio === '9:16'
    ? '9:16 (Shorts/Vertical, 720×1280 equivalent)'
    : '16:9 (YouTube thumbnail, 1280×720 equivalent)'
  const composition = aspectRatio === '9:16'
    ? 'Vertical 9:16 frame — tall composition, subject centered, top-heavy energy.'
    : 'Horizontal 16:9 frame — wide cinematic composition, rule-of-thirds placement.'

  const thumbTypes = [
    {
      label:  'DRAMATIC_CLIMAX',
      prompt: `The single most emotionally explosive moment of the story — the exact frame where everything reaches its peak. Characters at the absolute limit of their emotions: tears streaming, jaw clenched in rage, or frozen in devastation. Extreme close-up on face or hands. Harsh chiaroscuro — one strong light source carving deep shadows. Desaturated color palette (steel blue, ash grey) with one warm accent. ${composition}`,
    },
    {
      label:  'MOVIE_POSTER',
      prompt: `Professional Korean film poster composition. Main character(s) in iconic, deliberate pose — slightly below center, looking away or into distance, conveying weight and gravitas. Background composed of layered story environments slightly blurred. Dramatic rim lighting from behind. Colour grading: deep teal shadows, warm golden highlights. Premium cinematic production quality — NOT a snapshot, a crafted image. ${composition}`,
    },
    {
      label:  'CLICK_BAIT',
      prompt: `A scene that makes viewers STOP scrolling and ask "what is happening here?" — NOT an emotional climax, but a PUZZLE or MYSTERY moment: a character staring at something just off-frame with wide eyes, a pair of hands holding an unexpected object, a door cracked open with suspicious light spilling out, or two characters frozen in an ambiguous confrontation. HIGH CONTRAST vivid colors (deep red, electric blue). Dynamic composition: Dutch angle 20°. Creates irresistible curiosity. ${composition}`,
    },
  ]

  const refImages = []
  for (const char of bible.characters.slice(0, 3)) {
    const ref = char.referenceThumb || char.referenceImage
    if (ref && ref.startsWith('data:image/')) {
      const [mime, data] = [ref.split(',')[0].replace('data:', '').replace(';base64', ''), ref.split(',')[1]]
      if (data) refImages.push({ inlineData: { mimeType: mime, data } })
    }
  }

  const results = []

  for (const thumb of thumbTypes) {
    try {
      const thumbPrompt = `${resolvedStylePrompt}

[YOUTUBE THUMBNAIL — ${thumb.label}]
${thumb.prompt}

[CHARACTERS IN THIS THUMBNAIL${refImages.length > 0 ? ' — REFERENCE IMAGES ABOVE' : ''}]:
${castInfo}
${refImages.length > 0 ? '⚠️ CRITICAL: The character reference images above show the EXACT visual appearance each character must have. Match faces, hairstyles, clothing, and age PRECISELY.' : ''}

[ENVIRONMENT]: ${bible.environment?.visualPrompt || ''}

⚠️ CRITICAL MANDATE: 100% FULL BLEED canvas. ABSOLUTELY NO LETTERBOXING, NO BLACK/WHITE BARS or borders.
⚠️ ABSOLUTELY NO TEXT, NO LETTERS, NO WORDS, NO TITLES, NO WATERMARKS in the image. PURE VISUALS ONLY.
⚠️ Characters must match their descriptions and reference images EXACTLY — maintain identity consistency.
⚠️ Aspect ratio: ${ratioLabel}.
⚠️ High contrast, vibrant saturated colors, eye-catching composition.
⚠️ Professional quality, 8K detail, edge-to-edge full frame.`

      const contents = refImages.length > 0
        ? { role: 'user', parts: [...refImages, { text: thumbPrompt }] }
        : thumbPrompt

      const imageUrl = await withRetry(async () => {
        const timeoutMs = getTimeout(model)
        const res = await withTimeout(
          safeGenerate(client, {
            model,
            contents,
            config: {
              safetySettings: SAFETY_SETTINGS,
              responseModalities: ['IMAGE'],
              imageConfig: getImageConfig(model, aspectRatio),
              ...getThinkingConfig(model),
            },
          }, `generateThumbnail(${thumb.label})`),
          timeoutMs,
          `generateThumbnail(${thumb.label})`
        )
        if (!res?.candidates?.[0]?.content?.parts) throw new Error(`썸네일 생성 실패: ${thumb.label}`)
        const imgPart = res.candidates[0].content.parts.find(p => p.inlineData && !p.thought)
        if (!imgPart) throw new Error(`썸네일 생성 실패: ${thumb.label}`)
        return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`
      }, 3, `generateThumbnail(${thumb.label})`, { model, smartBackoff: SMART_BACKOFF_MODELS.includes(model) })

      results.push({ label: thumb.label, imageUrl, error: null })
    } catch (e) {
      console.error(`썸네일 생성 실패 (${thumb.label}):`, e)
      results.push({ label: thumb.label, imageUrl: null, error: e.message })
    }
  }

  return results
}

// ─── 헬퍼: 씬의 관련 캐릭터 해석 ─────────────────────────────────────────────
function resolveSceneCharacters(scene, bible) {
  const involvedNames = scene.involvedCharacters || []
  if (involvedNames.length === 0) return []
  const strip = n => n.replace(/(은|는|이|가|을|를|에게|의|로|과|와)$/, '').replace(/\s/g, '').toLowerCase()
  const chars = involvedNames
    .map(name => {
      const matchByTag = name.match(/(ACTOR|KEY)[-_]?([A-Z])/i)
      if (matchByTag) {
        const idx = matchByTag[2].toUpperCase().charCodeAt(0) - 65
        if (idx >= 0 && idx < bible.characters.length) return bible.characters[idx]
      }
      const stripped = strip(name)
      return bible.characters.find(c => strip(c.name) === stripped || strip(c.name).includes(stripped) || stripped.includes(strip(c.name)))
    })
    .filter(Boolean)

  const seen = new Set()
  return chars.filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true })
}

// ─── 헬퍼: base64 이미지 리사이즈 ────────────────────────────────────────────
function resizeBase64Image(dataUrl, maxSize = 256) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const scale  = Math.min(maxSize / img.width, maxSize / img.height, 1)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png').split(',')[1])
    }
    img.onerror = () => resolve('')
    img.src = dataUrl
  })
}
