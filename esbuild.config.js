const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: 'dist/index.js',
  // Make sure to externalize native modules so they aren't bundled into the JS
  // and can be resolved at runtime (assuming LM Studio provides them or they are deployed correctly).
  // For cross-OS, we will need to handle how native bindings are bundled later.
  external: ['better-sqlite3', '@lancedb/lancedb', 'fsevents', 'mupdf'],
  format: 'cjs',
}).catch(() => process.exit(1));
