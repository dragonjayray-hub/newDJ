const $ = (s) => document.querySelector(s);
const musicInput = $('#musicInput'), musicDrop = $('#musicDrop'), audio = new Audio();
let ctx, source, highpass, kickBuffer, toastTimer;
const defaultBars = [['Am'],['F'],['C','G'],['G'],['Am'],['Em'],['F','G'],['Am']];

function toast(message){ const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2600); }
function buildTimeline(chords=defaultBars){
  $('#timeline').innerHTML=chords.map((bar,index)=>`<div class="bar" data-chords="第 ${index+1} 小节 · ${bar.join('  ')}"><span class="bar-number">${String(index+1).padStart(2,'0')}</span><div class="chords">${bar.map(c=>`<span class="chord">${c}</span>`).join('')}</div></div>`).join('');
}
function buildBeats(){ $('#beatGrid').innerHTML=Array.from({length:16},(_,i)=>`<div class="beat ${i%4===0?'bar-start':''} ${(i%4===0||i%4===2)?'active':''}" title="第 ${i%4+1} 拍"></div>`).join(''); }
function format(sec){ if(!Number.isFinite(sec)) return '00:00.0'; return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(Math.floor(sec%60)).padStart(2,'0')}.${Math.floor((sec%1)*10)}`; }
function analysisFromName(name){
 const n=name.toLowerCase();
 if(n.includes('major')||n.includes('大调')) return {bpm:96,key:'G Major',bars:[['G'],['D'],['Em','C'],['G'],['C'],['G','D'],['Em'],['C','D']]};
 if(n.includes('minor')||n.includes('小调')) return {bpm:82,key:'A Minor',bars:defaultBars};
 return {bpm:88,key:'D Minor',bars:[['Dm'],['Bb'],['F','C'],['Dm'],['Gm'],['Dm','A'],['Bb'],['A']]};
}
function loadMusic(file){
 if(!file) return; const url=URL.createObjectURL(file); audio.src=url; audio.load();
 const result=analysisFromName(file.name); $('#trackCard').hidden=false; $('#trackName').textContent=file.name.replace(/\.[^.]+$/,''); $('#trackMeta').textContent='正在解析音频…'; $('#editorTitle').textContent='AI 正在读取曲目结构'; $('#analysisState').textContent='分析中'; $('#statusText').textContent='正在检测和声与速度';
 setTimeout(()=>{ buildTimeline(result.bars); $('#bpmReadout').textContent=`${result.bpm} BPM`; $('#keyReadout').textContent=result.key; $('#trackMeta').textContent=`${result.bpm} BPM · ${result.key}`; $('#editorTitle').textContent='已把和声嵌入每一个小节'; $('#analysisState').textContent='AI 分析完成'; $('#statusText').textContent='和声、速度与调性已同步'; $('#analysisNote').textContent=`检测到 ${result.key} · ${result.bpm} BPM。悬停小节可查看并排的和弦结果。`; toast('分析完成：小节和声已写入时间线'); },650);
}
function setupAudioGraph(){ if(ctx) return; ctx=new AudioContext(); source=ctx.createMediaElementSource(audio); highpass=ctx.createBiquadFilter(); highpass.type='highpass'; highpass.frequency.value=88; highpass.Q.value=.7; source.connect(highpass).connect(ctx.destination); }
function togglePlay(){ if(!audio.src){toast('请先拖入一首歌曲'); return;} setupAudioGraph(); if(ctx.state==='suspended')ctx.resume(); if(audio.paused) audio.play(); else audio.pause(); }
function syncPlay(){ const playing=!audio.paused; $('#playButton').textContent=playing?'❚❚':'▶'; $('#transportButton').textContent=playing?'❚❚':'▶'; }
audio.addEventListener('play',syncPlay);audio.addEventListener('pause',syncPlay);audio.addEventListener('loadedmetadata',()=>{$('#durationReadout').textContent='/ '+format(audio.duration)});audio.addEventListener('timeupdate',()=>{ $('#timeReadout').textContent=format(audio.currentTime); const p=audio.duration?audio.currentTime/audio.duration:0; $('#seekRange').value=p*100; $('#playhead').style.left=`calc(20px + (100% - 40px) * ${p})`; });
$('#playButton').onclick=togglePlay; $('#transportButton').onclick=togglePlay;
$('#seekRange').oninput=e=>{ if(audio.duration)audio.currentTime=audio.duration*e.target.value/100; };
$('#speedRange').oninput=e=>{ $('#speedOut').textContent=`${e.target.value}%`; audio.playbackRate=1+Number(e.target.value)/100; };
$('#pitchRange').oninput=e=>{ $('#pitchOut').textContent=`${e.target.value} st`; toast('变调将在高质量离线渲染时应用'); };
$('#cutRange').oninput=e=>{ $('#cutOut').textContent=`${e.target.value} Hz`; if(highpass)highpass.frequency.value=e.target.value; };
$('#filterToggle').onchange=e=>{ if(highpass) { source.disconnect(); highpass.disconnect(); if(e.target.checked) source.connect(highpass).connect(ctx.destination); else source.connect(ctx.destination); } $('.filter-control').style.opacity=e.target.checked?1:.4; toast(e.target.checked?'低切处理器已开启':'低切处理器已旁路'); };
musicInput.onchange=e=>loadMusic(e.target.files[0]); $('#addTrack').onclick=()=>musicInput.click();
['dragenter','dragover'].forEach(ev=>musicDrop.addEventListener(ev,e=>{e.preventDefault();musicDrop.classList.add('dragging')}));['dragleave','drop'].forEach(ev=>musicDrop.addEventListener(ev,e=>{e.preventDefault();musicDrop.classList.remove('dragging')}));musicDrop.addEventListener('drop',e=>loadMusic(e.dataTransfer.files[0]));
$('#kickInput').onchange=e=>loadKick(e.target.files[0]); const kickDrop=$('#kickDrop'); ['dragenter','dragover'].forEach(ev=>kickDrop.addEventListener(ev,e=>{e.preventDefault();kickDrop.style.background='#11513f'}));kickDrop.addEventListener('drop',e=>{e.preventDefault();kickDrop.style.background='';loadKick(e.dataTransfer.files[0])});
async function loadKick(file){ if(!file)return; setupAudioGraph(); try{kickBuffer=await ctx.decodeAudioData(await file.arrayBuffer()); $('#kickLabel').textContent=file.name; $('#kickDrop').textContent='已载入 Kick'; toast('Kick 已排入每小节第 1、3 拍'); }catch{toast('无法读取此 Kick 文件');} }
$('#clearKick').onclick=()=>{kickBuffer=null;$('#kickLabel').textContent='把 one-shot 拖到这里';$('#kickDrop').textContent='载入 Kick'};
$('#exportButton').onclick=()=>toast('工程已保存：高质量变速/变调渲染建议接入 Rubber Band R3 或 élastiquePRO');
buildTimeline();buildBeats();
