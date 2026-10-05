const assert = require('assert');
const PixelatorEngine = require('../src/engine.js');

console.log('--- Running PixelatorEngine Unit Tests ---');

// Helper to create simple ImageData-like buffer
function createBuffer(w, h, fill = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { width: w, height: h, data };
}

function getPixel(buf, x, y) {
  if (x < 0 || x >= buf.width || y < 0 || y >= buf.height) return [0, 0, 0, 0];
  const idx = (y * buf.width + x) * 4;
  return [buf.data[idx], buf.data[idx + 1], buf.data[idx + 2], buf.data[idx + 3]];
}

function setPixel(buf, x, y, col) {
  const idx = (y * buf.width + x) * 4;
  buf.data[idx] = col[0];
  buf.data[idx + 1] = col[1];
  buf.data[idx + 2] = col[2];
  buf.data[idx + 3] = col[3];
}

// Mock OffscreenCanvas for headless testing
class MockCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this._data = new Uint8ClampedArray(width * height * 4);
  }
  getContext(type) {
    return {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'high',
      drawImage: (src, sx, sy, sw, sh) => {
        if (src && src._data) {
          for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
              const srcX = Math.min(src.width - 1, Math.floor(x * (src.width / this.width)));
              const srcY = Math.min(src.height - 1, Math.floor(y * (src.height / this.height)));
              const srcIdx = (srcY * src.width + srcX) * 4;
              const dstIdx = (y * this.width + x) * 4;
              this._data[dstIdx] = src._data[srcIdx];
              this._data[dstIdx + 1] = src._data[srcIdx + 1];
              this._data[dstIdx + 2] = src._data[srcIdx + 2];
              this._data[dstIdx + 3] = src._data[srcIdx + 3];
            }
          }
        }
      },
      getImageData: (x, y, w, h) => {
        return { width: w, height: h, data: this._data };
      },
      putImageData: (imgData, x, y) => {
        this._data.set(imgData.data);
      }
    };
  }
}

if (typeof OffscreenCanvas === 'undefined') {
  global.OffscreenCanvas = MockCanvas;
}

// 1. Test RefineEdges (Priority 25)
{
  console.log('Test 1: RefineEdges');
  const buf = createBuffer(3, 1);
  setPixel(buf, 0, 0, [100, 100, 100, 240]);
  setPixel(buf, 1, 0, [100, 100, 100, 255]);
  setPixel(buf, 2, 0, [100, 100, 100, 20]);

  PixelatorEngine.refineEdges(buf, 250);
  assert.strictEqual(getPixel(buf, 0, 0)[3], 0, 'Alpha 240 <= 250 should become 0');
  assert.strictEqual(getPixel(buf, 1, 0)[3], 255, 'Alpha 255 > 250 should become 255');
  assert.strictEqual(getPixel(buf, 2, 0)[3], 0, 'Alpha 20 <= 250 should become 0');
  assert.deepStrictEqual(getPixel(buf, 0, 0), [0, 0, 0, 0], 'Alpha 240 <= 250 should zero out RGB');
  assert.deepStrictEqual(getPixel(buf, 1, 0), [100, 100, 100, 255], 'Alpha 255 > 250 should keep RGB');
  assert.deepStrictEqual(getPixel(buf, 2, 0), [0, 0, 0, 0], 'Alpha 20 <= 250 should zero out RGB');
  console.log('  Passed!');
}

// 2. Test AddBackground (Priority 65)
{
  console.log('Test 2: AddBackground');
  const buf = createBuffer(2, 1);
  setPixel(buf, 0, 0, [0, 0, 0, 0]); // transparent
  setPixel(buf, 1, 0, [200, 50, 50, 255]); // opaque

  PixelatorEngine.addBackground(buf, '#123456ff');
  const p0 = getPixel(buf, 0, 0);
  assert.strictEqual(p0[0], 0x12, 'Red should match background');
  assert.strictEqual(p0[1], 0x34, 'Green should match background');
  assert.strictEqual(p0[2], 0x56, 'Blue should match background');
  assert.strictEqual(p0[3], 255, 'Alpha should match background');

  const p1 = getPixel(buf, 1, 0);
  assert.strictEqual(p1[0], 200, 'Opaque pixel should remain unchanged');
  console.log('  Passed!');
}

// 3. Test Smoother - isolated pixel cleanup (Priority 30)
{
  console.log('Test 3: Smoother (Stray pixel elimination)');
  const buf = createBuffer(5, 5, [0, 0, 0, 0]);
  // Place a single isolated opaque pixel in center
  setPixel(buf, 2, 2, [255, 0, 0, 255]);

  PixelatorEngine.smooth(buf, 3, 1);
  const pCenter = getPixel(buf, 2, 2);
  assert.strictEqual(pCenter[3], 0, 'Isolated pixel with < 3 neighbors should be removed');
  console.log('  Passed!');
}

// 4. Test AddStroke (outside) (Priority 45)
{
  console.log('Test 4: AddStroke (outside)');
  const buf = createBuffer(3, 3, [0, 0, 0, 0]);
  // Center is opaque
  setPixel(buf, 1, 1, [255, 255, 255, 255]);

  PixelatorEngine.addStroke(buf, {
    stroke: 'outside',
    strokeOpacity: 1.0,
    strokeColor: '#ff0000',
    strokeDiagonal: false,
    strokeOnColorsDiff: 0.0
  });

  // (1, 0) is an orthogonal neighbor of center, should have stroke color
  const pTop = getPixel(buf, 1, 0);
  assert.strictEqual(pTop[0], 255, 'Stroke red');
  assert.strictEqual(pTop[1], 0, 'Stroke green');
  assert.strictEqual(pTop[2], 0, 'Stroke blue');
  assert.strictEqual(pTop[3], 255, 'Stroke alpha');

  // (0, 0) diagonal corner should NOT have stroke when diagonal is false
  const pCorner = getPixel(buf, 0, 0);
  assert.strictEqual(pCorner[3], 0, 'Diagonal corner should remain transparent without strokeDiagonal');

  // Center should remain unchanged white
  const pCenter = getPixel(buf, 1, 1);
  assert.strictEqual(pCenter[0], 255);
  assert.strictEqual(pCenter[1], 255);
  assert.strictEqual(pCenter[2], 255);
  console.log('  Passed!');
}

// 5. Test Palette Quantization & Distance Matching (Priority 10)
{
  console.log('Test 5: Palette Quantization');
  const palette = ['#000000', '#ffffff']; // Black and white
  const buf = createBuffer(2, 1);
  setPixel(buf, 0, 0, [20, 20, 20, 255]); // close to black
  setPixel(buf, 1, 0, [240, 240, 240, 255]); // close to white

  PixelatorEngine.quantize(buf, palette, false);
  const p0 = getPixel(buf, 0, 0);
  assert.deepStrictEqual(p0, [0, 0, 0, 255], 'Should snap to black');
  const p1 = getPixel(buf, 1, 0);
  assert.deepStrictEqual(p1, [255, 255, 255, 255], 'Should snap to white');
  console.log('  Passed!');
}

// 6. Test Color Science (Linear RGB LUTs, Oklab Conversion & Distance)
{
  console.log('Test 6: Color Science & Oklab');
  assert.ok(PixelatorEngine.sRGBtoLinear, 'sRGBtoLinear LUT must exist');
  assert.strictEqual(PixelatorEngine.sRGBtoLinear.length, 256, 'sRGBtoLinear must have 256 entries');
  assert.strictEqual(PixelatorEngine.sRGBtoLinear[0], 0, 'sRGBtoLinear[0] must be 0');
  assert.ok(Math.abs(PixelatorEngine.sRGBtoLinear[255] - 1.0) < 1e-5, 'sRGBtoLinear[255] must be ~1.0');

  assert.strictEqual(PixelatorEngine.linearToSRGB(0.0), 0, 'linearToSRGB(0) must be 0');
  assert.strictEqual(PixelatorEngine.linearToSRGB(1.0), 255, 'linearToSRGB(1) must be 255');
  assert.strictEqual(PixelatorEngine.linearToSRGB(PixelatorEngine.sRGBtoLinear[128]), 128, 'linearToSRGB roundtrip 128');

  const blackLab = PixelatorEngine.rgbToOklab(0, 0, 0);
  assert.ok(Math.abs(blackLab[0] - 0.0) < 1e-4, `Black L should be ~0, got ${blackLab[0]}`);

  const whiteLab = PixelatorEngine.rgbToOklab(255, 255, 255);
  assert.ok(Math.abs(whiteLab[0] - 1.0) < 1e-4, `White L should be ~1.0, got ${whiteLab[0]}`);

  // Perceptual test: verify peach [245, 185, 155] is closer to skin [240, 190, 160] than olive [190, 190, 130] in Oklab space
  const peachLab = PixelatorEngine.rgbToOklab(245, 185, 155);
  const skinLab = PixelatorEngine.rgbToOklab(240, 190, 160);
  const oliveLab = PixelatorEngine.rgbToOklab(190, 190, 130);
  const distPeachSkin = PixelatorEngine.colorDistOklabSq(peachLab[0], peachLab[1], peachLab[2], skinLab[0], skinLab[1], skinLab[2]);
  const distPeachOlive = PixelatorEngine.colorDistOklabSq(peachLab[0], peachLab[1], peachLab[2], oliveLab[0], oliveLab[1], oliveLab[2]);
  assert.ok(distPeachSkin < distPeachOlive, `Peach should be closer to skin (${distPeachSkin}) than olive (${distPeachOlive})`);

  // Test precomputePaletteOklab
  const precomp = PixelatorEngine.precomputePaletteOklab(['#ffffff', [0, 0, 0]]);
  assert.strictEqual(precomp.length, 2);
  assert.strictEqual(precomp[0].r, 255);
  assert.strictEqual(precomp[0].g, 255);
  assert.deepStrictEqual(precomp[0].rgb, [255, 255, 255]);
  assert.ok(Math.abs(precomp[0].L - 1.0) < 0.01);
  assert.ok(Math.abs(precomp[0].a - 0.0) < 0.01);
  assert.ok(Math.abs(precomp[0].b - 0.0) < 0.01);

  assert.strictEqual(precomp[1].r, 0);
  assert.strictEqual(precomp[1].g, 0);
  assert.deepStrictEqual(precomp[1].rgb, [0, 0, 0]);
  assert.ok(Math.abs(precomp[1].L - 0.0) < 0.01);
  assert.ok(Math.abs(precomp[1].a - 0.0) < 0.01);
  assert.ok(Math.abs(precomp[1].b - 0.0) < 0.01);

  console.log('  Passed!');
}

// 7. Test Pipeline Reordering & Edge Defringing (Priority 2)
{
  console.log('Test 7: Pipeline Re-ordering & Edge Refinement Defringing');

  // Subtest 7A: refineEdges zeroes out RGB when alpha <= threshold
  const buf = createBuffer(2, 1);
  setPixel(buf, 0, 0, [200, 150, 100, 200]); // alpha > 128
  setPixel(buf, 1, 0, [100, 100, 100, 40]);  // alpha <= 128

  PixelatorEngine.refineEdges(buf, 128);
  assert.deepStrictEqual(getPixel(buf, 0, 0), [200, 150, 100, 255], 'Alpha > 128 becomes 255 with RGB preserved');
  assert.deepStrictEqual(getPixel(buf, 1, 0), [0, 0, 0, 0], 'Alpha <= 128 must be zeroed out along with RGB');

  // Subtest 7B: process() end-to-end: semi-transparent pixels made transparent and not quantized into palette
  const src = new MockCanvas(2, 1);
  const srcCtx = src.getContext('2d');
  const srcBuf = createBuffer(2, 1);
  setPixel(srcBuf, 0, 0, [255, 0, 0, 255]); // opaque red
  setPixel(srcBuf, 1, 0, [0, 255, 0, 40]);   // semi-transparent green edge (alpha 40 <= 128)
  srcCtx.putImageData(srcBuf, 0, 0);

  const result = PixelatorEngine.process(src, {
    pixelate: 1.0,
    refineEdges: 128,
    paletteMode: 'preset',
    customPalette: ['#ff0000', '#00ff00']
  });

  const outCtx = result.canvas.getContext('2d');
  const outImgData = outCtx.getImageData(0, 0, 2, 1);
  assert.deepStrictEqual(getPixel(outImgData, 0, 0), [255, 0, 0, 255], 'Opaque red pixel preserved');
  assert.deepStrictEqual(getPixel(outImgData, 1, 0), [0, 0, 0, 0], 'Semi-transparent edge pixel must be zeroed out (alpha 0 and RGB 0), not quantized into palette green');

  // Subtest 7C: process() end-to-end with adaptive palette: edge fringe does not pollute extracted palette
  const srcAdaptive = new MockCanvas(2, 1);
  const srcAdaptiveCtx = srcAdaptive.getContext('2d');
  const srcAdaptiveBuf = createBuffer(2, 1);
  setPixel(srcAdaptiveBuf, 0, 0, [255, 0, 0, 255]); // opaque red
  setPixel(srcAdaptiveBuf, 1, 0, [0, 255, 0, 80]);  // green fringe (alpha 80 > 64, but <= 128)
  srcAdaptiveCtx.putImageData(srcAdaptiveBuf, 0, 0);

  const resultAdaptive = PixelatorEngine.process(srcAdaptive, {
    pixelate: 1.0,
    refineEdges: 128,
    paletteMode: 'adaptive',
    paletteColors: 2
  });

  const outAdaptiveCtx = resultAdaptive.canvas.getContext('2d');
  const outAdaptiveImgData = outAdaptiveCtx.getImageData(0, 0, 2, 1);
  // Subtest 7D: process() with paletteMode: 'custom'
  const srcCustom = new MockCanvas(1, 1);
  const srcCustomCtx = srcCustom.getContext('2d');
  const srcCustomBuf = createBuffer(1, 1);
  setPixel(srcCustomBuf, 0, 0, [255, 255, 255, 255]); // white pixel
  srcCustomCtx.putImageData(srcCustomBuf, 0, 0);

  const resultCustom = PixelatorEngine.process(srcCustom, {
    pixelate: 1.0,
    paletteMode: 'custom',
    customPalette: ['#0000ff'] // only blue in palette
  });
  const outCustomCtx = resultCustom.canvas.getContext('2d');
  const outCustomImgData = outCustomCtx.getImageData(0, 0, 1, 1);
  assert.deepStrictEqual(getPixel(outCustomImgData, 0, 0), [0, 0, 255, 255], 'White pixel must be quantized to custom palette blue');

  console.log('  Passed!');
}

// 8. Test Downsampling Processor (Linear RGB Box, Point/Center, Dominant Mode)
{
  console.log('Test 8: Downsampling Processor (Box, Point, Mode, SnapInteger)');

  // Subtest 8A: 'box' mode on 2x2 with 3 white and 1 black pixels
  // In linear RGB: (3 * 1.0 + 1 * 0.0) / 4 = 0.75 linear
  // linearToSRGB(0.75) ≈ 225 (~224, significantly higher than gamma-incorrect sRGB average 191)
  const src2x2 = createBuffer(2, 2);
  setPixel(src2x2, 0, 0, [0, 0, 0, 255]);         // black
  setPixel(src2x2, 1, 0, [255, 255, 255, 255]); // white
  setPixel(src2x2, 0, 1, [255, 255, 255, 255]); // white
  setPixel(src2x2, 1, 1, [255, 255, 255, 255]); // white

  const outBox = PixelatorEngine.downsampleBuffer(src2x2, 2.0, 'box');
  assert.strictEqual(outBox.width, 1);
  assert.strictEqual(outBox.height, 1);
  const pBox = getPixel(outBox, 0, 0);
  assert.ok(pBox[0] > 210 && pBox[0] < 235, `Linear box average should be ~224 (got ${pBox[0]})`);
  assert.notStrictEqual(pBox[0], 191, 'Box average must not be naive non-linear 191');
  assert.strictEqual(pBox[0], pBox[1], 'R and G should match for grayscale input');
  assert.strictEqual(pBox[1], pBox[2], 'G and B should match for grayscale input');
  assert.strictEqual(pBox[3], 255, 'Alpha should be 255');

  // Subtest 8B: 'point' mode on 2x2
  // Must return an exact color from the source without intermediate blending
  const outPoint = PixelatorEngine.downsampleBuffer(src2x2, 2.0, 'point');
  assert.strictEqual(outPoint.width, 1);
  assert.strictEqual(outPoint.height, 1);
  const pPoint = getPixel(outPoint, 0, 0);
  assert.ok(
    (pPoint[0] === 0 && pPoint[1] === 0 && pPoint[2] === 0) ||
    (pPoint[0] === 255 && pPoint[1] === 255 && pPoint[2] === 255),
    `Point sampling must return an exact source color (0 or 255), got ${pPoint}`
  );

  // Subtest 8C: 'mode' mode on 3x3 block: selects majority color
  // 6 red pixels, 3 blue pixels -> dominant color is red
  const src3x3 = createBuffer(3, 3);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      setPixel(src3x3, x, y, [255, 0, 0, 255]); // red
    }
  }
  setPixel(src3x3, 0, 0, [0, 0, 255, 255]); // blue
  setPixel(src3x3, 1, 0, [0, 0, 255, 255]); // blue
  setPixel(src3x3, 2, 0, [0, 0, 255, 255]); // blue

  const outMode = PixelatorEngine.downsampleBuffer(src3x3, 3.0, 'mode');
  assert.strictEqual(outMode.width, 1);
  assert.strictEqual(outMode.height, 1);
  const pMode = getPixel(outMode, 0, 0);
  assert.deepStrictEqual(pMode, [255, 0, 0, 255], 'Mode downsampling must pick dominant red color');

  // Subtest 8D: 'mode' tie-breaking: picks color closest to cell center
  // 4 green pixels, 4 yellow pixels, 1 center pixel yellow
  // Yellow has 5 pixels total, but let's test exact tie: 4 vs 4 with 1 center
  // Say 4 cyan and 4 magenta, center (1, 1) is cyan
  const srcTie = createBuffer(3, 3);
  const cyan = [0, 255, 255, 255];
  const magenta = [255, 0, 255, 255];
  // 4 cyan at corners and center
  setPixel(srcTie, 0, 0, cyan);
  setPixel(srcTie, 2, 0, cyan);
  setPixel(srcTie, 0, 2, cyan);
  setPixel(srcTie, 1, 1, cyan); // center!
  // 4 magenta at edges
  setPixel(srcTie, 1, 0, magenta);
  setPixel(srcTie, 0, 1, magenta);
  setPixel(srcTie, 2, 1, magenta);
  setPixel(srcTie, 1, 2, magenta);
  // (2, 2) is a 3rd dummy color
  setPixel(srcTie, 2, 2, [0, 0, 0, 255]);

  // Cyan has 4, Magenta has 4. Cyan contains center (1, 1) with distSq = 0.
  const outTie = PixelatorEngine.downsampleBuffer(srcTie, 3.0, 'mode');
  const pTie = getPixel(outTie, 0, 0);
  assert.deepStrictEqual(pTie, cyan, 'Tied mode should select color closest to cell center');

  // Subtest 8E: snapInteger option
  const srcSnap = createBuffer(10, 10);
  // With snapInteger = true: factor 2.4 rounds to 2 -> subW = floor(10 / 2) = 5
  // With snapInteger = false: factor 2.4 -> subW = floor(10 / 2.4) = 4
  const outSnapped = PixelatorEngine.downsampleBuffer(srcSnap, 2.4, 'box', true);
  const outUnsnapped = PixelatorEngine.downsampleBuffer(srcSnap, 2.4, 'box', false);
  assert.strictEqual(outSnapped.width, 5, 'snapInteger=true should round factor 2.4 to 2, yielding width 5');
  assert.strictEqual(outUnsnapped.width, 4, 'snapInteger=false should yield width 4');

  // Subtest 8F: downsampleCanvas integration
  const canvasSrc = new MockCanvas(4, 4);
  const cCtx = canvasSrc.getContext('2d');
  const cBuf = createBuffer(4, 4, [100, 150, 200, 255]);
  cCtx.putImageData(cBuf, 0, 0);

  const resCanvas = PixelatorEngine.downsampleCanvas(canvasSrc, {
    pixelate: 2.0,
    downsampleMethod: 'box'
  });
  assert.strictEqual(resCanvas.subW, 2);
  assert.strictEqual(resCanvas.subH, 2);
  assert.strictEqual(resCanvas.origW, 4);
  assert.strictEqual(resCanvas.origH, 4);
  assert.strictEqual(resCanvas.imgData.width, 2);
  assert.strictEqual(resCanvas.imgData.height, 2);

  console.log('  Passed!');
}

// 9. Test Adaptive Palette Extraction (Wu's Fast Optimal 3D Variance Quantizer)
{
  console.log('Test 9: Wu Variance Quantizer & Adaptive Palette');
  // Subtest 9A: Accent Preservation Test
  // Create buffer with 95 dark navy pixels [10, 10, 50, 255] and 5 bright yellow pixels [255, 240, 0, 255]
  const buf = createBuffer(100, 1);
  for (let i = 0; i < 95; i++) {
    setPixel(buf, i, 0, [10, 10, 50, 255]);
  }
  for (let i = 95; i < 100; i++) {
    setPixel(buf, i, 0, [255, 240, 0, 255]);
  }

  // Run buildWuPalette(buf, 2)
  const wuPalette = PixelatorEngine.buildWuPalette(buf, 2);
  assert.strictEqual(wuPalette.length, 2, 'Wu palette should extract exactly 2 colors');

  // Assert one color is dark navy and the other color is bright yellow (r > 200, g > 200, b < 50)
  const yellowColor = wuPalette.find((c) => c[0] > 200 && c[1] > 200 && c[2] < 50);
  const navyColor = wuPalette.find((c) => c[0] < 50 && c[1] < 50 && c[2] > 20);
  assert.ok(yellowColor, `Wu quantizer must preserve bright yellow accent color (got ${JSON.stringify(wuPalette)})`);
  assert.ok(navyColor, `Wu quantizer must preserve dark navy color (got ${JSON.stringify(wuPalette)})`);

  // Subtest 9B: Test buildAdaptivePalette with 'wu' (and default)
  const adaptiveDef = PixelatorEngine.buildAdaptivePalette(buf, 2);
  assert.strictEqual(adaptiveDef.length, 2);
  const defYellow = adaptiveDef.find((c) => c[0] > 200 && c[1] > 200 && c[2] < 50);
  assert.ok(defYellow, 'buildAdaptivePalette default should use Wu and preserve yellow accent');

  const adaptiveExplicitWu = PixelatorEngine.buildAdaptivePalette(buf, 2, 'wu');
  assert.deepStrictEqual(adaptiveExplicitWu, adaptiveDef, 'buildAdaptivePalette("wu") should match default');

  // Subtest 9C: Test buildAdaptivePalette with 'median'
  const adaptiveMedian = PixelatorEngine.buildAdaptivePalette(buf, 2, 'median');
  assert.strictEqual(adaptiveMedian.length, 2, 'Median cut should produce 2 colors');

  // Subtest 9D: Test process() pipeline integration with quantizerMethod
  const mockCanvas = new MockCanvas(100, 1);
  const ctx = mockCanvas.getContext('2d');
  ctx.putImageData(buf, 0, 0);

  const procWu = PixelatorEngine.process(mockCanvas, {
    pixelate: 1.0,
    paletteMode: 'adaptive',
    paletteColors: 2,
    quantizerMethod: 'wu'
  });
  assert.strictEqual(procWu.paletteCount, 2, 'process() with quantizerMethod="wu" should extract 2 colors');

  const procMedian = PixelatorEngine.process(mockCanvas, {
    pixelate: 1.0,
    paletteMode: 'adaptive',
    paletteColors: 2,
    quantizerMethod: 'median'
  });
  assert.strictEqual(procMedian.paletteCount, 2, 'process() with quantizerMethod="median" should extract 2 colors');

  // Subtest 9E: Edge cases - transparent buffer and single color buffer
  const transBuf = createBuffer(10, 10, [0, 0, 0, 0]);
  const transPal = PixelatorEngine.buildWuPalette(transBuf, 4);
  assert.deepStrictEqual(transPal, [[0, 0, 0]], 'Transparent buffer should return fallback [0, 0, 0]');

  const singleColorBuf = createBuffer(10, 10, [120, 80, 200, 255]);
  const singlePal = PixelatorEngine.buildWuPalette(singleColorBuf, 8);
  assert.strictEqual(singlePal.length, 1, 'Single color buffer should return 1 color');
  assert.deepStrictEqual(singlePal[0], [120, 80, 200], 'Single color should match source color');

  // Subtest 9F: Test buildKMeansPalette (direct K-Means++) and buildKMeansFastPalette (two-stage)
  const kMeansPal = PixelatorEngine.buildKMeansPalette(buf, 2);
  assert.strictEqual(kMeansPal.length, 2, 'K-Means++ palette should produce 2 colors');
  const kMeansYellow = kMeansPal.find((c) => c[0] > 200 && c[1] > 200 && c[2] < 50);
  assert.ok(kMeansYellow, 'K-Means++ quantizer must preserve yellow accent');

  const kMeansFastPal = PixelatorEngine.buildKMeansFastPalette(buf, 2);
  assert.strictEqual(kMeansFastPal.length, 2, 'K-Means++ Fast palette should produce 2 colors');
  const kMeansFastYellow = kMeansFastPal.find((c) => c[0] > 200 && c[1] > 200 && c[2] < 50);
  assert.ok(kMeansFastYellow, 'K-Means++ Fast quantizer must preserve yellow accent');
  assert.deepStrictEqual(PixelatorEngine.buildTwoStagePalette(buf, 2), kMeansFastPal, 'buildTwoStagePalette alias should match buildKMeansFastPalette');

  // Determinism check: multiple runs on identical buffer must produce identical results
  const kMeansPal2 = PixelatorEngine.buildKMeansPalette(buf, 2);
  assert.deepStrictEqual(kMeansPal, kMeansPal2, 'K-Means++ quantizer must be 100% deterministic');
  const kMeansFastPal2 = PixelatorEngine.buildKMeansFastPalette(buf, 2);
  assert.deepStrictEqual(kMeansFastPal, kMeansFastPal2, 'K-Means++ Fast quantizer must be 100% deterministic');

  // Direct K-Means++ locked colors preservation
  const lockedGreen = [{ r: 0, g: 255, b: 0 }];
  const kMeansLocked = PixelatorEngine.buildKMeansPalette(buf, 3, lockedGreen);
  assert.strictEqual(kMeansLocked.length, 3, 'K-Means++ with locked color should return 3 colors');
  const hasLockedGreen = kMeansLocked.some((c) => c[0] === 0 && c[1] === 255 && c[2] === 0);
  assert.ok(hasLockedGreen, 'Direct K-Means++ must preserve locked color');

  // Direct K-Means++ deduplication test
  const dedupBuf = createBuffer(4, 1);
  setPixel(dedupBuf, 0, 0, [20, 20, 20, 255]);
  setPixel(dedupBuf, 1, 0, [200, 200, 200, 255]);
  setPixel(dedupBuf, 2, 0, [255, 0, 0, 255]);
  setPixel(dedupBuf, 3, 0, [0, 0, 255, 255]);
  const dedupPal = PixelatorEngine.buildKMeansPalette(dedupBuf, 4);
  assert.strictEqual(dedupPal.length, 4, 'Deduplication must maintain 4 distinct clusters');
  for (let i = 0; i < dedupPal.length; i++) {
    for (let j = i + 1; j < dedupPal.length; j++) {
      const lab1 = PixelatorEngine.rgbToOklab(dedupPal[i][0], dedupPal[i][1], dedupPal[i][2]);
      const lab2 = PixelatorEngine.rgbToOklab(dedupPal[j][0], dedupPal[j][1], dedupPal[j][2]);
      const d = PixelatorEngine.colorDistOklabSq(lab1[0], lab1[1], lab1[2], lab2[0], lab2[1], lab2[2]);
      assert.ok(d > 0.001, 'Centroids should not collapse into identical points');
    }
  }

  // Subtest 9G: Test buildAdaptivePalette with 'kmeans', 'kmeans_fast' (and aliases)
  const adaptiveKMeans = PixelatorEngine.buildAdaptivePalette(buf, 2, 'kmeans');
  assert.deepStrictEqual(adaptiveKMeans, kMeansPal, 'buildAdaptivePalette("kmeans") should match buildKMeansPalette');
  const adaptiveKMeansFast = PixelatorEngine.buildAdaptivePalette(buf, 2, 'kmeans_fast');
  assert.deepStrictEqual(adaptiveKMeansFast, kMeansFastPal, 'buildAdaptivePalette("kmeans_fast") should match buildKMeansFastPalette');
  const adaptiveFastAlias = PixelatorEngine.buildAdaptivePalette(buf, 2, 'fast');
  assert.deepStrictEqual(adaptiveFastAlias, kMeansFastPal, 'buildAdaptivePalette("fast") should match buildKMeansFastPalette');
  const adaptiveTwoStageAlias = PixelatorEngine.buildAdaptivePalette(buf, 2, 'two_stage');
  assert.deepStrictEqual(adaptiveTwoStageAlias, kMeansFastPal, 'buildAdaptivePalette("two_stage") should match buildKMeansFastPalette');

  // Subtest 9H: Test process() pipeline integration with quantizerMethod="kmeans" and "kmeans_fast"
  const procKMeans = PixelatorEngine.process(mockCanvas, {
    pixelate: 1.0,
    paletteMode: 'adaptive',
    paletteColors: 2,
    quantizerMethod: 'kmeans'
  });
  assert.strictEqual(procKMeans.paletteCount, 2, 'process() with quantizerMethod="kmeans" should extract 2 colors');

  const procKMeansFast = PixelatorEngine.process(mockCanvas, {
    pixelate: 1.0,
    paletteMode: 'adaptive',
    paletteColors: 2,
    quantizerMethod: 'kmeans_fast'
  });
  assert.strictEqual(procKMeansFast.paletteCount, 2, 'process() with quantizerMethod="kmeans_fast" should extract 2 colors');

  // Subtest 9I: Test extractPalette with quantizerMethod="kmeans" and "kmeans_fast"
  const extractedKMeans = PixelatorEngine.extractPalette(buf, 2, 'kmeans');
  assert.strictEqual(extractedKMeans.length, 2, 'extractPalette with "kmeans" should return 2 hex colors');
  const extractedKMeansFast = PixelatorEngine.extractPalette(buf, 2, 'kmeans_fast');
  assert.strictEqual(extractedKMeansFast.length, 2, 'extractPalette with "kmeans_fast" should return 2 hex colors');

  // Subtest 9J: Performance & correctness check for direct K-Means++ on large buffer (512x512, 256 colors)
  const largeBuf = createBuffer(512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      setPixel(largeBuf, x, y, [
        Math.round((x / 512) * 255),
        Math.round((y / 512) * 255),
        Math.round(((x + y) / 1024) * 255),
        255
      ]);
    }
  }
  const tStartKMeans = Date.now();
  const largeKMeansPal = PixelatorEngine.extractPalette(largeBuf, 256, 'kmeans');
  const elapsedKMeans = Date.now() - tStartKMeans;
  assert.strictEqual(largeKMeansPal.length, 256, 'Large buffer K-Means++ should produce 256 colors');
  assert.ok(elapsedKMeans < 1500, `Large buffer K-Means++ must complete responsively (took ${elapsedKMeans}ms, expected < 1500ms)`);
  for (const hex of largeKMeansPal) {
    assert.match(hex, /^#[0-9a-f]{6}$/i, `Color ${hex} must be a valid hex string`);
  }

  console.log('  Passed!');
}

// 10. Test Retro Dithering Suite (Bayer, Atkinson, Serpentine Floyd-Steinberg, ditherAmount, colorMetric)
{
  console.log('Test 10: Retro Dithering Suite');

  // Subtest 10A: Oklab nearest matching vs redmean option
  const testPal = [[128, 128, 128], [0, 0, 255]]; // Gray and Blue
  const bufRedmean = createBuffer(1, 1, [0, 0, 0, 255]); // Black
  PixelatorEngine.quantize(bufRedmean, testPal, { colorMetric: 'redmean', ditherType: 'none' });
  assert.deepStrictEqual(getPixel(bufRedmean, 0, 0), [128, 128, 128, 255], 'Redmean should select gray 128 for black input');

  const bufOklab = createBuffer(1, 1, [0, 0, 0, 255]);
  PixelatorEngine.quantize(bufOklab, testPal, { colorMetric: 'oklab', ditherType: 'none' });
  assert.deepStrictEqual(getPixel(bufOklab, 0, 0), [0, 0, 255, 255], 'Oklab should select blue 255 for black input due to lower perceived lightness');

  // Verify default colorMetric is oklab
  const bufDefault = createBuffer(1, 1, [0, 0, 0, 255]);
  PixelatorEngine.quantize(bufDefault, testPal, { ditherType: 'none' });
  assert.deepStrictEqual(getPixel(bufDefault, 0, 0), [0, 0, 255, 255], 'Default colorMetric must be oklab');

  // Subtest 10B: Bayer 2x2, 4x4, 8x8 deterministic patterns on gradient buffers
  assert.ok(PixelatorEngine.BAYER_2, 'BAYER_2 matrix must be defined');
  assert.strictEqual(PixelatorEngine.BAYER_2.length, 4, 'BAYER_2 must have 4 entries');
  assert.strictEqual(PixelatorEngine.BAYER_4.length, 16, 'BAYER_4 must have 16 entries');
  assert.strictEqual(PixelatorEngine.BAYER_8.length, 64, 'BAYER_8 must have 64 entries');

  // Check normalized values [-0.5, 0.5]
  assert.strictEqual(PixelatorEngine.BAYER_2[0], -0.5);
  assert.strictEqual(PixelatorEngine.BAYER_2[1], 0.0);
  assert.strictEqual(PixelatorEngine.BAYER_2[2], 0.25);
  assert.strictEqual(PixelatorEngine.BAYER_2[3], -0.25);

  // Gray 149 is ~30% white in linear light: 1 of 4 cells goes white, the highest threshold (M=0.25)
  const bwPalette = [[0, 0, 0], [255, 255, 255]];
  const bayer2Buf = createBuffer(2, 2, [149, 149, 149, 255]);
  PixelatorEngine.quantize(bayer2Buf, bwPalette, { ditherType: 'bayer2', ditherAmount: 1.0 });
  assert.deepStrictEqual(getPixel(bayer2Buf, 0, 0), [0, 0, 0, 255], 'Bayer 2x2 (0,0) M=-0.5 should snap to black');
  assert.deepStrictEqual(getPixel(bayer2Buf, 1, 0), [0, 0, 0, 255], 'Bayer 2x2 (1,0) M=0.0 should snap to black');
  assert.deepStrictEqual(getPixel(bayer2Buf, 0, 1), [255, 255, 255, 255], 'Bayer 2x2 (0,1) M=0.25 should snap to white');
  assert.deepStrictEqual(getPixel(bayer2Buf, 1, 1), [0, 0, 0, 255], 'Bayer 2x2 (1,1) M=-0.25 should snap to black');

  // Test periodicity on 8x8 buffer for bayer2, bayer4, and bayer8
  const gradBuf2 = createBuffer(8, 8);
  const gradBuf4 = createBuffer(8, 8);
  const gradBuf8 = createBuffer(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = Math.round((x / 7) * 255);
      setPixel(gradBuf2, x, y, [v, v, v, 255]);
      setPixel(gradBuf4, x, y, [v, v, v, 255]);
      setPixel(gradBuf8, x, y, [v, v, v, 255]);
    }
  }
  PixelatorEngine.quantize(gradBuf2, bwPalette, { ditherType: 'bayer2', ditherAmount: 1.0 });
  PixelatorEngine.quantize(gradBuf4, bwPalette, { ditherType: 'bayer4', ditherAmount: 1.0 });
  PixelatorEngine.quantize(gradBuf8, bwPalette, { ditherType: 'bayer8', ditherAmount: 1.0 });

  // Verify bayer2 has period 2 along y for identical x columns
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 6; y++) {
      assert.deepStrictEqual(getPixel(gradBuf2, x, y), getPixel(gradBuf2, x, y + 2), 'Bayer 2x2 y-periodicity');
    }
  }
  // Verify bayer4 has period 4 along y
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 4; y++) {
      assert.deepStrictEqual(getPixel(gradBuf4, x, y), getPixel(gradBuf4, x, y + 4), 'Bayer 4x4 y-periodicity');
    }
  }

  // Subtest 10C: Atkinson dithering (verifying 75% error diffusion and alpha shielding)
  // Opaque buffer: error from (0,0) diffuses to (1,0) causing it to cross threshold
  const atkOpaque = createBuffer(3, 3, [0, 0, 0, 255]);
  setPixel(atkOpaque, 0, 0, [95, 95, 95, 255]);
  setPixel(atkOpaque, 1, 0, [95, 95, 95, 255]);
  PixelatorEngine.quantize(atkOpaque, bwPalette, { ditherType: 'atkinson', ditherAmount: 1.0 });
  assert.deepStrictEqual(getPixel(atkOpaque, 0, 0), [0, 0, 0, 255], 'Atkinson (0,0) snaps to black');
  assert.deepStrictEqual(getPixel(atkOpaque, 1, 0), [255, 255, 255, 255], 'Atkinson (1,0) receives 1/8 error and crosses threshold to white');

  // Alpha shielding: transparent pixel at (1,0) must not receive error or change
  const atkShield = createBuffer(3, 3, [0, 0, 0, 255]);
  setPixel(atkShield, 0, 0, [95, 95, 95, 255]);
  setPixel(atkShield, 1, 0, [95, 95, 95, 0]); // transparent
  PixelatorEngine.quantize(atkShield, bwPalette, { ditherType: 'atkinson', ditherAmount: 1.0 });
  assert.deepStrictEqual(getPixel(atkShield, 1, 0), [95, 95, 95, 0], 'Shielded pixel must remain untouched');

  // Verify Atkinson on uniform gray generates non-zero white pixels (75% error diffusion active)
  const atkUniform = createBuffer(8, 8, [90, 90, 90, 255]);
  PixelatorEngine.quantize(atkUniform, bwPalette, { ditherType: 'atkinson', ditherAmount: 1.0 });
  let atkWhiteCount = 0;
  for (let i = 0; i < 64 * 4; i += 4) {
    if (atkUniform.data[i] === 255) atkWhiteCount++;
  }
  // Grey 90 is ~10% linear light, so ~6 of 64 pixels turn white
  assert.ok(atkWhiteCount >= 3 && atkWhiteCount <= 12, `Atkinson uniform dither expected ~6 whites, got ${atkWhiteCount}`);

  // Subtest 10D: Serpentine Floyd-Steinberg row alternation
  // On odd row (y=1), scan is right-to-left. Pixel at (2,1) diffuses error to the left into (1,1).
  const serpBuf = createBuffer(3, 2, [0, 0, 0, 255]);
  setPixel(serpBuf, 1, 1, [110, 110, 110, 255]);
  setPixel(serpBuf, 2, 1, [140, 140, 140, 255]);
  PixelatorEngine.quantize(serpBuf, bwPalette, { ditherType: 'floyd', ditherAmount: 1.0 });
  assert.deepStrictEqual(
    getPixel(serpBuf, 1, 1),
    [0, 0, 0, 255],
    'Serpentine right-to-left scan must diffuse negative error from (2,1) into (1,1), snapping it to black'
  );

  const noSerpBuf = createBuffer(3, 2, [0, 0, 0, 255]);
  setPixel(noSerpBuf, 1, 1, [110, 110, 110, 255]);
  setPixel(noSerpBuf, 2, 1, [140, 140, 140, 255]);
  PixelatorEngine.quantize(noSerpBuf, bwPalette, { ditherType: 'none' });
  assert.deepStrictEqual(
    getPixel(noSerpBuf, 1, 1),
    [255, 255, 255, 255],
    'Without dithering error diffusion, (1,1) would have snapped to white'
  );

  // Subtest 10E: ditherAmount parameter (0.0 -> no error, 1.0 -> full error)
  const bNone = createBuffer(4, 4, [95, 95, 95, 255]);
  PixelatorEngine.quantize(bNone, bwPalette, { ditherType: 'none' });

  const bZeroFloyd = createBuffer(4, 4, [95, 95, 95, 255]);
  PixelatorEngine.quantize(bZeroFloyd, bwPalette, { ditherType: 'floyd', ditherAmount: 0.0 });
  assert.deepStrictEqual(bZeroFloyd.data, bNone.data, 'ditherAmount 0.0 with floyd must match ditherType "none"');

  const bZeroAtk = createBuffer(4, 4, [95, 95, 95, 255]);
  PixelatorEngine.quantize(bZeroAtk, bwPalette, { ditherType: 'atkinson', ditherAmount: 0.0 });
  assert.deepStrictEqual(bZeroAtk.data, bNone.data, 'ditherAmount 0.0 with atkinson must match ditherType "none"');

  const bFullFloyd = createBuffer(4, 4, [95, 95, 95, 255]);
  PixelatorEngine.quantize(bFullFloyd, bwPalette, { ditherType: 'floyd', ditherAmount: 1.0 });
  assert.notDeepStrictEqual(bFullFloyd.data, bNone.data, 'ditherAmount 1.0 must diffuse error and differ from "none"');

  // Subtest 10F: process() end-to-end integration with retro dithering options
  const canvasSrc = new MockCanvas(4, 4);
  const cCtx = canvasSrc.getContext('2d');
  const cBuf = createBuffer(4, 4, [95, 95, 95, 255]);
  cCtx.putImageData(cBuf, 0, 0);

  const procRes = PixelatorEngine.process(canvasSrc, {
    pixelate: 1.0,
    paletteMode: 'preset',
    customPalette: ['#000000', '#ffffff'],
    ditherType: 'bayer4',
    ditherAmount: 0.8,
    colorMetric: 'oklab'
  });
  // Subtest 10G: Burkes, Sierra-3, Sierra-2, Sierra Lite Dithering
  // In Oklab with bwPalette, values <= 98 snap to black ([0,0,0]), values >= 99 snap to white ([255,255,255]).
  // Pixel (0,0) with value [95, 95, 95] snaps to black [0,0,0], generating error +95.
  // 1. Burkes forward diffusion on row 0:
  // (1,0) initial value is 95 (snaps to black without diffusion).
  // In Burkes, (1,0) gets 8/32 = 0.25 of error -> +23.75 -> 95 + 23.75 = 118.75 -> crosses threshold to white!
  const burkesBuf = createBuffer(4, 2, [0, 0, 0, 255]);
  setPixel(burkesBuf, 0, 0, [95, 95, 95, 255]);
  setPixel(burkesBuf, 1, 0, [95, 95, 95, 255]);
  PixelatorEngine.quantize(burkesBuf, bwPalette, { ditherType: 'burkes', ditherAmount: 1.0 });
  assert.deepStrictEqual(getPixel(burkesBuf, 0, 0), [0, 0, 0, 255], 'Burkes (0,0) snaps to black');
  assert.deepStrictEqual(getPixel(burkesBuf, 1, 0), [255, 255, 255, 255], 'Burkes (1,0) crosses threshold to white due to 8/32 error');

  // Verify Burkes serpentine right-to-left on odd row:
  const burkesSerp = createBuffer(4, 2, [0, 0, 0, 255]);
  setPixel(burkesSerp, 2, 1, [115, 115, 115, 255]);
  setPixel(burkesSerp, 3, 1, [140, 140, 140, 255]); // (3,1) snaps to white (255), producing negative error (140 - 255 = -115)
  // On row 1 (right-to-left), error diffuses left to (2,1): 115 + (-115 * 8/32) = 115 - 28.75 = 86.25 -> snaps to black!
  PixelatorEngine.quantize(burkesSerp, bwPalette, { ditherType: 'burkes', ditherAmount: 1.0 });
  assert.deepStrictEqual(getPixel(burkesSerp, 2, 1), [0, 0, 0, 255], 'Burkes serpentine right-to-left diffuses error leftward');

  // 2. Sierra-3 (3-row diffusion)
  const sierra3Buf = createBuffer(4, 3, [0, 0, 0, 255]);
  setPixel(sierra3Buf, 0, 0, [95, 95, 95, 255]); // snaps to black, error +95
  setPixel(sierra3Buf, 1, 0, [95, 95, 95, 255]); // receives 5/32 (+14.84) -> 109.84 -> snaps to white
  PixelatorEngine.quantize(sierra3Buf, bwPalette, { ditherType: 'sierra-3', ditherAmount: 1.0 });
  assert.deepStrictEqual(getPixel(sierra3Buf, 1, 0), [255, 255, 255, 255], 'Sierra-3 (1,0) crosses threshold to white');

  // 3. Sierra-2 (2-row diffusion)
  const sierra2Buf = createBuffer(4, 2, [0, 0, 0, 255]);
  setPixel(sierra2Buf, 0, 0, [95, 95, 95, 255]); // snaps to black, error +95
  setPixel(sierra2Buf, 1, 0, [95, 95, 95, 255]); // receives 4/16 (+23.75) -> 118.75 -> snaps to white
  PixelatorEngine.quantize(sierra2Buf, bwPalette, { ditherType: 'sierra-2', ditherAmount: 1.0 });
  assert.deepStrictEqual(getPixel(sierra2Buf, 1, 0), [255, 255, 255, 255], 'Sierra-2 (1,0) crosses threshold to white');

  // 4. Sierra Lite
  const sierraLiteBuf = createBuffer(4, 2, [0, 0, 0, 255]);
  setPixel(sierraLiteBuf, 0, 0, [95, 95, 95, 255]); // snaps to black, error +95
  setPixel(sierraLiteBuf, 1, 0, [95, 95, 95, 255]); // receives 2/4 (+47.5) -> 142.5 -> snaps to white
  PixelatorEngine.quantize(sierraLiteBuf, bwPalette, { ditherType: 'sierra-lite', ditherAmount: 1.0 });
  assert.deepStrictEqual(getPixel(sierraLiteBuf, 1, 0), [255, 255, 255, 255], 'Sierra Lite (1,0) crosses threshold to white');

  // 5. Test aliases: 'sierra3', 'sierra', 'sierra2', 'sierralite'
  const aliasBuf1 = createBuffer(4, 2, [0, 0, 0, 255]);
  setPixel(aliasBuf1, 0, 0, [95, 95, 95, 255]);
  setPixel(aliasBuf1, 1, 0, [95, 95, 95, 255]);
  PixelatorEngine.quantize(aliasBuf1, bwPalette, { ditherType: 'sierra3', ditherAmount: 1.0 });
  assert.deepStrictEqual(getPixel(aliasBuf1, 1, 0), [255, 255, 255, 255], 'sierra3 alias works');

  const aliasBuf2 = createBuffer(4, 2, [0, 0, 0, 255]);
  setPixel(aliasBuf2, 0, 0, [95, 95, 95, 255]);
  setPixel(aliasBuf2, 1, 0, [95, 95, 95, 255]);
  PixelatorEngine.quantize(aliasBuf2, bwPalette, { ditherType: 'sierra2', ditherAmount: 1.0 });
  assert.deepStrictEqual(getPixel(aliasBuf2, 1, 0), [255, 255, 255, 255], 'sierra2 alias works');

  const aliasBuf3 = createBuffer(4, 2, [0, 0, 0, 255]);
  setPixel(aliasBuf3, 0, 0, [95, 95, 95, 255]);
  setPixel(aliasBuf3, 1, 0, [95, 95, 95, 255]);
  PixelatorEngine.quantize(aliasBuf3, bwPalette, { ditherType: 'sierralite', ditherAmount: 1.0 });
  assert.deepStrictEqual(getPixel(aliasBuf3, 1, 0), [255, 255, 255, 255], 'sierralite alias works');

  // 6. Test ditherAmount: 0.0 means no error diffusion (snaps identical to 'none')
  const bTestZero = createBuffer(4, 2, [115, 115, 115, 255]);
  setPixel(bTestZero, 0, 0, [95, 95, 95, 255]);
  const bExpectedNone = createBuffer(4, 2, [115, 115, 115, 255]);
  setPixel(bExpectedNone, 0, 0, [95, 95, 95, 255]);
  PixelatorEngine.quantize(bExpectedNone, bwPalette, { ditherType: 'none' });

  for (const dt of ['burkes', 'sierra-3', 'sierra-2', 'sierra-lite']) {
    const bCopy = createBuffer(4, 2);
    bCopy.data.set(bTestZero.data);
    PixelatorEngine.quantize(bCopy, bwPalette, { ditherType: dt, ditherAmount: 0.0 });
    assert.deepStrictEqual(bCopy.data, bExpectedNone.data, `${dt} with ditherAmount 0.0 should match 'none'`);
  }

  // 7. End-to-end integration via process()
  for (const dt of ['burkes', 'sierra-3', 'sierra-2', 'sierra-lite']) {
    const res = PixelatorEngine.process(canvasSrc, {
      pixelate: 1.0,
      paletteMode: 'preset',
      customPalette: ['#000000', '#ffffff'],
      ditherType: dt,
      ditherAmount: 0.8,
      colorMetric: 'oklab'
    });
    assert.ok(res.canvas, `process() should complete successfully with ${dt}`);
  }

  console.log('  Passed!');
}

// 11. Test Post-Processing Cleanups (Morphological Despeckler & Inking)
{
  console.log('Test 11: Morphological Despeckler & Inking Enhancements');

  // Subtest 11A: Despeckle - isolated 1x1 speckle removed in white field
  const despBuf = createBuffer(5, 5, [255, 255, 255, 255]);
  setPixel(despBuf, 2, 2, [0, 0, 0, 255]); // isolated black pixel
  PixelatorEngine.despeckle(despBuf);
  assert.deepStrictEqual(
    getPixel(despBuf, 2, 2),
    [255, 255, 255, 255],
    'Isolated 1x1 black speckle in white field should be replaced with white'
  );

  // Subtest 11B: Despeckle - 2x1 connected line preserved
  const lineBuf = createBuffer(5, 5, [255, 255, 255, 255]);
  setPixel(lineBuf, 2, 2, [0, 0, 0, 255]);
  setPixel(lineBuf, 3, 2, [0, 0, 0, 255]); // 2x1 connected line
  PixelatorEngine.despeckle(lineBuf);
  assert.deepStrictEqual(
    getPixel(lineBuf, 2, 2),
    [0, 0, 0, 255],
    '2x1 connected line pixel (2,2) must be preserved'
  );
  assert.deepStrictEqual(
    getPixel(lineBuf, 3, 2),
    [0, 0, 0, 255],
    '2x1 connected line pixel (3,2) must be preserved'
  );

  // Subtest 11C: Internal boundary stroke placed on darker side (lower Oklab L*)
  // 4x2 buffer: left 2 columns dark gray (L* ~0.28), right 2 columns light gray (L* ~0.81)
  const bndBuf = createBuffer(4, 2);
  for (let y = 0; y < 2; y++) {
    setPixel(bndBuf, 0, y, [50, 50, 50, 255]);
    setPixel(bndBuf, 1, y, [50, 50, 50, 255]);
    setPixel(bndBuf, 2, y, [200, 200, 200, 255]);
    setPixel(bndBuf, 3, y, [200, 200, 200, 255]);
  }
  PixelatorEngine.addStroke(bndBuf, {
    strokeOnColorsDiff: 0.5,
    strokeColor: '#ff0000',
    strokeOpacity: 1.0
  });
  // Darker side (x=1) should receive stroke (#ff0000)
  assert.deepStrictEqual(
    getPixel(bndBuf, 1, 0),
    [255, 0, 0, 255],
    'Stroke must be placed on darker side of boundary (x=1)'
  );
  // Lighter side (x=2) must NOT receive stroke
  assert.deepStrictEqual(
    getPixel(bndBuf, 2, 0),
    [200, 200, 200, 255],
    'Lighter side of boundary (x=2) must remain unchanged'
  );

  // Subtest 11D: strokeFromPalette selects color with lowest Oklab L*
  const palBuf = createBuffer(3, 3, [0, 0, 0, 0]);
  setPixel(palBuf, 1, 1, [255, 255, 255, 255]); // center opaque
  const palette = ['#ffffff', '#ffcc00', '#003366']; // #003366 is navy, lowest L*
  PixelatorEngine.addStroke(palBuf, {
    stroke: 'outside',
    strokeFromPalette: true,
    customPalette: palette,
    strokeDiagonal: false
  });
  // Orthogonal top neighbor (1, 0) should receive #003366 = [0, 51, 102, 255]
  assert.deepStrictEqual(
    getPixel(palBuf, 1, 0),
    [0, 51, 102, 255],
    'strokeFromPalette should pick darkest color from palette (#003366)'
  );

  // Subtest 11E: Corner double-pixel cleanup (strokeCleanCorners: true)
  // Diagonal staircase with an L-corner double pixel
  const cornerBuf = createBuffer(4, 3, [0, 0, 0, 0]);
  // Place outline pixels forming a diagonal with a 2x2 L-corner:
  // Row 0: . . S .
  // Row 1: . S S .   <- (2,1) forms an L-corner with (2,0) and (1,1)
  // Row 2: S . . .
  setPixel(cornerBuf, 2, 0, [0, 0, 0, 255]);
  setPixel(cornerBuf, 1, 1, [0, 0, 0, 255]);
  setPixel(cornerBuf, 2, 1, [0, 0, 0, 255]);
  setPixel(cornerBuf, 0, 2, [0, 0, 0, 255]);
  PixelatorEngine.addStroke(cornerBuf, {
    strokeColor: '#000000',
    strokeCleanCorners: true
  });
  // Nothing was outlined this pass, so existing image pixels must not be treated as outline
  assert.deepStrictEqual(
    getPixel(cornerBuf, 2, 1),
    [0, 0, 0, 255],
    'Image pixel (2,1) must survive when no stroke was drawn'
  );
  // The authentic diagonal pixels must remain intact
  assert.deepStrictEqual(getPixel(cornerBuf, 2, 0), [0, 0, 0, 255], '(2,0) preserved');
  assert.deepStrictEqual(getPixel(cornerBuf, 1, 1), [0, 0, 0, 255], '(1,1) preserved');
  assert.deepStrictEqual(getPixel(cornerBuf, 0, 2), [0, 0, 0, 255], '(0,2) preserved');

  // Subtest 11F: Enhanced smooth with Oklab deltaE < 0.05 color clustering
  const smoothBuf = createBuffer(3, 3, [200, 100, 50, 255]);
  setPixel(smoothBuf, 0, 0, [201, 100, 50, 255]);
  setPixel(smoothBuf, 1, 0, [200, 101, 50, 255]);
  setPixel(smoothBuf, 2, 0, [201, 101, 50, 255]);
  setPixel(smoothBuf, 0, 1, [200, 100, 51, 255]);
  setPixel(smoothBuf, 2, 1, [201, 100, 51, 255]);
  setPixel(smoothBuf, 0, 2, [200, 101, 51, 255]);
  setPixel(smoothBuf, 1, 2, [201, 101, 51, 255]);
  setPixel(smoothBuf, 2, 2, [202, 100, 50, 255]);
  setPixel(smoothBuf, 1, 1, [50, 50, 50, 255]); // center dark pixel
  PixelatorEngine.smooth(smoothBuf, 1, 1);
  const pCenterSmooth = getPixel(smoothBuf, 1, 1);
  assert.notDeepStrictEqual(
    pCenterSmooth,
    [50, 50, 50, 255],
    'Smooth should cluster perceptually similar neighbor colors and replace center'
  );
  assert.ok(
    pCenterSmooth[0] >= 199 && pCenterSmooth[0] <= 203,
    'Center pixel should become part of the dominant cluster (~200, 100, 50)'
  );

  // Subtest 11G: process() end-to-end integration with despeckle and strokeFromPalette
  const procCanvas = new MockCanvas(5, 5);
  const pCtx = procCanvas.getContext('2d');
  const pBuf = createBuffer(5, 5, [255, 255, 255, 255]);
  setPixel(pBuf, 2, 2, [0, 0, 0, 255]); // isolated speckle
  pCtx.putImageData(pBuf, 0, 0);

  const procResult = PixelatorEngine.process(procCanvas, {
    pixelate: 1.0,
    paletteMode: 'preset',
    customPalette: ['#ffffff', '#000000'],
    despeckle: true,
    stroke: 'outside',
    strokeFromPalette: true
  });
  // Subtest 11H: Despeckle - 1x2 vertical line preserved & transparent field despeckle
  const vertBuf = createBuffer(5, 5, [255, 255, 255, 255]);
  setPixel(vertBuf, 2, 2, [0, 0, 0, 255]);
  setPixel(vertBuf, 2, 3, [0, 0, 0, 255]); // 1x2 vertical line
  PixelatorEngine.despeckle(vertBuf);
  assert.deepStrictEqual(getPixel(vertBuf, 2, 2), [0, 0, 0, 255], '1x2 vertical pixel (2,2) preserved');
  assert.deepStrictEqual(getPixel(vertBuf, 2, 3), [0, 0, 0, 255], '1x2 vertical pixel (2,3) preserved');

  const transBuf = createBuffer(3, 3, [0, 0, 0, 0]);
  setPixel(transBuf, 1, 1, [255, 0, 0, 255]); // isolated in transparent field
  PixelatorEngine.despeckle(transBuf);
  assert.deepStrictEqual(getPixel(transBuf, 1, 1), [0, 0, 0, 0], 'Isolated pixel in transparent field should become transparent');

  // Subtest 11I: strokeCleanCorners preserves straight lines and T-junctions
  const tjBuf = createBuffer(4, 3, [0, 0, 0, 0]);
  // T-junction: horizontal line at y=0, vertical stem at x=1
  setPixel(tjBuf, 0, 0, [0, 0, 0, 255]);
  setPixel(tjBuf, 1, 0, [0, 0, 0, 255]);
  setPixel(tjBuf, 2, 0, [0, 0, 0, 255]);
  setPixel(tjBuf, 1, 1, [0, 0, 0, 255]);
  PixelatorEngine.addStroke(tjBuf, { strokeColor: '#000000', strokeCleanCorners: true });
  assert.deepStrictEqual(getPixel(tjBuf, 1, 0), [0, 0, 0, 255], 'T-junction intersection must be preserved');
  assert.deepStrictEqual(getPixel(tjBuf, 0, 0), [0, 0, 0, 255], 'T-junction left must be preserved');
  assert.deepStrictEqual(getPixel(tjBuf, 2, 0), [0, 0, 0, 255], 'T-junction right must be preserved');
  assert.deepStrictEqual(getPixel(tjBuf, 1, 1), [0, 0, 0, 255], 'T-junction stem must be preserved');

  console.log('  Passed!');
}

// 12. Test Dynamic Pixelate Factor Calculation & Target Resolution
{
  console.log('Test 12: Dynamic Pixelate Factor Calculation');

  // Subtest 12A: 1024x1024 with target 160 -> round(1024/160 * 2) / 2 = 6.5
  assert.strictEqual(PixelatorEngine.calculatePixelateFactor(1024, 1024, 160), 6.5);

  // Subtest 12B: 1024x768 landscape with target 256 -> 1024/256 = 4.0
  assert.strictEqual(PixelatorEngine.calculatePixelateFactor(1024, 768, 256), 4.0);

  // Subtest 12C: 4000x3000 photo with target 160 -> 4000/160 = 25.0
  assert.strictEqual(PixelatorEngine.calculatePixelateFactor(4000, 3000, 160), 25.0);

  // Subtest 12D: Smaller than target: 96x96 with target 160 -> clamped to 1.0 (1:1 native)
  assert.strictEqual(PixelatorEngine.calculatePixelateFactor(96, 96, 160), 1.0);

  // Subtest 12E: 32x32 tiny sprite with target 128 -> clamped to 1.0 (1:1 native)
  assert.strictEqual(PixelatorEngine.calculatePixelateFactor(32, 32, 128), 1.0);

  // Subtest 12F: downsampleCanvas with targetResolution option
  const src = new MockCanvas(1024, 1024);
  const downsampled = PixelatorEngine.downsampleCanvas(src, { targetResolution: 160 });
  // effective factor is 6.5, subW = floor(1024 / 6.5) = 157
  assert.strictEqual(downsampled.subW, 157);
  assert.strictEqual(downsampled.subH, 157);

  // Subtest 12G: 1024x1024 sample image with target 128 -> 1024/128 = 8.0
  assert.strictEqual(PixelatorEngine.calculatePixelateFactor(1024, 1024, 128), 8.0);

  // Subtest 12H: 500x500 image with target 128 -> round(500/128 * 2) / 2 = 4.0
  assert.strictEqual(PixelatorEngine.calculatePixelateFactor(500, 500, 128), 4.0);

  // Subtest 12I: 1024x1024 sample image with target 256 -> 1024/256 = 4.0
  assert.strictEqual(PixelatorEngine.calculatePixelateFactor(1024, 1024, 256), 4.0);
  assert.strictEqual(PixelatorEngine.calculatePixelateFactor(1024, 1024), 4.0);

  console.log('  Passed!');
}

// 13. Test CIEDE2000 & CIELAB Color Science
{
  console.log('Test 13: CIEDE2000 & CIELAB Color Science');

  // Subtest 13A: rgbToLab conversions
  const blackLab = PixelatorEngine.rgbToLab(0, 0, 0);
  assert.ok(Math.abs(blackLab[0] - 0.0) < 1e-3, `Black L* should be ~0, got ${blackLab[0]}`);
  assert.ok(Math.abs(blackLab[1] - 0.0) < 1e-3, `Black a* should be ~0, got ${blackLab[1]}`);
  assert.ok(Math.abs(blackLab[2] - 0.0) < 1e-3, `Black b* should be ~0, got ${blackLab[2]}`);

  const whiteLab = PixelatorEngine.rgbToLab(255, 255, 255);
  assert.ok(Math.abs(whiteLab[0] - 100.0) < 0.1, `White L* should be ~100, got ${whiteLab[0]}`);
  assert.ok(Math.abs(whiteLab[1] - 0.0) < 0.1, `White a* should be ~0, got ${whiteLab[1]}`);
  assert.ok(Math.abs(whiteLab[2] - 0.0) < 0.1, `White b* should be ~0, got ${whiteLab[2]}`);

  const redLab = PixelatorEngine.rgbToLab(255, 0, 0);
  assert.ok(Math.abs(redLab[0] - 53.24) < 0.5, `Red L* should be ~53.24, got ${redLab[0]}`);
  assert.ok(Math.abs(redLab[1] - 80.09) < 0.5, `Red a* should be ~80.09, got ${redLab[1]}`);
  assert.ok(Math.abs(redLab[2] - 67.20) < 0.5, `Red b* should be ~67.20, got ${redLab[2]}`);

  // Subtest 13B: CIEDE2000 color distance
  const dSelf = PixelatorEngine.ciede2000(50, 20, 30, 50, 20, 30);
  assert.strictEqual(dSelf, 0, 'Distance to self must be 0');

  // Sharma 2005 reference test pair 1
  const dSharma1 = PixelatorEngine.ciede2000(50.0, 2.6772, -79.7751, 50.0, 0.0, -82.7485);
  assert.ok(Math.abs(dSharma1 - 2.0425) < 0.001, `Sharma pair 1 expected ~2.0425, got ${dSharma1}`);

  // Sharma 2005 reference test pair 2
  const dSharma2 = PixelatorEngine.ciede2000(50.0, 3.1571, -77.2803, 50.0, 0.0, -82.7485);
  assert.ok(Math.abs(dSharma2 - 2.8615) < 0.001, `Sharma pair 2 expected ~2.8615, got ${dSharma2}`);

  // Sharma 2005 reference test pair (near zero chroma / hue discontinuity)
  const dSharma3 = PixelatorEngine.ciede2000(50.0, 2.4900, -0.0010, 50.0, -2.4900, 0.0009);
  assert.ok(Math.abs(dSharma3 - 7.1792) < 0.001, `Sharma pair expected ~7.1792, got ${dSharma3}`);

  // Subtest 13C: quantize with colorMetric: 'ciede2000'
  const palette = ['#000000', '#ffffff', '#ff0000'];
  const buf = createBuffer(3, 1);
  setPixel(buf, 0, 0, [10, 10, 10, 255]);     // near black
  setPixel(buf, 1, 0, [245, 245, 245, 255]); // near white
  setPixel(buf, 2, 0, [240, 20, 15, 255]);   // near red
  PixelatorEngine.quantize(buf, palette, { colorMetric: 'ciede2000', ditherType: 'none' });
  assert.deepStrictEqual(getPixel(buf, 0, 0), [0, 0, 0, 255], 'Pixel 0 should snap to black under CIEDE2000');
  assert.deepStrictEqual(getPixel(buf, 1, 0), [255, 255, 255, 255], 'Pixel 1 should snap to white under CIEDE2000');
  assert.deepStrictEqual(getPixel(buf, 2, 0), [255, 0, 0, 255], 'Pixel 2 should snap to red under CIEDE2000');

  // Subtest 13D: process() end-to-end integration with CIEDE2000
  const canvasSrc = new MockCanvas(4, 4);
  const cCtx = canvasSrc.getContext('2d');
  const cBuf = createBuffer(4, 4, [240, 20, 15, 255]);
  cCtx.putImageData(cBuf, 0, 0);

  const procRes = PixelatorEngine.process(canvasSrc, {
    pixelate: 1.0,
    paletteMode: 'preset',
    customPalette: ['#000000', '#ffffff', '#ff0000'],
    ditherType: 'none',
    colorMetric: 'ciede2000'
  });
  assert.ok(procRes.canvas, 'process() should complete successfully with ciede2000');

  console.log('  Passed!');
}

// 14. Test Viewport Pan, Zoom & Pixel Grid
{
  console.log('Test 14: Viewport Pan, Zoom & Pixel Grid');

  const state = {
    zoom: 1.0,
    panX: 50,
    panY: -30,
    sourceImage: { width: 100, height: 100 },
    sourceCanvas: { width: 100, height: 100 },
    viewMode: 'side'
  };

  const viewportArea = {
    clientWidth: 1200,
    clientHeight: 800,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 })
  };

  function updateTransform() {}

  function zoomIn() {
    state.zoom = Math.min(32.0, state.zoom * 1.25);
    updateTransform();
  }

  function zoomOut() {
    state.zoom = Math.max(0.05, state.zoom * 0.8);
    updateTransform();
  }

  function zoomAt(zoomFactor, clientX, clientY) {
    const newZoom = Math.max(0.05, Math.min(32.0, state.zoom * zoomFactor));
    if (newZoom === state.zoom) return;

    if (viewportArea && typeof viewportArea.getBoundingClientRect === 'function') {
      const rect = viewportArea.getBoundingClientRect();
      const mouseX = clientX - rect.left - rect.width / 2;
      const mouseY = clientY - rect.top - rect.height / 2;

      const effectiveFactor = newZoom / state.zoom;
      state.panX -= (mouseX - state.panX) * (effectiveFactor - 1);
      state.panY -= (mouseY - state.panY) * (effectiveFactor - 1);
    }

    state.zoom = newZoom;
    updateTransform();
  }

  // 14A: Zoom in / out steps
  zoomIn();
  assert.strictEqual(state.zoom, 1.25, 'Zoom in should multiply scale by 1.25');
  assert.strictEqual(state.panX, 50, 'Zoom in should preserve panX');

  zoomOut();
  assert.strictEqual(state.zoom, 1.0, 'Zoom out should multiply scale by 0.8');
  assert.strictEqual(state.panX, 50, 'Zoom out should preserve panX');

  // 14B: Max clamp (32.0) and over-zoom pan lock
  state.zoom = 30.0;
  zoomIn();
  assert.strictEqual(state.zoom, 32.0, 'Max zoom must be clamped at 32.0');

  // Attempting to zoom in further must NOT modify pan (fixes over zoom memory leak / runaway pan)
  state.panX = 100;
  state.panY = 75;
  zoomAt(1.2, 400, 300);
  assert.strictEqual(state.zoom, 32.0, 'Zoom must remain at 32.0');
  assert.strictEqual(state.panX, 100, 'PanX must remain 100 when over-zoomed');
  assert.strictEqual(state.panY, 75, 'PanY must remain 75 when over-zoomed');

  // 14C: Min clamp (0.05) and under-zoom pan lock
  state.zoom = 0.05;
  zoomAt(0.833, 400, 300);
  assert.strictEqual(state.zoom, 0.05, 'Zoom must remain at 0.05');
  assert.strictEqual(state.panX, 100, 'PanX must remain locked when zoom is at min limit');
  assert.strictEqual(state.panY, 75, 'PanY must remain locked when zoom is at min limit');

  // 14D: Effective factor pan adjustment accuracy
  state.zoom = 1.0;
  state.panX = 0;
  state.panY = 0;
  // Center is (600, 400), cursor at (700, 450) -> mouseX = 100, mouseY = 50
  // Effective factor = 2.0 / 1.0 = 2.0 -> panX = 0 - (100 - 0) * (2 - 1) = -100
  zoomAt(2.0, 700, 450);
  assert.strictEqual(state.zoom, 2.0, 'Zoom should become 2.0');
  assert.strictEqual(state.panX, -100, 'PanX must accurately adjust using effectiveFactor');
  assert.strictEqual(state.panY, -50, 'PanY must accurately adjust using effectiveFactor');

  // 14E: Pixel grid canvas bounds strictly limited to viewport
  const gridCanvas = { width: 0, height: 0, style: { display: 'none' } };
  const gridCtx = { clearRect: () => {} };
  function renderPixelGrids() {
    if (!gridCanvas || !gridCtx || !viewportArea) return;
    const showGrid = state.zoom >= 8.0 && state.sourceImage && state.sourceCanvas;
    if (!showGrid) {
      gridCanvas.style.display = 'none';
      return;
    }
    const vpW = viewportArea.clientWidth;
    const vpH = viewportArea.clientHeight;
    if (vpW <= 0 || vpH <= 0) {
      gridCanvas.style.display = 'none';
      return;
    }
    if (gridCanvas.width !== vpW || gridCanvas.height !== vpH) {
      gridCanvas.width = vpW;
      gridCanvas.height = vpH;
    }
    gridCanvas.style.display = 'block';
    gridCtx.clearRect(0, 0, vpW, vpH);
  }

  state.zoom = 32.0;
  renderPixelGrids();
  assert.strictEqual(gridCanvas.width, 1200, 'Grid canvas width must match viewport width, not 32x image size');
  assert.strictEqual(gridCanvas.height, 800, 'Grid canvas height must match viewport height, not 32x image size');
  assert.strictEqual(gridCanvas.style.display, 'block', 'Grid canvas should be visible at 32x');

  state.zoom = 4.0;
  renderPixelGrids();
  assert.strictEqual(gridCanvas.style.display, 'none', 'Grid canvas should be hidden below 8x');

  console.log('  Passed!');
}

// --- Test 15: Dual-Mode Palette Extraction (Lossless <= 256 & Quantized > 256) ---
console.log('Test 15: Dual-Mode Palette Extraction');
{
  // 15A: Lossless extraction for swatch strips (<= 256 colors)
  const swatchBuf = createBuffer(4, 1);
  setPixel(swatchBuf, 0, 0, [255, 255, 255, 255]); // White
  setPixel(swatchBuf, 1, 0, [0, 0, 0, 255]);       // Black
  setPixel(swatchBuf, 2, 0, [255, 0, 0, 255]);     // Red
  setPixel(swatchBuf, 3, 0, [0, 255, 0, 255]);     // Green

  const extracted = PixelatorEngine.extractPalette(swatchBuf, 256);
  assert.strictEqual(extracted.length, 4, 'Should losslessly preserve exact 4 colors');
  assert.ok(extracted.includes('#000000'), 'Should contain black');
  assert.ok(extracted.includes('#ffffff'), 'Should contain white');
  assert.ok(extracted.includes('#ff0000'), 'Should contain red');
  assert.ok(extracted.includes('#00ff00'), 'Should contain green');

  // Verify sorted monotonically by Oklab perceptual lightness (black first, white last)
  assert.strictEqual(extracted[0], '#000000', 'Black must be first due to lowest Oklab lightness');
  assert.strictEqual(extracted[extracted.length - 1], '#ffffff', 'White must be last due to highest Oklab lightness');

  // 15B: Transparent pixels are ignored
  const transBuf = createBuffer(3, 1);
  setPixel(transBuf, 0, 0, [255, 0, 0, 255]);
  setPixel(transBuf, 1, 0, [0, 255, 0, 30]);  // alpha <= 64 -> ignored
  setPixel(transBuf, 2, 0, [0, 0, 255, 0]);   // transparent -> ignored
  const transExtracted = PixelatorEngine.extractPalette(transBuf, 256);
  assert.strictEqual(transExtracted.length, 1, 'Should only extract opaque colors');
  assert.strictEqual(transExtracted[0], '#ff0000');

  // 15C: High-color continuous tone buffer (> 256 colors) is automatically quantized to <= 256 colors
  const highColorBuf = createBuffer(64, 64); // 4096 pixels
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      setPixel(highColorBuf, x, y, [(x * 4) % 256, (y * 4) % 256, ((x + y) * 2) % 256, 255]);
    }
  }

  const quantExtracted = PixelatorEngine.extractPalette(highColorBuf, 256);
  assert.ok(quantExtracted.length > 0 && quantExtracted.length <= 256, `Extracted count (${quantExtracted.length}) must be <= 256`);
  for (const hex of quantExtracted) {
    assert.match(hex, /^#[0-9a-f]{6}$/i, `Color ${hex} must be a valid hex string`);
  }

  // Verify Oklab lightness sorting on quantized result
  for (let i = 0; i < quantExtracted.length - 1; i++) {
    const c1 = PixelatorEngine.hexToRgba(quantExtracted[i]);
    const c2 = PixelatorEngine.hexToRgba(quantExtracted[i + 1]);
    const l1 = PixelatorEngine.rgbToOklab(c1[0], c1[1], c1[2])[0];
    const l2 = PixelatorEngine.rgbToOklab(c2[0], c2[1], c2[2])[0];
    assert.ok(l1 <= l2 + 1e-5, `Palette should be sorted by lightness: ${l1} <= ${l2}`);
  }

  console.log('  Passed!');
}

// --- Test 16: Palette Subsampling (samplePalette) & Custom Palette Slicing ---
console.log('Test 16: Palette Subsampling & Custom Palette Slicing');
{
  // 16A: samplePalette boundaries and striding
  const palette16 = [
    'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7',
    'c8', 'c9', 'c10', 'c11', 'c12', 'c13', 'c14', 'c15'
  ];

  const resFull = PixelatorEngine.samplePalette(palette16, 16);
  const resOver = PixelatorEngine.samplePalette(palette16, 20);
  const resEmpty = PixelatorEngine.samplePalette(palette16, 0);
  const resNeg = PixelatorEngine.samplePalette(palette16, -1);
  const resNull = PixelatorEngine.samplePalette(null, 4);
  const res1 = PixelatorEngine.samplePalette(palette16, 1);
  const res2 = PixelatorEngine.samplePalette(palette16, 2);
  const res4 = PixelatorEngine.samplePalette(palette16, 4);

  assert.strictEqual(resFull.length, 16);
  assert.notStrictEqual(resFull, palette16, 'Should return a shallow copy');
  assert.strictEqual(resOver.length, 16);
  assert.deepStrictEqual(resEmpty, []);
  assert.deepStrictEqual(resNeg, []);
  assert.deepStrictEqual(resNull, []);
  assert.deepStrictEqual(res1, ['c0']);
  // 2 colors preserves darkest and lightest endpoints
  assert.deepStrictEqual(res2, ['c0', 'c15']);
  // 4 colors evenly strides across 16 elements (indices 0, 5, 10, 15)
  assert.deepStrictEqual(res4, ['c0', 'c5', 'c10', 'c15']);

  // 16B: PixelatorEngine.process with custom palette and paletteColors slicing
  const hexPalette16 = [
    '#000000', '#111111', '#222222', '#333333',
    '#444444', '#555555', '#666666', '#777777',
    '#888888', '#999999', '#aaaaaa', '#bbbbbb',
    '#cccccc', '#dddddd', '#eeeeee', '#ffffff'
  ];

  const testCanvas = new MockCanvas(8, 8);
  // Fill canvas with various grayscale values
  for (let i = 0; i < 8 * 8; i++) {
    testCanvas._data[i * 4] = (i * 4) % 256;
    testCanvas._data[i * 4 + 1] = (i * 4) % 256;
    testCanvas._data[i * 4 + 2] = (i * 4) % 256;
    testCanvas._data[i * 4 + 3] = 255;
  }

  const resProcess4 = PixelatorEngine.process(testCanvas, {
    pixelate: 1.0,
    paletteMode: 'custom',
    customPalette: hexPalette16,
    paletteColors: 4,
    ditherType: 'none'
  });

  assert.strictEqual(resProcess4.paletteCount, 4, 'Engine paletteCount must reflect sliced count (4)');
  const expected4 = PixelatorEngine.samplePalette(hexPalette16, 4);
  assert.deepStrictEqual(expected4, ['#000000', '#555555', '#aaaaaa', '#ffffff']);

  const resProcessFull = PixelatorEngine.process(testCanvas, {
    pixelate: 1.0,
    paletteMode: 'custom',
    customPalette: hexPalette16,
    paletteColors: 16,
    ditherType: 'none'
  });
  assert.strictEqual(resProcessFull.paletteCount, 16, 'Engine paletteCount must reflect full count (16)');

  console.log('  Passed!');
}

{
  console.log('Test 17: Result exposes palette, output size, and lazy upscale');
  const src = new MockCanvas(8, 6);
  for (let i = 0; i < 8 * 6; i++) {
    src._data.set([i < 24 ? 255 : 0, 0, i < 24 ? 0 : 255, 255], i * 4);
  }

  const res = PixelatorEngine.process(src, { pixelate: 2, paletteMode: 'adaptive', paletteColors: 2, ditherType: 'none' });
  assert.strictEqual(res.palette.length, res.paletteCount, 'palette must list every active color');
  assert.ok(res.palette.length > 0, 'adaptive palette must not be empty');
  assert.deepStrictEqual([res.outputWidth, res.outputHeight], [8, 6], 'output size is source size without resize');
  assert.deepStrictEqual([res.canvas.width, res.canvas.height], [8, 6], 'lazy canvas is upscaled to output size');
  assert.strictEqual(res.canvas, res.canvas, 'upscale is built once');

  const native = PixelatorEngine.process(src, { pixelate: 2, resize: true, paletteColors: 2 });
  assert.deepStrictEqual([native.outputWidth, native.outputHeight], [4, 3], 'output size is sprite size with resize');
  assert.strictEqual(native.canvas, native.subCanvas, 'resize returns the sprite canvas itself');
  console.log('  Passed!');
}

{
  console.log('Test 18: Despeckle keeps diagonal structure and picks sensible replacements');
  const A = [255, 255, 255, 255], B = [0, 0, 0, 255], CLEAR = [0, 0, 0, 0];

  // 1px diagonal line touches only at corners; it is a line, not specks
  const diag = createBuffer(5, 5, A);
  for (let i = 0; i < 5; i++) setPixel(diag, i, i, B);
  PixelatorEngine.despeckle(diag);
  for (let i = 0; i < 5; i++) assert.deepStrictEqual(getPixel(diag, i, i), B, `diagonal pixel (${i},${i}) preserved`);

  // Checkerboard dither must survive untouched (old 4-neighbor rule inverted it)
  const checker = createBuffer(4, 4, A);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) setPixel(checker, x, y, B);
  PixelatorEngine.despeckle(checker);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    assert.deepStrictEqual(getPixel(checker, x, y), (x + y) % 2 ? B : A, `checker (${x},${y}) preserved`);
  }

  // 1px bump on a sprite edge, mostly surrounded by transparency, is removed rather than recolored
  const bump = createBuffer(3, 3, CLEAR);
  for (let y = 0; y < 3; y++) setPixel(bump, 0, y, [0, 255, 0, 255]);
  setPixel(bump, 1, 1, [255, 0, 0, 255]);
  PixelatorEngine.despeckle(bump);
  assert.deepStrictEqual(getPixel(bump, 1, 1), CLEAR, 'edge bump becomes transparent');
  assert.deepStrictEqual(getPixel(bump, 0, 1), [0, 255, 0, 255], 'sprite edge itself untouched');

  // Tied neighbor votes go to the color closest to the speck, not to whichever was scanned first
  const ORANGE = [255, 128, 0, 255], BLUE = [0, 0, 255, 255];
  const tie = createBuffer(3, 3, BLUE);
  setPixel(tie, 1, 2, ORANGE); setPixel(tie, 2, 1, ORANGE); setPixel(tie, 2, 2, ORANGE); setPixel(tie, 0, 2, ORANGE);
  setPixel(tie, 1, 1, [255, 0, 0, 255]);
  PixelatorEngine.despeckle(tie);
  assert.deepStrictEqual(getPixel(tie, 1, 1), ORANGE, 'red speck takes the closer tied color (orange)');
  console.log('  Passed!');
}

{
  console.log('Test 19: Algorithm review fixes');
  const make = (w, h, f) => {
    const b = createBuffer(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(b, x, y, f(x, y));
    return b;
  };
  const okDist = (c1, c2) => {
    const l1 = PixelatorEngine.rgbToOklab(c1[0], c1[1], c1[2]);
    const l2 = PixelatorEngine.rgbToOklab(c2[0], c2[1], c2[2]);
    return Math.sqrt(PixelatorEngine.colorDistOklabSq(l1[0], l1[1], l1[2], l2[0], l2[1], l2[2]));
  };
  const levels = (b) => [...new Set(Array.from({ length: b.width * b.height }, (_, i) => b.data.slice(i * 4, i * 4 + 3).join(',')))];

  // 95% dark grey with sparse vivid noise: the grey must survive palette reduction
  const greyScene = () => make(200, 200, (x, y) => ((x * 7 + y * 13) % 20 === 0
    ? [(x * 37) % 256, (y * 91) % 256, (x * y) % 256, 255] : [40 + (x % 3), 40, 40, 255]));
  const hasGrey = (pal) => pal.some((c) => okDist(c, [41, 40, 40]) < 0.03);
  assert.ok(hasGrey(PixelatorEngine.buildKMeansFastPalette(greyScene(), 4)), 'K-Means fast keeps the dominant grey');

  // Box downsample weights color by alpha: transparent black must not darken edges
  const edge = make(4, 1, (x) => (x < 2 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  const ds = PixelatorEngine.downsampleBuffer(edge, 4 / 3, 'box', false);
  assert.deepStrictEqual(getPixel(ds, 1, 0), [255, 255, 255, 128], 'half-covered edge pixel stays white at half alpha');

  // Every pixel maps to its true nearest palette color (no coarse cache bins)
  const grad = () => make(256, 256, (x, y) => [x, y, (x + y) >> 1, 255]);
  const pal64 = PixelatorEngine.buildWuPalette(grad(), 64);
  const q = grad();
  PixelatorEngine.quantize(q, pal64, { ditherType: 'none' });
  const src = grad();
  for (let i = 0; i < 256 * 256; i++) {
    const c = Array.from(src.data.slice(i * 4, i * 4 + 3));
    const best = Math.min(...pal64.map((p) => okDist(c, p)));
    assert.ok(okDist(c, Array.from(q.data.slice(i * 4, i * 4 + 3))) <= best + 1e-9, `pixel ${i} mapped to nearest color`);
  }

  // Bayer blends a few nearby palette colors so the pattern, averaged as light, looks like the target,
  // whatever the palette size or hue
  const flat = (rgb) => make(16, 16, () => [...rgb, 255]);
  const blendError = (b, rgb) => {
    const sum = [0, 0, 0];
    for (let i = 0; i < b.width * b.height; i++) for (let c = 0; c < 3; c++) sum[c] += PixelatorEngine.sRGBtoLinear[b.data[i * 4 + c]];
    const avg = sum.map((v) => PixelatorEngine.linearToSRGB(v / (b.width * b.height)));
    return okDist(avg, rgb);
  };
  for (const n of [4, 64]) {
    const greys = Array.from({ length: n }, (_, i) => { const v = Math.round(i * 255 / (n - 1)); return [v, v, v]; });
    const b = flat([128, 128, 128]);
    PixelatorEngine.quantize(b, greys, { ditherType: 'bayer4', ditherAmount: 1 });
    assert.ok(levels(b).length >= 2 && levels(b).length <= 3, `${n}-grey palette: flat grey mixes 2-3 levels (${levels(b).length})`);
    assert.ok(blendError(b, [128, 128, 128]) < 0.01, `${n}-grey palette: blend looks like the target grey`);
  }
  const rg = flat([188, 92, 0]); // linear-light midpoint of red and green
  PixelatorEngine.quantize(rg, [[255, 0, 0], [0, 128, 0]], { ditherType: 'bayer4', ditherAmount: 1 });
  assert.strictEqual(levels(rg).length, 2, 'Bayer blends colors of differing hue');

  // Out-of-palette tones (purple on Game Boy Color) are judged by how the blend looks, not by linear-RGB
  // distance, which over-weights bright channels and lands visibly further off
  const gbcPalette = require('../assets/palettes/palettes.json').GAMEBOY_COLOR;
  const purple = make(4, 4, () => [90, 70, 150, 255]);
  PixelatorEngine.quantize(purple, gbcPalette, { ditherType: 'bayer4', ditherAmount: 1 });
  const purpleErr = blendError(purple, [90, 70, 150]);
  assert.ok(purpleErr < 0.078, `purple blend on GBC palette looks close (${purpleErr.toFixed(4)})`);

  // Faint pixels are quantized too
  const faint = make(1, 1, () => [10, 200, 30, 20]);
  PixelatorEngine.quantize(faint, [[0, 0, 0], [255, 255, 255]], { ditherType: 'none' });
  assert.deepStrictEqual(getPixel(faint, 0, 0), [255, 255, 255, 20], 'alpha 20 pixel snapped to palette');

  // Left/right stroke land on the named edge
  for (const [side, strokedX, plainX] of [['left', 2, 3], ['right', 3, 2]]) {
    const blk = make(6, 3, (x) => (x >= 2 && x <= 3 ? [200, 200, 200, 255] : [0, 0, 0, 0]));
    PixelatorEngine.addStroke(blk, { stroke: side, strokeOpacity: 1, strokeColor: '#ff0000' });
    assert.deepStrictEqual(getPixel(blk, strokedX, 1), [255, 0, 0, 255], `${side} stroke on x=${strokedX}`);
    assert.deepStrictEqual(getPixel(blk, plainX, 1), [200, 200, 200, 255], `${side} stroke leaves x=${plainX}`);
  }

  // Corner cleanup still trims the outline it just drew
  const dot = make(5, 5, (x, y) => (x === 2 && y === 2 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  PixelatorEngine.addStroke(dot, { stroke: 'outside', strokeOpacity: 1, strokeColor: '#000000', strokeDiagonal: true, strokeCleanCorners: true });
  assert.deepStrictEqual(getPixel(dot, 1, 1), [0, 0, 0, 0], 'diagonal corner of fresh outline cleaned');
  assert.deepStrictEqual(getPixel(dot, 2, 1), [0, 0, 0, 255], 'orthogonal outline kept');

  // Saturation: 0 means greyscale, boosting keeps perceived lightness
  const sat0 = make(1, 1, () => [200, 80, 40, 255]);
  PixelatorEngine.enhanceColors(sat0, 0);
  const g0 = getPixel(sat0, 0, 0);
  assert.ok(Math.abs(g0[0] - g0[1]) <= 1 && Math.abs(g0[1] - g0[2]) <= 1, 'saturation 0 is grey');
  const boost = make(1, 1, () => [100, 100, 160, 255]);
  PixelatorEngine.enhanceColors(boost, 1.5);
  const before = PixelatorEngine.rgbToOklab(100, 100, 160)[0];
  const afterPx = getPixel(boost, 0, 0);
  const after = PixelatorEngine.rgbToOklab(afterPx[0], afterPx[1], afterPx[2])[0];
  assert.ok(Math.abs(after - before) < 0.01, `boost keeps lightness (${before.toFixed(3)} -> ${after.toFixed(3)})`);

  // Strong smoothing must not eat straight edges or corners of solid shapes
  const square = make(8, 8, (x, y) => (x >= 1 && x <= 6 && y >= 1 && y <= 6 ? [90, 60, 200, 255] : [0, 0, 0, 0]));
  PixelatorEngine.smooth(square, 8, 1);
  assert.strictEqual(getPixel(square, 3, 1)[3], 255, 'straight edge survives smoothing 8');
  assert.strictEqual(getPixel(square, 1, 1)[3], 255, 'corner survives smoothing 8');
  console.log('  Passed!');
}

// --- Hardware Limits: pixelAspect, colorDepth, limitTileColors ---
console.log('\n[Test] Hardware limits');
{
  // Wide pixels: horizontal factor = pixelate * pixelAspect
  const wide = PixelatorEngine.downsampleBuffer(createBuffer(280, 192, [10, 20, 30, 255]), 1, 'box', true, 2);
  assert.strictEqual(wide.width, 140, 'pixelAspect 2 halves width');
  assert.strictEqual(wide.height, 192, 'pixelAspect leaves height');

  // Bit depth snaps channels to 2^bits evenly spaced levels and dedupes
  assert.deepStrictEqual(
    PixelatorEngine.snapPaletteDepth(['#5a0bf0', '#560000', '#ffffff', '#fefefe'], 2),
    ['#5500ff', '#550000', '#ffffff']
  );
  // Adaptive palettes are [r, g, b] arrays; format is preserved
  assert.deepStrictEqual(
    PixelatorEngine.snapPaletteDepth([[90, 11, 240], [254, 254, 254], [255, 255, 255]], 2),
    [[85, 0, 255], [255, 255, 255]]
  );

  // Tile limit keeps the most-used colors per tile and remaps the rest to the nearest kept one
  const RED = [255, 0, 0, 255], DARKRED = [200, 0, 0, 255], BLUE = [0, 0, 255, 255];
  const tiles = createBuffer(4, 2, RED);
  setPixel(tiles, 0, 0, DARKRED);          // tile 0: 3 red + 1 dark red
  setPixel(tiles, 2, 0, BLUE);             // tile 1: 2 blue + 1 dark red + 1 transparent
  setPixel(tiles, 3, 0, BLUE);
  setPixel(tiles, 2, 1, DARKRED);
  setPixel(tiles, 3, 1, [0, 0, 0, 0]);     // transparent pixels don't count or change
  PixelatorEngine.limitTileColors(tiles, 2, 1);
  assert.deepStrictEqual(getPixel(tiles, 0, 0), RED, 'minority color remapped in tile 0');
  assert.deepStrictEqual(getPixel(tiles, 2, 1), BLUE, 'tile 1 collapses to its most used color');
  assert.deepStrictEqual(getPixel(tiles, 3, 1), [0, 0, 0, 0], 'transparent pixel untouched');

  const two = createBuffer(3, 3, RED);    // 6 red, 2 blue, 1 dark red
  setPixel(two, 0, 0, DARKRED);
  setPixel(two, 1, 1, BLUE);
  setPixel(two, 2, 2, BLUE);
  PixelatorEngine.limitTileColors(two, 3, 2);
  assert.deepStrictEqual(getPixel(two, 0, 0), RED, 'dark red maps to nearest kept (red), not blue');
  assert.deepStrictEqual(getPixel(two, 1, 1), BLUE, 'second most used color kept');

  // Shared palettes: tiles must draw from tilePalettes shared sets (GBC 8, NES 4)
  const colorsIn = (buf, x0, x1) => {
    const set = new Set();
    for (let y = 0; y < buf.height; y++) for (let x = x0; x <= x1; x++) set.add(getPixel(buf, x, y).join());
    return set;
  };
  const GREEN = [0, 255, 0, 255], BLACK = [0, 0, 0, 255];
  const mixed = () => {
    const b = createBuffer(6, 2, BLACK);   // tile A (x 0-1): 2 blue + 2 red; tiles at x 2-5: black
    setPixel(b, 0, 0, BLUE); setPixel(b, 1, 0, BLUE);
    setPixel(b, 0, 1, RED); setPixel(b, 1, 1, RED);
    return b;
  };
  const free = mixed();
  PixelatorEngine.limitTileColors(free, 2, 2, 2);
  assert.strictEqual(colorsIn(free, 0, 1).size, 2, 'two palettes: {blue, red} and {black} keep tile A intact');

  const shared = mixed();
  PixelatorEngine.limitTileColors(shared, 2, 2, 2, true);
  const a = colorsIn(shared, 0, 1);
  assert.ok(!(a.has(BLUE.join()) && a.has(RED.join())), 'shared backdrop (black) leaves one slot, so blue and red cannot coexist');

  const one = createBuffer(4, 2, RED);     // tile A: red + blue, tile B: red + green
  setPixel(one, 0, 0, BLUE);
  setPixel(one, 2, 0, GREEN);
  PixelatorEngine.limitTileColors(one, 2, 2, 1);
  assert.ok(colorsIn(one, 0, 3).size <= 2, 'one shared palette caps the whole image at tileColors');
  console.log('  Passed!');
}

// --- Dither regressions: Bayer 8x8 resolution, linear-light error diffusion, shared tile color ---
{
  console.log('Test: Bayer 8x8 resolves 64 levels');
  // Linear 0.1 needs ~6.4/64 white; a 16-entry plan can only place whites in multiples of 4 per 8x8
  const v = PixelatorEngine.linearToSRGB(0.1);
  const buf = createBuffer(8, 8, [v, v, v, 255]);
  PixelatorEngine.quantize(buf, ['#000000', '#ffffff'], { ditherType: 'bayer8', ditherAmount: 1.0 });
  let whites = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (getPixel(buf, x, y)[0] === 255) whites++;
  assert.ok(whites % 4 !== 0, `bayer8 should not collapse to a tiled 4x4 pattern (got ${whites} whites)`);
  console.log('  Passed!');
}

{
  console.log('Test: Error diffusion averages in linear light');
  // sRGB 128 is ~21.6% linear light, so a black/white dither should be ~22% white, not ~50%
  for (const ditherType of ['floyd', 'atkinson']) {
    const buf = createBuffer(64, 64, [128, 128, 128, 255]);
    PixelatorEngine.quantize(buf, ['#000000', '#ffffff'], { ditherType, ditherAmount: 1.0 });
    let whites = 0;
    for (let i = 0; i < buf.data.length; i += 4) if (buf.data[i] === 255) whites++;
    const frac = whites / (64 * 64);
    // Atkinson discards 25% of the error by design, so it only has to land well below the gamma-space ~0.5
    const tol = ditherType === 'atkinson' ? 0.1 : 0.04;
    assert.ok(Math.abs(frac - 0.216) < tol, `${ditherType} white fraction ${frac.toFixed(3)} should be ~0.216`);
  }
  console.log('  Passed!');
}

{
  console.log('Test: Shared tile color holds without shared palettes');
  const BLUE = [0, 0, 255, 255], RED = [255, 0, 0, 255];
  const b = createBuffer(6, 2, [0, 0, 0, 255]);   // tile A: blue + red only; black dominates the image
  setPixel(b, 0, 0, BLUE); setPixel(b, 1, 0, BLUE);
  setPixel(b, 0, 1, RED); setPixel(b, 1, 1, RED);
  PixelatorEngine.limitTileColors(b, 2, 2, 0, true);
  const a = new Set([0, 1].flatMap((y) => [0, 1].map((x) => getPixel(b, x, y).join())));
  assert.ok(!(a.has(BLUE.join()) && a.has(RED.join())), 'a 2-color tile without the shared backdrop must give up one color');
  console.log('  Passed!');
}

{
  console.log('Test: Tile foreground colors limited to an allowed set');
  // VIC-20 hi-res: backdrop may be any color, each cell's other color must come from colors 0-7
  const PINK = [255, 160, 200, 255], RED = [255, 0, 0, 255], WHITE = [255, 255, 255, 255];
  const b = createBuffer(4, 2, [0, 0, 255, 255]);  // blue backdrop (not in the allowed set)
  setPixel(b, 0, 0, PINK); setPixel(b, 1, 0, PINK);  // tile A: blue + pink, pink is not allowed
  PixelatorEngine.limitTileColors(b, 2, 2, 0, true, [RED, WHITE]);
  const a = new Set([0, 1].flatMap((y) => [0, 1].map((x) => getPixel(b, x, y).join())));
  assert.ok(!a.has(PINK.join()), 'pink must be replaced by an allowed foreground color');
  assert.ok(a.has('0,0,255,255'), 'the backdrop stays even though it is outside the allowed set');
  assert.ok([...a].every((c) => c === '0,0,255,255' || c === RED.join() || c === WHITE.join()), 'only backdrop and allowed colors remain');

  const opts = { pixelate: 1, paletteMode: 'preset', customPalette: ['#ff0000', '#ffffff', '#0000ff', '#ffa0c8'], tileSize: 2, tileColors: 2, tileSharedColor: true, tileForeground: 2 };
  const src = new MockCanvas(4, 2);
  const img = createBuffer(4, 2, [0, 0, 255, 255]);
  setPixel(img, 0, 0, PINK);
  src._data.set(img.data);
  const res = PixelatorEngine.process(src, opts);
  assert.notDeepStrictEqual(Array.from(res.subCanvas._data.slice(0, 4)), PINK, 'process passes tileForeground through');
  console.log('  Passed!');
}

{
  console.log('Test: Clean corners thins a diagonal outline without opening gaps');
  // A 45-degree edge gets a 2px staircase from the diagonal outside stroke; cleanup should thin it to 1px
  const W = 10, H = 10;
  const stroked = (clean) => {
    const b = createBuffer(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x <= y; x++) setPixel(b, x, y, [255, 0, 0, 255]);
    PixelatorEngine.addStroke(b, { stroke: 'outside', strokeOpacity: 1, strokeColor: '#ffffff', strokeDiagonal: true, strokeCleanCorners: clean });
    return b;
  };
  const kind = (b, x, y) => { const p = getPixel(b, x, y); return p[3] === 0 ? '.' : p[1] === 255 ? 'S' : '#'; };
  const strokeCount = (b) => { let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (kind(b, x, y) === 'S') n++; return n; };
  const clean = stroked(true);
  let leaks = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (kind(clean, x, y) !== '.') continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && kind(clean, nx, ny) === '#') leaks++;
    }
  }
  assert.strictEqual(leaks, 0, 'no transparent pixel may touch the shape edge-on after cleanup');
  assert.ok(strokeCount(clean) < strokeCount(stroked(false)), 'cleanup still removes the doubled staircase pixels');
  console.log('  Passed!');
}

{
  console.log('Test: Scanline tiles limit colors per row');
  // Atari 2600 playfield: every scanline holds at most 2 colors, but each line may pick different ones
  const R = [255, 0, 0, 255], G = [0, 255, 0, 255], B = [0, 0, 255, 255], Y = [255, 255, 0, 255];
  const rowsOf = (b) => [0, 1].map((y) => new Set([0, 1, 2, 3].map((x) => getPixel(b, x, y).join())));
  const b = createBuffer(4, 2);
  [R, R, G, B].forEach((c, x) => setPixel(b, x, 0, c));
  [Y, Y, Y, G].forEach((c, x) => setPixel(b, x, 1, c));
  PixelatorEngine.limitTileColors(b, 'row', 2);
  const [r0, r1] = rowsOf(b);
  assert.ok(r0.size <= 2 && r1.size <= 2, 'each row keeps at most 2 colors');
  assert.ok(r1.has(Y.join()) && r1.has(G.join()), 'a row already within the limit is untouched');

  const src = new MockCanvas(4, 2);
  const img = createBuffer(4, 2);
  [R, R, G, B].forEach((c, x) => setPixel(img, x, 0, c));
  [Y, Y, Y, G].forEach((c, x) => setPixel(img, x, 1, c));
  src._data.set(img.data);
  const res = PixelatorEngine.process(src, { pixelate: 1, paletteMode: 'preset', customPalette: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'], tileSize: 'row', tileColors: 2 });
  const out = { width: 4, height: 2, data: res.subCanvas._data };
  assert.ok(rowsOf(out).every((s) => s.size <= 2), 'process applies the scanline limit');
  console.log('  Passed!');
}

{
  console.log('Test: countColors counts visible colors up to a limit');
  const b = createBuffer(4, 1);
  setPixel(b, 0, 0, [255, 0, 0, 255]);
  setPixel(b, 1, 0, [255, 0, 0, 128]);
  setPixel(b, 2, 0, [0, 0, 255, 255]);
  setPixel(b, 3, 0, [9, 9, 9, 0]);
  assert.strictEqual(PixelatorEngine.countColors(b, 256), 2, 'alpha is ignored and fully transparent pixels are skipped');
  assert.strictEqual(PixelatorEngine.countColors(b, 1), 1, 'stops counting at the limit');
  console.log('  Passed!');
}

console.log('All unit tests passed successfully!');




