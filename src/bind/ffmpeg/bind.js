/**
 * Constants
 */

const NULL = 0;
const SIZE_I32 = Uint32Array.BYTES_PER_ELEMENT;
const DEFAULT_ARGS = ["./ffmpeg", "-nostdin", "-y"];
const DEFAULT_ARGS_FFPROBE = ["./ffprobe"];

Module["NULL"] = NULL;
Module["SIZE_I32"] = SIZE_I32;
Module["DEFAULT_ARGS"] = DEFAULT_ARGS;
Module["DEFAULT_ARGS_FFPROBE"] = DEFAULT_ARGS_FFPROBE;

/**
 * Variables
 */

Module["ret"] = -1;
Module["timeout"] = -1;
Module["logger"] = () => {};
Module["progress"] = () => {};

/**
 * Functions
 */

function stringToPtr(str) {
  const len = Module["lengthBytesUTF8"](str) + 1;
  const ptr = Module["_malloc"](len);
  Module["stringToUTF8"](str, ptr, len);

  return ptr;
}

function stringsToPtr(strs) {
  const len = strs.length;
  const ptr = Module["_malloc"](len * SIZE_I32);
  for (let i = 0; i < len; i++) {
    Module["setValue"](ptr + SIZE_I32 * i, stringToPtr(strs[i]), "i32");
  }

  return ptr;
}

function print(message) {
  Module["logger"]({ type: "stdout", message });
}

function printErr(message) {
  if (!message.startsWith("Aborted(native code called abort())"))
    Module["logger"]({ type: "stderr", message });
}

/**
 * ffmpeg and ffprobe finish by calling exit(), which Emscripten implements by
 * throwing. That exception unwinds the JavaScript frames, but nothing unwinds
 * the WebAssembly stack, so the stack pointer is left wherever the C code
 * happened to leave it and every call permanently consumes a little more of
 * the stack. Once it runs out the module traps with "memory access out of
 * bounds", and since the stack pointer is never reset the instance keeps
 * trapping on every subsequent call.
 *
 * Saving the stack pointer before the call and restoring it afterwards is what
 * Emscripten itself does in its invoke_* helpers, for exactly this situation.
 */
function exec(..._args) {
  const args = [...Module["DEFAULT_ARGS"], ..._args];
  const sp = stackSave();
  try {
    Module["_ffmpeg"](args.length, stringsToPtr(args));
  } catch (e) {
    if (!e.message.startsWith("Aborted")) {
      throw e;
    }
  } finally {
    stackRestore(sp);
  }
  return Module["ret"];
}

function ffprobe(..._args) {
  const args = [...Module["DEFAULT_ARGS_FFPROBE"], ..._args];
  const sp = stackSave();
  try {
    Module["_ffprobe"](args.length, stringsToPtr(args));
  } catch (e) {
    if (!e.message.startsWith("Aborted")) {
      throw e;
    }
  } finally {
    stackRestore(sp);
  }
  return Module["ret"];
}

function setLogger(logger) {
  Module["logger"] = logger;
}

function setTimeout(timeout) {
  Module["timeout"] = timeout;
}

function setProgress(handler) {
  Module["progress"] = handler;
}

function receiveProgress(progress, time) {
  Module["progress"]({ progress, time });
}

function reset() {
  Module["ret"] = -1;
  Module["timeout"] = -1;
}

const _customLocateFile = Module["locateFile"];
function _locateFile(path, prefix) {
  if (_customLocateFile) {
    const url = _customLocateFile(path, prefix);
    if (url) return url;
  }
  if (path.endsWith(".wasm") && Module["wasmURL"]) {
    return Module["wasmURL"];
  }
  if (path.endsWith(".js") && Module["mainScriptUrlOrBlob"]) {
    return Module["mainScriptUrlOrBlob"];
  }
  return prefix + path;
}


Module["stringToPtr"] = stringToPtr;
Module["stringsToPtr"] = stringsToPtr;
Module["print"] = print;
Module["printErr"] = printErr;
Module["locateFile"] = _locateFile;

Module["exec"] = exec;
Module["ffprobe"] = ffprobe;
Module["setLogger"] = setLogger;
Module["setTimeout"] = setTimeout;
Module["setProgress"] = setProgress;
Module["reset"] = reset;
Module["receiveProgress"] = receiveProgress;
