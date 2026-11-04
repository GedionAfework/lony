// Runs a plain TypeScript test file with Node's type stripping:
//   node --experimental-strip-types scripts/run-ts-test.mjs src/smsClassify.test.ts
// Lets test files import siblings without the ".ts" extension, like the app code does.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); }
  catch (e) {
    if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx);
    throw e;
  }
}`),
);
await import(pathToFileURL(path.resolve(process.argv[2])).href);
