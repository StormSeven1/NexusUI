import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";

import path from "node:path";



/** 141 Linux 上 camConf 实际挂载点（NFS ↔ 142 store_200T） */

const DEFAULT_CAM_CONF_ROOT = "/mnt/nfs_200T/camconf";

/** 108 对准生成服务读取的 Windows UNC 根路径 */

const DEFAULT_AIM_PARAM_GRPC_PATH_ROOT = "\\\\192.168.18.142\\store_200T\\camconf";

const DEFAULT_RECORD_PIC_ROOT =
  process.platform === "win32" ? "C:\\watch_data\\record_pic" : "/tmp/nexus-record_pic";

const CAMCONF_IO_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.NEXUS_EO_CALC_RECORD_IO_TIMEOUT_MS ?? 15000) || 15000,
);

function isEnoent(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT");
}

async function withCamConfIoTimeout<T>(label: string, task: () => Promise<T>): Promise<T> {
  return Promise.race([
    task(),
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `${label}超时（${CAMCONF_IO_TIMEOUT_MS}ms），200T NFS 可能无响应，请在宿主机检查 mount 192.168.18.142:/mnt/beifen`,
          ),
        );
      }, CAMCONF_IO_TIMEOUT_MS);
    }),
  ]);
}



export type CalcRecordKind = "sea" | "sky";



function isWindowsStylePath(p: string): boolean {

  return /^\\\\/.test(p) || /^[A-Za-z]:/.test(p) || p.includes("\\");

}



function normalizeWinSegment(segment: string): string {

  return segment.replace(/\//g, "\\").replace(/^\\+|\\+$/g, "");

}



function joinWindowsPath(root: string, ...segments: string[]): string {

  const base = root.replace(/\//g, "\\").replace(/\\+$/g, "");

  const rest = segments.map(normalizeWinSegment).filter(Boolean);

  return [base, ...rest].join("\\");

}



/** 本地读写：Linux 绝对路径用 path.join，禁止把 UNC 当存储根（Linux 会写成项目内相对路径） */

export function joinCamConfPath(...segments: string[]): string {

  const root = camConfRoot();

  if (isWindowsStylePath(root)) {

    return joinWindowsPath(root, ...segments);

  }

  return path.join(root, ...segments);

}



export function camConfRoot(): string {

  return (process.env.NEXUS_EO_CALC_RECORD_CAM_CONF_DIR ?? DEFAULT_CAM_CONF_ROOT).trim() || DEFAULT_CAM_CONF_ROOT;

}

/** NFS 不可用时写入仓库挂载点，宿主机路径 NexusUI/.camconf-staging */
export function camConfStagingRoot(): string | null {
  const raw = process.env.NEXUS_EO_CALC_RECORD_STAGING_DIR?.trim();
  if (raw) return raw;
  if (process.platform !== "win32") return "/workspace/.camconf-staging";
  return null;
}



/** gRPC aimPath 根：108 侧 Windows UNC，与本地 NFS 目录对应同一共享 */

export function aimParamGrpcPathRoot(): string {

  return (

    process.env.NEXUS_EO_AIM_PARAM_AIM_PATH_ROOT?.trim()

    || DEFAULT_AIM_PARAM_GRPC_PATH_ROOT

  );

}



function camConfDirname(filePath: string): string {

  if (isWindowsStylePath(filePath)) {

    const norm = filePath.replace(/\//g, "\\");

    const idx = norm.lastIndexOf("\\");

    return idx > 0 ? norm.slice(0, idx) : norm;

  }

  return path.dirname(filePath);

}



export function recordPicRoot(): string {

  return (process.env.NEXUS_EO_CALC_RECORD_PIC_DIR ?? DEFAULT_RECORD_PIC_ROOT).trim() || DEFAULT_RECORD_PIC_ROOT;

}



export function camConfAbsPath(cameraIndex: number, kind: CalcRecordKind): string {

  const sub = kind === "sea" ? "cam" : "camsky";

  return joinCamConfPath(sub, `cam${cameraIndex}.txt`);

}

function camConfAbsPathAtRoot(
  root: string,
  cameraIndex: number,
  kind: CalcRecordKind,
): string {
  const sub = kind === "sea" ? "cam" : "camsky";
  if (isWindowsStylePath(root)) {
    return joinWindowsPath(root, sub, `cam${cameraIndex}.txt`);
  }
  return path.join(root, sub, `cam${cameraIndex}.txt`);
}



/** 对齐 Qt gRPC aimPath：UNC + cam/camSky，去掉盘符冒号 */

export function camConfAimPathForGrpc(cameraIndex: number, kind: CalcRecordKind): string {

  const sub = kind === "sea" ? "cam" : "camSky";

  let formatted = joinWindowsPath(aimParamGrpcPathRoot(), sub, `cam${cameraIndex}.txt`);

  formatted = formatted.replace(/:/g, "");

  if (kind === "sky" && !formatted.startsWith("\\\\")) {

    formatted = formatted.replace(/\//g, "\\\\");

  }

  return formatted;

}



export async function countCamConfLines(cameraIndex: number, kind: CalcRecordKind): Promise<number> {
  const fp = camConfAbsPath(cameraIndex, kind);
  try {
    const text = await withCamConfIoTimeout(`读取 ${fp}`, () => readFile(fp, "utf8"));
    if (!text) return 0;
    const lines = text.split(/\r?\n/);
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    return lines.length;
  } catch (err) {
    if (isEnoent(err)) return 0;
    throw err;
  }
}

async function countCamConfLinesAtPath(fp: string): Promise<number> {
  try {
    const text = await withCamConfIoTimeout(`读取 ${fp}`, () => readFile(fp, "utf8"));
    if (!text) return 0;
    const lines = text.split(/\r?\n/);
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    return lines.length;
  } catch (err) {
    if (isEnoent(err)) return 0;
    throw err;
  }
}

/** 对海标定：下一行序号 = 已有行数 + 1（对齐 Qt m_CamConfSize + 1） */
export function nextSeaCamConfSeq(existingLines: number): number {
  return existingLines + 1;
}

function patchSeaLineSeq(line: string, seq: number): string {
  const idx = line.indexOf(",");
  if (idx < 0) return String(seq);
  return `${seq}${line.slice(idx)}`;
}

export type CamConfAppendResult = {
  lineNo: number;
  seq?: number;
  path: string;
  appended: true;
};

/**
 * 在已有 camConf 文件末尾追加一行（std::ios::app），绝不覆盖历史数据。
 */
export async function appendCamConfLine(
  cameraIndex: number,
  kind: CalcRecordKind,
  line: string,
): Promise<CamConfAppendResult> {
  const fp = camConfAbsPath(cameraIndex, kind);
  await withCamConfIoTimeout(`创建目录 ${camConfDirname(fp)}`, () =>
    mkdir(camConfDirname(fp), { recursive: true }),
  );
  const prev = await countCamConfLines(cameraIndex, kind);
  let finalLine = line;
  let seq: number | undefined;
  if (kind === "sea") {
    seq = nextSeaCamConfSeq(prev);
    finalLine = patchSeaLineSeq(line, seq);
  }
  const suffix = finalLine.endsWith("\n") ? finalLine : `${finalLine}\n`;
  await withCamConfIoTimeout(`写入 ${fp}`, () => appendFile(fp, suffix, "utf8"));
  return { lineNo: prev + 1, seq, path: fp, appended: true };
}

export type CamConfBatchAppendResult = {
  path: string;
  firstLineNo: number;
  lastLineNo: number;
  lines: { lineNo: number; seq?: number }[];
  mode: "nfs" | "staging";
  stagingHint?: string;
};

async function appendCamConfLinesBatchAtPath(
  fp: string,
  kind: CalcRecordKind,
  lines: string[],
): Promise<Omit<CamConfBatchAppendResult, "path" | "mode" | "stagingHint">> {
  await withCamConfIoTimeout(`创建目录 ${camConfDirname(fp)}`, () =>
    mkdir(camConfDirname(fp), { recursive: true }),
  );
  const prev = await countCamConfLinesAtPath(fp);

  const chunks: string[] = [];
  const meta: { lineNo: number; seq?: number }[] = [];
  let lineNo = prev;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    lineNo += 1;
    let finalLine = trimmed;
    let seq: number | undefined;
    if (kind === "sea") {
      seq = nextSeaCamConfSeq(lineNo - 1);
      finalLine = patchSeaLineSeq(trimmed, seq);
    }
    chunks.push(finalLine.endsWith("\n") ? finalLine : `${finalLine}\n`);
    meta.push({ lineNo, seq });
  }

  if (chunks.length === 0) {
    throw new Error("no_valid_lines");
  }

  await withCamConfIoTimeout(`写入 ${fp}`, () => appendFile(fp, chunks.join(""), "utf8"));

  return {
    firstLineNo: meta[0]!.lineNo,
    lastLineNo: meta[meta.length - 1]!.lineNo,
    lines: meta,
  };
}

/** 批量追加：优先 NFS；失败时写入 /workspace/.camconf-staging 兜底 */
export async function appendCamConfLinesBatch(
  cameraIndex: number,
  kind: CalcRecordKind,
  lines: string[],
): Promise<CamConfBatchAppendResult> {
  const nfsFp = camConfAbsPath(cameraIndex, kind);
  try {
    const batch = await appendCamConfLinesBatchAtPath(nfsFp, kind, lines);
    return { ...batch, path: nfsFp, mode: "nfs" };
  } catch (nfsErr) {
    const stagingRoot = camConfStagingRoot();
    if (!stagingRoot) throw nfsErr;
    const stagingFp = camConfAbsPathAtRoot(stagingRoot, cameraIndex, kind);
    const batch = await appendCamConfLinesBatchAtPath(stagingFp, kind, lines);
    const nfsMsg = nfsErr instanceof Error ? nfsErr.message : String(nfsErr);
    return {
      ...batch,
      path: stagingFp,
      mode: "staging",
      stagingHint:
        `NFS 写入失败（${nfsMsg}），已暂存至 ${stagingFp}。` +
        "请在宿主机执行: NexusUI/scripts/sync-camconf-staging-to-nfs.sh",
    };
  }
}



export async function deleteCamConfFromLine(cameraIndex: number, kind: CalcRecordKind, startLine1Based: number): Promise<boolean> {

  const fp = camConfAbsPath(cameraIndex, kind);

  try {

    const text = await readFile(fp, "utf8");

    const lines = text.split(/\r?\n/);

    const idx = Math.max(0, startLine1Based - 1);

    if (idx >= lines.length) return false;

    const kept = lines.slice(0, idx).join("\n");

    const temp = `${fp}.tmp`;

    await writeFile(temp, kept.length > 0 ? `${kept}\n` : "", "utf8");

    await unlink(fp).catch(() => undefined);

    await rename(temp, fp);

    return true;

  } catch {

    return false;

  }

}



export async function saveRecordPic(opts: {

  cameraName: string;

  fileBaseName: string;

  bytes: Buffer;

}): Promise<string> {

  const safeName = opts.cameraName.trim().replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "camera";

  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const dir = path.join(recordPicRoot(), safeName, day);

  await mkdir(dir, { recursive: true });

  const fp = path.join(dir, `${opts.fileBaseName}.jpg`);

  await writeFile(fp, opts.bytes);

  return fp;

}


