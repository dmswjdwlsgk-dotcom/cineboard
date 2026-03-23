export function detectLanguage(text) {
  if (!text || text.trim().length === 0) return 'ko'

  const sample = text.slice(0, 500)

  // 한국어 (Hangul)
  const koreanChars = (sample.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g) || []).length
  // 일본어 (Hiragana + Katakana)
  const japaneseChars = (sample.match(/[\u3040-\u30FF\u31F0-\u31FF]/g) || []).length
  // 중국어 (CJK Unified Ideographs, excluding shared CJK)
  const chineseChars = (sample.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g) || []).length
  // 아랍어
  const arabicChars = (sample.match(/[\u0600-\u06FF\u0750-\u077F]/g) || []).length
  // 힌디어 (Devanagari)
  const hindiChars = (sample.match(/[\u0900-\u097F]/g) || []).length
  // 태국어
  const thaiChars = (sample.match(/[\u0E00-\u0E7F]/g) || []).length
  // 베트남어 (Latin with diacritics specific to Vietnamese)
  const vietnameseChars = (sample.match(/[àáâãèéêìíòóôõùúýăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi) || []).length
  // 스페인어 포르투갈어 공통 (tilde, accent)
  const latinAccentChars = (sample.match(/[áéíóúüñãõàâêôçß]/gi) || []).length

  const total = sample.length

  // 비율 계산
  const ratios = {
    ko: koreanChars / total,
    ja: japaneseChars / total,
    zh: chineseChars / total,
    ar: arabicChars / total,
    hi: hindiChars / total,
    th: thaiChars / total,
    vi: vietnameseChars / total,
  }

  // 가장 높은 비율 언어 반환
  const maxLang = Object.entries(ratios).reduce((a, b) => (b[1] > a[1] ? b : a))
  if (maxLang[1] > 0.05) return maxLang[0]

  // 라틴 계열 구분 (스페인어 vs 포르투갈어 vs 영어)
  if (latinAccentChars > 5) {
    // ã, õ, ç → 포르투갈어
    const ptChars = (sample.match(/[ãõç]/gi) || []).length
    // ñ → 스페인어
    const esChars = (sample.match(/[ñ]/gi) || []).length
    if (ptChars > esChars) return 'pt'
    if (esChars > 0) return 'es'
  }

  // CJK 공유 한자가 많으면 일본어/중국어 재판단
  if (chineseChars > 10) {
    return japaneseChars > 5 ? 'ja' : 'zh'
  }

  // 기본값: 영어
  return 'en'
}
