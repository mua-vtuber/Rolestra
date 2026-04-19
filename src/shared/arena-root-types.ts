/**
 * Arena Root 도메인 타입 — ArenaRoot 디렉터리 상태와 프로젝트 경로 해석 결과를 공유한다.
 */

export interface ArenaRootStatus {
  path: string;
  exists: boolean;
  writable: boolean;
  consensusReady: boolean;
  projectsCount: number;
}

export interface ProjectPaths {
  /** resolveProjectPaths() 결과. external은 link 하위 포함 */
  rootPath: string;       // <ArenaRoot>/projects/<slug>
  cwdPath: string;        // new/imported: rootPath / external: rootPath + '/link'
  metaPath: string;       // rootPath + '/.arena/meta.json'
  consensusPath: string;  // <ArenaRoot>/consensus
}
