#!/usr/bin/env bash
# Builds the Poki animated thumbnail from the gameplay recording (tools/covers/record.mjs → publish/out/raw/port.webm)
# and the static thumbnail (tools/covers/render.mjs). Requires ffmpeg. Output: publish/out/poki-animated-thumbnail-1080x1080.mp4
set -euo pipefail
cd "$(dirname "$0")/../../publish/out"
ENC=(-c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart -an)
# Action start in the recording (seconds) and the arena square in the 1080×1920 portrait frame (centred on the core).
S=$(python3 -c "import json;print(json.load(open('raw/port.json'))['startS'])")
ARENA="crop=1000:1000:40:230,scale=1080:1080:flags=lanczos"

# Poki animated thumbnail: square 1080x1080, 5 s, 50 fps, muted. Static artwork → 2 gameplay scenes.
ffmpeg -v error -y -loop 1 -t 1.3 -framerate 50 -i poki-thumbnail-1080x1080.png \
  -ss "$(python3 -c "print($S+0.3)")" -t 2.2 -i raw/port.webm -ss "$(python3 -c "print($S+5)")" -t 2.2 -i raw/port.webm \
  -filter_complex "[0]fps=50,format=yuv420p,setsar=1[a];\
[1]$ARENA,minterpolate=fps=50:mi_mode=blend,format=yuv420p,setsar=1[b];\
[2]$ARENA,minterpolate=fps=50:mi_mode=blend,format=yuv420p,setsar=1[c];\
[a][b]xfade=transition=fade:duration=0.3:offset=1.0[ab];[ab][c]xfade=transition=slideleft:duration=0.3:offset=2.9[v]" \
  -map "[v]" -t 5 -r 50 "${ENC[@]}" poki-animated-thumbnail-1080x1080.mp4

f=poki-animated-thumbnail-1080x1080.mp4
printf '%-42s ' "$f"; ffprobe -v error -select_streams v -show_entries stream=width,height,r_frame_rate -show_entries format=duration,size -of csv=p=0 "$f" | tr '\n' ' '; echo
