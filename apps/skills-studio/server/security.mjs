import { realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';

function denied(message, status = 403) {
  return Object.assign(new Error(message), { status });
}

export function validateLocalRequest(req, allowedHosts) {
  const { host, origin, 'sec-fetch-site': fetchSite } = req.headers;
  if (!allowedHosts.includes(host)) throw denied('Unrecognized local Host.');
  if (origin !== undefined && !allowedHosts.some(allowed => origin === `http://${allowed}`)) throw denied('Unrecognized local Origin.');
  if (fetchSite === 'cross-site') throw denied('Cross-site requests are not allowed.');
}

export async function resolveArtifact(root, path) {
  if (typeof path !== 'string' || !path || path.includes('\0')) throw denied('Invalid artifact path.');
  let rootPath;
  let artifactPath;
  try {
    rootPath = await realpath(root);
    artifactPath = await realpath(resolve(rootPath, path));
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw denied('Artifact not found.', 404);
    throw error;
  }
  const within = relative(rootPath, artifactPath);
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw denied('Artifact is outside this run’s output directory.');
  const info = await stat(artifactPath);
  if (!info.isFile()) throw denied('Artifact is not a file.', 404);
  if (info.size > 10 * 1024 * 1024) throw denied('Artifact exceeds the 10 MiB preview limit.', 413);
  return { path: artifactPath, size: info.size };
}
