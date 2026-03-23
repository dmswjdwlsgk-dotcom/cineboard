export const GENRES = [
  {
    id: 'drama',
    label: '드라마',
    emoji: '🎭',
    subGenres: [
      { id: 'family', label: '가족 드라마' },
      { id: 'romance', label: '로맨스' },
      { id: 'melodrama', label: '멜로드라마' },
      { id: 'youth', label: '청춘 드라마' },
      { id: 'workplace', label: '직장 드라마' },
      { id: 'medical', label: '의학 드라마' },
      { id: 'legal', label: '법정 드라마' },
      { id: 'school', label: '학교 드라마' },
    ],
  },
  {
    id: 'genre',
    label: '장르물',
    emoji: '🔪',
    subGenres: [
      { id: 'thriller', label: '스릴러' },
      { id: 'mystery', label: '미스터리' },
      { id: 'crime', label: '범죄' },
      { id: 'horror', label: '호러' },
      { id: 'action', label: '액션' },
      { id: 'noir', label: '누아르' },
      { id: 'spy', label: '첩보' },
      { id: 'heist', label: '케이퍼/하이스트' },
    ],
  },
  {
    id: 'fantasy_sf',
    label: '판타지/SF',
    emoji: '🚀',
    subGenres: [
      { id: 'fantasy', label: '판타지' },
      { id: 'sf', label: '사이언스픽션' },
      { id: 'time_travel', label: '타임슬립' },
      { id: 'isekai', label: '이세계' },
      { id: 'apocalypse', label: '포스트아포칼립스' },
      { id: 'superhero', label: '슈퍼히어로' },
      { id: 'occult', label: '오컬트' },
      { id: 'mythology', label: '신화/전설' },
    ],
  },
  {
    id: 'historical',
    label: '역사/시대극',
    emoji: '⚔️',
    subGenres: [
      { id: 'joseon', label: '조선시대' },
      { id: 'goryeo', label: '고려시대' },
      { id: 'ancient', label: '고대/삼국시대' },
      { id: 'modern_history', label: '근현대사' },
      { id: 'war', label: '전쟁' },
      { id: 'martial_arts', label: '무협' },
      { id: 'sageuk_fantasy', label: '사극 판타지' },
      { id: 'period_romance', label: '시대 로맨스' },
    ],
  },
]

export const TONES = [
  { id: 'serious', label: '진지함' },
  { id: 'light', label: '가볍고 밝음' },
  { id: 'dark', label: '어둡고 묵직함' },
  { id: 'emotional', label: '감성적' },
  { id: 'humorous', label: '유머러스' },
  { id: 'tense', label: '긴박감' },
  { id: 'romantic', label: '로맨틱' },
  { id: 'epic', label: '웅장함' },
]

export const VIEWPOINTS = [
  { id: 'omniscient', label: '전지적 작가 시점' },
  { id: 'first', label: '1인칭 주인공 시점' },
  { id: 'third_limited', label: '3인칭 제한 시점' },
  { id: 'multiple', label: '다중 시점' },
  { id: 'observer', label: '관찰자 시점' },
]

export const SCRIPT_LENGTHS = [
  { id: 'short', label: '단편 (10분 이하)', chars: 2000 },
  { id: 'medium', label: '중편 (10-30분)', chars: 6000 },
  { id: 'long', label: '장편 (30-60분)', chars: 12000 },
  { id: 'feature', label: '장편 영화 (90분+)', chars: 24000 },
]
