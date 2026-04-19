import fs from 'node:fs/promises';
import { realpathSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initArenaRoot } from './arena-root';
import { ProjectService } from './project-service';
import { runCli } from './cli-spawn';
import {
  ClaudePermissionAdapter, CodexPermissionAdapter, GeminiPermissionAdapter,
  type CliPermissionAdapter, type AdapterContext,
} from './permission-adapter';
import { resolveProjectPaths } from './resolve-project-paths';
import type { CliKind, PermissionMode, ProjectKind, SmokeScenarioResult } from './types';

const CLI_COMMANDS: Record<CliKind, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
};

const ADAPTERS: Record<CliKind, CliPermissionAdapter> = {
  claude: new ClaudePermissionAdapter(),
  codex: new CodexPermissionAdapter(),
  gemini: new GeminiPermissionAdapter(),
};

const PROMPT =
  'Create a file "marker.txt" in the current working directory with the exact content "OK" (no newline). Do not create any other file.';

async function detectCli(cli: CliKind): Promise<boolean> {
  try {
    const r = await runCli({
      command: CLI_COMMANDS[cli],
      args: ['--version'],
      cwd: tmpdir(),
      timeoutMs: 10_000,
    });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

async function runScenario(
  cli: CliKind,
  mode: PermissionMode,
  kind: ProjectKind,
  arenaRoot: string,
  externalSrc?: string,
): Promise<SmokeScenarioResult> {
  const startedAt = new Date().toISOString();
  const scenarioId = `${cli}-${mode}-${kind}`;
  const observations: string[] = [];

  try {
    const svc = new ProjectService(arenaRoot);
    let project;

    if (kind === 'external') {
      if (mode === 'auto') {
        return {
          scenario: scenarioId,
          cliKind: cli,
          permissionMode: mode,
          projectKind: kind,
          os: process.platform,
          startedAt,
          finishedAt: new Date().toISOString(),
          success: true,
          observations: ['expected-reject: external + auto is forbidden by design'],
        };
      }
      project = await svc.linkExternal({
        slug: scenarioId,
        name: scenarioId,
        description: '',
        permissionMode: mode,
        externalPath: externalSrc!,
      });
    } else {
      project = await svc.createNewProject({
        slug: scenarioId,
        name: scenarioId,
        description: '',
        permissionMode: mode,
      });
    }

    const paths = resolveProjectPaths(project, arenaRoot);
    const consensusPath = path.join(arenaRoot, 'consensus');

    // external TOCTOU 재검증
    if (kind === 'external') {
      const realLink = realpathSync(paths.spawnCwd);
      if (realLink !== project.externalLink) {
        throw new Error(`TOCTOU: link real=${realLink}, meta=${project.externalLink}`);
      }
      observations.push(`TOCTOU check passed: ${realLink}`);
    }

    const adapter = ADAPTERS[cli];
    const adapterCtx: AdapterContext = {
      cliKind: cli,
      permissionMode: mode,
      projectKind: kind,
      cwd: paths.spawnCwd,
      consensusPath,
    };
    const args = adapter.buildArgs(adapterCtx);

    // CLI별 prompt 전달 방식
    let cliArgs = args;
    let stdin: string | undefined;
    if (cli === 'claude') {
      cliArgs = [...args, '-p', PROMPT, '--output-format', 'text'];
    } else if (cli === 'codex') {
      stdin = PROMPT;
    } else if (cli === 'gemini') {
      cliArgs = [...args, '-p', PROMPT];
    }

    observations.push(`spawn: ${CLI_COMMANDS[cli]} ${cliArgs.join(' ')}`);
    const r = await runCli({
      command: CLI_COMMANDS[cli],
      args: cliArgs,
      cwd: paths.spawnCwd,
      stdin,
      timeoutMs: 90_000,
    });
    observations.push(
      `exit=${r.exitCode} stdout-len=${r.stdout.length} stderr-len=${r.stderr.length}`,
    );

    const markerPath = path.join(paths.spawnCwd, 'marker.txt');
    const created = existsSync(markerPath);
    const content = created ? readFileSync(markerPath, 'utf-8') : null;
    const success = created && content?.trim() === 'OK';

    return {
      scenario: scenarioId,
      cliKind: cli,
      permissionMode: mode,
      projectKind: kind,
      os: process.platform,
      startedAt,
      finishedAt: new Date().toISOString(),
      success,
      observations,
      stderr: r.stderr.slice(0, 2000),
      fileCreated: created ? markerPath : undefined,
    };
  } catch (err) {
    return {
      scenario: scenarioId,
      cliKind: cli,
      permissionMode: mode,
      projectKind: kind,
      os: process.platform,
      startedAt,
      finishedAt: new Date().toISOString(),
      success: false,
      observations: [...observations, `error: ${(err as Error).message}`],
    };
  }
}

async function main(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = path.join(process.cwd(), 'tools/cli-smoke/matrix-results');
  await fs.mkdir(resultsDir, { recursive: true });

  const arenaRoot = mkdtempSync(path.join(tmpdir(), 'rolestra-arena-'));
  await initArenaRoot(arenaRoot);

  const externalSrc = mkdtempSync(path.join(tmpdir(), 'rolestra-extsrc-'));
  writeFileSync(path.join(externalSrc, '.gitkeep'), '');

  const clis: CliKind[] = ['claude', 'codex', 'gemini'];
  const modes: PermissionMode[] = ['auto', 'hybrid', 'approval'];
  const kinds: ProjectKind[] = ['new', 'external'];

  const results: SmokeScenarioResult[] = [];

  for (const cli of clis) {
    const available = await detectCli(cli);
    if (!available) {
      console.log(`[skip] ${cli} not installed`);
      for (const m of modes) {
        for (const k of kinds) {
          results.push({
            scenario: `${cli}-${m}-${k}`,
            cliKind: cli,
            permissionMode: m,
            projectKind: k,
            os: process.platform,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            success: false,
            observations: ['skipped: CLI not installed'],
          });
        }
      }
      continue;
    }
    for (const mode of modes) {
      for (const kind of kinds) {
        process.stdout.write(`[run] ${cli}/${mode}/${kind} ... `);
        const r = await runScenario(cli, mode, kind, arenaRoot, externalSrc);
        results.push(r);
        console.log(r.success ? 'OK' : 'FAIL');
      }
    }
  }

  const outPath = path.join(resultsDir, `${timestamp}.json`);
  await fs.writeFile(outPath, JSON.stringify(results, null, 2));

  const ok = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  console.log(`\nSummary: ${ok} ok / ${fail} fail / total ${results.length}`);
  console.log(`Results: ${outPath}`);
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
