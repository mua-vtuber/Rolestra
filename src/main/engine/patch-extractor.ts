/**
 * PatchExtractor — calls the facilitator AI with a structured JSON prompt
 * to convert a consensus proposal into a concrete PatchSet.
 *
 * Follows the same retry/parse pattern as DecisionCollector:
 *   1. Build prompt with JSON schema
 *   2. Stream AI response and accumulate
 *   3. Parse JSON, retry on failure with corrective message
 *   4. Validate entries, resolve paths, fill originalContent
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PatchSet, PatchEntry } from '../../shared/execution-types';
import { providerRegistry } from '../providers/registry';

export interface PatchExtractorConfig {
  parseRetryLimit: number;
}

/** Raw JSON entry from AI response. */
interface RawFileEntry {
  path?: string;
  operation?: string;
  content?: string;
}

/** RawFileEntry after validation — path and operation are guaranteed present. */
interface ValidatedFileEntry extends RawFileEntry {
  path: string;
  operation: 'create' | 'modify' | 'delete';
}

const EXTRACTION_PROMPT = [
  'Based on the agreed proposal below, output the exact file changes as STRICT JSON only.',
  'Schema:',
  '{',
  '  "files": [',
  '    {',
  '      "path": "relative/path/from/project/root",',
  '      "operation": "create" | "modify" | "delete",',
  '      "content": "full file content (required for create/modify, omit for delete)"',
  '    }',
  '  ]',
  '}',
  '',
  'Rules:',
  '- path must be relative to the project root (no leading /).',
  '- For "modify", provide the COMPLETE new file content, not a diff.',
  '- For "delete", omit the content field.',
  '- Return ONLY the JSON object, no explanation or markdown fences.',
  '- If no file changes are needed, return { "files": [] }.',
  '',
  'Proposal:',
].join('\n');

export class PatchExtractor {
  private config: PatchExtractorConfig;

  constructor(config: PatchExtractorConfig) {
    this.config = config;
  }

  /**
   * Call the facilitator AI to extract a PatchSet from a consensus proposal.
   * Returns null if the provider is unavailable or parsing fails after retries.
   */
  async extract(
    proposal: string,
    aggregatorId: string,
    conversationId: string,
    projectFolder: string,
  ): Promise<PatchSet | null> {
    const provider = providerRegistry.get(aggregatorId);
    if (!provider) return null;

    const messages: Array<{ role: 'user'; content: string }> = [
      { role: 'user', content: `${EXTRACTION_PROMPT}\n${proposal}` },
    ];

    const rawEntries = await this.parseWithRetry(provider, messages);
    if (!rawEntries || rawEntries.length === 0) return null;

    const entries = await this.buildPatchEntries(rawEntries, projectFolder);
    if (entries.length === 0) return null;

    return {
      operationId: randomUUID(),
      aiId: aggregatorId,
      conversationId,
      entries,
      dryRun: true,
    };
  }

  /**
   * Stream AI response and parse JSON with retry on failure.
   * Follows DecisionCollector.parseWithRetry() pattern.
   */
  private async parseWithRetry(
    provider: NonNullable<ReturnType<typeof providerRegistry.get>>,
    messages: Array<{ role: 'user'; content: string }>,
  ): Promise<ValidatedFileEntry[] | null> {
    for (let attempt = 0; attempt <= this.config.parseRetryLimit; attempt++) {
      let response = '';
      for await (const token of provider.streamCompletion(messages, '', undefined, undefined)) {
        response += token;
      }

      try {
        return this.parseFileEntries(response);
      } catch (error) {
        if (attempt >= this.config.parseRetryLimit) return null;
        messages.push({
          role: 'user',
          content: `Your previous output could not be parsed (${String(error)}). Return only valid JSON with the exact schema: { "files": [...] }`,
        });
      }
    }
    return null;
  }

  /** Extract and validate file entries from AI response JSON. */
  parseFileEntries(response: string): ValidatedFileEntry[] {
    const jsonText = this.extractFirstJsonObject(response);
    const parsed = JSON.parse(jsonText) as { files?: unknown };

    if (!parsed.files || !Array.isArray(parsed.files)) {
      throw new Error('"files" array is required');
    }

    const entries: ValidatedFileEntry[] = [];
    for (const item of parsed.files) {
      if (!item || typeof item !== 'object') {
        throw new Error('each file entry must be an object');
      }
      const entry = item as RawFileEntry;
      if (!entry.path || typeof entry.path !== 'string') {
        throw new Error('file entry "path" is required');
      }
      if (!entry.operation || !['create', 'modify', 'delete'].includes(entry.operation)) {
        throw new Error('file entry "operation" must be create, modify, or delete');
      }
      if (entry.operation !== 'delete' && (entry.content === undefined || typeof entry.content !== 'string')) {
        throw new Error(`file entry "content" is required for ${entry.operation}`);
      }
      entries.push(entry as ValidatedFileEntry);
    }

    return entries;
  }

  /**
   * Convert raw AI entries into validated PatchEntry[].
   * Resolves relative paths, blocks path traversal, fills originalContent.
   */
  private async buildPatchEntries(
    rawEntries: ValidatedFileEntry[],
    projectFolder: string,
  ): Promise<PatchEntry[]> {
    const entries: PatchEntry[] = [];

    for (const raw of rawEntries) {
      const relativePath = raw.path;
      const absolutePath = path.resolve(projectFolder, relativePath);

      // Path traversal guard: resolved path must be inside projectFolder
      const normalizedProject = path.resolve(projectFolder) + path.sep;
      const normalizedTarget = path.resolve(absolutePath);
      if (!normalizedTarget.startsWith(normalizedProject) && normalizedTarget !== path.resolve(projectFolder)) {
        continue; // silently skip paths that escape projectFolder
      }

      const operation = raw.operation;
      const entry: PatchEntry = {
        targetPath: absolutePath,
        operation,
      };

      if (operation === 'create') {
        entry.newContent = raw.content;
      } else if (operation === 'modify') {
        entry.newContent = raw.content;
        try {
          entry.originalContent = await fs.readFile(absolutePath, 'utf-8');
        } catch {
          // File doesn't exist — treat as create instead
          entry.operation = 'create';
        }
      } else if (operation === 'delete') {
        try {
          entry.originalContent = await fs.readFile(absolutePath, 'utf-8');
        } catch {
          continue; // Can't delete a file that doesn't exist
        }
      }

      entries.push(entry);
    }

    return entries;
  }

  /** Extract the first JSON object from a text response. */
  private extractFirstJsonObject(text: string): string {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('no JSON object found');
    }
    return text.slice(start, end + 1);
  }
}
