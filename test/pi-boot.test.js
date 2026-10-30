import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from '../server/config.ts';

test('Pi boot updates safely, installs changed packages, and starts the server', async () => {
  await mkdir(join(root, 'data', 'tests'), { recursive: true });
  const folder = await mkdtemp(join(root, 'data', 'tests', 'boot-'));
  const runtime = join(folder, '.runtime', 'node', 'bin');
  const commands = join(folder, 'commands');
  const events = join(folder, 'events');
  const script = join(folder, 'scripts', 'start-pi.sh');
  async function stub(path, body) { await writeFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); }
  function run(extra = {}) {
    const result = spawnSync('bash', [script], {
      env: { ...process.env, PATH: `${commands}:${process.env.PATH}`, BOOT_EVENTS: events, ...extra },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.error, undefined);
    return result;
  }
  async function logged() { return (await readFile(events, 'utf8')).trim().split('\n'); }
  try {
    await mkdir(join(folder, 'scripts'));
    await mkdir(runtime, { recursive: true });
    await mkdir(commands);
    await copyFile(join(root, 'scripts', 'start-pi.sh'), script);
    await chmod(script, 0o755);
    await writeFile(join(folder, 'package-lock.json'), '{"version":1}\n');
    await stub(join(runtime, 'node'), 'echo node >> "$BOOT_EVENTS"');
    await stub(join(runtime, 'npm'), 'echo npm >> "$BOOT_EVENTS"; [ "${BOOT_NPM_FAIL:-0}" -ne 0 ] || mkdir -p node_modules; exit "${BOOT_NPM_FAIL:-0}"');
    await stub(join(commands, 'git'), 'case "$1" in rev-parse) pwd;; diff) exit "${BOOT_DIRTY:-0}";; pull) echo pull >> "$BOOT_EVENTS"; count=$(grep -c "^pull$" "$BOOT_EVENTS"); [ "$count" -le "${BOOT_PULL_FAIL_COUNT:-0}" ] && exit 1; exit "${BOOT_PULL_FAIL:-0}";; esac');
    await stub(join(commands, 'timeout'), 'shift; "$@"');
    await stub(join(commands, 'sleep'), '[ "${BOOT_LOG_SLEEP:-0}" -eq 1 ] && echo "sleep:$1" >> "$BOOT_EVENTS"; exit 0');

    assert.equal(run({ BOARD_BOOT_DELAY_SECONDS: '120', BOOT_LOG_SLEEP: '1' }).status, 0);
    assert.deepEqual(await logged(), ['sleep:120', 'pull', 'npm', 'node']);
    await writeFile(events, '');

    assert.equal(run().status, 0);
    assert.deepEqual(await logged(), ['pull', 'node']);
    await writeFile(events, '');

    assert.equal(run({ BOOT_PULL_FAIL: '1' }).status, 0);
    assert.deepEqual(await logged(), ['pull', 'pull', 'pull', 'pull', 'node']);
    await writeFile(events, '');

    assert.equal(run({ BOOT_PULL_FAIL_COUNT: '2' }).status, 0);
    assert.deepEqual(await logged(), ['pull', 'pull', 'pull', 'node']);
    await writeFile(events, '');

    assert.equal(run({ BOOT_DIRTY: '1' }).status, 0);
    assert.deepEqual(await logged(), ['node']);
    await writeFile(events, '');

    await writeFile(join(folder, 'package-lock.json'), '{"version":2}\n');
    assert.notEqual(run({ BOOT_NPM_FAIL: '1' }).status, 0);
    assert.deepEqual(await logged(), ['pull', 'npm']);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
