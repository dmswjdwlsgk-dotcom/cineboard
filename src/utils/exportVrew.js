import JSZip from 'jszip'

// ─── 원본 Wn() 함수 구조 그대로 재구현 ───────────────────────────────

const CONSTS = {
  MIN_SCENE_DURATION: 3,
  TTS_SECONDS_PER_CHAR: 0.2,
}

// UUID 생성 (원본 gt() 대응)
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// 단편 ID 생성 (원본 Ue() 대응: random hex 10자)
function shortId() {
  return Math.random().toString(16).substring(2, 12)
}

// base64 data URL → Uint8Array (원본 Gn() 대응)
function dataUrlToUint8Array(dataUrl) {
  const parts = dataUrl.split(',')
  const b64 = parts[1]
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// 이미지 없는 씬용 단색 placeholder PNG 생성 (canvas 사용)
function createPlaceholderPng(width, height) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#1a1f2b'
    ctx.fillRect(0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/png')
    return dataUrlToUint8Array(dataUrl)
  } catch {
    // canvas 실패 시 최소 PNG 바이너리 (1x1 검정)
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    return dataUrlToUint8Array('data:image/png;base64,' + b64)
  }
}

// 씬 duration 파싱 (원본 Kn() 대응)
function parseDuration(durStr) {
  if (!durStr) return 5
  const m = String(durStr).match(/(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : 5
}

// 대본 텍스트 정제 (원본 Yn() 대응)
function cleanScript(text, keepLinebreaks = false) {
  if (!text) return ''
  let t = text
  t = t.replace(/^#+\s*.*$/gm, '')
  t = t.replace(/^[-=*]{3,}$/gm, '')
  t = t.replace(/\((화면|음향|자막|액션|배경|카메라|장면|씬|막)[:|：][^)]*\)/g, '')
  t = t.replace(/\[?\d{1,2}:\d{2}(:\d{2})?\]?\s*/g, '')
  t = t.replace(/\[.*?\]:\s*/g, '')
  t = t.replace(/^[가-힣a-zA-Z\s]{1,15}:\s+/gm, '')
  t = t.replace(/(^|\s)(나레이션|내레이션|이미지|자막|해설):\s*/gmi, '$1')
  t = t.replace(/^(Scene|씬|S)\s*\d+[.:]?\s*/gmi, '')
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  if (keepLinebreaks) {
    t = t.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n')
  } else {
    t = t.split('\n').map(l => l.trim()).filter(l => l.length > 0).join(' ')
  }
  t = t.replace(/[ \t]{2,}/g, ' ')
  return t.trim()
}

// 텍스트를 문장 단위 클립으로 분할 (원본 Bn() 대응)
function splitToClips(text, maxChars = 35) {
  if (!text || text.trim().length === 0) return []
  const sentences = text
    .split(/(?<=[.!?。！"？]+[""']?)(?:\s+|$)/g)
    .map(s => s.trim())
    .filter(Boolean)
  return sentences
}

// Ken Burns 애니메이션 (원본 _n() 대응) - 정확한 원본 값 그대로
function randomKenBurns() {
  const types = [
    { type: 'magic-square',     from: { scale: 0.77, centerX: 0.5, centerY: 0.5 }, to: { scale: 0.63, centerX: 0.5, centerY: 0.5 } },
    { type: 'bottom-to-top',    from: { scale: 0.7,  centerX: 0.5, centerY: 0.58 }, to: { scale: 0.7,  centerX: 0.5, centerY: 0.42 } },
    { type: 'magic-horizontal', from: { scale: 0.7,  centerX: 0.58, centerY: 0.5 }, to: { scale: 0.7,  centerX: 0.42, centerY: 0.5 } },
    { type: 'zoom-in',          from: { scale: 0.77, centerX: 0.5, centerY: 0.5 }, to: { scale: 0.63, centerX: 0.5, centerY: 0.5 } },
    { type: 'top-to-bottom',    from: { scale: 0.7,  centerX: 0.5, centerY: 0.42 }, to: { scale: 0.7,  centerX: 0.5, centerY: 0.58 } },
  ]
  return types[Math.floor(Math.random() * types.length)]
}

// 캡션 스타일 프리셋 (원본 na 객체 그대로)
const CAPTION_PRESETS = {
  cinematic: {
    captionStyleSetting: {
      mediaId: 'uc-0010-simple-textbox',
      yAlign: 'bottom',
      yOffset: -0.05,
      xOffset: 0,
      rotation: 0,
      width: 0.96,
      customAttributes: [
        { attributeName: '--textbox-color', type: 'color-hex', value: 'rgba(0, 0, 0, 0.4)' },
        { attributeName: '--textbox-align', type: 'textbox-align', value: 'center' },
      ],
      scaleFactor: 1.7777777777777777,
    },
    quillStyle: {
      font: 'Pretendard-Vrew_700',
      size: '100',
      color: '#ffffff',
      'outline-on': 'true',
      'outline-color': '#000000',
      'outline-width': '6',
    },
  },
  youtube_shorts: {
    captionStyleSetting: {
      mediaId: 'uc-0010-simple-textbox',
      yAlign: 'center',
      yOffset: 0,
      xOffset: 0,
      rotation: 0,
      width: 0.9,
      customAttributes: [
        { attributeName: '--textbox-color', type: 'color-hex', value: 'rgba(0, 0, 0, 0.6)' },
        { attributeName: '--textbox-align', type: 'textbox-align', value: 'center' },
      ],
      scaleFactor: 1.7777777777777777,
    },
    quillStyle: {
      font: 'Pretendard-Vrew_700',
      size: '120',
      color: '#ffeb3b',
      'outline-on': 'true',
      'outline-color': '#000000',
      'outline-width': '8',
    },
  },
  documentary: {
    captionStyleSetting: {
      mediaId: 'uc-0010-simple-textbox',
      yAlign: 'bottom',
      yOffset: -0.08,
      xOffset: 0,
      rotation: 0,
      width: 0.85,
      customAttributes: [
        { attributeName: '--textbox-color', type: 'color-hex', value: 'rgba(0, 0, 0, 0.5)' },
        { attributeName: '--textbox-align', type: 'textbox-align', value: 'center' },
      ],
      scaleFactor: 1.7777777777777777,
    },
    quillStyle: {
      font: 'Pretendard-Vrew_400',
      size: '90',
      color: '#ffffff',
      'outline-on': 'true',
      'outline-color': '#000000',
      'outline-width': '4',
    },
  },
}

// 안전한 폰트 확인 (원본 Hn() 대응)
function safeFont(font) {
  const SAFE = ['Pretendard-Vrew_700', 'Pretendard-Vrew_400', 'Pretendard-Vrew_500']
  if (!font) return 'Pretendard-Vrew_700'
  if (SAFE.includes(font)) return font
  if (!/_\d+$/.test(font)) {
    const bold = `${font}_700`
    if (SAFE.includes(bold)) return bold
  }
  return 'Pretendard-Vrew_700'
}

// ─── 메인 내보내기 함수 ───────────────────────────────────────────────

export async function exportVrew(scenes, options = {}) {
  const {
    editMode = 'split',
    maxCharsPerClip = 35,
    captionPreset = 'cinematic',
    enableAnimation = true,
    aspectRatio = '16:9',
    smartMerge = true,
  } = options

  const isVertical = aspectRatio === '9:16'
  const videoWidth  = isVertical ? 1080 : 1920
  const videoHeight = isVertical ? 1920 : 1080
  const videoRatio  = isVertical ? 0.5625 : 1.7777777777777777

  // 캡션 스타일 (폰트 안전 처리 + scaleFactor를 videoRatio에 맞게 동적 설정)
  const rawCaption = CAPTION_PRESETS[captionPreset] || CAPTION_PRESETS.cinematic
  const captionStyle = {
    ...rawCaption,
    captionStyleSetting: {
      ...rawCaption.captionStyleSetting,
      scaleFactor: videoRatio,   // 16:9 → 1.7777..., 9:16 → 0.5625
    },
    quillStyle: {
      ...rawCaption.quillStyle,
      font: safeFont(rawCaption.quillStyle.font),
    },
  }

  const now = new Date()
  const isoDate = now.toISOString()
  const localDate = now.toLocaleString('sv-SE').replace(' ', 'T') + '+09:00'

  // ─── project 뼈대 (원본 A 객체 구조 그대로) ─────────────────────────
  const project = {
    version: 15,
    files: [
      // 워터마크 리소스 (항상 첫 번째)
      {
        version: 1,
        mediaId: 'vrewmark_white_01',
        sourceOrigin: 'VREW_RESOURCE',
        fileSize: 6879,
        name: 'vrewmark_white_01.png',
        type: 'Image',
        isTransparent: true,
        fileLocation: 'IN_MEMORY',
      },
    ],
    transcript: { scenes: [] },
    props: {
      assets: {},
      audios: {},
      overdubInfos: {},
      analyzeDate: null,
      captionDisplayMode: { 0: true, 1: false },
      mediaEffectMap: {},
      markerNames: { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
      flipSetting: {},
      videoRatio,
      globalVideoTransform: { zoom: 1, xPos: 0, yPos: 0, rotation: 0 },
      videoSize: { width: videoWidth, height: videoHeight },
      backgroundMap: {},
      globalCaptionStyle: { ...captionStyle, quillJsonForDisplay: [] },
      lastTTSSettings: {
        pitch: 1, speed: -1, volume: -1,
        speaker: { gender: 'female', age: 'middle', provider: 'vrew', lang: 'ko-KR', name: 'va29', speakerId: 'va29', versions: ['v2'] },
        version: 'v2',
      },
      initProjectVideoSize: { width: videoWidth, height: videoHeight },
      pronunciationDisplay: true,
      projectAudioLanguage: 'ko',
      audioLanguagesMap: {},
      originalClipsMap: {},
      ttsClipInfosMap: {},   // 나중에 채움
      waterMark: {
        type: 'watermark',
        mediaId: 'vrewmark_white_01',
        xPos: 0.025,
        yPos: 0.037,
        height: 0.16118518518518518,
        width: 0.12,
        rotation: 0,
        vrewMark: { version: 2, color: 'WHITE', index: 0, position: 'TOP_LEFT' },
      },
    },
    comment: `3.6.1\t${isoDate}`,
    projectId: uuid(),
    statistics: {
      wordCursorCount:    { 0:0,1:0,2:0,3:0,4:0,5:0,6:0,7:0 },
      wordSelectionCount: { 0:0,1:0,2:0,3:0,4:0,5:0,6:0,7:0 },
      wordCorrectionCount:{ 0:0,1:0,2:0,3:0,4:0,5:0,6:0,7:0 },
      projectStartMode: 'images_to_video',
      saveInfo: {
        created: { version: '3.6.1', date: localDate, stage: 'release' },
        updated: { version: '3.6.1', date: localDate, stage: 'release' },
        loadCount: 0,
        saveCount: 1,
      },
      savedStyleApplyCount: 0,
      cumulativeTemplateApplyCount: 0,
      ratioChangedByTemplate: false,
      videoRemixInfos: {},
      isAIWritingUsed: false,
      clientLinebreakExecuteCount: 0,
      agentStats: { isEdited: false, requestCount: 0, responseCount: 0, toolCallCount: 0, toolErrorCount: 0 },
    },
    lastTTSSettings: {
      pitch: 1, speed: -1, volume: -1,
      speaker: { gender: 'female', age: 'middle', provider: 'vrew', lang: 'ko-KR', name: 'va29', speakerId: 'va29', versions: ['v2'] },
      version: 'v2',
    },
  }

  // ─── ZIP 생성 ─────────────────────────────────────────────────────
  const zip = new JSZip()
  const mediaFolder = zip.folder('media')

  // ─── 씬별 처리 ────────────────────────────────────────────────────
  for (let sceneIdx = 0; sceneIdx < scenes.length; sceneIdx++) {
    const scene = scenes[sceneIdx]

    // 1) 이미지 바이너리 준비 (없으면 단색 placeholder)
    const hasRealImage = scene.imageUrl && scene.imageUrl.includes('base64,')
    const imageBytes = hasRealImage
      ? dataUrlToUint8Array(scene.imageUrl)
      : createPlaceholderPng(videoWidth, videoHeight)

    const imageMediaId = uuid()
    const imageFilename = `${imageMediaId}.png`
    mediaFolder.file(imageFilename, imageBytes)

    // 2) files[] 에 이미지 항목 추가
    project.files.push({
      version: 1,
      mediaId: imageMediaId,
      sourceOrigin: 'USER',
      fileSize: imageBytes.length,
      name: imageFilename,
      type: 'Image',
      fileLocation: 'IN_MEMORY',
      isTransparent: false,
    })

    // 3) props.assets 에 asset 등록
    const assetId = uuid()
    const asset = {
      mediaId: imageMediaId,
      xPos: 0,
      yPos: 0,
      height: 1,
      width: 1,
      rotation: 0,
      zIndex: editMode === 'single' ? -1 : 0,
      type: 'image',
      originalWidthHeightRatio: videoRatio,
      importType: editMode === 'single' ? 'images_to_video' : 'modal_upload',
      stats: { fillType: 'cover' },
    }
    if (enableAnimation && hasRealImage) {
      asset.kenburnsAnimationInfo = randomKenBurns()
    }
    project.props.assets[assetId] = asset

    // 4) 오디오 stub (원본: fake MP3 header)
    const audioId = uuid().replace(/-/g, '').substring(0, 10)   // 원본 V
    const audioFilename = `${audioId}.mpga`
    const mpgaStub = new Uint8Array([255, 251, 144, 0])    // fake MP3 header

    // 5) 씬 텍스트 준비: 할당된 전체 대본 구간을 우선 사용
    const rawText = scene.fullScriptSegment || scene.dialogue || scene.action || scene.screenText || ''
    const cleanedText = cleanScript(rawText, editMode === 'single')

    // 6) 클립 단위 텍스트 분할
    let clipTexts
    if (editMode === 'single') {
      const t = cleanedText.split('\n').map(l => l.trim()).filter(Boolean).join('\n')
      clipTexts = t ? [t] : ['']
    } else {
      clipTexts = splitToClips(cleanedText, maxCharsPerClip)
      if (clipTexts.length === 0) clipTexts = ['']
    }

    // 7) 클립 생성
    const clips = []
    let sceneTotalTime = 0

    for (let clipIdx = 0; clipIdx < clipTexts.length; clipIdx++) {
      const clipText = clipTexts[clipIdx]
      const charCount = clipText.replace(/[\s\n]/g, '').length
      const clipDuration = Math.min(
        120,
        Math.max(CONSTS.MIN_SCENE_DURATION, Math.ceil(charCount * CONSTS.TTS_SECONDS_PER_CHAR))
      )

      const words = []
      const PUNCT_PAUSE  = 0.2   // 원본 we
      const COMMA_PAUSE  = 0.15  // 원본 ue
      const SPEECH_RATIO = 0.7   // 원본 P

      const wordTokens = clipText
        ? (clipText.replace(/\n/g, ' ').match(/\S+\s*/g) || []).map(w => w.trim() + ' ')
        : []

      if (wordTokens.length === 0) {
        // 텍스트 없음: 묵음 + 마커
        const silDur = Math.min(0.5, clipDuration * 0.1)
        const remDur = clipDuration - silDur
        words.push({
          id: shortId(), text: '.', startTime: sceneTotalTime,
          duration: parseFloat(silDur.toFixed(4)),
          aligned: false, type: 0,
          originalDuration: parseFloat(silDur.toFixed(4)),
          originalStartTime: sceneTotalTime,
          truncatedWords: [], autoControl: false,
          mediaId: audioId, audioIds: [], assetIds: [], playbackRate: 1,
        })
        words.push({
          id: shortId(), text: '', startTime: parseFloat((sceneTotalTime + silDur).toFixed(4)),
          duration: parseFloat(remDur.toFixed(4)),
          aligned: false, type: 1,
          originalDuration: parseFloat(remDur.toFixed(4)),
          originalStartTime: parseFloat((sceneTotalTime + silDur).toFixed(4)),
          truncatedWords: [], autoControl: false,
          mediaId: audioId, audioIds: [], assetIds: [], playbackRate: 1,
        })
        words.push({
          id: shortId(), text: '', startTime: sceneTotalTime + clipDuration,
          duration: 0, aligned: false, type: 2,
          originalDuration: 0, originalStartTime: sceneTotalTime + clipDuration,
          truncatedWords: [], autoControl: false,
          mediaId: audioId, audioIds: [], assetIds: [], playbackRate: 1,
        })
        sceneTotalTime += clipDuration
      } else {
        // 구두점/쉼표 pause 합산
        const punctCount = wordTokens.filter(w => /[.!?。]$/.test(w.trim())).length
        const commaCount = wordTokens.filter(w => /,$/.test(w.trim())).length
        const totalPause = Math.min(punctCount * PUNCT_PAUSE + commaCount * COMMA_PAUSE, clipDuration * 0.3)
        const speechTime = clipDuration * SPEECH_RATIO - totalPause
        const totalChars = wordTokens.reduce((s, w) => s + w.replace(/[.!?,。]/g, '').length, 0) || 1

        let cursor = sceneTotalTime
        for (let wi = 0; wi < wordTokens.length; wi++) {
          const w = wordTokens[wi]
          const chars = Math.max(1, w.replace(/[.!?,。]/g, '').length)
          const wDur = parseFloat((chars / totalChars * speechTime).toFixed(4))
          words.push({
            id: shortId(), text: w,
            startTime: parseFloat(cursor.toFixed(4)),
            duration: wDur, aligned: false, type: 0,
            originalDuration: wDur,
            originalStartTime: parseFloat(cursor.toFixed(4)),
            truncatedWords: [], autoControl: false,
            mediaId: audioId, audioIds: [], assetIds: [], playbackRate: 1,
          })
          cursor += wDur

          // 문장 끝 pause
          if (/[.!?。]$/.test(w.trim()) && wi < wordTokens.length - 1 && totalPause > 0) {
            const p = parseFloat(PUNCT_PAUSE.toFixed(4))
            words.push({
              id: shortId(), text: '',
              startTime: parseFloat(cursor.toFixed(4)),
              duration: p, aligned: false, type: 1,
              originalDuration: p, originalStartTime: parseFloat(cursor.toFixed(4)),
              truncatedWords: [], autoControl: false,
              mediaId: audioId, audioIds: [], assetIds: [], playbackRate: 1,
            })
            cursor += p
          }
          // 쉼표 pause
          if (/,$/.test(w.trim()) && wi < wordTokens.length - 1 && totalPause > 0) {
            const p = parseFloat(COMMA_PAUSE.toFixed(4))
            words.push({
              id: shortId(), text: '',
              startTime: parseFloat(cursor.toFixed(4)),
              duration: p, aligned: false, type: 1,
              originalDuration: p, originalStartTime: parseFloat(cursor.toFixed(4)),
              truncatedWords: [], autoControl: false,
              mediaId: audioId, audioIds: [], assetIds: [], playbackRate: 1,
            })
            cursor += p
          }
        }

        // 말 끝 ~ 씬 끝 사이 묵음
        const silStart = parseFloat(cursor.toFixed(4))
        const silDur = parseFloat(Math.max(0.1, sceneTotalTime + clipDuration - silStart).toFixed(4))
        words.push({
          id: shortId(), text: '',
          startTime: silStart, duration: silDur, aligned: false, type: 1,
          originalDuration: silDur, originalStartTime: silStart,
          truncatedWords: [], autoControl: false,
          mediaId: audioId, audioIds: [], assetIds: [], playbackRate: 1,
        })

        // 끝 마커
        const endTime = parseFloat((silStart + silDur).toFixed(4))
        words.push({
          id: shortId(), text: '',
          startTime: endTime, duration: 0, aligned: false, type: 2,
          originalDuration: 0, originalStartTime: endTime,
          truncatedWords: [], autoControl: false,
          mediaId: audioId, audioIds: [], assetIds: [], playbackRate: 1,
        })
        sceneTotalTime += clipDuration
      }

      // captions (Quill delta 형식)
      const captionText = clipText ? clipText.replace(/\n/g, ' ') : '.'
      const captions = [
        { text: [{ insert: `${captionText}\n` }] },
        { text: [{ insert: '\n' }] },
      ]

      clips.push({
        id: uuid(),
        words,
        assetIds: assetId ? [assetId] : [],
        audioIds: [],
        captionMode: 'MANUAL',
        captions,
        dirty: { blankDeleted: false, caption: false, video: false },
        translationModified: { result: false, source: false },
      })
    }

    // 오디오 파일 및 files[] 항목 추가
    mediaFolder.file(audioFilename, mpgaStub)
    project.files.push({
      version: 1,
      mediaId: audioId,
      sourceOrigin: 'VREW_RESOURCE',
      fileSize: mpgaStub.length,
      name: audioFilename,
      type: 'AVMedia',
      videoAudioMetaInfo: {
        audioInfo: { codec: 'mp3', sampleRate: 24000 },
        duration: sceneTotalTime,
      },
      sourceFileType: 'TTS',
      fileLocation: 'IN_MEMORY',
    })

    // transcript.scenes 추가
    project.transcript.scenes.push({
      id: uuid(),
      clips,
      name: `Scene ${String(sceneIdx + 1).padStart(3, '0')}`,
      dirty: { video: false },
    })
  }

  // ─── ttsClipInfosMap 구성 (원본 k 객체) ──────────────────────────
  const speaker = project.lastTTSSettings.speaker
  for (const scene of project.transcript.scenes) {
    if (scene.clips.length === 0) continue
    const textWords = scene.clips[0].words.filter(w => w.type === 0)
    if (textWords.length === 0) continue
    const audioMediaId = textWords[0].mediaId
    const fullText = scene.clips
      .map(c => c.captions[0].text.map(t => t.insert).join('').replace(/\n/g, '').trim())
      .join(' ')
    const endMarker = scene.clips[scene.clips.length - 1].words.find(w => w.type === 2)
    const duration = endMarker?.startTime || 0
    project.props.ttsClipInfosMap[audioMediaId] = {
      duration,
      text: { raw: fullText, textAspectLang: 'ko-KR', processed: fullText },
      speaker: { ...speaker },
      volume: -1, speed: -1, pitch: 1,
      version: project.lastTTSSettings.version || 'v2',
    }
  }

  // ─── project.json → ZIP 루트에 저장 ──────────────────────────────
  zip.file('project.json', JSON.stringify(project, null, 2))

  // ─── .vrew 파일 다운로드 ──────────────────────────────────────────
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })

  const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
  const filename = `dodojin_${ts}.vrew`

  // createObjectURL 방식으로 다운로드 (원본과 동일)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
