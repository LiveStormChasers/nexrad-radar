// radarWorker.js — NEXRAD Level-2 parser for NOMADS .bz2 files
// NOMADS format: entire file is bzip2 compressed → decompress → 24-byte header + LDM records

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
// Build flat byte array: index = (dbz+32)*2, value=[r,g,b]
const PALETTE = new Uint8Array(PAL_DATA.length * 3);
for (let i = 0; i < PAL_DATA.length; i++) {
  PALETTE[i*3]=PAL_DATA[i][0]; PALETTE[i*3+1]=PAL_DATA[i][1]; PALETTE[i*3+2]=PAL_DATA[i][2];
}
const PAL_SIZE = PAL_DATA.length;

function dbzColor(dbz, out, off) {
  let idx = Math.round((dbz + 32) * 2);
  if (idx < 0) idx = 0;
  if (idx >= PAL_SIZE) idx = PAL_SIZE - 1;
  out[off]   = PALETTE[idx*3];
  out[off+1] = PALETTE[idx*3+1];
  out[off+2] = PALETTE[idx*3+2];
}

// ── Parser ────────────────────────────────────────────────────────────────
function parseLevel2(raw) {
  // NOMADS files: entire file is one bzip2 stream
  // Decompress → standard NEXRAD Level-2 binary
  let data;
  try {
    data = Bzip2.decompress(new Uint8Array(raw));
  } catch(e) {
    // Maybe it's not compressed (shouldn't happen with NOMADS)
    data = new Uint8Array(raw);
  }

  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // 24-byte archive-II file header
  // Bytes 0-3: "AR2V" magic
  // Bytes 4-8: version
  // Bytes 8-12: extension number
  // Bytes 12-16: date (modified Julian)
  // Bytes 16-20: time (ms since midnight)
  // Bytes 20-24: ICAO (station ID)
  let pos = 24;

  const NUM_AZ = 720; // 0.5° bins
  let radialData = null;
  let numGates = 0, firstGateM = 0, gateSizeM = 0;

  // Loop through LDM compressed records
  while (pos + 4 <= data.length) {
    // Each record: 4-byte size (big-endian signed), then data
    // Negative size = uncompressed, positive = bzip2 compressed record
    const recSizeRaw = dv.getInt32(pos, false);
    pos += 4;
    if (recSizeRaw === 0) break;

    let chunk;
    const recSize = Math.abs(recSizeRaw);
    if (pos + recSize > data.length) break;

    if (recSizeRaw < 0) {
      // Uncompressed record
      chunk = data.slice(pos, pos + recSize);
    } else {
      // bzip2-compressed record
      try {
        chunk = Bzip2.decompress(data.slice(pos, pos + recSize));
      } catch(e) {
        pos += recSize;
        continue;
      }
    }
    pos += recSize;

    // Walk messages in this chunk (each message has 12-byte CTM + 16-byte header)
    let mpos = 0;
    while (mpos + 28 <= chunk.length) {
      const msgType    = chunk[mpos + 15];
      const segsHW     = (chunk[mpos+12] << 8) | chunk[mpos+13];
      const msgBytes   = 12 + segsHW * 2;

      if (msgType === 31) {
        parseMsg31(chunk, mpos + 28, mpos + Math.max(msgBytes, 28));
      }

      mpos += Math.max(msgBytes, 28);
    }
  }

  function parseMsg31(chunk, base) {
    if (base + 68 > chunk.length) return;
    const dv2 = new DataView(chunk.buffer, chunk.byteOffset + base);

    // Elevation number at offset 22 (1-based) — only want elevation 1 (0.5°)
    const elevNum = dv2.getUint8(22);
    if (elevNum !== 1) return;

    // Azimuth at offset 12 (float32 big-endian)
    const az    = dv2.getFloat32(12, false);
    const azBin = Math.floor(((az % 360 + 360) % 360) * 2) % NUM_AZ;

    // Number of data blocks at offset 30 (uint16)
    const nBlocks = dv2.getUint16(30, false);
    if (nBlocks < 1) return;

    // Block pointers start at offset 32 (uint32 each)
    for (let b = 0; b < nBlocks && b < 10; b++) {
      if (base + 32 + (b+1)*4 > chunk.length) break;
      const ptr  = dv2.getUint32(32 + b*4, false);
      const boff = ptr; // offset from start of msg31 data block

      if (base + boff + 28 > chunk.length) continue;

      // Check block type 'D' (68) and name 'REF'
      if (chunk[chunk.byteOffset + base + boff] !== 68) continue;
      if (chunk[chunk.byteOffset + base + boff+1] !== 82 ||
          chunk[chunk.byteOffset + base + boff+2] !== 69 ||
          chunk[chunk.byteOffset + base + boff+3] !== 70) continue;

      const bdv = new DataView(chunk.buffer, chunk.byteOffset + base + boff);
      const ng  = bdv.getUint16(8, false);   // number of gates
      const fg  = bdv.getUint16(10, false);  // first gate range (m)
      const gs  = bdv.getUint16(12, false);  // gate size (m)
      const scl = bdv.getFloat32(20, false); // scale
      const ofs = bdv.getFloat32(24, false); // offset

      if (!radialData) {
        numGates = ng; firstGateM = fg; gateSizeM = gs;
        radialData = new Float32Array(NUM_AZ * ng).fill(-999);
      }

      const dataOff = base + boff + 28;
      for (let g = 0; g < ng; g++) {
        if (dataOff + g >= chunk.length) break;
        const raw = chunk[chunk.byteOffset + dataOff + g];
        radialData[azBin * numGates + g] = raw <= 1 ? -999 : (raw - ofs) / scl;
      }
      break;
    }
  }

  return { radialData, numGates, firstGateM, gateSizeM, NUM_AZ };
}

// ── Renderer ───────────────────────────────────────────────────────────────
function render(parsed, sz) {
  const { radialData, numGates, firstGateM, gateSizeM, NUM_AZ } = parsed;
  if (!radialData) return null;

  const pixels = new Uint8ClampedArray(sz * sz * 4);
  const maxRangeM  = firstGateM + numGates * gateSizeM;
  const maxRangeKm = maxRangeM / 1000;
  const kmPx = (maxRangeKm * 2) / sz;
  const cx = sz / 2, cy = sz / 2;

  for (let py = 0; py < sz; py++) {
    const dy = -(py - cy) * kmPx;
    const dy2 = dy * dy;
    for (let px = 0; px < sz; px++) {
      const dx = (px - cx) * kmPx;
      const rM = Math.sqrt(dx*dx + dy2) * 1000;
      if (rM < firstGateM || rM > maxRangeM) continue;

      let az = Math.atan2(dx, dy) * 180 / Math.PI;
      if (az < 0) az += 360;
      const azBin   = Math.floor(az * 2) % NUM_AZ;
      const gateIdx = Math.floor((rM - firstGateM) / gateSizeM);
      if (gateIdx >= numGates) continue;

      const dbz = radialData[azBin * numGates + gateIdx];
      if (dbz < -32) continue;

      const pi = (py * sz + px) * 4;
      dbzColor(dbz, pixels, pi);
      pixels[pi+3] = 230;
    }
  }
  return { pixels, width: sz, height: sz, maxRangeKm };
}

// ── Message handler ────────────────────────────────────────────────────────
self.onmessage = function(e) {
  const { id, buffer, canvasSize } = e.data;
  try {
    const parsed = parseLevel2(buffer);
    if (!parsed || !parsed.radialData) {
      self.postMessage({ id, error: 'No REF data found in this file' });
      return;
    }
    const result = render(parsed, canvasSize || 900);
    if (!result) { self.postMessage({ id, error: 'Render failed' }); return; }
    self.postMessage({ id, rendered: result }, [result.pixels.buffer]);
  } catch(err) {
    self.postMessage({ id, error: err.message });
  }
};
