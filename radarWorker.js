// radarWorker.js — NEXRAD Level-2 parser + renderer
// Runs as a Web Worker. Receives raw file bytes, returns rendered ImageData.

importScripts('bzip2.js');

// ── RadarScope BR color table (254 stops, -32 to 94.5 dBZ, 0.5 step) ─────
const RAW_PALETTE = [
[-32,[115,77,172]],[-31.5,[115,78,168]],[-31,[115,79,165]],[-30.5,[115,81,162]],
[-30,[116,82,158]],[-29.5,[116,84,155]],[-29,[116,85,152]],[-28.5,[117,86,148]],
[-28,[117,88,145]],[-27.5,[117,89,142]],[-27,[118,91,138]],[-26.5,[118,92,135]],
[-26,[118,94,132]],[-25.5,[119,95,128]],[-25,[119,96,125]],[-24.5,[119,98,122]],
[-24,[120,99,118]],[-23.5,[120,101,115]],[-23,[120,102,112]],[-22.5,[121,103,108]],
[-22,[121,105,105]],[-21.5,[121,106,102]],[-21,[122,108,98]],[-20.5,[122,109,95]],
[-20,[122,111,92]],[-19.5,[123,112,88]],[-19,[123,113,85]],[-18.5,[123,115,82]],
[-18,[124,116,78]],[-17.5,[124,118,75]],[-17,[124,119,72]],[-16.5,[125,121,69]],
[-16,[127,123,72]],[-15.5,[129,125,75]],[-15,[131,127,79]],[-14.5,[133,130,82]],
[-14,[135,132,85]],[-13.5,[137,134,89]],[-13,[139,137,92]],[-12.5,[141,139,96]],
[-12,[144,141,99]],[-11.5,[146,144,102]],[-11,[148,146,106]],[-10.5,[150,148,109]],
[-10,[152,151,113]],[-9.5,[154,153,116]],[-9,[156,155,119]],[-8.5,[158,158,123]],
[-8,[161,160,126]],[-7.5,[163,162,130]],[-7,[165,165,133]],[-6.5,[167,167,136]],
[-6,[169,169,140]],[-5.5,[171,172,143]],[-5,[173,174,147]],[-4.5,[175,176,150]],
[-4,[178,179,154]],[-3.5,[173,175,153]],[-3,[168,171,152]],[-2.5,[163,167,151]],
[-2,[158,163,150]],[-1.5,[154,159,149]],[-1,[149,155,148]],[-0.5,[144,151,147]],
[0,[139,147,146]],[0.5,[135,144,145]],[1,[130,140,144]],[1.5,[125,136,143]],
[2,[120,132,142]],[2.5,[115,128,142]],[3,[111,124,141]],[3.5,[106,120,140]],
[4,[101,116,139]],[4.5,[96,112,138]],[5,[92,109,137]],[5.5,[87,105,136]],
[6,[82,101,135]],[6.5,[77,97,134]],[7,[73,93,133]],[7.5,[68,89,132]],
[8,[63,85,131]],[8.5,[58,81,130]],[9,[54,78,130]],[9.5,[55,81,132]],
[10,[57,85,134]],[10.5,[59,89,136]],[11,[61,93,138]],[11.5,[63,97,141]],
[12,[65,101,143]],[12.5,[67,105,145]],[13,[69,109,147]],[13.5,[71,113,149]],
[14,[73,117,152]],[14.5,[74,121,154]],[15,[76,125,156]],[15.5,[78,129,158]],
[16,[80,133,160]],[16.5,[82,137,163]],[17,[84,141,165]],[17.5,[86,145,167]],
[18,[88,149,169]],[18.5,[90,153,171]],[19,[92,157,174]],[19.5,[76,165,142]],
[20,[60,173,110]],[20.5,[45,182,78]],[21,[42,175,72]],[21.5,[39,169,67]],
[22,[37,163,62]],[22.5,[34,156,56]],[23,[31,150,51]],[23.5,[29,144,46]],
[24,[26,137,40]],[24.5,[24,131,35]],[25,[21,125,30]],[25.5,[18,118,24]],
[26,[16,112,19]],[26.5,[13,106,14]],[27,[11,100,9]],[27.5,[35,115,8]],
[28,[59,130,7]],[28.5,[83,145,6]],[29,[107,161,5]],[29.5,[131,176,4]],
[30,[155,191,3]],[30.5,[179,207,2]],[31,[203,222,1]],[31.5,[227,237,0]],
[32,[252,253,0]],[32.5,[248,248,0]],[33,[244,243,0]],[33.5,[241,238,0]],
[34,[237,233,0]],[34.5,[233,228,0]],[35,[230,223,0]],[35.5,[226,218,0]],
[36,[222,213,0]],[36.5,[219,208,0]],[37,[215,203,0]],[37.5,[211,198,0]],
[38,[208,193,0]],[38.5,[204,188,0]],[39,[200,183,0]],[39.5,[197,179,0]],
[40,[250,148,0]],[40.5,[246,144,0]],[41,[242,141,1]],[41.5,[238,138,1]],
[42,[234,135,2]],[42.5,[231,132,3]],[43,[227,129,3]],[43.5,[223,126,4]],
[44,[219,123,5]],[44.5,[215,120,5]],[45,[212,116,6]],[45.5,[208,113,6]],
[46,[204,110,7]],[46.5,[200,107,8]],[47,[196,104,8]],[47.5,[193,101,9]],
[48,[189,98,10]],[48.5,[185,95,10]],[49,[181,92,11]],[49.5,[178,89,12]],
[50,[249,35,11]],[50.5,[242,35,12]],[51,[236,35,13]],[51.5,[230,35,14]],
[52,[223,36,15]],[52.5,[217,36,16]],[53,[211,36,17]],[53.5,[205,36,18]],
[54,[198,37,19]],[54.5,[192,37,20]],[55,[186,37,22]],[55.5,[180,37,23]],
[56,[173,38,24]],[56.5,[167,38,25]],[57,[161,38,26]],[57.5,[155,38,27]],
[58,[148,39,28]],[58.5,[142,39,29]],[59,[136,39,30]],[59.5,[130,40,32]],
[60,[202,153,180]],[60.5,[201,146,176]],[61,[201,139,173]],[61.5,[200,133,169]],
[62,[200,126,166]],[62.5,[199,120,162]],[63,[199,113,159]],[63.5,[199,106,155]],
[64,[198,100,152]],[64.5,[198,93,148]],[65,[197,87,145]],[65.5,[197,80,141]],
[66,[196,74,138]],[66.5,[196,67,134]],[67,[196,60,131]],[67.5,[195,54,127]],
[68,[195,47,124]],[68.5,[194,41,120]],[69,[194,34,117]],[69.5,[194,28,114]],
[70,[154,36,224]],[70.5,[149,34,219]],[71,[144,33,215]],[71.5,[139,32,210]],
[72,[134,31,206]],[72.5,[129,30,201]],[73,[124,29,197]],[73.5,[120,28,193]],
[74,[115,27,188]],[74.5,[110,26,184]],[75,[105,24,179]],[75.5,[100,23,175]],
[76,[95,22,170]],[76.5,[91,21,166]],[77,[86,20,162]],[77.5,[81,19,157]],
[78,[76,18,153]],[78.5,[71,17,148]],[79,[66,16,144]],[79.5,[62,15,140]],
[80,[132,253,255]],[80.5,[128,245,249]],[81,[125,238,243]],[81.5,[121,231,237]],
[82,[118,224,231]],[82.5,[115,217,225]],[83,[111,210,219]],[83.5,[108,203,213]],
[84,[105,196,207]],[84.5,[101,189,201]],[85,[98,181,196]],[85.5,[94,174,190]],
[86,[91,167,184]],[86.5,[88,160,178]],[87,[84,153,172]],[87.5,[81,146,166]],
[88,[78,139,160]],[88.5,[74,132,154]],[89,[71,125,148]],[89.5,[68,118,143]],
[90,[161,101,73]],[90.5,[155,90,65]],[91,[150,80,56]],[91.5,[145,70,48]],
[92,[140,60,40]],[92.5,[135,50,32]],[93,[130,40,24]],[93.5,[125,30,16]],
[94,[120,20,8]],[94.5,[115,10,1]]
];

// Build flat Uint8Array lookup: index = round((dbz + 32) * 2), value = [r,g,b]
const PALETTE_MIN = -32;
const PALETTE_SCALE = 2; // 1/step = 1/0.5
const PALETTE_SIZE = 254;
const PALETTE = new Uint8Array(PALETTE_SIZE * 3);
for (let i = 0; i < RAW_PALETTE.length; i++) {
  PALETTE[i*3]   = RAW_PALETTE[i][1][0];
  PALETTE[i*3+1] = RAW_PALETTE[i][1][1];
  PALETTE[i*3+2] = RAW_PALETTE[i][1][2];
}

function dbzToRgb(dbz) {
  let idx = Math.round((dbz - PALETTE_MIN) * PALETTE_SCALE);
  idx = Math.max(0, Math.min(PALETTE_SIZE - 1, idx));
  return [PALETTE[idx*3], PALETTE[idx*3+1], PALETTE[idx*3+2]];
}

// ── Level-2 Parser ────────────────────────────────────────────────────────
function parseLevel2(buf) {
  const data = new Uint8Array(buf);
  const dv   = new DataView(buf);

  // 24-byte file header — skip it
  let pos = 24;

  // radials indexed by azimuth bin (0.5° resolution → 720 bins)
  const NUM_AZ = 720;
  let numGates   = 0;
  let firstGateM = 0;
  let gateSizeM  = 0;

  // flat array: [azBin][gate] → raw dBZ value (or NaN)
  let radialData = null; // allocated after first block tells us numGates

  let elevation1Count = 0;

  while (pos + 4 <= data.length) {
    // LDM compressed record header
    const compSize = dv.getInt32(pos, false); // big-endian signed
    pos += 4;
    if (compSize === -1 || compSize === 0) break;

    let chunk;
    if (compSize > 0) {
      // bzip2 compressed
      const compressed = data.slice(pos, pos + compSize);
      pos += compSize;
      try {
        chunk = Bzip2.decompress(compressed);
      } catch(e) {
        continue; // skip bad chunk
      }
    } else {
      // uncompressed
      const sz = -compSize;
      chunk = data.slice(pos, pos + sz);
      pos += sz;
    }

    // Walk messages within this chunk
    let mpos = 0;
    while (mpos + 28 <= chunk.length) {
      // 12-byte CTM header, then 16-byte message header
      const msgType = chunk[mpos + 15];
      const msgSizeHW = (chunk[mpos+12] << 8) | chunk[mpos+13]; // halfwords after CTM
      const msgBytes = 12 + msgSizeHW * 2;

      if (msgType === 31 && mpos + msgBytes <= chunk.length) {
        parseMsg31(chunk, mpos + 28); // data starts at offset 28
      }

      // Advance — guard against infinite loop
      const step = Math.max(msgBytes, 28);
      mpos += step;
    }
  }

  function parseMsg31(chunk, base) {
    // base = offset into chunk where Type 31 data starts
    if (base + 36 > chunk.length) return;

    const elevNum = chunk[base + 22]; // 1-based
    if (elevNum !== 1) return; // only base tilt (0.5°)

    // azimuth
    const azDV  = new DataView(chunk.buffer, chunk.byteOffset + base + 12, 4);
    const az    = azDV.getFloat32(0, false); // big-endian float
    const azBin = Math.floor(((az % 360) + 360) % 360 * 2) % NUM_AZ;

    // data block count + pointers
    const blockCount = (chunk[base+30] << 8) | chunk[base+31];
    if (blockCount < 1 || base + 32 + blockCount*4 > chunk.length) return;

    for (let b = 0; b < blockCount; b++) {
      const ptrDV = new DataView(chunk.buffer, chunk.byteOffset + base + 32 + b*4, 4);
      const ptr   = ptrDV.getUint32(0, false); // offset from start of msg31 data
      const boff  = base + ptr;
      if (boff + 28 > chunk.length) continue;

      // Check block type 'D' (68) and name 'REF' (82,69,70)
      if (chunk[boff] !== 68) continue; // 'D'
      if (chunk[boff+1] !== 82 || chunk[boff+2] !== 69 || chunk[boff+3] !== 70) continue; // 'REF'

      const gatesDV = new DataView(chunk.buffer, chunk.byteOffset + boff + 8, 20);
      const ng      = gatesDV.getUint16(0, false); // number of gates
      const fg      = gatesDV.getUint16(2, false); // range to first gate (meters)
      const gs      = gatesDV.getUint16(4, false); // gate size (meters)
      const wSize   = chunk[boff + 19];            // word size (8 or 16)
      const scale   = gatesDV.getFloat32(10, false);
      const offset  = gatesDV.getFloat32(14, false);

      // Allocate radialData on first valid REF block
      if (radialData === null) {
        numGates   = ng;
        firstGateM = fg;
        gateSizeM  = gs;
        radialData = new Float32Array(NUM_AZ * ng).fill(-999);
      }

      const dataStart = boff + 28;
      const bytesPerGate = wSize === 16 ? 2 : 1;

      for (let g = 0; g < ng && dataStart + (g+1)*bytesPerGate <= chunk.length; g++) {
        let raw;
        if (bytesPerGate === 2) {
          raw = (chunk[dataStart + g*2] << 8) | chunk[dataStart + g*2 + 1];
        } else {
          raw = chunk[dataStart + g];
        }
        if (raw <= 1) {
          radialData[azBin * ng + g] = -999; // no data
        } else {
          radialData[azBin * ng + g] = (raw - offset) / scale;
        }
      }

      elevation1Count++;
      break; // found REF, done with this message
    }
  }

  return { radialData, numGates, firstGateM, gateSizeM, NUM_AZ };
}

// ── Renderer ───────────────────────────────────────────────────────────────
function renderRadar(parsed, canvasSize) {
  const { radialData, numGates, firstGateM, gateSizeM, NUM_AZ } = parsed;
  if (!radialData) return null;

  const W = canvasSize, H = canvasSize;
  const pixels = new Uint8ClampedArray(W * H * 4); // RGBA, default alpha=0

  const maxRangeM = firstGateM + numGates * gateSizeM;
  const maxRangeKm = maxRangeM / 1000;

  // km per pixel: canvas covers 2× max range
  const kmPerPx = (maxRangeKm * 2) / W;
  const cx = W / 2, cy = H / 2;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const dx =  (px - cx) * kmPerPx;
      const dy = -(py - cy) * kmPerPx; // north is up → y flipped

      const rangeKm = Math.sqrt(dx*dx + dy*dy);
      const rangeM  = rangeKm * 1000;
      if (rangeM < firstGateM || rangeM > maxRangeM) continue;

      // Meteorological azimuth: 0=N, 90=E, clockwise
      let az = Math.atan2(dx, dy) * 180 / Math.PI;
      if (az < 0) az += 360;
      const azBin = Math.floor(az * 2) % NUM_AZ; // 0.5° bins

      const gateIdx = Math.floor((rangeM - firstGateM) / gateSizeM);
      if (gateIdx < 0 || gateIdx >= numGates) continue;

      const dbz = radialData[azBin * numGates + gateIdx];
      if (dbz < -32) continue; // no data

      const [r, g, b] = dbzToRgb(dbz);
      const pi = (py * W + px) * 4;
      pixels[pi]   = r;
      pixels[pi+1] = g;
      pixels[pi+2] = b;
      pixels[pi+3] = 220; // slight transparency
    }
  }

  return { pixels, width: W, height: H, maxRangeKm };
}

// ── Message handler ────────────────────────────────────────────────────────
self.onmessage = function(e) {
  const { id, buffer, canvasSize } = e.data;
  try {
    const parsed   = parseLevel2(buffer);
    if (!parsed || !parsed.radialData) {
      self.postMessage({ id, error: 'No reflectivity data found' });
      return;
    }
    const rendered = renderRadar(parsed, canvasSize || 800);
    self.postMessage({ id, rendered }, [rendered.pixels.buffer]);
  } catch(err) {
    self.postMessage({ id, error: err.message });
  }
};
