#!/bin/bash

set -euo pipefail

# In strict WebAssembly, calling a function via call_indirect with a mismatched signature
# (e.g. calling a void-return function via void* (*func)(void*)) triggers
# "RuntimeError: indirect call signature mismatch".
# In x264, slicetype_slice_cost was declared as 'static void slicetype_slice_cost(...)'
# but passed to x264_threadpool_run which expects 'void *(*func)(void *)'.
# Patch slicetype_slice_cost to return void * and return NULL.
python3 -c '
import re
with open("encoder/slicetype.c", "r") as f:
    c = f.read()

pattern = r"static void slicetype_slice_cost\( x264_slicetype_slice_t \*s \)\n\{(?P<body>.*?)\n\}"
if not re.search(pattern, c, re.DOTALL):
    raise SystemExit("Error: Could not locate slicetype_slice_cost in encoder/slicetype.c")

patched = re.sub(
    pattern,
    r"static void *slicetype_slice_cost( x264_slicetype_slice_t *s )\n{\g<body>\n    return NULL;\n}",
    c,
    flags=re.DOTALL
)

with open("encoder/slicetype.c", "w") as f:
    f.write(patched)
print("Successfully patched slicetype_slice_cost in encoder/slicetype.c")
'

CONF_FLAGS=(
  --prefix=$INSTALL_DIR           # lib installation dir
  --host=x86-gnu                  # use x86 linux host
  --enable-static                 # build static library
  --disable-cli                   # disable cli build
  --disable-asm                   # disable assembly
  --extra-cflags="$CFLAGS"        # add extra cflags
  ${FFMPEG_ST:+ --disable-thread} # disable thread when FFMPEG_ST is defined
)

emconfigure ./configure "${CONF_FLAGS[@]}"
emmake make install-lib-static -j
