import { createClient, SAFETY_SETTINGS, withRetry, safeGenerate, parseJson } from './gemini.js'
import { Type } from '@google/genai'
import { LANG_CONFIGS } from '../data/languages.js'

const TEXT_MODEL = 'gemini-2.5-flash'

// ─── 인트로 시퀀스 확장 (원본 vn 함수 이식) ──────────────────────────────────
export async function generateIntroExpansion(scene, bible, stylePreset, lang = 'ko', clipCount = 4, batchIndex = 1) {
  const client     = await createClient()
  const langConfig = LANG_CONFIGS[lang] || LANG_CONFIGS.ko
  const clipNum    = Math.min(10, Math.max(2, clipCount))

  const involvedChars = scene.involvedCharacters || []
  let sceneChars = involvedChars.length > 0
    ? bible.characters.filter(c => involvedChars.some(n => {
        const stripped = n.replace(/(은|는|이|가|을|를|에게|의|로|과|와)$/, '').replace(/\s/g, '').toLowerCase()
        const cn = c.name.replace(/\s/g, '').toLowerCase()
        return cn === stripped || cn.includes(stripped) || stripped.includes(cn)
      }))
    : bible.characters
  if (sceneChars.length === 0) sceneChars = bible.characters

  const characterRoster = sceneChars.map((c, i) => {
    const idx = bible.characters.findIndex(b => b.name === c.name)
    const tag = `ACTOR-${String.fromCharCode(65 + (idx !== -1 ? idx : i))}`
    const protagonist = c.isProtagonist ? ' [★PROTAGONIST]' : ''
    return `- [${tag}: ${c.name}]${protagonist};`
  }).join('\n')

  const setting  = (scene.setting || '').trim()
  const location = bible.locations?.find(l => l.name === setting || setting.includes(l.name) || l.name.includes(setting))
  const locationInfo = location ? `[LOCATION: ${location.name}]: ${location.visualPrompt}` : `[SETTING]: ${setting || '미상'}`

  const structureHint = clipNum <= 2
    ? '클립1=HOOK(즉각적 충격), 클립2=CLIFFHANGER(여운)'
    : clipNum <= 4
    ? `클립1=HOOK, 클립2=BUILD-UP, 클립${clipNum - 1}=TENSION, 클립${clipNum}=CLIFFHANGER`
    : `클립1=HOOK(최고임팩트), 클립2=RE-HOOK(이중충격), 클립3~${clipNum - 2}=BUILD-UP→TENSION(긴장고조), 클립${clipNum - 1}=PEAK(절정), 클립${clipNum}=CLIFFHANGER(열린결말-여운)`

  const prompt = `[🎬 INTRO SEQUENCE EXPANSION — 후킹 · 텐션 · 클리프행어 구조]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[임무]: 유튜브 인트로용 ${clipNum}개 클립 시퀀스 생성.
각 클립은 정확히 8초 분량. 클립들은 서로 인과적·감정적으로 연결되어야 합니다.

[원본 씬 ID]: ${scene.id}
[원본 씬 요약]: ${scene.action}

[배정된 대본 블럭 — 이 내용을 ${clipNum}개 클립으로 균등 분배]:
${scene.fullScriptSegment || scene.scriptReference || '(없음)'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[🔥 인트로 구조 설계 원칙]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
필수 구조: ${structureHint}

[HOOK 클립 원칙]:
- 가장 충격적이거나 감정이 극에 달한 순간 먼저 보여주기
- 시청자가 "왜?"라는 의문을 품게 만드는 미완성 장면
- 대사: 질문형 · 충격형 · 역설형 ("어떻게 이게 가능해?", "당신이 배신자야")

[BUILD-UP / TENSION 클립 원칙]:
- 인과관계 명확히 — 이전 클립과 감정선이 이어져야 함
- 긴장감을 계단식으로 상승 — 각 클립이 이전보다 강도 높아야 함
- 카메라: 클로즈업·핸드헬드·라킹 샷 등 불안정감 활용

[CLIFFHANGER 클립 원칙]:
- 핵심 질문에 답하지 않고 끊기
- 마지막 대사는 열린 결말형 ("그래서 결국...", "하지만 그 순간...")
- 시퀀스 전체를 관통하는 감정의 여운 남기기

[클립 간 연결성 규칙]:
⚠️ 각 클립의 dialogue 첫 단어가 이전 클립의 마지막 감정과 이어져야 함.
⚠️ 카메라 움직임은 클립 간에 자연스럽게 전환되어야 함 (Static→Pan→Handheld 등).
⚠️ 인물 설정(의상·외형)은 클립 전체에서 일관되게 유지.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[CANON BIBLE]:
- Environment: ${bible.environment?.description || ''}
- Visual DNA: ${bible.environment?.visualPrompt || ''}
- Camera Style: ${bible.camera?.style || ''}, ${bible.camera?.lens || ''}
- Tone: ${bible.tone || ''}

[${locationInfo}]

[CHARACTER VISUAL BIBLE]:
${characterRoster || '(등장인물 정보 없음)'}

[STYLE]: ${stylePreset.prompt}

⚠️ [imagePrompt ABSOLUTE PROHIBITION — NO EXCEPTIONS]:
- NO visible text, letters, words, signs, signage, banners, posters, newspapers, books with visible text, chalkboards, whiteboards, or any surface displaying readable characters.
- NO subtitles, captions, title cards, watermarks in the scene description.
- The scene must be PURELY VISUAL — zero textual elements in the rendered frame.

[MANDATORY SCREEN TEXT RULE]:
⚠️ DO NOT generate any screenText. Leave the "screenText" field as an empty string "".

[출력 규칙]:
- 정확히 ${clipNum}개의 clips 배열 반환
- clipScript: 해당 클립에 해당하는 대본 원문 구간 (균등 분배)
- dialogue: 반드시 채울 것 (약 8초 분량의 짧은 대사만 추출. 중복 따옴표 금지. 대사 없으면 나레이션: "..." 형식)
- duration: 항상 "8s"
- 이미지 프롬프트(imagePrompt)는 영어로, 300자 이상 상세하게
${langConfig.outputInstruction}
⚠️ [ENGLISH ONLY & NO REAL NAMES]: The 'imagePrompt' and 'videoPromptEn' fields MUST BE 100% IN ENGLISH. NO KOREAN. NEVER use real Korean names in these fields. ONLY use tags like [ACTOR-A]!`

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
            clips: {
              type: Type.ARRAY,
              items: {
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
                  involvedCharacters: { type: Type.ARRAY, items: { type: Type.STRING } },
                  clipScript:         { type: Type.STRING },
                  hookType:           { type: Type.STRING },
                },
                required: ['action','description','imagePromptKo','imagePrompt','videoPromptKo','videoPromptEn','cameraMovement','shotType','dialogue','involvedCharacters','clipScript','hookType'],
              },
            },
          },
          required: ['clips'],
        },
      },
    }, `generateIntroExpansion(${scene.id})`)

    const text   = res?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const parsed = parseJson(text, `IntroExpansion(${scene.id})`, { clips: [] })
    const clips  = Array.isArray(parsed?.clips) ? parsed.clips : []

    const filled = [...clips]
    while (filled.length < clipNum) filled.push(clips[clips.length - 1] || clips[0])
    const sliced = filled.slice(0, clipNum)

    const resolveChars = (nameList) => {
      const names = (nameList || []).map(n => {
        const match = n.match(/(ACTOR|KEY)[-_]?([A-Z])/i)
        if (match) {
          const idx = match[2].toUpperCase().charCodeAt(0) - 65
          if (idx >= 0 && idx < bible.characters.length) return bible.characters[idx].name
        }
        return n
      }).filter(n => {
        const stripped = n.replace(/(은|는|이|가|을|를|에게|의|로|과|와)$/, '').replace(/\s/g, '').toLowerCase()
        return bible.characters.some(c => {
          const cn = c.name.replace(/\s/g, '').toLowerCase()
          return cn === stripped || cn.includes(stripped) || stripped.includes(cn)
        })
      })
      return names.length > 0 ? names : involvedChars.length > 0 ? involvedChars : []
    }

    return sliced.map((clip, idx) => ({
      id:               `INTRO_${scene.id}_B${String(batchIndex).padStart(2,'0')}C${String(idx + 1).padStart(2,'0')}`,
      duration:         '8s',
      shotType:         clip.shotType      || 'Close-up',
      description:      clip.description   || '',
      action:           clip.action        || '',
      setting:          scene.setting      || '',
      dialogue:         clip.dialogue      || '',
      screenText:       '',
      cameraMovement:   clip.cameraMovement || 'Static',
      scriptReference:  scene.scriptReference || '',
      scriptAnchor:     scene.scriptAnchor,
      fullScriptSegment: clip.clipScript   || '',
      involvedCharacters: resolveChars(clip.involvedCharacters),
      imagePromptKo:    clip.imagePromptKo || '',
      imagePrompt:      clip.imagePrompt   || '',
      videoPromptKo:    clip.videoPromptKo || '',
      videoPromptEn:    clip.videoPromptEn || '',
      isGeneratingImage: false,
      generationError:  undefined,
      clipDuration:     8,
      clipIndex:        idx + 1,
      sourceSceneId:    scene.id,
      clipScript:       clip.clipScript    || '',
      hookType:         clip.hookType      || '',
    }))
  }, 3, `generateIntroExpansion(${scene.id})`)
}
