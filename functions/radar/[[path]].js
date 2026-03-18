// Cloudflare Pages Function — NEXRAD Level-2 preprocessor
// Routes:
//   GET /radar/list/KXXX            → JSON array of last 10 filenames
//   GET /radar/file/KXXX/filename   → raw .bz2 passthrough (legacy / fallback)
//   GET /radar/process/KXXX/filename → compact binary (auto-gzip), cached at CF edge
//
// REQUIRES: CF Workers paid plan ($5/mo) for CPU budget.
// Free plan CPU = 10ms — not enough to decompress+parse a 15MB bzip2 file.
// Paid plan = up to 30s CPU — plenty.
//
// Compact binary format (returned by /radar/process, Content-Encoding: gzip):
//   Header (24 bytes):
//     [0..3]   u32 LE  magic = 0x52444152 ("RDAR")
//     [4..7]   u32 LE  numAz  (720)
//     [8..11]  u32 LE  numGates
//     [12..15] f32 LE  firstRangeM
//     [16..19] f32 LE  gateSizeM
//     [20..23] f32 LE  maxRangeKm
//   Az angles (numAz × 4 bytes):
//     f32 LE[numAz]  — actual measured azimuth degrees per bin
//   Gate data (numAz × numGates bytes):
//     u8[numAz × numGates]
//     0 = no data / below threshold
//     1..254 = palette index + 1
//             palIdx = round((dBZ + 32) * 2), clamped 0..253

// ═══════════════════════════════════════════════════════════════
// Bzip2 decompressor (inlined — pure JS, no dependencies)
// ═══════════════════════════════════════════════════════════════

function BitReader(u8) {
  this.buf=u8; this.pos=0; this.bits=0; this.left=0;
}
BitReader.prototype.bit = function() {
  if(!this.left){ if(this.pos>=this.buf.length) throw new Error('BZ2: EOF'); this.bits=this.buf[this.pos++]; this.left=8; }
  return (this.bits>>--this.left)&1;
};
BitReader.prototype.read = function(n){ var v=0; for(var i=0;i<n;i++) v=(v<<1)|this.bit(); return v; };

function buildHuff(lens,n){
  var MAXL=20,l,i,cnt=new Int32Array(MAXL+1),maxL=1;
  for(i=0;i<n;i++){if(lens[i]){cnt[lens[i]]++;if(lens[i]>maxL)maxL=lens[i];}}
  var code=0,start=new Int32Array(MAXL+1);
  for(l=1;l<=MAXL;l++){start[l]=code;code=(code+cnt[l])<<1;}
  var perm=new Uint16Array(n),pi=0;
  for(l=1;l<=maxL;l++) for(i=0;i<n;i++) if(lens[i]===l) perm[pi++]=i;
  var limit=new Int32Array(MAXL+1),base=new Int32Array(MAXL+1),cum=0;
  for(l=1;l<=MAXL;l++){limit[l]=cnt[l]?start[l]+cnt[l]-1:-1;base[l]=start[l]-cum;cum+=cnt[l];}
  return{limit,base,perm,maxL};
}

function decSym(h,br){
  var v=0;
  for(var l=1;l<=h.maxL;l++){v=(v<<1)|br.bit();if(h.limit[l]>=0&&v<=h.limit[l])return h.perm[v-h.base[l]];}
  throw new Error('BZ2: Huffman overrun');
}

function bzip2Decompress(input){
  if(!(input instanceof Uint8Array)) input=new Uint8Array(input);
  var br=new BitReader(input);
  if(br.read(8)!==0x42||br.read(8)!==0x5A||br.read(8)!==0x68) throw new Error('BZ2: not bzip2');
  var blockSizeMult=br.read(8)-0x30;
  var outChunks=[];
  for(;;){
    var m1=br.read(24),m2=br.read(24);
    if(m1===0x177245&&m2===0x385090) break;
    if(m1!==0x314159||m2!==0x265359) throw new Error('BZ2: bad block magic');
    br.read(32);br.read(1);
    var origPtr=br.read(24);
    var inUse=[],bigMap=br.read(16);
    for(var ig=0;ig<16;ig++){if((bigMap>>(15-ig))&1){var sm=br.read(16);for(var jg=0;jg<16;jg++)if((sm>>(15-jg))&1)inUse.push(ig*16+jg);}}
    var nInUse=inUse.length,alphaSize=nInUse+2,EOB=nInUse+1;
    var nGroups=br.read(3),nSelectors=br.read(15);
    var selMTF=[];for(var gi=0;gi<nGroups;gi++)selMTF.push(gi);
    var selectors=new Uint8Array(nSelectors);
    for(var si=0;si<nSelectors;si++){var sj=0;while(br.bit())sj++;var sv=selMTF.splice(sj,1)[0];selMTF.unshift(sv);selectors[si]=sv;}
    var huffTables=[];
    for(var ti=0;ti<nGroups;ti++){
      var lens=new Uint8Array(alphaSize),l=br.read(5);
      for(var li=0;li<alphaSize;li++){while(br.bit())l+=br.bit()?-1:1;if(l<1||l>20)throw new Error('BZ2: bad len');lens[li]=l;}
      huffTables.push(buildHuff(lens,alphaSize));
    }
    var symMTF=[];for(var mi=0;mi<nInUse;mi++)symMTF.push(mi);
    var maxBlock=blockSizeMult*100000,tt=new Uint32Array(maxBlock),nblock=0;
    var gIdx=0,gPos=50,curH=null;
    function nextSym(){if(gPos>=50){gPos=0;if(gIdx>=nSelectors)throw new Error('BZ2: sel overrun');curH=huffTables[selectors[gIdx++]];}gPos++;return decSym(curH,br);}
    var zvec=nextSym();
    while(zvec!==EOB){
      if(zvec===0||zvec===1){
        var es=-1,N=1;
        do{es+=(zvec===0?1:2)*N;N*=2;zvec=nextSym();}while(zvec===0||zvec===1);
        es++;var uc=inUse[symMTF[0]];if(nblock+es>maxBlock)throw new Error('BZ2: overflow');
        for(var ri=0;ri<es;ri++)tt[nblock++]=uc;
        if(zvec===EOB)break;
      }
      var mtfIdx=zvec-1,byteRef=symMTF.splice(mtfIdx,1)[0];symMTF.unshift(byteRef);
      if(nblock>=maxBlock)throw new Error('BZ2: overflow');
      tt[nblock++]=inUse[byteRef];zvec=nextSym();
    }
    var cftab=new Int32Array(256);for(var ci=0;ci<nblock;ci++)cftab[tt[ci]]++;
    var sum=0;for(var ki=0;ki<256;ki++){var tmp=cftab[ki];cftab[ki]=sum;sum+=tmp;}
    var origChars=new Uint8Array(nblock);for(var bi=0;bi<nblock;bi++)origChars[bi]=tt[bi]&0xFF;
    var cftab2=cftab.slice();
    for(var bi=0;bi<nblock;bi++){var ch=origChars[bi];tt[cftab2[ch]]=ch|(bi<<8);cftab2[ch]++;}
    var blockOut=new Uint8Array(nblock),tPos=origPtr;
    for(var oi=0;oi<nblock;oi++){blockOut[oi]=tt[tPos]&0xFF;tPos=tt[tPos]>>8;}
    var rle=[],rleRun=0,rleLast=-1;
    for(var ri=0;ri<nblock;ri++){
      var b=blockOut[ri];rle.push(b);
      if(b===rleLast){rleRun++;if(rleRun===4){var extra=(ri+1<nblock)?blockOut[++ri]:0;for(var ex=0;ex<extra;ex++)rle.push(b);rleRun=0;rleLast=-1;}}
      else{rleRun=1;rleLast=b;}
    }
    outChunks.push(new Uint8Array(rle));
  }
  var total=0;for(var xi=0;xi<outChunks.length;xi++)total+=outChunks[xi].length;
  var result=new Uint8Array(total),off=0;
  for(var yi=0;yi<outChunks.length;yi++){result.set(outChunks[yi],off);off+=outChunks[yi].length;}
  return result;
}

// ═══════════════════════════════════════════════════════════════
// NEXRAD Level-2 parser → extract elevation 1 REF sweep
// ═══════════════════════════════════════════════════════════════

function parseLevel2(rawBuf, product = 'ref') {
  let data = new Uint8Array(rawBuf);
  const sig = (data[0] << 8) | data[1];
  if (sig === 0x425A) {
    try { data = bzip2Decompress(data); }
    catch(e) { throw new Error('Outer bzip2: ' + e.message); }
  }

  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 24;

  const NUM_AZ    = 720;
  const azAngles  = new Float32Array(NUM_AZ);
  for (let i = 0; i < NUM_AZ; i++) azAngles[i] = i * 0.5;

  let radialData = null;
  let numGates = 0, firstGateM = 0, gateSizeM = 0;
  let foundElevIdx = null;
  let refPopulated = 0;

  // For VEL/CC we also extract co-located REF to use as a quality mask.
  // Gates with REF below threshold are noise/clutter → set to no-data.
  // This matches OpenSnow's server-side quality control approach.
  const REF_MASK_THRESHOLD = 5.0; // dBZ — any real precipitation echo
  let refData = null, refNumGates = 0;

  // Block identifier bytes: REF=[82,69,70]  VEL=[86,69,76]  RHO=[82,72,79]
  const REF_ID  = [82, 69, 70];
  const blockId = product === 'vel' ? [86,69,76]
                : product === 'cc'  ? [82,72,79]
                :                     [82,69,70];

  // For VEL/CC: collect all elevation cuts, pick the best one.
  // Key insight: in split-cut VCPs the SHORTER-range Doppler cut (fewer gates)
  // has a much higher Nyquist velocity than the long-range surveillance cut.
  // e.g. VCP 215: elev-1 = 1832 gates, Nyquist 7.97 m/s (badly aliased)
  //               elev-2 = 1192 gates, Nyquist 29.3 m/s (clean)
  // We prefer fewer gates (= higher PRF = higher Nyquist = less folding).
  const elevData = {};

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
      try { chunk = bzip2Decompress(data.slice(pos, pos + recSize)); }
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
    const elevIdx = dv2.getUint8(22);

    // REF: elevation 1 only
    if (product === 'ref') {
      if (elevIdx !== 1) return;
    }

    const az    = dv2.getFloat32(12, false);
    const azBin = Math.floor(((az % 360 + 360) % 360) * 2) % NUM_AZ;
    const nBlocks = dv2.getUint16(30, false);

    let primaryPtr = -1, primaryNG = 0, primaryScl = 1, primaryOfs = 0, primaryFG = 0, primaryGS = 0;
    let refPtr = -1, refNG = 0, refScl = 1, refOfs = 0;
    let radNyquist = 0;

    for (let b = 0; b < nBlocks && b < 10; b++) {
      if (base + 32 + (b+1)*4 > chunk.length) break;
      const ptr   = dv2.getUint32(32 + b*4, false);
      const bbase = chunk.byteOffset + base + ptr;
      if (bbase + 4 > chunk.byteOffset + chunk.length) continue;
      const t0 = chunk[bbase], b1 = chunk[bbase+1], b2 = chunk[bbase+2], b3 = chunk[bbase+3];

      // RAD block (type 'R' = 82, name 'R','A','D' = 82,65,68): contains Nyquist at offset 16
      if (t0 === 82 && b1 === 82 && b2 === 65 && b3 === 68) {
        if (bbase + 18 <= chunk.byteOffset + chunk.length) {
          const rbdv = new DataView(chunk.buffer, bbase);
          radNyquist = rbdv.getInt16(16, false) * 0.01; // signed int16, 0.01 m/s units
        }
        continue;
      }

      if (t0 !== 68) continue; // only D blocks below
      const bdv = new DataView(chunk.buffer, bbase);
      const ng  = bdv.getUint16(8,  false);
      const fg  = bdv.getUint16(10, false);
      const gs  = bdv.getUint16(12, false);
      const scl = bdv.getFloat32(20, false);
      const ofs = bdv.getFloat32(24, false);

      if (b1 === blockId[0] && b2 === blockId[1] && b3 === blockId[2]) {
        primaryPtr = ptr; primaryNG = ng; primaryScl = scl; primaryOfs = ofs;
        primaryFG = fg; primaryGS = gs;
      }
      if (product !== 'ref' && b1 === REF_ID[0] && b2 === REF_ID[1] && b3 === REF_ID[2]) {
        refPtr = ptr; refNG = ng; refScl = scl; refOfs = ofs;
      }
    }

    if (primaryPtr < 0) return;

    // REF: write directly to shared arrays
    if (product === 'ref') {
      if (!radialData) {
        numGates = primaryNG; firstGateM = primaryFG; gateSizeM = primaryGS;
        radialData = new Float32Array(NUM_AZ * primaryNG).fill(-999);
        foundElevIdx = elevIdx;
      }
      // Only write this elevation's radials
      if (elevIdx !== foundElevIdx) return;
      if (radialData[azBin * numGates] <= -900) refPopulated++;
      azAngles[azBin] = az;
      const dataOff = base + primaryPtr + 28;
      for (let g = 0; g < primaryNG && g < numGates; g++) {
        if (dataOff + g >= chunk.length) break;
        const raw = chunk[chunk.byteOffset + dataOff + g];
        radialData[azBin * numGates + g] = raw <= 1 ? -999 : (raw - primaryOfs) / primaryScl;
      }
      return;
    }

    // VEL/CC: collect per-elevation
    if (!elevData[elevIdx]) {
      const az0 = new Float32Array(NUM_AZ);
      for (let i = 0; i < NUM_AZ; i++) az0[i] = i * 0.5;
      elevData[elevIdx] = {
        numGates: primaryNG, firstGateM: primaryFG, gateSizeM: primaryGS,
        radialData: new Float32Array(NUM_AZ * primaryNG).fill(-999),
        azAngles: az0,
        refData: null, refNumGates: 0,
        populated: 0,
        nyquist: radNyquist
      };
      if (refNG > 0) {
        elevData[elevIdx].refNumGates = refNG;
        elevData[elevIdx].refData = new Float32Array(NUM_AZ * refNG).fill(-999);
      }
    }
    const ed = elevData[elevIdx];
    if (radNyquist > 0 && ed.nyquist === 0) ed.nyquist = radNyquist;

    // Only write if this radial hasn't been written yet (first elevation scan wins per azimuth)
    if (ed.radialData[azBin * ed.numGates] <= -900) ed.populated++;
    ed.azAngles[azBin] = az;

    const dataOff = base + primaryPtr + 28;
    for (let g = 0; g < primaryNG && g < ed.numGates; g++) {
      if (dataOff + g >= chunk.length) break;
      const raw = chunk[chunk.byteOffset + dataOff + g];
      ed.radialData[azBin * ed.numGates + g] = raw <= 1 ? -999 : (raw - primaryOfs) / primaryScl;
    }

    if (refPtr >= 0 && ed.refData) {
      const refOff = base + refPtr + 28;
      for (let g = 0; g < refNG && g < ed.refNumGates; g++) {
        if (refOff + g >= chunk.length) break;
        const raw = chunk[chunk.byteOffset + refOff + g];
        ed.refData[azBin * ed.refNumGates + g] = raw <= 1 ? -999 : (raw - refOfs) / refScl;
      }
    }
  }

  // VEL: pick most-populated cut with ≥360 azimuths (or best available)
  let debugCuts = '';
  if (product !== 'ref') {
    const allCuts = Object.values(elevData);
    debugCuts = allCuts.map(ed => `ng=${ed.numGates},nyq=${ed.nyquist?.toFixed(1)},pop=${ed.populated}`).join('|');

    const candidates = allCuts.filter(ed => ed.populated >= 360);
    if (!allCuts.length) return null;
    const best = candidates.length
      ? candidates.reduce((b, e) => e.numGates < b.numGates ? e : b)
      : allCuts.reduce((b, e) => e.numGates < b.numGates ? e : b);
    if (!best) return null;

    numGates = best.numGates; firstGateM = best.firstGateM; gateSizeM = best.gateSizeM;
    radialData = best.radialData; refData = best.refData; refNumGates = best.refNumGates;
    for (let i = 0; i < NUM_AZ; i++) azAngles[i] = best.azAngles[i];

    // No server-side dealias
  }

  if (!radialData) {
    // No data found for this product — file may be mid-scan or not contain this moment type.
    // Return null so caller can skip encoding rather than 500ing.
    return null;
  }


  // Apply REF quality mask to VEL/CC: zero out gates without a real echo
  if (product === 'cc' && refData) {
    const refGateRatio = refNumGates / numGates;
    for (let r = 0; r < NUM_AZ; r++) {
      for (let g = 0; g < numGates; g++) {
        const refG = Math.min(Math.floor(g * refGateRatio), refNumGates - 1);
        const ref  = refData[r * refNumGates + refG];
        if (ref < REF_MASK_THRESHOLD) {
          radialData[r * numGates + g] = -999;
        }
      }
    }
  }

  const populatedCount = product === 'ref' ? refPopulated
                       : (Object.values(elevData).find(ed => ed.radialData === radialData)?.populated ?? 0);
  const isComplete = populatedCount >= 360;

  // Extract nyquist for this elevation's radialData
  const nyquist = Object.values(elevData).reduce((best, ed) => {
    return (ed.nyquist > 0 && ed.radialData === radialData) ? ed.nyquist : best;
  }, 0);
  return { radialData, azAngles, numGates, firstGateM, gateSizeM, NUM_AZ, product, isComplete, debugCuts, nyquist };
}

// ═══════════════════════════════════════════════════════════════
// Compact binary encoder
// ═══════════════════════════════════════════════════════════════

function encodeCompact(parsed) {
  const { radialData, azAngles, numGates, firstGateM, gateSizeM, NUM_AZ, product, nyquist } = parsed;

  // Always encode to 1832 gates — pad with zeros if fewer (matches OpenSnow's fixed format)
  const OUT_GATES = 1832;
  const maxRangeKm = (firstGateM + OUT_GATES * gateSizeM) / 1000;

  const headerSize = 28; // 24 + 4 bytes for nyquist f32 at [24..27]
  const azSize     = NUM_AZ * 4;
  const gateSize   = NUM_AZ * OUT_GATES;
  const buf  = new ArrayBuffer(headerSize + azSize + gateSize);
  const dv   = new DataView(buf);
  const u8   = new Uint8Array(buf); // zero-initialized

  dv.setUint32(0,  0x52444152, true); // 'RDAR'
  dv.setUint32(4,  NUM_AZ,     true);
  dv.setUint32(8,  OUT_GATES,  true);
  dv.setFloat32(12, firstGateM, true);
  dv.setFloat32(16, gateSizeM,  true);
  dv.setFloat32(20, maxRangeKm, true);
  dv.setFloat32(24, nyquist || 0, true); // actual Nyquist velocity m/s from Level-2

  for (let i = 0; i < NUM_AZ; i++)
    dv.setFloat32(headerSize + i*4, azAngles[i], true);

  const gateStart = headerSize + azSize;
  const copyGates = Math.min(numGates, OUT_GATES);

  if (product === 'vel') {
    for (let r = 0; r < NUM_AZ; r++) {
      for (let g = 0; g < copyGates; g++) {
        const mps = radialData[r * numGates + g];
        if (mps < -900) continue;
        let idx = Math.round(mps/0.5)+129;
        if (idx<2) idx=2; if (idx>254) idx=254;
        u8[gateStart + r * OUT_GATES + g] = idx;
      }
    }
  } else if (product === 'cc') {
    for (let r = 0; r < NUM_AZ; r++) {
      for (let g = 0; g < copyGates; g++) {
        const cc = radialData[r * numGates + g];
        if (cc < -900 || cc < 0) continue;
        let idx = Math.round(cc*240)+2;
        if (idx<2) idx=2; if (idx>254) idx=254;
        u8[gateStart + r * OUT_GATES + g] = idx;
      }
    }
  } else {
    for (let r = 0; r < NUM_AZ; r++) {
      for (let g = 0; g < copyGates; g++) {
        const dbz = radialData[r * numGates + g];
        if (dbz < -32) continue;
        let idx = Math.round((dbz+32)*2);
        if (idx<0) idx=0; if (idx>253) idx=253;
        u8[gateStart + r * OUT_GATES + g] = idx+1;
      }
    }
  }
  return u8;
}

// ═══════════════════════════════════════════════════════════════
// Gzip compress (CF Workers have CompressionStream)
// ═══════════════════════════════════════════════════════════════

async function gzipCompress(u8data) {
  const cs = new CompressionStream('gzip');
  const w  = cs.writable.getWriter();
  w.write(u8data); w.close();
  const chunks = []; const reader = cs.readable.getReader();
  while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
  const total = chunks.reduce((s,c)=>s+c.length,0);
  const out = new Uint8Array(total); let off=0;
  for (const c of chunks) { out.set(c,off); off+=c.length; }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// Route handler
// ═══════════════════════════════════════════════════════════════

const NOMADS = 'https://nomads.ncep.noaa.gov/pub/data/nccf/radar/nexrad_level2';
const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, OPTIONS' };

export async function onRequest(context) {
  const url  = new URL(context.request.url);
  const path = url.pathname.replace(/^\/radar\//, '');

  if (context.request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS });

  // LIST
  if (path.startsWith('list/')) {
    const site = path.slice(5).toUpperCase().replace(/[^A-Z]/g,'');
    if (site.length !== 4) return new Response('Bad site', { status:400, headers:CORS });
    const r = await fetch(`${NOMADS}/${site}/`, { cf:{ cacheTtl:30 } });
    if (!r.ok) return new Response('NOMADS error '+r.status, { status:502, headers:CORS });
    const html = await r.text();
    const re = /href="(K[A-Z]{3}_\d{8}_\d{6}\.bz2)"/g;
    const files = []; let m;
    while ((m=re.exec(html))!==null) files.push(m[1]);
    files.sort();
    return new Response(JSON.stringify(files.slice(-24)), {
      headers: { ...CORS, 'Content-Type':'application/json', 'Cache-Control':'no-store' }
    });
  }

  // FILE (legacy passthrough)
  if (path.startsWith('file/')) {
    const r = await fetch(`${NOMADS}/${path.slice(5)}`, { cf:{ cacheTtl:86400, cacheEverything:true } });
    if (!r.ok) return new Response('NOMADS '+r.status, { status:r.status, headers:CORS });
    return new Response(r.body, {
      status:200,
      headers:{ ...CORS, 'Content-Type':'application/octet-stream', 'Cache-Control':'public, max-age=86400' }
    });
  }

  // PROCESS — the fast path
  if (path.startsWith('process/')) {
    try {
      const rest    = path.slice(8);
      const product = url.searchParams.get('p') === 'vel' ? 'vel'
                    : url.searchParams.get('p') === 'cc'  ? 'cc'
                    : 'ref';
      const cacheId = `v18-${product}/${rest}`;

      const cache    = caches.default;
      const cacheKey = new Request(`https://radar-cache.internal/${cacheId}`);
      const cached   = await cache.match(cacheKey);
      if (cached) {
        const h = new Headers(cached.headers);
        h.set('Access-Control-Allow-Origin','*');
        h.set('X-Cache','HIT');
        return new Response(cached.body, { status:200, headers:h });
      }

      // Fetch raw Level-2
      const r = await fetch(`${NOMADS}/${rest}`);
      if (!r.ok) return new Response('NOMADS '+r.status, { status:r.status, headers:CORS });
      const rawBuf = await r.arrayBuffer();

      // Parse
      const parsed = parseLevel2(rawBuf, product);
      if (!parsed) return new Response(null, { status:204, headers:CORS });

      // Encode + compress
      const compact = encodeCompact(parsed);
      const gzipped = await gzipCompress(compact);

      const ttl = parsed.isComplete ? 604800 : 30;
      const headers = {
        ...CORS,
        'Content-Type':     'application/octet-stream',
        'Content-Encoding': 'gzip',
        'Cache-Control':    `public, max-age=${ttl}`,
        'X-Cache':          'MISS',
        'X-Product':        product,
        'X-Complete':       String(parsed.isComplete),
      'X-Debug-Cuts':     parsed.debugCuts || '',
        'X-Compact-Bytes':  String(compact.byteLength),
        'X-Gzip-Bytes':     String(gzipped.byteLength),
      };

      const response = new Response(gzipped, { status:200, headers });
      if (parsed.isComplete) context.waitUntil(cache.put(cacheKey, response.clone()));
      return response;

    } catch(e) {
      return new Response('Error: ' + (e?.message || String(e)) + '\nStack: ' + (e?.stack || ''), {
        status: 500, headers: CORS
      });
    }
  }

  return new Response('Not found', { status:404, headers:CORS });
}
