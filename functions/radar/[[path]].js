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
      ? candidates.reduce((b, e) => e.numGates > b.numGates ? e : b)
      : allCuts.reduce((b, e) => e.numGates > b.numGates ? e : b);
    if (!best) return null;

    numGates = best.numGates; firstGateM = best.firstGateM; gateSizeM = best.gateSizeM;
    radialData = best.radialData; refData = best.refData; refNumGates = best.refNumGates;
    for (let i = 0; i < NUM_AZ; i++) azAngles[i] = best.azAngles[i];

    // Velocity dealiasing — AtticRadar's full region-based pyart algorithm
    if (product === 'vel') {
      let nyq = best.nyquist || 0;
      if (!nyq) {
        for (let i = 0; i < NUM_AZ * numGates; i++) {
          const v = radialData[i];
          if (v > -900 && Math.abs(v) > nyq) nyq = Math.abs(v);
        }
      }
      if (nyq > 0.5) {
        // Build 2D array for dealias (masked = null)
        const vel2d = [];
        for (let r = 0; r < NUM_AZ; r++) {
          const row = [];
          for (let g = 0; g < numGates; g++) {
            const v = radialData[r * numGates + g];
            row.push(v > -900 ? v : null);
          }
          vel2d.push(row);
        }
        try {
          const dealiased = dealias(vel2d, nyq);
          for (let r = 0; r < NUM_AZ; r++) {
            for (let g = 0; g < numGates; g++) {
              const v = dealiased[r][g];
              radialData[r * numGates + g] = (v !== null && v !== undefined) ? v : -999;
            }
          }
        } catch(e) {
          // dealias failed, use raw data
        }
      }
    }
  }

  if (!radialData) {
    // No data found for this product — file may be mid-scan or not contain this moment type.
    // Return null so caller can skip encoding rather than 500ing.
    return null;
  }

  // Count how many azimuths actually have data (to detect mid-scan files)
  let populatedAz = 0;
  for (let r = 0; r < NUM_AZ; r++) {
    for (let g = 0; g < Math.min(numGates, 10); g++) {
      if (radialData[r * numGates + g] > -900) { populatedAz++; break; }
    }
  }
  const isComplete = populatedAz >= 700; // full 720-ray sweep ≈ complete
  // Don't serve partial velocity scans — they show as ugly wedges
  if (!isComplete && product === 'vel') return null;

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

  return { radialData, azAngles, numGates, firstGateM, gateSizeM, NUM_AZ, product, isComplete, debugCuts };
}

// ═══════════════════════════════════════════════════════════════
// Compact binary encoder
// ═══════════════════════════════════════════════════════════════

function encodeCompact(parsed) {
  const { radialData, azAngles, numGates, firstGateM, gateSizeM, NUM_AZ, product } = parsed;
  const maxRangeKm = (firstGateM + numGates * gateSizeM) / 1000;

  const headerSize = 24;
  const azSize     = NUM_AZ * 4;
  const gateSize   = NUM_AZ * numGates;
  const buf  = new ArrayBuffer(headerSize + azSize + gateSize);
  const dv   = new DataView(buf);
  const u8   = new Uint8Array(buf);

  dv.setUint32(0,  0x52444152, true); // 'RDAR'
  dv.setUint32(4,  NUM_AZ,     true);
  dv.setUint32(8,  numGates,   true);
  dv.setFloat32(12, firstGateM, true);
  dv.setFloat32(16, gateSizeM,  true);
  dv.setFloat32(20, maxRangeKm, true);

  for (let i = 0; i < NUM_AZ; i++)
    dv.setFloat32(headerSize + i*4, azAngles[i], true);

  const gateStart = headerSize + azSize;

  if (product === 'vel') {
    // Velocity: val = clamp(round(mps/0.5)+129, 2, 254)
    // decode: mps = (val-129)*0.5
    for (let i = 0; i < NUM_AZ * numGates; i++) {
      const mps = radialData[i];
      if (mps < -900) { u8[gateStart+i]=0; continue; }
      let idx = Math.round(mps/0.5)+129;
      if (idx<2) idx=2; if (idx>254) idx=254;
      u8[gateStart+i]=idx;
    }
  } else if (product === 'cc') {
    // CC: val=0 → no data, val 2-254 → cc=(val-2)/240.0  (covers 0.0–1.05)
    for (let i = 0; i < NUM_AZ * numGates; i++) {
      const cc = radialData[i];
      if (cc < -900 || cc < 0) { u8[gateStart+i]=0; continue; }
      let idx = Math.round(cc*240)+2;
      if (idx<2) idx=2; if (idx>254) idx=254;
      u8[gateStart+i]=idx;
    }
  } else {
    // Reflectivity: val=0 → no data, val 1-254 → dbz=(val-1)/2-32
    for (let i = 0; i < NUM_AZ * numGates; i++) {
      const dbz = radialData[i];
      if (dbz < -32) { u8[gateStart+i]=0; continue; }
      let idx = Math.round((dbz+32)*2);
      if (idx<0) idx=0; if (idx>253) idx=253;
      u8[gateStart+i]=idx+1;
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
      const cacheId = `v12-${product}/${rest}`;

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
