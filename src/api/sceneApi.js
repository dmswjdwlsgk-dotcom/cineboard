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

// 스크립트를 정확히 n개 세그먼트로 분할 (문장 경계 우선 스냅)
function programmaticSplit(scriptText, n) {
  const cleaned = cleanScript(scriptText).replace(/\s{2,}/g, ' ').trim()
  if (!cleaned || n <= 0) return []

  // ── 헬퍼: 유닛 배열을 n개 청크로 그루핑 ───────────────────────────────────
  const groupIntoN = (units, count, sep = ' ') => {
    const chunks = []
    const base   = Math.floor(units.length / count)
    let rem      = units.length % count
    let cursor   = 0
    for (let i = 0; i < count; i++) {
      const size = base + (rem-- > 0 ? 1 : 0)
      chunks.push(units.slice(cursor, cursor + size).join(sep).trim())
      cursor += size
    }
    return chunks.filter(Boolean)
  }

  // ── 헬퍼: 단어 배열을 n개 청크로, 문장/절 경계 우선 스냅 ─────────────────
  const groupWordsRespectBoundary = (words, count) => {
    if (words.length <= count) return words.map(w => w)
    const targetLen = words.length / count
    const chunks    = []
    let start       = 0
    for (let i = 0; i < count - 1; i++) {
      const idealEnd = Math.round((i + 1) * targetLen)
      const radius   = Math.max(2, Math.floor(targetLen * 0.45))
      const lo       = Math.max(start + 1, idealEnd - radius)
      const hi       = Math.min(words.length - (count - i - 1), idealEnd + radius)
      let breakAt    = idealEnd
      // 뒤에서부터 문장 끝 단어 탐색 (.!?。！？)
      for (let j = hi; j >= lo; j--) {
        if (/[.!?。！？]$/.test(words[j - 1])) { breakAt = j; break }
      }
      // 없으면 쉼표/절 경계
      if (breakAt === idealEnd) {
        for (let j = hi; j >= lo; j--) {
          if (/[,，、;；]$/.test(words[j - 1])) { breakAt = j; break }
        }
      }
      chunks.push(words.slice(start, breakAt).join(' ').trim())
      start = breakAt
    }
    chunks.push(words.slice(start).join(' ').trim())
    return chunks.filter(Boolean)
  }

  // 1차: 문장 단위 분할
  const sentences = cleaned
    .split(/([.!?。！？]+(?:\s+|$))/)
    .reduce((acc, part, idx) => {
      if (idx % 2 === 0) { if (part.trim()) acc.push(part.trim()) }
      else if (acc.length > 0) acc[acc.length - 1] += part.trimEnd()
      return acc
    }, [])
    .filter(s => s.trim().length > 0)

  if (sentences.length >= n) {
    // 문장이 충분 → 문장 단위 그루핑
    const chunks = groupIntoN(sentences, n, ' ')
    return makeScenes(chunks)
  }

  // 2차: 쉼표/절 단위로도 추가 분할
  const clauses = sentences.flatMap(s =>
    s.split(/(?<=[,，、;；])\s*/).map(c => c.trim()).filter(Boolean)
  )

  if (clauses.length >= n) {
    const chunks = groupIntoN(clauses, n, ' ')
    return makeScenes(chunks)
  }

  // 3차: 단어 단위 + 문장 경계 스냅
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length >= n) {
    const chunks = groupWordsRespectBoundary(words, n)
    return makeScenes(chunks)
  }

  // 4차: 글자 단위 (극단적 케이스)
  const chars  = cleaned.split('').filter(c => c.trim().length > 0)
  const chunks = groupIntoN(chars, Math.min(n, chars.length), '')
  return makeScenes(chunks)
}

function makeScenes(chunks) {
  return chunks.map((seg, i) => ({
    id:               `P${String(i + 1).padStart(2, '0')}`,
    scriptReference:  seg.slice(0, 30).replace(/\n/g, ' '),
    scriptAnchor:     seg.slice(0, 30).replace(/\n/g, ' '),
    startAnchor:      seg.slice(0, 40),
    setting:          '',
    fullScriptSegment: seg,
  }))
}

// AI로 각 세그먼트의 setting(배경) 보강
async function enrichSceneSettings(scenes, client) {
  const prompt = `다음 씬 목록의 각 씬에 대해 "setting"(장소와 시간대, 한국어)을 채워 반환하라.
씬 내용을 읽고 배경을 추론하라. 알 수 없으면 "미상"으로 쓸 것.

씬 목록 (JSON):
${JSON.stringify(scenes.map(s => ({ id: s.id, text: s.fullScriptSegment.slice(0, 120) })))}

결과: JSON 배열로 [{"id":"P01","setting":"..."},...] 형식만 반환.`

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

// ─── 비주얼 모드 지침 생성 (원본 Cr 함수 이식) ────────────────────────────────
function getVisualModeInstruction(visualMode, withTextIntegration = false) {
  switch (visualMode) {
    case 'content': return `
[📊 CONTENT VISUALIZATION MODE — HIGHEST PRIORITY — OVERRIDES ALL OTHER MODES]
⚠️ THIS IS NOT CHARACTER MODE. DO NOT focus on character faces or emotions.
The imagePrompt MUST visualize the TOPIC/CONCEPT being discussed, NOT the people speaking.
You are a VISUAL INFORMATION DIRECTOR. Every scene must deliver a DIFFERENT, SURPRISING visual metaphor.

[🎨 VISUAL PATTERN LIBRARY — PICK THE MOST FITTING, NEVER REPEAT THE SAME PATTERN]:
- Rising/falling stats → PHYSICAL HEIGHT drama: rocket bursting through clouds, cliff-edge free-fall, staircase ascending into light
- Large numbers/percentages → GIANT 3D NUMERALS towering over cityscapes like skyscrapers, glowing neon
- Comparisons/rankings → Side-by-side SCALE CONTRASTS: tiny vs enormous objects, balance scale tipping, podium with height differences
- Money/economy → Coin towers, flowing gold rivers, stock ticker tape storms, vault doors, crumbling buildings of cash
- Policy/law/regulation → Architectural metaphors: massive walls, iron gates slamming, official stamp crushing, courthouse columns
- Time/history → Clocks, hourglasses, calendar pages flying, tree rings, layered geological strata
- Health/medicine → Body interior environments, cellular battles, DNA strands, organ cross-sections
- Technology/AI → Glowing circuit networks, neural pathway highways, data streams as rivers of light
- Environment/nature → Contrasting split-frame (before/after), ecosystem collapse or bloom, weather metaphors
- Population/society → Crowd density maps, human silhouette arrays, migration flow arrows as rivers
- Crisis/danger → Dark storm clouds massing, red warning signals, cracking infrastructure, flood metaphors
- Growth/success → Seed sprouting into giant tree, sunrise over horizon, construction rising, green shoots in concrete

[📐 COMPOSITION — CINEMATIC INFOGRAPHIC]:
- Information concept fills 60%+ of the frame — make it MONUMENTAL, not a small detail
- Prefer DRAMATIC PERSPECTIVES: low angle looking up, bird's eye looking down, forced perspective
- Lighting: high contrast, dramatic — use light to direct focus to the KEY data point
- Color language: 🔴 red/orange = danger/decline, 🟢 green/gold = growth/positive, 🔵 blue = neutral/data, purple = power/authority
- Background: context environment rendered in 3D depth, slight bokeh to keep focus on hero concept
- Style: cinematic 3D render OR premium motion graphics aesthetic — NOT flat clipart, NOT stock photo

${withTextIntegration ? `[📝 INFOGRAPHIC TEXT INTEGRATION — ACTIVE]
⚠️ This image SHOULD include KEY DATA POINTS as INTEGRATED visual text elements.
- Render the EXACT text from the "screenText" field as BOLD, HIGH-CONTRAST typography
- Text style: Clean modern sans-serif (Noto Sans, Pretendard, Helvetica Neue)
- Text placement: BOTTOM-CENTER or TOP-LEFT, with semi-transparent dark backdrop
- Text must be ORGANICALLY INTEGRATED — NOT randomly floating
- Color-code: 🔴 Red for negative/danger, 🟢 Green for positive/growth, 🔵 Blue for neutral
- Use geometric containers (rounded rectangles, circles) to frame key numbers
- Think: Bloomberg Terminal, The Economist, 삼프로TV, JTBC 뉴스룸 broadcast graphics
` : ''}
[❌ PROHIBITIONS]:
- ❌ Human characters as subject (presenter, narrator, expert talking to camera)
- ❌ Flat 2D clipart or PowerPoint-style graphics
- ❌ Generic stock photo aesthetics (objects on white background)
- ❌ Same visual pattern used in the previous scene — VARY the metaphor each time
- The 'involvedCharacters' array should be EMPTY [] unless a character physically appears
`
    case 'immersive': return `
[🎬 IMMERSIVE ENVIRONMENT MODE — OVERRIDE]
⚠️ The ENVIRONMENT is the PROTAGONIST. Every frame must make the viewer feel PHYSICALLY PRESENT in the space.

[DEPTH LAYERING — MANDATORY 3-LAYER COMPOSITION]:
- FOREGROUND (0-2m): A textured element slightly OUT OF FOCUS creating tactile proximity — wet leaves on ground, stone fence edge, rain droplets on glass surface, candlelight flame, wooden railing, blowing curtain fabric
- MIDGROUND (2-20m): The PRIMARY environmental subject — the path, the building, the landscape feature, the atmospheric event
- BACKGROUND (20m+): Atmospheric depth receding into distance — mountain silhouettes, city skyline glow, fog bank, cloud formations, distant forest treeline

[ATMOSPHERIC PRESENCE — MANDATORY]:
- Render VOLUMETRIC ATMOSPHERE visible in the frame: fog particles catching light, dust motes floating in sunbeams, rain streaks angled by wind, snow flurries, steam rising from ground, heat haze shimmer
- Light MUST interact with atmosphere: god rays piercing through forest canopy, neon sign reflections on wet pavement, firelight dancing on cave walls, moonlight filtering through clouds

[HUMAN SCALE REFERENCE]:
- Characters appear as SMALL FIGURES occupying LESS THAN 15% of the frame
- Show them from BEHIND walking away, SILHOUETTED against landscape, or as TINY specks
- Their POSTURE and BODY LANGUAGE tells the emotional story, NOT their faces
- 'involvedCharacters' can include names but the imagePrompt renders them distant/small
`
    case 'docu': return `
[📰 DOCUMENTARY RECONSTRUCTION MODE — OVERRIDE]
⚠️ Recreate scenes as if captured by an ARCHIVAL CAMERA of the depicted era. The image must feel like a DISCOVERED PHOTOGRAPH or DOCUMENTARY FILM STILL.

[CINEMATIC GRADING — MANDATORY FILM TREATMENT]:
- Apply visible FILM GRAIN texture (ISO 800-1600 equivalent noise pattern)
- Add subtle VIGNETTING: 15-25% edge darkening that draws attention to center
- DESATURATED color palette: reduce saturation 30-40% below normal vibrant levels
- COLOR TEMPERATURE by era: Pre-1900s=SEPIA TONES, 1900s-1950s=HIGH-CONTRAST B&W, 1960s-1970s=FADED KODACHROME, 1980s-1990s=WARM VHS, 2000s+=COLD DIGITAL

[COMPOSITION — DOCUMENTARY OBSERVATIONAL FRAMING]:
- CANDID positioning: subjects placed slightly OFF-CENTER, natural compositions that feel UNPOSED
- Characters appear UNAWARE of the camera — documentary observational gaze, not portrait posing
- MEDIUM SHOTS (waist-up) and MEDIUM-WIDE shots are the PRIMARY framing choices
- Every frame MUST contain at least 3 ERA-SPECIFIC OBJECTS (period furniture, tools, vehicles, clothing styles, architecture)
- Think like an EBS DOCUMENTARY DIRECTOR or HISTORY CHANNEL RECONSTRUCTION SUPERVISOR
`
    case 'webtoon': return `
[📖 KOREAN WEBTOON / MANHWA MODE — OVERRIDE]
⚠️ This is a KOREAN WEBTOON (한국 웹툰) key panel, NOT Japanese manga and NOT Western comic book.

[VISUAL STYLE — KOREAN WEBTOON AESTHETIC]:
- CLEAN DIGITAL LINEART: consistent medium-weight lines, smooth anti-aliased curves
- KOREAN WEBTOON COLOR PALETTE: vibrant but NOT neon — rich saturated colors with soft pastel gradients in shadow areas
- CEL-SHADING with SOFT GRADIENT SHADOWS — smooth color transitions
- Character proportions: 6-7 head-tall REALISTIC-STYLIZED hybrid

[EMOTIONAL AMPLIFICATION — MANDATORY BACKGROUND EFFECTS]:
- 😱 SHOCK: Radiating SPEED LINES exploding outward + WHITE or DARK background wipe-out
- 😡 ANGER: Dark RED-BLACK gradient aura, ground CRACKING beneath feet
- 💕 ROMANCE: Floating SPARKLES and soft BOKEH circles, warm PINK-PEACH gradient
- 😢 SADNESS: RAIN EFFECT with visible streaks, heavily DESATURATED muted palette
- ⚡ ACTION: Bold MOTION BLUR lines, ZOOM-BURST effect, HIGH CONTRAST lighting

[🖼️ FULL-BLEED CANVAS MANDATE]: The illustration MUST extend to ALL FOUR EDGES with ZERO white space.
`
    case 'mv': return `
[🎵 MUSIC VIDEO (MV) MODE — OVERRIDE]
⚠️ THIS IS A MUSIC VIDEO SHOOT. Every frame must feel like a K-POP / cinematic music video key frame.

[🎤 LYRICS-TO-VISUAL TRANSLATION]:
Analyze the EMOTIONAL FREQUENCY and determine the song section:
- VERSE: Cinematic establishing shots, cool muted tones (teal/slate blue), slow steady tracking
- PRE-CHORUS: Tighter framing, increasing visual density, building tension
- CHORUS: MAXIMUM ENERGY — explosive wide shots, saturated vivid colors, dramatic lighting, motion blur
- BRIDGE: Introspective — lone performer in vast space, moody color grade, intimate framing

[VISUAL TREATMENT]:
- Concert-grade stage lighting: laser grids, volumetric haze, colored strobes
- Heavy CINEMATIC COLOR GRADE: teal+orange for drama, pink+purple for romance, red+black for intensity
- Performer silhouettes against dramatic backdrops
- Dynamic foreshortening and extreme angles
`
    case 'documix': return `
[📰 DOCUMIX DIRECTOR MODE — DOCUMENTARY + CONTENT HYBRID — HIGHEST PRIORITY — OVERRIDES ALL OTHER MODES]
You are directing a Korean INFORMATION CHANNEL (정보 채널). Your audience is general public, including older viewers.

STEP 1 — ANALYZE the narration and DECIDE which mode to apply for this scene:
- NUMBERS, STATISTICS, PERCENTAGES, COMPARISONS, RANKINGS, DATES with data, POLICY DETAILS → CONTENT mode
- Real-world scenes, people, places, events, emotional moments, stories → DOCU mode

STEP 2A — [DOCU EXECUTION when chosen]:
You are a DOCUMENTARY CINEMATOGRAPHER. Capture the single most powerful observational moment.
- Candid, unposed framing — subjects slightly off-center, unaware of camera
- Film grain texture, subtle vignette, desaturated palette
- Medium/medium-wide shots, at least 3 realistic environmental props
- Feel like an EBS or KBS 다큐멘터리 still frame
- Find the EMOTIONAL PEAK of the scene: a revealing expression, a decisive gesture, a human moment
- GRIEF / DESPAIR → Extreme Close-Up on face or hands. Desaturated blue-grey palette.
- HOPE / DETERMINATION → Wide Shot, subject small against meaningful environment. Warm backlight.
- TENSION / CONFRONTATION → Over-the-shoulder. Harsh side lighting. High contrast.
- TENDERNESS / DAILY LIFE → Close-Up, soft diffused natural light. Warm tones.
- Camera angle: low or eye-level. Never high-angle unless showing isolation.

STEP 2B — [CONTENT EXECUTION when chosen]:
⚠️ THIS IS NOT CHARACTER MODE. DO NOT focus on character faces or emotions.
The imagePrompt MUST visualize the TOPIC/CONCEPT being discussed, NOT the people speaking.
- Focus on INFOGRAPHIC-STYLE compositions: graphs, charts, data visualizations, abstract concepts made visual
- Show OBJECTS, ENVIRONMENTS, and SYMBOLIC imagery representing the CONTENT of the narration
- Characters should be MINIMAL or ABSENT from the frame. If present, show them from behind, silhouetted, or as small figures
- Use METAPHORICAL imagery: e.g., if discussing "rising prices" → show towering stacks of coins, if "environmental crisis" → show contrasting landscapes
- Think like a NEWS GRAPHICS DESIGNER — Bloomberg Terminal, The Economist, 삼프로TV, JTBC 뉴스룸 aesthetic
- Rising/falling stats → PHYSICAL HEIGHT changes (rocket launch for growth, cliff-fall for crash)
- Large numbers → GIANT 3D NUMERALS towering over environments like skyscrapers
- Comparisons → Side-by-side physical scale contrasts, balance scale metaphors
- Policy/law → Architectural metaphors (walls, gates, stamps, official seals)
- Prefer WIDE SHOTS and BIRD'S EYE views over close-ups
- The 'involvedCharacters' array should usually be EMPTY [] unless a character physically appears

[COMMIT FULLY]: Once you choose DOCU or CONTENT for a scene, apply ALL its rules. Do NOT blend the two.
`
    case 'auto': return `
[⚡ SMART AUTO MODE — AI DIRECTOR'S CHOICE]
You are the DIRECTOR. Analyze the script narration content of each scene and CHOOSE the single most impactful visual approach.

[DECISION CRITERIA — ANALYZE THE NARRATION AND PICK ONE]:
1. If the narration describes a CHARACTER'S EMOTIONAL MOMENT (crying, arguing, confessing, reacting):
   → Use CHARACTER mode: Close-up on face, dramatic single-source lighting, emotion-driven composition
2. If the narration presents DATA, STATISTICS, COMPARISONS, or ABSTRACT CONCEPTS (economy, science, analysis):
   → Use CONTENT mode: Infographic-style imagery, symbolic metaphors, charts/graphs, objects representing concepts
3. If the narration describes a LOCATION, LANDSCAPE, JOURNEY, or ATMOSPHERE (a place, weather, scenery):
   → Use IMMERSIVE mode: 3-layer depth composition, wide environmental shot, tiny human figures
4. If the narration references HISTORICAL EVENTS, PAST ERAS, or REAL-WORLD RECONSTRUCTION:
   → Use DOCU mode: Film grain texture, desaturated period-appropriate color grading, observational angle
5. If the narration contains SONG LYRICS, MUSICAL PERFORMANCE, or RHYTHM-DRIVEN CONTENT:
   → Use MV mode: Concert-grade lighting, performer silhouettes, dynamic camera movement

[COMPOSITION EXECUTION]:
- After choosing the mode, apply ALL visual rules of that mode fully
- Commit 100% to the chosen approach — do NOT blend or compromise between modes
- The imagePrompt must clearly reflect the chosen visual strategy
`
    case 'infoviz': return `
[🧬 INFOVIZ MODE — 정보 시각화 최우선 · INFORMATION IS THE PROTAGONIST]
⚠️ CRITICAL OVERRIDE: This is NOT character mode, NOT content mode. The INFORMATION ELEMENT is the HERO of every frame.
⚠️ DO NOT draw any human characters (narrators, doctors, experts, presenters). ZERO HUMANS in the frame.
⚠️ DO NOT generate flat infographics, boring charts, or PowerPoint-style layouts. This is CINEMATIC 3D VISUALIZATION.

[🎭 VISUAL METAPHOR ENGINE — CORE PRINCIPLE]:
Transform ABSTRACT INFORMATION into PHYSICAL, DRAMATIC, CINEMATIC ACTION scenes.
Every piece of information must become a VISUAL STORY with:
1. ANTHROPOMORPHISM: Give the information element (food, chemical, concept) a PERSONALITY — eyes, expression, body language, pose
2. CONTEXT SPACE: Place the element inside the ENVIRONMENT where it naturally acts (inside human body, financial cityscape, molecular world, neural pathways)
3. ACTION VERB: The element must be DOING something dramatic — fighting, protecting, building, destroying, healing, growing

[🏥 HEALTH/MEDICAL DOMAIN PATTERNS]:
- Food ingredients/nutrients → Anthropomorphized 3D HERO CHARACTERS with the food's natural color/texture as their "skin"
  · Cabbage → Green knight with leaf-armor shielding stomach wall from acid attacks
  · Broccoli → Forest-green warrior wielding antioxidant energy sword against dark bacteria monsters
  · Flaxseed → Golden liquid character coating and healing damaged intestinal walls
  · Vitamin C → Glowing orange orb powering up white blood cell warriors
- Human organs → 3D rendered INTERIOR ENVIRONMENTS (pink mucous membrane walls, blood vessel tunnels, neural highway networks)
- Diseases/bacteria → VILLAIN characters (dark purple/black, menacing, spiky forms)
- Healing/protection → Light shields, energy barriers, golden coating effects, regeneration particles
- Data/statistics → Health bars, power gauges, level-up particle effects floating in the scene

[📈 ECONOMY/FINANCE DOMAIN PATTERNS]:
- Rising/falling metrics → PHYSICAL HEIGHT changes (rocket launch for growth, cliff-fall for crash)
- Interest rates/exchange rates → GIANT 3D NUMBERS towering over cityscapes like skyscrapers
- Inflation → Everyday objects (bread, house, car) INFLATING like balloons, stretching impossibly
- Companies/markets → Chess pieces, gladiator arena, racing track metaphors
- Crisis/boom → Weather metaphors (tsunami wave of red numbers, golden sunshine through clouds)

[🔬 SCIENCE/TECHNOLOGY DOMAIN PATTERNS]:
- Molecules/atoms → MICROSCOPIC WORLD rendered as grand architecture (atom = cathedral, DNA = spiral staircase)
- Physical laws → COSMIC-SCALE dramatic scenes (gravity = giant hand pulling planets, light = golden river flowing)
- AI/computing → Glowing circuits, neural network highways, data streams as rivers of light particles
- Experiments → Moments of discovery — explosive light revelations, doorways to unknown dimensions

[🧠 PSYCHOLOGY/SELF-HELP DOMAIN PATTERNS]:
- Emotions → Color and weather (anger = volcanic eruption, sadness = underwater drowning, joy = sunrise explosion)
- Mental mechanisms → Architectural inner world (walls = mental barriers, doors = opportunities, mirrors = self-reflection, mazes = confusion)
- Growth/change → Butterfly metamorphosis, seed→giant tree, dark cave→bright exit, caterpillar→aircraft
- Relationships → Bridges, threads connecting, shadows merging, mirror reflections

[📐 COMPOSITION RULES — MANDATORY]:
- Information element = 60%+ of the frame area (HERO SHOT, not a small detail)
- Camera: LOW ANGLE looking UP at the information hero for POWER and IMPORTANCE
- Lighting: DRAMATIC RIM LIGHT + VOLUMETRIC GOD RAYS highlighting the information element
- Background: Context space rendered in full 3D detail but slightly DEPTH-BLURRED (bokeh) to keep focus on hero
- Style preference: 3D Pixar/DreamWorks quality render, vibrant saturated colors, subsurface scattering on organic materials
- NO text in the image (text is handled by separate overlay system)
- ONE information element per frame (do NOT crowd multiple concepts into one image)

[❌ ABSOLUTE PROHIBITIONS]:
- ❌ Human characters (narrators, doctors, experts, TV presenters, audience)
- ❌ Plain product photography (just a cabbage on white background = FAIL)
- ❌ Flat 2D infographics (pie charts, bar graphs on plain background = FAIL)
- ❌ PowerPoint/slide-style layouts with text boxes
- ❌ Stock photo aesthetics (generic, lifeless, corporate)
- ❌ The information element just sitting there doing nothing (MUST be in ACTION)

[USE INFO-X TAGS]: Your imagePrompt and action MUST use [INFO-X] tags to refer to information elements.
[MANDATORY]: involvedCharacters MUST list ALL information elements relevant to this scene's script segment.
`
    default: return '' // 'character' → 기본 cinematographer 모드 지침으로 처리
  }
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
function buildScenePrompt(sceneRef, bible, stylePreset, langConfig, isRegenerate = false, visualMode = 'character', isEditorialMode = false) {
  const isIllustration = /illustration|artwork|painting|manhwa|webtoon|anime|ghibli|watercolor|ink wash|clay|wool|diorama|fairy|folklore|3d.*anim|pixar/i.test(stylePreset.prompt)
  const directorMode   = isIllustration
    ? '[🎨 MASTER ILLUSTRATOR/WEBTOON DIRECTOR MODE]'
    : '[🎬 MASTER CINEMATOGRAPHER MODE]'

  const isInfoviz = visualMode === 'infoviz'
  const withTextInt = isEditorialMode && (visualMode === 'content' || visualMode === 'infoviz')
  const visualModeInstruction = getVisualModeInstruction(visualMode, withTextInt)

  const characterRoster = isInfoviz
    ? (bible.characters || []).map((char, i) => {
        const tag = `INFO-${String.fromCharCode(65 + i)}`
        return `- [${tag}: ${char.name}] — ${char.description || '정보 요소'}; VISUAL: ${(char.visualPrompt || 'anthropomorphic 3D character').slice(0, 80)}`
      }).join('\n')
    : (bible.characters || []).map((char, i) => {
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

${isInfoviz
  ? `[INFORMATION ELEMENT ROSTER — ASSIGN AGGRESSIVELY]:
${characterRoster}

⚠️ CRITICAL INFOVIZ ASSIGNMENT RULE:
- You MUST assign EVERY information element mentioned in the script segment to the "involvedCharacters" array.
- SCAN the script segment for ALL mentions of roster elements and include ALL of them.
- Use INFO-X tags in imagePrompt and action fields.`
  : `[CHARACTER ROSTER (Names Only) - ONLY THESE CHARACTERS EXIST IN THIS SCENE]:
[FULL CHARACTER ROSTER - CHOOSE WHO APPEARS IN THIS SCENE]:
${characterRoster}`}

${langConfig.outputInstruction}

${isInfoviz || visualMode === 'documix' || visualMode === 'content' ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${visualModeInstruction}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : `[ACTOR RULES]:
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
⚠️ NEVER output twins, clones, or multiple generic figures if only ONE named character is acting.`}
${langConfig.costumeHierarchy || ''}
[STYLE]: ${stylePreset.prompt}

${resilienceNote}`
}

// ─── 씬 1개 생성 ──────────────────────────────────────────────────────────────
export async function generateSingleSceneInfo(sceneRef, bible, stylePreset, langConfig, currentMode = 'normal', visualMode = 'character', isEditorialMode = false) {
  const client = await createClient()
  const prompt = currentMode === 'editorial'
    ? buildEditorialScenePrompt(sceneRef, bible, stylePreset, langConfig)
    : buildScenePrompt(sceneRef, bible, stylePreset, langConfig, false, visualMode, isEditorialMode)

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
    visualMode:       visualMode,
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
export async function generateAllScenes(scriptText, bible, stylePreset, lang, onProgress, maxScenes = 30, currentMode = 'normal', visualMode = 'character', isEditorialMode = false) {
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
        chunk.map((scene, j) => generateSingleSceneInfo(scene, bibleCtx, stylePreset, langConfig, currentMode, visualMode, isEditorialMode))
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
