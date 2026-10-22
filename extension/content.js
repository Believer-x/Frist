(() => {
  let settings = {enabled: true, bilingual: true};
  let video = null;
  let current = '';
  let revision = 0;
  let debounce;
  let previousTranslation = '';
  let retryAfter = 0;
  let context;
  const ownedTracks = new Set();
  const host = document.createElement('div');
  host.setAttribute('data-subtitle-bridge', '');
  const shadow = host.attachShadow({mode: 'closed'});
  shadow.innerHTML = `<style>
    :host {all:initial;position:fixed;display:none;z-index:2147483647;pointer-events:none;box-sizing:border-box;text-align:center;}
    .box {display:inline-flex;flex-direction:column;gap:5px;max-width:94%;padding:10px 18px;border:1px solid #ffffff22;border-radius:12px;background:#101725e8;color:#fff;box-shadow:0 4px 24px #0005;font:600 clamp(15px,2.1vw,26px)/1.45 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;}
    .source {color:#c7d2e4;font-size:.7em;font-weight:400;} .status {font-size:.65em;color:#ffd99b;}
  </style><div class="box"><div class="source"></div><div class="translation"></div></div>`;
  const source = shadow.querySelector('.source');
  const translated = shadow.querySelector('.translation');
  function hide() {host.style.display = 'none';}
  function position() {
    if (!video || !host.isConnected) return;
    const r = video.getBoundingClientRect();
    if (r.width < 100 || r.height < 60 || r.bottom <= 0 || r.top >= innerHeight) return hide();
    Object.assign(host.style, {left: `${Math.max(0,r.left)}px`, top: `${Math.max(0,r.top + r.height * .72)}px`, width: `${Math.min(r.width, innerWidth - Math.max(0,r.left))}px`});
  }
  function paint(text, status = false) {
    if (!current || !settings.enabled) return hide();
    const parent = document.fullscreenElement || document.body;
    if (!parent) return;
    if (host.parentNode !== parent) parent.append(host);
    source.textContent = settings.bilingual ? current : '';
    source.style.display = settings.bilingual ? '' : 'none';
    translated.textContent = text;
    translated.className = status ? 'translation status' : 'translation';
    host.style.display = 'block';
    position();
  }
  function restoreTracks() {
    for (const track of ownedTracks) if (track.mode === 'hidden') track.mode = 'disabled';
    ownedTracks.clear();
  }
  function findVideo() {
    return [...document.querySelectorAll('video')].filter(v => {
      const r = v.getBoundingClientRect();
      return r.width > 100 && r.height > 60 && r.bottom > 0 && r.top < innerHeight;
    }).sort((a,b) => Number(a.paused) - Number(b.paused) || b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
  }
  function caption() {
    if (!video || video.ended) return '';
    const root = video.closest('.html5-video-player, .bpx-player-container, .bilibili-player, .watch-video, #dv-web-player, .shaka-video-container, .video-js, .dplayer') || (document.querySelectorAll('video').length === 1 ? document : video.parentElement);
    const selectors = ['.ytp-caption-segment', '.bpx-player-subtitle-panel-text', '.bilibili-player-video-subtitle .subtitle-item-text', '.player-timedtext-text-container', '.atvwebplayersdk-captions-text', '.shaka-text-container', '.vjs-text-track-display', '.dplayer-subtitle'];
    for (const selector of selectors) {
      const parts = [...root.querySelectorAll(selector)].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').map(el => el.textContent.trim()).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    const tracks = [...video.textTracks].filter(t => ['subtitles','captions'].includes(t.kind));
    let track = tracks.find(t => t.mode === 'showing') || tracks.find(t => t.mode === 'hidden');
    if (!track && tracks.length) {track = tracks[0]; track.mode = 'hidden'; ownedTracks.add(track);}
    return track ? [...(track.activeCues || [])].map(cue => cue.getCueAsHTML ? cue.getCueAsHTML().textContent : cue.text).join(' ') : '';
  }
  async function request(text, token) {
    try {
      const result = await chrome.runtime.sendMessage({type: 'translate', text});
      if (token !== revision || text !== current || !settings.enabled) return;
      if (!result?.ok) {retryAfter = Date.now() + 15000; paint(result?.error || '翻译不可用', true); return;}
      previousTranslation = result.text;
      retryAfter = 0;
      paint(result.text);
    } catch {if (token === revision) {retryAfter = Date.now() + 30000; paint('插件已更新，请刷新页面', true);}}
  }
  function tick() {
    if (!settings.enabled) return;
    const next = findVideo();
    const nextContext = `${location.href}|${next?.currentSrc || ''}`;
    if (next !== video || context !== nextContext) {restoreTracks(); video = next; context = nextContext; current = ''; revision++; hide();}
    const text = caption().replace(/\s+/g,' ').trim().slice(0,1200);
    if (text === current) {
      if (current && retryAfter && Date.now() > retryAfter) {retryAfter = 0; request(current, ++revision);}
      position(); return;
    }
    current = text;
    revision++;
    clearTimeout(debounce);
    hide();
    if (!text) return;
    previousTranslation = '';
    paint('正在翻译…', true);
    const token = revision;
    debounce = setTimeout(() => request(text, token), 180);
  }
  async function reload() {
    try {
      const result = await chrome.runtime.sendMessage({type: 'public-settings'});
      if (!result?.ok) return;
      settings = result.settings;
      revision++; current = ''; retryAfter = 0; previousTranslation = '';
      clearTimeout(debounce); hide();
      if (!settings.enabled) restoreTracks(); else tick();
    } catch {hide();}
  }
  chrome.storage.onChanged.addListener(reload);
  document.addEventListener('fullscreenchange', () => {if (current) paint(previousTranslation || '正在翻译…', !previousTranslation);});
  window.addEventListener('resize', position);
  document.addEventListener('scroll', position, true);
  setInterval(tick, 300);
  reload();
})();
