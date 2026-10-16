// Shared, deterministic transformation: importing this module never writes files.
export function generateContentIocRuntime(source) {
  const transformed = source.replace(/^export\s+/gm, '');
  const banner = `// AUTO-GENERATED from src/shared/ioc.js\n// Do not edit directly. Run: node scripts/generate-content-ioc-runtime.mjs\n\n(() => {\n  if (globalThis.MUSTELA_SHARED) return;\n\n`;
  const footer = `\n\n  globalThis.MUSTELA_SHARED = {\n    IOC_TYPES,\n    isValidIpv4,\n    isValidSubnet,\n    normalizeIoc,\n    detectHashType,\n    parseIocsFromText,\n    detectSingleIoc,\n    buildThreatSummary,\n    summarizeProviderVerdict\n  };\n})();\n`;
  return banner + transformed + footer;
}
