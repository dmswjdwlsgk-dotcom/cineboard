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
    l = l.replace(/^\d{1,3}[.)]\s*/, '') // 문단 앞 "1." "2)" 같은 번호 매기기 제거 (내용은 유지)
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
    costumeHierarchy: `⚠️ KOREAN COSTUME HIERARCHY (period drama only):
- 왕/임금/세자 → 익선관(tall black dome cap, two small rear flaps) + 곤룡포(ENTIRELY VERMILLION RED dragon robe, NO blue fabric, white collar only, gold embroidery). Hair completely hidden inside 익선관 — NO flowing hair visible outside the cap.
- 왕비/공주 → 활옷, 원삼, 봉황 문양
- 양반/선비 → 도포, 갓(black wide-brimmed hat)
- 관리/대감/정승 → 관복 + 사모(black hat with wide flat horizontal side wings) + 흉배. NEVER 익선관.
- 서민 → 일반 한복(저고리+바지/치마)
- ⚠️ NEVER assign dragon robe to non-royals`,
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

// ─── 대본의 "언어"와 대본의 "배경"을 분리한다 ────────────────────────────────
// LANG_CONFIGS의 ethnicityHint / costumeHierarchy는 대본 "언어"만 보고 붙는다.
// 그래서 한국어로 쓴 세계사 대본("세 종교는 어디서 갈라졌나": 아브라함, 메소포타미아,
// 로마, 오스만)에도 "Korean appearance, Korean names, Korean cultural context by
// default"와 조선 복식 위계(곤룡포, 관복+사모, 도포+갓)가 그대로 주입돼,
// 메소포타미아 인물이 동아시아 얼굴에 조선 관복 차림으로 생성되는 문제가 있었다.
//
// ⚠️ 다만 이 채널의 대본 대부분은 실제로 한국사다. 그래서 판별을 "한국이라는 증거가
// 있을 때만 한국"으로 짜면 안 된다 — 광해군 한 명만 다루면서 "조선"을 한 번도 안 쓰는
// 대본이 얼마든지 있고, 그런 대본이 외국인으로 생성되면 더 큰 사고다.
// 기본값은 언어 설정(한국어 → 한국인) 그대로 두고, 대본이 명백히 다른 시대·지역을
// 무대로 할 때만 푼다. 판단은 두 신호를 함께 본다:
//   - 한국 신호가 하나라도 있으면 → 한국 (외국 신호가 섞여 있어도 한국사 대본으로 본다.
//     한국사에는 명나라·일제·몽골이 얼마든지 등장한다)
//   - 한국 신호가 전혀 없고 + 외국 무대 신호가 2종류 이상이면 → 대본에서 외형을 끌어온다
//   - 둘 다 애매하면 → 기본값(언어 설정) 유지
// 한국 왕조·국가를 직접 가리키는 토큰.
// ⚠️ 1회만 나와도 확정하면 안 된다 — 세계사 대본이 한국을 한 번 비교로 언급하는 일이 있다.
// 실측: 한국사 대본 8~17회 / 한국을 스쳐 언급한 세계사 대본 1회
// (손자병법 대본이 한산도 학익진 대목의 "조선 수군" 한 번 때문에 한국사로 확정되어
//  100씬 전부에 조선 복식·한국인 외모가 주입됐다.)
const KOREA_DYNASTY = /조선|고려|신라|백제|고구려|발해|고조선|대한제국|대한민국|한반도|한국전쟁|임진왜란|병자호란|일제강점기|훈민정음|한양|경복궁|창덕궁|덕수궁|판문점|휴전선|삼팔선|38선/g
const KOREA_DYNASTY_MIN = 2

// 한국을 가리키지만 세계사 대본에도 비교·단위로 한두 번 나올 수 있는 토큰.
// 실제 대본 측정값: 한국사 대본 22~106회 / 세계사 대본 0~2회 — 개수로 가른다.
// ⚠️ 일반 단어와 겹치는 토큰(전하→"전하죠", 가야→"오가야", 세자→"납세자",
//    임금→임금 인상, 대비→대비하다)은 넣지 않는다. 오탐의 원인이었다.
const KOREA_WEAK = /한국|서울|남한|북한|국군|우리나라|한강|한복|한옥|양반|사대부|선비|사또|서당|과거시험|훈련도감|판서|정승|대감|이순신|세종대왕|정약용|안중근|김구|유관순|장영실|신사임당|왕건|광개토|을지문덕|계백|김유신|흥선대원군|인천상륙|낙동강|압록강|두만강/g
const KOREA_WEAK_MIN = 5

// 외국 무대 신호 — 종류별로 묶어서, 2종류 이상 걸릴 때만 "확실한 외국 배경"으로 본다
const FOREIGN_SETTING_GROUPS = [
  /메소포타미아|바빌론|수메르|아시리아|가나안|유프라테스|티그리스/,
  /이집트|파라오|나일|피라미드|스핑크스/,
  /로마|비잔틴|콘스탄티노플|카이사르|콜로세움|원로원|교황|바티칸/,
  /그리스|아테네|스파르타|올림포스|헬라/,
  /예루살렘|유대|이스라엘|팔레스타인|메카|메디나|카바|성전산|십자군/,
  /오스만|술탄|이스탄불|튀르키예|아라비아|베두인/,
  /페르시아|테헤란|조로아스터/,
  /프랑스|파리|영국|런던|잉글랜드|독일|베를린|스페인|이탈리아|합스부르크|중세 유럽/,
  /인도양|인도 아대륙|인더스|델리|무굴|갠지스|힌두/,
  /잉카|마야|아즈텍|아메리카 원주민/,
  /아브라함|모세|예수(?!회)|무함마드|하갈|이스마엘|야곱|사라의 몸종|아내 사라/,
  /아프리카|사하라|콩고|나이지리아|에티오피아|케냐|사헬|짐바브웨|말리|가나 제국/,
  /앙코르|캄보디아|크메르|인도네시아|자바|보로부두르|수마트라|태국|베트남|미얀마|라오스/,
  /중국|중화|베이징|자금성|만리장성|명나라|청나라|당나라|송나라|원나라|진시황|실크로드|춘추전국|전국시대|삼국지|제나라|초나라|위나라|촉나라|오나라|진나라|한나라|장강|황하|중원|낙양|장안/,
  /일본|도쿄|교토|오사카|에도 막부|에도 시대|막부|사무라이|쇼군|메이지 유신/,
  /몽골|칭기즈|초원 제국/,
  /러시아|모스크바|소련|차르|시베리아/,
  /북유럽|바이킹|스칸디나비아|노르드/,
]

const DERIVE_FROM_SCRIPT_HINT =
  'Derive each character\'s ethnicity, features and clothing from the ERA and REGION this script itself describes — ' +
  'not from the language the script is written in. A script written in Korean about Mesopotamia, Rome, medieval Europe ' +
  'or the Ottoman world has NO Korean characters in it. Read the script\'s own place names, period markers and personal ' +
  'names, and state the matching appearance explicitly (e.g. ancient Near Eastern, Semitic, Mediterranean, North African, ' +
  'Persian, Turkic, Northern European). Never default to Korean or East Asian appearance for these characters.'

// 이 대본의 무대가 대본 언어의 문화권인지 판별한다. 애매하면 true(기본값 유지).
export function isNativeSetting(lang, scriptText) {
  const text = scriptText || ''
  if (lang !== 'ko') return true                        // 판별 규칙이 있는 건 한국어뿐
  const dynasty = (text.match(KOREA_DYNASTY) || []).length
  if (dynasty >= KOREA_DYNASTY_MIN) return true         // 왕조·국가명이 반복되면 한국사
  const weak = (text.match(KOREA_WEAK) || []).length
  if (weak >= KOREA_WEAK_MIN) return true               // 한국 관련어가 충분히 반복되면 한국사
  const foreign = FOREIGN_SETTING_GROUPS.filter(re => re.test(text)).length
  return foreign < 2                                    // 외국 무대 신호가 2종류 미만이면 기본값 유지
}

// 씬 단위 재판별 — 한 대본 안에서 무대가 갈리는 경우를 위한 것.
// 예: "동양의 거대 유적" 대본은 인도네시아·이집트·앙코르를 다루면서 중간에
// 광개토대왕릉 논쟁 챕터가 들어간다. 대본 전체로는 한국사로 판정되지만
// 앙코르와트 씬에 조선 복식이 붙으면 안 된다.
// 씬 원문에 신호가 없으면 대본 전체 판정을 그대로 따른다.
export function resolveSceneCulture(segmentText, fallback) {
  const t = segmentText || ''
  if (!t) return fallback
  const korean = (t.match(KOREA_DYNASTY) || []).length > 0 || (t.match(KOREA_WEAK) || []).length > 0
  if (korean) return LANG_CONFIGS.ko.costumeHierarchy
    ? { ethnicityHint: LANG_CONFIGS.ko.ethnicityHint, costumeHierarchy: LANG_CONFIGS.ko.costumeHierarchy, native: true }
    : fallback
  const foreign = FOREIGN_SETTING_GROUPS.some(re => re.test(t))
  if (foreign) return { ethnicityHint: DERIVE_FROM_SCRIPT_HINT, costumeHierarchy: '', native: false }
  return fallback
}

// 이 대본에 실제로 써야 할 외형/복식 지침을 돌려준다.
export function resolveCultureContext(lang, scriptText) {
  const conf = LANG_CONFIGS[lang] || LANG_CONFIGS.ko
  if (isNativeSetting(lang, scriptText)) {
    return { ethnicityHint: conf.ethnicityHint, costumeHierarchy: conf.costumeHierarchy, native: true }
  }
  return { ethnicityHint: DERIVE_FROM_SCRIPT_HINT, costumeHierarchy: '', native: false }
}
