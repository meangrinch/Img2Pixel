/**
 * PixelatorEngine - Standalone Pure JavaScript Image Processing Engine
 * Faithfully ports Ronen Ness's Pixelator algorithms to HTML5 Canvas / TypedArrays.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PixelatorEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- Helper Math & Color Utilities ---

  function hexToRgba(hex) {
    if (!hex || typeof hex !== 'string') return [0, 0, 0, 255];
    let h = hex.trim();
    if (h.startsWith('#')) h = h.slice(1);
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + 'ff';
    } else if (h.length === 6) {
      h = h + 'ff';
    } else if (h.length === 8) {
      // standard #rrggbbaa
    } else {
      return [0, 0, 0, 255];
    }
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    const a = parseInt(h.slice(6, 8), 16);
    return [r, g, b, isNaN(a) ? 255 : a];
  }

  function rgbaToHex(r, g, b, a = 255) {
    const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Weighted color distance (redmean approximation)
  function colorDistSq(r1, g1, b1, r2, g2, b2) {
    const rmean = (r1 + r2) >> 1;
    const r = r1 - r2;
    const g = g1 - g2;
    const b = b1 - b2;
    return (((512 + rmean) * r * r) >> 8) + 4 * g * g + (((767 - rmean) * b * b) >> 8);
  }

  // --- Color Science: Linear RGB & Oklab ---

  const sRGBtoLinear = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    sRGBtoLinear[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSRGB(v) {
    if (v <= 0.0) return 0;
    if (v >= 1.0) return 255;
    const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1.0 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  }

  // Linear-light RGB -> LMS cone response (linear, so averages of colors can be taken here)
  function linearToLmsInto(rLin, gLin, bLin, out, offset = 0) {
    out[offset] = 0.4122214708 * rLin + 0.5363325363 * gLin + 0.0514459929 * bLin;
    out[offset + 1] = 0.2119034982 * rLin + 0.6806995451 * gLin + 0.1073969566 * bLin;
    out[offset + 2] = 0.0883024619 * rLin + 0.2817188376 * gLin + 0.6299787005 * bLin;
    return out;
  }

  // LMS -> Oklab, written into `out` (no allocation; used in hot loops)
  function lmsToOklabInto(l, m, s, out) {
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);
    out[0] = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    out[1] = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    out[2] = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    return out;
  }

  function rgbToOklab(r, g, b) {
    const lms = linearToLmsInto(sRGBtoLinear[r], sRGBtoLinear[g], sRGBtoLinear[b], [0, 0, 0]);
    return lmsToOklabInto(lms[0], lms[1], lms[2], lms);
  }

  function oklabToLinear(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    return [
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
  }

  function oklabToRgb(L, a, b) {
    const [rLin, gLin, bLin] = oklabToLinear(L, a, b);
    return [linearToSRGB(rLin), linearToSRGB(gLin), linearToSRGB(bLin)];
  }

  function colorDistOklabSq(L1, a1, b1, L2, a2, b2) {
    const dL = L1 - L2;
    const da = a1 - a2;
    const db = b1 - b2;
    return dL * dL + da * da + db * db;
  }

  function precomputePaletteOklab(palette) {
    if (!palette) return [];
    return palette.map((col) => {
      let r, g, b;
      if (typeof col === 'string') {
        const rgba = hexToRgba(col);
        r = rgba[0]; g = rgba[1]; b = rgba[2];
      } else if (Array.isArray(col)) {
        r = col[0]; g = col[1]; b = col[2];
      } else if (col && typeof col === 'object') {
        r = col.r; g = col.g; b = col.b;
      } else {
        r = 0; g = 0; b = 0;
      }
      const [L, a, b_] = rgbToOklab(r, g, b);
      return { r, g, b, L, a, b: b_, rgb: [r, g, b] };
    });
  }

  // --- Color Science: CIE L*a*b* (D65) & CIEDE2000 ---

  function rgbToLab(r, g, b) {
    const rLin = sRGBtoLinear[r];
    const gLin = sRGBtoLinear[g];
    const bLin = sRGBtoLinear[b];

    // Convert sRGB to CIE 1931 XYZ (D65 illuminant, 2-degree observer)
    const x = 0.4124564 * rLin + 0.3575761 * gLin + 0.1804375 * bLin;
    const y = 0.2126729 * rLin + 0.7151522 * gLin + 0.0721750 * bLin;
    const z = 0.0193339 * rLin + 0.1191920 * gLin + 0.9503041 * bLin;

    // Normalize for D65 reference white (Xn = 0.95047, Yn = 1.0, Zn = 1.08883)
    const xr = x / 0.95047;
    const yr = y / 1.00000;
    const zr = z / 1.08883;

    // Standard CIE cubic conversion threshold and slope
    const eps = 216 / 24389; // 0.00885645
    const kap = 24389 / 27;  // 903.296

    const fx = xr > eps ? Math.cbrt(xr) : (kap * xr + 16) / 116;
    const fy = yr > eps ? Math.cbrt(yr) : (kap * yr + 16) / 116;
    const fz = zr > eps ? Math.cbrt(zr) : (kap * zr + 16) / 116;

    const L = 116 * fy - 16;
    const a = 500 * (fx - fy);
    const b_ = 200 * (fy - fz);

    return [L, a, b_];
  }

  // CIEDE2000 color difference formula (Sharma, Wu, Dalal 2005)
  function ciede2000(L1, a1, b1, L2, a2, b2, kL = 1, kC = 1, kH = 1) {
    if (L1 === L2 && a1 === a2 && b1 === b2) return 0;

    const rad2deg = 180 / Math.PI;
    const deg2rad = Math.PI / 180;

    const c1 = Math.hypot(a1, b1);
    const c2 = Math.hypot(a2, b2);
    const cBar = (c1 + c2) / 2;

    const cBar7 = Math.pow(cBar, 7);
    const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 6103515625)));

    const a1Prime = (1 + g) * a1;
    const a2Prime = (1 + g) * a2;

    const c1Prime = Math.hypot(a1Prime, b1);
    const c2Prime = Math.hypot(a2Prime, b2);

    let h1Prime = Math.atan2(b1, a1Prime) * rad2deg;
    if (h1Prime < 0) h1Prime += 360;

    let h2Prime = Math.atan2(b2, a2Prime) * rad2deg;
    if (h2Prime < 0) h2Prime += 360;

    const deltaLPrime = L2 - L1;
    const deltaCPrime = c2Prime - c1Prime;

    let deltahPrime = 0;
    if (c1Prime * c2Prime !== 0) {
      const diff = h2Prime - h1Prime;
      if (Math.abs(diff) <= 180) {
        deltahPrime = diff;
      } else if (diff > 180) {
        deltahPrime = diff - 360;
      } else {
        deltahPrime = diff + 360;
      }
    }

    const deltaHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin((deltahPrime * deg2rad) / 2);

    const lBarPrime = (L1 + L2) / 2;
    const cBarPrime = (c1Prime + c2Prime) / 2;

    let hBarPrime = 0;
    if (c1Prime * c2Prime === 0) {
      hBarPrime = h1Prime + h2Prime;
    } else {
      const diff = Math.abs(h1Prime - h2Prime);
      if (diff <= 180) {
        hBarPrime = (h1Prime + h2Prime) / 2;
      } else if (h1Prime + h2Prime < 360) {
        hBarPrime = (h1Prime + h2Prime + 360) / 2;
      } else {
        hBarPrime = (h1Prime + h2Prime - 360) / 2;
      }
    }

    const t = 1 - 0.17 * Math.cos((hBarPrime - 30) * deg2rad)
                + 0.24 * Math.cos((2 * hBarPrime) * deg2rad)
                + 0.32 * Math.cos((3 * hBarPrime + 6) * deg2rad)
                - 0.20 * Math.cos((4 * hBarPrime - 63) * deg2rad);

    const deltaTheta = 30 * Math.exp(-Math.pow((hBarPrime - 275) / 25, 2));

    const cBarPrime7 = Math.pow(cBarPrime, 7);
    const rC = 2 * Math.sqrt(cBarPrime7 / (cBarPrime7 + 6103515625));

    const lBarMinus50Sq = Math.pow(lBarPrime - 50, 2);
    const sL = 1 + (0.015 * lBarMinus50Sq) / Math.sqrt(20 + lBarMinus50Sq);
    const sC = 1 + 0.045 * cBarPrime;
    const sH = 1 + 0.015 * cBarPrime * t;
    const rT = -Math.sin((2 * deltaTheta) * deg2rad) * rC;

    const dL = deltaLPrime / (kL * sL);
    const dC = deltaCPrime / (kC * sC);
    const dH = deltaHPrime / (kH * sH);

    return Math.sqrt(dL * dL + dC * dC + dH * dH + rT * dC * dH);
  }

  function precomputePaletteLab(palette) {
    if (!palette) return [];
    return palette.map((col) => {
      let r, g, b;
      if (typeof col === 'string') {
        const rgba = hexToRgba(col);
        r = rgba[0]; g = rgba[1]; b = rgba[2];
      } else if (Array.isArray(col)) {
        r = col[0]; g = col[1]; b = col[2];
      } else if (col && typeof col === 'object') {
        r = col.r; g = col.g; b = col.b;
      } else {
        r = 0; g = 0; b = 0;
      }
      const [L, a, b_] = rgbToLab(r, g, b);
      return { r, g, b, L, a, b: b_, rgb: [r, g, b] };
    });
  }

  function pixelToInt(r, g, b, a) {
    return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
  }

  function mergeColors(baseRgba, secondaryRgba, amount) {
    const r = Math.round(baseRgba[0] + (secondaryRgba[0] - baseRgba[0]) * amount);
    const g = Math.round(baseRgba[1] + (secondaryRgba[1] - baseRgba[1]) * amount);
    const b = Math.round(baseRgba[2] + (secondaryRgba[2] - baseRgba[2]) * amount);
    return [r, g, b, baseRgba[3]];
  }

  // --- Step 2: Enhance Colors (Priority 5) ---
  // Scales Oklab chroma, so hue and perceived lightness hold (HSL saturation shifted both).
  // When the boosted color leaves sRGB, chroma is backed off to the gamut edge instead of clipping channels.
  function enhanceColors(buf, factor) {
    if (factor < 0 || factor === 1.0) return buf;
    const data = buf.data;
    const len = data.length;
    const inGamut = (lin) => lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
    for (let i = 0; i < len; i += 4) {
      if (data[i + 3] === 0) continue; // Skip transparent
      const [L, a, b] = rgbToOklab(data[i], data[i + 1], data[i + 2]);
      let lin = oklabToLinear(L, a * factor, b * factor);
      if (!inGamut(lin)) {
        let lo = Math.min(1, factor);
        let hi = factor;
        for (let step = 0; step < 10; step++) {
          const mid = (lo + hi) / 2;
          if (inGamut(oklabToLinear(L, a * mid, b * mid))) lo = mid;
          else hi = mid;
        }
        lin = oklabToLinear(L, a * lo, b * lo);
      }
      data[i] = linearToSRGB(lin[0]);
      data[i + 1] = linearToSRGB(lin[1]);
      data[i + 2] = linearToSRGB(lin[2]);
    }
    return buf;
  }

  // --- Step 3: Palette Generation & Quantization (Priority 10) ---

  // Classic 216 Web-Safe Palette
  let _webPalette = null;
  function getWebPalette() {
    if (!_webPalette) {
      const palette = [];
      const steps = [0, 51, 102, 153, 204, 255];
      for (const r of steps) {
        for (const g of steps) {
          for (const b of steps) {
            palette.push([r, g, b]);
          }
        }
      }
      _webPalette = palette;
    }
    return _webPalette;
  }

  // Median Cut color quantization helper
  function buildMedianCutPalette(buf, maxColors) {
    maxColors = Math.max(2, Math.min(256, Math.round(maxColors) || 8));
    const pixels = [];
    const data = buf.data;
    const step = Math.max(1, Math.floor(data.length / (4 * 5000))); // sample up to 5000 pixels

    for (let i = 0; i < data.length; i += 4 * step) {
      if (data[i + 3] > 64) {
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
    }

    if (pixels.length === 0) return [[0, 0, 0]];
    if (pixels.length <= maxColors) return pixels;

    let boxes = [pixels];
    while (boxes.length < maxColors) {
      // Find box with greatest range along any channel
      let maxRange = -1;
      let splitIdx = -1;
      let splitChannel = 0;

      for (let b = 0; b < boxes.length; b++) {
        const box = boxes[b];
        if (box.length <= 1) continue;
        let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
        for (let p = 0; p < box.length; p++) {
          const col = box[p];
          if (col[0] < minR) minR = col[0];
          if (col[0] > maxR) maxR = col[0];
          if (col[1] < minG) minG = col[1];
          if (col[1] > maxG) maxG = col[1];
          if (col[2] < minB) minB = col[2];
          if (col[2] > maxB) maxB = col[2];
        }
        const rangeR = maxR - minR;
        const rangeG = maxG - minG;
        const rangeB = maxB - minB;
        const boxMax = Math.max(rangeR, rangeG, rangeB);
        if (boxMax > maxRange) {
          maxRange = boxMax;
          splitIdx = b;
          splitChannel = boxMax === rangeR ? 0 : (boxMax === rangeG ? 1 : 2);
        }
      }

      if (splitIdx === -1 || maxRange === 0) break;

      const targetBox = boxes.splice(splitIdx, 1)[0];
      targetBox.sort((a, b) => a[splitChannel] - b[splitChannel]);
      const median = Math.floor(targetBox.length / 2);
      boxes.push(targetBox.slice(0, median));
      boxes.push(targetBox.slice(median));
    }

    return boxes.map((box) => {
      let sumR = 0, sumG = 0, sumB = 0;
      for (let i = 0; i < box.length; i++) {
        sumR += box[i][0];
        sumG += box[i][1];
        sumB += box[i][2];
      }
      return [
        Math.round(sumR / box.length),
        Math.round(sumG / box.length),
        Math.round(sumB / box.length)
      ];
    });
  }

  // Wu's Fast Optimal 3D Variance Quantizer (Xiaolin Wu, Graphics Gems II)
  function buildWuPalette(buf, maxColors) {
    return buildWuPaletteWeighted(buf, maxColors).map((c) => [c[0], c[1], c[2]]);
  }

  // Same as buildWuPalette, but each entry is [r, g, b, pixelCount]
  function buildWuPaletteWeighted(buf, maxColors) {
    maxColors = Math.max(2, Math.min(1024, Math.round(maxColors) || 8));

    const N = 33;
    const TABLE_SIZE = 35937; // 33 * 33 * 33
    const vwt = new Float64Array(TABLE_SIZE);
    const vmr = new Float64Array(TABLE_SIZE);
    const vmg = new Float64Array(TABLE_SIZE);
    const vmb = new Float64Array(TABLE_SIZE);
    const vmq = new Float64Array(TABLE_SIZE);

    const data = buf.data;
    const len = data.length;
    let pixelCount = 0;

    for (let i = 0; i < len; i += 4) {
      if (data[i + 3] > 64) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const ir = (r >> 3) + 1;
        const ig = (g >> 3) + 1;
        const ib = (b >> 3) + 1;
        const idx = (ir * 33 + ig) * 33 + ib;

        vwt[idx] += 1;
        vmr[idx] += r;
        vmg[idx] += g;
        vmb[idx] += b;
        vmq[idx] += (r * r + g * g + b * b);
        pixelCount++;
      }
    }

    if (pixelCount === 0) return [[0, 0, 0, 1]];

    const areaW = new Float64Array(N);
    const areaMR = new Float64Array(N);
    const areaMG = new Float64Array(N);
    const areaMB = new Float64Array(N);
    const areaMQ = new Float64Array(N);

    // 3D cumulative volume moments via dynamic programming in 33^3 steps
    for (let r = 1; r < N; r++) {
      areaW.fill(0);
      areaMR.fill(0);
      areaMG.fill(0);
      areaMB.fill(0);
      areaMQ.fill(0);
      for (let g = 1; g < N; g++) {
        let lineW = 0, lineMR = 0, lineMG = 0, lineMB = 0, lineMQ = 0;
        for (let b = 1; b < N; b++) {
          const idx = (r * 33 + g) * 33 + b;
          const prev = ((r - 1) * 33 + g) * 33 + b;

          lineW += vwt[idx];
          lineMR += vmr[idx];
          lineMG += vmg[idx];
          lineMB += vmb[idx];
          lineMQ += vmq[idx];

          areaW[b] += lineW;
          areaMR[b] += lineMR;
          areaMG[b] += lineMG;
          areaMB[b] += lineMB;
          areaMQ[b] += lineMQ;

          vwt[idx] = vwt[prev] + areaW[b];
          vmr[idx] = vmr[prev] + areaMR[b];
          vmg[idx] = vmg[prev] + areaMG[b];
          vmb[idx] = vmb[prev] + areaMB[b];
          vmq[idx] = vmq[prev] + areaMQ[b];
        }
      }
    }

    function volume(table, r0, r1, g0, g1, b0, b1) {
      return (
        table[(r1 * 33 + g1) * 33 + b1] -
        table[(r1 * 33 + g1) * 33 + b0] -
        table[(r1 * 33 + g0) * 33 + b1] +
        table[(r1 * 33 + g0) * 33 + b0] -
        table[(r0 * 33 + g1) * 33 + b1] +
        table[(r0 * 33 + g1) * 33 + b0] +
        table[(r0 * 33 + g0) * 33 + b1] -
        table[(r0 * 33 + g0) * 33 + b0]
      );
    }

    function findBestCut(box) {
      if (box.weight <= 1 || box.variance <= 0) return { axis: null, cut: -1 };
      let minVarSum = Infinity;
      let bestAxis = null;
      let bestCut = -1;

      // Axis R
      for (let c = box.r0 + 1; c < box.r1; c++) {
        const w1 = volume(vwt, box.r0, c, box.g0, box.g1, box.b0, box.b1);
        const w2 = box.weight - w1;
        if (w1 <= 0 || w2 <= 0) continue;

        const mr1 = volume(vmr, box.r0, c, box.g0, box.g1, box.b0, box.b1);
        const mg1 = volume(vmg, box.r0, c, box.g0, box.g1, box.b0, box.b1);
        const mb1 = volume(vmb, box.r0, c, box.g0, box.g1, box.b0, box.b1);
        const mq1 = volume(vmq, box.r0, c, box.g0, box.g1, box.b0, box.b1);

        const mr2 = box.mr - mr1;
        const mg2 = box.mg - mg1;
        const mb2 = box.mb - mb1;
        const mq2 = box.mq - mq1;

        const v1 = mq1 - (mr1 * mr1 + mg1 * mg1 + mb1 * mb1) / w1;
        const v2 = mq2 - (mr2 * mr2 + mg2 * mg2 + mb2 * mb2) / w2;
        const sum = v1 + v2;
        if (sum < minVarSum) {
          minVarSum = sum;
          bestAxis = 'r';
          bestCut = c;
        }
      }

      // Axis G
      for (let c = box.g0 + 1; c < box.g1; c++) {
        const w1 = volume(vwt, box.r0, box.r1, box.g0, c, box.b0, box.b1);
        const w2 = box.weight - w1;
        if (w1 <= 0 || w2 <= 0) continue;

        const mr1 = volume(vmr, box.r0, box.r1, box.g0, c, box.b0, box.b1);
        const mg1 = volume(vmg, box.r0, box.r1, box.g0, c, box.b0, box.b1);
        const mb1 = volume(vmb, box.r0, box.r1, box.g0, c, box.b0, box.b1);
        const mq1 = volume(vmq, box.r0, box.r1, box.g0, c, box.b0, box.b1);

        const mr2 = box.mr - mr1;
        const mg2 = box.mg - mg1;
        const mb2 = box.mb - mb1;
        const mq2 = box.mq - mq1;

        const v1 = mq1 - (mr1 * mr1 + mg1 * mg1 + mb1 * mb1) / w1;
        const v2 = mq2 - (mr2 * mr2 + mg2 * mg2 + mb2 * mb2) / w2;
        const sum = v1 + v2;
        if (sum < minVarSum) {
          minVarSum = sum;
          bestAxis = 'g';
          bestCut = c;
        }
      }

      // Axis B
      for (let c = box.b0 + 1; c < box.b1; c++) {
        const w1 = volume(vwt, box.r0, box.r1, box.g0, box.g1, box.b0, c);
        const w2 = box.weight - w1;
        if (w1 <= 0 || w2 <= 0) continue;

        const mr1 = volume(vmr, box.r0, box.r1, box.g0, box.g1, box.b0, c);
        const mg1 = volume(vmg, box.r0, box.r1, box.g0, box.g1, box.b0, c);
        const mb1 = volume(vmb, box.r0, box.r1, box.g0, box.g1, box.b0, c);
        const mq1 = volume(vmq, box.r0, box.r1, box.g0, box.g1, box.b0, c);

        const mr2 = box.mr - mr1;
        const mg2 = box.mg - mg1;
        const mb2 = box.mb - mb1;
        const mq2 = box.mq - mq1;

        const v1 = mq1 - (mr1 * mr1 + mg1 * mg1 + mb1 * mb1) / w1;
        const v2 = mq2 - (mr2 * mr2 + mg2 * mg2 + mb2 * mb2) / w2;
        const sum = v1 + v2;
        if (sum < minVarSum) {
          minVarSum = sum;
          bestAxis = 'b';
          bestCut = c;
        }
      }

      return { axis: bestAxis, cut: bestCut };
    }

    function createBox(r0, r1, g0, g1, b0, b1) {
      const weight = volume(vwt, r0, r1, g0, g1, b0, b1);
      let mr = 0, mg = 0, mb = 0, mq = 0, variance = 0;
      if (weight > 0) {
        mr = volume(vmr, r0, r1, g0, g1, b0, b1);
        mg = volume(vmg, r0, r1, g0, g1, b0, b1);
        mb = volume(vmb, r0, r1, g0, g1, b0, b1);
        mq = volume(vmq, r0, r1, g0, g1, b0, b1);
        variance = mq - (mr * mr + mg * mg + mb * mb) / weight;
        if (variance < 0) variance = 0;
      }
      const vol = (r1 - r0) * (g1 - g0) * (b1 - b0);
      const box = { r0, r1, g0, g1, b0, b1, vol, weight, mr, mg, mb, mq, variance };
      box.cut = findBestCut(box);
      return box;
    }

    const initialBox = createBox(0, 32, 0, 32, 0, 32);
    if (initialBox.weight <= 0) return [[0, 0, 0, 1]];

    const boxes = [initialBox];

    while (boxes.length < maxColors) {
      let maxVar = -1;
      let splitIdx = -1;

      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (box.cut.axis !== null && box.variance > maxVar) {
          maxVar = box.variance;
          splitIdx = i;
        }
      }

      if (splitIdx === -1) break;

      const parentBox = boxes.splice(splitIdx, 1)[0];
      let b1, b2;
      if (parentBox.cut.axis === 'r') {
        b1 = createBox(parentBox.r0, parentBox.cut.cut, parentBox.g0, parentBox.g1, parentBox.b0, parentBox.b1);
        b2 = createBox(parentBox.cut.cut, parentBox.r1, parentBox.g0, parentBox.g1, parentBox.b0, parentBox.b1);
      } else if (parentBox.cut.axis === 'g') {
        b1 = createBox(parentBox.r0, parentBox.r1, parentBox.g0, parentBox.cut.cut, parentBox.b0, parentBox.b1);
        b2 = createBox(parentBox.r0, parentBox.r1, parentBox.cut.cut, parentBox.g1, parentBox.b0, parentBox.b1);
      } else {
        b1 = createBox(parentBox.r0, parentBox.r1, parentBox.g0, parentBox.g1, parentBox.b0, parentBox.cut.cut);
        b2 = createBox(parentBox.r0, parentBox.r1, parentBox.g0, parentBox.g1, parentBox.cut.cut, parentBox.b1);
      }

      boxes.push(b1, b2);
    }

    const palette = [];
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.weight > 0) {
        palette.push([
          Math.round(box.mr / box.weight),
          Math.round(box.mg / box.weight),
          Math.round(box.mb / box.weight),
          box.weight
        ]);
      }
    }

    return palette.length > 0 ? palette : [[0, 0, 0, 1]];
  }

  // Normalize input pixels or image buffer to flat array of [r, g, b] samples
  function parsePixels(pixels, quality = 1) {
    if (!pixels) return [];
    if (pixels.data) pixels = pixels.data;
    const samples = [];
    const q = Math.max(1, Math.floor(quality || 1));

    if (Array.isArray(pixels) || (pixels.buffer && typeof pixels.length === 'number')) {
      if (pixels.length === 0) return [];

      if (typeof pixels[0] === 'object' && pixels[0] !== null) {
        for (let i = 0; i < pixels.length; i += q) {
          const p = pixels[i];
          if (Array.isArray(p)) {
            samples.push([p[0], p[1], p[2]]);
          } else if (p.r !== undefined) {
            samples.push([p.r, p.g, p.b]);
          }
        }
        return samples;
      }

      const isRgba = pixels.length % 4 === 0 && pixels.length >= 4;
      const step = isRgba ? 4 * q : 3 * q;

      if (isRgba) {
        for (let i = 0; i < pixels.length; i += step) {
          const a = pixels[i + 3];
          if (a <= 64) continue;
          samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
        }
        if (samples.length === 0) {
          for (let i = 0; i < pixels.length; i += step) {
            samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
          }
        }
      } else {
        for (let i = 0; i < pixels.length; i += step) {
          samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
        }
      }
    }

    return samples;
  }

  // Direct K-Means++ Color Quantizer: OKLab clustering with chroma-weighted accent preservation, deterministic Maximin seeding, and centroid deduplication (ported from Img2Palette)
  function buildKMeansPalette(buf, maxColors, lockedColors = [], quality = 1, maxIterations = 25, mode = 'balanced') {
    const targetK = Math.max(1, Math.min(256, Math.round(maxColors) || 8));

    // Cap sampling to MAX_KMEANS_SAMPLES (8192) to guarantee responsive execution and prevent UI freezes
    const MAX_KMEANS_SAMPLES = 8192;
    let totalPixels = 0;
    if (buf) {
      const raw = buf.data || buf;
      if (raw && typeof raw.length === 'number') {
        const isRgba = raw.length % 4 === 0 && raw.length >= 4 && !Array.isArray(raw[0]);
        totalPixels = isRgba ? Math.floor(raw.length / 4) : raw.length;
      }
    }

    const effectiveQuality = totalPixels > MAX_KMEANS_SAMPLES
      ? Math.max(Math.floor(quality || 1), Math.ceil(totalPixels / MAX_KMEANS_SAMPLES))
      : Math.max(1, Math.floor(quality || 1));

    const samples = parsePixels(buf, effectiveQuality);

    const validLocked = Array.isArray(lockedColors) ? lockedColors : [];
    if (samples.length === 0) {
      if (validLocked.length > 0) {
        return validLocked.slice(0, targetK).map((c) => [c.r, c.g, c.b]);
      }
      return [[0, 0, 0]];
    }

    // Check unique colors in samples
    const colorMap = new Map();
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const key = (s[0] << 16) | (s[1] << 8) | s[2];
      colorMap.set(key, (colorMap.get(key) || 0) + 1);
    }

    // If unique colors <= targetK and no locked colors need preservation
    if (colorMap.size <= targetK && validLocked.length === 0) {
      const res = [];
      for (const key of colorMap.keys()) {
        res.push([(key >> 16) & 255, (key >> 8) & 255, key & 255]);
      }
      return res;
    }

    // Convert all samples to OKLab coordinates and compute sample weights
    const nSamples = samples.length;
    const sampleL = new Float64Array(nSamples);
    const sampleA = new Float64Array(nSamples);
    const sampleB = new Float64Array(nSamples);
    const sampleWeight = new Float64Array(nSamples);
    const sampleScoreWeight = new Float64Array(nSamples);

    const chromaWeightFactor = mode === 'vibrant' ? 5.0 : mode === 'dominant' ? 0.0 : 2.0;

    for (let i = 0; i < nSamples; i++) {
      const s = samples[i];
      const [L, a, b] = rgbToOklab(s[0], s[1], s[2]);
      sampleL[i] = L;
      sampleA[i] = a;
      sampleB[i] = b;
      const chroma = Math.hypot(a, b);
      const sw = 1.0 + chromaWeightFactor * chroma;
      sampleWeight[i] = sw;
      const key = (s[0] << 16) | (s[1] << 8) | s[2];
      const count = colorMap.get(key) || 1;
      sampleScoreWeight[i] = sw * Math.log(1 + count);
    }

    // Initialize centroids and flat coordinate buffers
    const centroids = [];
    const centL = new Float64Array(targetK);
    const centA = new Float64Array(targetK);
    const centB = new Float64Array(targetK);

    // 1. Seed locked colors first
    for (let i = 0; i < validLocked.length && centroids.length < targetK; i++) {
      const lc = validLocked[i];
      const r = Math.max(0, Math.min(255, Math.round(Array.isArray(lc) ? lc[0] : lc.r)));
      const g = Math.max(0, Math.min(255, Math.round(Array.isArray(lc) ? lc[1] : lc.g)));
      const b = Math.max(0, Math.min(255, Math.round(Array.isArray(lc) ? lc[2] : lc.b)));
      const [L, a, b_] = rgbToOklab(r, g, b);
      const idx = centroids.length;
      centL[idx] = L;
      centA[idx] = a;
      centB[idx] = b_;
      centroids.push({
        okL: L,
        oka: a,
        okb: b_,
        r,
        g,
        b,
        locked: true,
        count: 0
      });
    }

    // 2. Deterministic density-weighted furthest-point (Maximin) seeding
    if (centroids.length === 0) {
      let maxCount = -1;
      let modeKey = 0;
      for (const [key, count] of colorMap.entries()) {
        if (count > maxCount) {
          maxCount = count;
          modeKey = key;
        }
      }
      const r = (modeKey >> 16) & 255;
      const g = (modeKey >> 8) & 255;
      const b = modeKey & 255;
      const [L, a, b_] = rgbToOklab(r, g, b);
      centL[0] = L;
      centA[0] = a;
      centB[0] = b_;
      centroids.push({
        okL: L,
        oka: a,
        okb: b_,
        r,
        g,
        b,
        locked: false,
        count: 0
      });
    }

    const minDistSq = new Float64Array(nSamples);
    for (let i = 0; i < nSamples; i++) {
      let minD = Infinity;
      const sL = sampleL[i], sa = sampleA[i], sb = sampleB[i];
      for (let c = 0; c < centroids.length; c++) {
        const dL = sL - centL[c];
        const da = sa - centA[c];
        const db = sb - centB[c];
        const d = dL * dL + da * da + db * db;
        if (d < minD) minD = d;
      }
      minDistSq[i] = minD;
    }

    while (centroids.length < targetK) {
      let maxScore = -1;
      let nextIdx = 0;
      for (let i = 0; i < nSamples; i++) {
        const score = minDistSq[i] * sampleScoreWeight[i];
        if (score > maxScore) {
          maxScore = score;
          nextIdx = i;
        }
      }

      if (maxScore <= 0) break;

      const s = samples[nextIdx];
      const nL = sampleL[nextIdx];
      const na = sampleA[nextIdx];
      const nb = sampleB[nextIdx];
      const cIdx = centroids.length;
      centL[cIdx] = nL;
      centA[cIdx] = na;
      centB[cIdx] = nb;
      const newCentroid = {
        okL: nL,
        oka: na,
        okb: nb,
        r: s[0],
        g: s[1],
        b: s[2],
        locked: false,
        count: 0
      };
      centroids.push(newCentroid);

      for (let i = 0; i < nSamples; i++) {
        const dL = sampleL[i] - nL;
        const da = sampleA[i] - na;
        const db = sampleB[i] - nb;
        const d = dL * dL + da * da + db * db;
        if (d < minDistSq[i]) minDistSq[i] = d;
      }
    }

    const actualK = centroids.length;

    // 3. Lloyd's iterative refinement loop in OKLab space
    const sumL = new Float64Array(actualK);
    const sumA = new Float64Array(actualK);
    const sumB = new Float64Array(actualK);
    const sumW = new Float64Array(actualK);
    const counts = new Uint32Array(actualK);

    for (let iter = 0; iter < maxIterations; iter++) {
      sumL.fill(0);
      sumA.fill(0);
      sumB.fill(0);
      sumW.fill(0);
      counts.fill(0);

      // Assignment step
      for (let i = 0; i < nSamples; i++) {
        const sL = sampleL[i], sa = sampleA[i], sb = sampleB[i];
        let bestDist = Infinity;
        let bestIdx = 0;
        for (let c = 0; c < actualK; c++) {
          const dL = sL - centL[c];
          const da = sa - centA[c];
          const db = sb - centB[c];
          const d = dL * dL + da * da + db * db;
          if (d < bestDist) {
            bestDist = d;
            bestIdx = c;
          }
        }
        const w = sampleWeight[i];
        sumL[bestIdx] += sL * w;
        sumA[bestIdx] += sa * w;
        sumB[bestIdx] += sb * w;
        sumW[bestIdx] += w;
        counts[bestIdx]++;
      }

      // Update step
      let maxShift = 0;
      for (let c = 0; c < actualK; c++) {
        centroids[c].count = counts[c];
        if (centroids[c].locked) continue;

        if (sumW[c] > 0) {
          const newL = sumL[c] / sumW[c];
          const newA = sumA[c] / sumW[c];
          const newB = sumB[c] / sumW[c];

          const dL = newL - centL[c];
          const da = newA - centA[c];
          const db = newB - centB[c];
          const shift = Math.sqrt(dL * dL + da * da + db * db);
          if (shift > maxShift) maxShift = shift;

          centL[c] = centroids[c].okL = newL;
          centA[c] = centroids[c].oka = newA;
          centB[c] = centroids[c].okb = newB;

          const [r, g, b] = oklabToRgb(newL, newA, newB);
          centroids[c].r = r;
          centroids[c].g = g;
          centroids[c].b = b;
        } else {
          // Reseed empty cluster to sample with highest residual error
          let maxErr = -1;
          let reseedIdx = 0;
          for (let i = 0; i < nSamples; i++) {
            let minD = Infinity;
            const sL = sampleL[i], sa = sampleA[i], sb = sampleB[i];
            for (let k = 0; k < actualK; k++) {
              if (counts[k] > 0) {
                const dL = sL - centL[k];
                const da = sa - centA[k];
                const db = sb - centB[k];
                const d = dL * dL + da * da + db * db;
                if (d < minD) minD = d;
              }
            }
            const err = minD * sampleWeight[i];
            if (err > maxErr) {
              maxErr = err;
              reseedIdx = i;
            }
          }
          centL[c] = centroids[c].okL = sampleL[reseedIdx];
          centA[c] = centroids[c].oka = sampleA[reseedIdx];
          centB[c] = centroids[c].okb = sampleB[reseedIdx];
          centroids[c].r = samples[reseedIdx][0];
          centroids[c].g = samples[reseedIdx][1];
          centroids[c].b = samples[reseedIdx][2];
        }
      }

      if (maxShift < 0.001) break;
    }

    // 4. Centroid Deduplication (Detect near-duplicates with DeltaE_OK < 0.035)
    if (actualK > 1 && nSamples > actualK) {
      let reseededAny = false;
      for (let i = 0; i < actualK; i++) {
        if (centroids[i].locked) continue;
        for (let j = 0; j < i; j++) {
          const dL = centL[i] - centL[j];
          const da = centA[i] - centA[j];
          const db = centB[i] - centB[j];
          const dist = Math.sqrt(dL * dL + da * da + db * db);

          if (dist < 0.035) {
            let maxD = -1;
            let bestIdx = 0;
            for (let s = 0; s < nSamples; s++) {
              let localMin = Infinity;
              const sL = sampleL[s], sa = sampleA[s], sb = sampleB[s];
              for (let c = 0; c < actualK; c++) {
                if (c === i) continue;
                const dL = sL - centL[c];
                const da = sa - centA[c];
                const db = sb - centB[c];
                const d = dL * dL + da * da + db * db;
                if (d < localMin) localMin = d;
              }
              if (localMin * sampleWeight[s] > maxD) {
                maxD = localMin * sampleWeight[s];
                bestIdx = s;
              }
            }

            centL[i] = centroids[i].okL = sampleL[bestIdx];
            centA[i] = centroids[i].oka = sampleA[bestIdx];
            centB[i] = centroids[i].okb = sampleB[bestIdx];
            centroids[i].r = samples[bestIdx][0];
            centroids[i].g = samples[bestIdx][1];
            centroids[i].b = samples[bestIdx][2];
            reseededAny = true;
            break;
          }
        }
      }

      if (reseededAny) {
        for (let iter = 0; iter < 3; iter++) {
          sumL.fill(0);
          sumA.fill(0);
          sumB.fill(0);
          sumW.fill(0);
          counts.fill(0);

          for (let i = 0; i < nSamples; i++) {
            const sL = sampleL[i], sa = sampleA[i], sb = sampleB[i];
            let bestDist = Infinity;
            let bestIdx = 0;
            for (let c = 0; c < actualK; c++) {
              const dL = sL - centL[c];
              const da = sa - centA[c];
              const db = sb - centB[c];
              const d = dL * dL + da * da + db * db;
              if (d < bestDist) {
                bestDist = d;
                bestIdx = c;
              }
            }
            const w = sampleWeight[i];
            sumL[bestIdx] += sL * w;
            sumA[bestIdx] += sa * w;
            sumB[bestIdx] += sb * w;
            sumW[bestIdx] += w;
            counts[bestIdx]++;
          }

          for (let c = 0; c < actualK; c++) {
            centroids[c].count = counts[c];
            if (centroids[c].locked) continue;
            if (sumW[c] > 0) {
              centL[c] = centroids[c].okL = sumL[c] / sumW[c];
              centA[c] = centroids[c].oka = sumA[c] / sumW[c];
              centB[c] = centroids[c].okb = sumB[c] / sumW[c];
              const [r, g, b] = oklabToRgb(centL[c], centA[c], centB[c]);
              centroids[c].r = r;
              centroids[c].g = g;
              centroids[c].b = b;
            }
          }
        }
      }
    }

    return centroids.map((c) => [c.r, c.g, c.b]);
  }

  // Fast Two-Stage K-Means++ Color Quantizer: Wu 3D variance pre-quantization refined by perceptual OKLab K-Means
  function buildKMeansFastPalette(buf, maxColors) {
    maxColors = Math.max(2, Math.min(256, Math.round(maxColors) || 8));

    const colorCounts = new Map();
    const data = buf && buf.data ? buf.data : buf;
    const len = data ? data.length : 0;

    for (let i = 0; i < len; i += 4) {
      if (data[i + 3] > 64) {
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
      }
    }

    if (colorCounts.size === 0) return [[0, 0, 0]];
    if (colorCounts.size <= maxColors) {
      const res = [];
      for (const key of colorCounts.keys()) {
        res.push([(key >> 16) & 255, (key >> 8) & 255, key & 255]);
      }
      return res;
    }

    // Stage 1: Candidate pre-quantization
    // If unique colors <= 512, use exact unique colors. Otherwise, extract candidate pool via Wu.
    let candidates = [];
    const candidateCount = Math.min(colorCounts.size, Math.max(2 * maxColors, 256));

    if (colorCounts.size <= 512) {
      for (const [key, count] of colorCounts.entries()) {
        candidates.push({
          r: (key >> 16) & 255,
          g: (key >> 8) & 255,
          b: key & 255,
          count
        });
      }
    } else {
      const wuColors = buildWuPaletteWeighted(buf, candidateCount);
      candidates = wuColors.map((c) => ({ r: c[0], g: c[1], b: c[2], count: c[3] }));
    }

    if (candidates.length <= maxColors) {
      return candidates.map((c) => [c.r, c.g, c.b]);
    }

    // Stage 2: OKLab K-Means refinement with chroma-aware weighting
    const n = candidates.length;
    const cL = new Float64Array(n);
    const ca = new Float64Array(n);
    const cb = new Float64Array(n);
    const weights = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const c = candidates[i];
      const [L, a, b] = rgbToOklab(c.r, c.g, c.b);
      cL[i] = L;
      ca[i] = a;
      cb[i] = b;
      const chroma = Math.hypot(a, b);
      weights[i] = c.count * (1.0 + 2.0 * chroma);
    }

    const centroidsL = new Float64Array(maxColors);
    const centroidsa = new Float64Array(maxColors);
    const centroidsb = new Float64Array(maxColors);

    // Deterministic Maximin seeding
    let maxW = -1;
    let firstIdx = 0;
    for (let i = 0; i < n; i++) {
      if (weights[i] > maxW) {
        maxW = weights[i];
        firstIdx = i;
      }
    }
    centroidsL[0] = cL[firstIdx];
    centroidsa[0] = ca[firstIdx];
    centroidsb[0] = cb[firstIdx];

    const minDistSq = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const dL = cL[i] - centroidsL[0];
      const da = ca[i] - centroidsa[0];
      const db = cb[i] - centroidsb[0];
      minDistSq[i] = dL * dL + da * da + db * db;
    }

    for (let k = 1; k < maxColors; k++) {
      let maxScore = -1;
      let nextIdx = 0;
      for (let i = 0; i < n; i++) {
        const score = minDistSq[i] * weights[i];
        if (score > maxScore) {
          maxScore = score;
          nextIdx = i;
        }
      }
      centroidsL[k] = cL[nextIdx];
      centroidsa[k] = ca[nextIdx];
      centroidsb[k] = cb[nextIdx];

      for (let i = 0; i < n; i++) {
        const dL = cL[i] - centroidsL[k];
        const da = ca[i] - centroidsa[k];
        const db = cb[i] - centroidsb[k];
        const d = dL * dL + da * da + db * db;
        if (d < minDistSq[i]) minDistSq[i] = d;
      }
    }

    // Lloyd's iterative refinement in OKLab space
    const sumL = new Float64Array(maxColors);
    const sumA = new Float64Array(maxColors);
    const sumB = new Float64Array(maxColors);
    const sumW = new Float64Array(maxColors);

    for (let iter = 0; iter < 8; iter++) {
      sumL.fill(0);
      sumA.fill(0);
      sumB.fill(0);
      sumW.fill(0);

      for (let i = 0; i < n; i++) {
        let bestDist = Infinity;
        let bestK = 0;
        for (let k = 0; k < maxColors; k++) {
          const dL = cL[i] - centroidsL[k];
          const da = ca[i] - centroidsa[k];
          const db = cb[i] - centroidsb[k];
          const d = dL * dL + da * da + db * db;
          if (d < bestDist) {
            bestDist = d;
            bestK = k;
          }
        }
        const w = weights[i];
        sumL[bestK] += cL[i] * w;
        sumA[bestK] += ca[i] * w;
        sumB[bestK] += cb[i] * w;
        sumW[bestK] += w;
      }

      let maxShift = 0;
      for (let k = 0; k < maxColors; k++) {
        if (sumW[k] > 0) {
          const newL = sumL[k] / sumW[k];
          const newA = sumA[k] / sumW[k];
          const newB = sumB[k] / sumW[k];
          const dL = newL - centroidsL[k];
          const da = newA - centroidsa[k];
          const db = newB - centroidsb[k];
          const shift = Math.sqrt(dL * dL + da * da + db * db);
          if (shift > maxShift) maxShift = shift;
          centroidsL[k] = newL;
          centroidsa[k] = newA;
          centroidsb[k] = newB;
        }
      }

      if (maxShift < 0.001) break;
    }

    const palette = [];
    for (let k = 0; k < maxColors; k++) {
      palette.push(oklabToRgb(centroidsL[k], centroidsa[k], centroidsb[k]));
    }
    return palette;
  }

  const buildTwoStagePalette = buildKMeansFastPalette;

  // Extract adaptive palette using Wu's variance quantizer (default), median cut, K-Means++, or K-Means++ (Fast)
  function buildAdaptivePalette(buf, maxColors, quantizerMethod = 'wu') {
    const qMethod = (quantizerMethod || 'wu').toLowerCase();
    if (qMethod === 'median' || qMethod === 'median_cut' || qMethod === 'median-cut') {
      return buildMedianCutPalette(buf, maxColors);
    }
    if (qMethod === 'kmeans_fast' || qMethod === 'kmeans-fast' || qMethod === 'fast' || qMethod === 'two_stage' || qMethod === 'two-stage') {
      return buildKMeansFastPalette(buf, maxColors);
    }
    if (qMethod === 'kmeans' || qMethod === 'hybrid' || qMethod === 'kmeans_direct' || qMethod === 'kmeans-direct' || qMethod === 'direct') {
      return buildKMeansPalette(buf, maxColors);
    }
    return buildWuPalette(buf, maxColors);
  }

  // Extract a clean palette from an image buffer:
  // - Swatch strips (<= maxColors unique colors) keep exact colors losslessly
  // - Continuous-tone images (> maxColors) are adaptively quantized via selected quantizer
  // Returns array of hex strings sorted monotonically by Oklab perceptual lightness
  function extractPalette(buf, maxColors = 256, quantizerMethod = 'wu') {
    if (!buf || !buf.data) return [];
    maxColors = Math.max(2, Math.min(256, Math.round(maxColors) || 256));

    const colorCounts = new Map();
    const data = buf.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      if (data[i + 3] > 64) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const key = (r << 16) | (g << 8) | b;
        colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
        if (colorCounts.size > maxColors) {
          // Exceeds maxColors: cannot be a discrete swatch strip, stop collecting
          break;
        }
      }
    }

    if (colorCounts.size === 0) return ['#000000'];

    let paletteRgb = [];

    if (colorCounts.size <= maxColors) {
      for (const key of colorCounts.keys()) {
        paletteRgb.push([
          (key >> 16) & 255,
          (key >> 8) & 255,
          key & 255
        ]);
      }
    } else {
      paletteRgb = buildAdaptivePalette(buf, maxColors, quantizerMethod);
    }

    paletteRgb.sort((c1, c2) => {
      const l1 = rgbToOklab(c1[0], c1[1], c1[2])[0];
      const l2 = rgbToOklab(c2[0], c2[1], c2[2])[0];
      return l1 - l2;
    });

    const seen = new Set();
    const hexList = [];
    for (let i = 0; i < paletteRgb.length; i++) {
      const hex = rgbaToHex(paletteRgb[i][0], paletteRgb[i][1], paletteRgb[i][2]);
      if (!seen.has(hex)) {
        seen.add(hex);
        hexList.push(hex);
      }
    }

    return hexList.length > 0 ? hexList : ['#000000'];
  }

  // Snap palette channels to the hardware's bits per channel (e.g. SMS 2, SNES/GBC 5), dropping duplicates
  function snapPaletteDepth(palette, bits) {
    const levels = (1 << bits) - 1;
    const snap = (v) => Math.round(v / 255 * levels) * 255 / levels;
    const seen = new Set();
    const out = [];
    for (const col of palette) {
      const [r, g, b] = typeof col === 'string' ? hexToRgba(col) : col;
      const snapped = rgbaToHex(snap(r), snap(g), snap(b));
      if (seen.has(snapped)) continue;
      seen.add(snapped);
      out.push(typeof col === 'string' ? snapped : hexToRgba(snapped).slice(0, 3));
    }
    return out;
  }

  // Hardware attribute limits: every tileSize x tileSize tile is redrawn with at most tileColors colors.
  // tileSize 'row' makes each scanline one tile (Atari 2600 background + playfield color per line).
  // tilePalettes > 0 makes all tiles share that many palettes (GBC 8, NES 4), clustered k-means style;
  // sharedColor puts the image's most-used color in every palette (NES universal backdrop).
  // foreground (palette entries) limits every other tile color to that set (VIC-20 hi-res character colors 0-7).
  // Colors are picked greedily to minimize Oklab error; transparent pixels are ignored.
  function limitTileColors(buf, tileSize, tileColors, tilePalettes = 0, sharedColor = false, foreground = null) {
    const { width: w, height: h, data } = buf;
    const tw = tileSize === 'row' ? w : tileSize;
    const th = tileSize === 'row' ? 1 : tileSize;
    const fg = foreground && foreground.length
      ? foreground.map((c) => { const [r, g, b] = typeof c === 'string' ? hexToRgba(c) : c; return (r << 16) | (g << 8) | b; })
      : null;
    const labCache = new Map();
    const lab = (key) => {
      let v = labCache.get(key);
      if (!v) {
        v = rgbToOklab(key >> 16, (key >> 8) & 255, key & 255).slice();
        labCache.set(key, v);
      }
      return v;
    };
    const dist = (k1, k2) => {
      const p = lab(k1), q = lab(k2);
      return colorDistOklabSq(p[0], p[1], p[2], q[0], q[1], q[2]);
    };

    // Per-tile histograms of opaque colors
    const tiles = [];
    const global = new Map();
    for (let ty = 0; ty < h; ty += th) {
      for (let tx = 0; tx < w; tx += tw) {
        const hist = new Map();
        for (let y = ty; y < Math.min(h, ty + th); y++) {
          for (let x = tx; x < Math.min(w, tx + tw); x++) {
            const i = (y * w + x) * 4;
            if (data[i + 3] === 0) continue;
            const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
            hist.set(key, (hist.get(key) || 0) + 1);
            global.set(key, (global.get(key) || 0) + 1);
          }
        }
        tiles.push({ tx, ty, hist, pal: null });
      }
    }
    if (global.size === 0) return buf;

    let universal = null;
    if (sharedColor) {
      let best = -1;
      for (const [key, n] of global) if (n > best) { best = n; universal = key; }
    }

    const cost = (hist, pal) => {
      let total = 0;
      for (const [key, n] of hist) {
        let m = Infinity;
        for (const p of pal) m = Math.min(m, dist(key, p));
        total += n * m;
      }
      return total;
    };

    // Greedy palette (add the color that most lowers weighted error), then a k-medoids swap pass,
    // since greedy can lock in an in-between color. Candidates are the 64 most-used colors, or every
    // allowed foreground color.
    const buildPalette = (hist) => {
      const keys = [...hist.keys()].filter((k) => k !== universal);
      const head = universal !== null ? [universal] : [];
      const slots = tileColors - head.length;
      if (keys.length <= slots && (!fg || keys.every((k) => fg.includes(k)))) return head.concat(keys);

      // D[j * C + c]: distance from tile color j to candidate pool color c
      const pool = fg ? fg.filter((k) => k !== universal) : keys;
      const H = keys.length, C = pool.length;
      const wts = keys.map((k) => hist.get(k));
      const D = new Float64Array(H * C);
      for (let j = 0; j < H; j++) for (let c = 0; c < C; c++) D[j * C + c] = dist(keys[j], pool[c]);
      const base = keys.map((k) => (universal !== null ? dist(k, universal) : Infinity));
      const cand = fg ? [...pool.keys()] : [...keys.keys()].sort((a, b) => wts[b] - wts[a]).slice(0, 64);

      // Error of the palette whose per-color nearest distance (excluding c) is `rest`, plus candidate c
      const errorWith = (rest, c) => {
        let total = 0;
        for (let j = 0; j < H; j++) total += wts[j] * Math.min(rest[j], D[j * C + c]);
        return total;
      };
      const restWithout = (chosen, skip) => base.map((b, j) => {
        let m = b;
        for (let s = 0; s < chosen.length; s++) if (s !== skip) m = Math.min(m, D[j * C + chosen[s]]);
        return m;
      });

      const chosen = [];
      while (chosen.length < Math.min(slots, cand.length)) {
        const rest = restWithout(chosen, -1);
        let best = -1, bestErr = Infinity;
        for (const c of cand) {
          if (chosen.includes(c)) continue;
          const e = errorWith(rest, c);
          if (e < bestErr) { bestErr = e; best = c; }
        }
        chosen.push(best);
      }

      let current = errorWith(restWithout(chosen, 0), chosen[0]);
      for (let round = 0, improved = true; improved && round < 8; round++) {
        improved = false;
        for (let s = 0; s < chosen.length; s++) {
          const rest = restWithout(chosen, s);
          for (const c of cand) {
            if (chosen.includes(c)) continue;
            const e = errorWith(rest, c);
            if (e < current - 1e-12) { current = e; chosen[s] = c; improved = true; }
          }
        }
      }
      return head.concat(chosen.map((i) => pool[i]));
    };

    if (tilePalettes > 0) {
      // Farthest-first init: start from the global palette, then seed from the worst-served tile
      const palettes = [buildPalette(global)];
      while (palettes.length < tilePalettes) {
        let worst = null, worstCost = 0;
        for (const t of tiles) {
          let c = Infinity;
          for (const pal of palettes) c = Math.min(c, cost(t.hist, pal));
          if (c > worstCost) { worstCost = c; worst = t; }
        }
        if (!worst) break;
        palettes.push(buildPalette(worst.hist));
      }

      let assign = new Array(tiles.length).fill(-1);
      for (let iter = 0; iter < 8; iter++) {
        let changed = false;
        tiles.forEach((t, i) => {
          let best = 0, bestCost = Infinity;
          palettes.forEach((pal, p) => {
            const c = cost(t.hist, pal);
            if (c < bestCost) { bestCost = c; best = p; }
          });
          if (assign[i] !== best) { assign[i] = best; changed = true; }
        });
        if (!changed) break;
        palettes.forEach((pal, p) => {
          const merged = new Map();
          tiles.forEach((t, i) => {
            if (assign[i] !== p) return;
            for (const [key, n] of t.hist) merged.set(key, (merged.get(key) || 0) + n);
          });
          if (merged.size) palettes[p] = buildPalette(merged);
        });
      }
      tiles.forEach((t, i) => { t.pal = palettes[assign[i]]; });
    } else {
      // With a shared backdrop, a tile that already fits still has to spend a slot on it
      for (const t of tiles) t.pal = universal === null && !fg && t.hist.size <= tileColors ? null : buildPalette(t.hist);
    }

    for (const t of tiles) {
      if (!t.pal || t.hist.size === 0) continue;
      const remap = new Map();
      for (const key of t.hist.keys()) {
        let best = t.pal[0], bestD = Infinity;
        for (const p of t.pal) {
          const d = dist(key, p);
          if (d < bestD) { bestD = d; best = p; }
        }
        remap.set(key, best);
      }
      for (let y = t.ty; y < Math.min(h, t.ty + th); y++) {
        for (let x = t.tx; x < Math.min(w, t.tx + tw); x++) {
          const i = (y * w + x) * 4;
          if (data[i + 3] === 0) continue;
          const key = remap.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
          data[i] = key >> 16;
          data[i + 1] = (key >> 8) & 255;
          data[i + 2] = key & 255;
        }
      }
    }
    return buf;
  }

  /**
   * Subsample a palette evenly across its sorted tonal spectrum.
   */
  // Distinct RGB colors among non-transparent pixels, stopping once `limit` is reached
  function countColors(buf, limit) {
    const seen = new Set();
    const d = buf.data;
    for (let i = 0; i < d.length && seen.size < limit; i += 4) {
      if (d[i + 3] > 0) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
    return seen.size;
  }

  function samplePalette(palette, count) {
    if (!palette || palette.length <= count) return palette ? palette.slice() : [];
    if (count <= 0) return [];
    if (count === 1) return [palette[0]];

    const step = (palette.length - 1) / (count - 1);
    const result = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.round(i * step);
      result.push(palette[idx]);
    }
    return result;
  }

  // Bayer Ordered Dithering Matrices (normalized to [-0.5, 0.5])
  const BAYER_2 = new Float32Array([
    0 / 4 - 0.5, 2 / 4 - 0.5,
    3 / 4 - 0.5, 1 / 4 - 0.5
  ]);

  const BAYER_4 = new Float32Array([
     0 / 16 - 0.5,  8 / 16 - 0.5,  2 / 16 - 0.5, 10 / 16 - 0.5,
    12 / 16 - 0.5,  4 / 16 - 0.5, 14 / 16 - 0.5,  6 / 16 - 0.5,
     3 / 16 - 0.5, 11 / 16 - 0.5,  1 / 16 - 0.5,  9 / 16 - 0.5,
    15 / 16 - 0.5,  7 / 16 - 0.5, 13 / 16 - 0.5,  5 / 16 - 0.5
  ]);

  const BAYER_8 = new Float32Array([
     0 / 64 - 0.5, 32 / 64 - 0.5,  8 / 64 - 0.5, 40 / 64 - 0.5,  2 / 64 - 0.5, 34 / 64 - 0.5, 10 / 64 - 0.5, 42 / 64 - 0.5,
    48 / 64 - 0.5, 16 / 64 - 0.5, 56 / 64 - 0.5, 24 / 64 - 0.5, 50 / 64 - 0.5, 18 / 64 - 0.5, 58 / 64 - 0.5, 26 / 64 - 0.5,
    12 / 64 - 0.5, 44 / 64 - 0.5,  4 / 64 - 0.5, 36 / 64 - 0.5, 14 / 64 - 0.5, 46 / 64 - 0.5,  6 / 64 - 0.5, 38 / 64 - 0.5,
    60 / 64 - 0.5, 28 / 64 - 0.5, 52 / 64 - 0.5, 20 / 64 - 0.5, 62 / 64 - 0.5, 30 / 64 - 0.5, 54 / 64 - 0.5, 22 / 64 - 0.5,
     3 / 64 - 0.5, 35 / 64 - 0.5, 11 / 64 - 0.5, 43 / 64 - 0.5,  1 / 64 - 0.5, 33 / 64 - 0.5,  9 / 64 - 0.5, 41 / 64 - 0.5,
    51 / 64 - 0.5, 19 / 64 - 0.5, 59 / 64 - 0.5, 27 / 64 - 0.5, 49 / 64 - 0.5, 17 / 64 - 0.5, 57 / 64 - 0.5, 25 / 64 - 0.5,
    15 / 64 - 0.5, 47 / 64 - 0.5,  7 / 64 - 0.5, 39 / 64 - 0.5, 13 / 64 - 0.5, 45 / 64 - 0.5,  5 / 64 - 0.5, 37 / 64 - 0.5,
    63 / 64 - 0.5, 31 / 64 - 0.5, 55 / 64 - 0.5, 23 / 64 - 0.5, 61 / 64 - 0.5, 29 / 64 - 0.5, 53 / 64 - 0.5, 21 / 64 - 0.5
  ]);

  // Error Diffusion Kernels: flat arrays of [dx, dy, weight] tuples
  const DIFFUSION_KERNELS = {
    'floyd': [
      1, 0, 7 / 16,
      -1, 1, 3 / 16,
      0, 1, 5 / 16,
      1, 1, 1 / 16
    ],
    'burkes': [
      1, 0, 8 / 32,
      2, 0, 4 / 32,
      -2, 1, 2 / 32,
      -1, 1, 4 / 32,
      0, 1, 8 / 32,
      1, 1, 4 / 32,
      2, 1, 2 / 32
    ],
    'sierra-3': [
      1, 0, 5 / 32,
      2, 0, 3 / 32,
      -2, 1, 2 / 32,
      -1, 1, 4 / 32,
      0, 1, 5 / 32,
      1, 1, 4 / 32,
      2, 1, 2 / 32,
      -1, 2, 2 / 32,
      0, 2, 3 / 32,
      1, 2, 2 / 32
    ],
    'sierra-2': [
      1, 0, 4 / 16,
      2, 0, 3 / 16,
      -2, 1, 1 / 16,
      -1, 1, 2 / 16,
      0, 1, 3 / 16,
      1, 1, 2 / 16,
      2, 1, 1 / 16
    ],
    'sierra-lite': [
      1, 0, 2 / 4,
      -1, 1, 1 / 4,
      0, 1, 1 / 4
    ]
  };
  DIFFUSION_KERNELS['sierra3'] = DIFFUSION_KERNELS['sierra-3'];
  DIFFUSION_KERNELS['sierra'] = DIFFUSION_KERNELS['sierra-3'];
  DIFFUSION_KERNELS['sierra2'] = DIFFUSION_KERNELS['sierra-2'];
  DIFFUSION_KERNELS['sierralite'] = DIFFUSION_KERNELS['sierra-lite'];

  // Bayer mixing plans survive across renders while palette and dither settings are unchanged, so tweaks
  // applied after quantization (smoothing, outline, background) don't rebuild them
  // ponytail: single-entry cache, cleared past ~300k colors; key it per palette if presets ever alternate
  let bayerPlanCache = { key: '', plans: new Map() };

  // Quantize image buffer to a palette with retro dithering suite
  function quantize(buf, palette, options = {}) {
    if (!palette || palette.length === 0) return buf;

    let opts = options;
    if (typeof opts === 'boolean') {
      opts = { ditherType: opts ? 'floyd' : 'none', ditherAmount: 1.0 };
    } else if (!opts || typeof opts !== 'object') {
      opts = {};
    }

    const ditherType = opts.ditherType || (opts.paletteDither ? 'floyd' : 'none');
    let ditherAmount = 1.0;
    if (opts.ditherAmount !== undefined) {
      ditherAmount = Number(opts.ditherAmount);
    } else if (ditherType !== 'none') {
      ditherAmount = 0.8;
    }
    const colorMetric = opts.colorMetric === 'redmean' ? 'redmean' : (opts.colorMetric === 'ciede2000' ? 'ciede2000' : 'oklab');

    const precomputed = precomputePaletteOklab(palette);
    if (!precomputed || precomputed.length === 0) return buf;

    const precomputedLab = colorMetric === 'ciede2000' ? precomputePaletteLab(palette) : null;

    const w = buf.width;
    const h = buf.height;
    const data = buf.data;

    // Nearest-match caches keyed by exact 24-bit color
    const oklabCache = new Map();

    function closestOklabIdx(r, g, b) {
      const ir = Math.max(0, Math.min(255, Math.round(r)));
      const ig = Math.max(0, Math.min(255, Math.round(g)));
      const ib = Math.max(0, Math.min(255, Math.round(b)));
      const key = (ir << 16) | (ig << 8) | ib;
      const cached = oklabCache.get(key);
      if (cached !== undefined) return cached;
      const [L, a, b_] = rgbToOklab(ir, ig, ib);
      let bestDist = Infinity;
      let bestIdx = 0;
      for (let i = 0; i < precomputed.length; i++) {
        const pal = precomputed[i];
        const dist = colorDistOklabSq(L, a, b_, pal.L, pal.a, pal.b);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
          if (dist === 0) break;
        }
      }
      oklabCache.set(key, bestIdx);
      return bestIdx;
    }

    function closestRedmeanIdx(r, g, b) {
      const ir = Math.max(0, Math.min(255, Math.round(r)));
      const ig = Math.max(0, Math.min(255, Math.round(g)));
      const ib = Math.max(0, Math.min(255, Math.round(b)));
      let bestDist = Infinity;
      let bestIdx = 0;
      for (let i = 0; i < precomputed.length; i++) {
        const pal = precomputed[i];
        const dist = colorDistSq(ir, ig, ib, pal.rgb[0], pal.rgb[1], pal.rgb[2]);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
          if (dist === 0) break;
        }
      }
      return bestIdx;
    }

    const ciede2000Cache = new Map();

    function closestCIEDE2000Idx(r, g, b) {
      const ir = Math.max(0, Math.min(255, Math.round(r)));
      const ig = Math.max(0, Math.min(255, Math.round(g)));
      const ib = Math.max(0, Math.min(255, Math.round(b)));
      const key = (ir << 16) | (ig << 8) | ib;
      const cached = ciede2000Cache.get(key);
      if (cached !== undefined) return cached;
      const [L, a, b_] = rgbToLab(ir, ig, ib);
      let bestDist = Infinity;
      let bestIdx = 0;
      for (let i = 0; i < precomputedLab.length; i++) {
        const pal = precomputedLab[i];
        const dist = ciede2000(L, a, b_, pal.L, pal.a, pal.b);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
          if (dist === 0) break;
        }
      }
      ciede2000Cache.set(key, bestIdx);
      return bestIdx;
    }

    let closestIdx = closestOklabIdx;
    if (colorMetric === 'redmean') {
      closestIdx = closestRedmeanIdx;
    } else if (colorMetric === 'ciede2000') {
      closestIdx = closestCIEDE2000Idx;
    }
    const findClosest = (r, g, b) => precomputed[closestIdx(r, g, b)].rgb;

    // 1. Bayer Ordered Dithering
    let bayerMatrix = null;
    let bayerMask = 0;
    let bayerShift = 0;
    if (ditherType === 'bayer2') {
      bayerMatrix = BAYER_2;
      bayerMask = 1;
      bayerShift = 1;
    } else if (ditherType === 'bayer4') {
      bayerMatrix = BAYER_4;
      bayerMask = 3;
      bayerShift = 2;
    } else if (ditherType === 'bayer8') {
      bayerMatrix = BAYER_8;
      bayerMask = 7;
      bayerShift = 3;
    }

    if (bayerMatrix !== null) {
      // Ordered dithering after Yliluoma's algorithm 2: each color gets a plan of one palette entry per matrix cell
      // whose blend best matches it. Entries mix in linear light (as the eye averages them) and the blend is
      // judged in Oklab (as the eye perceives it). Entries are sorted dark to light and the Bayer threshold
      // picks one, so the pattern scales with palette spacing and can mix several hues. ditherAmount pulls
      // the target toward its nearest color (0 = no dithering).
      // ponytail: plans draw from the 8 nearest palette colors only; widen if far mixes are ever needed
      // One plan entry per matrix cell; capping it below 64 folds the 8x8 matrix back into the 4x4 pattern
      const PLAN_SIZE = bayerMatrix.length;
      const P = precomputed.length;
      const K = Math.min(8, P);
      const linPal = new Float64Array(P * 3);
      const lmsPal = new Float64Array(P * 3);
      const luma = new Float64Array(P);
      for (let i = 0; i < P; i++) {
        const rgb = precomputed[i].rgb;
        for (let c = 0; c < 3; c++) linPal[i * 3 + c] = sRGBtoLinear[rgb[c]];
        linearToLmsInto(linPal[i * 3], linPal[i * 3 + 1], linPal[i * 3 + 2], lmsPal, i * 3);
        luma[i] = 0.2126 * linPal[i * 3] + 0.7152 * linPal[i * 3 + 1] + 0.0722 * linPal[i * 3 + 2];
      }
      const nearIdx = new Int32Array(K);
      const nearDist = new Float64Array(K);
      const target = new Float64Array(3);
      const mix = new Float64Array(3);
      const cacheKey = [colorMetric, ditherAmount, PLAN_SIZE, precomputed.map((p) => p.rgb.join(',')).join(';')].join('|');
      if (bayerPlanCache.key !== cacheKey || bayerPlanCache.plans.size > 300000) {
        bayerPlanCache = { key: cacheKey, plans: new Map() };
      }
      const plans = bayerPlanCache.plans;

      // Fills nearIdx with the K palette entries nearest the target by dist(i); returns how many
      const selectNearest = (dist) => {
        let filled = 0;
        for (let i = 0; i < P; i++) {
          const d = dist(i);
          if (filled === K && d >= nearDist[K - 1]) continue;
          let pos = filled < K ? filled++ : K - 1;
          while (pos > 0 && nearDist[pos - 1] > d) {
            nearDist[pos] = nearDist[pos - 1];
            nearIdx[pos] = nearIdx[pos - 1];
            pos--;
          }
          nearDist[pos] = d;
          nearIdx[pos] = i;
        }
        return filled;
      };

      // How far the blend with LMS sum (l, m, s) looks from the target
      const blendErr = (l, m, s) => {
        lmsToOklabInto(l, m, s, mix);
        return colorDistOklabSq(mix[0], mix[1], mix[2], target[0], target[1], target[2]);
      };

      // Greedily adds whichever candidate brings the running blend closest to the target, scored in linear
      // RGB or in Oklab. Sums are kept in both linear RGB and LMS (both linear in light).
      const greedy = (filled, perceptual, t0, t1, t2) => {
        const out = new Uint16Array(PLAN_SIZE);
        let r0 = 0, r1 = 0, r2 = 0, l0 = 0, l1 = 0, l2 = 0;
        for (let n = 1; n <= PLAN_SIZE; n++) {
          let best = nearIdx[0];
          let bestErr = Infinity;
          for (let k = 0; k < filled; k++) {
            const i = nearIdx[k] * 3;
            const err = perceptual
              ? blendErr((l0 + lmsPal[i]) / n, (l1 + lmsPal[i + 1]) / n, (l2 + lmsPal[i + 2]) / n)
              : ((r0 + linPal[i]) / n - t0) ** 2 + ((r1 + linPal[i + 1]) / n - t1) ** 2 + ((r2 + linPal[i + 2]) / n - t2) ** 2;
            if (err < bestErr) {
              bestErr = err;
              best = nearIdx[k];
            }
          }
          out[n - 1] = best;
          r0 += linPal[best * 3]; r1 += linPal[best * 3 + 1]; r2 += linPal[best * 3 + 2];
          l0 += lmsPal[best * 3]; l1 += lmsPal[best * 3 + 1]; l2 += lmsPal[best * 3 + 2];
        }
        return { out, err: blendErr(l0 / PLAN_SIZE, l1 / PLAN_SIZE, l2 / PLAN_SIZE) };
      };

      const planFor = (r, g, b) => {
        const key = (r << 16) | (g << 8) | b;
        let plan = plans.get(key);
        if (plan) return plan;

        const a = closestIdx(r, g, b) * 3;
        const t0 = linPal[a] + ditherAmount * (sRGBtoLinear[r] - linPal[a]);
        const t1 = linPal[a + 1] + ditherAmount * (sRGBtoLinear[g] - linPal[a + 1]);
        const t2 = linPal[a + 2] + ditherAmount * (sRGBtoLinear[b] - linPal[a + 2]);
        linearToLmsInto(t0, t1, t2, target);
        lmsToOklabInto(target[0], target[1], target[2], target);

        // Two candidate plans, kept by whichever blend looks closer: scoring in linear RGB finds near-exact
        // mixes when the palette surrounds the color (e.g. RGB-cube palettes), scoring in Oklab finds the
        // closest-looking compromise when it can't be reached (linear RGB over-weights bright channels and
        // flattens shadows there).
        const linear = greedy(
          selectNearest((i) => (linPal[i * 3] - t0) ** 2 + (linPal[i * 3 + 1] - t1) ** 2 + (linPal[i * 3 + 2] - t2) ** 2),
          false, t0, t1, t2
        );
        const perceptual = greedy(
          selectNearest((i) => colorDistOklabSq(precomputed[i].L, precomputed[i].a, precomputed[i].b, target[0], target[1], target[2])),
          true, t0, t1, t2
        );
        plan = (perceptual.err < linear.err ? perceptual : linear).out;
        plan.sort((p, q) => luma[p] - luma[q]);
        plans.set(key, plan);
        return plan;
      };

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const byteIdx = (y * w + x) * 4;
          if (data[byteIdx + 3] === 0) continue;

          const plan = planFor(data[byteIdx], data[byteIdx + 1], data[byteIdx + 2]);
          const threshold = bayerMatrix[((y & bayerMask) << bayerShift) | (x & bayerMask)] + 0.5;
          const chosen = precomputed[plan[Math.floor(threshold * PLAN_SIZE)]].rgb;
          data[byteIdx] = chosen[0];
          data[byteIdx + 1] = chosen[1];
          data[byteIdx + 2] = chosen[2];
        }
      }
      return buf;
    }

    // Error diffusion below carries error in linear light, as the eye averages neighboring pixels there;
    // in sRGB values mid-greys come out too light.

    // 2. Atkinson Dithering
    if (ditherType === 'atkinson') {
      const fR = new Float32Array(w * h);
      const fG = new Float32Array(w * h);
      const fB = new Float32Array(w * h);

      for (let i = 0; i < w * h; i++) {
        fR[i] = sRGBtoLinear[data[i * 4]];
        fG[i] = sRGBtoLinear[data[i * 4 + 1]];
        fB[i] = sRGBtoLinear[data[i * 4 + 2]];
      }

      function diffuseAtkinson(nx, ny, dR, dG, dB) {
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const nIdx = ny * w + nx;
          if (data[nIdx * 4 + 3] > 0) {
            fR[nIdx] += dR;
            fG[nIdx] += dG;
            fB[nIdx] += dB;
          }
        }
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          const byteIdx = idx * 4;
          if (data[byteIdx + 3] === 0) continue;

          // Only the lookup is clamped; the error keeps any overshoot so the local average holds
          const curR = fR[idx];
          const curG = fG[idx];
          const curB = fB[idx];

          const closest = findClosest(linearToSRGB(curR), linearToSRGB(curG), linearToSRGB(curB));
          data[byteIdx] = closest[0];
          data[byteIdx + 1] = closest[1];
          data[byteIdx + 2] = closest[2];

          const errR = (curR - sRGBtoLinear[closest[0]]) * ditherAmount;
          const errG = (curG - sRGBtoLinear[closest[1]]) * ditherAmount;
          const errB = (curB - sRGBtoLinear[closest[2]]) * ditherAmount;

          const dR = errR * 0.125;
          const dG = errG * 0.125;
          const dB = errB * 0.125;

          // Diffuses 1/8 of error to 6 neighbors, discards remaining 2/8 (25%)
          diffuseAtkinson(x + 1, y, dR, dG, dB);
          diffuseAtkinson(x + 2, y, dR, dG, dB);
          diffuseAtkinson(x - 1, y + 1, dR, dG, dB);
          diffuseAtkinson(x, y + 1, dR, dG, dB);
          diffuseAtkinson(x + 1, y + 1, dR, dG, dB);
          diffuseAtkinson(x, y + 2, dR, dG, dB);
        }
      }
      return buf;
    }

    // 3. Serpentine Error Diffusion (Floyd-Steinberg, Burkes, Sierra-3, Sierra-2, Sierra Lite)
    const diffusionKernel = DIFFUSION_KERNELS[ditherType];
    if (diffusionKernel) {
      const fR = new Float32Array(w * h);
      const fG = new Float32Array(w * h);
      const fB = new Float32Array(w * h);

      for (let i = 0; i < w * h; i++) {
        fR[i] = sRGBtoLinear[data[i * 4]];
        fG[i] = sRGBtoLinear[data[i * 4 + 1]];
        fB[i] = sRGBtoLinear[data[i * 4 + 2]];
      }

      function diffuse(nx, ny, weight, eR, eG, eB) {
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const nIdx = ny * w + nx;
          if (data[nIdx * 4 + 3] > 0) {
            fR[nIdx] += eR * weight;
            fG[nIdx] += eG * weight;
            fB[nIdx] += eB * weight;
          }
        }
      }

      const kLen = diffusionKernel.length;

      for (let y = 0; y < h; y++) {
        const isEven = (y & 1) === 0;
        const dir = isEven ? 1 : -1;
        const startX = isEven ? 0 : w - 1;
        const endX = isEven ? w : -1;

        for (let x = startX; x !== endX; x += dir) {
          const idx = y * w + x;
          const byteIdx = idx * 4;
          if (data[byteIdx + 3] === 0) continue;

          // Only the lookup is clamped; the error keeps any overshoot so the local average holds
          const curR = fR[idx];
          const curG = fG[idx];
          const curB = fB[idx];

          const closest = findClosest(linearToSRGB(curR), linearToSRGB(curG), linearToSRGB(curB));
          data[byteIdx] = closest[0];
          data[byteIdx + 1] = closest[1];
          data[byteIdx + 2] = closest[2];

          const errR = (curR - sRGBtoLinear[closest[0]]) * ditherAmount;
          const errG = (curG - sRGBtoLinear[closest[1]]) * ditherAmount;
          const errB = (curB - sRGBtoLinear[closest[2]]) * ditherAmount;

          for (let k = 0; k < kLen; k += 3) {
            diffuse(x + diffusionKernel[k] * dir, y + diffusionKernel[k + 1], diffusionKernel[k + 2], errR, errG, errB);
          }
        }
      }
      return buf;
    }

    // 4. Default / 'none': direct snap to closest palette color
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const byteIdx = (y * w + x) * 4;
        if (data[byteIdx + 3] === 0) continue;

        const closest = findClosest(data[byteIdx], data[byteIdx + 1], data[byteIdx + 2]);
        data[byteIdx] = closest[0];
        data[byteIdx + 1] = closest[1];
        data[byteIdx + 2] = closest[2];
      }
    }
    return buf;
  }

  // --- Step 2: Refine Edges (Priority 2 / Defringe before color processing) ---
  function refineEdges(buf, threshold) {
    if (threshold <= 0) return buf;
    const data = buf.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      if (data[i + 3] > threshold) {
        data[i + 3] = 255;
      } else {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      }
    }
    return buf;
  }

  // --- Step 4.5: Despeckler (Priority 20) ---
  // A pixel is a speck when none of its 8 neighbors shares its color. Diagonal contact counts, so 1px
  // diagonal lines and checkerboard dithers survive. A speck takes the weighted-majority neighbor
  // (orthogonal 2, diagonal 1, transparency included); ties go to the color closest to the speck.
  const DESPECKLE_NEIGHBORS = [
    [0, -1, 2], [0, 1, 2], [-1, 0, 2], [1, 0, 2],
    [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
  ];

  function despeckle(buf, options = {}) {
    const w = buf.width;
    const h = buf.height;
    const data = buf.data;
    const deltaThresh = options.despeckleDistance !== undefined ? options.despeckleDistance : 0.02;
    const deltaThreshSq = deltaThresh * deltaThresh;
    const groupThreshSq = 0.0025; // neighbors within deltaE 0.05 vote as one color
    const iterations = options.iterations || 1;
    const TRANSPARENT = -1;

    for (let iter = 0; iter < iterations; iter++) {
      const oklab = new Float32Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        if (data[i * 4 + 3] > 0) {
          const lab = rgbToOklab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
          oklab[i * 3] = lab[0];
          oklab[i * 3 + 1] = lab[1];
          oklab[i * 3 + 2] = lab[2];
        }
      }
      const distSq = (i, j) => {
        const dL = oklab[i * 3] - oklab[j * 3];
        const da = oklab[i * 3 + 1] - oklab[j * 3 + 1];
        const db = oklab[i * 3 + 2] - oklab[j * 3 + 2];
        return dL * dL + da * da + db * db;
      };

      const replacements = new Map();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (data[i * 4 + 3] === 0) continue;

          // groups: [representative pixel index or TRANSPARENT, summed weight]
          const groups = [];
          let isSpeck = true;
          for (const [dx, dy, weight] of DESPECKLE_NEIGHBORS) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const n = ny * w + nx;
            let key = TRANSPARENT;
            if (data[n * 4 + 3] > 0) {
              if (distSq(i, n) < deltaThreshSq) {
                isSpeck = false;
                break;
              }
              key = n;
            }
            const grp = groups.find(([rep]) => rep === key
              || (rep !== TRANSPARENT && key !== TRANSPARENT && distSq(rep, key) < groupThreshSq));
            if (grp) grp[1] += weight;
            else groups.push([key, weight]);
          }
          if (!isSpeck || groups.length === 0) continue;

          let best = groups[0];
          for (let g = 1; g < groups.length; g++) {
            const cand = groups[g];
            if (cand[1] > best[1]) {
              best = cand;
            } else if (cand[1] === best[1] && cand[0] !== TRANSPARENT
              && (best[0] === TRANSPARENT || distSq(i, cand[0]) < distSq(i, best[0]))) {
              best = cand;
            }
          }
          const src = best[0];
          replacements.set(i, src === TRANSPARENT ? [0, 0, 0, 0] : data.slice(src * 4, src * 4 + 4));
        }
      }

      for (const [i, rgba] of replacements) data.set(rgba, i * 4);
    }

    return buf;
  }

  // --- Step 5: Smoother (Priority 30) ---
  function smooth(buf, factor, iterations = 1) {
    if (factor <= 0 || iterations < 1) return buf;
    const w = buf.width;
    const h = buf.height;

    for (let iter = 0; iter < iterations; iter++) {
      const data = buf.data;
      const replacements = new Array(w * h).fill(null);

      // Precompute Oklab coordinates for color clustering
      const oklabData = new Float32Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        if (data[idx + 3] > 0) {
          const lab = rgbToOklab(data[idx], data[idx + 1], data[idx + 2]);
          oklabData[i * 3] = lab[0];
          oklabData[i * 3 + 1] = lab[1];
          oklabData[i * 3 + 2] = lab[2];
        }
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const alpha = data[idx + 3];
          if (alpha === 0) continue; // Skip transparent

          const flatIdx = y * w + x;
          const cr = data[idx], cg = data[idx + 1], cb = data[idx + 2];
          const colorKey = (cr << 16) | (cg << 8) | cb;
          const selfL = oklabData[flatIdx * 3];
          const selfA = oklabData[flatIdx * 3 + 1];
          const selfB = oklabData[flatIdx * 3 + 2];

          let opaqueNeighbors = 0;
          const clusters = [
            { key: colorKey, r: cr, g: cg, b: cb, L: selfL, aLab: selfA, bOk: selfB, weight: 1.5 }
          ];

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
                opaqueNeighbors++; // boundary counts as opaque neighbor
                continue;
              }
              const nFlat = ny * w + nx;
              const nIdx = nFlat * 4;
              const nAlpha = data[nIdx + 3];
              if (nAlpha > 128) {
                opaqueNeighbors++;
                const nr = data[nIdx], ng = data[nIdx + 1], nb = data[nIdx + 2];
                const nKey = (nr << 16) | (ng << 8) | nb;
                const nL = oklabData[nFlat * 3];
                const na = oklabData[nFlat * 3 + 1];
                const nbOk = oklabData[nFlat * 3 + 2];

                let matched = false;
                for (let c = 0; c < clusters.length; c++) {
                  const cl = clusters[c];
                  if (cl.key === nKey) {
                    cl.weight += 1.0;
                    matched = true;
                    break;
                  }
                  // Oklab deltaE < 0.05 => deltaE^2 < 0.0025
                  const dL = nL - cl.L;
                  const da = na - cl.aLab;
                  const db = nbOk - cl.bOk;
                  if (dL * dL + da * da + db * db < 0.0025) {
                    cl.weight += 1.0;
                    matched = true;
                    break;
                  }
                }
                if (!matched) {
                  clusters.push({
                    key: nKey,
                    r: nr,
                    g: ng,
                    b: nb,
                    L: nL,
                    aLab: na,
                    bOk: nbOk,
                    weight: 1.0
                  });
                }
              }
            }
          }

          // Capped at 3 so strength only removes isolated pixels, line tips, and 1px spurs; a higher cap
          // would strip corners (3 neighbors) and straight edges (5) on every pass
          if (opaqueNeighbors < Math.min(factor, 3)) {
            // Remove isolated stray pixel
            replacements[flatIdx] = [0, 0, 0, 0];
          } else {
            let topCluster = clusters[0];
            for (let c = 1; c < clusters.length; c++) {
              if (clusters[c].weight > topCluster.weight) {
                topCluster = clusters[c];
              }
            }
            if (topCluster.weight > 1 && topCluster.weight > (7 - factor * 1.75)) {
              if (topCluster !== clusters[0]) {
                replacements[flatIdx] = [topCluster.r, topCluster.g, topCluster.b, alpha];
              }
            }
          }
        }
      }

      // Second pass: apply replacements
      for (let i = 0; i < w * h; i++) {
        const rep = replacements[i];
        if (rep) {
          const byteIdx = i * 4;
          data[byteIdx] = rep[0];
          data[byteIdx + 1] = rep[1];
          data[byteIdx + 2] = rep[2];
          data[byteIdx + 3] = rep[3];
        }
      }
    }

    return buf;
  }

  // --- Step 6: Add Stroke / Outlines (Priority 45) ---
  function addStroke(buf, options) {
    const strokeType = options.stroke || 'none';
    const opacity = options.strokeOpacity !== undefined ? options.strokeOpacity : 1.0;
    const strokeOnColors = options.strokeOnColorsDiff || 0.0;
    const cleanCorners = !!options.strokeCleanCorners;

    if (opacity <= 0 || (strokeType === 'none' && strokeOnColors <= 0)) {
      return buf;
    }

    const w = buf.width;
    const h = buf.height;
    const data = buf.data;
    const diagonal = !!options.strokeDiagonal;

    let strokeColRgba = hexToRgba(options.strokeColor || '#000000');
    strokeColRgba[3] = Math.round(255 * opacity);

    // If stroke from palette requested, find color with lowest Oklab L*
    if (options.strokeFromPalette) {
      const pal = options.palette || options.customPalette || options.activePalette;
      if (pal && pal.length > 0) {
        let minL = Infinity;
        let darkestCol = [0, 0, 0];
        for (let i = 0; i < pal.length; i++) {
          const col = pal[i];
          let r, g, b;
          if (typeof col === 'string') {
            const rgba = hexToRgba(col);
            r = rgba[0]; g = rgba[1]; b = rgba[2];
          } else if (Array.isArray(col)) {
            r = col[0]; g = col[1]; b = col[2];
          } else if (col && typeof col === 'object') {
            r = col.r; g = col.g; b = col.b;
          } else {
            r = 0; g = 0; b = 0;
          }
          const L = rgbToOklab(r, g, b)[0];
          if (L < minL) {
            minL = L;
            darkestCol = [r, g, b];
          }
        }
        strokeColRgba = [darkestCol[0], darkestCol[1], darkestCol[2], strokeColRgba[3]];
      } else {
        let minL = Infinity;
        let darkestCol = [0, 0, 0];
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] >= 10) {
            const L = rgbToOklab(data[i], data[i + 1], data[i + 2])[0];
            if (L < minL) {
              minL = L;
              darkestCol = [data[i], data[i + 1], data[i + 2]];
            }
          }
        }
        strokeColRgba = [darkestCol[0], darkestCol[1], darkestCol[2], strokeColRgba[3]];
      }
    }

    const replaceTo = new Array(w * h).fill(null);

    function getPixelAt(x, y) {
      if (x < 0 || x >= w || y < 0 || y >= h) return [0, 0, 0, 0];
      const idx = (y * w + x) * 4;
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
    }

    function hasOpaqueNeighbor(x, y, thresh = 128, includeDiag = true) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (!includeDiag && Math.abs(dx) === Math.abs(dy)) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            if (data[(ny * w + nx) * 4 + 3] > thresh) return true;
          }
        }
      }
      return false;
    }

    function hasTransNeighbor(x, y, thresh = 128, includeDiag = true) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (!includeDiag && Math.abs(dx) === Math.abs(dy)) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) return true;
          if (data[(ny * w + nx) * 4 + 3] < thresh) return true;
        }
      }
      return false;
    }

    function isDifferentColor(c1, c2, colorDiffThresh) {
      const thresh = (1.0 - colorDiffThresh) * 255;
      const diff = (Math.abs(c1[0] - c2[0]) + Math.abs(c1[1] - c2[1]) + Math.abs(c1[2] - c2[2])) / 3;
      if (diff > thresh && c1[3] > 64 && c2[3] > 64) {
        const l1 = rgbToOklab(c1[0], c1[1], c1[2])[0];
        const l2 = rgbToOklab(c2[0], c2[1], c2[2])[0];
        if (Math.abs(l1 - l2) > 1e-4) {
          return l1 < l2; // Lower L* (darker side) gets the stroke
        }
        return pixelToInt(c1[0], c1[1], c1[2], c1[3]) < pixelToInt(c2[0], c2[1], c2[2], c2[3]);
      }
      return false;
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const flatIdx = y * w + x;
        const byteIdx = flatIdx * 4;
        const col = [data[byteIdx], data[byteIdx + 1], data[byteIdx + 2], data[byteIdx + 3]];

        let applyStroke = false;
        let blendWithSelf = false;

        if (strokeType === 'outside') {
          if (col[3] < 128 && hasOpaqueNeighbor(x, y, 128, diagonal)) {
            applyStroke = true;
          }
        } else if (strokeType === 'inside') {
          if (col[3] > 128 && hasTransNeighbor(x, y, 128, diagonal)) {
            applyStroke = true;
            blendWithSelf = opacity < 1.0;
          }
        } else if (strokeType === 'left' || strokeType === 'right') {
          const fac = strokeType === 'left' ? -1 : 1;
          if (col[3] > 128) {
            const neighbor = getPixelAt(x + fac, y);
            if (Math.abs(col[3] - neighbor[3]) > 64) {
              applyStroke = true;
              blendWithSelf = opacity < 1.0;
            }
          }
        } else if (strokeType === 'sides_out') {
          if (col[3] < 128) {
            if (getPixelAt(x + 1, y)[3] > 128 || getPixelAt(x - 1, y)[3] > 128) {
              applyStroke = true;
            }
          }
        } else if (strokeType === 'sides_in') {
          if (col[3] > 128) {
            if (getPixelAt(x + 1, y)[3] < 128 || getPixelAt(x - 1, y)[3] < 128) {
              applyStroke = true;
              blendWithSelf = opacity < 1.0;
            }
          }
        }

        if (applyStroke) {
          if (blendWithSelf) {
            replaceTo[flatIdx] = mergeColors(col, strokeColRgba, opacity);
          } else {
            replaceTo[flatIdx] = strokeColRgba;
          }
          continue;
        }

        // Color-difference stroke
        if (strokeOnColors > 0 && col[3] > 64 && !replaceTo[flatIdx]) {
          let hasDiff = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (!diagonal && Math.abs(dx) === Math.abs(dy)) continue;
              const neighbor = getPixelAt(x + dx, y + dy);
              if (isDifferentColor(col, neighbor, strokeOnColors)) {
                hasDiff = true;
                break;
              }
            }
            if (hasDiff) break;
          }
          if (hasDiff) {
            replaceTo[flatIdx] = mergeColors(col, strokeColRgba, opacity);
          }
        }
      }
    }

    // Optional corner cleanup: drop L-elbow pixels so outlines step diagonally (1px pixel-art lines).
    // Runs in place so each decision sees earlier removals; a pixel goes only if its outline neighbors stay
    // 8-connected without it and it doesn't sit edge-on against the region it outlines (that would open a gap).
    if (cleanCorners) {
      const isStroke = (x, y) => x >= 0 && x < w && y >= 0 && y < h && replaceTo[y * w + x] !== null;
      const opaqueAt = (x, y) => x >= 0 && x < w && y >= 0 && y < h && data[(y * w + x) * 4 + 3] > 128;
      const NEIGHBORS_8 = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!isStroke(x, y)) continue;
          const hx = isStroke(x - 1, y) !== isStroke(x + 1, y) ? (isStroke(x - 1, y) ? -1 : 1) : 0;
          const vy = isStroke(x, y - 1) !== isStroke(x, y + 1) ? (isStroke(x, y - 1) ? -1 : 1) : 0;
          if (!hx || !vy || isStroke(x + hx, y + vy)) continue;

          const opaque = opaqueAt(x, y);
          let exposes = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && !isStroke(nx, ny) && opaqueAt(nx, ny) !== opaque) exposes = true;
          }
          if (exposes) continue;

          // Outline neighbors must stay one 8-connected group without this pixel
          const nbrs = NEIGHBORS_8.filter(([dx, dy]) => isStroke(x + dx, y + dy));
          const seen = [nbrs[0]];
          for (let i = 0; i < seen.length; i++) {
            for (const n of nbrs) {
              if (!seen.includes(n) && Math.abs(n[0] - seen[i][0]) <= 1 && Math.abs(n[1] - seen[i][1]) <= 1) seen.push(n);
            }
          }
          if (seen.length === nbrs.length) replaceTo[y * w + x] = null;
        }
      }
    }

    // Second pass: apply stroke
    for (let i = 0; i < w * h; i++) {
      const rep = replaceTo[i];
      if (rep) {
        const byteIdx = i * 4;
        data[byteIdx] = rep[0];
        data[byteIdx + 1] = rep[1];
        data[byteIdx + 2] = rep[2];
        data[byteIdx + 3] = rep[3];
      }
    }

    return buf;
  }

  // --- Step 7: Add Background (Priority 65) ---
  function addBackground(buf, hexColor) {
    if (!hexColor || hexColor === '#00000000' || hexColor === 'transparent') {
      return buf;
    }
    const bg = hexToRgba(hexColor);
    const data = buf.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      if (data[i + 3] <= 0) {
        data[i] = bg[0];
        data[i + 1] = bg[1];
        data[i + 2] = bg[2];
        data[i + 3] = bg[3];
      }
    }
    return buf;
  }

  // --- Step 1 & 8: Resampling & Upscaling ---

  function downsampleBuffer(srcBuf, factor, method = 'box', snapInteger = false, pixelAspect = 1) {
    if (snapInteger) {
      factor = Math.max(1, Math.round(factor));
    } else {
      factor = Math.max(1.0, factor || 1.0);
    }
    const origW = srcBuf.width;
    const origH = srcBuf.height;
    // Wide hardware pixels (e.g. NES 8:7): horizontal factor stays fractional even when snapping
    const subW = Math.max(1, Math.floor(origW / (factor * (pixelAspect || 1))));
    const subH = Math.max(1, Math.floor(origH / factor));
    const dstBuf = { width: subW, height: subH, data: new Uint8ClampedArray(subW * subH * 4) };

    const srcData = srcBuf.data;
    const dstData = dstBuf.data;
    const scaleX = origW / subW;
    const scaleY = origH / subH;

    if (method === 'point') {
      for (let Y = 0; Y < subH; Y++) {
        const cy = Math.min(origH - 1, Math.floor((Y + 0.5) * scaleY));
        for (let X = 0; X < subW; X++) {
          const cx = Math.min(origW - 1, Math.floor((X + 0.5) * scaleX));
          const srcIdx = (cy * origW + cx) * 4;
          const dstIdx = (Y * subW + X) * 4;
          dstData[dstIdx] = srcData[srcIdx];
          dstData[dstIdx + 1] = srcData[srcIdx + 1];
          dstData[dstIdx + 2] = srcData[srcIdx + 2];
          dstData[dstIdx + 3] = srcData[srcIdx + 3];
        }
      }
    } else if (method === 'mode') {
      const counts = new Map();
      for (let Y = 0; Y < subH; Y++) {
        const y0 = Y * scaleY;
        const y1 = (Y === subH - 1) ? origH : (Y + 1) * scaleY;
        const syMin = Math.max(0, Math.floor(y0));
        const syMax = Math.min(origH - 1, Math.max(syMin, Math.floor(y1 - 1e-6)));
        const centerY = (y0 + y1) * 0.5;

        for (let X = 0; X < subW; X++) {
          const x0 = X * scaleX;
          const x1 = (X === subW - 1) ? origW : (X + 1) * scaleX;
          const sxMin = Math.max(0, Math.floor(x0));
          const sxMax = Math.min(origW - 1, Math.max(sxMin, Math.floor(x1 - 1e-6)));
          const centerX = (x0 + x1) * 0.5;

          counts.clear();

          for (let sy = syMin; sy <= syMax; sy++) {
            const py = sy + 0.5;
            const dy = py - centerY;
            for (let sx = sxMin; sx <= sxMax; sx++) {
              const px = sx + 0.5;
              const dx = px - centerX;
              const distSq = dx * dx + dy * dy;

              const idx = (sy * origW + sx) * 4;
              const r = srcData[idx];
              const g = srcData[idx + 1];
              const b = srcData[idx + 2];
              const a = srcData[idx + 3];
              const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;

              let entry = counts.get(key);
              if (!entry) {
                entry = { count: 1, minDistSq: distSq, r, g, b, a };
                counts.set(key, entry);
              } else {
                entry.count++;
                if (distSq < entry.minDistSq) {
                  entry.minDistSq = distSq;
                }
              }
            }
          }

          let best = null;
          for (const entry of counts.values()) {
            if (!best) {
              best = entry;
            } else if (entry.count > best.count) {
              best = entry;
            } else if (entry.count === best.count && entry.minDistSq < best.minDistSq) {
              best = entry;
            }
          }

          const dstIdx = (Y * subW + X) * 4;
          if (best) {
            dstData[dstIdx] = best.r;
            dstData[dstIdx + 1] = best.g;
            dstData[dstIdx + 2] = best.b;
            dstData[dstIdx + 3] = best.a;
          }
        }
      }
    } else {
      // Default: 'box' (Linear RGB area average)
      for (let Y = 0; Y < subH; Y++) {
        const y0 = Y * scaleY;
        const y1 = (Y === subH - 1) ? origH : (Y + 1) * scaleY;
        const syMin = Math.max(0, Math.floor(y0));
        const syMax = Math.min(origH - 1, Math.floor(y1));

        for (let X = 0; X < subW; X++) {
          const x0 = X * scaleX;
          const x1 = (X === subW - 1) ? origW : (X + 1) * scaleX;
          const sxMin = Math.max(0, Math.floor(x0));
          const sxMax = Math.min(origW - 1, Math.floor(x1));

          let rLinSum = 0;
          let gLinSum = 0;
          let bLinSum = 0;
          let aSum = 0;
          let totalWeight = 0;

          for (let sy = syMin; sy <= syMax; sy++) {
            const yStart = Math.max(y0, sy);
            const yEnd = Math.min(y1, sy + 1);
            const dy = yEnd - yStart;
            if (dy <= 0) continue;

            for (let sx = sxMin; sx <= sxMax; sx++) {
              const xStart = Math.max(x0, sx);
              const xEnd = Math.min(x1, sx + 1);
              const dx = xEnd - xStart;
              if (dx <= 0) continue;

              const weight = dx * dy;
              const idx = (sy * origW + sx) * 4;
              // Alpha-weighted (premultiplied) so transparent pixels don't tint edges
              const aw = srcData[idx + 3] * weight;

              rLinSum += sRGBtoLinear[srcData[idx]] * aw;
              gLinSum += sRGBtoLinear[srcData[idx + 1]] * aw;
              bLinSum += sRGBtoLinear[srcData[idx + 2]] * aw;
              aSum += aw;
              totalWeight += weight;
            }
          }

          const dstIdx = (Y * subW + X) * 4;
          if (aSum > 0) {
            dstData[dstIdx] = linearToSRGB(rLinSum / aSum);
            dstData[dstIdx + 1] = linearToSRGB(gLinSum / aSum);
            dstData[dstIdx + 2] = linearToSRGB(bLinSum / aSum);
            dstData[dstIdx + 3] = Math.max(0, Math.min(255, Math.round(aSum / totalWeight)));
          }
        }
      }
    }

    return dstBuf;
  }

  function calculatePixelateFactor(w, h, targetResolution = 256) {
    if (!targetResolution || targetResolution <= 0 || !w || !h) return 1.0;
    const maxDim = Math.max(w, h);
    const raw = Math.round((maxDim / targetResolution) * 2) / 2;
    return Math.min(50.0, Math.max(1.0, raw));
  }

  function downsampleCanvas(sourceCanvas, options) {
    if (typeof options === 'number') {
      options = { pixelate: options };
    }
    options = options || {};
    let factor = options.pixelate;
    if (factor === undefined && options.targetResolution) {
      factor = calculatePixelateFactor(sourceCanvas.width, sourceCanvas.height, options.targetResolution);
    }
    if (factor === undefined) factor = 1.0;
    const method = options.downsampleMethod || 'box';
    const snapInteger = !!options.snapInteger;

    let effectiveFactor = factor;
    if (snapInteger) {
      effectiveFactor = Math.max(1, Math.round(factor));
    } else {
      effectiveFactor = Math.max(1.0, factor || 1.0);
    }

    const pixelAspect = options.pixelAspect || 1;
    const origW = sourceCanvas.width;
    const origH = sourceCanvas.height;
    const subW = Math.max(1, Math.floor(origW / (effectiveFactor * pixelAspect)));
    const subH = Math.max(1, Math.floor(origH / effectiveFactor));

    let offCanvas;
    if (typeof document !== 'undefined') {
      offCanvas = document.createElement('canvas');
      offCanvas.width = subW;
      offCanvas.height = subH;
    } else if (typeof OffscreenCanvas !== 'undefined') {
      offCanvas = new OffscreenCanvas(subW, subH);
    } else {
      throw new Error('Canvas rendering context not available');
    }

    const ctx = offCanvas.getContext('2d', { willReadFrequently: true });

    if (method === 'canvas') {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceCanvas, 0, 0, subW, subH);
      const imgData = ctx.getImageData(0, 0, subW, subH);
      return { canvas: offCanvas, ctx, imgData, origW, origH, subW, subH };
    }

    let srcCtx = null;
    if (typeof sourceCanvas.getContext === 'function') {
      srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    }

    let srcData;
    if (srcCtx && typeof srcCtx.getImageData === 'function') {
      srcData = srcCtx.getImageData(0, 0, origW, origH);
    } else {
      let tempCanvas;
      if (typeof document !== 'undefined') {
        tempCanvas = document.createElement('canvas');
        tempCanvas.width = origW;
        tempCanvas.height = origH;
      } else if (typeof OffscreenCanvas !== 'undefined') {
        tempCanvas = new OffscreenCanvas(origW, origH);
      } else {
        throw new Error('Canvas rendering context not available');
      }
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      tempCtx.drawImage(sourceCanvas, 0, 0, origW, origH);
      srcData = tempCtx.getImageData(0, 0, origW, origH);
    }

    const dstBuf = downsampleBuffer(
      { width: origW, height: origH, data: srcData.data },
      factor,
      method,
      snapInteger,
      pixelAspect
    );

    let imgData;
    if (typeof ImageData !== 'undefined') {
      imgData = new ImageData(dstBuf.data, subW, subH);
    } else if (typeof ctx.createImageData === 'function') {
      imgData = ctx.createImageData(subW, subH);
      imgData.data.set(dstBuf.data);
    } else {
      imgData = { width: subW, height: subH, data: dstBuf.data };
    }

    ctx.putImageData(imgData, 0, 0);

    return { canvas: offCanvas, ctx, imgData, origW, origH, subW, subH };
  }

  function upscaleNearest(subImgData, targetW, targetH) {
    let outCanvas;
    if (typeof document !== 'undefined') {
      outCanvas = document.createElement('canvas');
      outCanvas.width = targetW;
      outCanvas.height = targetH;
    } else if (typeof OffscreenCanvas !== 'undefined') {
      outCanvas = new OffscreenCanvas(targetW, targetH);
    }
    const ctx = outCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    let tempCanvas;
    if (typeof document !== 'undefined') {
      tempCanvas = document.createElement('canvas');
      tempCanvas.width = subImgData.width;
      tempCanvas.height = subImgData.height;
    } else if (typeof OffscreenCanvas !== 'undefined') {
      tempCanvas = new OffscreenCanvas(subImgData.width, subImgData.height);
    }
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(subImgData, 0, 0);

    ctx.drawImage(tempCanvas, 0, 0, targetW, targetH);
    return outCanvas;
  }

  // --- Main Engine Entry Point ---

  function process(sourceCanvas, options = {}) {
    const tStart = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // 1. Downsample (Pixelate: Priority 0)
    const downsampled = downsampleCanvas(sourceCanvas, options);
    const buf = downsampled.imgData;

    // 2. Alpha Edge Refinement (Priority 2 / Defringe before color processing)
    if (options.refineEdges !== undefined && options.refineEdges > 0) {
      refineEdges(buf, options.refineEdges);
    }

    // 3. Color Enhancement (Priority 5)
    if (options.enhance !== undefined && options.enhance !== 1.0) {
      enhanceColors(buf, options.enhance);
    }

    // 4. Palette Reduction & Dithering (Priority 10)
    const paletteMode = options.paletteMode || 'adaptive';
    const quantizerMethod = options.quantizerMethod || 'wu';
    let activePalette = null;

    if (paletteMode === 'web') {
      activePalette = getWebPalette();
    } else if (paletteMode === 'preset' || paletteMode === 'custom' || paletteMode === 'file' || paletteMode === 'file_dither') {
      activePalette = options.customPalette || options.palette || null;
      if (activePalette && activePalette.length > 0 && options.paletteColors && (paletteMode === 'custom' || paletteMode === 'file' || paletteMode === 'file_dither')) {
        activePalette = samplePalette(activePalette, options.paletteColors);
      }
      if (!activePalette || activePalette.length === 0) {
        activePalette = buildAdaptivePalette(buf, options.paletteColors || 8, quantizerMethod);
      }
    } else if (paletteMode === 'mixed') {
      const adaptive = buildAdaptivePalette(buf, options.paletteColors || 8, quantizerMethod);
      activePalette = adaptive.concat(getWebPalette());
    } else {
      // adaptive
      activePalette = buildAdaptivePalette(buf, options.paletteColors || 8, quantizerMethod);
    }

    if (options.colorDepth > 0 && activePalette && activePalette.length > 0) {
      activePalette = snapPaletteDepth(activePalette, options.colorDepth);
    }

    let ditherType = options.ditherType;
    if (!ditherType) {
      if (options.paletteDither || paletteMode.includes('dither')) {
        ditherType = 'floyd';
      } else {
        ditherType = 'none';
      }
    }

    if (activePalette && activePalette.length > 0) {
      quantize(buf, activePalette, {
        ditherType,
        ditherAmount: options.ditherAmount,
        colorMetric: options.colorMetric
      });
    }

    // 4.5. Morphological Despeckler (Priority 20 - After quantize, before smooth/stroke)
    if (options.despeckle) {
      despeckle(buf, options);
    }

    // 5. Cellular Automaton Smoothing (Priority 30)
    if (options.smooth !== undefined && options.smooth > 0) {
      smooth(buf, options.smooth, options.smoothIter || 1);
    }

    // 5.5. Hardware Tile Color Limit (after smoothing so the limit holds in the final sprite)
    if ((options.tileSize === 'row' || options.tileSize > 0) && options.tileColors > 0) {
      const foreground = options.tileForeground > 0 && activePalette ? activePalette.slice(0, options.tileForeground) : null;
      limitTileColors(buf, options.tileSize, options.tileColors, options.tilePalettes || 0, !!options.tileSharedColor, foreground);
    }

    // 6. Stroke / Outline (Priority 45)
    if ((options.stroke && options.stroke !== 'none') || (options.strokeOnColorsDiff && options.strokeOnColorsDiff > 0)) {
      const strokeOpts = Object.assign({}, options);
      if (options.strokeFromPalette && activePalette) {
        strokeOpts.palette = activePalette;
        delete strokeOpts.customPalette;
      }
      addStroke(buf, strokeOpts);
    }

    // 7. Background Fill (Priority 65)
    if (options.background && options.background !== '#00000000') {
      addBackground(buf, options.background);
    }

    // 8. Output Sizing (Priority 0 Post-Process)
    downsampled.ctx.putImageData(buf, 0, 0);

    const outputWidth = options.resize ? downsampled.subW : downsampled.origW;
    const outputHeight = options.resize ? downsampled.subH : downsampled.origH;
    let outputCanvas = options.resize ? downsampled.canvas : null;

    const tEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const latencyMs = Math.round((tEnd - tStart) * 10) / 10;

    return {
      // Full-size nearest-neighbor upscale is built only on first access; the UI displays
      // subCanvas CSS-scaled to outputWidth x outputHeight and never needs it
      get canvas() {
        if (!outputCanvas) outputCanvas = upscaleNearest(buf, outputWidth, outputHeight);
        return outputCanvas;
      },
      outputWidth,
      outputHeight,
      subCanvas: downsampled.canvas,
      subWidth: downsampled.subW,
      subHeight: downsampled.subH,
      origWidth: downsampled.origW,
      origHeight: downsampled.origH,
      latencyMs,
      palette: activePalette || [],
      paletteCount: activePalette ? activePalette.length : 0
    };
  }

  return {
    process,
    calculatePixelateFactor,
    downsampleCanvas,
    downsampleBuffer,
    enhanceColors,
    extractPalette,
    countColors,
    samplePalette,
    snapPaletteDepth,
    limitTileColors,
    buildAdaptivePalette,
    buildWuPalette,
    buildMedianCutPalette,
    buildKMeansPalette,
    buildKMeansFastPalette,
    buildTwoStagePalette,
    kmeans: buildKMeansPalette,
    getWebPalette,
    quantize,
    refineEdges,
    despeckle,
    smooth,
    addStroke,
    addBackground,
    upscaleNearest,
    hexToRgba,
    rgbaToHex,
    sRGBtoLinear,
    linearToSRGB,
    rgbToOklab,
    oklabToRgb,
    colorDistOklabSq,
    precomputePaletteOklab,
    rgbToLab,
    ciede2000,
    precomputePaletteLab,
    BAYER_2,
    BAYER_4,
    BAYER_8,
    DIFFUSION_KERNELS
  };
});
