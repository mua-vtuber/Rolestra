/**
 * IPC handlers for structured log queries and export.
 *
 * Delegates to the StructuredLogger and LogExporter instances.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { LogExportOptions } from '../../../shared/log-types';
import type { StructuredLogger, LogEntryFilter } from '../../log/structured-logger';
import { LogExporter } from '../../log/log-exporter';

// ── Lazy accessor ────────────────────────────────────────────────

let loggerAccessor: (() => StructuredLogger) | null = null;

/**
 * Wire the log handler to the app's StructuredLogger instance.
 * Called once during app startup.
 */
export function setLoggerAccessor(fn: () => StructuredLogger): void {
  loggerAccessor = fn;
}

function getLogger(): StructuredLogger {
  if (!loggerAccessor) {
    throw new Error('StructuredLogger accessor not initialized');
  }
  return loggerAccessor();
}

/** List structured log entries with optional filters. */
export function handleLogList(
  data: IpcRequest<'log:list'>,
): IpcResponse<'log:list'> {
  const filter: LogEntryFilter = {};
  if (data?.component) filter.component = data.component;
  if (data?.level) filter.level = data.level as LogEntryFilter['level'];
  if (data?.result) filter.result = data.result as LogEntryFilter['result'];
  if (data?.startTime) filter.startTime = data.startTime;
  if (data?.endTime) filter.endTime = data.endTime;

  let entries = getLogger().getEntries(Object.keys(filter).length > 0 ? filter : undefined);

  if (data?.limit && data.limit > 0) {
    entries = entries.slice(-data.limit);
  }

  return { entries };
}

/** Export logs as JSON or Markdown. */
export function handleLogExport(
  data: IpcRequest<'log:export'>,
): IpcResponse<'log:export'> {
  const exporter = new LogExporter(getLogger());

  const options: LogExportOptions = {
    format: data.format,
    maskSecrets: data.maskSecrets,
    component: data.component,
    result: data.result as LogExportOptions['result'],
    startTime: data.startTime,
    endTime: data.endTime,
  };

  const content = data.format === 'json'
    ? exporter.exportAsJson(options)
    : exporter.exportAsMarkdown(options);

  const ext = data.format === 'json' ? 'json' : 'md';
  const filename = `arena-log-${Date.now()}.${ext}`;

  return { content, filename };
}
