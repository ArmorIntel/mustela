// Shared, deterministic transformation: importing this module never writes files.
export function generateContentIocRuntime(source, exclusions) {
  const transformed = `${source}\n${exclusions.replace(/^import .*;\n/gm, '')}`.replace(/^export\s+/gm, '');
  const banner = `// AUTO-GENERATED from src/shared/ioc.js and src/shared/exclusions.js\n// Do not edit directly. Run: node scripts/generate-content-ioc-runtime.mjs\n\n(() => {\n  if (globalThis.MUSTELA_SHARED) return;\n\n`;
  const footer = `\n\n  globalThis.MUSTELA_SHARED = {\n    IOC_TYPES,\n    isExcluded,\n    isValidIpv4,\n    classifyIpv4,\n    isProtectedIoc,\n    PUBLIC_LOOKUP_BLOCK_REASON,\n    PROTECTED_IPV4_EXPLANATION,\n    isValidSubnet,\n    normalizeIoc,\n    detectHashType,\n    parseIocsFromText,\n    detectSingleIoc,\n    buildThreatSummary,\n    summarizeProviderVerdict\n  };\n})();\n`;
  return banner + transformed + footer;
}
