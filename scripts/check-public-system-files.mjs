import { readdirSync } from "node:fs";
import { join } from "node:path";

const systemFileNames = new Set([".DS_Store", "Thumbs.db"]);

// macOS writes AppleDouble files ("._" and the original name) on some disks.
function isSystemFile(name) {
  return systemFileNames.has(name) || name.startsWith("._");
}

function findSystemFiles(directory) {
  const paths = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (isSystemFile(entry.name)) paths.push(path);
    else if (entry.isDirectory()) paths.push(...findSystemFiles(path));
  }

  return paths;
}

const paths = findSystemFiles("public").sort();
if (paths.length > 0) {
  console.error("Remove operating-system files from public/ before the build:");
  for (const path of paths) console.error(`- ${path}`);
  process.exitCode = 1;
}
