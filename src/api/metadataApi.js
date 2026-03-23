import { createClient } from './gemini.js'
import { withRetry } from './retry.js'

const TEXT_MODEL = 'gemini-2.5-flash'

async function callJson(prompt, label = 'API') {
  const client = createClient()
  const response = await withRetry(() =>
    client.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    })
  , 3, label)

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text || ''
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) return JSON.parse(match[1])
    throw new Error('JSON 파싱 실패: ' + text.slice(0, 300))
  }
}

export async function generateYoutubeMetadata(scriptText, bible, genreLabel) {
  const prompt = `당신은 유튜브 SEO 전문가이자 콘텐츠 마케터입니다.
다음 작품의 유튜브 메타데이터를 최적화하여 생성하세요.

[작품 정보]:
장르: ${genreLabel}
캐릭터: ${(bible.characters || []).map(c => `${c.name}(${c.role})`).join(', ')}
배경: ${bible.environment?.description || ''}
톤: ${bible.tone || ''}

[대본 요약]:
${scriptText.slice(0, 3000)}

한국 유튜브 시청자를 대상으로 클릭률과 시청 완료율을 극대화하는 메타데이터를 생성하세요.

다음 JSON 형식으로만 응답하세요:
{
  "titles": [
    "제목 1 (호기심 유발형, 50자 이내)",
    "제목 2 (감정 자극형, 50자 이내)",
    "제목 3 (반전/미스터리형, 50자 이내)"
  ],
  "description": "유튜브 설명란 (500자 이내, 키워드 포함, 타임스탬프 공간 포함, 구독/좋아요 CTA 포함)",
  "hashtags": [
    "#해시태그1", "#해시태그2", "#해시태그3", "#해시태그4", "#해시태그5",
    "#해시태그6", "#해시태그7", "#해시태그8", "#해시태그9", "#해시태그10",
    "#해시태그11", "#해시태그12", "#해시태그13", "#해시태그14", "#해시태그15",
    "#해시태그16", "#해시태그17", "#해시태그18", "#해시태그19", "#해시태그20"
  ],
  "thumbnailTexts": [
    "썸네일 텍스트 1 (짧고 임팩트, 10자 이내)",
    "썸네일 텍스트 2 (감정적, 10자 이내)",
    "썸네일 텍스트 3 (궁금증 유발, 10자 이내)"
  ]
}`

  return callJson(prompt, 'YouTube 메타데이터')
}

export async function generateGlobalBGM(scriptText, genreLabel) {
  const prompt = `당신은 영화음악 전문가이자 사운드 디렉터입니다.
다음 작품에 어울리는 BGM을 제안하세요.

[작품 정보]:
장르: ${genreLabel}

[대본 요약]:
${scriptText.slice(0, 2000)}

Suno AI, Udio, 또는 유사 AI 음악 생성 도구에서 사용할 수 있는 상세한 BGM 프롬프트를 생성하세요.

다음 JSON 형식으로만 응답하세요:
{
  "titleKo": "BGM 제목 (한국어)",
  "titleEn": "BGM Title (English)",
  "promptKo": "한국어 BGM 설명 (분위기, 악기, 감정을 상세히)",
  "promptEn": "Detailed English BGM prompt for AI music generation. Include: instruments, tempo, key, mood, style references, dynamics, arrangement.",
  "genre": "음악 장르 (예: Orchestral, K-drama OST, Electronic, Jazz)",
  "tempo": "템포 (예: 60 BPM slow, 120 BPM medium, 140 BPM fast)",
  "mood": "분위기 키워드 3-5개 (예: melancholic, tense, romantic)"
}`

  return callJson(prompt, 'BGM 생성')
}

export async function generateMultiTrackBGM(scenes) {
  const scenesSummary = scenes
    .slice(0, 20)
    .map((s, i) => `씬${i + 1}: ${s.action} (${s.shotType}, ${s.duration})`)
    .join('\n')

  const prompt = `당신은 영화음악 감독입니다.
다음 씬 목록에 맞는 멀티트랙 BGM 배치를 제안하세요.

[씬 목록]:
${scenesSummary}

각 씬의 감정과 액션에 맞는 음악 트랙을 할당하세요.
비슷한 분위기의 씬들은 하나의 트랙으로 묶을 수 있습니다.

다음 JSON 배열 형식으로만 응답하세요:
[
  {
    "sceneRange": "씬1-씬3",
    "titleKo": "트랙 제목 (한국어)",
    "promptEn": "Detailed English music prompt for AI generation. Instruments, tempo, mood, style.",
    "mood": "분위기",
    "tempo": "템포"
  }
]

최대 8개 트랙으로 구성하세요.`

  return callJson(prompt, '멀티트랙 BGM')
}
