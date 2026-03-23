// 원본 index-BgIIKBNf.js ma 객체에서 추출한 언어별 설정

// ─── 대본 언어 감지 (원본 Qs 함수 이식) ───────────────────────────────────────
export function detectLanguage(text) {
  const sample = text.slice(0, 3000)
  const ko = (sample.match(/[\uAC00-\uD7AF]/g) || []).length
  const hiragana = (sample.match(/[\u3040-\u309F]/g) || []).length
  const katakana = (sample.match(/[\u30A0-\u30FF]/g) || []).length
  const zh = (sample.match(/[\u4E00-\u9FFF]/g) || []).length
  const th = (sample.match(/[\u0E01-\u0E5B]/g) || []).length
  const hi = (sample.match(/[\u0900-\u097F]/g) || []).length
  const ar = (sample.match(/[\u0600-\u06FF\u0750-\u077F]/g) || []).length
  const vi = (sample.match(/[ăâđêôơưắằẳẵặấầẩẫậéèẻẽẹếềểễệóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/gi) || []).length
  const ja = hiragana + katakana

  if (th > 30) return 'th'
  if (hi > 30) return 'hi'
  if (ar > 30) return 'ar'
  if (vi > 20) return 'vi'
  if (ko > ja && ko > zh) return 'ko'
  if (ja > 30 || (ja > ko && ja > 0)) return 'ja'
  if (zh > ko && zh > ja && zh > 30) return 'zh'
  if (sample.replace(/[^a-záàâãéèêíìóòôõúùûüñçß\s]/gi, '').length > 100) {
    if ((sample.match(/[ñ¿¡]/g) || []).length + (sample.match(/\b(el|la|los|las|que|del|por|una|con|para|como|pero|más|este)\b/gi) || []).length > 5) return 'es'
    if ((sample.match(/[ãõç]/g) || []).length + (sample.match(/\b(não|para|uma|com|como|mais|também|pela|pode|está)\b/gi) || []).length > 5) return 'pt'
  }
  return 'en'
}

// ─── 대본 클린업 (원본 dt 함수 이식) ─────────────────────────────────────────
export function cleanScript(scriptText) {
  const stageDir = /^(화면|음악|음향|효과|배경음|자막|나레이션|해설자|해설|내레이션|씬|장면|장|막|시간|장소|카메라|영상|사운드|배경|NOTE|SFX|BGM|OST|EXT\.|INT\.|CUT TO|FADE IN|FADE OUT)[:.]\s/i
  return scriptText.split('\n').map(line => {
    let l = line.trim()
    l = l.replace(/^\[.*?\]:\s*/, '')
    return l
  }).filter(line => {
    const l = line.trim()
    if (!l) return false
    if (/^[-*=_#\s]+$/.test(l)) return false
    if (/^#{1,6}\s/.test(l)) return false
    if (/^[-=*]{3,}$/.test(l)) return false
    if (/^\[?\d{1,2}:\d{2}(:\d{2})?\]?(\s*~\s*\[?\d{1,2}:\d{2}(:\d{2})?\]?)?/.test(l)) return false
    if (/^([0-9]+부|[0-9]+장|제\s*[0-9]+\s*[부장]|Chapter\s*[0-9]+|제목\s*:|Part\s*[0-9]+)/i.test(l)) return false
    if (stageDir.test(l)) return false
    if (/^\(.*[화음장씬막자배제효].*\)$/.test(l)) return false
    return true
  }).join('\n')
}

export const LANG_CONFIGS = {
  ko: {
    outputInstruction: `CRITICAL: All narrative fields MUST be in KOREAN (한국어).
⚠️ KOREAN GRAMMAR RULES — ZERO TOLERANCE FOR ERRORS:
1. POSTPOSITIONS (조사): Check if the last character of the preceding word has a final consonant (받침).
   - 받침 O → 은/이/을/과/아 (예: 민준은, 부장이, 사람을, 민준과, 민준아)
   - 받침 X → 는/가/를/와/야 (예: 지수는, 하나가, 나를, 지수와, 지수야)
2. NATURAL KOREAN: Do NOT repeat 주어(subject) every sentence. Korean naturally omits subject when clear.
3. NO SPECIAL SYMBOLS: Do NOT use **, (), #, or markdown formatting in any narrative text.
4. [8S RULE]: Dialogue/ScreenText must be under 35 Korean characters.`,
    narratorNames: ['나레이션', '해설', '해설자', '내레이션', 'narrator', 'narration', 'Narrator', 'Narration'],
    ethnicityHint: 'Korean (East Asian). Characters should have Korean appearance, Korean names, and Korean cultural context by default.',
    costumeHierarchy: `⚠️ KOREAN TRADITIONAL COSTUME HIERARCHY (CRITICAL):
- 왕/임금/세자 ONLY → 용포(dragon robe), 곤룡포, 익선관
- 왕비/공주 ONLY → 활옷, 원삼, 봉황 문양
- 양반/선비 → 도포, 심의, 갓(black hat), 유건
- 관리/대감/정승 → 관복, 사모관대, 흉배
- 서민/상인 → 일반 한복(저고리+바지/치마), 두건
- 기녀/무녀 → 화려한 한복, 화관, 노리개
- ⚠️ NEVER assign 용포/dragon robe to non-royal characters`,
    locationExamples: '"숲속", "왕의 서재", "마을 광장", "강변"',
    dialogueRule: 'Dialogue must be under 35 Korean characters.',
  },
  ja: {
    outputInstruction: `CRITICAL: All narrative fields (name, description, dialogue, setting, action, imagePromptKo) MUST be in KOREAN (한국어).
Character names from Japanese script MUST be transliterated to Korean (한글 음차, e.g., 田中太郎→다나카 타로).
⚠️ EXCEPTION: 'scriptReference' and 'scriptAnchor' fields MUST remain in ORIGINAL Japanese verbatim.
[8S RULE]: Dialogue must be under 35 Korean characters.`,
    narratorNames: ['ナレーション', 'ナレーター', '語り手', '解説', '解説者', 'narrator', 'narration', 'Narrator', '나레이션', '해설'],
    ethnicityHint: 'Japanese (East Asian). Characters should have Japanese appearance and Japanese cultural context. Visual prompts should reflect Japanese ethnicity, fashion, and settings.',
    costumeHierarchy: `⚠️ JAPANESE TRADITIONAL COSTUME HIERARCHY (if period drama):
- 天皇/皇族 → 束帯(sokutai), 十二単(junihitoe)
- 将軍/大名 → 直垂(hitatare), 陣羽織(jinbaori), 烏帽子(eboshi)
- 武士/侍 → 着物+袴(hakama), 刀(katana)
- 商人/町人 → 着物(kimono), 帯(obi), 下駄(geta)
- 芸者/舞妓 → 振袖(furisode), 花簪(hanakanzashi)`,
    locationExamples: '"신사(神社)", "조카마치(城下町)", "온천 여관", "벚꽃길"',
    dialogueRule: 'Dialogue must be under 35 Korean characters.',
  },
  zh: {
    outputInstruction: `CRITICAL: All narrative fields MUST be in KOREAN (한국어).
Character names from Chinese script MUST be transliterated to Korean (한글 음차, e.g., 李明→리밍, 王芳→왕팡).
⚠️ EXCEPTION: 'scriptReference' and 'scriptAnchor' MUST remain in ORIGINAL Chinese verbatim.
[8S RULE]: Dialogue must be under 35 Korean characters.`,
    narratorNames: ['旁白', '解说', '叙述者', '解说员', 'narrator', 'narration', 'Narrator', '나레이션', '해설'],
    ethnicityHint: 'Chinese (East Asian). Characters should have Chinese appearance and Chinese cultural context. Visual prompts should reflect Chinese ethnicity, fashion, and settings.',
    costumeHierarchy: `⚠️ CHINESE TRADITIONAL COSTUME HIERARCHY (if period drama):
- 皇帝 → 龙袍(dragon robe), 冕冠(mianguan)
- 皇后/妃子 → 凤冠霞帔(fengguan xiapei)
- 官员/大臣 → 官服(guanfu), 朝珠(chaozhu)
- 文人/书生 → 长衫(changshan), 儒巾(rujin)
- 平民/百姓 → 短衫(duanshan), 布衣(buyi)`,
    locationExamples: '"대숲(竹林)", "황궁(皇宫)", "찻집(茶馆)", "강남수향"',
    dialogueRule: 'Dialogue must be under 35 Korean characters.',
  },
  th: {
    outputInstruction: `CRITICAL: All narrative fields MUST be in KOREAN (한국어).
Character names from Thai script MUST be transliterated to Korean (한글 음차, e.g., สมชาย→솜차이).
⚠️ EXCEPTION: 'scriptReference' and 'scriptAnchor' MUST remain in ORIGINAL Thai verbatim.
[8S RULE]: Dialogue must be under 35 Korean characters.`,
    narratorNames: ['ผู้บรรยาย', 'เสียงบรรยาย', 'narrator', 'narration', 'Narrator', '나레이션', '해설'],
    ethnicityHint: 'Thai (Southeast Asian). Characters MUST have Thai/Southeast Asian appearance with tan/brown skin, Thai facial features. Do NOT generate East Asian looking characters.',
    costumeHierarchy: `⚠️ THAI COSTUME HIERARCHY (if period drama):
- พระมหากษัตริย์ (King) → ชุดครุย (royal regalia), มงกุฎ (crown)
- พระราชินี (Queen) → ชุดไทยจักรี, สไบ (sabai)
- ขุนนาง (Noble) → ชุดราชปะแตน, ผ้านุ่ง`,
    locationExamples: '"왓(วัด, 사원)", "수상시장", "방콕 거리", "치앙마이 산간마을"',
    dialogueRule: 'Dialogue must be under 35 Korean characters.',
  },
  hi: {
    outputInstruction: `CRITICAL: All narrative fields MUST be in KOREAN (한국어).
Character names from Hindi script MUST be transliterated to Korean (한글 음차, e.g., राज→라즈, प्रिया→프리야).
⚠️ EXCEPTION: 'scriptReference' and 'scriptAnchor' MUST remain in ORIGINAL Hindi verbatim.
[8S RULE]: Dialogue must be under 35 Korean characters.`,
    narratorNames: ['सूत्रधार', 'कथावाचक', 'narrator', 'narration', 'Narrator', '나레이션', '해설'],
    ethnicityHint: 'Indian (South Asian). Characters MUST have Indian/South Asian appearance with brown skin, Indian facial features. Do NOT generate East Asian looking characters.',
    costumeHierarchy: `⚠️ INDIAN COSTUME HIERARCHY (if period drama):
- राजा/महाराजा (King) → शेरवानी (sherwani), पगड़ी (pagri/turban)
- रानी/महारानी (Queen) → लहंगा चोली (lehenga choli)
- सामान्य (Commoner) → कुर्ता-पायजामा (kurta-pajama), साड़ी (saree)`,
    locationExamples: '"궁전(महल)", "갠지스 강변", "시장(बाज़ार)", "타지마할"',
    dialogueRule: 'Dialogue must be under 35 Korean characters.',
  },
  ar: {
    outputInstruction: `CRITICAL: All narrative fields MUST be in KOREAN (한국어).
Character names from Arabic script MUST be transliterated to Korean (한글 음차, e.g., أحمد→아흐마드, فاطمة→파티마).
⚠️ EXCEPTION: 'scriptReference' and 'scriptAnchor' MUST remain in ORIGINAL Arabic verbatim.
[8S RULE]: Dialogue must be under 35 Korean characters.`,
    narratorNames: ['الراوي', 'السارد', 'narrator', 'narration', 'Narrator', '나레이션', '해설'],
    ethnicityHint: 'Arab/Middle Eastern. Characters MUST have Middle Eastern/Arab appearance with olive to brown skin. Do NOT generate East Asian looking characters.',
    costumeHierarchy: `⚠️ ARAB COSTUME HIERARCHY:
- ملك/سلطان (King) → بشت مطرز (embroidered bisht), عقال ذهبي (gold agal)
- تاجر (Merchant) → ثوب (thobe), عمامة (turban)
- نساء (Women) → عباية (abaya), حجاب (hijab)`,
    locationExamples: '"사막", "수크(시장)", "모스크", "오아시스"',
    dialogueRule: 'Dialogue must be under 35 Korean characters.',
  },
  vi: {
    outputInstruction: `CRITICAL: All narrative fields MUST be in KOREAN (한국어).
Character names from Vietnamese script MUST be transliterated to Korean (한글 음차, e.g., Nguyễn→응우옌, Trần→쩐).
⚠️ EXCEPTION: 'scriptReference' and 'scriptAnchor' MUST remain in ORIGINAL Vietnamese verbatim.
[8S RULE]: Dialogue must be under 35 Korean characters.`,
    narratorNames: ['người kể chuyện', 'narrator', 'narration', 'Narrator', '나레이션', '해설'],
    ethnicityHint: 'Vietnamese (Southeast Asian). Characters MUST have Vietnamese/Southeast Asian appearance. Do NOT generate East Asian (Korean/Japanese/Chinese) looking characters.',
    costumeHierarchy: `⚠️ VIETNAMESE COSTUME HIERARCHY (if period drama):
- Vua (King) → long bào (dragon robe), mũ miện (crown)
- Hoàng hậu (Queen) → áo nhật bình, phượng quan
- Thường dân (Commoner) → áo bà ba, quần đen, nón lá`,
    locationExamples: '"하롱베이", "호이안 골목", "논(ruộng lúa)", "메콩 강변"',
    dialogueRule: 'Dialogue must be under 35 Korean characters.',
  },
  es: {
    outputInstruction: `CRITICAL: All narrative fields MUST be in KOREAN (한국어).
Character names from Spanish script MUST be transliterated to Korean (한글 음차, e.g., Carlos→카를로스, María→마리아).
⚠️ EXCEPTION: 'scriptReference' and 'scriptAnchor' MUST remain in ORIGINAL Spanish verbatim.
[8S RULE]: Dialogue must be under 35 Korean characters.`,
    narratorNames: ['narrador', 'narradora', 'narrator', 'narration', 'Narrator', '나레이션', '해설'],
    ethnicityHint: 'Hispanic/Latino. Characters should have contextually appropriate Hispanic/Latino appearance based on the script setting.',
    costumeHierarchy: '',
    locationExamples: '"광장(plaza)", "성당(catedral)", "하시엔다(hacienda)", "시장(mercado)"',
    dialogueRule: 'Dialogue must be under 35 Korean characters.',
  },
  pt: {
    outputInstruction: `CRITICAL: All narrative fields MUST be in KOREAN (한국어).
Character names from Portuguese script MUST be transliterated to Korean (한글 음차, e.g., João→주앙, Ana→아나).
⚠️ EXCEPTION: 'scriptReference' and 'scriptAnchor' MUST remain in ORIGINAL Portuguese verbatim.
[8S RULE]: Dialogue must be under 35 Korean characters.`,
    narratorNames: ['narrador', 'narradora', 'narrator', 'narration', 'Narrator', '나레이션', '해설'],
    ethnicityHint: 'Brazilian/Portuguese. Brazil is multiracial — reflect diverse appearances based on context.',
    costumeHierarchy: '',
    locationExamples: '"파벨라(favela)", "코파카바나 해변", "아마존 강변"',
    dialogueRule: 'Dialogue must be under 35 Korean characters.',
  },
  en: {
    outputInstruction: `CRITICAL: All narrative fields MUST be in KOREAN (한국어).
Character names from English script MUST be transliterated to Korean (한글 음차, e.g., John Smith→존 스미스, Alice→앨리스).
⚠️ EXCEPTION: 'scriptReference' and 'scriptAnchor' MUST remain in ORIGINAL English verbatim.
⚠️ ETHNICITY AUTO-DETECTION (CRITICAL):
You MUST determine each character's ethnicity from their NAME and the SCRIPT'S CULTURAL CONTEXT. Do NOT default to Korean/East Asian.
- Western names (John, Alice) → Caucasian/Western appearance
- African names (Kwame, Amara, Chinua) → Black African appearance
- Mongolian names (Батболд, Temuujin) → Mongolian/Central Asian appearance
- Turkish names (Mehmet, Ayşe) → Turkish/Mediterranean appearance
- Latin American names (Carlos, María) → Hispanic/Latino appearance
[8S RULE]: Dialogue must be under 35 Korean characters.`,
    narratorNames: ['narrator', 'narration', 'voice-over', 'voiceover', 'Narrator', 'Narration', 'Voice-Over', '나레이션', '해설'],
    ethnicityHint: 'Detect character ethnicity from names and context. Western names → Caucasian, African names → Black, Hispanic names → Latino.',
    costumeHierarchy: '',
    locationExamples: '"숲", "성", "마을 광장", "도시의 거리", "항구"',
    dialogueRule: 'Dialogue must be under 35 Korean characters.',
  },
}
