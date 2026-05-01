/**
 * Unit tests for ProjectSkillSyncService (R12-C Task 6).
 *
 * Coverage:
 *   - Writes 9 SKILL.md files in BOTH `.claude/skills` and `.agents/skills`
 *     (= 18 files per project).
 *   - meeting-summary (SystemSkillId) is excluded.
 *   - Idempotency: second call on unchanged tree → all entries 'unchanged'.
 *   - User customisation: pre-existing file with different content is
 *     reported 'skipped' (force=false) or overwritten (force=true).
 *   - Path safety: relative or escaping projectRoot throws.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectSkillSyncService } from '../project-skill-sync-service';

describe('ProjectSkillSyncService', () => {
  let projectRoot: string;
  let service: ProjectSkillSyncService;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'rolestra-skill-sync-'),
    );
    service = new ProjectSkillSyncService();
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  describe('first-time write', () => {
    it('writes 18 SKILL.md files (9 roles × 2 roots)', async () => {
      const result = await service.syncProjectSkills(projectRoot);
      expect(result.written.length).toBe(18);
      expect(result.unchanged.length).toBe(0);
      expect(result.skipped.length).toBe(0);
    });

    it('lays out 9 directories under each skill root', async () => {
      await service.syncProjectSkills(projectRoot);
      const claudeRoles = await fs.readdir(
        path.join(projectRoot, '.claude/skills'),
      );
      const agentsRoles = await fs.readdir(
        path.join(projectRoot, '.agents/skills'),
      );
      expect(claudeRoles.sort()).toEqual([
        'design.background',
        'design.character',
        'design.ui',
        'design.ux',
        'general',
        'idea',
        'implement',
        'planning',
        'review',
      ]);
      expect(agentsRoles.sort()).toEqual(claudeRoles.sort());
    });

    it('does NOT create a directory for meeting-summary', async () => {
      await service.syncProjectSkills(projectRoot);
      await expect(
        fs.access(path.join(projectRoot, '.claude/skills/meeting-summary')),
      ).rejects.toThrow();
      await expect(
        fs.access(path.join(projectRoot, '.agents/skills/meeting-summary')),
      ).rejects.toThrow();
    });

    it('SKILL.md content includes frontmatter + 자기 spec 합리화 방어', async () => {
      await service.syncProjectSkills(projectRoot);
      const content = await fs.readFile(
        path.join(projectRoot, '.claude/skills/idea/SKILL.md'),
        'utf-8',
      );
      expect(content.startsWith('---\n')).toBe(true);
      expect(content).toMatch(/^name: idea$/m);
      expect(content).toContain('# 아이디어 부서');
      expect(content).toContain('## 자기 spec 합리화 방어 (필수 준수)');
    });
  });

  describe('idempotency', () => {
    it('reports all 18 entries as unchanged on the second call', async () => {
      await service.syncProjectSkills(projectRoot);
      const second = await service.syncProjectSkills(projectRoot);
      expect(second.written.length).toBe(0);
      expect(second.unchanged.length).toBe(18);
      expect(second.skipped.length).toBe(0);
    });
  });

  describe('user customisation', () => {
    it('skips a customised file when force=false', async () => {
      await service.syncProjectSkills(projectRoot);
      const customised = path.join(
        projectRoot,
        '.claude/skills/idea/SKILL.md',
      );
      await fs.writeFile(customised, '# user-customised\n', 'utf-8');
      const result = await service.syncProjectSkills(projectRoot);
      expect(result.skipped.some((e) => e.path === customised)).toBe(true);
      const stillCustomised = await fs.readFile(customised, 'utf-8');
      expect(stillCustomised).toBe('# user-customised\n');
    });

    it('overwrites a customised file when force=true', async () => {
      await service.syncProjectSkills(projectRoot);
      const customised = path.join(
        projectRoot,
        '.claude/skills/idea/SKILL.md',
      );
      await fs.writeFile(customised, '# user-customised\n', 'utf-8');
      const result = await service.syncProjectSkills(projectRoot, {
        force: true,
      });
      expect(result.written.some((e) => e.path === customised)).toBe(true);
      const restored = await fs.readFile(customised, 'utf-8');
      expect(restored).not.toBe('# user-customised\n');
      expect(restored).toContain('# 아이디어 부서');
    });
  });

  describe('path safety', () => {
    it('throws on a relative projectRoot', async () => {
      await expect(
        service.syncProjectSkills('relative/path'),
      ).rejects.toThrow(/must be absolute/);
    });
  });
});
