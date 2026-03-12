// radarWorker.js — dual-mode NEXRAD renderer
//
// Fast path (message.type === 'compact'):
//   Server preprocessed the Level-2 file → compact binary (already decompressed by fetch).
//   Format: 24-byte header + azimuth f32[] + u8 gate data (palette index + 1, 0=nodata)
//   Render time: ~50ms instead of ~8000ms
//
// Slow path (message.type === 'level2' or fallback):
//   Raw .bz2 NEXRAD Level-2 from NOMADS — decompress + parse + render in browser.
//   Kept for fallback if /radar/process/ is unavailable.
//
// In both cases: postMessage({ id, rendered:{ pixels, width, height, maxRangeKm } })

importScripts('bzip2.js');

// ── RadarScope BR palette: 254 stops, -32 to 94.5 dBZ, 0.5 step ──────────
const PAL_DATA = [
[115,77,172],[115,78,168],[115,79,165],[115,81,162],[116,82,158],[116,84,155],
[116,85,152],[117,86,148],[117,88,145],[117,89,142],[118,91,138],[118,92,135],
[118,94,132],[119,95,128],[119,96,125],[119,98,122],[120,99,118],[120,101,115],
[120,102,112],[121,103,108],[121,105,105],[121,106,102],[122,108,98],[122,109,95],
[122,111,92],[123,112,88],[123,113,85],[123,115,82],[124,116,78],[124,118,75],
[124,119,72],[125,121,69],[127,123,72],[129,125,75],[131,127,79],[133,130,82],
[135,132,85],[137,134,89],[139,137,92],[141,139,96],[144,141,99],[146,144,102],
[148,146,106],[150,148,109],[152,151,113],[154,153,116],[156,155,119],[158,158,123],
[161,160,126],[163,162,130],[165,165,133],[167,167,136],[169,169,140],[171,172,143],
[173,174,147],[175,176,150],[178,179,154],[173,175,153],[168,171,152],[163,167,151],
[158,163,150],[154,159,149],[149,155,148],[144,151,147],[139,147,146],[135,144,145],
[130,140,144],[125,136,143],[120,132,142],[115,128,142],[111,124,141],[106,120,140],
[101,116,139],[96,112,138],[92,109,137],[87,105,136],[82,101,135],[77,97,134],
[73,93,133],[68,89,132],[63,85,131],[58,81,130],[54,78,130],[55,81,132],
[57,85,134],[59,89,136],[61,93,138],[63,97,141],[65,101,143],[67,105,145],
[69,109,147],[71,113,149],[73,117,152],[74,121,154],[76,125,156],[78,129,158],
[80,133,160],[82,137,163],[84,141,165],[86,145,167],[88,149,169],[90,153,171],
[92,157,174],[76,165,142],[60,173,110],[45,182,78],[42,175,72],[39,169,67],
[37,163,62],[34,156,56],[31,150,51],[29,144,46],[26,137,40],[24,131,35],
[21,125,30],[18,118,24],[16,112,19],[13,106,14],[11,100,9],[35,115,8],
[59,130,7],[83,145,6],[107,161,5],[131,176,4],[155,191,3],[179,207,2],
[203,222,1],[227,237,0],[252,253,0],[248,248,0],[244,243,0],[241,238,0],
[237,233,0],[233,228,0],[230,223,0],[226,218,0],[222,213,0],[219,208,0],
[215,203,0],[211,198,0],[208,193,0],[204,188,0],[200,183,0],[197,179,0],
[250,148,0],[246,144,0],[242,141,1],[238,138,1],[234,135,2],[231,132,3],
[227,129,3],[223,126,4],[219,123,5],[215,120,5],[212,116,6],[208,113,6],
[204,110,7],[200,107,8],[196,104,8],[193,101,9],[189,98,10],[185,95,10],
[181,92,11],[178,89,12],[249,35,11],[242,35,12],[236,35,13],[230,35,14],
[223,36,15],[217,36,16],[211,36,17],[205,36,18],[198,37,19],[192,37,20],
[186,37,22],[180,37,23],[173,38,24],[167,38,25],[161,38,26],[155,38,27],
[148,39,28],[142,39,29],[136,39,30],[130,40,32],[202,153,180],[201,146,176],
[201,139,173],[200,133,169],[200,126,166],[199,120,162],[199,113,159],[199,106,155],
[198,100,152],[198,93,148],[197,87,145],[197,80,141],[196,74,138],[196,67,134],
[196,60,131],[195,54,127],[195,47,124],[194,41,120],[194,34,117],[194,28,114],
[154,36,224],[149,34,219],[144,33,215],[139,32,210],[134,31,206],[129,30,201],
[124,29,197],[120,28,193],[115,27,188],[110,26,184],[105,24,179],[100,23,175],
[95,22,170],[91,21,166],[86,20,162],[81,19,157],[76,18,153],[71,17,148],
[66,16,144],[62,15,140],[132,253,255],[128,245,249],[125,238,243],[121,231,237],
[118,224,231],[115,217,225],[111,210,219],[108,203,213],[105,196,207],[101,189,201],
[98,181,196],[94,174,190],[91,167,184],[88,160,178],[84,153,172],[81,146,166],
[78,139,160],[74,132,154],[71,125,148],[68,118,143],[161,101,73],[155,90,65],
[150,80,56],[145,70,48],[140,60,40],[135,50,32],[130,40,24],[125,30,16],
[120,20,8],[115,10,1]
];

// Pre-build RGBA flat palette (index → 4 bytes including alpha=230)
// Index 0 = transparent (no data), indices 1..254 → palette entry 0..253
const RGBA_PAL = new Uint8Array(255 * 4); // slot 0 = no-data (transparent)
for (let i = 0; i < PAL_DATA.length; i++) {
  const slot = (i + 1) * 4; // slot 0 unused (no-data), slot 1 = pal[0]
  RGBA_PAL[slot]   = PAL_DATA[i][0];
  RGBA_PAL[slot+1] = PAL_DATA[i][1];
  RGBA_PAL[slot+2] = PAL_DATA[i][2];
  RGBA_PAL[slot+3] = 230;
}

// Also keep flat palette for slow-path dBZ → index lookup
const PALETTE = new Uint8Array(PAL_DATA.length * 3);
for (let i = 0; i < PAL_DATA.length; i++) {
  PALETTE[i*3]=PAL_DATA[i][0]; PALETTE[i*3+1]=PAL_DATA[i][1]; PALETTE[i*3+2]=PAL_DATA[i][2];
}
const PAL_SIZE = PAL_DATA.length;

// ═══════════════════════════════════════════════════════════════
// FAST PATH — render compact binary (pre-processed by CF Worker)
// ═══════════════════════════════════════════════════════════════

function renderCompact(compactBuf, sz) {
  const data = new Uint8Array(compactBuf);
  const dv   = new DataView(compactBuf);

  // Validate magic
  if (dv.getUint32(0, true) !== 0x52444152) throw new Error('Bad compact magic');

  const numAz      = dv.getUint32(4,  true);
  const numGates   = dv.getUint32(8,  true);
  const firstRangeM= dv.getFloat32(12, true);
  const gateSizeM  = dv.getFloat32(16, true);
  const maxRangeKm = dv.getFloat32(20, true);

  const azOffset   = 24;
  const gateOffset = azOffset + numAz * 4;

  // Build az lookup table: azimuth angle (degrees) → az bin index
  // We use nearest-radial rendering: for each pixel, compute az, find nearest bin
  const azDeg = new Float32Array(numAz);
  for (let i = 0; i < numAz; i++)
    azDeg[i] = dv.getFloat32(azOffset + i*4, true);

  const pixels    = new Uint8ClampedArray(sz * sz * 4);
  const maxRangeM = maxRangeKm * 1000;
  const kmPx      = (maxRangeKm * 2) / sz;
  const cx = sz / 2, cy = sz / 2;

  for (let py = 0; py < sz; py++) {
    const dy  = -(py - cy) * kmPx;
    const dy2 = dy * dy;
    for (let px = 0; px < sz; px++) {
      const dx = (px - cx) * kmPx;
      const rM = Math.sqrt(dx*dx + dy2) * 1000;
      if (rM < firstRangeM || rM > maxRangeM) continue;

      let az = Math.atan2(dx, dy) * 180 / Math.PI;
      if (az < 0) az += 360;
      const azBin   = Math.floor(az * 2) % numAz; // 0.5° bins
      const gateIdx = Math.floor((rM - firstRangeM) / gateSizeM);
      if (gateIdx >= numGates) continue;

      const val = data[gateOffset + azBin * numGates + gateIdx];
      if (val === 0) continue; // no data

      const pi = (py * sz + px) * 4;
      const slot = val * 4; // val is palIdx+1, so slot = (palIdx+1)*4
      pixels[pi]   = RGBA_PAL[slot];
      pixels[pi+1] = RGBA_PAL[slot+1];
      pixels[pi+2] = RGBA_PAL[slot+2];
      pixels[pi+3] = RGBA_PAL[slot+3];
    }
  }

  return { pixels, width: sz, height: sz, maxRangeKm };
}

// ═══════════════════════════════════════════════════════════════
// SLOW PATH — raw Level-2 parser (kept as fallback)
// ═══════════════════════════════════════════════════════════════

function parseLevel2(raw) {
  let data;
  try { data = Bzip2.decompress(new Uint8Array(raw)); }
  catch(e) { data = new Uint8Array(raw); }

  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 24;

  const NUM_AZ = 720;
  let radialData = null;
  let numGates = 0, firstGateM = 0, gateSizeM = 0;

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
    if (nBlocks < 1) return;
    for (let b = 0; b < nBlocks && b < 10; b++) {
      if (base + 32 + (b+1)*4 > chunk.length) break;
      const ptr  = dv2.getUint32(32 + b*4, false);
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
        const raw = chunk[chunk.byteOffset + dataOff + g];
        radialData[azBin*numGates+g] = raw<=1 ? -999 : (raw-ofs)/scl;
      }
      break;
    }
  }

  return { radialData, numGates, firstGateM, gateSizeM, NUM_AZ };
}

function renderLevel2(parsed, sz) {
  const { radialData, numGates, firstGateM, gateSizeM, NUM_AZ } = parsed;
  if (!radialData) return null;
  const pixels = new Uint8ClampedArray(sz * sz * 4);
  const maxRangeM  = firstGateM + numGates * gateSizeM;
  const maxRangeKm = maxRangeM / 1000;
  const kmPx = (maxRangeKm * 2) / sz;
  const cx = sz/2, cy = sz/2;

  for (let py = 0; py < sz; py++) {
    const dy = -(py-cy)*kmPx, dy2=dy*dy;
    for (let px = 0; px < sz; px++) {
      const dx = (px-cx)*kmPx;
      const rM = Math.sqrt(dx*dx+dy2)*1000;
      if (rM < firstGateM || rM > maxRangeM) continue;
      let az = Math.atan2(dx,dy)*180/Math.PI;
      if (az<0) az+=360;
      const azBin   = Math.floor(az*2)%NUM_AZ;
      const gateIdx = Math.floor((rM-firstGateM)/gateSizeM);
      if (gateIdx>=numGates) continue;
      const dbz = radialData[azBin*numGates+gateIdx];
      if (dbz<-32) continue;
      let idx = Math.round((dbz+32)*2);
      if (idx<0) idx=0; if(idx>=PAL_SIZE) idx=PAL_SIZE-1;
      const pi = (py*sz+px)*4;
      pixels[pi]=PALETTE[idx*3]; pixels[pi+1]=PALETTE[idx*3+1]; pixels[pi+2]=PALETTE[idx*3+2]; pixels[pi+3]=230;
    }
  }
  return { pixels, width:sz, height:sz, maxRangeKm };
}

// ═══════════════════════════════════════════════════════════════
// Message handler
// ═══════════════════════════════════════════════════════════════

self.onmessage = function(e) {
  const { id, buffer, type, canvasSize } = e.data;
  const sz = canvasSize || 2048;

  try {
    let result;

    if (type === 'compact') {
      // Fast path: compact binary from /radar/process/
      result = renderCompact(buffer, sz);
    } else {
      // Slow path: raw Level-2 from /radar/file/
      const parsed = parseLevel2(buffer);
      if (!parsed || !parsed.radialData) {
        self.postMessage({ id, error: 'No REF data found' });
        return;
      }
      result = renderLevel2(parsed, sz);
    }

    if (!result) { self.postMessage({ id, error: 'Render failed' }); return; }
    self.postMessage({ id, rendered: result }, [result.pixels.buffer]);
  } catch(err) {
    self.postMessage({ id, error: err.message });
  }
};
