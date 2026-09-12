/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import type { FFmpegCoreModule, FFmpegCoreModuleFactory } from "@ffmpeg/types";
import type {
  FFMessageEvent,
  FFMessageLoadConfig,
  FFMessageExecData,
  FFMessageWriteFileData,
  FFMessageReadFileData,
  FFMessageDeleteFileData,
  FFMessageRenameData,
  FFMessageCreateDirData,
  FFMessageListDirData,
  FFMessageDeleteDirData,
  FFMessageMountData,
  FFMessageUnmountData,
  CallbackData,
  IsFirst,
  OK,
  ExitCode,
  FSNode,
  FileData,
} from "./types.js";
import { FFMessageType } from "./const.js";
import {
  ERROR_UNKNOWN_MESSAGE_TYPE,
  ERROR_NOT_LOADED,
  ERROR_IMPORT_FAILURE,
  ERROR_CORE_URL_REQUIRED,
} from "./errors.js";

interface FFmpegCoreConfig extends Partial<FFmpegCoreModule> {
  wasmURL?: string;
}

type FFmpegCoreConfigFactory = (
  moduleOverrides?: FFmpegCoreConfig
) => Promise<FFmpegCoreModule>;

declare global {
  interface WorkerGlobalScope {
    createFFmpegCore: FFmpegCoreConfigFactory;
  }
}

interface ImportedFFmpegCoreModuleFactory {
  default: FFmpegCoreConfigFactory;
}

let ffmpeg: FFmpegCoreModule;

const load = async ({
  coreURL: _coreURL,
  wasmURL: _wasmURL,
}: FFMessageLoadConfig): Promise<IsFirst> => {
  const first = !ffmpeg;

  if (!_coreURL) {
    throw ERROR_CORE_URL_REQUIRED;
  }

  try {
    // when web worker type is `classic`.
    importScripts(_coreURL);
  } catch {
    // when web worker type is `module`.
    (self as WorkerGlobalScope).createFFmpegCore = (
      (await import(
        /* @vite-ignore */ _coreURL
      )) as ImportedFFmpegCoreModuleFactory
    ).default;

    if (!(self as WorkerGlobalScope).createFFmpegCore) {
      throw ERROR_IMPORT_FAILURE;
    }
  }

  const coreURL = _coreURL;
  const wasmURL = _wasmURL ? _wasmURL : _coreURL.replace(/.js$/g, ".wasm");

  let coreBlobURL = coreURL;
  if (!coreURL.startsWith("blob:") && !coreURL.startsWith("data:")) {
    try {
      const res = await fetch(coreURL);
      const blob = await res.blob();
      coreBlobURL = URL.createObjectURL(
        blob.type === "text/javascript" || blob.type === "application/javascript"
          ? blob
          : new Blob([blob], { type: "text/javascript" })
      );
    } catch {
      // If fetching as blob fails, fall back to coreURL
    }
  }

  ffmpeg = await (self as WorkerGlobalScope).createFFmpegCore({
    mainScriptUrlOrBlob: coreBlobURL,
    wasmURL,
    locateFile: (path: string, prefix: string) => {
      if (path.endsWith(".wasm")) return wasmURL;
      if (path.endsWith(".js")) return coreBlobURL;
      return prefix + path;
    },
  });

  if (typeof (ffmpeg as any).prewarmPool === "function") {
    await (ffmpeg as any).prewarmPool();
  } else {
    const pThread = (ffmpeg as any).PThread;
    if (
      pThread &&
      typeof pThread.allocateUnusedWorker === "function" &&
      typeof pThread.loadWasmModuleToWorker === "function" &&
      Array.isArray(pThread.unusedWorkers)
    ) {
      const cores = self.navigator?.hardwareConcurrency || 4;
      const targetPoolSize = Math.min(
        Math.max(Math.round(cores * 2.5 + 2), 16),
        64
      );
      while (pThread.unusedWorkers.length < targetPoolSize) {
        const batchSize = Math.min(
          4,
          targetPoolSize - pThread.unusedWorkers.length
        );
        const batch: Promise<unknown>[] = [];
        for (let i = 0; i < batchSize; i++) {
          const worker = pThread.allocateUnusedWorker();
          batch.push(pThread.loadWasmModuleToWorker(worker));
        }
        await Promise.all(batch);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }
  ffmpeg.setLogger((data) =>
    self.postMessage({ type: FFMessageType.LOG, data })
  );
  ffmpeg.setProgress((data) =>
    self.postMessage({
      type: FFMessageType.PROGRESS,
      data,
    })
  );
  return first;
};

const exec = ({ args, timeout = -1 }: FFMessageExecData): ExitCode => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.exec(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const ffprobe = ({ args, timeout = -1 }: FFMessageExecData): ExitCode => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.ffprobe(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

/**
 * Interrupt any running exec/ffprobe by setting the ffmpeg timeout to 1 ms.
 * This causes the WASM-side watchdog to fire almost immediately, stopping
 * the current command and returning exit-code 1 (timeout).  The exec()
 * call on the main thread has already been rejected with an AbortError by
 * the time this message arrives, so the exit-code reply is simply discarded.
 */
const cancel = (): void => {
  if (ffmpeg) {
    ffmpeg.setTimeout(1);
  }
};

const writeFile = ({ path, data }: FFMessageWriteFileData): OK => {
  ffmpeg.FS.writeFile(path, data);
  return true;
};

const readFile = ({ path, encoding }: FFMessageReadFileData): FileData =>
  ffmpeg.FS.readFile(path, { encoding });

// TODO: check if deletion works.
const deleteFile = ({ path }: FFMessageDeleteFileData): OK => {
  ffmpeg.FS.unlink(path);
  return true;
};

const rename = ({ oldPath, newPath }: FFMessageRenameData): OK => {
  ffmpeg.FS.rename(oldPath, newPath);
  return true;
};

// TODO: check if creation works.
const createDir = ({ path }: FFMessageCreateDirData): OK => {
  ffmpeg.FS.mkdir(path);
  return true;
};

const listDir = ({ path }: FFMessageListDirData): FSNode[] => {
  const names = ffmpeg.FS.readdir(path);
  const nodes: FSNode[] = [];
  for (const name of names) {
    const stat = ffmpeg.FS.stat(`${path}/${name}`);
    const isDir = ffmpeg.FS.isDir(stat.mode);
    nodes.push({ name, isDir });
  }
  return nodes;
};

// TODO: check if deletion works.
const deleteDir = ({ path }: FFMessageDeleteDirData): OK => {
  ffmpeg.FS.rmdir(path);
  return true;
};

const mount = ({ fsType, options, mountPoint }: FFMessageMountData): OK => {
  const str = fsType as keyof typeof ffmpeg.FS.filesystems;
  const fs = ffmpeg.FS.filesystems[str];
  if (!fs) return false;
  ffmpeg.FS.mount(fs, options, mountPoint);
  return true;
};

const unmount = ({ mountPoint }: FFMessageUnmountData): OK => {
  ffmpeg.FS.unmount(mountPoint);
  return true;
};

self.onmessage = async ({
  data: { id, type, data: _data },
}: FFMessageEvent): Promise<void> => {
  const trans = [];
  let data: CallbackData;
  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) throw ERROR_NOT_LOADED; // eslint-disable-line

    switch (type) {
      case FFMessageType.LOAD:
        data = await load(_data as FFMessageLoadConfig);
        break;
      case FFMessageType.EXEC:
        data = exec(_data as FFMessageExecData);
        break;
      case FFMessageType.FFPROBE:
        data = ffprobe(_data as FFMessageExecData);
        break;
      case FFMessageType.CANCEL:
        cancel();
        // CANCEL is fire-and-forget: no reply needed.
        return;
      case FFMessageType.WRITE_FILE:
        data = writeFile(_data as FFMessageWriteFileData);
        break;
      case FFMessageType.READ_FILE:
        data = readFile(_data as FFMessageReadFileData);
        break;
      case FFMessageType.DELETE_FILE:
        data = deleteFile(_data as FFMessageDeleteFileData);
        break;
      case FFMessageType.RENAME:
        data = rename(_data as FFMessageRenameData);
        break;
      case FFMessageType.CREATE_DIR:
        data = createDir(_data as FFMessageCreateDirData);
        break;
      case FFMessageType.LIST_DIR:
        data = listDir(_data as FFMessageListDirData);
        break;
      case FFMessageType.DELETE_DIR:
        data = deleteDir(_data as FFMessageDeleteDirData);
        break;
      case FFMessageType.MOUNT:
        data = mount(_data as FFMessageMountData);
        break;
      case FFMessageType.UNMOUNT:
        data = unmount(_data as FFMessageUnmountData);
        break;
      default:
        throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }
  } catch (e) {
    self.postMessage({
      id,
      type: FFMessageType.ERROR,
      data: (e as Error).toString(),
    });
    return;
  }
  if (data instanceof Uint8Array) {
    trans.push(data.buffer);
  }
  self.postMessage({ id, type, data }, trans);
};
