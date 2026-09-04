# 古风 DJ 自动土化器

本项目是一个 **Python 驱动的本地网页工具**：把一首常规歌曲拖入网页，后端会用 `librosa` 分析 BPM、节拍、调性和和声；前端把结果按 4/4 小节嵌入时间线。每个小节显示一个或两个和弦，悬停可查看完整内容。Kick one-shot 可拖入，并根据分析到的 BPM 在每小节的第 1、3 拍自动触发。

## 安装并运行

建议 Python 3.10+：

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python app.py
```

访问 [http://127.0.0.1:8000](http://127.0.0.1:8000)。请通过这个 Python 服务打开网页，不要直接双击 `index.html`，否则浏览器无法调用分析 API。

## 已实现功能

- **真实 Python 分析**：`/api/analyze` 使用 `librosa.beat.beat_track` 取得节拍和 BPM，使用 HPSS + CQT chroma 以及 major/minor triad templates 估算每半小节和弦，再合成 4/4 小节网格。分析结果不会只靠文件名伪造。
- **小节可视化**：每格对应一个检测到的小节；单和弦和双和弦均内嵌显示，双和弦之间由弹性间距隔开；鼠标悬停显示“第 N 小节 · 和弦”。点击小节可跳转播放位置。
- **实时试听**：浏览器的 Web Audio 高通滤波器可切掉低频，频率范围为 25–300 Hz；降速会实时影响试听速度。
- **古风 Kick 轨**：载入 one-shot 后，播放时会按识别到的 BPM 触发每小节的第 1、3 拍；下方网格按小节和 1–4 拍呈现落点。

## 变速与降调算法选择

没有一个算法能在所有人声、复杂混音、实时延迟和授权要求下都绝对最好。这里采用如下生产建议：

1. **成品离线渲染：Rubber Band R3**（本地开源优先）。R3 是 Rubber Band 的高质量离线细节引擎，适合复杂混音、低频和较大的古风降速/降调幅度；代价是 CPU 与延迟更高。
2. **商业授权：zplane élastiquePRO**。若可购买 SDK，它通常是专业 DAW 级独立 tempo/pitch 处理的可靠选择。
3. **实时预览**：浏览器使用 `playbackRate` 做速度预听；不要用它生成最终音频。最终导出必须调用 Rubber Band/élastique，使速度和音高相互独立。

安装 Rubber Band 后，服务会在分析响应中汇报是否检测到 `rubberband-r3` 或 `rubberband`。生产导出示例：

```bash
rubberband-r3 --tempo 0.72 --pitch -3 input.wav output.wav
```

> 点击“导出工程”会将原始歌曲、降速和降调参数提交到 `/api/render`，并用 `subprocess.run()` 调用 Rubber Band R3 后下载 WAV。未安装 Rubber Band 时会返回明确错误；不会把浏览器预览的 `playbackRate` 伪装成专业导出。

## 局限与扩展

和弦分类器当前识别 major/minor 三和弦，4/4 网格由 beat tracker 分组。复杂和弦、转位、拍号变化和伴奏非常稀疏的歌曲需要更专业模型或人工校正。后续可添加 Snare/Clap/Hat 轨、可编辑的 downbeat、节拍置信度和一个基于 Essentia/Madmom 的专业分析模式。
