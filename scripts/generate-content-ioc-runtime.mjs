import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'src', 'shared', 'ioc.js');
const targetPath = path.join(root, 'src', 'shared', 'ioc.content-runtime.js');

const source = await readFile(sourcePath, 'utf8');
const transformed = source.replace(/^export\s+/gm, '');

const banner = `// AUTO-GENERATED from src/shared/ioc.js\n// Do not edit directly. Run: node scripts/generate-content-ioc-runtime.mjs\n\n(() => {\n  if (globalThis.MUSTELA_SHARED) return;\n\n`;
const footer = `\n\n  globalThis.MUSTELA_SHARED = {\n    IOC_TYPES,\n    isValidIpv4,\n    isValidSubnet,\n    normalizeIoc,\n    detectHashType,\n    parseIocsFromText,\n    detectSingleIoc,\n    buildThreatSummary,\n    summarizeProviderVerdict\n  };\n})();\n`;

await writeFile(targetPath, banner + transformed + footer);
console.log(`Generated ${path.relative(root, targetPath)} from ${path.relative(root, sourcePath)}`);
