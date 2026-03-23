import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const initialState = {
  currentStep: 1,

  // ─── 1단계: 대본 ──────────────────────────────────────────────────────
  scriptText: '',
  selectedGenre: null,
  selectedSubGenre: null,
  customGenre: '',
  selectedTone: 'friendly',
  selectedViewpoint: 'third',
  selectedLength: 'medium',
  detectedLanguage: 'ko',

  // ─── 2단계: 스타일 ────────────────────────────────────────────────────
  selectedStyleId: 'cinematic',
  selectedModel: 0,           // MODELS 배열 인덱스
  aspectRatio: '16:9',
  targetSceneCount: 20,
  currentMode: 'normal',      // 'normal' | 'editorial' | 'precision'

  // ─── 3단계: 바이블 ────────────────────────────────────────────────────
  continuityBible: null,
  characterImages: {},        // { characterName: base64DataUrl }

  // ─── 4단계: 씬 시퀀스 ────────────────────────────────────────────────
  scenes: [],
  sceneImages: {},            // { sceneId: base64DataUrl }

  // ─── 5단계: 쇼츠 ─────────────────────────────────────────────────────
  shortsClips: [],

  // ─── 6단계: 인트로 ────────────────────────────────────────────────────
  introClips: [],

  // ─── 7단계: BGM ──────────────────────────────────────────────────────
  bgmData: null,              // 글로벌 BGM (단일 트랙)
  multiTrackBGM: null,        // 멀티트랙 BGM 배열

  // ─── 8단계: SEO & 썸네일 ──────────────────────────────────────────────
  youtubeMetadata: null,      // { titles[], description, hashtags[], thumbnailTexts[] }
  thumbnails: [],             // [{ label, imageUrl, error }]

  // ─── 공통 상태 ────────────────────────────────────────────────────────
  generationProgress: { current: 0, total: 0 },
  isGenerating: false,
  generationStatus: {},       // { [sectionKey]: 'idle' | 'loading' | 'done' | 'error' }
  error: null,
}

export const useAppStore = create(
  persist(
    (set, get) => ({
      ...initialState,

      // ── 내비게이션 ───────────────────────────────────────────────────
      setStep: (step) => set({ currentStep: step }),

      // ── 대본 ────────────────────────────────────────────────────────
      setScriptText:       (text)      => set({ scriptText: text }),
      setGenre:            (genre)     => set({ selectedGenre: genre, selectedSubGenre: null }),
      setSubGenre:         (sub)       => set({ selectedSubGenre: sub }),
      setCustomGenre:      (custom)    => set({ customGenre: custom }),
      setTone:             (tone)      => set({ selectedTone: tone }),
      setViewpoint:        (vp)        => set({ selectedViewpoint: vp }),
      setLength:           (len)       => set({ selectedLength: len }),
      setDetectedLanguage: (lang)      => set({ detectedLanguage: lang }),

      // ── 스타일 ──────────────────────────────────────────────────────
      setStyle:           (styleId)   => set({ selectedStyleId: styleId }),
      setModel:           (modelIdx)  => set({ selectedModel: modelIdx }),
      setAspectRatio:     (ratio)     => set({ aspectRatio: ratio }),
      setTargetSceneCount: (n)        => set({ targetSceneCount: n }),
      setCurrentMode:     (mode)      => set({ currentMode: mode }),

      // ── 바이블 ──────────────────────────────────────────────────────
      setBible: (bible) => set({ continuityBible: bible }),
      updateCharacter: (idx, updates) =>
        set((state) => {
          if (!state.continuityBible) return {}
          const characters = [...(state.continuityBible.characters || [])]
          characters[idx]  = { ...characters[idx], ...updates }
          return { continuityBible: { ...state.continuityBible, characters } }
        }),
      setCharacterImage: (name, dataUrl) =>
        set((state) => ({ characterImages: { ...state.characterImages, [name]: dataUrl } })),
      removeCharacterImage: (name) =>
        set((state) => {
          const { [name]: _, ...rest } = state.characterImages
          return { characterImages: rest }
        }),

      // ── 씬 ──────────────────────────────────────────────────────────
      setScenes: (scenes) => set({ scenes }),
      updateScene: (idxOrId, updates) =>
        set((state) => {
          const scenes = [...state.scenes]
          const idx = typeof idxOrId === 'number'
            ? idxOrId
            : scenes.findIndex(s => s.id === idxOrId)
          if (idx < 0 || idx >= scenes.length) return {}
          scenes[idx] = { ...scenes[idx], ...updates }
          return { scenes }
        }),
      setSceneImage: (sceneId, dataUrl) =>
        set((state) => ({
          sceneImages: { ...state.sceneImages, [sceneId]: dataUrl },
          scenes: state.scenes.map(s => s.id === sceneId ? { ...s, imageUrl: dataUrl } : s),
        })),

      // ── 쇼츠 ────────────────────────────────────────────────────────
      setShortsClips:  (clips) => set({ shortsClips: clips }),
      addShortsClips:  (clips) => set((state) => ({ shortsClips: [...state.shortsClips, ...clips] })),
      clearShortsClips: ()     => set({ shortsClips: [] }),

      // ── 인트로 ──────────────────────────────────────────────────────
      setIntroClips:   (clips) => set({ introClips: clips }),
      addIntroClips:   (clips) => set((state) => ({ introClips: [...state.introClips, ...clips] })),
      clearIntroClips: ()      => set({ introClips: [] }),

      // ── BGM ─────────────────────────────────────────────────────────
      setBGM:          (bgm)    => set({ bgmData: bgm }),
      setMultiTrackBGM:(tracks) => set({ multiTrackBGM: tracks }),

      // ── SEO & 썸네일 ────────────────────────────────────────────────
      setMetadata:    (meta)       => set({ youtubeMetadata: meta }),
      setThumbnails:  (thumbs)     => set({ thumbnails: thumbs }),

      // ── 진행 상태 ────────────────────────────────────────────────────
      setProgress:   (current, total) => set({ generationProgress: { current, total } }),
      setGenerating: (flag)           => set({ isGenerating: flag }),
      setSectionStatus: (key, status) =>
        set((state) => ({ generationStatus: { ...state.generationStatus, [key]: status } })),

      // ── 에러 ────────────────────────────────────────────────────────
      setError:   (error) => set({ error }),
      clearError: ()      => set({ error: null }),

      // ── 전체 초기화 ──────────────────────────────────────────────────
      resetAll: () => set(initialState),
    }),
    {
      name: 'cineboard-storage',
      partialize: (state) => ({
        // 대용량 이미지 데이터 제외하고 저장
        currentStep:         state.currentStep,
        scriptText:          state.scriptText,
        selectedGenre:       state.selectedGenre,
        selectedSubGenre:    state.selectedSubGenre,
        customGenre:         state.customGenre,
        selectedTone:        state.selectedTone,
        selectedViewpoint:   state.selectedViewpoint,
        selectedLength:      state.selectedLength,
        selectedStyleId:     state.selectedStyleId,
        selectedModel:       state.selectedModel,
        aspectRatio:         state.aspectRatio,
        targetSceneCount:    state.targetSceneCount,
        currentMode:         state.currentMode,
        detectedLanguage:    state.detectedLanguage,
        // continuityBible에서 대용량 charImageUrl 제외하고 저장
        continuityBible: state.continuityBible ? {
          ...state.continuityBible,
          characters: (state.continuityBible.characters || []).map(c => {
            const { charImageUrl, ...rest } = c || {}
            return rest
          }),
        } : null,
        // 씬은 imageUrl 제외하고 저장
        scenes: (state.scenes || []).map(s => {
          const { imageUrl, ...rest } = s || {}
          return rest
        }),
        youtubeMetadata: state.youtubeMetadata,
        bgmData:         state.bgmData,
        multiTrackBGM:   state.multiTrackBGM,
      }),
    }
  )
)
