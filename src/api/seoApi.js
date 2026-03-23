import { createClient, SAFETY_SETTINGS, withRetry, parseJson } from './gemini.js'
import { Type } from '@google/genai'
import { cleanScript } from '../data/languages.js'

const TEXT_MODEL = 'gemini-2.5-flash'

// ─── YouTube SEO 메타데이터 생성 (원본 yn 함수 이식) ─────────────────────────
export async function generateYoutubeMetadata(scriptText, bible) {
  const client  = await createClient()
  const cleaned = cleanScript(scriptText)
  const chars   = (bible.characters || []).map(c => `${c.name}(${c.age}${c.gender ? `, ${c.gender}` : ''})`).join(', ')

  const prompt = `[YOUTUBE SEO METADATA GENERATOR — KOREAN CONTENT EXPERT]

You are a top Korean YouTube SEO specialist. Generate metadata that MAXIMIZES click-through rate and search visibility.

[STORY DATA]:
- Characters: ${chars}
- Setting: ${bible.environment?.description || ''}
- Tone: ${bible.tone || ''}
- Script excerpt (first 500 chars): ${cleaned.slice(0, 500)}

[GENERATE THE FOLLOWING]:

1. "titles" (3개): 유튜브 검색 최적화 제목. 규칙:
   - 30자 이내, 궁금증 유발, 감정 자극
   - 숫자/구체적 키워드 활용 ("3가지", "충격적인", "실화")
   - 검색 노출 + 클릭률 동시 최적화
   - 예: "조선시대 궁녀의 비밀 일기가 발견되었다" / "이 영상을 보면 조선이 달리 보입니다"

2. "description": 유튜브 설명란 (300~500자).
   - 첫 2줄이 검색 미리보기에 노출됨 → 핵심 키워드 + 후킹 문장
   - 스토리 요약 (스포일러 없이 궁금증 유발)
   - CTA: "구독과 좋아요 부탁드립니다" 포함
   - 관련 키워드 자연 삽입

3. "hashtags" (12~15개): 대주제 + 세부 키워드 + 트렌드 태그
   - #으로 시작, 한국어 위주, 영어 2~3개 포함
   - 예: #조선시대 #사극 #한국역사 #KoreanHistory

4. "thumbnailTexts" (3개): 썸네일에 합성할 짧은 문구, 각각 다른 톤:
   - [극적]: 클라이맥스 순간의 강렬한 한 줄 (8자 이내)
   - [포스터]: 영화 태그라인 느낌 (10자 이내)
   - [클릭유발]: 궁금증+놀라움 자극 (12자 이내, "?"나 "..." 활용)

모든 텍스트는 한국어로 작성.`

  return withRetry(async () => {
    const res = await client.models.generateContent({
      model:   TEXT_MODEL,
      contents: prompt,
      config:  {
        safetySettings: SAFETY_SETTINGS,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            titles:         { type: Type.ARRAY, items: { type: Type.STRING } },
            description:    { type: Type.STRING },
            hashtags:       { type: Type.ARRAY, items: { type: Type.STRING } },
            thumbnailTexts: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['titles', 'description', 'hashtags', 'thumbnailTexts'],
        },
      },
    })
    const text = res?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return parseJson(text, 'YoutubeMetadata', { titles: [], description: '', hashtags: [], thumbnailTexts: [] })
  }, 3, 'generateYoutubeMetadata')
}
