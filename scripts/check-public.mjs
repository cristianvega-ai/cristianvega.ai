import { readdirSync } from "node:fs";
import { join } from "node:path";

const metadataNames = new Set([".DS_Store", "Thumbs.db"]);

function findMetadata(directory) {
  const paths = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (metadataNames.has(entry.name)) paths.push(path);
    else if (entry.isDirectory()) paths.push(...findMetadata(path));
  }

  return paths;
}

const paths = findMetadata("public").sort();
if (paths.length > 0) {
  console.error("Remove operating-system metadata from public/ before the build:");
  for (const path of paths) console.error(`- ${path}`);
  process.exitCode = 1;
}
