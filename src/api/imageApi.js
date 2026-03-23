import { createClient, SAFETY_SETTINGS, withRetry, safeGenerate, withTimeout, parseJson } from './gemini.js'

const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image'

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

// ─── 씬 이미지 생성 (원본 St 함수 이식) ──────────────────────────────────────
export async function generateSceneImage(scene, bible, stylePreset, model = DEFAULT_IMAGE_MODEL, aspectRatio = '16:9', useReferenceImages = false, currentMode = 'normal') {
  const client = await createClient()

  // 캐릭터 참조 이미지 수집 (I2I)
  const referenceImages = []
  if (useReferenceImages && bible.characters) {
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

  const consistencyNote = referenceImages.length > 0
    ? `[CHARACTER CONSISTENCY (CRITICAL)]: You MUST strictly maintain the visual identity of the characters provided in the reference images. Their HAIR STYLE, HAIR COLOR, EYE SHAPE, and DISTINCTIVE OUTFIT MUST remain identical to the reference image in every single scene.`
    : `[CHARACTER CONSISTENCY]: Maintain each character's described appearance exactly — same hair, outfit, beard, body.`

  const charCount   = sceneChars.length
  const charCountStr = charCount > 0 ? String(charCount) : ''
  const noExtraMode = scene.excludeExtras ? `[ISOLATION MODE - STRICT]: THE USER HAS DISABLED EXTRAS. ABSOLUTELY NO BACKGROUND CHARACTERS. YOU MUST RENDER EXACTLY ${charCountStr} PERSON/PEOPLE.` : ''

  const textRule = `⚠️ [imagePrompt ABSOLUTE PROHIBITION — NO EXCEPTIONS]:
- NO visible text, letters, words, signs, signage, banners, posters, newspapers, books with visible text, chalkboards, whiteboards, or any surface displaying readable characters.
- NO subtitles, captions, title cards, watermarks in the scene description.
- The scene must be PURELY VISUAL — zero textual elements in the rendered frame.`

  const imagePromptText = scene.imagePrompt || scene.imagePromptKo || ''
  const actionText      = scene.action || ''

  // 에디토리얼 모드: 인포그래픽 전용 프롬프트
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
    }, 5, `generateSceneImage[editorial](${scene.id})`)
  }

  const compositePrompt = `[STYLE] ${stylePreset.prompt} (NON-NEGOTIABLE)

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
  }, 5, `generateSceneImage(${scene.id})`)
}

// ─── 단순 이미지 생성 (원본 un 함수 이식) ────────────────────────────────────
export async function generateImage(promptText, stylePreset, model = DEFAULT_IMAGE_MODEL, aspectRatio = '16:9', allowText = false) {
  const client = await createClient()
  const textRule = allowText
    ? 'Clean infographic text MAY be included if relevant to the content. NO random watermarks or signatures.'
    : 'The image MUST NOT contain ANY text, typography, letters, watermarks, or signatures. PURE VISUALS ONLY.'
  const fullPrompt = `${stylePreset.prompt}, ${promptText}, CRITICAL FRAME MANDATE: 100% FULL BLEED canvas. ABSOLUTELY NO LETTERBOXING, NO BLACK BARS, and NO WHITE BORDERS. Do NOT simulate a cinematic crop by drawing bars. ${textRule} ONE UNIFIED SINGLE FRAME ONLY. NO split screen.`

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
  }, 3, 'generateImage')
}

// ─── 썸네일 생성 3종 (원본 za 함수 이식) ─────────────────────────────────────
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

  // 참조 이미지 수집
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

  // 중복 제거
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
