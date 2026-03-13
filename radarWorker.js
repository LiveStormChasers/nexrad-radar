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


// ── OpenSnow exact velocity palette ──────────────────────────────────────
// Negative = toward radar, Positive = away from radar
// Source: reverse-engineered from opensnow.com/stormnet radarWorker
const VEL_NEG = [ // toward (negative m/s)
  { v: -60, c: [255,182,193] },
  { v: -50, c: [139,  0,139] },
  { v: -40, c: [  0,  0,139] },
  { v: -30, c: [173,216,230] },
  { v: -20, c: [144,238,144] },
  { v: -10, c: [  0,100,  0] },
  { v:   0, c: [128,128,128] },
];
const VEL_POS = [ // away (positive m/s)
  { v:  0, c: [128,128,128] },
  { v: 20, c: [139,  0,  0] },
  { v: 40, c: [255,192,203] },
  { v: 50, c: [244,164, 96] },
  { v: 60, c: [101, 67, 33] },
];

function velToRGBA(mps) {
  const mph = mps * 2.23694;
  const s   = Math.max(-60, Math.min(60, mph));
  const table = s >= 0 ? VEL_POS : VEL_NEG;
  // Below first stop → transparent (matches OpenSnow: s<=o[0].vel → [0,0,0,0])
  if (s <= table[0].v) return null;
  // Above last stop → clamp to last color
  if (s >= table[table.length-1].v) {
    const c = table[table.length-1].c; return [c[0],c[1],c[2]];
  }
  for (let i = 0; i < table.length - 1; i++) {
    if (s >= table[i].v && s < table[i+1].v) {
      const t  = (s - table[i].v) / (table[i+1].v - table[i].v);
      const c0 = table[i].c, c1 = table[i+1].c;
      return [
        Math.round(c0[0] + t*(c1[0]-c0[0])),
        Math.round(c0[1] + t*(c1[1]-c0[1])),
        Math.round(c0[2] + t*(c1[2]-c0[2])),
      ];
    }
  }
  return null;
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
      if (val <= 1) continue;
      const mps = (val - 129) * 0.5;
      const rgb = velToRGBA(mps);
      if (!rgb) continue;
    }
  }
  return { rgba, nRays: numAz, nGates: numGates, firstRangeM, gateSizeM, maxRangeKm };
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
  let radialData = null, numGates = 0, firstGateM = 0, gateSizeM = 0;
  let foundElevIdx = null;

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
      if (msgType === 31) parseMsg31vel(chunk, mpos + 28);
      mpos += Math.max(msgBytes, 28);
    }
  }

  function parseMsg31vel(chunk, base) {
    if (base + 68 > chunk.length) return;
    const dv2 = new DataView(chunk.buffer, chunk.byteOffset + base);
    const elevIdx = dv2.getUint8(22);
    if (elevIdx < 2) return; // VEL never on elev 1 (surveillance cut)
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
      // Look for VEL block (type 'D' + 'VEL')
      if (chunk[bbase+1]!==86||chunk[bbase+2]!==69||chunk[bbase+3]!==76) continue;
      const bdv = new DataView(chunk.buffer, bbase);
      const ng  = bdv.getUint16(8,  false);
      const fg  = bdv.getUint16(10, false);
      const gs  = bdv.getUint16(12, false);
      const scl = bdv.getFloat32(20, false);
      const ofs = bdv.getFloat32(24, false);
      if (!radialData) {
        numGates=ng; firstGateM=fg; gateSizeM=gs;
        radialData=new Float32Array(NUM_AZ*ng).fill(-999);
        foundElevIdx = elevIdx;
      }
      const dataOff = base + ptr + 28;
      for (let g = 0; g < ng; g++) {
        if (dataOff + g >= chunk.length) break;
        const rv = chunk[chunk.byteOffset + dataOff + g];
        radialData[azBin*numGates+g] = rv<=1 ? -999 : (rv-ofs)/scl;
      }
      break;
    }
  }

  if (!radialData) throw new Error('No elevation-1 VEL data found');
  const rgba = new Uint8Array(NUM_AZ * numGates * 4);
  for (let r = 0; r < NUM_AZ; r++) {
    for (let g = 0; g < numGates; g++) {
      const mps = radialData[r * numGates + g];
      if (mps <= -900) continue;
      const rgb = velToRGBA(mps);
      if (!rgb) continue;
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
    if (elevIdx < 2) return;
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
