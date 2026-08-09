import path from "node:path";

const databaseCommandPattern = /\b(sqlite3?|psql|mysql|mariadb|mongosh?|redis-cli|prisma\s+(migrate|db|studio)|typeorm\s+migration|sequelize-cli|knex\s+migrate)\b/i;

export function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertCurrentWorkspace(root: string): string {
  const resolved = path.resolve(root);
  const current = path.resolve(process.cwd());
  if (resolved.toLowerCase() !== current.toLowerCase()) throw new Error(`目标目录必须等于当前 Codex 工作区。当前：${current}`);
  return resolved;
}

export function assertAllowedPaths(root: string, paths: string[]): string[] {
  if (paths.length === 0) throw new Error("实施范围不能为空");
  return paths.map((entry) => {
    const absolute = path.resolve(root, entry);
    if (!isWithin(root, absolute)) throw new Error(`路径超出工作区：${entry}`);
    return path.relative(root, absolute).replaceAll("\\", "/") || ".";
  });
}

export function assertSafeCommand(command: string): void {
  if (databaseCommandPattern.test(command)) throw new Error("禁止执行数据库相关命令");
}

export function validatePatchPaths(patch: string, allowedPaths: string[]): void {
  const allowed = allowedPaths.map((entry) => entry.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, ""));
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const match = line.match(/^(?:---|\+\+\+)\s+(?:[ab]\/)?(.+)$/);
    if (!match) continue;
    const candidate = match[1]!.trim().replaceAll("\\", "/");
    if (candidate === "/dev/null") continue;
    paths.add(candidate);
  }
  if (paths.size === 0) throw new Error("补丁没有可识别的文件路径");
  for (const candidate of paths) {
    const accepted = allowed.some((entry) => candidate === entry || candidate.startsWith(`${entry}/`));
    if (!accepted) throw new Error(`补丁包含批准范围外的路径：${candidate}`);
  }
}

export function assertBinaryAuthorization(patch: string, authorized: boolean): void {
  if (/GIT binary patch|Binary files .* differ/i.test(patch) && !authorized) {
    throw new Error("检测到二进制文件修改，必须单独取得用户授权");
  }
}

export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer <redacted>")
    .replace(/((?:api[_-]?key|token)\s*[:=]\s*)[^\s,;]+/gi, "$1<redacted>")
    .replace(/(authorization\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi, "$1<redacted>");
}
