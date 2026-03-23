import JSZip from 'jszip'
import { saveAs } from 'file-saver'

function base64ToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',')
  const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png'
  const byteString = atob(data)
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  return new Blob([ab], { type: mimeType })
}

function generateReportHtml(state) {
  const {
    scenes = [], continuityBible = {}, youtubeMetadata = null,
    bgmData = null, multiTrackBGM = null, scriptText = '',
    shortsClips = [], introClips = [], thumbnails = [],
    characterImages = {}, selectedStyleId = 'cinematic',
  } = state

  // ── 등장인물 ──────────────────────────────────────────────────────────────
  const charsHtml = (continuityBible.characters || []).map((c, i) => {
    const tag = `ACTOR-${String.fromCharCode(65 + i)}`
    const imgSrc = c.imageUrl || characterImages[c.name] || ''
    return `<div class="character-card">
    <div class="card-left">
      ${imgSrc ? `<img src="${imgSrc}" alt="${c.name}">` : '<div class="placeholder">이미지 없음</div>'}
    </div>
    <div class="card-right">
      <div class="actor-tag">${tag}</div>
      <div class="meta-label">인물명</div>
      <div class="meta-value" style="font-size:18px;font-weight:900;color:#fff;">${c.name} ${c.isProtagonist ? '⭐' : ''}</div>
      <div class="meta-label">역할 / 나이</div>
      <div class="meta-value">${c.role || ''} ${c.age ? `· ${c.age}` : ''} ${c.gender ? `· ${c.gender}` : ''}</div>
      ${c.description ? `<div class="meta-label">인물 설명</div><div class="meta-value">${c.description}</div>` : ''}
      ${c.visualPrompt ? `<div class="meta-label">비주얼 프롬프트 (EN)</div><div class="prompt-box">${c.visualPrompt}</div>` : ''}
    </div>
  </div>`
  }).join('')

  // ── 씬 카드 공통 함수 ──────────────────────────────────────────────────────
  function sceneCardHtml(scene, idx, label) {
    const videoJson = JSON.stringify({
      id: scene.id,
      shotType: scene.shotType,
      cameraMovement: scene.cameraMovement,
      duration: scene.duration,
      videoPromptEn: scene.videoPromptEn,
    }, null, 2)
    return `<div class="scene-item">
    <div class="scene-title">
      <span class="scene-id">${label || ('P' + String(idx + 1).padStart(2, '0'))}</span>
      ${scene.action || ''}
    </div>
    <div class="scene-content">
      <div class="scene-left">
        ${scene.imageUrl ? `<img src="${scene.imageUrl}" alt="씬 ${idx + 1}">` : '<div class="placeholder">이미지 없음</div>'}
      </div>
      <div class="scene-right">
        <div class="meta-label">장면 설명</div>
        <div class="meta-value">${scene.description || scene.action || ''}</div>
        ${scene.dialogue ? `<div class="meta-label">대사 / 나레이션</div><div class="dialogue-box">${scene.dialogue}</div>` : ''}
        ${scene.imagePrompt ? `<div class="meta-label">이미지 프롬프트 (EN)</div><div class="prompt-box">${scene.imagePrompt}</div>` : ''}
        ${scene.videoPromptKo ? `<div class="meta-label">영상 제작 가이드</div><div class="meta-value" style="font-size:12px;color:#9ca3af;">${scene.videoPromptKo}</div>` : ''}
        <div class="meta-label">VIDEO AI JSON</div>
        <div class="json-box">${videoJson}</div>
        <div class="tag-row">
          ${(scene.involvedCharacters || []).map(n => `<span class="char-tag">${n}</span>`).join('')}
          ${scene.shotType ? `<span class="duration-tag">${scene.shotType}</span>` : ''}
          ${scene.duration ? `<span class="duration-tag">${scene.duration}</span>` : ''}
        </div>
      </div>
    </div>
  </div>`
  }

  // ── 섹션별 HTML ────────────────────────────────────────────────────────────
  const scenesHtml = scenes.map((s, i) => sceneCardHtml(s, i)).join('')
  const shortsHtml = shortsClips.map((s, i) => sceneCardHtml(s, i, `SH${String(i + 1).padStart(2, '0')}`)).join('')
  const introHtml  = introClips.map((s, i) => sceneCardHtml(s, i, `IN${String(i + 1).padStart(2, '0')}`)).join('')

  // ── BGM ───────────────────────────────────────────────────────────────────
  const bgmHtml = bgmData ? `
<div class="bgm-card">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;">
    <div>
      <div class="bgm-title">${bgmData.titleKo || ''}</div>
      <div class="bgm-sub">${bgmData.titleEn || ''}</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      ${bgmData.genre ? `<span class="tag-pill tag-purple">${bgmData.genre}</span>` : ''}
      ${bgmData.tempo ? `<span class="tag-pill tag-gray">${bgmData.tempo}</span>` : ''}
    </div>
  </div>
  ${bgmData.mood ? `<div class="meta-value" style="font-size:12px;color:#9ca3af;">${bgmData.mood}</div>` : ''}
  ${bgmData.promptEn ? `<div class="meta-label" style="margin-top:12px;">Suno AI 프롬프트</div><div class="json-box">${bgmData.promptEn}</div>` : ''}
</div>
${(multiTrackBGM || []).map(t => `
<div class="bgm-card" style="opacity:0.8;">
  <div style="display:flex;align-items:center;gap:10px;">
    <span class="tag-pill tag-gray">${t.sceneRange || ''}</span>
    <div><div class="bgm-title" style="font-size:14px;">${t.titleKo || ''}</div><div class="bgm-sub">${t.mood || ''} · ${t.tempo || ''}</div></div>
  </div>
  ${t.promptEn ? `<div class="json-box" style="margin-top:10px;">${t.promptEn}</div>` : ''}
</div>`).join('')}
` : '<p style="color:#4b5563;">BGM이 생성되지 않았습니다.</p>'

  // ── SEO ───────────────────────────────────────────────────────────────────
  const seoHtml = youtubeMetadata ? `
<div class="seo-block">
  <div class="seo-block-title" style="color:#f87171;">YOUTUBE 제목 후보 3개</div>
  ${(youtubeMetadata.titles || []).map((t, i) => `
  <div class="seo-title-item">
    <span class="seo-rank">#${i + 1}</span>
    <span class="seo-title-text">${t}</span>
  </div>`).join('')}
</div>
<div class="seo-block">
  <div class="seo-block-title" style="color:#93c5fd;">설명란</div>
  <div class="seo-desc-box">${youtubeMetadata.description || ''}</div>
</div>
<div class="seo-block">
  <div class="seo-block-title" style="color:#6ee7b7;">해시태그</div>
  <div class="hashtag-wrap">${(youtubeMetadata.hashtags || []).map(h => `<span class="hashtag-chip">${h}</span>`).join('')}</div>
</div>
${thumbnails.length > 0 ? `
<div class="seo-block">
  <div class="seo-block-title" style="color:#fcd34d;">썸네일 이미지</div>
  <div class="thumb-grid">
    ${thumbnails.map(t => `
    <div class="thumb-card">
      <div class="thumb-img-wrap">
        ${t.imageUrl ? `<img src="${t.imageUrl}" alt="${t.label}">` : '<div class="placeholder">이미지 없음</div>'}
      </div>
      <div class="thumb-footer">${t.label || ''}</div>
    </div>`).join('')}
  </div>
</div>` : ''}
` : '<p style="color:#4b5563;">SEO 데이터가 생성되지 않았습니다.</p>'

  return `<!DOCTYPE html>
<html lang="ko" translate="no">
<head>
  <meta charset="UTF-8">
  <title>AI 씨네브루 제작 리포트 — 통합 작업지침서</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css">
  <style>
    body { font-family: 'Pretendard Variable', sans-serif; background: #1a1f2b; color: #fff; margin:0; padding:0; }
    .container { max-width: 1200px; margin: 0 auto; padding: 40px; }
    header { display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #30363d; padding-bottom: 20px; margin-bottom: 40px; }
    .report-title { font-size: 28px; font-weight: 900; color: #ff4d4d; margin: 0; }
    h2 { font-size: 20px; font-weight: 900; color: #d687ff; margin: 60px 0 25px; display:flex; align-items:center; gap:10px; }
    /* 캐릭터 카드 */
    .character-card { background: #262c38; border: 1px solid #3d4659; border-radius: 15px; overflow:hidden; display:flex; margin-bottom: 20px; }
    .card-left { flex: 0 0 200px; background: #000; display:flex; align-items:center; justify-content:center; overflow:hidden; }
    .card-left img { width:100%; height:100%; object-fit:cover; }
    .card-right { flex:1; padding: 24px; }
    .meta-label { font-size: 11px; font-weight: 900; color: #8b949e; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.05em; }
    .meta-value { font-size: 14px; color: #d1d5db; margin-bottom: 16px; }
    .actor-tag { display:inline-block; background: #1d2433; border: 1px solid #3d4659; color: #ff87d6; font-size: 11px; font-weight: 900; padding: 2px 8px; border-radius: 4px; margin-bottom: 8px; }
    /* 씬 카드 */
    .scene-item { background: #262c38; border: 1px solid #3d4659; border-radius: 15px; overflow:hidden; margin-bottom: 30px; }
    .scene-title { background: #2c3444; padding: 14px 24px; font-size: 16px; font-weight: 900; color: #ff87d6; display:flex; align-items:center; gap:12px; }
    .scene-id { background: #1d2433; color: #8b949e; font-size: 12px; font-weight: 900; padding: 2px 8px; border-radius: 4px; }
    .scene-content { display:flex; }
    .scene-left { flex: 0 0 320px; background:#000; min-height: 180px; display:flex; align-items:center; justify-content:center; overflow:hidden; }
    .scene-left img { width:100%; height:100%; object-fit:contain; }
    .scene-right { flex:1; padding: 20px 24px; }
    .prompt-box { background: #1a1f2b; border: 1px solid #3d4659; border-radius: 8px; padding: 12px 14px; margin-top: 8px; font-size: 12px; color: #9ca3af; font-family: monospace; white-space: pre-wrap; line-height: 1.5; }
    .dialogue-box { background: #1e1433; border-left: 3px solid #a855f7; padding: 10px 14px; border-radius: 0 8px 8px 0; margin-top: 8px; font-size: 14px; color: #e9d5ff; font-style: italic; }
    .json-box { background: #0a0f0a; border: 1px solid #3fb950; border-radius: 8px; padding: 12px 14px; margin-top: 8px; font-size: 11px; color: #7ee787; font-family: monospace; white-space: pre-wrap; overflow-x: auto; }
    .tag-row { display:flex; flex-wrap:wrap; gap:6px; margin-top: 8px; }
    .char-tag { background: #1d2433; border: 1px solid #3d4659; color: #93c5fd; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
    .duration-tag { background: #1d2433; border: 1px solid #3d4659; color: #fcd34d; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
    /* SEO */
    .seo-block { background: #161b22; border: 1px solid #30363d; border-radius: 15px; padding: 24px; margin-bottom: 16px; }
    .seo-block-title { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px; }
    .seo-title-item { display:flex; align-items:center; gap:12px; background:#0d1117; border:1px solid #21262d; border-radius:8px; padding:10px 14px; margin-bottom:8px; }
    .seo-rank { font-size:11px; font-weight:900; color:#ef4444; min-width:18px; }
    .seo-title-text { flex:1; font-size:14px; font-weight:700; color:#f3f4f6; }
    .seo-desc-box { background:#0d1117; border:1px solid #21262d; border-radius:8px; padding:14px; font-size:13px; color:#d1d5db; white-space:pre-wrap; line-height:1.7; }
    .hashtag-wrap { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
    .hashtag-chip { background:rgba(16,185,129,0.1); color:#6ee7b7; border:1px solid rgba(16,185,129,0.3); border-radius:6px; padding:4px 10px; font-size:11px; font-weight:700; }
    /* 썸네일 */
    .thumb-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:20px; margin-top:8px; }
    .thumb-card { background:#262c38; border:1px solid #3d4659; border-radius:12px; overflow:hidden; }
    .thumb-img-wrap { aspect-ratio:16/9; overflow:hidden; background:#0d1117; display:flex; align-items:center; justify-content:center; }
    .thumb-img-wrap img { width:100%; height:100%; object-fit:cover; }
    .thumb-footer { padding:10px 14px; font-size:11px; font-weight:900; color:#9ca3af; border-top:1px solid #3d4659; }
    /* BGM */
    .bgm-card { background:#262c38; border:1px solid #3d4659; border-radius:12px; padding:20px; margin-bottom:16px; }
    .bgm-title { font-size:16px; font-weight:900; color:#d1d5db; }
    .bgm-sub { font-size:12px; color:#6b7280; margin-top:4px; }
    .tag-pill { display:inline-block; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700; }
    .tag-purple { background:rgba(168,85,247,0.15); color:#d887ff; border:1px solid rgba(168,85,247,0.3); }
    .tag-gray { background:#374151; color:#9ca3af; }
    /* 빈 플레이스홀더 */
    .placeholder { background:#2c3444; color:#4b5563; display:flex; align-items:center; justify-content:center; height:100%; min-height:120px; font-size:12px; font-weight:700; }
    /* TOC */
    #toc-fab { position:fixed; right:24px; bottom:32px; z-index:200; }
    #toc-toggle { width:48px; height:48px; border-radius:50%; background:#ff4d4d; border:none; color:#fff; font-size:20px; cursor:pointer; box-shadow:0 4px 20px rgba(255,77,77,0.4); }
    #toc-menu { display:none; background:#1c2333; border:1px solid #30363d; border-radius:12px; padding:8px; box-shadow:0 8px 32px rgba(0,0,0,0.5); min-width:180px; position:absolute; bottom:56px; right:0; }
    #toc-menu.open { display:block; }
    .toc-item { display:block; padding:8px 14px; border-radius:8px; color:#9ca3af; font-size:12px; font-weight:700; text-decoration:none; }
    .toc-item:hover { background:#262c38; color:#fff; }
  </style>
</head>
<body>
<div class="container">
  <header>
    <h1 class="report-title">🎬 AI 씨네브루 제작 리포트</h1>
    <div style="color:#6b7280;font-size:13px;">${new Date().toLocaleString('ko-KR')}</div>
  </header>

  <div id="sec-chars"><h2>👤 등장인물 설정 (${(continuityBible.characters || []).length}명)</h2>${charsHtml || '<p style="color:#4b5563;">없음</p>'}</div>
  <div id="sec-scenes"><h2>🎬 씬 시퀀스 (${scenes.length}씬)</h2>${scenesHtml || '<p style="color:#4b5563;">씬 없음</p>'}</div>
  ${shortsClips.length > 0 ? `<div id="sec-shorts"><h2>📱 쇼츠 변환 시퀀스 (${shortsClips.length}클립)</h2>${shortsHtml}</div>` : ''}
  ${introClips.length > 0 ? `<div id="sec-intro"><h2>🎞️ 커스텀 인트로 시퀀스 (${introClips.length}클립)</h2>${introHtml}</div>` : ''}
  <div id="sec-bgm"><h2>🎵 배경음악 설정</h2>${bgmHtml}</div>
  <div id="sec-seo"><h2>📊 YouTube SEO &amp; 썸네일</h2>${seoHtml}</div>

  <div id="toc-fab">
    <div id="toc-menu">
      <a class="toc-item" href="#sec-chars">👤 등장인물</a>
      <a class="toc-item" href="#sec-scenes">🎬 씬 시퀀스</a>
      ${shortsClips.length > 0 ? '<a class="toc-item" href="#sec-shorts">📱 쇼츠</a>' : ''}
      ${introClips.length > 0 ? '<a class="toc-item" href="#sec-intro">🎞️ 인트로</a>' : ''}
      <a class="toc-item" href="#sec-bgm">🎵 BGM</a>
      <a class="toc-item" href="#sec-seo">📊 SEO</a>
    </div>
    <button id="toc-toggle" onclick="document.getElementById('toc-menu').classList.toggle('open')">☰</button>
  </div>
</div>
</body>
</html>`
}

export async function exportZip(state) {
  const zip = new JSZip()

  const {
    scenes = [],
    shortsClips = [],
    introClips = [],
    thumbnails = [],
    continuityBible = {},
    youtubeMetadata = null,
    bgmData = null,
    multiTrackBGM = null,
    scriptText = '',
    characterImages = {},
    selectedStyleId = 'cinematic',
  } = state

  // scenes/*.png
  const scenesFolder = zip.folder('scenes')
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]
    if (scene?.imageUrl) {
      try {
        const blob = base64ToBlob(scene.imageUrl)
        scenesFolder.file(`scene_${String(i + 1).padStart(3, '0')}.png`, blob)
      } catch (e) {
        console.warn(`씬 ${i + 1} 이미지 저장 실패:`, e)
      }
    }
  }

  // shorts/*.png
  if (shortsClips.length > 0) {
    const shortsFolder = zip.folder('shorts')
    for (let i = 0; i < shortsClips.length; i++) {
      const clip = shortsClips[i]
      if (clip?.imageUrl) {
        try {
          const blob = base64ToBlob(clip.imageUrl)
          shortsFolder.file(`shorts_${String(i + 1).padStart(3, '0')}.png`, blob)
        } catch (e) {
          console.warn(`쇼츠 ${i + 1} 이미지 저장 실패:`, e)
        }
      }
    }
  }

  // intro/*.png
  if (introClips.length > 0) {
    const introFolder = zip.folder('intro')
    for (let i = 0; i < introClips.length; i++) {
      const clip = introClips[i]
      if (clip?.imageUrl) {
        try {
          const blob = base64ToBlob(clip.imageUrl)
          introFolder.file(`intro_${String(i + 1).padStart(3, '0')}.png`, blob)
        } catch (e) {
          console.warn(`인트로 ${i + 1} 이미지 저장 실패:`, e)
        }
      }
    }
  }

  // thumbnails/*.png
  if (thumbnails.length > 0) {
    const thumbFolder = zip.folder('thumbnails')
    for (const thumb of thumbnails) {
      if (thumb?.imageUrl) {
        try {
          const blob = base64ToBlob(thumb.imageUrl)
          thumbFolder.file(`thumbnail_${thumb.type || 'unknown'}.png`, blob)
        } catch (e) {
          console.warn(`썸네일 저장 실패:`, e)
        }
      }
    }
  }

  // metadata/
  const metaFolder = zip.folder('metadata')

  // scenes.json (imageUrl 제외)
  const scenesData = scenes.map(s => {
    const { imageUrl, ...rest } = s
    return rest
  })
  metaFolder.file('scenes.json', JSON.stringify(scenesData, null, 2))

  // bible.json
  metaFolder.file('bible.json', JSON.stringify(continuityBible, null, 2))

  // youtube_seo.json
  if (youtubeMetadata) {
    metaFolder.file('youtube_seo.json', JSON.stringify(youtubeMetadata, null, 2))
  }

  // bgm.json
  const bgmExport = {
    global: bgmData,
    multiTrack: multiTrackBGM,
  }
  metaFolder.file('bgm.json', JSON.stringify(bgmExport, null, 2))

  // script.txt
  if (scriptText) {
    zip.file('script.txt', scriptText)
  }

  // report.html
  zip.file('report.html', generateReportHtml(state))

  // ZIP 생성 및 다운로드
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  saveAs(blob, `cineboard_${timestamp}.zip`)
}
