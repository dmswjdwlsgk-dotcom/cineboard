import { createClient, SAFETY_SETTINGS, withRetry, safeGenerate, parseJson } from './gemini.js'
import { Type } from '@google/genai'
import { LANG_CONFIGS, detectLanguage, cleanScript, resolveCultureContext } from '../data/languages.js'

const TEXT_MODEL = 'gemini-3.1-flash-lite'

// ─── 연속성 바이블 생성 (원본 hn 함수 이식) ──────────────────────────────────
export async function generateContinuityBible(scriptText, stylePreset) {
  const client = await createClient()
  const lang   = detectLanguage(scriptText)
  const conf   = LANG_CONFIGS[lang] || LANG_CONFIGS.ko
  const cleaned = cleanScript(scriptText)

  // 대본 언어가 아니라 대본이 실제로 다루는 시대·지역에서 외형/복식을 정한다.
  const culture = resolveCultureContext(lang, cleaned)
  console.log(`[CineBoard] 대본 언어 감지: ${lang.toUpperCase()} → 무대: ${culture.native ? '자국 배경 (언어 기본값 적용)' : '해외/타시대 배경 (대본에서 외형 추론)'}`)

  const isIllustration = /illustration|artwork|painting|manhwa|webtoon|anime|ghibli|watercolor|ink wash|clay|wool|diorama|fairy|folklore|3d.*anim|pixar/i.test(stylePreset.prompt)
  const faceRule = isIllustration
    ? '3. FACE: distinctive stylized facial features, expression style, eye shape, simplified aesthetic matching the art style'
    : '3. FACE: distinctive facial features, skin tone, age-appropriate wrinkles/smoothness'
  const narratorNames = conf.narratorNames.slice(0, 4).join(', ')

  // watercolor_illust_v2: 원래 시대 락(SETTING LOCK)이 없는 스타일.
  // joseon_painting: CASE A(정약용 본인)만 조선시대 고정, CASE B(현대인 사연)는 현대 배경 —
  // 즉 이 스타일도 이제 혼합시대이므로 environment DNA가 한쪽 시대 건축으로 고정되면 안 됨.
  // (쇼펜하우어 등 다른 단일시대 SETTING LOCK 스타일은 영향받지 않음.)
  const multiEraRule = (stylePreset.id === 'watercolor_illust_v2' || stylePreset.id === 'joseon_painting') ? `
⚠️ [MULTI-ERA / MIXED-SETTING SCRIPTS — CRITICAL]: Some scripts interweave a historical figure's own era with a present-day frame story (e.g. a historical sage's teachings illustrated with modern-day anecdotes about ordinary people, or flashback/present-day dual timelines). If ANY part of the script is clearly set in the present day (modern anecdotes, statistics, a narrator addressing today's viewer, an apartment/office/smartphone-era example) while another part is clearly historical, this "environment.visualPrompt" is glued onto EVERY scene INCLUDING ones with no Korean/historical content at all (a storm at sea, a generic room, an unrelated location) — so it must contain ZERO architecture or building vocabulary of any kind, whether historical or modern. Do NOT write "architecture", "architectural elements", a "blend of traditional and modern [anything]", "traditional wooden architecture", "paper sliding doors", or any other structure/building-type noun, EVEN when trying to describe both eras at once — a "blend" phrasing still counts as a violation because the word "traditional" alone is enough to bias every unrelated scene toward it. The ONLY acceptable content here is rendering medium and color-grading vocabulary with NO reference to any building, room, or culture-specific structure — e.g. "soft watercolor pigment bleed, visible paper grain, delicate ink line accents, warm muted color palette." Every architecture/location detail, for BOTH eras, belongs ONLY inside individual LOCATION entries instead — including separate location entries for the modern-day settings, not just the historical ones.` : ''

  // ⚠️ schopenhauer_victorian 전용: 서재/응접실 반복 및 환경DNA 가구 중복 문제 대응.
  // 다른 스타일에는 영향 없음.
  const schopenhauerEnvRule = stylePreset.id === 'schopenhauer_victorian' ? `
- DO NOT INCLUDE specific room-defining furniture/architecture (e.g. "mahogany paneling", "velvet drapery", "leather-bound books", "gilt-framed portraits", "oriental rugs") — those belong ONLY inside individual LOCATION entries below. If a signature piece of furniture is written here, it gets forced onto every location in the video regardless of type, so a street, a garden, a ballroom, and a study all end up looking like the same generic room.` : ''
  const schopenhauerLocationRule = stylePreset.id === 'schopenhauer_victorian' ? `
⚠️ Many scripts (essays, self-help narration, philosophical commentary addressed directly at the viewer) name almost NO literal places — they describe RECURRING SITUATIONS instead (a social gathering where people gossip, a workplace power imbalance, a private moment of reflection, a betrayal by someone once trusted, a public street encounter). When the script reads like this, do NOT wait for the same literal place-word to repeat before extracting it — instead identify the RECURRING SITUATION TYPES the narration keeps returning to, and invent ONE period-appropriate location archetype per situation type that is genuinely, materially different from the others (different room type, different furniture set, different light source) rather than a re-skin of the same room under a new name.
⚠️ If the script DOES explicitly name a concrete place — even just once (e.g. "식당", "직장", "기차역") — you MUST still extract it as one of your locations; do not discard a real location cue just because it isn't repeated elsewhere.
⚠️ DO NOT lift the example setting words mentioned in the [VISUAL STYLE TARGET] section above (e.g. its own sample mentions of "study", "drawing room", "garden", "street") as a shortcut — those are illustrative examples for the ART STYLE, not a location list for THIS script. Every location you output must trace back to an actual recurring situation/place in THIS script's content.
Extract 4~9 locations (not just 3), and vary indoor ROOM TYPES — do not just redecorate the same study/drawing-room twice under different names.` : ''

  const prompt = `[ANALYSIS]: Extract characters, env, and KEY LOCATIONS. IMPORTANT: Do NOT include narrators (${narratorNames}) as characters. They are NOT characters in the story.
⚡ [VISUAL STYLE TARGET]: ${stylePreset.prompt}

[CHARACTER CULTURE CONTEXT]:
${culture.ethnicityHint}

[CHARACTER VISUAL PROMPT REQUIREMENTS - MANDATORY]:
⚠️ NON-HUMAN EXCEPTION (CRITICAL): If the character is an animal, object, or abstract concept, DO NOT force human features on them. Describe their NATURAL physical form. NEVER give them human hair, human clothes, a human face, or human limbs unless explicitly stated they are anthropomorphized.

For HUMAN characters, describe the following in English:
1. FACE: ${faceRule.replace(/^\d+\. FACE: /, '')}
2. BODY: height (tall/average/short), build (slim/sturdy/broad)
3. HAIR COLOR & NATURAL TEXTURE only (e.g. "black straight hair", "grey wavy hair") — do NOT describe hairstyle, length, or how hair is worn
4. SIGNATURE ACCESSORY or PROP if unique to this character (e.g. a scar, a distinctive item they always carry)
⚠️ DO NOT describe costume, outfit, clothing, headwear, or hairstyle in visualPrompt — costume is applied separately at image generation time.

⚠️ [STYLE CONTAMINATION PROHIBITION - CRITICAL]:
The "imagePromptKo" and "visualPrompt" fields MUST contain ONLY the character's PHYSICAL APPEARANCE description (hair, face, outfit, body, accessories).
ABSOLUTELY DO NOT embed any art style keywords such as: 웹툰, 만화, 실사, 3D, anime, manhwa, webtoon, photorealistic, cinematic, illustration, cartoon, Pixar, Ghibli, painting, watercolor, ink wash, etc.
The visual style is applied SEPARATELY by the system. If you include style keywords in character descriptions, it will cause severe visual inconsistency.

[CORE CHARACTER STRICT RULE - CRITICAL]:
Extract ONLY the SINGLE most iconic core identity of each character. DO NOT split a single character into multiple variations or life stages.
- Even if a character ages, changes clothes, masks their identity, or wears a disguise, you MUST extract them AS A SINGLE UNIQUE CHARACTER representing their true, fundamental identity.
- There should be STRICTLY ONE entry per individual person in the script.
- STATUS TRANSITION EXCEPTION: If a character undergoes a FUNDAMENTAL RANK CHANGE during the script (e.g., prince/duke → king, general → ruler), add a "STATUS TRANSITION: [pre-rank] → [post-rank] (e.g., 수양대군(왕자/대군) → 세조(왕))" note at the START of their description field. Their visualPrompt should reflect their MOST FREQUENTLY APPEARING rank in the script.
⚠️ AGE SELECTION FOR LIFE-SPANNING BIOGRAPHIES — CRITICAL, DO NOT DEFAULT TO THE OPENING HOOK: Biography scripts often open with a dramatic hook showing the person at their OLDEST (e.g. their death as an old man) or otherwise at an extreme age, purely for narrative effect, then spend most of the story on a completely different, more central life stage (their prime years — as a young leader, in the role that defines the video's actual subject). Do NOT set "age" and "visualPrompt" to whatever age the person happens to be at their FIRST-MENTIONED or most dramatically-described appearance. Instead: scan the WHOLE script, identify which single life stage covers the LARGEST PORTION of the story's actual scenes/events (usually their reign, career peak, or the central conflict period — NOT the cold-open death/frame-story bookend), and set age/visualPrompt to THAT prime life stage. A person who "reigned 15 years then was exiled 18 years and died old" should be visualized at his REIGN age (the video's true dramatic core), not his death-bed age.
⚠️ ILLUSTRATIVE ANECDOTE EXCLUSION — NARROW SCOPE, DO NOT OVER-APPLY: Self-help/lecture-style scripts sometimes use a throwaway HYPOTHETICAL example ("한 사람이 있었습니다", "직장에서 명퇴 후 작은 가게를 차렸다가...") — a nameless or thinly-sketched invented person used ONCE to illustrate a point, then never mentioned again. Exclude ONLY this narrow case.
⚠️ THIS EXCLUSION DOES NOT APPLY to real named people in a historical/biographical script — family members, rivals, allies, victims, or other figures who are named and appear or are referenced more than once, even if the video's title/framing centers on ONE main figure. A biography naturally has a supporting cast (e.g. a king's father, siblings, spouse, children, political enemies) — extract EVERY named person who recurs, not just the title character. When in doubt, extract the character rather than excluding them.
⚠️ TITLE-ALIAS COUNTING RULE — CRITICAL, COMMONLY MISSED: the SAME person is often called by DIFFERENT titles at different points (e.g., a queen consort becomes a queen dowager after her husband's successor takes the throne: "인목왕후" → "인목대비"; a prince becomes a king). Before deciding a person is "only mentioned once," CHECK whether an earlier/later different title refers to the SAME individual and COMBINE those mentions — do not undercount a recurring person just because their title changed. Also: a character who DIES partway through the story (including a child who dies young) is NOT automatically minor — if their birth, life, or death is a specific plot event the script describes, extract them as a real character with their own visualPrompt, even though their sole role is being born, imprisoned, or dying. Do not skip a character just because they never speak or act with agency.
${culture.costumeHierarchy}

[ENVIRONMENT DNA ("environment" FIELD) - MANDATORY GUIDANCE]:
⚠️ This "environment.visualPrompt" text is glued onto EVERY SINGLE SCENE in the entire video, no matter how different each scene's actual moment is. Write it as a NEUTRAL, REUSABLE BASE PALETTE only — NOT a fixed mood/lighting commitment.
- INCLUDE: recurring architecture/material/texture details, era-appropriate color palette, recurring props — things that stay true across the WHOLE video regardless of scene content.
- DO NOT INCLUDE a single fixed lighting or mood adjective meant to apply to every scene (e.g. do NOT write "dim", "dark", "suffocating", "gloomy" as the definitive mood) — even a heavy/tragic topic has scenes that need bright daylight, open air, or a lighter tone (a triumphant moment, a wide establishing shot, a scene about someone who lived long and well). Leave LIGHTING and MOOD to be decided PER SCENE based on that scene's own content, not fixed here for all 100 scenes at once.${multiEraRule}${schopenhauerEnvRule}

[LOCATION EXTRACTION - MANDATORY]:
Extract 3~8 KEY LOCATIONS from the script (only the most important recurring ones). Each location MUST have:${schopenhauerLocationRule}
- name: Short location name in the script's language (e.g., ${conf.locationExamples})
- visualPrompt: Detailed English environment description (50~100 words) including:
  * Architecture/nature details (materials, textures, structures)
  * Lighting conditions (natural light, candles, torches, moonlight)
  * Color palette (dominant colors, mood tones)
  * Atmosphere (misty, dusty, serene, tense)
  * Key props/objects unique to this location
⚠️ Locations that appear in MULTIPLE scenes should be extracted as ONE entry
⚠️ Include BOTH indoor and outdoor locations
⚠️ Use CONSISTENT naming — the same place should always use the same name

${conf.outputInstruction} RESILIENCE: If content is blocked, return a safe/neutral version. NEVER return null or empty strings. [DATA]: ${cleaned}`

  return withRetry(async () => {
    const res = await safeGenerate(client, {
      model:   TEXT_MODEL,
      contents: prompt,
      config:  {
        safetySettings: SAFETY_SETTINGS,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            characters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name:          { type: Type.STRING },
                  age:           { type: Type.STRING },
                  gender:        { type: Type.STRING },
                  description:   { type: Type.STRING },
                  imagePromptKo: { type: Type.STRING },
                  visualPrompt:  { type: Type.STRING },
                },
                required: ['name', 'age', 'gender', 'description', 'imagePromptKo', 'visualPrompt'],
              },
            },
            environment: {
              type: Type.OBJECT,
              properties: {
                description:  { type: Type.STRING },
                visualPrompt: { type: Type.STRING },
              },
              required: ['description', 'visualPrompt'],
            },
            locations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name:         { type: Type.STRING },
                  visualPrompt: { type: Type.STRING },
                },
                required: ['name', 'visualPrompt'],
              },
            },
            camera: {
              type: Type.OBJECT,
              properties: {
                style: { type: Type.STRING },
                lens:  { type: Type.STRING },
              },
              required: ['style', 'lens'],
            },
            tone: { type: Type.STRING },
          },
          required: ['characters', 'environment', 'locations', 'camera', 'tone'],
        },
      },
    }, 'generateContinuityBible')

    const text  = res?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const bible = parseJson(text, 'Bible', { characters: [], environment: { description: 'N/A', visualPrompt: '' }, locations: [], camera: { style: '', lens: '' }, tone: '' })

    // 내레이터 필터링
    if (bible.characters && Array.isArray(bible.characters)) {
      bible.characters = bible.characters.filter(c => {
        const name = (c.name || '').trim().toLowerCase()
        return !conf.narratorNames.some(n => name === n.toLowerCase())
      })
    }
    if (!Array.isArray(bible.locations)) bible.locations = []

    return bible
  }, 3, 'generateContinuityBible', { model: TEXT_MODEL, smartBackoff: true })
}

// ─── 누락 캐릭터 감사 (원본 Nn 함수 이식) ────────────────────────────────────
export async function verifyMissingCharacters(scriptText, existingNames, lang = 'ko') {
  const client = await createClient()
  const conf   = LANG_CONFIGS[lang] || LANG_CONFIGS.ko
  const cleaned = cleanScript(scriptText)

  const prompt = `[CRITICAL AUDIT]: Analyze the script and find NAMED characters that were MISSED by the first extraction pass.

**STRICT RULES:**
1. Include a character if they are referred to BY NAME (or an unambiguous title standing in for a name, e.g. "영창대군", "폐비 유씨") 2+ TIMES total in the script — this INCLUDES pure narration/description, NOT just dialogue. A character who is only ever acted upon (born, imprisoned, killed) and never speaks a single line is STILL a valid character if named 2+ times — do NOT require dialogue.
2. ⚠️ TITLE-ALIAS: the same person may be called by different titles at different points in the story (e.g., before/after a status change — "인목왕후" before her stepson becomes king, "인목대비" after). Combine those mentions as ONE person, not two separate near-misses.
3. EXCLUDE truly generic/unnamed background roles (마을사람, 행인, 여인, 남자 etc.) — this rule is about UNNAMED extras, not about characters who lack dialogue.
4. DO NOT invent new characters not in the script.
5. Characters already identified: ${existingNames.join(', ')}
6. Return EMPTY array [] if nothing was missed.
7. EXCLUDE narrators (나레이션, 해설, 해설자, Narrator). They are NOT characters.
8. Maximum 3 characters. Only return the MOST important missing ones.

**Script to analyze:**
${cleaned}

Return NAMED characters (2+ mentions, dialogue not required) NOT in the existing list. Maximum 3.`

  return withRetry(async () => {
    const res = await client.models.generateContent({
      model:   TEXT_MODEL,
      contents: prompt,
      config:  {
        safetySettings: SAFETY_SETTINGS,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name:          { type: Type.STRING },
              age:           { type: Type.STRING },
              description:   { type: Type.STRING },
              imagePromptKo: { type: Type.STRING },
              visualPrompt:  { type: Type.STRING },
            },
            required: ['name', 'age', 'description', 'imagePromptKo', 'visualPrompt'],
          },
        },
      },
    })
    const text   = res?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const result = parseJson(text, 'Audit', [])
    return Array.isArray(result)
      ? result.filter(c => !conf.narratorNames.some(n => (c.name || '').trim().toLowerCase() === n.toLowerCase()))
      : []
  }, 3, 'verifyMissingCharacters', { model: TEXT_MODEL, smartBackoff: true })
}

// ─── 캐릭터 이미지 분석 (원본 bn 함수 이식) ──────────────────────────────────
export async function analyzeCharacterImage(imageBase64) {
  const client = await createClient()

  return withRetry(async () => {
    const mime = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,/)?.[1] || 'image/jpeg'
    const data = imageBase64.split(',')[1]

    const res = await client.models.generateContent({
      model: TEXT_MODEL,
      contents: {
        role: 'user',
        parts: [
          { inlineData: { mimeType: mime, data } },
          { text: 'Analyze person. Age, gender, appearance, clothing.' },
        ],
      },
      config: {
        safetySettings: SAFETY_SETTINGS,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            age:           { type: Type.STRING },
            gender:        { type: Type.STRING },
            imagePromptKo: { type: Type.STRING },
            visualPrompt:  { type: Type.STRING },
          },
          required: ['age', 'gender', 'imagePromptKo', 'visualPrompt'],
        },
      },
    })
    const text = res?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return parseJson(text, 'analyzeCharacterImage', {})
  }, 3, 'analyzeCharacterImage', { model: TEXT_MODEL, smartBackoff: true })
}
