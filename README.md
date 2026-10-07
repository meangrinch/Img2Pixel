<h1 align="center">
  <img src="assets/logo.png" width="128" alt="Img2Pixel Logo" /><br/>
  Img2Pixel
</h1>

<p align="center">
  <img src="https://img.shields.io/github/v/release/meangrinch/Img2Pixel?label=Release&labelColor=181717&color=0877d2" />
  <img src="https://img.shields.io/github/downloads/meangrinch/Img2Pixel/total?label=Downloads&labelColor=181717&color=0877d2" />
  <img src="https://img.shields.io/github/license/meangrinch/Img2Pixel?labelColor=181717&color=2ea44f" />
  <img src="https://img.shields.io/badge/JavaScript-181717?logo=javascript&logoColor=F7DF1E" />
</p>

<div align="center">
A browser-based tool for converting images into pixel art. Runs client-side with no external dependencies, supporting custom palettes, dithering, edge smoothing, and outline generation.
</div>

<br/>

<p align="center">
  <img src="docs/images/example_original.jpg" width="400" alt="Original" />
  <img src="docs/images/example_pixelated.png" width="400" alt="Pixelated" />
  <br/>
  <sub>Original → Pixelated</sub>
</p>

---

## Quick Start

### 1. GitHub Pages (Online)

Use the hosted version directly in your browser [here](https://meangrinch.github.io/Img2Pixel/).

### 2. Standalone (Offline)

Download `Img2Pixel.html` from [Releases](https://github.com/meangrinch/Img2Pixel/releases) or the repository root and open it in any browser.

### 3. From Source

```bash
git clone https://github.com/meangrinch/Img2Pixel.git
cd Img2Pixel
python scripts/build.py
```

---

## Features

- **Pixelation**: Downsample images to custom pixel-grid sizes
- **Palettes**: Generate adaptive palettes, pick from 61 built-in palettes (Game Boy, NES, PICO-8...), or sample one from an image
- **Presets**: Emulate classic consoles and computers (Game Boy, SNES, Master System, Apple II...) down to screen size, pixel shape, palette, and per-tile color limits, or apply a Greyscale or Sticker look
- **Hardware Limits**: Cap color depth and colors per tile or scanline, with shared palettes like real consoles
- **Dithering**: Apply error diffusion (Floyd-Steinberg, Atkinson, Burkes, Sierra) or Bayer ordered dithering (2x2, 4x4, 8x8)
- **Smoothing**: Remove isolated stray pixels and clean up cluster edges
- **Outlines**: Add outer borders, edge strokes, or internal color-boundary outlines
- **Preview**: Compare edits with a split slider, side-by-side view, hold-to-peek, pixel grid overlay, and up to 3200% zoom, with touch panning and pinch-zoom on phones and tablets
- **Export**: Save as PNG, JPEG, or WebP (native, 2x-16x upscaled, or at the source image's size), or copy to the clipboard

---

## Support the Project

Img2Pixel is open-source and free. If it saves you time or enhances your workflow, consider supporting its development!

<p align="center">
  <a href="https://ko-fi.com/grinnch" target="_blank">
    <img src="https://storage.ko-fi.com/cdn/kofi2.png?v=3" alt="Support on Ko-fi" height="38"/>
  </a>
</p>

---

## License & Credits

- License: Apache-2.0 (see [LICENSE](LICENSE))
- Author: [grinnch](https://github.com/meangrinch)
