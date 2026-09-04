const $ = (selector) => document.querySelector(selector);
const audio = new Audio();
let context, source, highpass, kickBuffer, analysis;
let kickTimer, audioUrl, kickUrl, selectedSong;

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '00:00.0';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}.${Math.floor((seconds % 1) * 10)}`;
}

function renderTimeline(bars) {
  const timeline = $('#timeline');
  timeline.innerHTML = bars.map((bar) => `<button class="bar" data-chords="第 ${bar.number} 小节 · ${bar.chords.join('  ')}" aria-label="第 ${bar.number} 小节，${bar.chords.join('，')}">
    <span class="bar-number">${String(bar.number).padStart(2, '0')}</span>
    <span class="chords">${bar.chords.map((chord) => `<span class="chord">${chord}</span>`).join('')}</span>
  </button>`).join('');
  timeline.querySelectorAll('.bar').forEach((bar, index) => bar.addEventListener('click', () => {
    if (audio.duration && analysis?.bars[index]) audio.currentTime = analysis.bars[index].start;
  }));
}

function renderKickGrid(bars) {
  $('#beatGrid').innerHTML = bars.map((bar) => `<div class="measure"><span class="measure-label">${bar.number}</span>${[1, 2, 3, 4].map((beat) => `<span class="beat ${beat === 1 || beat === 3 ? 'active' : ''}"><small>${beat}</small></span>`).join('')}</div>`).join('');
}

async function loadSong(file) {
  if (!file) return;
  selectedSong = file;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(file);
  audio.src = audioUrl;
  audio.load();
  $('#trackCard').hidden = false;
  $('#trackName').textContent = file.name.replace(/\.[^.]+$/, '');
  $('#trackMeta').textContent = '上传到 Python 分析器…';
  $('#analysisState').textContent = '分析中';
  $('#statusText').textContent = '正在检测 BPM、调性与和弦';
  try {
    const form = new FormData();
    form.append('audio', file);
    const response = await fetch('/api/analyze', { method: 'POST', body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '分析失败');
    analysis = result;
    renderTimeline(result.bars);
    renderKickGrid(result.bars);
    $('#bpmReadout').textContent = `${result.bpm} BPM`;
    $('#keyReadout').textContent = result.key;
    $('#trackMeta').textContent = `${result.bpm} BPM · ${result.key} · ${result.bars.length} 小节`;
    $('#analysisState').textContent = 'Python 分析完成';
    $('#statusText').textContent = `已识别 ${result.bars.length} 小节 · ${result.engine}`;
    $('#analysisNote').textContent = `检测到 ${result.key}、${result.bpm} BPM。每格是一小节；悬停即可查看该小节的和弦。`;
    $('#engineNote').textContent = result.rubberband_available ? 'Rubber Band 已就绪，可进行高质量离线导出' : '预览使用 Web Audio；导出请安装 Rubber Band R3';
    showToast('分析完成：和弦已按小节写入工程');
  } catch (error) {
    $('#analysisState').textContent = '分析失败';
    $('#statusText').textContent = '等待重新导入';
    $('#analysisNote').textContent = error.message;
    showToast(error.message);
  }
}

function setupAudio() {
  if (context) return;
  context = new AudioContext();
  source = context.createMediaElementSource(audio);
  highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.Q.value = 0.707;
  highpass.frequency.value = Number($('#cutRange').value);
  source.connect(highpass).connect(context.destination);
}

function setFilter(enabled) {
  if (!context) return;
  source.disconnect();
  highpass.disconnect();
  if (enabled) source.connect(highpass).connect(context.destination);
  else source.connect(context.destination);
}

function playKick() {
  if (!kickBuffer || !context) return;
  const node = context.createBufferSource();
  node.buffer = kickBuffer;
  node.connect(context.destination);
  node.start();
}

function startKickClock() {
  window.clearInterval(kickTimer);
  if (!analysis || !kickBuffer) return;
  const pulse = () => {
    const beat = (audio.currentTime * analysis.bpm / 60) % 4;
    if ((beat < 0.08 || (beat > 1.95 && beat < 2.05)) && !pulse.fired) {
      playKick(); pulse.fired = true;
    }
    if (beat > 0.15 && beat < 1.85) pulse.fired = false;
  };
  kickTimer = window.setInterval(pulse, 20);
}

async function loadKick(file) {
  if (!file) return;
  setupAudio();
  if (kickUrl) URL.revokeObjectURL(kickUrl);
  kickUrl = URL.createObjectURL(file);
  try {
    kickBuffer = await context.decodeAudioData(await file.arrayBuffer());
    $('#kickLabel').textContent = file.name;
    $('#kickDrop').lastChild.textContent = '已载入 Kick';
    startKickClock();
    showToast('Kick 已量化到每小节第 1、3 拍');
  } catch { showToast('无法读取这个 one-shot 文件'); }
}

function togglePlay() {
  if (!audio.src) return showToast('请先拖入歌曲');
  setupAudio();
  if (context.state === 'suspended') context.resume();
  if (audio.paused) audio.play(); else audio.pause();
}

$('#exportButton').addEventListener('click', async () => {
  if (!selectedSong) return showToast('请先导入歌曲');
  const form = new FormData();
  form.append('audio', selectedSong);
  form.append('tempo', String(1 + Number($('#speedRange').value) / 100));
  form.append('pitch', $('#pitchRange').value);
  $('#exportButton').textContent = '离线渲染中…';
  try {
    const response = await fetch('/api/render', { method: 'POST', body: form });
    if (!response.ok) throw new Error((await response.json()).error || '导出失败');
    const blob = await response.blob(); const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'ancient-dj-render.wav'; link.click(); URL.revokeObjectURL(link.href);
    showToast('Rubber Band R3 渲染完成');
  } catch (error) { showToast(error.message); } finally { $('#exportButton').textContent = '导出工程'; }
});

$('#musicInput').addEventListener('change', (event) => loadSong(event.target.files[0]));
$('#kickInput').addEventListener('change', (event) => loadKick(event.target.files[0]));
$('#addTrack').addEventListener('click', () => $('#musicInput').click());
$('#playButton').addEventListener('click', togglePlay);
$('#transportButton').addEventListener('click', togglePlay);
$('#speedRange').addEventListener('input', (event) => { $('#speedOut').textContent = `${event.target.value}%`; audio.playbackRate = 1 + Number(event.target.value) / 100; });
$('#pitchRange').addEventListener('input', (event) => { $('#pitchOut').textContent = `${event.target.value} st`; });
$('#cutRange').addEventListener('input', (event) => { $('#cutOut').textContent = `${event.target.value} Hz`; if (highpass) highpass.frequency.value = Number(event.target.value); });
$('#filterToggle').addEventListener('change', (event) => { setFilter(event.target.checked); $('#filterControl').classList.toggle('disabled', !event.target.checked); });
$('#clearKick').addEventListener('click', () => { kickBuffer = null; window.clearInterval(kickTimer); $('#kickLabel').textContent = '把 one-shot 拖到这里'; $('#kickDrop').lastChild.textContent = '载入 Kick'; });
$('#seekRange').addEventListener('input', (event) => { if (audio.duration) audio.currentTime = audio.duration * Number(event.target.value) / 100; });
audio.addEventListener('play', () => { $('#playButton').textContent = '❚❚'; $('#transportButton').textContent = '❚❚'; startKickClock(); });
audio.addEventListener('pause', () => { $('#playButton').textContent = '▶'; $('#transportButton').textContent = '▶'; });
audio.addEventListener('loadedmetadata', () => { $('#durationReadout').textContent = `/ ${formatTime(audio.duration)}`; });
audio.addEventListener('timeupdate', () => { const ratio = audio.duration ? audio.currentTime / audio.duration : 0; $('#timeReadout').textContent = formatTime(audio.currentTime); $('#seekRange').value = ratio * 100; $('#playhead').style.left = `${ratio * 100}%`; });

[['musicDrop', loadSong], ['kickDrop', loadKick]].forEach(([id, handler]) => {
  const target = $(`#${id}`);
  ['dragenter', 'dragover'].forEach((event) => target.addEventListener(event, (e) => { e.preventDefault(); target.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((event) => target.addEventListener(event, (e) => { e.preventDefault(); target.classList.remove('dragging'); }));
  target.addEventListener('drop', (event) => handler(event.dataTransfer.files[0]));
});
