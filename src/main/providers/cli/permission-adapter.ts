/**
 * CLI Permission Adapters — map permission grants to CLI-specific flags.
 *
 * Each CLI tool has different permission models:
 * - Claude Code: --allowedTools flag
 * - Codex: --approval-mode flag
 * - Gemini/others: prompt-only (no CLI flag support)
 */

/** Interface for CLI-specific permission adapters. */
export interface CliPermissionAdapter {
  /**
   * Build CLI args for read-only mode.
   *
   * @param projectPath - Absolute path to the project folder.
   * @param consensusPath - Optional absolute path to the consensus folder (granted R+W).
   */
  buildReadOnlyArgs(projectPath: string, consensusPath?: string): string[];
  /**
   * Build CLI args for worker mode (write/execute allowed).
   *
   * @param projectPath - Absolute path to the project folder.
   * @param consensusPath - Optional absolute path to the consensus folder (granted R+W).
   */
  buildWorkerArgs(projectPath: string, consensusPath?: string): string[];
  /** System prompt text for read-only participants. */
  getReadOnlySystemPrompt(): string;
  /**
   * System prompt text for the designated worker.
   *
   * @param projectPath - Absolute path to the project folder.
   * @param consensusFolder - Absolute path to the consensus folder where the work summary must be written.
   * @param summaryFileName - Target filename for the work summary document.
   */
  getWorkerSystemPrompt(
    projectPath: string,
    consensusFolder: string,
    summaryFileName: string,
  ): string;
  /** System prompt text for non-worker during execution. */
  getObserverSystemPrompt(workerName: string): string;
}

export class ClaudePermissionAdapter implements CliPermissionAdapter {
  buildReadOnlyArgs(projectPath: string, consensusPath?: string): string[] {
    const args: string[] = ['--allowedTools', 'Read,Glob,Grep,WebSearch,WebFetch'];
    // Pre-grant the project folder for reading (avoids per-file permission prompts)
    if (projectPath && projectPath !== '.') {
      args.push('--add-dir', projectPath);
    }
    // Pre-grant the consensus folder for reading and writing
    if (consensusPath) {
      args.push('--add-dir', consensusPath);
    }
    return args;
  }

  buildWorkerArgs(projectPath: string, consensusPath?: string): string[] {
    const args: string[] = [];
    // Pre-grant the project folder so the worker can operate without prompts
    if (projectPath && projectPath !== '.') {
      args.push('--add-dir', projectPath);
    }
    // Pre-grant the consensus folder for writing the work summary
    if (consensusPath) {
      args.push('--add-dir', consensusPath);
    }
    return args;
  }

  getReadOnlySystemPrompt(): string {
    return '이 프로젝트 폴더는 읽기 전용입니다. 파일을 수정하거나 명령을 실행하지 마세요.';
  }

  getWorkerSystemPrompt(
    projectPath: string,
    consensusFolder: string,
    summaryFileName: string,
  ): string {
    return `작업자로 선택되었습니다. ${projectPath}에 대한 쓰기/실행 권한이 부여되었습니다.\n작업 완료 후 합의 폴더에 작업 요약 문서를 작성하세요: ${consensusFolder}/${summaryFileName}`;
  }

  getObserverSystemPrompt(workerName: string): string {
    return `작업 금지. ${workerName}이(가) 작업 중입니다.`;
  }
}

export class CodexPermissionAdapter implements CliPermissionAdapter {
  buildReadOnlyArgs(_projectPath: string, _consensusPath?: string): string[] {
    return [];
  }

  buildWorkerArgs(_projectPath: string, _consensusPath?: string): string[] {
    return [];
  }

  getReadOnlySystemPrompt(): string {
    return '이 프로젝트 폴더는 읽기 전용입니다. 파일을 수정하거나 명령을 실행하지 마세요.';
  }

  getWorkerSystemPrompt(
    projectPath: string,
    consensusFolder: string,
    summaryFileName: string,
  ): string {
    return `작업자로 선택되었습니다. ${projectPath}에 대한 쓰기/실행 권한이 부여되었습니다.\n작업 완료 후 합의 폴더에 작업 요약 문서를 작성하세요: ${consensusFolder}/${summaryFileName}`;
  }

  getObserverSystemPrompt(workerName: string): string {
    return `작업 금지. ${workerName}이(가) 작업 중입니다.`;
  }
}

export class PromptOnlyPermissionAdapter implements CliPermissionAdapter {
  buildReadOnlyArgs(_projectPath: string, _consensusPath?: string): string[] {
    return [];
  }

  buildWorkerArgs(_projectPath: string, _consensusPath?: string): string[] {
    return [];
  }

  getReadOnlySystemPrompt(): string {
    return '이 프로젝트 폴더는 읽기 전용입니다. 파일을 수정하거나 명령을 실행하지 마세요.';
  }

  getWorkerSystemPrompt(
    projectPath: string,
    consensusFolder: string,
    summaryFileName: string,
  ): string {
    return `작업자로 선택되었습니다. ${projectPath}에 대한 쓰기/실행 권한이 부여되었습니다.\n작업 완료 후 합의 폴더에 작업 요약 문서를 작성하세요: ${consensusFolder}/${summaryFileName}`;
  }

  getObserverSystemPrompt(workerName: string): string {
    return `작업 금지. ${workerName}이(가) 작업 중입니다.`;
  }
}
