import { createClient, SAFETY_SETTINGS, withRetry, safeGenerate, parseJson } from './gemini.js'
import { Type } from '@google/genai'
import { LANG_CONFIGS, detectLanguage, cleanScript } from '../data/languages.js'

const TEXT_MODEL = 'gemini-2.5-flash'

// ─── 한국어 로마자 변환 ────────────────────────────────────────────────────────
const CH  = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h']
const JU  = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i']
const JO  = ['','k','kk','ks','n','nj','nh','d','l','lk','lm','lb','ls','lt','lp','lh','m','b','bs','s','ss','ng','j','ch','k','t','p','h']

function romanize(text) {
  if (!text) return text
  return text.replace(/[\uAC00-\uD7A3]/g, ch => {
    const code = ch.charCodeAt(0) - 44032
    return CH[Math.floor(code / 588)] + JU[Math.floor((code % 588) / 28)] + JO[code % 28]
  })
}

function romanizeInEnglishPrompt(text, characters) {
  if (!text) return text
  let result = text
  characters.forEach(char => {
    const name = char.name.trim()
    if (!name) return
    const rom = romanize(name).toLowerCase()
    result = result.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'s", 'g'), rom + "'s")
    result = result.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), rom)
    name.replace(/\([^)]*\)/g, '').trim().split(/[\s\-_]+/).filter(p => p.length >= 2).forEach(part => {
      if (part !== name && /[\uAC00-\uD7A3]/.test(part)) {
        const pr = romanize(part).toLowerCase()
        result = result.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), pr)
      }
    })
  })
  result = result.replace(/[\uAC00-\uD7A3]+/g, w => romanize(w).toLowerCase())
  return result.replace(/\s{2,}/g, ' ').trim()
}

// ─── 한국어 조사 자동 교정 ────────────────────────────────────────────────────
function hasJongsung(char) {
  const code = char.charCodeAt(0)
  if (code < 44032 || code > 55203) return false
  return (code - 44032) % 28 !== 0
}
function correctPostpositions(text) {
  if (!text) return text
  return text.replace(/([\uAC00-\uD7A3])(은|는|이|가|을|를|과|와|아|야)/g, (_, prev, p) => {
    const map = { 은:['은','는'], 는:['은','는'], 이:['이','가'], 가:['이','가'],
                  을:['을','를'], 를:['을','를'], 과:['과','와'], 와:['과','와'], 아:['아','야'], 야:['아','야'] }
    const pair = map[p]
    return pair ? prev + (hasJongsung(prev) ? pair[0] : pair[1]) : _
  })
}

function replaceActorTags(text, characters) {
  if (!text) return text
  let result = text
  characters.forEach((char, i) => {
    const tag = `ACTOR-${String.fromCharCode(65 + i)}`
    const name = char.name.trim()
    if (name) {
      result = result.replace(new RegExp(`\\[${tag}\\]`, 'g'), name)
      result = result.replace(new RegExp(tag, 'g'), name)
    }
  })
  result = result.replace(/\[([가-힣a-zA-Z0-9\s]+)\]/g, '$1')
  result = result.replace(/[\u{1F600}-\u{1FAFF}]/gu, '')
  result = result.replace(/\*\*/g, '').replace(/\*/g, '')
  result = correctPostpositions(result)
  return result
}

function cleanSceneOutput(scene, characters) {
  if (!scene) return scene
  return {
    ...scene,
    action:        replaceActorTags(scene.action || '', characters),
    description:   replaceActorTags(scene.description || '', characters),
    dialogue:      replaceActorTags(scene.dialogue || '', characters),
    screenText:    replaceActorTags(scene.screenText || '', characters),
    imagePromptKo: replaceActorTags(scene.imagePromptKo || '', characters),
    videoPromptKo: replaceActorTags(scene.videoPromptKo || '', characters),
    imagePrompt:   romanizeInEnglishPrompt(scene.imagePrompt || '', characters),
    videoPromptEn: romanizeInEnglishPrompt(scene.videoPromptEn || '', characters),
  }
}

// ─── 씬 목록 분할 ─────────────────────────────────────────────────────────────

// 스크립트를 정확히 n개 세그먼트로 프로그래밍 방식 분할 (씬 수 보장)
function programmaticSplit(scriptText, n) {
  const cleaned = cleanScript(scriptText)
  // 문단 단위로 나눈 뒤 n개 청크로 묶기
  const paras = cleaned.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  if (paras.length === 0) paras.push(cleaned)

  const perChunk = Math.ceil(paras.length / n)
  const chunks = []
  for (let i = 0; i < n; i++) {
    const slice = paras.slice(i * perChunk, (i + 1) * perChunk)
    if (slice.length === 0) break
    chunks.push(slice.join('\n\n'))
  }

  return chunks.map((seg, i) => {
    const num = String(i + 1).padStart(3, '0')
    return {
      id: `scene_${num}`,
      scriptReference: seg.slice(0, 30).replace(/\n/g, ' '),
      scriptAnchor:    seg.slice(0, 30).replace(/\n/g, ' '),
      startAnchor:     seg.slice(0, 40),
      setting:         '',
      fullScriptSegment: seg,
    }
  })
}

// AI로 각 세그먼트의 setting(배경) 보강
async function enrichSceneSettings(scenes, client) {
  const prompt = `다음 씬 목록의 각 씬에 대해 "setting"(장소와 시간대, 한국어)을 채워 반환하라.
씬 내용을 읽고 배경을 추론하라. 알 수 없으면 "미상"으로 쓸 것.

씬 목록 (JSON):
${JSON.stringify(scenes.map(s => ({ id: s.id, text: s.fullScriptSegment.slice(0, 120) })))}

결과: JSON 배열로 [{"id":"scene_001","setting":"..."},...] 형식만 반환.`

  try {
    const res = await withRetry(() =>
      client.models.generateContent({
        model:   TEXT_MODEL,
        contents: prompt,
        config:  { safetySettings: SAFETY_SETTINGS, responseMimeType: 'application/json', maxOutputTokens: 4096 },
      })
    , 2, '씬 배경 보강')
    const text     = res?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const settings = parseJson(text, '씬 배경 보강', [])
    const map      = Object.fromEntries(settings.map(s => [s.id, s.setting]))
    return scenes.map(s => ({ ...s, setting: map[s.id] || s.setting || '미상' }))
  } catch {
    return scenes
  }
}

export async function splitScriptToScenes(scriptText, maxScenes = 30) {
  const client = await createClient()
  // 프로그래밍 방식으로 정확히 maxScenes개 분할 (AI 무시 버그 방지)
  const scenes  = programmaticSplit(scriptText, maxScenes)
  // 배경 정보만 AI로 보강
  return enrichSceneSettings(scenes, client)
}

// ─── 에디토리얼 모드 전용 씬 프롬프트 빌더 ───────────────────────────────────
function buildEditorialScenePrompt(sceneRef, bible, stylePreset, langConfig) {
  const conceptRoster = (bible.characters || []).map((char, i) => {
    const tag = `KEY-${String.fromCharCode(65 + i)}`
    return `- [${tag}: ${char.name}] — ${char.role || '해설자'}`
  }).join('\n')

  return `[📊 EDITORIAL / INFOGRAPHIC SCENE GENERATION]
이 씬은 인포그래픽·시사·경제 콘텐츠용입니다. 드라마 연출이 아닌 정보 전달 중심으로 작성하세요.

[배정된 대본 구간]:
${sceneRef.fullScriptSegment || sceneRef.scriptReference || '(없음)'}

[장소/배경]: ${sceneRef.setting || ''}

[등장 개념/인물]:
${conceptRoster || '(없음)'}

[STYLE]: ${stylePreset.prompt}

[에디토리얼 씬 규칙]:
- action: 핵심 정보/사실을 1~2문장으로 압축. 숫자·통계·날짜 적극 활용.
- dialogue: 해설자 나레이션 또는 인용구 (약 8초 분량). 화자명 포함 금지.
- imagePrompt (영어): 인포그래픽 비주얼 묘사. 그래프·차트·아이콘·지도·타임라인 등 데이터 시각화 요소 포함 가능. 텍스트 레이블 허용.
- shotType: "Infographic", "Data Visualization", "Explainer", "Timeline", "Chart" 중 택일.
- involvedCharacters: 실제 등장 인물만 (없으면 빈 배열).

${langConfig.outputInstruction}
⚠️ imagePrompt는 반드시 영어로 작성. 300자 이상 상세하게.
RESILIENCE: If content is blocked, return a safe/neutral version. NEVER return null or empty strings.`
}

// ─── 씬 생성 공통 프롬프트 빌더 ───────────────────────────────────────────────
function buildScenePrompt(sceneRef, bible, stylePreset, langConfig, isRegenerate = false) {
  const isIllustration = /illustration|artwork|painting|manhwa|webtoon|anime|ghibli|watercolor|ink wash|clay|wool|diorama|fairy|folklore|3d.*anim|pixar/i.test(stylePreset.prompt)
  const directorMode   = isIllustration
    ? '[🎨 MASTER ILLUSTRATOR/WEBTOON DIRECTOR MODE]'
    : '[🎬 MASTER CINEMATOGRAPHER MODE]'

  const characterRoster = (bible.characters || []).map((char, i) => {
    const tag = `ACTOR-${String.fromCharCode(65 + i)}`
    const protagonist = char.isProtagonist ? ' [★PROTAGONIST — 대본의 "나(I)", "저(I-formal)", "주인공" 모두 이 인물을 지칭]' : ''
    return `- [${tag}: ${char.name}]${protagonist}; // DO NOT hallucinate their clothes or age. Focus strictly on their actions.`
  }).join('\n')

  const locationInfo = (() => {
    if (!bible.locations || bible.locations.length === 0) return '(no predefined locations)'
    const setting = (sceneRef.setting || '').trim()
    const matched = bible.locations.find(l => l.name === setting)
              || bible.locations.find(l => setting.includes(l.name) || l.name.includes(setting))
    return matched ? `- ${matched.name}: ${matched.visualPrompt}` : `- ${setting}: (use environment DNA below)`
  })()

  const resilienceNote = 'RESILIENCE: If content is blocked, return a safe/neutral version. NEVER return null or empty strings.'

  const intro = isRegenerate
    ? `[씬 정보 재생성 — SCENE INFO REGENERATION]
이미지는 이미 존재합니다. 이미지 생성 프롬프트를 포함한 모든 씬 정보를 재생성해주세요.
씬에 배정된 대본 구간을 바탕으로 연출 정보를 새로 작성합니다.

[배정된 대본 블럭 — PRIMARY SOURCE]:
${sceneRef.fullScriptSegment || sceneRef.scriptReference || '(없음)'}

[검색 앵커 (30자 — 참조만 할 것, 내용 생성에 사용 금지)]:
${(sceneRef.scriptReference || '').slice(0, 60)}

[씬 ID]: ${sceneRef.id}
[씬 배경(Setting)]: ${sceneRef.setting || ''}`
    : `[CINEMATIC SCENE GENERATION - ULTRA DETAILED]

[FULL SCRIPT CONTEXT — UNDERSTAND THE ENTIRE STORY]:
${cleanScript(bible._fullScript || sceneRef.scriptReference || '')}

[ORIGINAL SCRIPT CONTEXT — FULL ASSIGNED SEGMENT]:
${sceneRef.fullScriptSegment || sceneRef.scriptReference}

[SEARCH ANCHOR (30-char display only — do NOT use for content generation)]:
${(sceneRef.scriptReference || '').slice(0, 60)}

[SCENE OUTLINE]: ${JSON.stringify(sceneRef)}`

  return `${intro}

[CANON BIBLE]:
- Environment: ${bible.environment?.description || ''}
- Visual DNA: ${bible.environment?.visualPrompt || ''}
- Camera Style: ${bible.camera?.style || ''}, ${bible.camera?.lens || ''}
- Tone: ${bible.tone || ''}

[LOCATION - THIS SCENE'S SETTING]:
${locationInfo}

[CHARACTER ROSTER (Names Only) - ONLY THESE CHARACTERS EXIST IN THIS SCENE]:
[FULL CHARACTER ROSTER - CHOOSE WHO APPEARS IN THIS SCENE]:
${characterRoster}

${langConfig.outputInstruction}

[ACTOR RULES]:
⚠️ NAMED actors listed above are the FOCAL POINT. Their appearance (age/outfit/hair) is ISOLATED — do NOT mix between actors.
⚠️ IF Historical Drama (사극): dragon robes(용포) = royalty ONLY. IF Modern: NO traditional clothes.
⚠️ CRITICAL APPEARANCE OVERRIDE: YOU MUST COMPLETELY IGNORE the script's clothing descriptions.
⚠️ USE ACTOR TAGS: Your \`imagePrompt\` and \`action\` MUST use the EXACT [ACTOR-X] tags to refer to characters instead of their names or pronouns (e.g., "[ACTOR-A] looks at [ACTOR-B]"). DO NOT hallucinate script-based clothing.
⚠️ NEVER CREATE CLONES: Use each ACTOR-X tag exactly once for their single physical body.
⚠️ ANTI-CLONE PROTOCOL (CRITICAL!):
   - If you add background figures (staff, passersby), you MUST explicitly describe them as "faceless, distant, generic silhouettes".
   - NEVER describe a background character doing the exact same action or wearing the same clothes as the [ACTOR].

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${directorMode} — HIGHEST PRIORITY]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are not describing a scene. You are DIRECTING a movie or illustration.
Your imagePrompt must be a DIRECTOR'S SHOT DESCRIPTION that captures the single most emotionally devastating moment.

[STEP 1 — FIND THE EMOTIONAL PEAK]:
Read the scriptReference carefully. Find the ONE MOMENT of maximum emotional intensity.
Ask yourself: "What is the exact millisecond that would make an audience gasp, weep, or hold their breath?"

[STEP 2 — CHOOSE YOUR FILM TECHNIQUE]:
• GRIEF / DESPAIR → Extreme Close-Up on face or trembling hands. Desaturated blue-grey palette. Shallow depth of field.
• RAGE / CONFRONTATION → Over-The-Shoulder shot. High contrast harsh side lighting. Warm amber rage tones.
• HOPE / REUNION → Wide Shot with characters small against vast beautiful environment. Warm golden backlight.
• SHOCK / REVELATION → Dutch angle (camera tilted 15°). Harsh flat frontal light. Hyper-sharp focus.
• LONGING / SEPARATION → Medium shot with character isolated on one side of frame. Muted, cold palette. Long negative space.
• POWER / TRIUMPH → Low angle shot looking up at character. Dramatic rim lighting. Saturated bold colors.
• FEAR / DREAD → Character seen from behind, facing something threatening. Dark shadows. Minimal light.
• TENDERNESS / LOVE → Close-Up with soft diffused light. Warm skin tones. Rack focus between two faces.

[STEP 3 — WRITE THE imagePrompt]:
Format: "[SHOT TYPE]: [what characters are doing at peak moment, specific physical actions using [ACTOR-X] tags]. [LIGHTING description]. [COLOR PALETTE / MOOD]. [KEY ENVIRONMENTAL DETAIL that amplifies emotion]."
⚠️ [ENGLISH ONLY & NO REAL NAMES]: The 'imagePrompt' and 'videoPromptEn' fields MUST BE 100% IN ENGLISH. NO KOREAN. ONLY use tags like [ACTOR-A]!

BAD imagePrompt: "A woman stands in a pharmacy looking worried."
GOOD imagePrompt: "EXTREME CLOSE-UP: trembling hands clutching crumpled prescription paper across a pharmacy counter at 3AM — fluorescent light harshly illuminating tear-streaked cheeks, a pharmacist's blurred silhouette in background hesitating. Ice-blue desaturated palette. A single crushed flower petal dropped on the counter."

⚠️ [imagePrompt ABSOLUTE PROHIBITION — NO EXCEPTIONS]:
- NO visible text, letters, words, signs, signage, banners, posters, newspapers, books with visible text, chalkboards, whiteboards, or any surface displaying readable characters.
- NO subtitles, captions, title cards, watermarks in the scene description.
- The scene must be PURELY VISUAL — zero textual elements in the rendered frame.

[MANDATORY DIALOGUE RULE]:
⚠️ EVERY scene MUST have dialogue field filled:
   - Provide ONLY a short snippet (around 8 seconds of speech). DO NOT copy the entire script length here!
   - NO double quotes. Do not add extra surrounding quotes.
   - If characters speak → use their exact spoken words from the scriptReference. DO NOT INCLUDE THE SPEAKER'S NAME.
   - If no dialogue → use the narration from the script narration. DO NOT INCLUDE "나레이션: " PREFIX.
   - NEVER invent dialogue not present in the scriptReference.

[MANDATORY SHOT TYPE RULE]:
⚠️ For the "shotType" field, output ONLY the exact camera shot name (e.g., "Medium Shot", "Close-up", "Wide Shot"). DO NOT add any extra descriptions.

⚠️ DO NOT generate any screenText. Leave the "screenText" field as an empty string "".

[MANDATORY CHARACTER RULE]:
⚠️ For the "involvedCharacters" array, you MUST use the exact ORIGINAL KOREAN NAMES (e.g., "민기", "지은"), NOT the "ACTOR-X" labels. Return an empty array [] if no humans are in the scene.
⚠️ CRITICAL PRESENCE CHECK: ONLY include characters who are PHYSICALLY PRESENT AND VISIBLE.
⚠️ PRESERVE ABSENT NAMES IN TEXT: If a character is absent but mentioned in the script, MUST preserve their true Korean name in the 'action' and 'description'.
⚠️ NEVER output twins, clones, or multiple generic figures if only ONE named character is acting.

${langConfig.costumeHierarchy || ''}
[STYLE]: ${stylePreset.prompt}

${resilienceNote}`
}

// ─── 씬 1개 생성 ──────────────────────────────────────────────────────────────
export async function generateSingleSceneInfo(sceneRef, bible, stylePreset, langConfig, currentMode = 'normal') {
  const client = await createClient()
  const prompt = currentMode === 'editorial'
    ? buildEditorialScenePrompt(sceneRef, bible, stylePreset, langConfig)
    : buildScenePrompt(sceneRef, bible, stylePreset, langConfig, false)

  const res = await withRetry(() =>
    safeGenerate(client, {
      model:   TEXT_MODEL,
      contents: prompt,
      config:  {
        safetySettings: SAFETY_SETTINGS,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            action:             { type: Type.STRING },
            imagePromptKo:      { type: Type.STRING },
            imagePrompt:        { type: Type.STRING },
            videoPromptKo:      { type: Type.STRING },
            videoPromptEn:      { type: Type.STRING },
            cameraMovement:     { type: Type.STRING },
            shotType:           { type: Type.STRING },
            dialogue:           { type: Type.STRING },
            screenText:         { type: Type.STRING },
            duration:           { type: Type.STRING },
            description:        { type: Type.STRING },
            involvedCharacters: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['action','imagePromptKo','imagePrompt','videoPromptKo','videoPromptEn','cameraMovement','shotType','description','dialogue','duration','involvedCharacters'],
        },
      },
    }, `씬 생성(${sceneRef.id})`)
  , 3, `씬 생성(${sceneRef.id})`)

  const text = res?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  const raw  = parseJson(text, `씬(${sceneRef.id})`, {})

  const chars = bible.characters || []
  const resolvedCharacters = []
  ;(raw.involvedCharacters || []).forEach(entry => {
    const match = entry.match(/(ACTOR|KEY)[-_]?([A-Z])/i)
    if (match) {
      const idx = match[2].toUpperCase().charCodeAt(0) - 65
      if (idx >= 0 && idx < chars.length) {
        const name = chars[idx].name
        if (!resolvedCharacters.includes(name)) resolvedCharacters.push(name)
        return
      }
    }
    const name = entry.trim()
    if (chars.some(c => c.name === name) && !resolvedCharacters.includes(name)) {
      resolvedCharacters.push(name)
    }
  })

  return {
    ...cleanSceneOutput(raw, chars),
    id:               sceneRef.id || `scene_${Date.now()}`,
    involvedCharacters: resolvedCharacters,
    setting:          sceneRef.setting || raw.setting || '',
    scriptReference:  sceneRef.scriptReference || '',
    scriptAnchor:     (sceneRef.scriptReference || '').replace(/\n/g, ' ').trim().slice(0, 30),
    fullScriptSegment: sceneRef.fullScriptSegment || sceneRef.scriptReference || '',
    imageUrl:         null,
    imageError:       null,
  }
}

// ─── 씬 재생성 (ra 함수 이식) ─────────────────────────────────────────────────
export async function regenerateScene(sceneRef, bible, stylePreset, lang = 'ko') {
  const client     = await createClient()
  const langConfig = LANG_CONFIGS[lang] || LANG_CONFIGS.ko
  const prompt     = buildScenePrompt(sceneRef, bible, stylePreset, langConfig, true)

  const res = await withRetry(() =>
    safeGenerate(client, {
      model:   TEXT_MODEL,
      contents: prompt,
      config:  {
        safetySettings: SAFETY_SETTINGS,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            action:             { type: Type.STRING },
            description:        { type: Type.STRING },
            imagePromptKo:      { type: Type.STRING },
            imagePrompt:        { type: Type.STRING },
            videoPromptKo:      { type: Type.STRING },
            videoPromptEn:      { type: Type.STRING },
            cameraMovement:     { type: Type.STRING },
            shotType:           { type: Type.STRING },
            dialogue:           { type: Type.STRING },
            screenText:         { type: Type.STRING },
            duration:           { type: Type.STRING },
            involvedCharacters: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['action','description','imagePromptKo','imagePrompt','videoPromptKo','videoPromptEn','cameraMovement','shotType','dialogue','screenText','duration','involvedCharacters'],
        },
      },
    }, `씬 재생성(${sceneRef.id})`)
  , 3, `씬 재생성(${sceneRef.id})`)

  const text = res?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  const raw  = parseJson(text, `씬재생성(${sceneRef.id})`, {})

  const chars = bible.characters || []
  const resolvedCharacters = []
  ;(raw.involvedCharacters || []).forEach(entry => {
    const match = entry.match(/(ACTOR|KEY)[-_]?([A-Z])/i)
    if (match) {
      const idx = match[2].toUpperCase().charCodeAt(0) - 65
      if (idx >= 0 && idx < chars.length) {
        const name = chars[idx].name
        if (!resolvedCharacters.includes(name)) resolvedCharacters.push(name)
        return
      }
    }
    const name = entry.trim()
    if (chars.some(c => c.name === name) && !resolvedCharacters.includes(name)) resolvedCharacters.push(name)
  })

  const merged = {
    action:        raw.action        || sceneRef.action,
    description:   raw.description   || sceneRef.description,
    imagePromptKo: raw.imagePromptKo || sceneRef.imagePromptKo,
    imagePrompt:   raw.imagePrompt   || sceneRef.imagePrompt,
    videoPromptKo: raw.videoPromptKo || sceneRef.videoPromptKo,
    videoPromptEn: raw.videoPromptEn || sceneRef.videoPromptEn,
    dialogue:      raw.dialogue      || sceneRef.dialogue,
    screenText:    raw.screenText    || sceneRef.screenText,
  }

  return {
    ...cleanSceneOutput(merged, chars),
    cameraMovement:     raw.cameraMovement || sceneRef.cameraMovement,
    shotType:           raw.shotType       || sceneRef.shotType,
    duration:           raw.duration       || sceneRef.duration,
    involvedCharacters: resolvedCharacters,
  }
}

// ─── 전체 씬 생성 (어댑티브 동시성) ──────────────────────────────────────────
export async function generateAllScenes(scriptText, bible, stylePreset, lang, onProgress, maxScenes = 30, currentMode = 'normal') {
  const langConfig   = LANG_CONFIGS[lang] || LANG_CONFIGS.ko
  const bibleCtx     = { ...bible, _fullScript: scriptText }
  const rawScenes    = await splitScriptToScenes(scriptText, maxScenes)
  const total        = rawScenes.length
  const results      = new Array(total).fill(null)

  onProgress(0, total)

  let concurrency  = 1
  let stableCount  = 0
  let failCount429 = 0
  let i = 0

  while (i < total) {
    const chunk   = rawScenes.slice(i, i + concurrency)
    const indices = chunk.map((_, j) => i + j)

    try {
      const settled = await Promise.allSettled(
        chunk.map((scene, j) => generateSingleSceneInfo(scene, bibleCtx, stylePreset, langConfig, currentMode))
      )

      for (let k = 0; k < settled.length; k++) {
        const r   = settled[k]
        const idx = indices[k]
        if (r.status === 'fulfilled') {
          results[idx] = r.value
        } else {
          const err = r.reason?.message || '씬 생성 실패'
          results[idx] = makeFallbackScene(rawScenes[idx], idx, err)
        }
      }

      const step = chunk.length  // 실제 처리한 씬 수 (concurrency 변경 전 저장)
      stableCount++
      if (stableCount >= 3 && concurrency < 3) {
        concurrency++
        stableCount = 0
        console.log(`[ADAPTIVE] 동시성 증가 → ${concurrency}`)
      }
      failCount429 = 0

      onProgress(indices[indices.length - 1] + 1, total)
      i += step  // 증가 전 실제 처리된 씬 수로 전진
      if (i < total) await new Promise(r => setTimeout(r, 1500))

    } catch (err) {
      stableCount = 0
      const msg   = err.message || ''
      const is429 = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
      const is503 = msg.includes('503') || msg.includes('overloaded') || msg.includes('UNAVAILABLE')

      if ((is429 || is503) && concurrency > 1) {
        concurrency = Math.max(1, concurrency - 1)
        const wait = is429 ? 15000 : 5000
        console.warn(`[ADAPTIVE] 동시성 감소 → ${concurrency}, ${wait / 1000}초 대기`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }

      if (is429 && concurrency === 1) {
        failCount429++
        if (failCount429 >= 3) {
          console.warn('[RATE LIMIT EXHAUSTED] 429가 3회 이상 — 나머지 씬 폴백 처리')
        } else {
          console.warn(`[RATE LIMIT] 30초 대기 후 재시도 (${failCount429}/3)`)
          await new Promise(r => setTimeout(r, 30000))
          continue
        }
      }

      console.error(`[FATAL] 씬 배치 ${i} 실패:`, msg)
      rawScenes.slice(i).forEach((s, j) => {
        if (!results[i + j]) results[i + j] = makeFallbackScene(s, i + j, msg)
      })
      onProgress(total, total)
      break
    }
  }

  return results
}

function makeFallbackScene(rawScene, idx, errMsg) {
  return {
    id:               rawScene?.id || `scene_fallback_${idx}`,
    scriptReference:  rawScene?.scriptReference || '',
    scriptAnchor:     (rawScene?.scriptReference || '').slice(0, 30),
    fullScriptSegment: rawScene?.fullScriptSegment || rawScene?.scriptReference || '',
    action:           `씬 ${idx + 1}`,
    description:      '생성 실패 (재생성 버튼을 눌러주세요)',
    imagePrompt:      '',
    imagePromptKo:    '',
    videoPromptEn:    '',
    videoPromptKo:    '',
    cameraMovement:   'Static',
    dialogue:         '',
    screenText:       '',
    shotType:         'Medium Shot',
    duration:         '3초',
    setting:          rawScene?.setting || '',
    involvedCharacters: [],
    imageUrl:         null,
    imageError:       errMsg,
    generationError:  errMsg,
  }
}
