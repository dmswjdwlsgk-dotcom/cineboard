import { createClient, SAFETY_SETTINGS, withRetry, safeGenerate, parseJson } from './gemini.js'
import { Type } from '@google/genai'
import { LANG_CONFIGS, detectLanguage, cleanScript } from '../data/languages.js'

const TEXT_MODEL = 'gemini-3.1-flash-lite'

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
  // AI\uAC00 "[@\uC774\uB984: romanized]" \uAC19\uC740 \uB300\uAD04\uD638 \uD0DC\uADF8 \uD45C\uAE30\uB97C \uC601\uC5B4 \uD544\uB4DC\uC5D0 \uADF8\uB300\uB85C \uB0A8\uAE30\uB294 \uACBD\uC6B0\uAC00
  // \uC788\uC5B4(\uC608: \uB85C\uC2A4\uD130\uC5D0 \uC798\uBABB \uB4E4\uC5B4\uAC04 \uC77C\uD654 \uC18D \uC608\uC2DC \uC778\uBB3C) \uCD5C\uC885\uC801\uC73C\uB85C \uD55C \uBC88 \uB354 \uC815\uB9AC\uD55C\uB2E4.
  result = result.replace(/\[@?[^\]:]*:\s*([^\]]+)\]/g, '$1') // "[@\uC774\uB984: romanized]" \u2192 romanized\uB9CC \uB0A8\uAE40
  result = result.replace(/\[@?([^\]]+)\]/g, '$1')            // \uB0A8\uC740 "[@\uC774\uB984]"\uB958 \u2192 \uAD04\uD638\uB9CC \uC81C\uAC70
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

// ─── 인물 태그 오배정 방지 — 배정된 인물의 이름이 실제 이 씬 구간 원문에
// 등장하는지 검증한다. 등장인물이 15~20명 넘는 대본(예: 조선 왕 전기 모음)에서
// AI가 로스터의 특정 인물(대개 가장 먼저 소개된 인물)에게 계속 쏠려서, 이미
// 그 인물 얘기가 끝난 뒤 다른 인물 이야기를 하는 구간에도 같은 이름이 계속
// 붙는 현상이 있었음 — 프롬프트 지침만으로는 안 잡혀서 코드로 직접 막는다.
function nameAppearsInSegment(name, segment) {
  if (!name) return false
  if (!segment) return true // 검증할 원문이 없으면 걸러내지 않음 (안전 기본값)
  const core = name.replace(/\([^)]*\)/g, '').trim()
  if (!core) return true
  return segment.includes(core)
}

// ─── 인물 연속성 힌트 전파 (carry-forward) ───────────────────────────────────
// 한국어 서술은 "세 번째, 이개." 처럼 이름을 한 번만 밝히고 이후로는 "이 사람",
// "그는" 같은 대명사로만 지칭하는 경우가 많다. 씬 분할 경계가 그 "이름이 박힌
// 한 문장"과 "실제 그 인물 얘기가 전개되는 문장들"을 서로 다른 씬으로 갈라놓으면,
// 뒤쪽 씬들은 원문에 이름이 전혀 없는 채로 AI에게 넘어간다 — 이러면 AI든 코드
// 검증이든 그 구간이 누구 얘기인지 알 방법이 없어 로스터 앞쪽 인물(대개 가장
// 먼저·길게 소개된 인물)로 쏠린다. 씬 순서를 따라가며 "직전에 이름이 등장한
// 인물"을 다음 씬들에도 기본값으로 이어서 전달한다 — 새 이름이 나오면 갱신.
//
// ⚠️ 단, 무한정 이어주면 안 된다 — "한 사람 얘기가 대명사로 계속 이어지는 구간"과
// "여러 사람을 한꺼번에 요약/정리하는 결론부"를 코드가 구분할 방법이 없기 때문에,
// 결론부처럼 일부러 이름을 다시 안 부르는 구간에서 마지막에 등장했던 단 한 명이
// 끝까지 눌러앉는 사고가 났다("조선의 왕들" 대본 — 영조가 ⑦장에서 크게 다뤄진 뒤,
// 여러 왕을 함께 정리하는 ⑧ 결론부 전체에 영조가 계속 지목됨). 이름이 다시 안
// 나온 채로 일정 씬 이상 벌어지면 더 이상 특정 인물을 단정하지 않고 손을 뗀다.
const CONTINUITY_MAX_GAP = 3
function attachCharacterContinuityHints(rawScenes, characters) {
  if (!Array.isArray(characters) || characters.length < 2) return rawScenes
  const tagged = characters.map((c, i) => ({ tag: `ACTOR-${String.fromCharCode(65 + i)}`, name: c.name }))
  let lastNamed = null
  let gap = 0
  return rawScenes.map(scene => {
    const segment = scene.fullScriptSegment || scene.scriptReference || ''
    const foundHere = tagged.filter(c => nameAppearsInSegment(c.name, segment))
    let continuityCharacterHint = null
    if (foundHere.length > 0) {
      lastNamed = foundHere[foundHere.length - 1]
      gap = 0
    } else {
      gap++
      continuityCharacterHint = gap <= CONTINUITY_MAX_GAP ? lastNamed : null
    }
    return { ...scene, detectedNamedActors: foundHere, continuityCharacterHint }
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

  // ── 헬퍼: 유닛 배열을 n개 청크로 그루핑 (글자 수 기준 균형 배분) ───────────
  // 유닛 "개수"만 균등 배분하면 짧은 문장이 몰린 청크와 긴 문장이 몰린 청크의
  // 실제 분량이 크게 벌어질 수 있어, 누적 글자 수가 평균에 가까워지도록 배분한다.
  const groupIntoN = (units, count, sep = ' ') => {
    if (units.length <= count) {
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
    // 절대 누적 글자 수 기준으로 경계를 잡는다 — 청크마다 목표량을 "새로" 채우면
    // 오차가 다음 청크로 누적되어 마지막 청크가 과도하게 크거나 작아질 수 있다.
    const lens      = units.map(u => u.length)
    const totalLen  = lens.reduce((sum, l) => sum + l, 0)
    const prefix    = []
    let running     = 0
    for (const l of lens) { running += l; prefix.push(running) }
    const targetLen = totalLen / count

    // ── 경계 다듬기: 그림으로 그릴 내용이 없는 "짧은 전환/연결 문장"
    // (예: "그런데 말입니다.", "왜일까요.", "정리해 보겠습니다.") 위에 씬 경계가
    // 걸리면 그 씬이 통째로 빈 문장 하나짜리가 된다. 문장 1개 폭 안에서만,
    // 그마저도 분량이 목표의 ±20%를 벗어나지 않을 때만 옮긴다 — 분량 균등이
    // 항상 우선이고, 이음새 다듬기는 그 안에서만 허용되는 보조 규칙이다.
    // 내레이션 대본은 "여러분", "생각해보세요", "~해보겠습니다" 같은 시청자 호출/
    // 전환용 화법이 구조적으로 많이 섞여 있다 — 문장 시작이 전형적인 전환어이거나,
    // 문장 안에 시청자 호출/메타 화법 키워드가 있으면(그리고 짧으면) 내용이 없다고 본다.
    // ── 챕터/서수 경계 강제 스냅: "① 무정, 조선을 뒤흔들다", "첫 번째, 이개.",
    // "제3장" 같은 표현은 대본 작성자가 이미 명시적으로 그어둔 챕터 경계다.
    // 글자 수 균등분배가 이 경계를 무시하고 걸쳐버리면(예: 챕터②를 시작하자마자
    // 씬이 끝나고, 다음 씬은 챕터②로 시작해 챕터③으로 끝나는 식) 챕터 하나가
    // 두 씬에 쪼개져 나온다 — 아래 경계 다듬기(필러 회피)보다 먼저, 그리고 더
    // 넓은 허용폭으로 처리한다: 챕터 경계 쪽으로 당겨가는 게 분량 균등보다 우선.
    const ORDINAL_START_RE = /^([①-⑳➀-➉]|(첫|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*번째|\d+\s*번째|제?\s*\d+\s*[장편화회부편])[,.\s]/
    const isOrdinalStart = (s) => !!s && ORDINAL_START_RE.test(s.trim())

    const FILLER_START_RE   = /^(그런데|그리고|그래서|자[,.]?|여기서|이제|그렇다면|왜일까요|말입니다|정리해\s?볼까요|정리해\s?보겠습니다|물론)/
    const FILLER_KEYWORD_RE = /(여러분|말씀드리|묻고\s?싶습니다|아시겠습니까|아십니까|해\s?보겠습니다|해\s?볼까요|해\s?보십시오|보려\s?합니다|시작하겠습니다|돌아가겠습니다|던지겠습니다|이야기하겠습니다|남겨주세요|뵙겠습니다|생각해\s?보세요|생각해\s?보십시오|궁금하|짚고\s?싶습니다|짚어보겠습니다|질문을\s?드리)/
    const isWeakBoundary = (s) => {
      if (!s) return true
      const t = s.trim()
      if (t.length <= 14) return true
      if (FILLER_START_RE.test(t)) return true
      if (t.length <= 40 && FILLER_KEYWORD_RE.test(t)) return true
      return false
    }

    const chunks    = []
    let cursor      = 0
    for (let i = 1; i < count; i++) {
      const targetCum = i * targetLen
      const minJ = cursor + 1
      const maxJ = units.length - (count - i) // 남은 청크마다 최소 1개 유닛 보장
      let j = minJ
      while (j < maxJ && prefix[j - 1] < targetCum) j++
      j = Math.min(j, maxJ)

      // 챕터 경계 강제 스냅 — 이 경계 후보 주변(목표 분량의 0.5~1.5배 폭)에 서수로
      // 시작하는 유닛이 있으면, 그중 목표치에 가장 가까운 것으로 경계를 당긴다.
      // 분량 균등보다 챕터 경계 존중이 우선이라 허용폭을 필러 회피보다 넓게 둔다.
      let bestOrdinal = -1, bestDiff = Infinity
      for (let k = minJ; k < maxJ; k++) {
        if (!isOrdinalStart(units[k])) continue
        const chunkLen = prefix[k - 1] - (cursor > 0 ? prefix[cursor - 1] : 0)
        if (chunkLen < targetLen * 0.5 || chunkLen > targetLen * 1.5) continue
        const diff = Math.abs(chunkLen - targetLen)
        if (diff < bestDiff) { bestDiff = diff; bestOrdinal = k }
      }
      if (bestOrdinal !== -1) {
        j = bestOrdinal
      } else if (isWeakBoundary(units[j - 1]) || isWeakBoundary(units[j])) {
        for (const nj of [j - 1, j + 1]) {
          if (nj < minJ || nj > maxJ) continue
          const nLen = prefix[nj - 1] - (cursor > 0 ? prefix[cursor - 1] : 0)
          if (nLen >= targetLen * 0.8 && nLen <= targetLen * 1.2 &&
              !isWeakBoundary(units[nj - 1]) && !isWeakBoundary(units[nj])) {
            j = nj
            break
          }
        }
      }

      chunks.push(units.slice(cursor, j).join(sep).trim())
      cursor = j
    }
    chunks.push(units.slice(cursor).join(sep).trim())
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
      // 없으면 한국어 문장 종결어미 경계 (마침표 없는 낭독체 대본 대응)
      if (breakAt === idealEnd) {
        for (let j = hi; j >= lo; j--) {
          if (/(습니다|습니까|ㅂ니다|ㅂ니까|았습니다|었습니다|했습니다|입니다|아요|어요|여요|예요|이에요|았다|었다|했다|한다|된다|간다|온다|네요|군요|거든요|잖아요|니다|까요|은가요|나요)$/.test(words[j - 1])) { breakAt = j; break }
        }
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

  // 1차: 문장 단위 분할 — 문장부호뿐 아니라 줄바꿈도 경계로 본다.
  // 낭독체 대본(광해군/정성왕후 등)은 한 호흡마다 줄을 바꾸고 마침표가 거의 없어,
  // 줄바꿈을 안 보면 작성자가 이미 나눠둔 매듭(챕터 경계 포함)을 무시하고 엉뚱한
  // 지점에서 잘리게 된다. 문장부호 구분자는 지금처럼 앞 문장에 붙이고(원문 보존),
  // 줄바꿈 구분자는 내용 없이 그냥 경계로만 쓴다.
  const sentences = cleaned
    .split(/([.!?。！？]+(?:\s+|$)|\n+)/)
    .reduce((acc, part, idx) => {
      if (idx % 2 === 0) {
        if (part.trim()) acc.push(part.trim())
      } else if (/[.!?。！？]/.test(part)) {
        if (acc.length > 0) acc[acc.length - 1] += part.trimEnd()
      } // 줄바꿈 구분자는 그냥 경계 역할만 하고 버림
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
async function enrichSceneSettings(scenes, client, visualMode = '') {
  const isHistDrama = visualMode === 'hist_drama'
  const modeHint = isHistDrama
    ? `⚠️ 이 콘텐츠는 역사 다큐멘터리 나레이션입니다. 나레이션 화자("여러분", "저는", "보겠습니다" 등)의 위치가 아닌,
나레이션이 묘사하는 역사적 장소/시대로 배경을 추론하라.
절대로 "현대 강의실", "스튜디오", "방송국" 등 현대 공간을 setting으로 쓰지 말 것.
예: "밥그릇" 관련 → "조선 시대 민가 부엌", "이순신" 관련 → "임진왜란 조선 수군 진영", "기근" 관련 → "조선 후기 농촌 마을"`
    : ''

  const prompt = `다음 씬 목록의 각 씬에 대해 "setting"(장소와 시간대, 한국어)을 채워 반환하라.
씬 내용을 읽고 배경을 추론하라. 알 수 없으면 "미상"으로 쓸 것.
${modeHint}

⚠️ 반복 방지 — 이 목록 전체를 한 번에 보고 있다는 이점을 활용하라:
- 인물의 "기본 공간"(예: 작가라서 서재/책상, 학자라서 서재)에 안주하지 마라. 실제 나레이션 문장이
  구체적 행동/장소를 담고 있으면(예: "상해로 건너가", "법정에 섰다", "거리에서 낭독했다", "감옥에 갇혔다")
  그 장소를 그대로 써라 — 서재보다 훨씬 구체적인 단서가 있는데도 서재로 뭉개면 안 된다.
- 나레이션이 화자의 논평/질문/요약(예: "그런데 그 계산이 틀렸습니다", "우리는 질문해야 합니다")처럼
  구체적 장면 묘사가 없는 문장이어도, 인물의 기본 공간을 기계적으로 반복하지 말고 그 시점 이야기의
  맥락에 맞는 다른 공간(거리, 인쇄소, 신문사, 법정, 항구, 기차역, 강연장, 감옥, 골목 등)이나 상징적
  장소를 찾아라 — 정말 아무 단서가 없을 때만 최후 수단으로 인물의 기본 공간을 써라.
- 목록 전체를 훑어서, 같은 setting 문자열(또는 사실상 같은 공간)이 연속으로 2번 이상 나오지 않도록
  분산시켜라. 내용상 명백히 같은 장소가 이어지는 경우(같은 사건이 여러 씬에 걸친 경우)만 예외로 허용한다.

씬 목록 (JSON):
${JSON.stringify(scenes.map(s => ({ id: s.id, text: s.fullScriptSegment.slice(0, 120) })))}

결과: JSON 배열로 [{"id":"P01","setting":"..."},...] 형식만 반환.`

  try {
    const res = await withRetry(() =>
      client.models.generateContent({
        model:   TEXT_MODEL,
        contents: prompt,
        config:  { safetySettings: SAFETY_SETTINGS, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json', maxOutputTokens: 16384 },
      })
    , 2, '씬 배경 보강', { model: TEXT_MODEL, smartBackoff: true })
    const text     = res?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const settings = parseJson(text, '씬 배경 보강', [])
    const map      = Object.fromEntries(settings.map(s => [s.id, s.setting]))
    return scenes.map(s => ({ ...s, setting: map[s.id] || s.setting || '미상' }))
  } catch {
    return scenes
  }
}

export async function splitScriptToScenes(scriptText, maxScenes = 30, visualMode = '') {
  const client = await createClient()
  // 프로그래밍 방식으로 정확히 maxScenes개 분할 (AI 무시 버그 방지)
  const scenes  = programmaticSplit(scriptText, maxScenes)
  // 배경 정보만 AI로 보강
  return enrichSceneSettings(scenes, client, visualMode)
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
- VARY shot types per scene: close-up on a key object, low angle on towering numbers, bird's eye on crowds, dramatic medium on symbolic objects — do NOT use wide shot every scene

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
    case 'hist_drama': return `
[🏯 HISTORICAL DRAMA CINEMATOGRAPHY MODE — FULL CINEMATIC GRAMMAR]
You are a Korean historical drama director. Read the scene content FIRST, then choose the shot.

⚠️ DOCUMENTARY NARRATION OVERRIDE — READ FIRST:
This script may be written as a DOCUMENTARY VOICEOVER (narrator speaking to audience: '여러분', '저는', '보겠습니다', '~하겠습니다', '~이었습니다').
- The narrator's voice is INVISIBLE — they are NEVER a character in the frame.
- NEVER render a modern lecturer, presenter, or narrator talking to camera. ZERO modern humans.
- Instead, ALWAYS visualize the HISTORICAL EVENT, SCENE, or OBJECT being DESCRIBED in the narration.
- Think of narration as a window into history — show what's THROUGH the window, not who's standing at it.
- "밥그릇이 600그램이었다" → Joseon commoner eating from a large bowl at a wooden table
- "이순신이 보고를 올렸다" → Admiral at a war camp candlelit tent writing or issuing orders
- "기근으로 마을이 고요해졌다" → wide shot of a desolate Joseon village in winter, no animals, no smoke

⚠️ CHANNEL META-ADDRESS SEGMENTS (subscribe/like requests, "다음 이야기에서 뵙겠습니다", "댓글로 남겨주세요", intro/outro branding) — THESE ARE THE #1 CASE WHERE THIS RULE GETS BROKEN, READ CAREFULLY:
These segments have ZERO historical content to visualize, which tempts you to fall back to "a narrator/speaker addressing an audience" — a modern lecture hall, a documentary studio, a silhouette bowing to a crowd. DO NOT DO THIS. The narrator is invisible even here — there is no exception for meta/closing segments.
Instead, default to a QUIET CALLBACK SHOT: reuse the story's own established world — its most iconic already-mentioned location, object, or the main historical figure themselves (in the established art style, NOT a modern person) — shown in a still, contemplative wide shot or silhouette, as if the story is settling/fading rather than ending on a stage. Think of it as the closing shot of a documentary film returning to its subject, not a host signing off.

⚠️ MINE YOUR OWN ASSIGNED SEGMENT FOR SPECIFICS — CRITICAL:
Your assigned script segment is usually several sentences long and almost always contains something concrete: a specific number, a named person/place/document, a specific object, a specific action, or a specific absence of action. Before writing imagePrompt, re-read your ENTIRE assigned segment (not just the first clause) and identify that concrete element FIRST.
- A generic mood/atmosphere shot (e.g. "a quiet palace at night") is a LAST RESORT — only acceptable if you re-read the segment and it truly contains nothing concrete, which is rare.
- If the segment names a specific document/record (e.g. 승정원일기, 실록), show that object directly — an open ledger, a page, a stack of court records — not just a generic room.
- If the segment states a specific fact, number, or duration (e.g. "33년 동안 찾지 않았다"), find a way to visualize THAT specific fact concretely (a calendar of untouched days, an empty threshold never crossed, a door unopened) rather than defaulting to the same establishing shot every other scene in this video would also use.
- Do NOT reuse the exact same generic environment description (same time of day, same weather, same composition) that a neighboring scene in this video would also naturally produce — even when using the CANON BIBLE's shared environment DNA as your base palette, layer THIS segment's specific detail on top of it, don't just restate the environment DNA as the whole imagePrompt.
- ⚠️ LIGHTING/MOOD WORD IS NOT MANDATORY PER SCENE: if the CANON BIBLE's Visual DNA contains a fixed mood/lighting word (e.g. "dim", "dark", "suffocating"), that is the video's ambient DEFAULT, not a rule to restate in every single scene's opening words. Many scenes in a long historical video need brighter, warmer, or more open lighting (a triumphant moment, daylight, an outdoor scene, a long and peaceful life) — use whatever lighting THIS specific scene's content actually calls for instead of opening with "dimly lit" / "dark" / "candlelit" out of habit.

⚠️ SHOT TYPE PRIORITY — FOLLOW THIS ORDER (HIGHEST PRIORITY):
1. Your DEFAULT shot type is whatever [SCENE POSITION & SHOT VARIETY HINT] elsewhere in this prompt suggests for this scene's position — treat it as your starting point, not an optional suggestion.
2. Deviate from that default ONLY when one of the few SPECIFIC TRIGGERS below clearly and narrowly applies to THIS exact scene. Generic conditions like "a character is moving" or "a place is mentioned" are NOT triggers — almost every historical scene involves some movement or location, so those alone never justify overriding the position hint.
3. "Medium Shot" is BANNED as a default. It may only be used when a character is SPEAKING DIALOGUE in an interior setting with NO spatial or emotional alternative.
4. ⚠️ ADJACENT SCENE REPETITION BAN: Do not pick the same shot type you'd expect a neighboring scene (similar position in the story) to also naturally land on. If both the position hint and the content weakly point toward an overused shot type, pick the next-best alternative that still fits the content, rather than repeating.

[SPECIFIC TRIGGERS — narrow and rare, only override the position hint when unambiguously true]:
- KING / AUTHORITY FIGURE declaring or being presented → LOW ANGLE looking up
- Character OBSERVED through DOORWAY / LATTICE SCREEN / WINDOW → FRAME-IN-FRAME
- OBJECT or DETAIL carries the meaning (sword, letter, seal, hands trembling) → EXTREME CLOSE-UP on object
- COURT CEREMONY / MILITARY FORMATION / CROWD SCALE is the entire point of the scene → BIRD'S EYE VIEW
- SHOCK / BETRAYAL / psychological instability is the entire point of the scene → DUTCH ANGLE
- 2+ characters in tense DIALOGUE / NEGOTIATION / CONFRONTATION is the entire point → OVER-THE-SHOULDER or TWO-SHOT

CAMERA ANGLES — match to power/mood:
• HIGH ANGLE (부감): powerless, being watched, overwhelmed
• LOW ANGLE (앙각): dominance, authority, threat — use for kings, generals, villains
• EYE LEVEL: neutral observation, dialogue
• BIRD'S EYE VIEW: military formations, courtyard scale, crowd density, geography
• OVER-THE-SHOULDER: confrontation and tension between two characters
• DUTCH ANGLE (기울기): shock, betrayal, psychological instability

COMPOSITIONS — use deliberately:
• SYMMETRICAL: throne room, formal court, two armies facing each other
• FRAME-IN-FRAME: figure through doorway, pillar arch, lattice screen, window
• SILHOUETTE + BACKLIGHT: lone figure at dawn, fire, torchlight, sunset, moonrise
• RULE OF THIRDS: subject off-center, negative space showing isolation or longing
• FOREGROUND ELEMENT: blurred branch / candle / fabric in foreground adds depth

⚠️ VARIETY ENFORCEMENT — FINAL CHECK before writing imagePrompt:
Ask yourself: "Is this shot type the MOST INTERESTING choice for this specific moment, or just the safest?" If it is just safe — change it.
A grief scene in a vast palace = WIDE SHOT of tiny lone figure, NOT medium shot.
A tense dialogue = OVER-THE-SHOULDER, NOT two people standing side by side in medium shot.
A king issuing an order = LOW ANGLE looking up, NOT eye-level medium shot.
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

// ─── 스타일 전용 디렉터 로직 (열정피디 AI 씬 생성기에서 이식) ─────────────────
// 이 스타일들은 일반 드라마 시네마토그래피가 아니라, 자체 "연출 모드 판별" 로직을
// 메인 지침으로 써야 함 — 기본 캐릭터 모드 지침과 섞이면 로직이 힘을 못 씀.
const DEDICATED_STYLE_DIRECTORS = {
  issue_youtube: `[📰 HIGH-END DOCUMENTARY & INFOGRAPHIC DIRECTOR MODE — PRIMARY DIRECTIVE, REPLACES GENERIC CINEMATOGRAPHY]
당신은 '지식한입', '슈카월드' 스타일의 하이엔드 다큐멘터리 자료 화면 및 인포그래픽 디렉터입니다. 대본 내용을 가장 효과적으로 전달할 [최적의 비주얼 포맷] 하나를 선택해 고퀄리티 imagePrompt를 작성합니다. 단순 텍스트 나열이 아니라 시각적 연출(Visual Storytelling)이 핵심입니다.

[🎥 7가지 연출 모드 중 하나를 선택하여 적용]
★★★ 핵심 원칙: 대본의 주어(Subject)가 무엇인지 먼저 파악하십시오. 사람이 주어가 아니라 사물/기술/장소/현상이 주어이면 반드시 사물/배경 중심 모드(모드 3, 6, 7)를 우선 선택하십시오.
★중요: 모드 2(인물)와 모드 4(증거)는 만능이 아닙니다. 사물/공간/배경이 핵심이면 다른 모드를 우선 선택하십시오.

[우선순위 1그룹 — 핵심 주체 판별]
1. 수치/통계/등락이 핵심 → 모드 1 (3D 그래프)
2. 특정 인물의 발언/리액션이 핵심 → 모드 2 (인물+말풍선)
3. 단일 제품/사물/기술/음식/자원의 디테일 묘사 → 모드 6 (사물 클로즈업)

[우선순위 2그룹 — 스케일/공간/논리]
4. 거대한 산업 현장/전쟁/국가 단위 스케일 → 모드 3 (3D 공간 꼴라주)
5. 특정 장소/환경/자연현상/도시 풍경/공간 분위기 → 모드 7 (시네마틱 배경/공간)
6. 순서/흐름/대결/인과관계 → 모드 5 (순서도/VS)

[우선순위 3그룹 — 근거 제시]
7. 위 1~6에 해당 안 되고 구체적 증거/기록/역사를 테이블 위에 펼쳐 분석 → 모드 4 (테이블탑 브리핑)

모드 1 [데이터 시각화]: 3D 입체 그래프(막대/원형/꺾은선)가 화면 중앙에 떠 있는 연출. 그래프 주제와 관련된 흐릿한 실사 배경. 상승(빨강)/하락(파랑) 3D 화살표. 텍스트는 하단에 배치하지 않는다.
모드 2 [인물 인용]: 고화질 인물 사진을 좌/우 배치(클로즈업/미디엄/풀샷). 인물 옆에 깔끔한 흰색/반투명 말풍선에 핵심 대사/키워드 배치. 발언 내용에 맞는 표정. 사물이 메인이면 사물과 함께 연출.
모드 3 [장소 및 사물 꼴라주]: 압도적 스케일(거대한 금괴 더미, 태양광 패널, 항공모함 등)을 광각으로 웅장하게. 화면 중앙에 핵심 사물을 고해상도 배치하고 주변에 관련 요소 꼴라주. 짙은 네이비/딥레드 정보 상자 + 지시선(Line indicator). 강조 단어는 색/크기 차별화. 텍스트는 하단에 배치하지 않는다.
모드 4 [증거 및 기록]: 흰색 구겨진 종이 질감 배경. 사진 인화물/실물 오브제/문서 도표 중 상황에 맞는 유형 선택, 자연스러운 소프트 섀도우로 사실감. 정보 상자에 2~3줄 요약 문장, 네이비/딥레드 컬러+헤더바, 지시선, 핵심 키워드는 노랑 강조 또는 빨간 밑줄. 텍스트는 하단에 배치하지 않는다.
모드 5 [논리적 구조화]: Type A 순서도 — 3D 실제 자료 사진들을 입체 화살표/파이프라인으로 연결. Type B 대결구도(VS) — 좌우 분할 또는 중앙 대치로 두 대상 대비. 정보 상자로 해설. 텍스트는 하단에 배치하지 않는다.
모드 6 [사물/제품 클로즈업]: 핵심 사물을 화면 60~80% 차지하도록 극단적으로 크게(매크로/클로즈업) 배치. 8K급 재질/디테일. 부드럽게 흐린 배경 또는 그라데이션 스튜디오 배경. 제품 촬영 조명(림 라이트, 소프트박스, 하이라이트). 인물 없이 사물 자체가 주인공. 정보 상자 1개로 핵심 수치/특징 간결히 표기. 텍스트는 하단에 배치하지 않는다.
모드 7 [시네마틱 배경/공간 연출]: 공간의 스케일과 깊이감을 극대화하는 와이드 앵글. 골든아워/네온/안개 속 가로등 등 분위기 조명. 건축양식/간판/차량/식물/날씨/연기 등 환경 디테일 풍부하게. 인물이 필요하면 실루엣/뒷모습으로 극히 작게 — 공간이 주인공. 드론뷰/로우앵글/원포인트 투시 등 인상적인 카메라 앵글. 정보 상자에 장소명/상황 설명. 텍스트는 하단에 배치하지 않는다.

[공통 비주얼 가이드]
- TV 뉴스 자막바(Ticker), 방송국 로고, 프레임 절대 금지 — 유튜브 썸네일/다큐멘터리 인서트 컷처럼 세련되게.
- 색감: 신뢰감 있는 네이비/블랙/다크그레이 베이스 + 골드/레드/블루 포인트 컬러.
- 이미지 내 텍스트에 괄호와 다른 언어 병기 금지 — 대본 언어로만 표기.
- imagePrompt(영어)에 위에서 고른 모드의 텍스트 요소(정보 상자, 말풍선, 그래프 라벨 등)를 구체적으로 영어로 묘사하십시오 — 이 스타일은 이미지 안에 텍스트가 있는 것이 정상입니다.

[임무]
★ 사물/기술/제품이 핵심 주체면 모드 6, 장소/환경/분위기가 핵심이면 모드 7을 적극 활용하십시오. 인물이 언급되지 않는 대본에서 억지로 인물을 등장시키지 마십시오.
필수 키워드 포함: "High-end documentary footage, Photorealistic 8k, No News Interface, 3D Infographic, Clean composite, Cinematic lighting"`,

  bright_info: `[🎨 VISUAL COMMUNICATION EXPERT / EDUCATIONAL ILLUSTRATOR MODE — PRIMARY DIRECTIVE, REPLACES GENERIC CINEMATOGRAPHY]
당신은 복잡한 상황을 아주 쉽고 직관적인 그림으로 표현하는 비주얼 커뮤니케이션 전문가이자 교육용 일러스트레이터입니다.

[필수 연출 지침]
1. 조명: 몰입감 있는 조명(High Key Lighting) 사용.
2. 색감: 선명한 색상으로 시인성을 높인다 (칙칙하거나 회색조 금지).
3. 구성: 시청자가 상황을 한눈에 이해하도록 피사체를 화면 중앙에 명확히 배치.
4. 분위기: 교육적이되 사실적, 중립적, 몰입감 있게 (우울하거나 무섭거나 기괴한 느낌 절대 금지).
5. 분할화면 금지 — 하나의 화면으로 연출.
6. 화면 네 모서리/가장자리에 글자 배치 금지 — 글자는 반드시 중앙 피사체 주변에만.
7. 캐릭터의 감정이 느껴지게.
8. 특정 국가 관련 내용이면 배경에 그 국가 분위기를 잘 살린다.
9. 배경은 평면이 아니라 깊이감과 질감이 살아있는 입체적 공간으로 — 추상적/흐릿한 배경 대신 구체적 환경 디테일(건축양식, 자연물, 소품, 거리 등)로 현장감을 극대화.

[★ 핵심 주체 판별 — Subject-First Rule]
대본을 먼저 읽고 핵심 주체가 사람인지, 사물인지, 장소인지 판별하십시오.
- 사물/기술/제품이 주체: 캐릭터 없이 사물을 화면 중앙에 크게 클로즈업, 질감과 디테일을 살려 연출.
- 장소/환경이 주체: 인물 없이 또는 실루엣만으로 공간의 스케일과 분위기에 집중.
- 인물이 주체: 캐릭터의 행동과 표정에 집중.

[작성 요구사항]
- imagePrompt는 최소 7문장 이상으로 상세하게 묘사.
- 추상적인 내용이면 시각적 은유 활용 (모래시계 모래가 떨어짐, 그래프 하락, 퍼즐 조각이 맞춰짐 등).
- 필요 시 화면 중앙 피사체 주변에 핵심 키워드 텍스트를 자연스럽게 배치해도 됩니다 (2~3개, 과하지 않게).`,
}

// ─── 씬 생성 공통 프롬프트 빌더 ───────────────────────────────────────────────
function buildScenePrompt(sceneRef, bible, stylePreset, langConfig, isRegenerate = false, visualMode = 'character', isEditorialMode = false, isImageTextEnabled = false) {
  const dedicatedDirector = DEDICATED_STYLE_DIRECTORS[stylePreset.id]
  const isIllustration = /illustration|artwork|painting|manhwa|webtoon|anime|ghibli|watercolor|ink wash|clay|wool|diorama|fairy|folklore|3d.*anim|pixar/i.test(stylePreset.prompt)
  const directorMode   = isIllustration
    ? '[🎨 MASTER ILLUSTRATOR/WEBTOON DIRECTOR MODE]'
    : '[🎬 MASTER CINEMATOGRAPHER MODE]'

  const isInfoviz = visualMode === 'infoviz'
  const withTextInt = isImageTextEnabled && (visualMode === 'content' || visualMode === 'infoviz')
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

  // ─── 코드 검증 기반 인물 감지 힌트 ────────────────────────────────────────
  // 대본 전체 + 로스터를 매 씬마다 통째로 던져주면, AI가 "이 이야기에서 가장
  // 인상적인/먼저 나온 인물"(대개 로스터 앞쪽) 쪽으로 쏠리는 경향이 있다 —
  // 배정된 구간에 다른 사람 이름이 분명히 적혀 있어도 그렇다. AI 판단에만
  // 맡기지 말고, 코드로 먼저 "이 구간 원문에 실제로 등장하는 이름"을 찾아
  // 프롬프트에 사실로 박아 넣는다.
  const segmentText = sceneRef.fullScriptSegment || sceneRef.scriptReference || ''
  // 배치 생성(generateAllScenes)에서는 attachCharacterContinuityHints가 이미 씬 순서를
  // 훑어 계산해둔 값을 sceneRef에 실어 보낸다 — 여기서는 그걸 그대로 쓴다. 단일 씬
  // 생성/재생성처럼 이웃 씬 맥락이 없는 경로에서는 이 씬 원문만으로 즉석 계산한다.
  const detectedNamedActors = sceneRef.detectedNamedActors
    ?? (!isInfoviz
      ? (bible.characters || [])
          .map((char, i) => ({ tag: `ACTOR-${String.fromCharCode(65 + i)}`, name: char.name }))
          .filter(c => nameAppearsInSegment(c.name, segmentText))
      : [])
  const continuityHint = sceneRef.continuityCharacterHint ?? null
  const nameDetectionHint = (bible.characters || []).length > 1
    ? (detectedNamedActors.length > 0
        ? `\n⚠️ NAME-MATCH DETECTED (CODE-VERIFIED FACT, NOT YOUR JUDGMENT CALL):
Your ASSIGNED SEGMENT's raw text literally contains: ${detectedNamedActors.map(c => `"${c.name}" (${c.tag})`).join(', ')}.
If a named human character appears in this scene, it should almost always be one of these — do NOT substitute a different, more familiar, or earlier-listed roster character who is NOT named in this segment's text just because they feel safer or appeared in a previous scene.`
        : continuityHint
          ? `\n⚠️ NO NAME LITERALLY IN THIS SEGMENT, BUT CONTINUITY CARRIED FORWARD (CODE-VERIFIED FACT): this segment's text refers back with pronouns only ("이 사람", "그는" etc.) rather than repeating a name. The nearest named character mentioned in an EARLIER segment (in script order, before this one) is "${continuityHint.name}" (${continuityHint.tag}). Unless THIS segment's content clearly shifts to a different subject (a different action, a new named party, a location-only description), assume the story is STILL about ${continuityHint.name} and use ${continuityHint.tag} — do NOT substitute a different, more familiar roster character instead.`
          : `\n⚠️ NO ROSTER NAME DETECTED IN THIS SEGMENT (CODE-VERIFIED FACT): none of the named roster characters' names appear in this segment's raw text, and no earlier segment established a character to carry forward either. This is a strong signal that this scene is about something/someone else — set involvedCharacters to [] and depict an unnamed/anonymous figure, object, crowd, or place instead of defaulting to a familiar named character out of habit.`)
    : ''

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

[SCENE POSITION & SHOT VARIETY HINT]:
Scene ID: ${sceneRef.id}
${(() => {
  const num = parseInt((sceneRef.id || '0').replace(/\D/g, ''), 10) || 0
  const hints = [
    'Preferred shot for this position: EXTREME WIDE or WIDE — establish the world.',
    'Preferred shot for this position: FULL SHOT — show character in full environment.',
    'Preferred shot for this position: OVER-THE-SHOULDER or TWO-SHOT — tension/dialogue.',
    'Preferred shot for this position: CLOSE-UP or EXTREME CLOSE-UP — emotion or detail.',
    'Preferred shot for this position: BIRD\'S EYE or LOW ANGLE — power/scale shift.',
    'Preferred shot for this position: FRAME-IN-FRAME or SILHOUETTE — visual poetry.',
  ]
  return hints[num % hints.length] + ' Override this hint ONLY if the content triggers above demand a different shot.'
})()}

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
${characterRoster}
${nameDetectionHint}`}

${langConfig.outputInstruction}

${dedicatedDirector ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${dedicatedDirector}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[MANDATORY DIALOGUE RULE]:
⚠️ EVERY scene MUST have dialogue field filled:
   - Provide ONLY a short snippet (around 8 seconds of speech). DO NOT copy the entire script length here!
   - NO double quotes. Do not add extra surrounding quotes.
   - If characters speak → use their exact spoken words from the scriptReference. DO NOT INCLUDE THE SPEAKER'S NAME.
   - If no dialogue → use the narration from the script narration. DO NOT INCLUDE "나레이션: " PREFIX.
   - NEVER invent dialogue not present in the scriptReference.

[MANDATORY SHOT TYPE RULE]:
⚠️ For the "shotType" field, output ONLY the exact camera shot name (e.g., "Infographic", "Object Close-up", "Wide Environment", "Quote & Person"). DO NOT add any extra descriptions.

⚠️ Leave the "screenText" field as an empty string "" — this style bakes any on-image text (info boxes, speech bubbles, graph labels) directly into imagePrompt itself, described in English as part of the chosen mode above.

[MANDATORY CHARACTER RULE]:
⚠️ For the "involvedCharacters" array, use the exact ORIGINAL KOREAN NAMES from the roster (not tags). Return an empty array [] if no named person physically appears — this is EXPECTED and CORRECT for object/place/data-focused modes.
⚠️ CRITICAL PRESENCE CHECK: ONLY include characters who are PHYSICALLY PRESENT AND VISIBLE in THIS EXACT script segment. Do NOT force a named character into every scene just because the roster has one.

[FINAL SCENE GROUNDING OVERRIDE — HIGHEST PRIORITY, READ LAST]:
⚠️ DO NOT DEFAULT TO FAMILIAR NAMED CHARACTERS OR A GENERIC "PERSON ON CAMERA" SHOT. Before writing imagePrompt, first identify WHO or WHAT this exact script segment is actually about — it may be a number/statistic, an object, a place, a different named person, or an unnamed party — and pick the matching mode above for THAT subject.
⚠️ RE-CHECK THE NAME-MATCH DETECTION RESULT ABOVE (the code-verified fact, not the FULL SCRIPT CONTEXT) before finalizing which named character (if any) appears. That detection reflects THIS segment only — the earlier FULL SCRIPT CONTEXT block is background, not a cue for who belongs in THIS scene.
⚠️ ADJACENT SCENE REDUNDANCY BAN: Do NOT reuse the same mode, data visual, or info-box layout that a neighboring scene (similar position in the story) would already use back-to-back. Vary the mode choice across the video.` : (isInfoviz || visualMode === 'documix' || visualMode === 'content' ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${visualModeInstruction}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : `[ACTOR RULES]:
⚠️ NAMED actors listed above are the FOCAL POINT. Their appearance (age/outfit/hair) is ISOLATED — do NOT mix between actors.
⚠️ IF Historical Drama (사극): dragon robes(용포) = 왕/세자 ONLY. Political power ≠ royalty — even the most powerful minister wears 관복/사모관대 with 흉배, NEVER 용포. IF Modern: NO traditional clothes.
⚠️ HEADWEAR RULE: When a character wears 사모, 갓, 익선관, or any traditional hat — ALL hair is completely hidden inside the hat. NEVER describe or render visible hair protruding above or outside the hat.
${langConfig.costumeHierarchy || ''}
⚠️ RANK-AT-TIME-OF-SCENE (사극 CRITICAL): If a character's description contains a STATUS TRANSITION note (e.g., 수양대군→세조), dress them according to their rank AT THE MOMENT of THIS script segment — NOT their final rank. If the segment is set BEFORE coronation/ascension, they wear pre-royal costume (도포, 왕자복, 갑옷 etc.), NOT 용포/익선관. Only dress them as king AFTER the coronation moment in the script.
⚠️ AGE-AT-TIME-OF-SCENE (LIFE-SPANNING BIOGRAPHIES): the character's reference portrait/visualPrompt reflects ONE representative "prime" age. If THIS segment's chronological moment is clearly a DIFFERENT life stage than that (e.g., them as a teenager/young adult decades before their reign, or as an old/dying person decades after it), you MUST explicitly describe the age-appropriate differences in imagePrompt so the rendered age matches the story moment, not just the reference: for a YOUNGER moment — smooth unlined skin, dark/full hair, leaner build, more energetic posture; for an OLDER moment — visible grey/white hair, deeper wrinkles, frailer or more weathered build, slower posture. Do not let a fixed reference identity keep every scene looking like the same middle-aged snapshot regardless of what point in their life this segment describes.
⚠️ CRITICAL APPEARANCE OVERRIDE: YOU MUST COMPLETELY IGNORE the script's clothing descriptions.
⚠️ USE ACTOR TAGS: Your \`imagePrompt\` and \`action\` MUST use the EXACT [ACTOR-X] tags to refer to characters instead of their names or pronouns (e.g., "[ACTOR-A] looks at [ACTOR-B]"). DO NOT hallucinate script-based clothing.
⚠️ NEVER CREATE CLONES: Use each ACTOR-X tag exactly once for their single physical body.
⚠️ ANTI-CLONE PROTOCOL (CRITICAL!):
   - If you add background figures (staff, passersby), you MUST explicitly describe them as "faceless, distant, generic silhouettes".
   - NEVER describe a background character doing the exact same action or wearing the same clothes as the [ACTOR].
${visualModeInstruction ? `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${visualModeInstruction}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${directorMode} — HIGHEST PRIORITY]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are not describing a scene. You are DIRECTING a movie or illustration.
Your imagePrompt must be a DIRECTOR'S SHOT DESCRIPTION that captures the single most emotionally devastating moment.

[STEP 0 — ABSTRACT COMMENTARY & HABITUAL-SPACE TRAP — CHECK THIS FIRST]:
⚠️ Many scripts (especially documentary/biography narration) mix concrete action sentences with the narrator's ABSTRACT COMMENTARY — rhetorical questions, summary judgments, transitions ("이건 협박이 아니었습니다", "우리는 질문해야 합니다", "그런데 그 계산이 틀렸습니다"), meta remarks about how people generally VIEW or DEBATE the subject ("사람들은 보통 두 갈래로 갈립니다", "혹자는 폭군이라, 혹자는 성군이라 부릅니다"), and CHANNEL META-ADDRESS (subscribe/like requests, "다음 이야기에서 뵙겠습니다", "댓글로 남겨주세요") — all of these describe NO physical action from the story itself at all.
⚠️ NARRATOR/PRESENTER IS INVISIBLE, NO EXCEPTIONS — SCOPE: this bans ONE specific thing: a person whose role is EXPLAINING/DEBATING/LECTURING ABOUT the topic to an audience or camera (a lecturer, professor, documentary host, panel of debating scholars, projector screen showing "before/after" portraits, video production studio) — this is a META framing device standing outside the story, and it is banned regardless of whether the story itself is historical or modern.
⚠️ THIS IS NOT A BAN ON MODERN SETTINGS IN GENERAL: if the video's actual subject matter IS contemporary (economy, current events, business, technology), then modern offices, streets, trading floors, real companies/products, and ordinary modern people ACTUALLY LIVING the story ARE correct and expected — draw those normally. The rule only blocks the "person standing apart from the story, explaining it" framing, not modern content itself.
⚠️ Stay grounded in whatever world this video's story actually takes place in (historical Joseon, or modern-day Seoul for an economy piece) — never cut away to a real-world meta-space (a lecture hall, a studio) that exists OUTSIDE that story to talk ABOUT it.
⚠️ Instead, default to a QUIET CALLBACK SHOT: reuse an already-established location/object from this story, or the main figure themselves (whatever era they belong to, in the established art style), shown in a still, symbolic wide shot or silhouette — like a documentary camera lingering on its subject, not cutting to a host or classroom.
⚠️ When your assigned segment is this kind of abstract commentary, DO NOT default to the character's single most "habitual" location/prop (e.g. a writer always shown at their desk with a pen, a scholar always in their study) just because it's the safest guess — if you find yourself about to write "sitting at a desk" again, STOP and ask whether the LOCATION field, the character's actual life stage at this point in the story, or a symbolic object/environment tied to THIS segment's specific claim would be more accurate and less repetitive.
⚠️ Use the [LOCATION - THIS SCENE'S SETTING] field below as your primary anchor — it was chosen with visibility into the WHOLE scene list specifically to avoid this repetition. Trust it over your own instinct to reuse a "default" scene.
⚠️ SELF-CHECK: would this exact composition (same pose, same prop, same room) also plausibly fit 3 other scenes in this video? If yes, it's too generic — find the specific physical space, object, or moment from the STORY'S actual timeline that this commentary is talking about instead.
⚠️ THE CANON BIBLE'S "Visual DNA" LINE BELOW IS A BASE PALETTE, NOT A MANDATORY MOOD FOR EVERY SCENE: it describes materials/architecture/colors that stay consistent across the video — it is NOT telling you every scene must be dim/dark/gloomy. If it contains a lighting or mood word (e.g. "dim", "suffocating"), treat that as the ambient default ONLY — override it with brighter, warmer, or more open lighting whenever THIS scene's actual content calls for it (daytime, triumph, a wide open space, a calm or long-lived moment). Do NOT open your imagePrompt with the same "dimly lit / dark / candlelit" phrasing you'd use for every other scene — vary it based on what THIS scene actually depicts.
⚠️ NUMBERS/STATISTICS SPOKEN TO THE VIEWER ARE NOT A PHYSICAL PROP: narration that presents a number or statistic directly to the audience as a rhetorical device ("여기, 숫자 두 개가 있습니다", "15년입니다", "46세였습니다") is a narrator's TALKING POINT, not something anyone in the story writes, holds up, carves, or otherwise physically displays. NEVER show a character writing/tracing/holding a numeral (e.g. scrawling "15" in the dirt) — that looks absurd and has no basis in the story. Instead, visualize what the number MEANS: the person/moment/span of time it refers to, a symbolic passage of time, or a comparison of two states — without literalizing the digits as an object in the frame.
⚠️ PAST-IDENTITY REVEAL SHOTS: when narration explicitly reveals or states a character's FORMER title/role/identity for dramatic contrast ("이 노인은 한때 왕이었습니다", "그는 원래 장군이었다") — especially right after establishing their CURRENT diminished/different state — this is a strong cue to actually SHOW that former role (their past attire, setting, bearing) rather than just continuing to show their present/current-scene appearance unchanged. The dramatic point of a "was once X" line is the CONTRAST; a static repeat of the previous scene's visual wastes it. Prefer depicting the past role plainly, or a composition that visually bridges past and present (e.g. same posture/space, but during their time in power), over defaulting to whatever the immediately preceding scene already showed.

[STEP 1 — FIND THE EMOTIONAL PEAK]:
Read the scriptReference carefully. Find the ONE MOMENT of maximum emotional intensity.
Ask yourself: "What is the exact millisecond that would make an audience gasp, weep, or hold their breath?"

[STEP 2 — CHOOSE YOUR FILM TECHNIQUE]:
Consider: does this scene need a FACE (close-up) or a WORLD (wide shot)? Both are equally valid emotional tools.
• GRIEF / DESPAIR → Extreme Close-Up on face or trembling hands. Desaturated blue-grey palette. Shallow depth of field.
• RAGE / CONFRONTATION → Over-The-Shoulder shot. High contrast harsh side lighting. Warm amber rage tones.
• HOPE / REUNION → Wide Shot with characters small against vast beautiful environment. Warm golden backlight.
• SHOCK / REVELATION → Dutch angle (camera tilted 15°). Harsh flat frontal light. Hyper-sharp focus.
• LONGING / SEPARATION → Medium shot with character isolated on one side of frame. Muted, cold palette. Long negative space.
• POWER / TRIUMPH → Low angle shot looking up at character. Dramatic rim lighting. Saturated bold colors.
• FEAR / DREAD → Character seen from behind, facing something threatening. Dark shadows. Minimal light.
• TENDERNESS / LOVE → Close-Up with soft diffused light. Warm skin tones. Rack focus between two faces.
• ACTION / BATTLE → Wide or Full Shot showing bodies in motion and spatial relationship between combatants.

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
⚠️ CRITICAL PRESENCE CHECK: ONLY include characters who are PHYSICALLY PRESENT AND VISIBLE in THIS EXACT script segment. If the segment describes a battle, landscape, crowd event, or a scene where named characters are NOT actively present — set involvedCharacters to [] and render period-appropriate anonymous figures (soldiers, officials, commoners) instead. Do NOT force a named character into every scene.
⚠️ LARGE-CAST SCRIPTS (many named people in the roster, e.g. a biography compilation covering many historical figures in turn): a character may ONLY be tagged if THIS segment's text itself names them (or unambiguously refers to them by title/role given the immediate surrounding sentences) — NOT because they appeared in an earlier scene or are the first/most prominent roster entry. When the segment has moved on to a different person's story, do NOT keep tagging the earlier person.
⚠️ "NAMED AS AFFECTED-BY" IS NOT "PHYSICALLY PRESENT" — a roster character's name appearing in a sentence that describes how an event IMPACTS or CONCERNS them (e.g. "이것은 [이름]에게 재앙이었습니다", "[이름]에게 위협이 되었다") does NOT mean they are standing in the room where that event happens. Identify the actual GRAMMATICAL SUBJECT physically doing the concrete action in this segment (giving birth, being imprisoned, signing a document) — if that subject is someone else (or a person not in the roster at all), depict THAT person/scene faithfully (as an anonymous/generic figure if they have no roster entry) and do NOT insert the "affected" roster character into the frame just because their name is nearby and available to tag.
⚠️ PRESERVE ABSENT NAMES IN TEXT: If a character is absent but mentioned in the script, MUST preserve their true Korean name in the 'action' and 'description'.
⚠️ NEVER output twins, clones, or multiple generic figures if only ONE named character is acting.

[FINAL SCENE GROUNDING OVERRIDE — HIGHEST PRIORITY, READ LAST]:
⚠️ DO NOT DEFAULT TO FAMILIAR NAMED CHARACTERS. Before writing imagePrompt/involvedCharacters, first identify WHO or WHAT this exact script segment is actually about — it may be a different named character, an unnamed/anonymous party (a spy, an enemy commander, a crowd, an official), an object, or a location — NOT necessarily the character you used in the previous scene or the most "important" character in the roster.
⚠️ If the segment describes another party's action, plan, or scheme (e.g. an opposing side plotting, an unnamed messenger, a court receiving news), depict THAT party doing THAT specific thing. Do not substitute a more familiar character sitting on a throne or reacting generically just because it feels safer — read the segment's actual subject and verb.
⚠️ ADJACENT SCENE REDUNDANCY BAN: Do NOT reuse the same short quote, dialogue line, location, or emotional beat that a neighboring scene (same rough position in the story, e.g. consecutive scene IDs) would already cover. If the assigned segment overlaps in content with what a nearby scene likely depicts, find a distinct, more specific sub-moment, detail, or angle from THIS segment's exact wording instead of repeating the same iconic line or shot.`)}
[STYLE]: ${stylePreset.prompt}

${resilienceNote}`
}

// ─── 씬 1개 생성 ──────────────────────────────────────────────────────────────
export async function generateSingleSceneInfo(sceneRef, bible, stylePreset, langConfig, currentMode = 'normal', visualMode = 'character', isEditorialMode = false, isImageTextEnabled = false) {
  const client = await createClient()
  const prompt = currentMode === 'editorial'
    ? buildEditorialScenePrompt(sceneRef, bible, stylePreset, langConfig)
    : buildScenePrompt(sceneRef, bible, stylePreset, langConfig, false, visualMode, isEditorialMode, isImageTextEnabled)

  const res = await withRetry(() =>
    safeGenerate(client, {
      model:   TEXT_MODEL,
      contents: prompt,
      config:  {
        safetySettings: SAFETY_SETTINGS,
        thinkingConfig: { thinkingBudget: 0 },
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
  , 3, `씬 생성(${sceneRef.id})`, { model: TEXT_MODEL, smartBackoff: true })

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

  // 등장인물이 많은 대본에서 특정 인물로 쏠려 이미 안 맞는 구간까지 같은 이름이
  // 붙는 걸 막기 위해, 배정된 대본 구간에 실제로 이름이 나오는지 검증한다.
  const verifiedSegment    = sceneRef.fullScriptSegment || sceneRef.scriptReference || ''
  const verifiedCharacters = chars.length > 1
    ? resolvedCharacters.filter(name => nameAppearsInSegment(name, verifiedSegment))
    : resolvedCharacters

  return {
    ...cleanSceneOutput(raw, chars),
    id:               sceneRef.id || `scene_${Date.now()}`,
    involvedCharacters: verifiedCharacters,
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
        thinkingConfig: { thinkingBudget: 0 },
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
  , 3, `씬 재생성(${sceneRef.id})`, { model: TEXT_MODEL, smartBackoff: true })

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

  const verifiedSegment    = sceneRef.fullScriptSegment || sceneRef.scriptReference || ''
  const verifiedCharacters = chars.length > 1
    ? resolvedCharacters.filter(name => nameAppearsInSegment(name, verifiedSegment))
    : resolvedCharacters

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
    involvedCharacters: verifiedCharacters,
  }
}

// ─── 전체 씬 생성 (어댑티브 동시성) ──────────────────────────────────────────
export async function generateAllScenes(scriptText, bible, stylePreset, lang, onProgress, maxScenes = 30, currentMode = 'normal', visualMode = 'character', isEditorialMode = false, isImageTextEnabled = false) {
  const langConfig   = LANG_CONFIGS[lang] || LANG_CONFIGS.ko
  const bibleCtx     = { ...bible, _fullScript: scriptText }
  const rawScenesSplit = await splitScriptToScenes(scriptText, maxScenes, visualMode)
  const rawScenes    = attachCharacterContinuityHints(rawScenesSplit, bible.characters)
  const total        = rawScenes.length
  const results      = new Array(total).fill(null)

  onProgress(0, total)

  let concurrency  = 5
  let failCount429 = 0
  let i = 0

  while (i < total) {
    const chunk   = rawScenes.slice(i, i + concurrency)
    const indices = chunk.map((_, j) => i + j)

    try {
      const settled = await Promise.allSettled(
        chunk.map((scene, j) =>
          new Promise(r => setTimeout(r, j * 300))
            .then(() => generateSingleSceneInfo(scene, bibleCtx, stylePreset, langConfig, currentMode, visualMode, isEditorialMode, isImageTextEnabled))
        )
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

      failCount429 = 0
      onProgress(indices[indices.length - 1] + 1, total)
      i += chunk.length
      if (i < total) await new Promise(r => setTimeout(r, 500))

    } catch (err) {
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
