"""古风 DJ 自动土化器的本地 Web 服务。"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory

app = Flask(__name__, static_folder=".", static_url_path="")
MAX_BARS = 96
PITCH_CLASSES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
MAJOR_PROFILE = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
MINOR_PROFILE = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)


def best_key(chroma, np):
    """Return the best Krumhansl-style major/minor key for a chroma vector."""
    energy = chroma.mean(axis=1)
    candidates = []
    for tonic in range(12):
        for mode, profile in (("Major", MAJOR_PROFILE), ("Minor", MINOR_PROFILE)):
            score = float(np.corrcoef(energy, np.roll(np.array(profile), tonic))[0, 1])
            candidates.append((score, tonic, mode))
    _, tonic, mode = max(candidates, key=lambda row: row[0])
    return f"{PITCH_CLASSES[tonic]} {mode}"


def chord_for(chroma, np):
    """Lightweight major/minor template classifier for one musical segment."""
    vector = chroma.mean(axis=1)
    templates = []
    for root in range(12):
        for suffix, intervals in (("", (0, 4, 7)), ("m", (0, 3, 7))):
            template = np.zeros(12)
            template[(root + np.array(intervals)) % 12] = 1
            score = float(np.dot(vector, template) / (np.linalg.norm(vector) * np.linalg.norm(template) + 1e-9))
            templates.append((score, f"{PITCH_CLASSES[root]}{suffix}"))
    return max(templates, key=lambda item: item[0])[1]


def analyse_audio(path: str):
    """Detect tempo, 4/4 bar boundaries, tonic and one/two chords per bar."""
    try:
        import librosa
        import numpy as np

        audio, sr = librosa.load(path, sr=22050, mono=True, duration=900)
        if audio.size < sr:
            raise ValueError("音频太短，至少需要一秒")
        tempo, beat_frames = librosa.beat.beat_track(y=audio, sr=sr, trim=False)
        tempo = float(np.asarray(tempo).reshape(-1)[0])
        if len(beat_frames) < 4:
            raise ValueError("未能识别足够的节拍")
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        harmonic, _ = librosa.effects.hpss(audio)
        chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sr)
        chroma_times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=512)
        bars = []
        for bar_number, start in enumerate(range(0, len(beat_times) - 3, 4), 1):
            if bar_number > MAX_BARS:
                break
            end = beat_times[min(start + 4, len(beat_times) - 1)]
            mid = beat_times[min(start + 2, len(beat_times) - 1)]
            first = chroma[:, (chroma_times >= beat_times[start]) & (chroma_times < mid)]
            second = chroma[:, (chroma_times >= mid) & (chroma_times < end)]
            first_chord = chord_for(first if first.shape[1] else chroma, np)
            second_chord = chord_for(second if second.shape[1] else chroma, np)
            chords = [first_chord] if first_chord == second_chord else [first_chord, second_chord]
            bars.append({"number": bar_number, "start": round(float(beat_times[start]), 3), "chords": chords})
        if not bars:
            raise ValueError("未能建立小节网格")
        return {"bpm": round(tempo, 1), "key": best_key(chroma, np), "bars": bars, "engine": "librosa"}
    except ImportError as error:
        raise RuntimeError("服务器缺少分析依赖，请运行 pip install -r requirements.txt") from error


@app.post("/api/render")
def render():
    """Render independently slowed and pitched audio with Rubber Band R3."""
    upload = request.files.get("audio")
    binary = shutil.which("rubberband-r3") or shutil.which("rubberband")
    if not upload or not upload.filename:
        return jsonify(error="请上传要渲染的音频。"), 400
    if not binary:
        return jsonify(error="未检测到 Rubber Band R3。请安装 rubberband-r3 后重试。"), 422
    try:
        tempo = float(request.form.get("tempo", "0.88"))
        pitch = float(request.form.get("pitch", "-3"))
        if not 0.5 <= tempo <= 1.0 or not -12 <= pitch <= 0:
            raise ValueError
    except ValueError:
        return jsonify(error="降速范围应为 0.50–1.00，降调范围应为 -12–0 半音。"), 400
    suffix = Path(upload.filename).suffix or ".wav"
    with tempfile.TemporaryDirectory() as directory:
        source_path = Path(directory, f"source{suffix}")
        output_path = Path(directory, "ancient-dj-render.wav")
        upload.save(source_path)
        command = [binary, "-3", "--tempo", str(tempo), "--pitch", str(pitch), str(source_path), str(output_path)]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=180, check=False)
        if completed.returncode != 0 or not output_path.exists():
            return jsonify(error=f"Rubber Band 渲染失败：{completed.stderr.strip() or '未知错误'}"), 422
        return send_file(output_path, as_attachment=True, download_name="ancient-dj-render.wav", mimetype="audio/wav")


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/api/analyze")
def analyze():
    upload = request.files.get("audio")
    if not upload or not upload.filename:
        return jsonify(error="请上传音频文件。"), 400
    suffix = Path(upload.filename).suffix or ".audio"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
        upload.save(temporary.name)
        temporary_path = temporary.name
    try:
        result = analyse_audio(temporary_path)
        result["rubberband_available"] = bool(shutil.which("rubberband-r3") or shutil.which("rubberband"))
        return jsonify(result)
    except (RuntimeError, ValueError) as error:
        return jsonify(error=str(error)), 422
    finally:
        os.unlink(temporary_path)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True)
