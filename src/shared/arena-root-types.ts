/**
 * Arena Root 도메인 타입 — ArenaRoot 디렉터리 상태와 프로젝트 경로 해석 결과를 공유한다.
 *
 * R12-X T2: `ProjectPaths` 의 네 경로는 모두 `AbsolutePath` 다. 이 record 는
 * CLI spawn cwd 와 path-guard 뿌리를 동시에 공급하므로, 상대 경로가 한 번만
 * 섞여도 AI 가 앱 실행 폴더를 프로젝트로 착각한다.
 */

import type { AbsolutePath } from './absolute-path';

export interface ArenaRootStatus {
  path: string;
  exists: boolean;
  writable: boolean;
  consensusReady: boolean;
  projectsCount: number;
}

export interface ProjectPaths {
  /** resolveProjectPaths() 결과. external은 link 하위 포함 */
  rootPath: AbsolutePath;       // <ArenaRoot>/projects/<slug>
  cwdPath: AbsolutePath;        // new/imported: rootPath / external: rootPath + '/link'
  metaPath: AbsolutePath;       // rootPath + '/.arena/meta.json'
  consensusPath: AbsolutePath;  // <ArenaRoot>/consensus
}
