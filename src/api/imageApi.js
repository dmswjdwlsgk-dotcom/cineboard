import { createClient, SAFETY_SETTINGS, withRetry, safeGenerate, withTimeout, getZImageToken, resolveModelId, generateVertexAIImage, getApiMode } from './gemini.js'

const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image'
const ZIMAGE_API_BASE     = 'https://api.kie.ai/api/v1'
const ZIMAGE_UPLOAD_URL   = 'https://kieai.redpandaai.co/api/file-stream-upload'
const ZIMAGE_MAX_PROMPT   = 800

// 업로드 캐시 (2시간)
const _uploadCache = new Map()

// ─── 모델별 이미지 설정 ───────────────────────────────────────────────────────
function getImageConfig(model, aspectRatio) {
  const isPro    = model === 'gemini-3-pro-image-preview'
  const isFlash2 = model === 'gemini-3.1-flash-image-preview'
  return {
    aspectRatio,
    numberOfImages: 1,
    ...(isPro    ? { imageSize: '2K' } : {}),
    ...(isFlash2 ? { imageSize: '1K' } : {}),
  }
}

function getThinkingConfig(model) {
  return model === 'gemini-3-pro-image-preview' ? { thinkingConfig: { thinkingBudget: 1024 } } : {}
}

function getTimeout(model) {
  return model === 'gemini-3-pro-image-preview' ? 120000 : 60000
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
  const isZImage  = model === 'z-image-turbo'
  const isVertex  = getApiMode() === 'vertex'

  // ── Z-Image 엔진 분기 ──────────────────────────────────────────────────────
  if (isZImage) {
    return generateSceneImageZImage(scene, bible, stylePreset, aspectRatio, currentMode, fixedCharStyleType, fixedCharSampleImage)
  }

  // ── Vertex AI 분기: Imagen REST API 직접 호출 ─────────────────────────────
  if (isVertex) {
    return generateSceneImageVertex(scene, bible, stylePreset, aspectRatio, currentMode, fixedCharStyleType)
  }

  // ── Gemini 엔진 ────────────────────────────────────────────────────────────
  const client = await createClient()

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
    const sceneChars = (scene.involvedCharacters || [])
      .map(name => bible.characters.find(c => c.name === name))
      .filter(Boolean)

    for (const char of sceneChars) {
      const refImg = char.referenceThumb || char.imageUrl
      if (refImg && refImg.startsWith('data:image/')) {
        try {
          const charIdx = bible.characters.findIndex(c => c.name === char.name)
          const tag     = `ACTOR-${String.fromCharCode(65 + charIdx)}`
          const data    = await resizeBase64Image(refImg, 256)
          if (data) {
            referenceImages.push({ text: `[${tag}, age ${char.age}${char.gender ? `, gender ${char.gender}` : ''}] Preserve face/hair/outfit identity. Act the scene naturally.` })
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
        return `[${tag}]${protagonist} AGE: ${c.age}${c.gender ? `, GENDER: ${c.gender}` : ''}. APPEARANCE: ${c.visualPrompt}`
      }).join('\n')
    : '(no specific characters - focus on environment and atmosphere)'

  const consistencyNote = referenceImages.length > 0 && !fixedCharStyleType
    ? `[CHARACTER CONSISTENCY (CRITICAL)]: You MUST strictly maintain the visual identity of the characters provided in the reference images. Their HAIR STYLE, HAIR COLOR, EYE SHAPE, and DISTINCTIVE OUTFIT MUST remain identical to the reference image in every single scene.`
    : `[CHARACTER CONSISTENCY]: Maintain each character's described appearance exactly — same hair, outfit, beard, body.`

  const charCount    = sceneChars.length
  const charCountStr = charCount > 0 ? String(charCount) : ''
  const noExtraMode  = scene.excludeExtras ? `[ISOLATION MODE - STRICT]: THE USER HAS DISABLED EXTRAS. ABSOLUTELY NO BACKGROUND CHARACTERS. YOU MUST RENDER EXACTLY ${charCountStr} PERSON/PEOPLE.` : ''

  const textRule = `⚠️ [imagePrompt ABSOLUTE PROHIBITION — NO EXCEPTIONS]:
- NO visible text, letters, words, signs, signage, banners, posters, newspapers, books with visible text, chalkboards, whiteboards, or any surface displaying readable characters.
- NO subtitles, captions, title cards, watermarks in the scene description.
- The scene must be PURELY VISUAL — zero textual elements in the rendered frame.`

  const imagePromptText = scene.imagePrompt || scene.imagePromptKo || ''
  const actionText      = scene.action || ''

  // 에디토리얼 모드
  if (currentMode === 'editorial') {
    const editorialPrompt = `[STYLE] ${stylePreset.prompt}

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
          model: resolveModelId(model),
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
    }, 5, `generateSceneImage[editorial](${scene.id})`)
  }

  const compositePrompt = `[STYLE] ${stylePreset.prompt} (NON-NEGOTIABLE)
${fixedCharPrompt ? `\n${fixedCharPrompt}\n` : ''}
[CONTEXT] "${(scene.dialogue || scene.scriptReference || '').slice(0, 150).replace(/"/g, "'")}"
[WORLD] ${bible.environment?.visualPrompt || ''}
${scene.setting ? `[LOCATION]: ${scene.setting}` : ''}

${sceneChars.length > 0 ? `[CAST]\n${castInfo}` : '[NO HUMAN FIGURES - Environment shot]'}
${consistencyNote}
[CRITICAL GROUNDING]: ALL characters MUST be physically grounded in the 3D space of the CURRENT LOCATION.

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
    ? { parts: [...referenceImages, { text: compositePrompt }] }
    : compositePrompt

  return withRetry(async () => {
    const timeoutMs = getTimeout(model)
    const res = await withTimeout(
      safeGenerate(client, {
        model: resolveModelId(model),
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
  }, 5, `generateSceneImage(${scene.id})`)
}

// ─── Vertex AI 씬 이미지 생성 (Imagen REST API) ───────────────────────────────
async function generateSceneImageVertex(scene, bible, stylePreset, aspectRatio, currentMode, fixedCharStyleType) {
  const sceneChars = resolveSceneCharacters(scene, bible)
  const castInfo   = sceneChars.length > 0
    ? sceneChars.map(c => `${c.name}: ${c.visualPrompt}`).join(', ')
    : ''
  const fixedCharPrompt = fixedCharStyleType ? getFixedCharPrompt(fixedCharStyleType, null) : ''
  const imagePromptText = scene.imagePrompt || scene.imagePromptKo || ''
  const actionText      = scene.action || ''

  let prompt = ''
  if (currentMode === 'editorial') {
    prompt = `${stylePreset.prompt}, ${imagePromptText || actionText}, professional infographic layout, full bleed, no borders`
  } else {
    prompt = [
      stylePreset.prompt,
      fixedCharPrompt,
      castInfo ? `Characters: ${castInfo}` : '',
      scene.setting ? `Location: ${scene.setting}` : '',
      imagePromptText,
      actionText,
      'full bleed, no borders, no letterboxing, single frame, photorealistic, cinematic',
    ].filter(Boolean).join('. ')
  }

  return withRetry(
    () => generateVertexAIImage(prompt, aspectRatio),
    3,
    `generateSceneImageVertex(${scene.id})`
  )
}

// ─── Z-Image 씬 이미지 생성 ───────────────────────────────────────────────────
async function generateSceneImageZImage(scene, bible, stylePreset, aspectRatio, currentMode, fixedCharStyleType, fixedCharSampleImage) {
  const sceneChars = resolveSceneCharacters(scene, bible)
  const castInfo   = sceneChars.length > 0
    ? sceneChars.map(c => `${c.name}: ${c.visualPrompt}`).join(', ')
    : ''

  const fixedCharPrompt = fixedCharStyleType ? getFixedCharPrompt(fixedCharStyleType, fixedCharSampleImage) : ''

  const imagePromptText = scene.imagePrompt || scene.imagePromptKo || ''
  const actionText      = scene.action || ''

  let prompt = ''
  if (currentMode === 'editorial') {
    prompt = `${stylePreset.prompt}, ${imagePromptText || actionText}, professional infographic layout, Korean text labels allowed, full bleed, no borders`
  } else {
    prompt = [
      stylePreset.prompt,
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
  if (model === 'z-image-turbo') {
    const prompt = `${stylePreset.prompt}, ${promptText}, full bleed, no borders, single frame`
    return generateZImage(prompt, aspectRatio)
  }

  if (getApiMode() === 'vertex') {
    const prompt = `${stylePreset.prompt}, ${promptText}, full bleed, no borders, single frame`
    return withRetry(() => generateVertexAIImage(prompt, aspectRatio), 3, 'generateImage[vertex]')
  }

  const client  = await createClient()
  const textRule = allowText
    ? 'Clean infographic text MAY be included if relevant to the content. NO random watermarks or signatures.'
    : 'The image MUST NOT contain ANY text, typography, letters, watermarks, or signatures. PURE VISUALS ONLY.'
  const fullPrompt = `${stylePreset.prompt}, ${promptText}, CRITICAL FRAME MANDATE: 100% FULL BLEED canvas. ABSOLUTELY NO LETTERBOXING, NO BLACK BARS, and NO WHITE BORDERS. Do NOT simulate a cinematic crop by drawing bars. ${textRule} ONE UNIFIED SINGLE FRAME ONLY. NO split screen.`

  return withRetry(async () => {
    const timeoutMs = getTimeout(model)
    const res = await withTimeout(
      safeGenerate(client, {
        model: resolveModelId(model),
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
  }, 3, 'generateImage')
}

// ─── 썸네일 생성 3종 ──────────────────────────────────────────────────────────
export async function generateThumbnails(bible, stylePreset, model = DEFAULT_IMAGE_MODEL, aspectRatio = '16:9') {
  const client = await createClient()

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
      const thumbPrompt = `${stylePreset.prompt}

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
        ? { parts: [...refImages, { text: thumbPrompt }] }
        : thumbPrompt

      const imageUrl = await withRetry(async () => {
        const timeoutMs = getTimeout(model)
        const res = await withTimeout(
          safeGenerate(client, {
            model: resolveModelId(model),
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
      }, 3, `generateThumbnail(${thumb.label})`)

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
