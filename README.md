nexrad-radar
============

Single-site NEXRAD Level II radar, decoded in the browser and drawn per gate on
the GPU.

Level II volumes are bzip2-compressed binary published by NOAA. This decodes
them client-side and renders each gate as its own WebGL quad at its true
great-circle position, rather than resampling the sweep into an image first.

Copyright (c) 2026 Live Storm Chasers Network LLC. All rights reserved.
Source-visible, not open source — see LICENSE. Reading and studying it is
welcome; using it needs written permission first, which is usually easy to get.

Nothing here claims anything over the radar data, which is public. See
Attribution.


Why
---

A radar sweep is polar: rays out from the site, gates along each ray. A map is
not. The usual approach resolves that by drawing the sweep into a flat image and
letting the map stretch it, which is fast and wrong at the edges — gates near
the radar are small and gates far out are large, and a single stretched image
cannot represent both.

Here the worker emits a flat gate×ray RGBA image plus a corner grid giving the
true great-circle lat/lon of every cell corner. The main thread draws one quad
per gate×ray cell at those corners. Nothing is resampled, so a gate is exactly
where it is, at any zoom.

The cost is quad count. A full sweep is hundreds of rays by hundreds of gates,
and every one is six vertices.


Files
-----

    index.html                   the app: map, site picker, product switch,
                                 playback, and the WebGL custom layer
    radarWorker.js               parsing, dealiasing and colour mapping, off
                                 the main thread
    bzip2.js                     bzip2 decompressor, same-origin so no CDN
                                 fetch is needed
    functions/radar/[[path]].js  edge function: listing, file fetch, decode


Products
--------

    REF    reflectivity
    VEL    velocity, dealiased
    CC     correlation coefficient
    SW     spectrum width

Velocity is shown in knots. Range-folded gates are drawn purple rather than
being left empty, so a fold reads as a fold rather than as missing data.


The data path
-------------

The edge function serves three routes under `/radar/`:

    list/<site>      what volumes exist upstream
    file/<key>       one volume, proxied
    process/<key>    decoded server-side, with ?p= selecting the product

Level II comes from NOAA's public distribution. A proxy is needed because the
browser cannot reach it directly under CORS, not because the data is restricted.

The worker accepts two shapes on the message channel — a compact pre-decoded
form and raw Level II — each with mesh, velocity and correlation variants. The
compact path exists because decoding a full volume in the browser is slow on a
phone; the raw path exists because the compact one loses precision.


Things that cost time and are worth carrying
--------------------------------------------

The Nyquist velocity comes from the Level II header, not from the data. It is
the hardware limit for the volume coverage pattern in use — around 27.6 m/s for
VCP 212 — and dealiasing against a value derived from the data instead produces
plausible output that is wrong wherever the true maximum was not reached. The
header value is used, with the data maximum only as a fallback when it is
missing.

Corner grids are cached per site and message type. They depend only on the
geometry of the sweep, not on its contents, so recomputing them per frame is
wasted work — and the computation is great-circle maths per corner, which is not
cheap.

bzip2 is hosted same-origin deliberately. Pulling a decompressor from a CDN adds
a third-party dependency to the critical path of a radar display, and the file
is small enough that there is no reason to.


Not done
--------

Only the lowest tilts are exercised. Higher elevation angles parse, but nothing
in the app selects them, so they are effectively untested.

The quad count is not adaptive. Every gate is drawn at every zoom, including
zoomed far out where most of them are smaller than a pixel. A distance-based
decimation would cut the vertex count substantially and has not been attempted.

Dual-polarisation products beyond correlation coefficient are not implemented.
Differential reflectivity and specific differential phase are present in the
file format and are simply not read.

The dealiasing has not been checked against a case with widespread folding.
Py-ART's algorithm is sound and the port follows it closely, but the output has
only been compared informally.


Attribution
-----------

NEXRAD Level II data is produced by the National Weather Service and is in the
public domain. This repository contains no radar data.

The region-based velocity dealiasing in `radarWorker.js` follows the algorithm
in Py-ART, the Python ARM Radar Toolkit, developed by ARM-DOE:

    https://github.com/ARM-DOE/pyart

The reference implementation is `pyart/correct/region_dealias.py` at the commit
where the algorithm stopped depending on `scipy.sparse.coo_matrix`, namely
`41b34052dc36becd1783bb7dfb87c39570cab707`. The code here is a modified
derivative — a translation into JavaScript, adapted to operate on parsed Level
II radials rather than Py-ART's data model — and is marked as modified so as not
to be confused with the version available from ANL.

Py-ART is released under the BSD 3-Clause licence. The full notice is retained
in `radarWorker.js` at the dealiasing section, as that licence requires, and is
reproduced here:

    Copyright (c) 2013, UChicago Argonne, LLC
    All rights reserved.

    Copyright 2013 UChicago Argonne, LLC. This software was produced under U.S.
    Government contract DE-AC02-06CH11357 for Argonne National Laboratory (ANL),
    which is operated by UChicago Argonne, LLC for the U.S. Department of
    Energy. The U.S. Government has rights to use, reproduce, and distribute
    this software. NEITHER THE GOVERNMENT NOR UCHICAGO ARGONNE, LLC MAKES ANY
    WARRANTY, EXPRESS OR IMPLIED, OR ASSUMES ANY LIABILITY FOR THE USE OF THIS
    SOFTWARE. If software is modified to produce derivative works, such modified
    software should be clearly marked, so as not to confuse it with the version
    available from ANL.

    Additionally, redistribution and use in source and binary forms, with or
    without modification, are permitted provided that the following conditions
    are met:

    1. Redistributions of source code must retain the above copyright notice,
       this list of conditions and the following disclaimer.

    2. Redistributions in binary form must reproduce the above copyright notice,
       this list of conditions and the following disclaimer in the documentation
       and/or other materials provided with the distribution.

    3. Neither the name of UChicago Argonne, LLC, Argonne National Laboratory,
       ANL, the U.S. Government, nor the names of its contributors may be used
       to endorse or promote products derived from this software without
       specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY UCHICAGO ARGONNE, LLC AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL UCHICAGO ARGONNE, LLC OR CONTRIBUTORS BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
    CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
    SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
    INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
    CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
    ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
    POSSIBILITY OF SUCH DAMAGE.


Licence
-------

All rights reserved, source-visible. See LICENSE. Use requires written
permission, and granted permission carries attribution terms. The Py-ART
derivative above is licensed separately under BSD 3-Clause and that licence is
unaffected by this one.
