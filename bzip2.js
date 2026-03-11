/**
 * bzip2.js — Pure JavaScript BZip2 decompressor
 * Host this file at the same origin as index.html (GitHub Pages / CF Pages)
 * so the browser never needs to fetch from an external CDN.
 * Exposes: window.Bzip2.decompress(Uint8Array) -> Uint8Array
 */
(function (root) {
  'use strict';

  // ── Bit reader ────────────────────────────────────────────────
  function BitReader(u8) {
    this.buf  = u8;
    this.pos  = 0;   // byte position
    this.bits = 0;   // current byte
    this.left = 0;   // bits remaining in current byte
  }
  BitReader.prototype.bit = function () {
    if (!this.left) {
      if (this.pos >= this.buf.length) throw new Error('BZ2: unexpected EOF');
      this.bits = this.buf[this.pos++];
      this.left = 8;
    }
    return (this.bits >> --this.left) & 1;
  };
  BitReader.prototype.read = function (n) {
    var v = 0;
    for (var i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  };

  // ── Huffman table builder ─────────────────────────────────────
  function buildHuff(lens, n) {
    var MAXL = 20, l, i;
    var cnt   = new Int32Array(MAXL + 1);
    var maxL  = 1;
    for (i = 0; i < n; i++) { if (lens[i]) { cnt[lens[i]]++; if (lens[i] > maxL) maxL = lens[i]; } }

    var code  = 0;
    var start = new Int32Array(MAXL + 1);
    for (l = 1; l <= MAXL; l++) { start[l] = code; code = (code + cnt[l]) << 1; }

    var perm  = new Uint16Array(n);
    var pi    = 0;
    for (l = 1; l <= maxL; l++)
      for (i = 0; i < n; i++)
        if (lens[i] === l) perm[pi++] = i;

    var limit = new Int32Array(MAXL + 1);
    var base  = new Int32Array(MAXL + 1);
    var cum   = 0;
    for (l = 1; l <= MAXL; l++) {
      limit[l] = cnt[l] ? start[l] + cnt[l] - 1 : -1;
      base[l]  = start[l] - cum;
      cum += cnt[l];
    }
    return { limit: limit, base: base, perm: perm, maxL: maxL };
  }

  function decSym(h, br) {
    var v = 0;
    for (var l = 1; l <= h.maxL; l++) {
      v = (v << 1) | br.bit();
      if (h.limit[l] >= 0 && v <= h.limit[l])
        return h.perm[v - h.base[l]];
    }
    throw new Error('BZ2: Huffman overrun');
  }

  // ── Main decompressor ─────────────────────────────────────────
  function decompress(input) {
    if (!(input instanceof Uint8Array)) input = new Uint8Array(input);
    var br = new BitReader(input);

    if (br.read(8) !== 0x42 || br.read(8) !== 0x5A || br.read(8) !== 0x68)
      throw new Error('BZ2: not a bzip2 stream');
    var blockSizeMult = br.read(8) - 0x30; // '1'-'9'

    var outChunks = [];

    for (;;) {
      var m1 = br.read(24), m2 = br.read(24);

      // End-of-stream magic: 0x177245_385090  (√π × 10^10)
      if (m1 === 0x177245 && m2 === 0x385090) break;

      // Block magic: 0x314159_265359  (π × 10^10)
      if (m1 !== 0x314159 || m2 !== 0x265359)
        throw new Error('BZ2: bad block magic 0x' + m1.toString(16) + m2.toString(16));

      br.read(32); // block CRC — skip verification
      br.read(1);  // randomised flag — always 0 in practice
      var origPtr = br.read(24);

      // ── Symbol in-use table ──────────────────────────────────
      var inUse = [];
      var bigMap = br.read(16);
      for (var ig = 0; ig < 16; ig++) {
        if ((bigMap >> (15 - ig)) & 1) {
          var sm = br.read(16);
          for (var jg = 0; jg < 16; jg++)
            if ((sm >> (15 - jg)) & 1)
              inUse.push(ig * 16 + jg);
        }
      }
      var nInUse   = inUse.length;
      var alphaSize = nInUse + 2;  // RUNA(0), RUNB(1), bytes(2..nInUse+1 via MTF), EOB=alphaSize-1
      var EOB      = nInUse + 1;

      // ── Huffman groups & selectors ───────────────────────────
      var nGroups    = br.read(3);
      var nSelectors = br.read(15);

      var selMTF = [];
      for (var gi = 0; gi < nGroups; gi++) selMTF.push(gi);
      var selectors = new Uint8Array(nSelectors);
      for (var si = 0; si < nSelectors; si++) {
        var sj = 0; while (br.bit()) sj++;
        var sv = selMTF.splice(sj, 1)[0];
        selMTF.unshift(sv);
        selectors[si] = sv;
      }

      // ── Huffman code lengths ─────────────────────────────────
      var huffTables = [];
      for (var ti = 0; ti < nGroups; ti++) {
        var lens = new Uint8Array(alphaSize);
        var l = br.read(5);
        for (var li = 0; li < alphaSize; li++) {
          while (br.bit()) l += br.bit() ? -1 : 1;
          if (l < 1 || l > 20) throw new Error('BZ2: bad code length ' + l);
          lens[li] = l;
        }
        huffTables.push(buildHuff(lens, alphaSize));
      }

      // ── MTF state ─────────────────────────────────────────────
      var symMTF = [];
      for (var mi = 0; mi < nInUse; mi++) symMTF.push(mi);

      // ── Decode Huffman stream → BWT block ────────────────────
      var maxBlock = blockSizeMult * 100000;
      var tt       = new Uint32Array(maxBlock);
      var nblock   = 0;
      var gIdx = 0, gPos = 50, curH = null;

      function nextSym() {
        if (gPos >= 50) {
          gPos = 0;
          if (gIdx >= nSelectors) throw new Error('BZ2: selector overrun');
          curH = huffTables[selectors[gIdx++]];
        }
        gPos++;
        return decSym(curH, br);
      }

      var zvec = nextSym();
      while (zvec !== EOB) {
        if (zvec === 0 || zvec === 1) {
          // ── RUNA / RUNB: decode bijective base-2 run length ──
          // bzip2 source starts es=-1 so that es++ at end gives correct count
          var es = -1, N = 1;
          do {
            es += (zvec === 0 ? 1 : 2) * N;
            N  *= 2;
            zvec = nextSym();
          } while (zvec === 0 || zvec === 1);
          es++; // now es = correct run length
          var uc = inUse[symMTF[0]];
          if (nblock + es > maxBlock) throw new Error('BZ2: block overflow');
          for (var ri = 0; ri < es; ri++) tt[nblock++] = uc;
          if (zvec === EOB) break;
          // fall through: process zvec (the non-run symbol that ended the run)
        }
        // ── Regular byte symbol (zvec >= 2) ──────────────────
        var mtfIdx = zvec - 1;
        var byteRef = symMTF.splice(mtfIdx, 1)[0];
        symMTF.unshift(byteRef);
        if (nblock >= maxBlock) throw new Error('BZ2: block overflow');
        tt[nblock++] = inUse[byteRef];
        zvec = nextSym();
      }

      // ── Inverse BWT ──────────────────────────────────────────
      // Step 1: cumulative frequency table
      var cftab = new Int32Array(256);
      for (var ci = 0; ci < nblock; ci++) cftab[tt[ci]]++;
      var sum = 0;
      for (var ki = 0; ki < 256; ki++) {
        var tmp = cftab[ki]; cftab[ki] = sum; sum += tmp;
      }
      // cftab[c] now = number of characters < c in the block

      // Step 2: build LF mapping into tt.
      // CRITICAL: snapshot original chars first — the in-place loop corrupts tt[bi]
      // before we read it if cftab2[prev_ch] happened to equal bi.
      var origChars = new Uint8Array(nblock);
      for (var bi = 0; bi < nblock; bi++) origChars[bi] = tt[bi] & 0xFF;
      var cftab2 = cftab.slice();
      for (var bi = 0; bi < nblock; bi++) {
        var ch = origChars[bi];
        tt[cftab2[ch]] = ch | (bi << 8);  // low byte = char at sorted pos, high = source pos
        cftab2[ch]++;
      }

      // Step 3: traverse LF chain from origPtr
      var blockOut = new Uint8Array(nblock);
      var tPos = origPtr;
      for (var oi = 0; oi < nblock; oi++) {
        blockOut[oi] = tt[tPos] & 0xFF;
        tPos         = tt[tPos] >> 8;
      }


      // Step 4: Inverse RLE1 — track consecutive runs in INPUT (blockOut).
      // When 4 identical bytes seen, next byte is extra repeat count (0-255).
      // After consuming the count byte, reset the run tracker entirely.
      var rle = [];
      var rleRun = 0, rleLast = -1;
      for (var ri = 0; ri < nblock; ri++) {
        var b = blockOut[ri];
        rle.push(b);
        if (b === rleLast) {
          rleRun++;
          if (rleRun === 4) {
            var extra = (ri + 1 < nblock) ? blockOut[++ri] : 0;
            for (var ex = 0; ex < extra; ex++) rle.push(b);
            rleRun = 0; rleLast = -1; // full reset after consuming count byte
          }
        } else {
          rleRun = 1; rleLast = b;
        }
      }
      outChunks.push(new Uint8Array(rle));
    }

    // ── Concatenate blocks ────────────────────────────────────
    var total = 0;
    for (var xi = 0; xi < outChunks.length; xi++) total += outChunks[xi].length;
    var result = new Uint8Array(total);
    var off = 0;
    for (var yi = 0; yi < outChunks.length; yi++) {
      result.set(outChunks[yi], off);
      off += outChunks[yi].length;
    }
    return result;
  }

  root.Bzip2 = { decompress: decompress };

}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
