const EXPORTED_RUNTIME_METHODS = [
  "FS",
  "setValue",
  "getValue",
  "UTF8ToString",
  "lengthBytesUTF8",
  "stringToUTF8",
];

if (process.env.FFMPEG_MT) {
  EXPORTED_RUNTIME_METHODS.push("PThread");
}

console.log(EXPORTED_RUNTIME_METHODS.join(","));
