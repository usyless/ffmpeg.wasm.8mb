#!/bin/bash
# `-o <OUTPUT_FILE_NAME>` must be provided when using this build script.
# ex:
#     bash ffmpeg-wasm.sh -o ffmpeg.js

set -euo pipefail

EXPORT_NAME="createFFmpegCore"

CONF_FLAGS=(
  -I. 
  -I./src/fftools 
  -I$INSTALL_DIR/include 
  -L$INSTALL_DIR/lib 
  -Llibavcodec 
  -Llibavfilter 
  -Llibavformat 
  -Llibavutil 
  -Llibswresample 
  -Llibswscale 
  -lavcodec 
  -lavfilter       # Required for the 'scale' filter (resizing)
  -lavformat       # Required for mp4 muxing / demuxing
  -lavutil 
  -lswresample     # Required if video has an audio track (AAC)
  -lswscale        # Required for pixel format conversion & scaling
  -Wno-deprecated-declarations 
  $LDFLAGS 
  -sENVIRONMENT=worker
  -sWASM_BIGINT
  -sMODULARIZE
  
  # Multi-threading settings
  ${FFMPEG_MT:+ -sPTHREAD_POOL_SIZE=8}     # Dropped from 8 to 4 (8 often hangs/stalls browser worker startup)
  ${FFMPEG_MT:+ -sINITIAL_MEMORY=256MB}    # Dropped from 1024MB
  ${FFMPEG_MT:+ -sMAXIMUM_MEMORY=2048MB}   # Safe 2GB ceiling for 32-bit wasm SharedArrayBuffer
  ${FFMPEG_MT:+ -sALLOW_MEMORY_GROWTH}     # Modern Emscripten safely allows growth with pthreads

  # Single-threading settings
  ${FFMPEG_ST:+ -sINITIAL_MEMORY=32MB -sALLOW_MEMORY_GROWTH}

  -sINCOMING_MODULE_JS_API=mainScriptUrlOrBlob # keep mainScriptUrlOrBlob override available on modern emscripten
  -sEXPORT_NAME="$EXPORT_NAME"
  -sEXPORTED_FUNCTIONS=$(node src/bind/ffmpeg/export.js)
  -sEXPORTED_RUNTIME_METHODS=$(node src/bind/ffmpeg/export-runtime.js)
  -lworkerfs.js
  --pre-js src/bind/ffmpeg/bind.js        # extra bindings, contains most of the ffmpeg.wasm javascript code
  # ffmpeg source code
  src/fftools/cmdutils.c 
  src/fftools/ffmpeg.c 
  src/fftools/ffmpeg_filter.c 
  src/fftools/ffmpeg_hw.c 
  src/fftools/ffmpeg_mux.c 
  src/fftools/ffmpeg_opt.c 
  src/fftools/opt_common.c 
  src/fftools/ffprobe.c 
)

emcc "${CONF_FLAGS[@]}" $@
