import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function grantsPath(dataDir: string, userId: string) {
  return path.join(dataDir, "folder-grants", `${userId}.json`);
}

export async function loadFolderGrants(dataDir: string, userId: string): Promise<string[]> {
  try {
    const raw = JSON.parse(await readFile(grantsPath(dataDir, userId), "utf8")) as unknown;
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function addFolderGrant(dataDir: string, userId: string, folder: string): Promise<string[]> {
  const resolved = path.resolve(folder);
  const grants = await loadFolderGrants(dataDir, userId);
  if (!grants.includes(resolved)) grants.push(resolved);
  await mkdir(path.dirname(grantsPath(dataDir, userId)), { recursive: true });
  await writeFile(grantsPath(dataDir, userId), JSON.stringify(grants, null, 2));
  return grants;
}

export async function loadAllFolderGrants(dataDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const dir = path.join(dataDir, "folder-grants");
  try {
    const files = await readdir(dir);
    const grants: string[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const userId = file.replace(/\.json$/, "");
      grants.push(...(await loadFolderGrants(dataDir, userId)));
    }
    return [...new Set(grants)];
  } catch {
    return [];
  }
}
