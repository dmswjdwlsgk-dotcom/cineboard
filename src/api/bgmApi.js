import { createClient, SAFETY_SETTINGS, withRetry, parseJson } from './gemini.js'
import { Type } from '@google/genai'
import { LANG_CONFIGS, cleanScript } from '../data/languages.js'

const TEXT_MODEL = 'gemini-2.5-flash'

// ─── 글로벌 BGM 생성 (원본 fn 함수 이식) ─────────────────────────────────────
export async function generateGlobalBGM(scriptText, bible, lang = 'ko') {
  const client     = await createClient()
  const langConfig = LANG_CONFIGS[lang] || LANG_CONFIGS.ko
  const cleaned    = cleanScript(scriptText)

  const prompt = `[EMOTIONAL SOUNDTRACK COMPOSITION - SCRIPT-DRIVEN ANALYSIS]

[FULL SCRIPT CONTEXT]:
${cleaned}

[NARRATIVE DNA]:
- Overall Tone: ${bible.tone || ''}
- Environment: ${bible.environment?.description || ''}
- Emotional Arc: Analyze the script's emotional journey from beginning to end

${langConfig.outputInstruction}

[BGM GENERATION MANDATE]:
You are a film composer analyzing this script to create the perfect background music direction.

1. titleKo: 대본의 핵심 감정과 주제를 담은 한국어 음악 제목 (예: "잃어버린 시간 속의 회상", "어둠 속 희망의 선율")

2. titleEn: English cinematic music title capturing the essence

3. promptKo: 대본 기반 상세 음악 해설 및 프롬프트 (한국어)
   - 반드시 포함할 요소:
     * 대본의 감정선 분석 (초반/중반/후반 감정 변화)
     * 음악 장르/스타일 (orchestral, ambient, electronic, etc.)
     * 악기 구성 (strings, piano, brass, percussion 등)
     * 템포와 리듬감 (slow/moderate/fast, steady/dynamic)
     * 분위기 키워드 (melancholic, hopeful, tense, peaceful 등)
     * 음악적 구조 (intro, build-up, climax, resolution)
     * 대본 주요 장면과 음악 싱크 포인트
   - 최소 150자 이상의 풍부한 설명

4. promptEn: Detailed English AI music generation prompt
   - Must include:
     * Genre, style, and instrumental composition
     * Tempo, rhythm, and dynamics
     * Emotional progression mapping
     * Production quality descriptors
   - ⚠️ CRITICAL LENGTH LIMIT: MUST BE STRICTLY UNDER 900 CHARACTERS. Suno AI will truncate it otherwise. Be concise and impactful.

[CRITICAL]: The BGM must emotionally support the entire narrative arc analyzed from the script. Be deeply descriptive and emotionally nuanced.`

  return withRetry(async () => {
    const res = await createClient().then(c => c.models.generateContent({
      model:   TEXT_MODEL,
      contents: prompt,
      config:  {
        safetySettings: SAFETY_SETTINGS,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            titleKo:  { type: Type.STRING },
            titleEn:  { type: Type.STRING },
            promptKo: { type: Type.STRING },
            promptEn: { type: Type.STRING },
          },
          required: ['titleKo', 'titleEn', 'promptKo', 'promptEn'],
        },
      },
    }))
    const text = res?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return parseJson(text, 'GlobalBGM', {})
  }, 3, 'generateGlobalBGM')
}

// ─── 멀티트랙 BGM 큐시트 (원본 wn 함수 이식) ─────────────────────────────────
export async function generateMultiTrackBGM(scriptText, bible, scenes, lang = 'ko') {
  const client     = await createClient()
  const langConfig = LANG_CONFIGS[lang] || LANG_CONFIGS.ko
  const cleaned    = cleanScript(scriptText)
  const sceneCount = scenes.length

  // 씬별 감정 요약
  const sceneSummary = scenes.map(s => {
    const emotion = s.emotionScore || 5
    const tag     = s.emotionTag   || 'calm'
    return `[${s.id}] 감정:${emotion}/10 (${tag}) — ${(s.action || s.description || '').slice(0, 40)}`
  }).join('\n')

  const trackCount = sceneCount <= 8 ? 3 : sceneCount <= 15 ? 4 : sceneCount <= 25 ? 5 : 6

  const prompt = `[MULTI-TRACK BGM CUE SHEET — EMOTIONAL ARC-DRIVEN COMPOSITION]

You are a FILM MUSIC SUPERVISOR creating a multi-track BGM cue sheet for a video.
The video has ${sceneCount} scenes. Create EXACTLY ${trackCount + 1} tracks (Track 0 = Title Theme + ${trackCount} segment tracks).

[SCRIPT CONTEXT]:
${cleaned.slice(0, 3000)}

[NARRATIVE DNA]:
- Overall Tone: ${bible.tone || ''}
- Environment: ${bible.environment?.description || ''}

[SCENE EMOTIONAL ARC]:
${sceneSummary}

[TRACK GENERATION RULES]:
1. Track 0 (trackNumber: 0): TITLE THEME / CHANNEL SIGNATURE OST
   - sceneRange: "INTRO/OUTRO"
   - This is the channel's signature melody — used for intro and outro
   - Must capture the OVERALL emotional essence of the entire story

2. Tracks 1~${trackCount} (trackNumber: 1~${trackCount}): SEGMENT TRACKS
   - Divide the ${sceneCount} scenes into ${trackCount} groups by emotional similarity
   - Each track covers a CONTINUOUS range of scenes (e.g., "S01~S04")
   - emotionTag must reflect the DOMINANT emotion of that scene range
   - avgIntensity should be the AVERAGE emotionScore of scenes in that range
   - estimatedDuration: calculate based on ~8 seconds per scene (e.g., 4 scenes = "약 32초")

3. MUSIC DIFFERENTIATION:
   - Each track MUST be musically DISTINCT from its neighbors:
     * Calm sections → acoustic guitar, soft piano, low BPM (70-90)
     * Tension sections → low strings, electronic pulse, mid BPM (100-130)
     * Climax sections → full orchestra, percussion, high BPM (140-170)
     * Resolution sections → solo piano, ambient pads, slow BPM (60-80)
   - promptEn MUST be UNDER 900 characters (Suno AI limit)

4. promptKo: 최소 100자 이상의 풍부한 한국어 음악 연출 설명

Return a JSON array of ${trackCount + 1} BgmTrack objects.

${langConfig.outputInstruction}`

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
              trackNumber:       { type: Type.INTEGER },
              titleKo:           { type: Type.STRING },
              titleEn:           { type: Type.STRING },
              sceneRange:        { type: Type.STRING },
              emotionTag:        { type: Type.STRING },
              avgIntensity:      { type: Type.NUMBER },
              promptKo:          { type: Type.STRING },
              promptEn:          { type: Type.STRING },
              estimatedDuration: { type: Type.STRING },
            },
            required: ['trackNumber', 'titleKo', 'titleEn', 'sceneRange', 'emotionTag', 'avgIntensity', 'promptKo', 'promptEn', 'estimatedDuration'],
          },
        },
      },
    })
    const text = res?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return parseJson(text, 'MultiTrackBGM', [])
  }, 3, 'generateMultiTrackBGM')
}
