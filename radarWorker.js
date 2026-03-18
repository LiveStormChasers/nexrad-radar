// radarWorker.js — NEXRAD renderer, WebGL CustomLayer mesh approach
// Outputs flat gate×ray RGBA image + great-circle corner grid for exact georeferencing.
// The main thread's RadarCustomLayer draws one WebGL quad per gate×ray cell positioned
// at its true great-circle lat/lon — same approach as OpenSnow's radarWorker.

importScripts('bzip2.js');

// ── OpenSnow exact reflectivity color table (196 stops, -3 to 94.5 dBZ, 0.5 step) ──
const COLOR_TABLE = new Map([
  [-3,[168,171,152]],[-2.5,[163,167,151]],[-2,[158,163,150]],[-1.5,[154,159,149]],
  [-1,[149,155,148]],[-0.5,[144,151,147]],[0,[139,147,146]],[0.5,[135,144,145]],
  [1,[130,140,144]],[1.5,[125,136,143]],[2,[120,132,142]],[2.5,[115,128,142]],
  [3,[111,124,141]],[3.5,[106,120,140]],[4,[101,116,139]],[4.5,[96,112,138]],
  [5,[92,109,137]],[5.5,[87,105,136]],[6,[82,101,135]],[6.5,[77,97,134]],
  [7,[73,93,133]],[7.5,[68,89,132]],[8,[63,85,131]],[8.5,[58,81,130]],
  [9,[54,78,130]],[9.5,[55,81,132]],[10,[57,85,134]],[10.5,[59,89,136]],
  [11,[61,93,138]],[11.5,[63,97,141]],[12,[65,101,143]],[12.5,[67,105,145]],
  [13,[69,109,147]],[13.5,[71,113,149]],[14,[73,117,152]],[14.5,[74,121,154]],
  [15,[76,125,156]],[15.5,[78,129,158]],[16,[80,133,160]],[16.5,[82,137,163]],
  [17,[84,141,165]],[17.5,[86,145,167]],[18,[88,149,169]],[18.5,[90,153,171]],
  [19,[92,157,174]],[19.5,[76,165,142]],[20,[60,173,110]],[20.5,[45,182,78]],
  [21,[42,175,72]],[21.5,[39,169,67]],[22,[37,163,62]],[22.5,[34,156,56]],
  [23,[31,150,51]],[23.5,[29,144,46]],[24,[26,137,40]],[24.5,[24,131,35]],
  [25,[21,125,30]],[25.5,[18,118,24]],[26,[16,112,19]],[26.5,[13,106,14]],
  [27,[11,100,9]],[27.5,[35,115,8]],[28,[59,130,7]],[28.5,[83,145,6]],
  [29,[107,161,5]],[29.5,[131,176,4]],[30,[155,191,3]],[30.5,[179,207,2]],
  [31,[203,222,1]],[31.5,[227,237,0]],[32,[252,253,0]],[32.5,[248,248,0]],
  [33,[244,243,0]],[33.5,[241,238,0]],[34,[237,233,0]],[34.5,[233,228,0]],
  [35,[230,223,0]],[35.5,[226,218,0]],[36,[222,213,0]],[36.5,[219,208,0]],
  [37,[215,203,0]],[37.5,[211,198,0]],[38,[208,193,0]],[38.5,[204,188,0]],
  [39,[200,183,0]],[39.5,[197,179,0]],[40,[250,148,0]],[40.5,[246,144,0]],
  [41,[242,141,1]],[41.5,[238,138,1]],[42,[234,135,2]],[42.5,[231,132,3]],
  [43,[227,129,3]],[43.5,[223,126,4]],[44,[219,123,5]],[44.5,[215,120,5]],
  [45,[212,116,6]],[45.5,[208,113,6]],[46,[204,110,7]],[46.5,[200,107,8]],
  [47,[196,104,8]],[47.5,[193,101,9]],[48,[189,98,10]],[48.5,[185,95,10]],
  [49,[181,92,11]],[49.5,[178,89,12]],[50,[249,35,11]],[50.5,[242,35,12]],
  [51,[236,35,13]],[51.5,[230,35,14]],[52,[223,36,15]],[52.5,[217,36,16]],
  [53,[211,36,17]],[53.5,[205,36,18]],[54,[198,37,19]],[54.5,[192,37,20]],
  [55,[186,37,22]],[55.5,[180,37,23]],[56,[173,38,24]],[56.5,[167,38,25]],
  [57,[161,38,26]],[57.5,[155,38,27]],[58,[148,39,28]],[58.5,[142,39,29]],
  [59,[136,39,30]],[59.5,[130,40,32]],[60,[202,153,180]],[60.5,[201,146,176]],
  [61,[201,139,173]],[61.5,[200,133,169]],[62,[200,126,166]],[62.5,[199,120,162]],
  [63,[199,113,159]],[63.5,[199,106,155]],[64,[198,100,152]],[64.5,[198,93,148]],
  [65,[197,87,145]],[65.5,[197,80,141]],[66,[196,74,138]],[66.5,[196,67,134]],
  [67,[196,60,131]],[67.5,[195,54,127]],[68,[195,47,124]],[68.5,[194,41,120]],
  [69,[194,34,117]],[69.5,[194,28,114]],[70,[154,36,224]],[70.5,[149,34,219]],
  [71,[144,33,215]],[71.5,[139,32,210]],[72,[134,31,206]],[72.5,[129,30,201]],
  [73,[124,29,197]],[73.5,[120,28,193]],[74,[115,27,188]],[74.5,[110,26,184]],
  [75,[105,24,179]],[75.5,[100,23,175]],[76,[95,22,170]],[76.5,[91,21,166]],
  [77,[86,20,162]],[77.5,[81,19,157]],[78,[76,18,153]],[78.5,[71,17,148]],
  [79,[66,16,144]],[79.5,[62,15,140]],[80,[132,253,255]],[80.5,[128,245,249]],
  [81,[125,238,243]],[81.5,[121,231,237]],[82,[118,224,231]],[82.5,[115,217,225]],
  [83,[111,210,219]],[83.5,[108,203,213]],[84,[105,196,207]],[84.5,[101,189,201]],
  [85,[98,181,196]],[85.5,[94,174,190]],[86,[91,167,184]],[86.5,[88,160,178]],
  [87,[84,153,172]],[87.5,[81,146,166]],[88,[78,139,160]],[88.5,[74,132,154]],
  [89,[71,125,148]],[89.5,[68,118,143]],[90,[161,101,73]],[90.5,[155,90,65]],
  [91,[150,80,56]],[91.5,[145,70,48]],[92,[140,60,40]],[92.5,[135,50,32]],
  [93,[130,40,24]],[93.5,[125,30,16]],[94,[120,20,8]],[94.5,[115,10,1]]
]);

function dbzToRGBA(dbz) {
  if (dbz < 1) return null;
  const key = Math.floor(dbz * 2) / 2;
  return COLOR_TABLE.get(Math.min(94.5, key)) || null;
}

// Fast palette for compact integer vals
const RGBA_PAL = new Uint8Array(256 * 4);
for (let val = 2; val <= 255; val++) {
  const dbz = -32 + (val - 2) * 0.5;
  const rgb = dbzToRGBA(dbz);
  if (rgb) {
    const s = val * 4;
    RGBA_PAL[s] = rgb[0]; RGBA_PAL[s+1] = rgb[1]; RGBA_PAL[s+2] = rgb[2]; RGBA_PAL[s+3] = 255;
  }
}


// ── Compact binary parser ─────────────────────────────────────────────────
function parseCompact(buf) {
  const data = new Uint8Array(buf);
  const dv   = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x52444152) throw new Error('Bad magic');
  const numAz       = dv.getUint32(4,  true);
  const numGates    = dv.getUint32(8,  true);
  const firstRangeM = dv.getFloat32(12, true);
  const gateSizeM   = dv.getFloat32(16, true);
  const maxRangeKm  = dv.getFloat32(20, true);
  const gateOffset  = 24 + numAz * 4;
  return { data, numAz, numGates, firstRangeM, gateSizeM, maxRangeKm, gateOffset };
}


// ── Level-2 parser ────────────────────────────────────────────────────────
function parseLevel2(raw) {
  let data = new Uint8Array(raw);
  const sig = (data[0] << 8) | data[1];
  if (sig === 0x425A) {
    try { data = Bzip2.decompress(data); } catch(e) {}
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 24;
  const NUM_AZ = 720;
  let radialData = null, numGates = 0, firstGateM = 0, gateSizeM = 0;

  while (pos + 4 <= data.length) {
    const recSizeRaw = dv.getInt32(pos, false);
    pos += 4;
    if (recSizeRaw === 0) break;
    const recSize = Math.abs(recSizeRaw);
    if (pos + recSize > data.length) break;
    let chunk;
    if (recSizeRaw < 0) {
      chunk = data.slice(pos, pos + recSize);
    } else {
      try { chunk = Bzip2.decompress(data.slice(pos, pos + recSize)); }
      catch(e) { pos += recSize; continue; }
    }
    pos += recSize;
    let mpos = 0;
    while (mpos + 28 <= chunk.length) {
      const segsHW  = (chunk[mpos+12] << 8) | chunk[mpos+13];
      const msgType = chunk[mpos+15];
      const msgBytes = 12 + segsHW * 2;
      if (msgType === 31) parseMsg31(chunk, mpos + 28);
      mpos += Math.max(msgBytes, 28);
    }
  }

  function parseMsg31(chunk, base) {
    if (base + 68 > chunk.length) return;
    const dv2 = new DataView(chunk.buffer, chunk.byteOffset + base);
    if (dv2.getUint8(22) !== 1) return;
    const az    = dv2.getFloat32(12, false);
    const azBin = Math.floor(((az % 360 + 360) % 360) * 2) % NUM_AZ;
    const nBlocks = dv2.getUint16(30, false);
    for (let b = 0; b < nBlocks && b < 10; b++) {
      if (base + 32 + (b+1)*4 > chunk.length) break;
      const ptr   = dv2.getUint32(32 + b*4, false);
      const bbase = chunk.byteOffset + base + ptr;
      if (bbase + 28 > chunk.byteOffset + chunk.length) continue;
      if (chunk[bbase] !== 68) continue;
      if (chunk[bbase+1]!==82||chunk[bbase+2]!==69||chunk[bbase+3]!==70) continue;
      const bdv = new DataView(chunk.buffer, bbase);
      const ng  = bdv.getUint16(8,  false);
      const fg  = bdv.getUint16(10, false);
      const gs  = bdv.getUint16(12, false);
      const scl = bdv.getFloat32(20, false);
      const ofs = bdv.getFloat32(24, false);
      if (!radialData) { numGates=ng; firstGateM=fg; gateSizeM=gs; radialData=new Float32Array(NUM_AZ*ng).fill(-999); }
      const dataOff = base + ptr + 28;
      for (let g = 0; g < ng; g++) {
        if (dataOff + g >= chunk.length) break;
        const rv = chunk[chunk.byteOffset + dataOff + g];
        radialData[azBin*numGates+g] = rv<=1 ? -999 : (rv-ofs)/scl;
      }
      break;
    }
  }
  return { radialData, numGates, firstGateM, gateSizeM, NUM_AZ };
}


// ── Great-circle corner grid ──────────────────────────────────────────────
// Computes (nRays+1) × (nGates+1) corner positions.
// Corner (r, g) = azimuth boundary r × range boundary g.
// lngs[r*(nGates+1)+g], lats[r*(nGates+1)+g]
function computeCornerGrid(radarLat, radarLon, nRays, nGates, firstRangeM, gateSizeM) {
  const nCR = nRays + 1;
  const nCG = nGates + 1;
  const lngs = new Float32Array(nCR * nCG);
  const lats  = new Float32Array(nCR * nCG);

  const φ1    = radarLat  * (Math.PI / 180);
  const λ1    = radarLon  * (Math.PI / 180);
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const R     = 6371008.8;

  // Precompute per-gate boundary values (shared across all rays)
  const cosD = new Float64Array(nCG);
  const sinD = new Float64Array(nCG);
  const a1   = new Float64Array(nCG); // sinφ1 * cosD
  const a2   = new Float64Array(nCG); // cosφ1 * sinD
  for (let g = 0; g < nCG; g++) {
    const d = (firstRangeM + g * gateSizeM) / R;
    cosD[g] = Math.cos(d);
    sinD[g] = Math.sin(d);
    a1[g]   = sinφ1 * cosD[g];
    a2[g]   = cosφ1 * sinD[g];
  }

  for (let r = 0; r < nCR; r++) {
    const bearing = (r / nRays) * (2 * Math.PI); // CW from North
    const cosB   = Math.cos(bearing);
    const sinB   = Math.sin(bearing);
    const rowOff = r * nCG;
    for (let g = 0; g < nCG; g++) {
      const sinφ2 = a1[g] + a2[g] * cosB;
      const φ2    = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
      const λ2    = λ1 + Math.atan2(sinB * sinD[g] * cosφ1, cosD[g] - sinφ1 * sinφ2);
      lngs[rowOff + g] = λ2 * (180 / Math.PI);
      lats[rowOff + g] = φ2 * (180 / Math.PI);
    }
  }
  return { lngs, lats };
}


// ── Flat gate×ray RGBA from compact ──────────────────────────────────────
function renderCompactFlat(buf) {
  const { data, numAz, numGates, firstRangeM, gateSizeM, maxRangeKm, gateOffset } = parseCompact(buf);
  const rgba = new Uint8Array(numAz * numGates * 4);
  for (let r = 0; r < numAz; r++) {
    const src    = gateOffset + r * numGates;
    const dstRow = r * numGates * 4;
    for (let g = 0; g < numGates; g++) {
      const val = data[src + g];
      if (!val) continue;
      const s = val * 4;
      const a = RGBA_PAL[s + 3];
      if (!a) continue;
      const pi = dstRow + g * 4;
      rgba[pi]   = RGBA_PAL[s];
      rgba[pi+1] = RGBA_PAL[s+1];
      rgba[pi+2] = RGBA_PAL[s+2];
      rgba[pi+3] = a;
    }
  }
  return { rgba, nRays: numAz, nGates: numGates, firstRangeM, gateSizeM, maxRangeKm };
}


// ── Flat gate×ray RGBA from Level-2 ─────────────────────────────────────
function renderLevel2Flat(buf) {
  const parsed = parseLevel2(buf);
  if (!parsed || !parsed.radialData) throw new Error('No REF data found');
  const { radialData, numGates, firstGateM, gateSizeM, NUM_AZ } = parsed;
  const rgba = new Uint8Array(NUM_AZ * numGates * 4);
  for (let r = 0; r < NUM_AZ; r++) {
    for (let g = 0; g < numGates; g++) {
      const dbz = radialData[r * numGates + g];
      if (dbz <= -900) continue;
      const rgb = dbzToRGBA(dbz);
      if (!rgb) continue;
      const pi = (r * numGates + g) * 4;
      rgba[pi]   = rgb[0];
      rgba[pi+1] = rgb[1];
      rgba[pi+2] = rgb[2];
      rgba[pi+3] = 255;
    }
  }
  const maxRangeM = firstGateM + numGates * gateSizeM;
  return { rgba, nRays: NUM_AZ, nGates: numGates, firstRangeM: firstGateM, gateSizeM, maxRangeKm: maxRangeM / 1000 };
}


// ── AtticRadar velocity color LUT — exact chroma.js LAB, correct domain ──
// Exact pipeline: colortable_parser → scaleValues (kts→m/s) → append RF=999
// chroma.scale(colors).domain(values).mode('lab'), cmin=-72.022, cmax=999
// val=0: transparent, val=1: RF purple, val 2-254: mps=(val-129)*0.5
const VEL_LUT = new Uint8Array([
  0,0,0,0, 139,0,218,255,
  255,72,146,255,255,60,142,255,254,45,137,255,253,24,132,255,
  249,0,131,255,242,0,132,255,236,0,133,255,229,0,134,255,
  223,0,135,255,216,0,136,255,210,0,137,255,203,0,138,255,
  197,0,139,255,190,0,140,255,183,0,141,255,176,0,142,255,
  170,0,143,255,163,0,144,255,156,0,145,255,148,0,145,255,
  141,0,146,255,134,0,147,255,126,0,148,255,118,1,149,255,
  110,2,150,255,105,4,151,255,99,5,152,255,93,6,152,255,
  86,7,153,255,79,7,153,255,72,9,154,255,64,10,154,255,
  55,11,155,255,44,12,155,255,30,13,156,255,26,44,166,255,
  29,51,169,255,32,58,171,255,33,66,173,255,35,72,175,255,
  35,79,178,255,35,86,180,255,35,93,182,255,34,100,184,255,
  32,106,186,255,31,114,189,255,36,122,192,255,39,131,195,255,
  41,140,199,255,43,149,202,255,44,158,205,255,45,167,208,255,
  45,176,211,255,44,186,214,255,42,195,217,255,47,222,226,255,
  60,223,227,255,71,224,227,255,80,224,228,255,89,225,229,255,
  96,226,229,255,103,227,230,255,110,227,230,255,116,228,231,255,
  123,229,232,255,128,230,232,255,134,230,233,255,139,231,234,255,
  145,232,234,255,150,232,235,255,155,233,235,255,160,234,236,255,
  165,235,237,255,169,235,237,255,174,236,238,255,178,237,239,255,
  178,237,231,255,170,238,213,255,162,239,195,255,152,239,177,255,
  142,240,159,255,130,240,140,255,117,241,121,255,102,241,100,255,
  83,241,78,255,56,241,50,255,3,233,2,255,3,229,2,255,
  3,224,2,255,2,219,2,255,2,215,2,255,2,210,1,255,
  2,206,1,255,2,201,1,255,2,197,1,255,2,192,1,255,
  1,188,1,255,1,183,1,255,1,179,1,255,1,174,1,255,
  1,170,1,255,1,166,1,255,1,161,1,255,1,157,0,255,
  1,153,0,255,1,148,0,255,1,144,0,255,0,140,0,255,
  0,136,0,255,0,131,0,255,0,127,0,255,0,123,0,255,
  0,119,0,255,0,115,0,255,0,111,0,255,0,107,0,255,
  0,103,0,255,79,121,77,255,83,122,80,255,87,123,84,255,
  91,124,87,255,94,125,91,255,98,126,94,255,102,127,98,255,
  105,128,101,255,109,129,105,255,112,130,108,255,116,131,112,255,
  137,111,116,255,137,105,109,255,137,99,103,255,137,92,97,255,
  136,86,90,255,135,80,84,255,134,73,78,255,133,67,72,255,
  132,60,66,255,130,53,61,255,112,0,1,255,116,0,1,255,
  120,0,2,255,124,0,3,255,128,0,3,255,132,0,4,255,
  136,0,4,255,140,0,5,255,144,0,5,255,149,0,6,255,
  153,0,6,255,157,0,6,255,161,0,6,255,166,0,7,255,
  170,0,7,255,174,0,7,255,179,0,7,255,183,0,7,255,
  187,0,7,255,192,0,7,255,196,0,7,255,201,0,7,255,
  205,0,7,255,209,0,7,255,214,0,7,255,218,0,7,255,
  223,0,7,255,228,0,7,255,232,0,7,255,237,0,7,255,
  241,0,7,255,250,59,83,255,251,67,91,255,253,74,99,255,
  254,81,107,255,255,88,115,255,255,94,124,255,255,101,132,255,
  255,107,141,255,255,112,149,255,255,118,158,255,255,124,166,255,
  255,129,175,255,255,135,184,255,255,140,193,255,255,146,202,255,
  254,166,199,255,255,180,194,255,255,195,188,255,255,208,183,255,
  255,222,177,255,253,227,159,255,254,223,155,255,254,219,151,255,
  254,216,147,255,255,212,144,255,255,208,140,255,255,204,136,255,
  255,201,132,255,255,197,129,255,255,193,125,255,255,189,121,255,
  255,185,117,255,255,181,114,255,255,178,110,255,255,174,106,255,
  255,170,102,255,255,166,99,255,254,162,95,255,254,158,91,255,
  254,154,88,255,253,150,84,255,251,140,79,255,248,137,77,255,
  244,134,75,255,240,130,73,255,237,127,71,255,233,124,69,255,
  230,121,68,255,226,118,66,255,222,115,64,255,219,112,62,255,
  215,109,60,255,212,106,59,255,208,103,57,255,204,100,55,255,
  201,97,53,255,197,94,51,255,194,91,50,255,190,88,48,255,
  187,85,46,255,183,82,45,255,180,79,43,255,176,76,41,255,
  173,73,39,255,169,70,38,255,166,67,36,255,162,64,34,255,
  159,61,33,255,155,58,31,255,152,55,30,255,149,52,28,255,
  145,49,26,255,142,46,25,255,138,43,23,255,135,40,22,255,
  132,37,20,255,128,33,19,255,125,30,17,255,121,27,15,255,
  118,23,14,255,115,20,12,255,112,16,10,255,107,15,9,255,
  102,15,9,255,0,0,0,0
]);

// ── Velocity color lookup — AtticRadar colormaps.js velocity table, units: KTS ──
// Linear interpolation between AtticRadar's exact color stops
// Each pair of same-value stops = hard transition at that value
function velToRGBA(kts) {
  if (isNaN(kts) || kts === null) return null;
  // AtticRadar velocity colormap — exact segment interpolation.
  // Each entry: [start_kts, start_rgb, end_kts, end_rgb]
  // Hard transitions happen BETWEEN segments (at boundary values), not within.
  const segs = [
    [-140, [255,204,230], -120, [255,204,230]],  // solid
    [-120, [252,  0,130], -100, [109,  2,150]],
    [-100, [110,  3,151],  -90, [ 22, 13,156]],
    [ -90, [ 24, 39,165],  -80, [ 30,111,188]],
    [ -80, [ 30,111,188],  -70, [ 40,204,220]],
    [ -70, [ 47,222,226],  -50, [181,237,239]],
    [ -50, [181,237,239],  -40, [  2,241,  3]],
    [ -40, [  3,234,  2],  -10, [  0,100,  0]],
    [ -10, [ 78,121, 76],    0, [116,131,112]],
    [   0, [137,117,122],   10, [130, 51, 59]],
    [  10, [109,  0,  0],   40, [242,  0,  7]],
    [  40, [249, 51, 76],   55, [255,149,207]],
    [  55, [253,160,201],   60, [255,232,172]],
    [  60, [253,228,160],   80, [253,149, 83]],
    [  80, [254,142, 80],  120, [110, 14,  9]],
    [ 120, [110, 14,  9],  140, [  0,  0,  0]],
  ];
  if (kts <= -140) return [255,204,230];
  if (kts >= 140)  return [0,0,0];
  for (const [s, cs, e, ce] of segs) {
    if (kts >= s && kts < e) {
      const t = (kts - s) / (e - s);
      return [
        Math.round(cs[0] + t*(ce[0]-cs[0])),
        Math.round(cs[1] + t*(ce[1]-cs[1])),
        Math.round(cs[2] + t*(ce[2]-cs[2])),
      ];
    }
  }
  return [0,0,0];
}


// ── OpenSnow exact Correlation Coefficient palette ────────────────────────
// Input: cc value 0.0–1.05
// Source: reverse-engineered from opensnow.com/stormnet radarWorker
const CC_STOPS = [
  { s: 0.00, e: 0.10, cs: [188,188,188], ce: [127,127,127] },
  { s: 0.10, e: 0.30, cs: [172,209,243], ce: [ 11, 83,148] },
  { s: 0.30, e: 0.50, cs: [108,169, 93], ce: [  4,114, 35] },
  { s: 0.50, e: 0.75, cs: [255,217,102], ce: [237,122, 23] },
  { s: 0.75, e: 0.90, cs: [224,102,102], ce: [153,  0,  0] },
  { s: 0.90, e: 1.00, cs: [194,123,160], ce: [133,  0,195] },
];

function ccToRGBA(cc) {
  if (isNaN(cc) || cc <= 0) return null;
  const v = Math.min(1.0, cc);
  for (const seg of CC_STOPS) {
    if (v >= seg.s && v < seg.e) {
      const t = (v - seg.s) / (seg.e - seg.s);
      return [
        Math.round(seg.cs[0] + t*(seg.ce[0]-seg.cs[0])),
        Math.round(seg.cs[1] + t*(seg.ce[1]-seg.cs[1])),
        Math.round(seg.cs[2] + t*(seg.ce[2]-seg.cs[2])),
      ];
    }
  }
  // ≥ 1.0 → clamp to last stop color
  return [...CC_STOPS[CC_STOPS.length-1].ce];
}

// ── Compact velocity renderer — with AtticRadar pyart region-based dealiasing ──
function renderCompactVelFlat(buf) {
  const { data, numAz, numGates, firstRangeM, gateSizeM, maxRangeKm, gateOffset } = parseCompact(buf);

  // Decode raw bytes to float m/s, find Nyquist
  const vel2d = [];
  let nyq = 0;
  for (let r = 0; r < numAz; r++) {
    const src = gateOffset + r * numGates;
    const row = [];
    for (let g = 0; g < numGates; g++) {
      const val = data[src + g];
      if (val <= 1) { row.push(null); continue; }
      const v = (val - 129) * 0.5;
      row.push(v);
      if (Math.abs(v) > nyq) nyq = Math.abs(v);
    }
    vel2d.push(row);
  }

  // Run AtticRadar's exact pyart region-based dealiasing
  let dealiased = vel2d;
  if (nyq > 0.5) {
    try { dealiased = dealias(vel2d, nyq); } catch(e) { dealiased = vel2d; }
  }

  // Render using LUT
  const rgba = new Uint8Array(numAz * numGates * 4);
  for (let r = 0; r < numAz; r++) {
    const srcRow = gateOffset + r * numGates;
    const dstRow = r * numGates * 4;
    for (let g = 0; g < numGates; g++) {
      const origVal = data[srcRow + g];
      if (origVal === 0) continue;
      const pi = dstRow + g * 4;
      if (origVal === 1) {
        rgba[pi]=139; rgba[pi+1]=0; rgba[pi+2]=218; rgba[pi+3]=255;
        continue;
      }
      const mps = dealiased[r][g];
      if (mps === null || mps === undefined) continue;
      const rgb = velToRGBA(mps * 1.9426);
      if (!rgb) continue;
      rgba[pi]=rgb[0]; rgba[pi+1]=rgb[1]; rgba[pi+2]=rgb[2]; rgba[pi+3]=255;
    }
  }
  return { rgba, nRays: numAz, nGates: numGates, firstRangeM, gateSizeM, maxRangeKm };
}

// ── AtticRadar region-based dealias (libnexrad_helpers/level2/dealias/dealias.js) ──
/**
 * This implementation of a region based doppler dealiasing algorithm
 * was ported almost exactly from pyart's "dealias_region_based" function.
 * I used a specific commit as a reference point for this work, because
 * it was right when "scipy.sparse.coo_matrix" had stopped being used
 * by the algorithm.
 * 
 * You can find that commit here:
 * https://github.com/ARM-DOE/pyart/blob/41b34052dc36becd1783bb7dfb87c39570cab707/pyart/correct/region_dealias.py
 * 
 * All of this is to say that I only truly wrote a couple of lines of this code.
 * I simply ported pyart's dealiasing function from Python to JavaScript, with
 * a lot of help from ChatGPT and Google.
 */

const np = {
    // https://stackoverflow.com/a/40475362/18758797
    linspace(startValue, stopValue, cardinality) {
        var arr = [];
        var step = (stopValue - startValue) / (cardinality - 1);
        for (var i = 0; i < cardinality; i++) {
            arr.push(startValue + (step * i));
        }
        return arr;
    },
    shape(arr) {
        var numRows = arr.length;
        var numCols = arr[0].length;
        if (numRows == undefined) { numRows = 1 }
        if (numCols == undefined) { numCols = 1 }
        return [numRows, numCols];
    },
    zeros(shape) {
        if (shape.length === 0) {
            return 0;
        } else {
            const arr = new Array(shape[0]);
            for (let i = 0; i < shape[0]; i++) {
                arr[i] = this.zeros(shape.slice(1));
            }
            return arr;
        }
    },
    ones_like(arr) {
        return new Array(arr.length).fill(1);
    },
    bincount(arr) {
        // Initialize the result array with zeros up to the maximum value in arr
        let counts = new Array(max(arr) + 1).fill(0);
        // Count the occurrences of each value in arr
        for (let x of arr) {
            counts[x] += 1;
        }
        return counts;
    },
    lexsort(arr1, arr2) {
        const indices = Array.from({ length: arr1.length }, (_, i) => i);
        indices.sort((a, b) => {
            let cmp = arr1[a] - arr1[b];
            if (cmp !== 0) {
                return cmp;
            }
            return arr2[a] - arr2[b];
        });
        return indices;
    },
    nonzero(arr) {
        return arr.reduce((acc, cur, i) => {
            if (cur) {
                acc.push(i);
            }
            return acc;
        }, []);
    },
    argmax(arr) {
        let maxIndex = 0;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] > arr[maxIndex]) {
                maxIndex = i;
            }
        }
        return maxIndex;
    },
    add: {
        reduceat(arr, indices) {
            var result = [];
            for (var i = 0; i < indices.length; i++) {
                // if (indices[i + 1] != undefined) {
                    var curIndex = indices[i];
                    var nextIndex = indices[i + 1];
                    if (curIndex > nextIndex) {
                        result.push(curIndex);
                    } else {
                        var sliced = arr.slice(curIndex, nextIndex);
                        var added = sliced.reduce((a, b) => a + b, 0);
                        result.push(added);
                    }
                // }
            }
            return result;
        }
    }
}

function label_image(arr) {
    // create a 2D array to store the labels of each pixel
    let labels = new Array(arr.length).fill(0).map(() => new Array(arr[0].length).fill(0));
    // initialize the label counter
    let label_count = 1;

    // loop over each pixel in the array
    for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < arr[0].length; j++) {
            // if the pixel is true and has not been labeled yet
            if (arr[i][j] && labels[i][j] == 0) {
                // perform a breadth-first search to label the connected component
                let queue = [[i, j]];
                while (queue.length > 0) {
                    // pop the next pixel off the queue
                    let [row, col] = queue.shift();
                    // label the pixel
                    labels[row][col] = label_count;
                    // add neighboring pixels to the queue
                    for (let [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        let x = row + dx;
                        let y = col + dy;
                        if (x >= 0 && x < arr.length && y >= 0 && y < arr[0].length && arr[x][y] && labels[x][y] == 0) {
                            queue.push([x, y]);
                            // mark the neighbor as labeled to prevent revisiting it
                            labels[x][y] = -1;
                        }
                    }
                }
                // increment the label counter
                label_count += 1;
            }
        }
    }

    // replace all -1 labels with 0
    for (let i = 0; i < labels.length; i++) {
        for (let j = 0; j < labels[0].length; j++) {
            if (labels[i][j] == -1) {
                labels[i][j] = 0;
            }
        }
    }

    // return the labeled array and the number of regions
    return [labels, label_count - 1];
}

function _jumpToMapPosition() {
    // lng: -97.51734430176083, lat: 35.316678641320166, zoom: 11 // KTLX
    // lng: lng: -97.35454576227136, lat: 27.812346235337856, zoom: 6.5 // KCRP
    // map.on('move', (e) => { console.log(map.getCenter()) })
    // map.on('move', (e) => { console.log(map.getZoom()) })
    map.jumpTo({center: [-97.51734430176083, 35.316678641320166], zoom: 11});
}

function copy(arr) {
    return JSON.parse(JSON.stringify(arr));
}

function remove(arr, value) {
    const index = arr.indexOf(value);
    if (index !== -1) {
        arr.splice(index, 1);
    }
    return arr;
}

function min(arr) { return Math.min(...[...new Set(arr)]) }
function max(arr) { return Math.max(...[...new Set(arr)]) }

function _mask_values(velocities) {
    // mask values
    for (var i in velocities) {
        for (var n in velocities[i]) {
            if (velocities[i][n] == null) {
                velocities[i][n] = -64.5;
            }
        }
    }
    return velocities;
}

function _find_sweep_interval_splits(nyquist, interval_splits, velocities) {
    /* Return the interval limits for a given sweep. */
    // The Nyquist interval is split into interval_splits  equal sized areas.
    // If velocities outside the Nyquist are present the number and
    // limits of the interval splits must be adjusted so that theses
    // velocities are included in one of the splits.

    var add_start = 0;
    var add_end = 0;
    var interval = (2 * nyquist) / (interval_splits);
    // no change from default if all gates filtered
    if (velocities.length != 0) {
        var max_vel = max(velocities.flat());
        var min_vel = min(velocities.flat());
        if (max_vel > nyquist || min_vel < -nyquist) {
            console.warn('Velocities outside of the Nyquist interval found in sweep.');
            // additional intervals must be added to capture the velocities
            // outside the nyquist limits
            add_start = parseInt(Math.ceil((max_vel - nyquist) / (interval)));
            add_end = parseInt(Math.ceil(-(min_vel + nyquist) / (interval)));
        }
    }

    var start = -nyquist - add_start * interval;
    var end = nyquist + add_end * interval;
    var num = interval_splits + 1 + add_start + add_end;
    return np.linspace(start, end, num);
}

/**
 * This function dealiases a 2D array of
 * doppler velocity values using a region-based algorithm.
 * 
 * @param {Array} velocities A 2D array containing all of the velocity values.
 * @param {Number} nyquist_vel A number representing the nyquist velocity.
 * 
 * @returns {Array} The corrected 2D array. It is the same as the original,
 * except the aliased regions are corrected.
 */
function dealias(velocities, nyquist_vel) {
    var interval_splits = 3;
    // scan number "9" (pyart "8") of the radar file "KBMX20210325_222143_V06"
    // only dealiases correctly with a value of 99 instead of 100
    var skip_between_rays = 99;
    var skip_along_ray = 100;
    var centered = true;
    var rays_wrap_around = true;

    for (var sweep_slice = 1; sweep_slice < 2; sweep_slice++) {
        // extract sweep data
        var sdata = copy(velocities); // copy of data for processing
        sdata = _mask_values(sdata);
        var scorr = copy(velocities); // copy of data for output

        var nyquist_interval = 2 * nyquist_vel;
        var interval_limits = _find_sweep_interval_splits(nyquist_vel, interval_splits, sdata);
        // skip sweep if all gates are masked or only a single region
        if (nfeatures < 2) {
            continue;
        }

        var [labels, nfeatures] = _find_regions(sdata, interval_limits);
        var bincount = np.bincount(labels.flat());
        var num_masked_gates = bincount[0];
        var region_sizes = bincount.slice(1);

        var [indices, edge_count, velos] = _edge_sum_and_count(
            labels, num_masked_gates, sdata, rays_wrap_around,
            skip_between_rays, skip_along_ray);

        // no unfolding required if no edges exist between regions
        if (edge_count.length == 0) {
            continue;
        }

        // find the number of folds in the regions
        var region_tracker = new _RegionTracker(region_sizes);
        var edge_tracker = new _EdgeTracker(indices, edge_count, velos, nyquist_interval, nfeatures + 1);
        while (true) {
            if (_combine_regions(region_tracker, edge_tracker)) {
                break;
            }
        }

        // center sweep if requested, determine a global sweep unfold number
        // so that the average number of gate folds is zero.
        if (centered) {
            var gates_dealiased = region_sizes.reduce((a, b) => a + b, 0);
            var total_folds = 0;
            for (var i = 0; i < region_sizes.length; i++) {
                total_folds += region_sizes[i] * region_tracker.unwrap_number[i + 1];
            }
            var sweep_offset = Math.round(total_folds / gates_dealiased);
            if (sweep_offset !== 0) {
                for (var i = 0; i < region_tracker.unwrap_number.length; i++) {
                    region_tracker.unwrap_number[i] -= sweep_offset;
                }
            }
        }

        // dealias the data using the fold numbers
        // start from label 1 to skip masked region
        for (var i = 1; i < nfeatures + 1; i++) {
            var nwrap = region_tracker.unwrap_number[i];
            if (nwrap != 0) {
                // scorr[labels == i] += nwrap * nyquist_interval
                for (let r = 0; r < labels.length; r++) {
                    for (let c = 0; c < labels[0].length; c++) {
                        if (labels[r][c] === i) {
                            scorr[r][c] += nwrap * nyquist_interval;
                        }
                    }
                }
            }
        }
    }

    // _jumpToMapPosition();
    // l2rad = _mergeCorrectedVelocities(scorr, l2rad, scanNumber);

    return scorr;
}

function _combine_regions(region_tracker, edge_tracker) {
    /* Returns True when done. */
    // Edge parameters from edge with largest weight
    var [status, extra] = edge_tracker.pop_edge();
    if (status) {
        return true;
    }
    var [node1, node2, weight, diff, edge_number] = extra;
    var rdiff = parseInt(Math.round(diff));

    // node sizes of nodes to be merged
    var node1_size = region_tracker.get_node_size(node1);
    var node2_size = region_tracker.get_node_size(node2);

    var base_node;
    var merge_node;
    // determine which nodes should be merged
    if (node1_size > node2_size) {
        [base_node, merge_node] = [node1, node2];
    }
    else {
        [base_node, merge_node] = [node2, node1]
        rdiff = -rdiff;
    }

    // unwrap merge_node
    if (rdiff != 0) {
        region_tracker.unwrap_node(merge_node, rdiff);
        edge_tracker.unwrap_node(merge_node, rdiff);
    }

    // merge nodes
    region_tracker.merge_nodes(base_node, merge_node);
    edge_tracker.merge_nodes(base_node, merge_node, edge_number);

    return false;
}

class _EdgeTracker {
    constructor(indices, edge_count, velocities, nyquist_interval, nnodes) {
        /* initialize */

        var nedges = parseInt(indices[0].length / 2);

        // node number and different in sum for each edge
        this.node_alpha = new Array(nedges).fill(0);
        this.node_beta = new Array(nedges).fill(0);
        this.sum_diff = new Array(nedges).fill(0);

        // number of connections between the regions
        this.weight = new Array(nedges).fill(0);

        // fast finding
        this._common_finder = new Array(nnodes).fill(false);
        this._common_index = new Array(nnodes).fill(0);
        this._last_base_node = -1;

        // array of linked lists pointing to each node
        this.edges_in_node = new Array(nnodes).fill(0);
        for (var i = 0; i < nnodes; i++) {
            this.edges_in_node[i] = [];
        }

        // fill out data from the provides indicies, edge counts and velocities
        var edge = 0;
        var [idx1, idx2] = indices;
        var [vel1, vel2] = velocities;

        for (let k = 0; k < idx1.length; k++) {
            var i = idx1[k];
            var j = idx2[k];
            var count = edge_count[k];
            var vel = vel1[k];
            var nvel = vel2[k];

            if (i < j) {
                continue;
            }
            this.node_alpha[edge] = i;
            this.node_beta[edge] = j;
            this.sum_diff[edge] = ((vel - nvel) / nyquist_interval);
            this.weight[edge] = count;
            this.edges_in_node[i].push(edge);
            this.edges_in_node[j].push(edge);

            edge += 1;
        }

        // list which orders edges according to their weight, highest first
        this.priority_queue = [];
    }
    merge_nodes(base_node, merge_node, foo_edge) {
        /* Merge nodes. */

        // remove edge between base and merge nodes
        this.weight[foo_edge] = -999;
        this.edges_in_node[merge_node] = remove(this.edges_in_node[merge_node], foo_edge);
        this.edges_in_node[base_node] = remove(this.edges_in_node[base_node], foo_edge);
        this._common_finder[merge_node] = false;

        // find all the edges in the two nodes
        var edges_in_merge = [...this.edges_in_node[merge_node]];

        // loop over base_node edges if last base_node was different
        if (this._last_base_node != base_node) {
            this._common_finder.fill(false);
            var edges_in_base = [...this.edges_in_node[base_node]];
            for (var edge_num in edges_in_base) {
                edge_num = edges_in_base[edge_num];
                // reverse edge if needed so node_alpha is base_node
                if (this.node_beta[edge_num] == base_node) {
                    this._reverse_edge_direction(edge_num);
                }
                // console.assert(this.node_alpha[edge_num] == base_node);

                // find all neighboring nodes to base_node
                var neighbor = this.node_beta[edge_num];
                this._common_finder[neighbor] = true;
                this._common_index[neighbor] = edge_num;
            }
        }

        // loop over edge nodes
        for (var edge_num in edges_in_merge) {
            edge_num = edges_in_merge[edge_num];
            // reverse edge so that node alpha is the merge_node
            if (this.node_beta[edge_num] == merge_node) {
                this._reverse_edge_direction(edge_num);
            }
            // console.assert(this.node_alpha[edge_num] == merge_node);

            // update all the edges to point to the base node
            this.node_alpha[edge_num] = base_node;

            // if base_node also has an edge with the neighbor combine them
            var neighbor = this.node_beta[edge_num];
            if (this._common_finder[neighbor]) {
                var base_edge_num = this._common_index[neighbor];
                this._combine_edges(base_edge_num, edge_num, merge_node, neighbor);
            } else {
                // if not fill in _common_ arrays.
                this._common_finder[neighbor] = true;
                this._common_index[neighbor] = edge_num;
            }
        }

        // move all edges from merge_node to base_node
        var edges = this.edges_in_node[merge_node];
        this.edges_in_node[base_node].push(...edges);
        this.edges_in_node[merge_node] = [];
        this._last_base_node = parseInt(base_node);
        return;
    }
    _combine_edges(base_edge, merge_edge, merge_node, neighbor_node) {
        /* Combine edges into a single edge. */
        // Merging nodes MUST be set to alpha prior to calling this function

        // combine edge weights
        this.weight[base_edge] += this.weight[merge_edge];
        this.weight[merge_edge] = -999;

        // combine sums
        this.sum_diff[base_edge] += this.sum_diff[merge_edge];

        // remove merge_edge from both node lists
        this.edges_in_node[merge_node] = remove(this.edges_in_node[merge_node], merge_edge);
        this.edges_in_node[neighbor_node] = remove(this.edges_in_node[neighbor_node], merge_edge);
    }
    _reverse_edge_direction(edge) {
        /* Reverse an edges direction, change alpha and beta. */

        // swap nodes
        var old_alpha = parseInt(this.node_alpha[edge]);
        var old_beta = parseInt(this.node_beta[edge]);
        this.node_alpha[edge] = old_beta;
        this.node_beta[edge] = old_alpha;
        // swap sums
        this.sum_diff[edge] = -1 * this.sum_diff[edge];
        return;
    }
    unwrap_node(node, nwrap) {
        /* Unwrap a node. */

        if (nwrap == 0) {
            return;
        }
        // add weight * nwrap to each edge in node
        for (var edge in this.edges_in_node[node]) {
            edge = this.edges_in_node[node][edge];
            var weight = this.weight[edge];
            if (node == this.node_alpha[edge]) {
                this.sum_diff[edge] += weight * nwrap;
            }
            else {
                // console.assert(this.node_beta[edge] == node);
                this.sum_diff[edge] += -weight * nwrap;
            }
        }
        return;
    }
    pop_edge() {
        /* Pop edge with largest weight.  Return node numbers and diff */

        var edge_num = np.argmax(this.weight);
        var node1 = this.node_alpha[edge_num];
        var node2 = this.node_beta[edge_num];
        var weight = this.weight[edge_num];
        var diff = this.sum_diff[edge_num] / (parseFloat(weight));

        if (weight < 0) {
            return [true, null];
        }
        return [false, [node1, node2, weight, diff, edge_num]];
    }
}

class _RegionTracker {
    /* Tracks the location of radar volume regions contained in each node
    * as the network is reduced. */

    constructor(region_sizes) {
        /* initialize. */

        // number of gates in each node
        var nregions = region_sizes.length + 1;
        this.node_size = new Array(nregions).fill(0);
        this.node_size.fill(0, 1, nregions);
        this.node_size.splice(1, region_sizes.length, ...region_sizes);

        // array of lists containing the regions in each node
        this.regions_in_node = new Array(nregions).fill(0);
        for (let i = 0; i < nregions; i++) {
            this.regions_in_node[i] = [i];
        }

        // number of unwrappings to apply to dealias each region
        this.unwrap_number = new Array(nregions).fill(0);
    }
    merge_nodes(node_a, node_b) {
        /* Merge node b into node a. */

        // move all regions from node_b to node_a
        var regions_to_merge = this.regions_in_node[node_b];
        this.regions_in_node[node_a].push(...regions_to_merge);
        this.regions_in_node[node_b] = [];

        // update node sizes
        this.node_size[node_a] += this.node_size[node_b];
        this.node_size[node_b] = 0;
        return;
    }
    unwrap_node(node, nwrap) {
        /* Unwrap all gates contained a node. */

        if (nwrap == 0) {
            return;
        }
        // for each region in node add nwrap
        var regions_to_unwrap = this.regions_in_node[node];
        for (var i = 0; i < regions_to_unwrap.length; i++) {
            this.unwrap_number[regions_to_unwrap[i]] += nwrap;
        }
        return;
    }

    get_node_size(node) {
        /* Return the number of gates in a node. */
        return this.node_size[node];
    }
}

function _edge_sum_and_count(labels, num_masked_gates, data, rays_wrap_around, max_gap_x, max_gap_y) {
    var lShape = np.shape(labels);
    var total_nodes = lShape[0] * lShape[1] - num_masked_gates;
    if (rays_wrap_around) {
        total_nodes += lShape[0] * 2;
    }

    var [indices, velocities] = _fast_edge_finder(labels, data, rays_wrap_around, max_gap_x, max_gap_y, total_nodes);
    var [index1, index2] = indices;
    var [vel1, vel2] = velocities;
    count = np.ones_like(vel1);

    // return early if not edges were found
    if (vel1.length == 0) {
        return [[[], []], [], [[], []]];
    }

    // find the unique edges, procedure based on method in
    // scipy.sparse.coo_matrix.sum_duplicates
    // except we have three data arrays, vel1, vel2, and count
    var order = np.lexsort(index1, index2);
    // console.log(np.lexsort([9,4,0,4,0,2,1], [1,5,1,4,3,4,4]))
    index1 = index1.filter((_, i) => order[i]).map((_, i) => index1[order[i]]);
    index2 = index2.filter((_, i) => order[i]).map((_, i) => index2[order[i]]);
    vel1 = vel1.filter((_, i) => order[i]).map((_, i) => vel1[order[i]]);
    vel2 = vel2.filter((_, i) => order[i]).map((_, i) => vel2[order[i]]);
    count = count.filter((_, i) => order[i]).map((_, i) => count[order[i]]);

    var unique_mask = new Array(index1.length - 1);
    for (let i = 0; i < unique_mask.length; i++) {
        unique_mask[i] = (index1[i + 1] !== index1[i]) || (index2[i + 1] !== index2[i]);
    }
    unique_mask.unshift(true);
    index1 = index1.filter((_, i) => unique_mask[i]);
    index2 = index2.filter((_, i) => unique_mask[i]);

    var unique_inds = np.nonzero(unique_mask);
    vel1 = np.add.reduceat(vel1, unique_inds);
    vel2 = np.add.reduceat(vel2, unique_inds);
    count = np.add.reduceat(count, unique_inds);
    // console.log(np.add.reduceat([0, 1, 2, 3, 4, 5, 6, 7], [0, 4, 1, 5, 2, 6, 3, 7]))
    // console.log(np.add.reduceat([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1,3,4,5]))

    return [[index1, index2], count, [vel1, vel2]];
}

function _fast_edge_finder(labels, data, rays_wrap_around, max_gap_x, max_gap_y, total_nodes) {
    var lShape = np.shape(labels);
    var collector = new _EdgeCollector(total_nodes);
    var right = lShape[0] - 1;
    var bottom = lShape[1] - 1;

    for (var x_index = 0; x_index < lShape[0]; x_index++) {
        for (var y_index = 0; y_index < lShape[1]; y_index++) {
            var label = labels[x_index][y_index];
            if (label == 0) {
                continue;
            }

            var vel = data[x_index][y_index];

            // left
            var x_check = x_index - 1;
            if (x_check == -1 && rays_wrap_around) {
                x_check = right; // wrap around
            }
            if (x_check != -1) {
                var neighbor = labels[x_check][y_index];

                // if the left side gate is masked, keep looking to the left
                // until we find a valid gate or reach the maximum gap size
                if (neighbor == 0) {
                    for (var i = 0; i < max_gap_x; i++) {
                        x_check -= 1;
                        if (x_check == -1) {
                            if (rays_wrap_around) {
                                x_check = right;
                            } else {
                                break;
                            }
                        }
                        neighbor = labels[x_check][y_index];
                        if (neighbor != 0) {
                            break;
                        }
                    }
                }
                // add the edge to the collection (if valid)
                var nvel = data[x_check][y_index];
                collector.add_edge(label, neighbor, vel, nvel);
            }

            // right
            var x_check = x_index + 1;
            if (x_check == right + 1 && rays_wrap_around) {
                x_check = 0; // wrap around
            }
            if (x_check != right + 1) {
                var neighbor = labels[x_check][y_index];

                // if the right side gate is masked, keep looking to the left
                // until we find a valid gate or reach the maximum gap size
                if (neighbor == 0) {
                    for (var i = 0; i < max_gap_x; i++) {
                        x_check += 1;
                        if (x_check == right + 1) {
                            if (rays_wrap_around) {
                                x_check = 0;
                            } else {
                                break;
                            }
                        }
                        neighbor = labels[x_check][y_index];
                        if (neighbor != 0) {
                            break;
                        }
                    }
                }
                // add the edge to the collection (if valid)
                var nvel = data[x_check][y_index];
                collector.add_edge(label, neighbor, vel, nvel);
            }

            // top
            var y_check = y_index - 1
            if (y_check != -1) {
                var neighbor = labels[x_index][y_check];

                // if the top side gate is masked, keep looking up
                // until we find a valid gate or reach the maximum gap size
                if (neighbor == 0) {
                    for (var i = 0; i < max_gap_y; i++) {
                        y_check -= 1;
                        if (y_check == -1) {
                            break;
                        }
                        neighbor = labels[x_index][y_check];
                        if (neighbor != 0) {
                            break;
                        }
                    }
                }
                // add the edge to the collection (if valid)
                var nvel = data[x_index][y_check];
                collector.add_edge(label, neighbor, vel, nvel);
            }

            // bottom
            var y_check = y_index + 1
            if (y_check != bottom + 1) {
                var neighbor = labels[x_index][y_check];

                // if the top side gate is masked, keep looking up
                // until we find a valid gate or reach the maximum gap size
                if (neighbor == 0) {
                    for (var i = 0; i < max_gap_y; i++) {
                        y_check += 1;
                        if (y_check == bottom + 1) {
                            break;
                        }
                        neighbor = labels[x_index][y_check];
                        if (neighbor != 0) {
                            break;
                        }
                    }
                }
                // add the edge to the collection (if valid)
                var nvel = data[x_index][y_check];
                collector.add_edge(label, neighbor, vel, nvel);
            }
        }
    }

    var [indices, velocities] = collector.get_indices_and_velocities();
    return [indices, velocities];
}

class _EdgeCollector {
    /* Class for collecting edges, used by _edge_sum_and_count function. */
    constructor(total_nodes) {
        this.l_index = new Array(total_nodes * 4);
        this.n_index = new Array(total_nodes * 4);
        this.l_velo = new Array(total_nodes * 4);
        this.n_velo = new Array(total_nodes * 4);

        this.l_data = this.l_index;
        this.n_data = this.n_index;
        this.lv_data = this.l_velo;
        this.nv_data = this.n_velo;

        this.idx = 0;
    }

    add_edge(label, neighbor, vel, nvel) {
        /* Add an edge. */
        if (neighbor === label || neighbor === 0) {
            // Do not add edges between the same region (circular edges)
            // or edges to masked gates (indicated by a label of 0).
            return 0;
        }
        this.l_data[this.idx] = label;
        this.n_data[this.idx] = neighbor;
        this.lv_data[this.idx] = vel;
        this.nv_data[this.idx] = nvel;
        this.idx += 1;
        return 1;
    }

    get_indices_and_velocities() {
        /* Return the edge indices and velocities. */
        var indices = [this.l_index.slice(0, this.idx), this.n_index.slice(0, this.idx)];
        var velocities = [this.l_velo.slice(0, this.idx), this.n_velo.slice(0, this.idx)];
        return [indices, velocities];
    }
}

function _find_regions(vel, limits) {
    var label = np.zeros(np.shape(vel));
    var nfeatures = 0;

    for (let i = 0; i < limits.length - 1; i++) {
        const lmin = limits[i];
        const lmax = limits[i + 1];

        // find connected regions within the limits
        var rows = vel.length;
        var cols = vel[0].length;
        var inp = new Array(rows);
        for (let i = 0; i < rows; i++) {
            inp[i] = new Array(cols);
            for (let j = 0; j < cols; j++) {
                inp[i][j] = (lmin <= vel[i][j]) && (vel[i][j] < lmax);
            }
        }

        var [limit_label, limit_nfeatures] = label_image(inp);

        var llshape = np.shape(limit_label);
        for (let i = 0; i < llshape[0]; i++) {
            for (let j = 0; j < llshape[1]; j++) {
                if (limit_label[i][j] !== 0) {
                    limit_label[i][j] += nfeatures;
                }
            }
        }

        for (let i = 0; i < label.length; i++) {
            for (let j = 0; j < label[i].length; j++) {
                label[i][j] += limit_label[i][j];
            }
        }

        nfeatures += limit_nfeatures;
    }

    return [label, nfeatures];
}



function renderLevel2VelFlat(buf) {
  let data = new Uint8Array(buf);
  const sig = (data[0] << 8) | data[1];
  if (sig === 0x425A) {
    try { data = Bzip2.decompress(data); } catch(e) {}
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 24;
  const NUM_AZ = 720;
  const REF_MASK_DBZ = 5.0;
  const elevData = {};

  while (pos + 4 <= data.length) {
    const recSizeRaw = dv.getInt32(pos, false);
    pos += 4;
    if (recSizeRaw === 0) break;
    const recSize = Math.abs(recSizeRaw);
    if (pos + recSize > data.length) break;
    let chunk;
    if (recSizeRaw < 0) { chunk = data.slice(pos, pos + recSize); }
    else { try { chunk = Bzip2.decompress(data.slice(pos, pos + recSize)); } catch(e) { pos += recSize; continue; } }
    pos += recSize;
    let mpos = 0;
    while (mpos + 28 <= chunk.length) {
      const segsHW  = (chunk[mpos+12] << 8) | chunk[mpos+13];
      const msgType = chunk[mpos+15];
      const msgBytes = 12 + segsHW * 2;
      if (msgType === 31) parseMsg31vel(chunk, mpos + 28);
      mpos += Math.max(msgBytes, 28);
    }
  }

  function parseMsg31vel(chunk, base) {
    if (base + 68 > chunk.length) return;
    const dv2 = new DataView(chunk.buffer, chunk.byteOffset + base);
    const elevIdx = dv2.getUint8(22);
    const az    = dv2.getFloat32(12, false);
    const azBin = Math.floor(((az % 360 + 360) % 360) * 2) % NUM_AZ;
    const nBlocks = dv2.getUint16(30, false);
    let velPtr=-1,velNG=0,velScl=1,velOfs=0,velFG=0,velGS=0,velWordSize=8;
    let refPtr=-1,refNG=0,refScl=1,refOfs=0;
    let radNyquist=0;
    for (let b = 0; b < nBlocks && b < 10; b++) {
      if (base + 32 + (b+1)*4 > chunk.length) break;
      const ptr   = dv2.getUint32(32 + b*4, false);
      const bbase = chunk.byteOffset + base + ptr;
      if (bbase + 4 > chunk.byteOffset + chunk.length) continue;
      const t0=chunk[bbase],b1=chunk[bbase+1],b2=chunk[bbase+2],b3=chunk[bbase+3];
      // RAD block: type 'R'=82, name 'R','A','D', Nyquist at offset 16 (signed int16, 0.01 m/s)
      if (t0===82&&b1===82&&b2===65&&b3===68) {
        if (bbase+18<=chunk.byteOffset+chunk.length) {
          const rbdv=new DataView(chunk.buffer,bbase);
          radNyquist=rbdv.getInt16(16,false)*0.01;
        }
        continue;
      }
      if (t0!==68) continue;
      const bdv = new DataView(chunk.buffer, bbase);
      const ng=bdv.getUint16(8,false),fg=bdv.getUint16(10,false),gs=bdv.getUint16(12,false);
      const scl=bdv.getFloat32(20,false),ofs=bdv.getFloat32(24,false);
      const wordSize=chunk[bbase+19];
      if (b1===86&&b2===69&&b3===76) { velPtr=ptr;velNG=ng;velScl=scl;velOfs=ofs;velFG=fg;velGS=gs;velWordSize=wordSize; }
      if (b1===82&&b2===69&&b3===70) { refPtr=ptr;refNG=ng;refScl=scl;refOfs=ofs; }
    }
    if (velPtr < 0) return;
    if (!elevData[elevIdx]) {
      const az0 = new Float32Array(NUM_AZ);
      for (let i = 0; i < NUM_AZ; i++) az0[i] = i * 0.5;
      elevData[elevIdx] = {
        numGates:velNG, firstGateM:velFG, gateSizeM:velGS,
        radialData: new Float32Array(NUM_AZ*velNG).fill(-999),
        azAngles: az0,
        refNumGates: refNG>0?refNG:0,
        refData: refNG>0 ? new Float32Array(NUM_AZ*refNG).fill(-999) : null,
        populated: 0,
        nyquist: radNyquist,
        velWordSize: velWordSize
      };
    }
    const ed = elevData[elevIdx];
    if (radNyquist > 0 && ed.nyquist === 0) ed.nyquist = radNyquist;
    if (ed.radialData[azBin * ed.numGates] <= -900) ed.populated++;
    ed.azAngles[azBin] = az;
    const velOff=base+velPtr+28;
    const vel2byte = (ed.velWordSize||velWordSize) === 16;
    for(let g=0;g<velNG&&g<ed.numGates;g++){
      const off = velOff + g*(vel2byte?2:1);
      if(off+1>chunk.length)break;
      const rv = vel2byte
        ? ((chunk[chunk.byteOffset+off]<<8)|chunk[chunk.byteOffset+off+1])
        : chunk[chunk.byteOffset+off];
      ed.radialData[azBin*ed.numGates+g]=rv===1?-9999:(rv<=0?-999:(rv-velOfs)/velScl);
    }
    if(refPtr>=0&&ed.refData){
      const refOff=base+refPtr+28;
      for(let g=0;g<refNG&&g<ed.refNumGates;g++){
        if(refOff+g>=chunk.length)break;
        const rv=chunk[chunk.byteOffset+refOff+g];
        ed.refData[azBin*ed.refNumGates+g]=rv<=1?-999:(rv-refOfs)/refScl;
      }
    }
  }

  const allElevs = Object.values(elevData);
  if (!allElevs.length) return null; // no VEL moment in this file
  const candidates = allElevs.filter(ed => ed.populated >= 180);
  const best = (candidates.length ? candidates : allElevs)
    .reduce((b, e) => e.populated > b.populated ? e : b);

  const { numGates, firstGateM, gateSizeM, radialData, refData, refNumGates } = best;

  // Raw velocity — RF=purple, velocity=color table (m/s→knots→LUT like AtticRadar)
  const MPS_TO_KTS = 1.9426;
  const rgba = new Uint8Array(NUM_AZ * numGates * 4);
  for (let r = 0; r < NUM_AZ; r++) {
    for (let g = 0; g < numGates; g++) {
      const mps = radialData[r * numGates + g];
      const pi = (r * numGates + g) * 4;
      if (mps === -9999) {
        // Range-folded: AtticRadar purple rgb(139,0,218)
        rgba[pi]=139; rgba[pi+1]=0; rgba[pi+2]=218; rgba[pi+3]=255;
      } else if (mps > -900) {
        // Convert m/s → knots, then look up color same as AtticRadar
        const kts = mps * MPS_TO_KTS;
        const rgb = velToRGBA(kts);
        if (!rgb) continue;
        rgba[pi] = rgb[0]; rgba[pi+1] = rgb[1]; rgba[pi+2] = rgb[2]; rgba[pi+3] = 255;
      }
    }
  }
  const maxRangeM = firstGateM + numGates * gateSizeM;
  return { rgba, nRays: NUM_AZ, nGates: numGates, firstRangeM: firstGateM, gateSizeM, maxRangeKm: maxRangeM / 1000 };
}


// ── Compact CC renderer ───────────────────────────────────────────────────
// CC compact encoding: val=0 → no data, val 2-254 → cc = (val-2)/240.0
function renderCompactCCFlat(buf) {
  const { data, numAz, numGates, firstRangeM, gateSizeM, maxRangeKm, gateOffset } = parseCompact(buf);
  const rgba = new Uint8Array(numAz * numGates * 4);
  for (let r = 0; r < numAz; r++) {
    const src    = gateOffset + r * numGates;
    const dstRow = r * numGates * 4;
    for (let g = 0; g < numGates; g++) {
      const val = data[src + g];
      if (val <= 1) continue;
      const cc  = (val - 2) / 240.0;
      const rgb = ccToRGBA(cc);
      if (!rgb) continue;
      const pi = dstRow + g * 4;
      rgba[pi]   = rgb[0]; rgba[pi+1] = rgb[1]; rgba[pi+2] = rgb[2]; rgba[pi+3] = 230;
    }
  }
  return { rgba, nRays: numAz, nGates: numGates, firstRangeM, gateSizeM, maxRangeKm };
}

// ── Level-2 CC renderer ───────────────────────────────────────────────────
function renderLevel2CCFlat(buf) {
  let data = new Uint8Array(buf);
  const sig = (data[0] << 8) | data[1];
  if (sig === 0x425A) {
    try { data = Bzip2.decompress(data); } catch(e) {}
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 24;
  const NUM_AZ = 720;
  let radialData = null, numGates = 0, firstGateM = 0, gateSizeM = 0;
  let foundElevIdx = null;

  while (pos + 4 <= data.length) {
    const recSizeRaw = dv.getInt32(pos, false);
    pos += 4;
    if (recSizeRaw === 0) break;
    const recSize = Math.abs(recSizeRaw);
    if (pos + recSize > data.length) break;
    let chunk;
    if (recSizeRaw < 0) { chunk = data.slice(pos, pos + recSize); }
    else { try { chunk = Bzip2.decompress(data.slice(pos, pos + recSize)); } catch(e) { pos += recSize; continue; } }
    pos += recSize;
    let mpos = 0;
    while (mpos + 28 <= chunk.length) {
      const segsHW  = (chunk[mpos+12] << 8) | chunk[mpos+13];
      const msgType = chunk[mpos+15];
      const msgBytes = 12 + segsHW * 2;
      if (msgType === 31) parseMsg31cc(chunk, mpos + 28);
      mpos += Math.max(msgBytes, 28);
    }
  }

  function parseMsg31cc(chunk, base) {
    if (base + 68 > chunk.length) return;
    const dv2 = new DataView(chunk.buffer, chunk.byteOffset + base);
    const elevIdx = dv2.getUint8(22);
    if (foundElevIdx !== null && elevIdx !== foundElevIdx) return;
    const az    = dv2.getFloat32(12, false);
    const azBin = Math.floor(((az % 360 + 360) % 360) * 2) % NUM_AZ;
    const nBlocks = dv2.getUint16(30, false);
    for (let b = 0; b < nBlocks && b < 10; b++) {
      if (base + 32 + (b+1)*4 > chunk.length) break;
      const ptr   = dv2.getUint32(32 + b*4, false);
      const bbase = chunk.byteOffset + base + ptr;
      if (bbase + 28 > chunk.byteOffset + chunk.length) continue;
      if (chunk[bbase] !== 68) continue;
      // RHO block [R=82, H=72, O=79]
      if (chunk[bbase+1]!==82||chunk[bbase+2]!==72||chunk[bbase+3]!==79) continue;
      const bdv = new DataView(chunk.buffer, bbase);
      const ng  = bdv.getUint16(8,  false);
      const fg  = bdv.getUint16(10, false);
      const gs  = bdv.getUint16(12, false);
      const scl = bdv.getFloat32(20, false);
      const ofs = bdv.getFloat32(24, false);
      if (!radialData) { numGates=ng; firstGateM=fg; gateSizeM=gs; radialData=new Float32Array(NUM_AZ*ng).fill(-999); foundElevIdx=elevIdx; }
      const dataOff = base + ptr + 28;
      for (let g = 0; g < ng; g++) {
        if (dataOff + g >= chunk.length) break;
        const rv = chunk[chunk.byteOffset + dataOff + g];
        radialData[azBin*numGates+g] = rv<=1 ? -999 : (rv-ofs)/scl;
      }
      break;
    }
  }

  if (!radialData) throw new Error('No elevation-2 RHO data found');
  const rgba = new Uint8Array(NUM_AZ * numGates * 4);
  for (let r = 0; r < NUM_AZ; r++) {
    for (let g = 0; g < numGates; g++) {
      const cc = radialData[r * numGates + g];
      if (cc <= -900) continue;
      const rgb = ccToRGBA(cc);
      if (!rgb) continue;
      const pi = (r * numGates + g) * 4;
      rgba[pi]=rgb[0]; rgba[pi+1]=rgb[1]; rgba[pi+2]=rgb[2]; rgba[pi+3]=230;
    }
  }
  const maxRangeM = firstGateM + numGates * gateSizeM;
  return { rgba, nRays: NUM_AZ, nGates: numGates, firstRangeM: firstGateM, gateSizeM, maxRangeKm: maxRangeM/1000 };
}


// ── Message handler ───────────────────────────────────────────────────────
self.onmessage = function(e) {
  const { id, buffer, type, radarLat, radarLon, withCoords,
          nRays, nGates, firstRangeM, gateSizeM } = e.data;
  try {
    if (type === 'coords') {
      const { lngs, lats } = computeCornerGrid(radarLat, radarLon, nRays, nGates, firstRangeM, gateSizeM);
      self.postMessage({ id, coords: { lngs, lats } }, [lngs.buffer, lats.buffer]);
      return;
    }

    let flat;
    if      (type === 'compact'     || type === 'compact_mesh') flat = renderCompactFlat(buffer);
    else if (type === 'compact_vel')                            flat = renderCompactVelFlat(buffer);
    else if (type === 'compact_cc')                             flat = renderCompactCCFlat(buffer);
    else if (type === 'level2'      || type === 'level2_mesh')  flat = renderLevel2Flat(buffer);
    else if (type === 'level2_vel')                             flat = renderLevel2VelFlat(buffer);
    else if (type === 'level2_cc')                              flat = renderLevel2CCFlat(buffer);
    else { self.postMessage({ id, error: 'Unknown type: ' + type }); return; }

    if (!flat) { self.postMessage({ id, rendered: null }); return; }

    const transfers = [flat.rgba.buffer];
    let coords = null;
    if (withCoords && radarLat != null && radarLon != null) {
      const cg = computeCornerGrid(radarLat, radarLon, flat.nRays, flat.nGates, flat.firstRangeM, flat.gateSizeM);
      coords = { lngs: cg.lngs, lats: cg.lats };
      transfers.push(cg.lngs.buffer, cg.lats.buffer);
    }

    self.postMessage({ id, rendered: { ...flat, coords } }, transfers);
  } catch(err) {
    self.postMessage({ id, error: err.message });
  }
};
