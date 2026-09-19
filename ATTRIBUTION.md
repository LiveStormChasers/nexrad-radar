Attribution
===========

This repository is source-visible under its own licence (see LICENSE). One part
of it derives from third-party work, and that work's licence is reproduced here
in full as that licence requires.


Region-based velocity dealiasing
--------------------------------

The Doppler velocity dealiasing in `radarWorker.js` follows the region-based
algorithm from Py-ART, the Python ARM Radar Toolkit, developed by ARM-DOE.

    https://github.com/ARM-DOE/pyart

The reference implementation is `pyart/correct/region_dealias.py` at the commit
where the algorithm stopped depending on `scipy.sparse.coo_matrix`:

    41b34052dc36becd1783bb7dfb87c39570cab707

Py-ART is released under the BSD 3-Clause licence, reproduced below.


Py-ART licence
--------------

Copyright (c) 2013, UChicago Argonne, LLC
All rights reserved.

Copyright 2013 UChicago Argonne, LLC. This software was produced under U.S.
Government contract DE-AC02-06CH11357 for Argonne National Laboratory (ANL),
which is operated by UChicago Argonne, LLC for the U.S. Department of Energy.
The U.S. Government has rights to use, reproduce, and distribute this software.
NEITHER THE GOVERNMENT NOR UCHICAGO ARGONNE, LLC MAKES ANY WARRANTY, EXPRESS OR
IMPLIED, OR ASSUMES ANY LIABILITY FOR THE USE OF THIS SOFTWARE. If software is
modified to produce derivative works, such modified software should be clearly
marked, so as not to confuse it with the version available from ANL.

Additionally, redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of UChicago Argonne, LLC, Argonne National Laboratory, ANL,
   the U.S. Government, nor the names of its contributors may be used to endorse
   or promote products derived from this software without specific prior written
   permission.

THIS SOFTWARE IS PROVIDED BY UCHICAGO ARGONNE, LLC AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL UCHICAGO ARGONNE, LLC OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

The dealiasing code in this repository is a modified derivative: it is a
translation of the above into JavaScript, adapted to operate on parsed Level II
radials rather than Py-ART's data model. It is marked here as modified so as
not to be confused with the version available from ANL.


Data
----

NEXRAD Level II radar data is produced by the National Weather Service and is in
the public domain. Nothing in this repository or its licence makes any claim
over it.
