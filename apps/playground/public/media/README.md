# Original local media fixtures

- `sample.svg`: original 960×640 mountain illustration, authored for this repository.
- `sample-1080p60.webm`: three seconds of FFmpeg's generated `testsrc2`, 1920×1080, 60fps, VP8, explicit limited-range BT.709 metadata, no audio.
- `sample-1080p60.mp4`: equivalent H.264 alternative for browser codec compatibility.
- `sample.wav`: one second of generated 440Hz sine, mono 16kHz PCM16.

No remote media or device capture is required. The playground requests real webcam/microphone permission only when their explicit start buttons are clicked; tests use generated fixtures or local canvas capture.

Generation commands (FFmpeg 8):

```sh
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=60 -vf colorspace=all=bt709:iall=bt601-6-625:fast=1 -t 3 -color_range tv -colorspace bt709 -color_trc bt709 -color_primaries bt709 -c:v libvpx -b:v 1800k -an sample-1080p60.webm
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=60 -vf colorspace=all=bt709:iall=bt601-6-625:fast=1 -t 3 -color_range tv -colorspace bt709 -color_trc bt709 -color_primaries bt709 -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -movflags +faststart -an sample-1080p60.mp4
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000 -t 1 -c:a pcm_s16le sample.wav
```
