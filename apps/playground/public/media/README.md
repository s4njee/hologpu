# Original local media fixtures

The `products/` fixtures are original vector illustrations, aligned grayscale depth maps and a fictional Signal workspace screenshot. `node scripts/product-assets.mjs` regenerates their SVG/PNG pairs. `node scripts/product-glow-poster.mjs` (with `pnpm dev` running) regenerates the baked glow overlay from the actual screenshot and author mask. The six-second muted H.264 `hero-720p.mp4` is generated from that screenshot at 1280×720 / 30 fps:

```sh
ffmpeg -y -loop 1 -i apps/playground/public/media/products/screenshot.png -vf 'scale=1320:825,zoompan=z=1.02+0.015*sin(on/120):x=iw/2-iw/zoom/2:y=ih/2-ih/zoom/2:d=180:s=1280x720:fps=30' -t 6 -c:v libx264 -pix_fmt yuv420p -movflags +faststart apps/playground/public/media/products/hero-720p.mp4
```

- `sample.svg`: original 960×640 mountain illustration, authored for this repository.
- `sample-1080p60.webm`: three seconds of FFmpeg's generated `testsrc2`, 1920×1080, 60fps, VP8, explicit limited-range BT.709 metadata, no audio.
- `sample-1080p60.mp4`: equivalent H.264 alternative for browser codec compatibility.
- `sample.wav`: one second of generated 440Hz sine, mono 16kHz PCM16.
- `dive-connect.jpg`: an AI-generated image used by `lcd.html`; provenance is not fully recorded. Replace with an authored or CC0 image when a suitable one is available.

No remote media or device capture is required. The playground requests real webcam/microphone permission only when their explicit start buttons are clicked; tests use generated fixtures or local canvas capture.

Generation commands (FFmpeg 8):

```sh
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=60 -vf colorspace=all=bt709:iall=bt601-6-625:fast=1 -t 3 -color_range tv -colorspace bt709 -color_trc bt709 -color_primaries bt709 -c:v libvpx -b:v 1800k -an sample-1080p60.webm
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=60 -vf colorspace=all=bt709:iall=bt601-6-625:fast=1 -t 3 -color_range tv -colorspace bt709 -color_trc bt709 -color_primaries bt709 -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -movflags +faststart -an sample-1080p60.mp4
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000 -t 1 -c:a pcm_s16le sample.wav
```
