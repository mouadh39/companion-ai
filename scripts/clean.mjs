import { rmSync } from 'node:fs';

/**
 * Removes a package's build output.
 *
 * Exists because the previous `clean` scripts were `rm -rf dist
 * tsconfig.tsbuildinfo` — POSIX only. Turborepo runs scripts through the
 * platform shell, so on a Windows runner (`cmd.exe`) `rm` is not a command and
 * every `clean` fails. That is invisible day to day and breaks exactly when
 * someone needs a clean rebuild to diagnose something else.
 *
 * `node` is the one interpreter guaranteed present in every context that can
 * run this repo at all, which makes it the portable choice without adding a
 * dependency for it.
 *
 * `tsconfig.tsbuildinfo` is no longer removed separately: `tsconfig.base.json`
 * now writes it inside `dist/`, so it is covered here and by Turborepo's
 * declared build outputs.
 */
const targets = ['dist', 'tsconfig.tsbuildinfo'];

for (const target of targets) {
  rmSync(target, { recursive: true, force: true });
}
