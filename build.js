import { build, context } from 'esbuild';
import { cpSync } from 'node:fs';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/app.js'],
  bundle: true,
  outfile: 'dist/bundle.js',
  platform: 'browser',
  format: 'iife',
  sourcemap: true,
};

cpSync('src/index.html', 'dist/index.html');
cpSync('src/style.css', 'dist/style.css');

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await build(options);
  console.log('Build complete.');
}
