import { createClient, SAFETY_SETTINGS, withRetry, parseJson } from './gemini.js'

const TEXT_MODEL = 'gemini-2.5-flash'

async function callJson(prompt, label = 'API') {
  const client = await createClient()
  const response = await withRetry(() =>
    client.models.generateContent({
      model:   TEXT_MODEL,
      contents: prompt,
      config:  { safetySettings: SAFETY_SETTINGS, responseMimeType: 'application/json', maxOutputTokens: 8192 },
    })
  , 3, label)
  const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || response?.text || ''
  return parseJson(text, label, [])
}

// ─── 소재 추천 (원본 cn 함수 이식) ───────────────────────────────────────────
export async function suggestTopics(genreType, genreLabel, customLabel) {
  const client = await createClient()
  const label  = customLabel || genreLabel.replace(/^[^\s]+\s/, '')
  const prompt = `당신은 유튜브 조회수 1000만 이상을 달성한 콘텐츠 기획자입니다.
"${label}" 장르에서 지금 당장 만들면 대박 날 영상 소재 8개를 추천하세요.

[선정 기준]:
- 대중의 호기심과 궁금증을 자극하는 주제
- 최근 1~3개월 내 관심도가 높거나, 시의성이 있는 주제
- 유튜브에서 검증된 "클릭하고 싶은" 소재 패턴 활용
- 댓글이 활발하게 달릴 수 있는 논쟁적/감성적 소재

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력:
[
  { "title": "소재 제목", "hook": "이 소재가 왜 먹히는지 한줄 설명", "viralScore": 4 },
  ...
]`

  try {
    const res = await withRetry(() =>
      client.models.generateContent({
        model:   TEXT_MODEL,
        contents: prompt,
        config:  { safetySettings: SAFETY_SETTINGS, responseMimeType: 'application/json', maxOutputTokens: 4096 },
      })
    , 3, '소재 추천')
    const text = (res?.candidates?.[0]?.content?.parts?.[0]?.text || '[]')
      .replace(/```json\s*/g, '').replace(/```/g, '').trim()
    return JSON.parse(text)
  } catch (e) {
    console.error('[suggestTopics] error:', e)
    return []
  }
}

// ─── 시놉시스 생성 (원본 dn 함수 이식) ───────────────────────────────────────
export async function generateSynopsis(genreType, genreLabel, topic, spices = [], customLabel) {
  const client  = await createClient()
  const label   = customLabel || genreLabel.replace(/^[^\s]+\s/, '')
  const isStory = genreType === 'STORY'

  const spicesStr = spices.length > 0
    ? `\n[적용할 스파이스/양념]:\n${spices.map(s => `- ${s}`).join('\n')}`
    : ''

  const prompt = `당신은 유튜브 조회수 수백만을 기록하는 베테랑 구성작가입니다.
아래 소재에 대해 서로 완전히 다른 3가지 시놉시스를 작성하세요.

[장르]: ${label}
[소재]: ${topic}${spicesStr}

[시놉시스 규칙]:
- 각 시놉시스는 500~800자
- 각각 완전히 다른 접근 방식 (예: A=감성형, B=반전형, C=충격형)
- 유튜브에서 시청 유지율 80%+ 달성 가능한 구조
- "keyTwists" 배열에 핵심 반전/임팩트 포인트 3개 기재
- approach는 2~3단어로 접근 방식을 설명 (예: "충격 반전형", "감동 몰입형")${!isStory ? `
- "factNotes" 배열에 팩트체크가 필요한 핵심 주장/수치를 3~5개 기재하세요. 각 항목은 "OO에 대한 출처 확인 필요" 형식.` : ''}

반드시 아래 JSON 형식으로만 응답하세요:
[
  {
    "id": "A",
    "title": "시놉시스 제목",
    "approach": "접근 방식 2~3단어",
    "synopsis": "전체 시놉시스 텍스트...",
    "keyTwists": ["반전1", "반전2", "반전3"]${!isStory ? `,
    "factNotes": ["팩트1", "팩트2"]` : ''}
  },
  ...3개
]`

  try {
    const res = await withRetry(() =>
      client.models.generateContent({
        model:   TEXT_MODEL,
        contents: prompt,
        config:  { safetySettings: SAFETY_SETTINGS, responseMimeType: 'application/json', maxOutputTokens: 8192 },
      })
    , 3, '시놉시스 생성')
    const text = (res?.candidates?.[0]?.content?.parts?.[0]?.text || '[]')
      .replace(/```json\s*/g, '').replace(/```/g, '').trim()
    return JSON.parse(text)
  } catch (e) {
    console.error('[generateSynopsis] error:', e)
    return []
  }
}

// ─── 전체 대본 생성 (원본 pn 함수 이식) ──────────────────────────────────────
export async function generateFullScript(prompt, targetChars = 8000) {
  const client   = await createClient()
  const CHUNK    = 8000

  if (targetChars <= CHUNK) {
    const res = await withRetry(() =>
      client.models.generateContent({
        model:   TEXT_MODEL,
        contents: prompt,
        config:  { safetySettings: SAFETY_SETTINGS, maxOutputTokens: 16384 },
      })
    , 3, 'generateFullScript')
    return res?.candidates?.[0]?.content?.parts?.[0]?.text || res?.text || ''
  }

  // 분할 생성
  const parts    = Math.ceil(targetChars / CHUNK)
  let accumulated = ''

  for (let i = 0; i < parts; i++) {
    const isFirst = i === 0
    const isLast  = i === parts - 1
    const remaining = targetChars - accumulated.length
    const thisChars = isLast ? remaining : CHUNK

    const partPrompt = isFirst ? prompt : `당신은 이전 파트에서 이어서 대본을 작성합니다.

[이전까지 작성된 대본의 마지막 500자]:
${accumulated.slice(-500)}

[지시사항]:
- 위 내용에서 자연스럽게 이어서 작성하세요
- 절대 이전 내용을 반복하지 마세요
- 이 파트에서 약 ${thisChars}자를 작성하세요
${isLast ? '- 이것이 마지막 파트입니다. 자연스러운 결말로 마무리하세요.' : '- 다음 파트에서 이어질 수 있도록 중간에서 끊으세요.'}
- 인물명은 [대괄호] 유지, 대사 형식 유지`

    const res = await withRetry(() =>
      client.models.generateContent({
        model:   TEXT_MODEL,
        contents: partPrompt,
        config:  { safetySettings: SAFETY_SETTINGS, maxOutputTokens: 16384 },
      })
    , 3, `generateFullScript(part ${i + 1}/${parts})`)

    accumulated += (i > 0 ? '\n\n' : '') + (res?.candidates?.[0]?.content?.parts?.[0]?.text || res?.text || '')
  }

  return accumulated
}

// ─── 팩트 체크 (원본 mn 함수 이식) ───────────────────────────────────────────
export async function factCheckScript(scriptText) {
  const client = await createClient()
  const prompt = `당신은 저널리스트급 팩트체커입니다. 아래 대본에서 사실 확인이 필요한 주장, 수치, 역사적 사건, 과학적 사실 등을 5~10개 식별하고 각각 검증하세요.

[대본]:
${scriptText.slice(0, 15000)}

[검증 규칙]:
- 각 항목의 사실 여부를 TRUE(사실), FALSE(거짓), UNCERTAIN(확인 불가)로 판정
- 판정 근거를 1~2문장으로 간결히 설명
- 가능하면 실제 존재하는 신뢰할 수 있는 출처 URL을 포함 (Wikipedia, 정부기관, 언론사, 학술 논문 등)
- 명백한 허구/소설적 요소는 검증 대상에서 제외
- 통계 수치, 역사적 사건, 과학적 주장, 경제 데이터 등 검증 가능한 사실만 대상으로

반드시 아래 JSON 형식으로만 응답하세요:
[
  {
    "claim": "검증 대상 주장",
    "verdict": "TRUE",
    "explanation": "판정 근거 설명",
    "source": "출처명",
    "sourceUrl": "https://..."
  }
]`

  try {
    const res = await withRetry(() =>
      client.models.generateContent({
        model:   TEXT_MODEL,
        contents: prompt,
        config:  { safetySettings: SAFETY_SETTINGS, responseMimeType: 'application/json', maxOutputTokens: 8192 },
      })
    , 3, 'factCheckScript')
    const text = (res?.candidates?.[0]?.content?.parts?.[0]?.text || '[]')
      .replace(/```json\s*/g, '').replace(/```/g, '').trim()
    return JSON.parse(text)
  } catch (e) {
    console.error('[factCheckScript] error:', e)
    return []
  }
}

// ─── 팩트체크 자동 수정 ────────────────────────────────────────────────────────
export async function fixFactCheckScript(scriptText, factResults) {
  const client = await createClient()
  const falseItems = factResults.filter(r => r.verdict === 'FALSE' || r.verdict === 'UNCERTAIN')
  if (falseItems.length === 0) return scriptText

  const fixList = falseItems.map((r, i) =>
    `${i + 1}. [주장]: "${r.claim}"\n   [판정]: ${r.verdict}\n   [근거]: ${r.explanation}`
  ).join('\n\n')

  const prompt = `당신은 전문 편집자입니다. 아래 대본에서 팩트 오류가 확인된 내용을 수정해주세요.

[원본 대본]:
${scriptText.slice(0, 15000)}

[수정 대상 오류 목록]:
${fixList}

[수정 규칙]:
- 오류로 확인된 주장만 최소한으로 수정하세요.
- 대본의 전체적인 흐름, 문체, 구조는 유지하세요.
- 수정이 불가능하거나 소설적 표현인 경우 그대로 두세요.
- 수정된 대본 전문만 출력하세요. 설명이나 메타데이터 없이.
- TTS/자막 호환 규칙 유지: **, [], (), {}, #, -, *, ~, 이모지 사용 금지.`

  const res = await withRetry(() =>
    client.models.generateContent({
      model:   TEXT_MODEL,
      contents: prompt,
      config:  { safetySettings: SAFETY_SETTINGS, maxOutputTokens: 16384 },
    })
  , 3, 'fixFactCheckScript')

  return res?.candidates?.[0]?.content?.parts?.[0]?.text || scriptText
}

// ─── generateFullScriptPrompt (장르별 대본 프롬프트 빌더) ─────────────────────
export function buildScriptPrompt(genreType, genreLabel, topic, tone, viewpoint, targetChars, customLabel) {
  const label = customLabel || genreLabel.replace(/^[^\s]+\s/, '')
  const toneMap = {
    friendly:     '😊 친근한 톤 (~어요)',
    professional: '🎙️ 전문적인 톤 (~입니다)',
    emotional:    '🥺 감성적인 톤',
    humorous:     '😂 유머러스한 톤',
  }
  const viewpointMap = {
    first:    '1인칭 (나)',
    third:    '3인칭 (관찰자)',
    narrator: '해설자 (나레이션)',
  }

  const common = `
[공통 규칙]:
- 총 분량: 약 ${targetChars}자 내외 (한국어 기준)
- 톤: ${toneMap[tone] || tone}
- 시점: ${viewpointMap[viewpoint] || viewpoint}
- 각 인물의 대사는 "인물명: 대사내용" 형식 (대괄호 사용 금지)
- 나레이션이나 해설은 "나레이션: 내용" 또는 "해설: 내용" 형식
- 대사 내에서 인물명을 대괄호로 감싸지 마세요. "김부장: 안녕하세요" (O), "[김부장]: 안녕하세요" (X)
- 문단과 문단 사이에 빈 줄 하나
- 자연스럽고 몰입감 있는 문체
- 절대 영어를 섞지 말 것. 100% 한국어로 작성

[TTS/자막 호환 필수 규칙 — 절대 위반 금지]:
- 절대 ** (볼드 마크다운)을 사용하지 마세요. 강조가 필요하면 문장 구조로 표현하세요.
- 절대 대괄호 []를 사용하지 마세요. 인물명도 대괄호 없이 "김부장: 대사" 형식으로 쓰세요.
- 절대 (), {}, <> 등 괄호류를 대본 본문에 사용하지 마세요.
- 절대 #, ##, ### 등 마크다운 헤더를 사용하지 마세요.
- 절대 -, *, ~ 등의 리스트 기호를 사용하지 마세요.
- 절대 이모지를 사용하지 마세요.
- 이 대본은 TTS(음성합성)로 바로 읽히고 자막으로 바로 표시됩니다. 순수 한국어 텍스트만 허용됩니다.

[자연스러운 한국어 필수 규칙]:
- 한국어 조사를 반드시 정확하게 사용하세요:
  * 받침이 있는 말 뒤: 은, 이, 을, 과, 아 (예: 민준은, 부장이, 사람을, 민준과, 민준아)
  * 받침이 없는 말 뒤: 는, 가, 를, 와, 야 (예: 지수는, 하나가, 나를, 지수와, 지수야)
- 1인칭 시점에서 "나는", "나의", "내가"를 매 문장 시작에 반복하지 마세요.
  * 한국어에서는 주어를 자연스럽게 생략합니다. "나는 걸어갔다. 나는 문을 열었다." 대신 "걸어갔다. 문을 열었다."처럼 자연스럽게 쓰세요.
  * "나"는 강조가 필요한 대목에서만 사용하세요.
- 번역투를 피하세요. "그것은 ~이었다", "그는 ~했다"를 반복하지 마세요. 한국어 화자가 실제로 말하듯 자연스럽게 서술하세요.
`

  if (genreType === 'STORY') {
    return `당신은 대한민국 최고의 스토리 작가입니다. "${label}" 장르의 강력한 스토리 대본을 작성하세요.

주제/소재: ${topic}

[스토리 구조]:
- 도입 (10%): 강렬한 첫 장면, 독자의 시선을 단번에 사로잡는 후크
- 전개 (30%): 인물 소개, 관계 설정, 사건의 씨앗
- 위기 (25%): 갈등 고조, 예상 못한 반전
- 절정 (25%): 최고의 긴장감과 감정적 클라이맥스
- 결말 (10%): 여운 있는 마무리, 독자가 곱씹을 한 줄

[인물 규칙]:
- 주요 인물 2~4명 (이름과 성격이 뚜렷하게)
- 각 인물의 대사는 성격을 반영 (거친 사람은 거칠게, 점잖은 사람은 점잖게)
- 나레이션은 [나레이션]으로 표기

${common}

지금 바로 대본을 작성해주세요. 제목이나 메타데이터 없이 대본 본문만 출력하세요.`
  }

  if (genreType === 'NEWS_ECONOMY') {
    return `당신은 구독자 100만의 시사/경제 유튜브 채널 전문 작가입니다. "${label}" 주제의 대본을 작성하세요.

주제/소재: ${topic}

[대본 구조]:
- 오프닝 훅 (5%): 충격적 사실이나 도발적 질문으로 시작
- 배경 설명 (15%): 이 이슈가 왜 중요한지, 맥락 설명
- 핵심 분석 1 (25%): 첫 번째 핵심 포인트 깊이 있게
- 핵심 분석 2 (25%): 두 번째 핵심 포인트 (다른 각도)
- 영향과 전망 (20%): "이것이 우리에게 미치는 영향은..."
- 마무리 (10%): 핵심 요약 + 시청자에게 생각거리

[규칙]:
- 해설자는 [해설]로 표기
- 전문가 인용은 [전문가 A], [기자] 등으로 표기
- 데이터와 수치를 적극 활용하되 자연스럽게 녹여내기
- 어려운 경제 용어는 쉬운 비유로 풀어서 설명

${common}

지금 바로 대본을 작성해주세요. 제목이나 메타데이터 없이 대본 본문만 출력하세요.`
  }

  if (genreType === 'KNOWLEDGE') {
    return `당신은 지식 콘텐츠 전문 작가입니다. "${label}" 주제의 교양 대본을 작성하세요.

주제/소재: ${topic}

[대본 구조]:
- 인트로 (10%): 일상 속 궁금증에서 시작하는 자연스러운 도입
- 핵심 개념 (30%): 어려운 개념을 비유와 실생활 사례로 쉽게 설명
- 역사/에피소드 (25%): 관련 유명 실험, 명언, 역사적 사건 소개
- 현대 적용 (25%): 오늘날 우리의 삶과의 연결, 실용적 조언
- 마무리 (10%): 여운 있는 명언이나 통찰로 마무리

[규칙]:
- 해설자는 [나레이션]으로 표기
- 인용이나 명언은 [명언]: 또는 실제 인물명 [아인슈타인]: 등으로 표기
- "이미 알고 있는 것"에서 "몰랐던 것"으로 자연스럽게 연결
- 핵심 1줄 요약을 각 섹션 끝에 배치

${common}

지금 바로 대본을 작성해주세요. 제목이나 메타데이터 없이 대본 본문만 출력하세요.`
  }

  // TREND 등 기본
  return `당신은 트렌디한 유튜브 채널의 인기 작가입니다. "${label}" 주제의 대본을 작성하세요.

주제/소재: ${topic}

[대본 구조]:
- 후크 (5%): "여러분, 이거 알고 계셨나요?" 식의 강력한 오프닝
- 메인 콘텐츠 (70%): 트렌드 정보, 팁, 리뷰 등 핵심 내용
- 감성 포인트 (15%): 개인적 경험, 공감 포인트
- CTA (10%): 구독·좋아요 유도 + 다음 영상 예고

[규칙]:
- 해설자는 [나레이션]으로 표기
- 친근하고 에너지 넘치는 어조
- 시청자와 직접 대화하는 느낌

${common}

지금 바로 대본을 작성해주세요. 제목이나 메타데이터 없이 대본 본문만 출력하세요.`
}
