import { createClient, SAFETY_SETTINGS, withRetry, safeGenerate, parseJson } from './gemini.js'
import { Type } from '@google/genai'
import { LANG_CONFIGS, detectLanguage, cleanScript } from '../data/languages.js'

const TEXT_MODEL = 'gemini-2.5-flash'

// ─── 연속성 바이블 생성 (원본 hn 함수 이식) ──────────────────────────────────
export async function generateContinuityBible(scriptText, stylePreset) {
  const client = await createClient()
  const lang   = detectLanguage(scriptText)
  const conf   = LANG_CONFIGS[lang] || LANG_CONFIGS.ko
  const cleaned = cleanScript(scriptText)

  console.log(`[CineBoard] 대본 언어 감지: ${lang.toUpperCase()} → ${conf.ethnicityHint.split('.')[0]}`)

  const isIllustration = /illustration|artwork|painting|manhwa|webtoon|anime|ghibli|watercolor|ink wash|clay|wool|diorama|fairy|folklore|3d.*anim|pixar/i.test(stylePreset.prompt)
  const faceRule = isIllustration
    ? '3. FACE: distinctive stylized facial features, expression style, eye shape, simplified aesthetic matching the art style'
    : '3. FACE: distinctive facial features, skin tone, age-appropriate wrinkles/smoothness'
  const narratorNames = conf.narratorNames.slice(0, 4).join(', ')

  const prompt = `[ANALYSIS]: Extract characters, env, and KEY LOCATIONS. IMPORTANT: Do NOT include narrators (${narratorNames}) as characters. They are NOT characters in the story.
⚡ [VISUAL STYLE TARGET]: ${stylePreset.prompt}

[CHARACTER CULTURE CONTEXT]:
${conf.ethnicityHint}

[CHARACTER VISUAL PROMPT REQUIREMENTS - MANDATORY]:
⚠️ NON-HUMAN EXCEPTION (CRITICAL): If the character is an animal, object, or abstract concept, DO NOT force human features on them. Describe their NATURAL physical form. NEVER give them human hair, human clothes, a human face, or human limbs unless explicitly stated they are anthropomorphized.

For HUMAN characters, you MUST describe ALL of the following in rich detail (English):
1. HAIR: exact hairstyle, hair color, hair length, hair accessories
2. OUTFIT: exact clothing with colors, materials, patterns appropriate to the cultural context
${faceRule}
4. ACCESSORIES: headwear, jewelry, weapons, props the character typically carries
5. BODY: height (tall/average/short), build (slim/sturdy/broad)

⚠️ [STYLE CONTAMINATION PROHIBITION - CRITICAL]:
The "imagePromptKo" and "visualPrompt" fields MUST contain ONLY the character's PHYSICAL APPEARANCE description (hair, face, outfit, body, accessories).
ABSOLUTELY DO NOT embed any art style keywords such as: 웹툰, 만화, 실사, 3D, anime, manhwa, webtoon, photorealistic, cinematic, illustration, cartoon, Pixar, Ghibli, painting, watercolor, ink wash, etc.
The visual style is applied SEPARATELY by the system. If you include style keywords in character descriptions, it will cause severe visual inconsistency.

[CORE CHARACTER STRICT RULE - CRITICAL]:
Extract ONLY the SINGLE most iconic core identity of each character. DO NOT split a single character into multiple variations or life stages.
- Even if a character ages, changes clothes, masks their identity, or wears a disguise, you MUST extract them AS A SINGLE UNIQUE CHARACTER representing their true, fundamental identity.
- There should be STRICTLY ONE entry per individual person in the script.
${conf.costumeHierarchy}

[LOCATION EXTRACTION - MANDATORY]:
Extract 5~15 KEY LOCATIONS from the script. Each location MUST have:
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
  }, 3, 'generateContinuityBible')
}

// ─── 누락 캐릭터 감사 (원본 Nn 함수 이식) ────────────────────────────────────
export async function verifyMissingCharacters(scriptText, existingNames, lang = 'ko') {
  const client = await createClient()
  const conf   = LANG_CONFIGS[lang] || LANG_CONFIGS.ko
  const cleaned = cleanScript(scriptText)

  const prompt = `[CRITICAL AUDIT]: Analyze the script and find ONLY major characters who SPEAK MULTIPLE TIMES (at least 2+ dialogue lines) in the script.

**STRICT RULES:**
1. ONLY return characters who SPEAK at least 2 TIMES in the provided script (have multiple dialogue lines)
2. EXCLUDE characters who speak only ONCE - they are minor/extras
3. EXCLUDE characters mentioned but have NO dialogue
4. EXCLUDE background characters, extras, unnamed roles (마을사람, 행인, 여인, 남자 etc.)
5. DO NOT invent new characters not in the script
6. Characters already identified: ${existingNames.join(', ')}
7. Return EMPTY array [] if no new MAJOR speaking characters are found
8. EXCLUDE narrators (나레이션, 해설, 해설자, Narrator). They are NOT characters.
9. Maximum 3 characters. Only return the MOST important missing ones.

**Script to analyze:**
${cleaned}

Return MAJOR speaking characters (2+ lines) NOT in the existing list. Maximum 3.`

  return withRetry(async () => {
    const res = await client.models.generateContent({
      model:   TEXT_MODEL,
      contents: prompt,
      config:  {
        safetySettings: SAFETY_SETTINGS,
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
  }, 3, 'verifyMissingCharacters')
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
  }, 3, 'analyzeCharacterImage')
}
