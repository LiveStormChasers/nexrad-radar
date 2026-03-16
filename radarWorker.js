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


// ── AtticRadar velocity color LUT — exact chroma.js LAB with full domain ──
// Reproduced from AtticRadar's pipeline:
//   scaleValues converts knots→m/s, appends range_fold=999
//   chroma.scale(colors).domain(values).mode('lab'), cmin=-72.02, cmax=999
//   fragment shader: texture lookup at (mps - cmin)/(cmax - cmin)
// val=0: transparent, val=1: RF purple rgb(139,0,218), val=2..254: velocity
const VEL_LUT = new Uint8Array([
  0,0,0,0,          // 0: no data
  139,0,218,255,    // 1: range-folded (RF purple)
  255,83,151,255,255,73,147,255,255,62,142,255,254,49,138,255,
  126,0,148,255,118,1,149,255,110,2,150,255,109,2,150,255,
  109,2,150,255,109,2,150,255,109,2,150,255,109,2,150,255,
  109,2,150,255,109,2,150,255,109,2,150,255,109,2,150,255,
  109,2,150,255,109,2,150,255,110,3,151,255,110,3,151,255,
  110,3,151,255,110,3,151,255,110,3,151,255,110,3,151,255,
  110,3,151,255,47,11,155,255,35,12,156,255,22,14,156,255,
  22,17,157,255,23,20,158,255,23,22,159,255,23,25,159,255,
  23,27,160,255,24,29,161,255,24,31,162,255,35,90,181,255,
  34,96,183,255,33,102,185,255,31,109,187,255,30,111,188,255,
  30,111,188,255,30,111,188,255,30,111,188,255,30,111,188,255,
  30,111,188,255,44,161,206,255,45,169,209,255,45,178,211,255,
  44,186,214,255,42,195,217,255,40,204,220,255,41,206,221,255,
  41,207,221,255,42,209,222,255,43,211,222,255,117,228,231,255,
  123,229,232,255,128,230,232,255,134,230,233,255,139,231,233,255,
  144,232,234,255,149,232,235,255,153,233,235,255,158,234,236,255,
  162,234,236,255,167,235,237,255,171,236,238,255,176,236,238,255,
  180,237,239,255,181,237,239,255,181,237,239,255,181,237,239,255,
  181,237,239,255,181,237,239,255,181,237,239,255,181,237,239,255,
  155,239,181,255,145,240,164,255,135,240,146,255,123,240,129,255,
  109,241,110,255,93,241,90,255,73,241,67,255,42,241,37,255,
  2,241,3,255,2,240,3,255,2,212,1,255,2,208,1,255,
  2,203,1,255,2,199,1,255,2,195,1,255,2,191,1,255,
  1,186,1,255,1,182,1,255,1,178,1,255,1,174,1,255,
  1,170,1,255,1,166,1,255,1,162,1,255,1,157,0,255,
  1,153,0,255,1,149,0,255,1,145,0,255,0,141,0,255,
  0,137,0,255,0,134,0,255,0,130,0,255,0,126,0,255,
  0,122,0,255,0,118,0,255,0,114,0,255,0,110,0,255,
  0,106,0,255,0,103,0,255,1,100,1,255,7,101,4,255,
  12,102,8,255,80,122,78,255,84,123,81,255,88,124,85,255,
  91,124,88,255,95,125,91,255,98,126,94,255,101,127,98,255,
  105,128,101,255,108,129,104,255,112,130,108,255,135,118,121,255,
  137,117,122,255,137,111,116,255,137,105,110,255,137,100,104,255,
  137,94,98,255,136,88,92,255,136,82,86,255,135,76,81,255,
  134,70,75,255,133,64,70,255,113,14,15,255,113,12,13,255,
  112,9,11,255,111,7,8,255,111,5,6,255,110,3,3,255,
  109,1,1,255,112,0,1,255,115,0,1,255,119,0,2,255,
  123,0,3,255,127,0,3,255,131,0,4,255,135,0,4,255,
  138,0,5,255,142,0,5,255,146,0,5,255,150,0,6,255,
  154,0,6,255,158,0,6,255,162,0,6,255,166,0,7,255,
  170,0,7,255,174,0,7,255,178,0,7,255,182,0,7,255,
  187,0,7,255,191,0,7,255,195,0,7,255,199,0,7,255,
  203,0,7,255,247,42,60,255,248,44,63,255,248,46,67,255,
  248,48,70,255,249,50,74,255,249,54,79,255,251,62,86,255,
  252,70,94,255,253,77,102,255,254,83,109,255,255,89,117,255,
  255,95,125,255,255,101,133,255,255,107,141,255,255,112,149,255,
  254,156,203,255,253,158,202,255,253,160,201,255,254,173,197,255,
  255,186,192,255,254,230,167,255,254,230,166,255,254,230,166,255,
  254,230,165,255,254,230,165,255,254,229,164,255,254,229,163,255,
  254,229,163,255,253,229,162,255,253,229,162,255,253,228,161,255,
  253,228,161,255,253,228,160,255,253,226,158,255,254,222,154,255,
  254,219,150,255,254,215,147,255,255,212,143,255,255,208,140,255,
  255,204,136,255,255,201,133,255,253,147,82,255,253,147,82,255,
  253,146,82,255,253,146,82,255,253,146,82,255,253,146,82,255,
  253,146,82,255,253,146,82,255,254,146,81,255,254,145,81,255,
  254,145,81,255,254,145,81,255,254,145,81,255,254,145,81,255,
  254,145,81,255,254,144,81,255,254,144,81,255,254,144,81,255,
  254,144,81,255,254,144,81,255,254,144,81,255,254,143,81,255,
  254,143,81,255,254,143,80,255,254,143,80,255,254,143,80,255,
  254,143,80,255,254,142,80,255,254,142,80,255,254,142,80,255,
  253,142,80,255,250,139,78,255,247,136,76,255,243,133,74,255,
  240,130,73,255,236,127,71,255,233,124,69,255,229,121,68,255,
  226,118,66,255,223,115,64,255,219,112,62,255,110,14,9,255,
  110,14,9,255,0,0,0,0
]);

function velToRGBA(mps) {
  if (isNaN(mps) || mps === null) return null;
  const val = Math.max(2, Math.min(254, Math.round(mps / 0.5) + 129));
  const i = val * 4;
  return [VEL_LUT[i], VEL_LUT[i+1], VEL_LUT[i+2], VEL_LUT[i+3]];
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

// ── Compact velocity renderer ─────────────────────────────────────────────
// Compact format for VEL: same header/structure, but gate values encode
// velocity = (val - 129) * 0.5 m/s  (val 0=nodata, 1=range-folded, 2..254=data)
function renderCompactVelFlat(buf) {
  const { data, numAz, numGates, firstRangeM, gateSizeM, maxRangeKm, gateOffset } = parseCompact(buf);
  const rgba = new Uint8Array(numAz * numGates * 4);
  for (let r = 0; r < numAz; r++) {
    const src    = gateOffset + r * numGates;
    const dstRow = r * numGates * 4;
    for (let g = 0; g < numGates; g++) {
      const val = data[src + g];
      if (val === 0) continue;
      const pi = dstRow + g * 4;
      if (val === 1) {
        // Range-folded: AtticRadar RF color rgb(139,0,218)
        rgba[pi]=139; rgba[pi+1]=0; rgba[pi+2]=218; rgba[pi+3]=255;
        continue;
      }
      const mps = (val - 129) * 0.5;
      const rgb = velToRGBA(mps);
      if (!rgb) continue;
      rgba[pi] = rgb[0]; rgba[pi+1] = rgb[1]; rgba[pi+2] = rgb[2]; rgba[pi+3] = 255;
    }
  }
  return { rgba, nRays: numAz, nGates: numGates, firstRangeM, gateSizeM, maxRangeKm };
}

// ── Pyart region-based dealiasing (ported from AtticRadar/dealias.js) ────────
function dealias_region(velocities, nyquist_vel) {
  const MASKED=-64.5,splits=3,gapX=99,gapY=100,wrap=true;
  function c2(a){return a.map(r=>r.slice());}
  function ls(s,e,n){const a=[],st=(e-s)/(n-1);for(let i=0;i<n;i++)a.push(s+st*i);return a;}
  function find_limits(nyq,sp,vd){
    const interval=(2*nyq)/sp;let as=0,ae=0;
    const all=vd.flat().filter(v=>v!==MASKED);
    if(all.length){let mx=-Infinity,mn=Infinity;for(const v of all){if(v>mx)mx=v;if(v<mn)mn=v;}
      if(mx>nyq||mn<-nyq){as=Math.ceil((mx-nyq)/interval)|0;ae=Math.ceil(-(mn+nyq)/interval)|0;}}
    return ls(-nyq-as*interval,nyq+ae*interval,sp+1+as+ae);
  }
  function label_img(arr){
    const nR=arr.length,nG=arr[0].length,lbl=Array.from({length:nR},()=>new Int32Array(nG));
    let cnt=1;
    for(let i=0;i<nR;i++)for(let j=0;j<nG;j++){
      if(arr[i][j]&&lbl[i][j]===0){
        const q=[[i,j]];
        while(q.length){const[r,c]=q.shift();lbl[r][c]=cnt;
          for(const[dr,dc] of[[1,0],[-1,0],[0,1],[0,-1]]){
            const nr=r+dr,nc=c+dc;
            if(nr>=0&&nr<nR&&nc>=0&&nc<nG&&arr[nr][nc]&&lbl[nr][nc]===0){lbl[nr][nc]=-1;q.push([nr,nc]);}
          }}cnt++;}
    }
    for(let i=0;i<nR;i++)for(let j=0;j<nG;j++)if(lbl[i][j]===-1)lbl[i][j]=0;
    return[lbl,cnt-1];
  }
  function find_regions(vel,limits){
    const nR=vel.length,nG=vel[0].length,lbl=Array.from({length:nR},()=>new Int32Array(nG));
    let nf=0;
    for(let li=0;li<limits.length-1;li++){
      const lo=limits[li],hi=limits[li+1];
      const inp=vel.map(row=>row.map(v=>v!==MASKED&&v>=lo&&v<hi));
      const[ll,lf]=label_img(inp);
      for(let i=0;i<nR;i++)for(let j=0;j<nG;j++)if(ll[i][j])lbl[i][j]+=ll[i][j]+nf;
      nf+=lf;
    }
    return[lbl,nf];
  }
  function get_edges(lbl,data){
    const nR=lbl.length,nG=lbl[0].length,eMap=new Map();
    function add(a,b,va,vb){if(a===b||!a||!b)return;const k=a<b?`${a}_${b}`:`${b}_${a}`;
      if(!eMap.has(k))eMap.set(k,{a:a<b?a:b,b:a<b?b:a,sv:0,nv:0,cnt:0});
      const e=eMap.get(k);if(a<b){e.sv+=va;e.nv+=vb;}else{e.sv+=vb;e.nv+=va;}e.cnt++;}
    for(let x=0;x<nR;x++)for(let y=0;y<nG;y++){
      const lab=lbl[x][y];if(!lab)continue;const vel=data[x][y];
      let xc=x-1;if(xc===-1&&wrap)xc=nR-1;
      if(xc>=0){let nb=lbl[xc][y];if(!nb)for(let k=0;k<gapX&&!nb;k++){xc--;if(xc<0){if(wrap)xc=nR-1;else break;}nb=lbl[xc][y];}if(nb)add(lab,nb,vel,data[xc][y]);}
      xc=x+1;if(xc===nR&&wrap)xc=0;
      if(xc<nR){let nb=lbl[xc][y];if(!nb)for(let k=0;k<gapX&&!nb;k++){xc++;if(xc>=nR){if(wrap)xc=0;else break;}nb=lbl[xc][y];}if(nb)add(lab,nb,vel,data[xc][y]);}
      let yc=y-1;
      if(yc>=0){let nb=lbl[x][yc];if(!nb)for(let k=0;k<gapY&&!nb;k++){yc--;if(yc<0)break;nb=lbl[x][yc];}if(nb)add(lab,nb,vel,data[x][yc]);}
      yc=y+1;
      if(yc<nG){let nb=lbl[x][yc];if(!nb)for(let k=0;k<gapY&&!nb;k++){yc++;if(yc>=nG)break;nb=lbl[x][yc];}if(nb)add(lab,nb,vel,data[x][yc]);}
    }
    return[...eMap.values()];
  }

  const sdata=c2(velocities),scorr=c2(velocities);
  const ni=2*nyquist_vel,limits=find_limits(nyquist_vel,splits,sdata);
  const[labels,nf]=find_regions(sdata,limits);
  if(nf<2)return scorr;

  const rsizes=new Int32Array(nf+1);
  for(const row of labels)for(const v of row)if(v>0)rsizes[v]++;

  const edges=get_edges(labels,sdata);
  if(!edges.length)return scorr;

  const unwrap=new Int32Array(nf+1);
  const par=Array.from({length:nf+1},(_,i)=>i);
  const sz=rsizes.slice();
  function find(x){while(par[x]!==x){const p=par[x];par[x]=par[p];x=p;}return x;}

  edges.sort((a,b)=>b.cnt-a.cnt);
  for(const{a,b,sv,nv,cnt} of edges){
    const ra=find(a),rb=find(b);if(ra===rb)continue;
    const diff=(sv-nv)/cnt,rdiff=Math.round(diff);
    let base=ra,merge=rb,fold=rdiff;
    if(sz[rb]>sz[ra]){base=rb;merge=ra;fold=-rdiff;}
    if(fold!==0)for(let i=1;i<=nf;i++)if(find(i)===merge)unwrap[i]+=fold;
    par[merge]=base;sz[base]+=sz[merge];
  }

  let tf=0,tg=0;
  for(let i=1;i<=nf;i++){tf+=rsizes[i]*unwrap[i];tg+=rsizes[i];}
  if(tg>0){const off=Math.round(tf/tg);if(off)for(let i=0;i<=nf;i++)unwrap[i]-=off;}

  for(let r=0;r<labels.length;r++)for(let g=0;g<labels[0].length;g++){
    const lab=labels[r][g];if(lab&&unwrap[lab])scorr[r][g]+=unwrap[lab]*ni;}
  return scorr;
}

// ── Level-2 velocity renderer ─────────────────────────────────────────────
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
    let velPtr=-1,velNG=0,velScl=1,velOfs=0,velFG=0,velGS=0;
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
      if (b1===86&&b2===69&&b3===76) { velPtr=ptr;velNG=ng;velScl=scl;velOfs=ofs;velFG=fg;velGS=gs; }
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
        nyquist: radNyquist
      };
    }
    const ed = elevData[elevIdx];
    if (radNyquist > 0 && ed.nyquist === 0) ed.nyquist = radNyquist;
    if (ed.radialData[azBin * ed.numGates] <= -900) ed.populated++;
    ed.azAngles[azBin] = az;
    const velOff=base+velPtr+28;
    for(let g=0;g<velNG&&g<ed.numGates;g++){
      if(velOff+g>=chunk.length)break;
      const rv=chunk[chunk.byteOffset+velOff+g];
      ed.radialData[azBin*ed.numGates+g]=rv<=1?-999:(rv-velOfs)/velScl;
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

  const candidates = Object.values(elevData).filter(ed => ed.populated >= 360);
  if (!candidates.length) throw new Error('No VEL data found in any elevation');
  const best = candidates.reduce((b, e) => e.populated > b.populated ? e : b);

  const { numGates, firstGateM, gateSizeM, radialData, refData, refNumGates } = best;

  // Pyart region-based dealiasing
  let nyquist = 0;
  for (let i = 0; i < NUM_AZ * numGates; i++) {
    const v = radialData[i];
    if (v > -900 && Math.abs(v) > nyquist) nyquist = Math.abs(v);
  }
  if (nyquist > 0.5) {
    const MASKED = -64.5;
    const vel2d = [];
    for (let r = 0; r < NUM_AZ; r++) {
      const row = [];
      for (let g = 0; g < numGates; g++) {
        const v = radialData[r * numGates + g];
        row.push(v <= -900 ? MASKED : v);
      }
      vel2d.push(row);
    }
    const dealiased = dealias_region(vel2d, nyquist);
    for (let r = 0; r < NUM_AZ; r++) {
      for (let g = 0; g < numGates; g++) {
        if (radialData[r * numGates + g] <= -900) continue;
        radialData[r * numGates + g] = dealiased[r][g];
      }
    }
  }

  // REF quality mask
  if (refData) {
    const ratio = refNumGates / numGates;
    for(let r=0;r<NUM_AZ;r++) for(let g=0;g<numGates;g++){
      const rg=Math.min(Math.floor(g*ratio),refNumGates-1);
      if(refData[r*refNumGates+rg]<REF_MASK_DBZ) radialData[r*numGates+g]=-999;
    }
  }

  const rgba = new Uint8Array(NUM_AZ * numGates * 4);
  for (let r = 0; r < NUM_AZ; r++) {
    for (let g = 0; g < numGates; g++) {
      const mps = radialData[r * numGates + g];
      if (mps <= -900) continue;
      const rgb = velToRGBA(mps);
      if (!rgb) continue;
      const pi = (r * numGates + g) * 4;
      rgba[pi] = rgb[0]; rgba[pi+1] = rgb[1]; rgba[pi+2] = rgb[2]; rgba[pi+3] = 255;
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
