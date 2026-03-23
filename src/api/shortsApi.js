import { createClient, SAFETY_SETTINGS, withRetry, safeGenerate, parseJson } from './gemini.js'
import { Type } from '@google/genai'
import { LANG_CONFIGS, cleanScript } from '../data/languages.js'

const TEXT_MODEL = 'gemini-2.5-flash'

// ─── 쇼츠 변환 (원본 vn 함수 기반) ─────────────────────────────────────────
// 각 씬을 9:16 쇼츠용 클립 시퀀스로 변환
export async function generateShortsFromScene(scene, bible, stylePreset, lang = 'ko', clipCount = 3, batchIndex = 1) {
  const client    = await createClient()
  const langConfig = LANG_CONFIGS[lang] || LANG_CONFIGS.ko
  const clipNum   = Math.min(10, Math.max(2, clipCount))

  const strip = name => name.replace(/(은|는|이|가|을|를|에게|의|로|과|와)$/, '')
  const matchChar = (name, bible) => {
    const n = strip(name.replace(/\s/g, '').toLowerCase())
    return bible.characters.some(c => {
      const cn = c.name.replace(/\s/g, '').toLowerCase()
      return cn === n || cn.includes(n) || n.includes(cn)
    })
  }

  const involvedChars = (scene.involvedCharacters || [])
  let sceneChars = involvedChars.length > 0
    ? bible.characters.filter(c => involvedChars.some(n => matchChar(n, bible)))
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

  const prompt = `[🎬 SHORTS SEQUENCE — 9:16 세로형 쇼츠 변환]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[임무]: 유튜브 쇼츠/릴스용 ${clipNum}개 클립 시퀀스 생성 (9:16 세로형).
각 클립은 정확히 8초 분량. 클립들은 서로 인과적·감정적으로 연결되어야 합니다.

[원본 씬 ID]: ${scene.id}
[원본 씬 요약]: ${scene.action}

[배정된 대본 블럭 — 이 내용을 ${clipNum}개 클립으로 균등 분배]:
${scene.fullScriptSegment || scene.scriptReference || '(없음)'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[🔥 쇼츠 구조 설계 원칙]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
필수 구조: ${structureHint}

[HOOK 클립 원칙]:
- 가장 충격적이거나 감정이 극에 달한 순간 먼저 보여주기
- 시청자가 "왜?"라는 의문을 품게 만드는 미완성 장면
- 대사: 질문형 · 충격형 · 역설형

[BUILD-UP / TENSION 클립 원칙]:
- 인과관계 명확히 — 이전 클립과 감정선이 이어져야 함
- 긴장감을 계단식으로 상승

[CLIFFHANGER 클립 원칙]:
- 핵심 질문에 답하지 않고 끊기
- 마지막 대사는 열린 결말형

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

⚠️ [9:16 VERTICAL FORMAT — MANDATORY]:
- ALL images MUST be 9:16 portrait orientation
- Compose for VERTICAL SCROLL viewing — tall compositions, centered subjects
- Subject should fill 60-80% of vertical frame height
- Use CLOSE-UP and MEDIUM-CLOSE shots — wide shots are ineffective in vertical format

⚠️ [imagePrompt ABSOLUTE PROHIBITION — NO EXCEPTIONS]:
- NO visible text, letters, words, signs, signage in the image description.
- The scene must be PURELY VISUAL.

⚠️ [ENGLISH ONLY & NO REAL NAMES]: The 'imagePrompt' and 'videoPromptEn' fields MUST BE 100% IN ENGLISH. NO KOREAN. ONLY use [ACTOR-X] tags!

[출력 규칙]:
- 정확히 ${clipNum}개의 clips 배열 반환
- dialogue: 반드시 채울 것 (약 8초 분량의 짧은 대사만 추출)
- duration: 항상 "8s"
- imagePrompt는 영어로, 300자 이상 상세하게
${langConfig.outputInstruction}`

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
    }, `generateShorts(${scene.id})`)

    const text   = res?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const parsed = parseJson(text, `Shorts(${scene.id})`, { clips: [] })
    const clips  = Array.isArray(parsed?.clips) ? parsed.clips : []

    // 클립 수 보정
    const filled = [...clips]
    while (filled.length < clipNum) filled.push(clips[clips.length - 1] || clips[0])
    const sliced = filled.slice(0, clipNum)

    const resolveChars = nameList => {
      const names = (nameList || []).map(n => {
        const match = n.match(/(ACTOR|KEY)[-_]?([A-Z])/i)
        if (match) {
          const idx = match[2].toUpperCase().charCodeAt(0) - 65
          if (idx >= 0 && idx < bible.characters.length) return bible.characters[idx].name
        }
        const stripped = n.replace(/(은|는|이|가|을|를|에게|의|로|과|와)$/, '').replace(/\s/g, '').toLowerCase()
        const found = bible.characters.find(c => c.name.replace(/\s/g, '').toLowerCase() === stripped)
        return found ? found.name : n
      }).filter(n => bible.characters.some(c => c.name === n || matchChar(n, bible)))
      return names.length > 0 ? names : involvedChars.length > 0 ? involvedChars : []
    }

    return sliced.map((clip, idx) => ({
      id:               `SHORTS_${scene.id}_B${String(batchIndex).padStart(2,'0')}C${String(idx + 1).padStart(2,'0')}`,
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
      clipIndex:        idx + 1,
      sourceSceneId:    scene.id,
      clipScript:       clip.clipScript    || '',
      hookType:         clip.hookType      || '',
      aspectRatio:      '9:16',
    }))
  }, 3, `generateShorts(${scene.id})`)
}
