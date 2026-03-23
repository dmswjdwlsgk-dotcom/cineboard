// 한국어 조사 자동 보정
const KOREAN_POSTPOSITIONS = {
  '은/는': { withFinal: '은', withoutFinal: '는' },
  '이/가': { withFinal: '이', withoutFinal: '가' },
  '을/를': { withFinal: '을', withoutFinal: '를' },
  '과/와': { withFinal: '과', withoutFinal: '와' },
  '아/야': { withFinal: '아', withoutFinal: '야' },
  '이에요/예요': { withFinal: '이에요', withoutFinal: '예요' },
  '으로/로': { withFinal: '으로', withoutFinal: '로' },
}

function hasFinalConsonant(char) {
  if (!char) return false
  const code = char.charCodeAt(0)
  if (code < 0xAC00 || code > 0xD7A3) return false
  return (code - 0xAC00) % 28 !== 0
}

export function fixKoreanPostposition(text) {
  if (!text) return text

  // 은/는 패턴 처리
  text = text.replace(/([가-힣])(은\/는|이\/가|을\/를|과\/와|아\/야)/g, (match, char, postfix) => {
    const hasFinal = hasFinalConsonant(char)
    switch (postfix) {
      case '은/는': return char + (hasFinal ? '은' : '는')
      case '이/가': return char + (hasFinal ? '이' : '가')
      case '을/를': return char + (hasFinal ? '을' : '를')
      case '과/와': return char + (hasFinal ? '과' : '와')
      case '아/야': return char + (hasFinal ? '아' : '야')
      default: return match
    }
  })

  return text
}

export function removeEmojis(text) {
  if (!text) return text
  return text.replace(
    /[\u{1F600}-\u{1F64F}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{1F1E0}-\u{1F1FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}|\u{FE00}-\u{FE0F}|\u{1F900}-\u{1F9FF}|\u{1FA00}-\u{1FA6F}|\u{1FA70}-\u{1FAFF}|\u{231A}-\u{231B}|\u{23E9}-\u{23F3}|\u{23F8}-\u{23FA}|\u{25AA}-\u{25AB}|\u{25B6}|\u{25C0}|\u{25FB}-\u{25FE}|\u{2614}-\u{2615}|\u{2648}-\u{2653}|\u{267F}|\u{2693}|\u{26A1}|\u{26AA}-\u{26AB}|\u{26BD}-\u{26BE}|\u{26C4}-\u{26C5}|\u{26CE}|\u{26D4}|\u{26EA}|\u{26F2}-\u{26F3}|\u{26F5}|\u{26FA}|\u{26FD}|\u{2702}|\u{2705}|\u{2708}-\u{270D}|\u{270F}|\u{2712}|\u{2714}|\u{2716}|\u{271D}|\u{2721}|\u{2728}|\u{2733}-\u{2734}|\u{2744}|\u{2747}|\u{274C}|\u{274E}|\u{2753}-\u{2755}|\u{2757}|\u{2763}-\u{2764}|\u{2795}-\u{2797}|\u{27A1}|\u{27B0}|\u{27BF}|\u{2934}-\u{2935}|\u{2B05}-\u{2B07}|\u{2B1B}-\u{2B1C}|\u{2B50}|\u{2B55}|\u{3030}|\u{303D}|\u{3297}|\u{3299}]/gu,
    ''
  )
}

export function wrapText(text, width = 80) {
  if (!text) return ''
  const words = text.split(' ')
  const lines = []
  let currentLine = ''

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= width) {
      currentLine = (currentLine + ' ' + word).trim()
    } else {
      if (currentLine) lines.push(currentLine)
      currentLine = word
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines.join('\n')
}

export function applyCharacterNames(text, characters) {
  if (!text || !characters || characters.length === 0) return text

  let result = text
  const actorMap = {}

  characters.forEach((char, i) => {
    const actorTag = `[ACTOR-${String.fromCharCode(65 + i)}]` // [ACTOR-A], [ACTOR-B], ...
    actorMap[actorTag] = char.name
  })

  for (const [tag, name] of Object.entries(actorMap)) {
    result = result.replaceAll(tag, name)
  }

  return result
}

export function truncateText(text, maxLength = 100, ellipsis = '...') {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - ellipsis.length) + ellipsis
}

export function countCharacters(text) {
  if (!text) return 0
  return text.replace(/\s/g, '').length
}
