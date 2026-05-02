/**
 * Step1ArenaRoot — R12-C round 2 (2026-05-03) 첫 부팅 ArenaRoot picker.
 *
 * onboarding step 1 (welcome) 안에 노출. 사용자가 데이터 저장 폴더
 * (디폴트 `<Documents>/Rolestra`) 를 그대로 둘지, 외부 SSD 등 원하는
 * 위치로 바꿀지 결정하는 1회용 picker.
 *
 * 동작:
 * 1. mount 시 `arena-root:get` 으로 현재 경로 표시.
 * 2. "변경" 클릭 → `project:pick-folder` (Electron showOpenDialog) →
 *    경로 선택 → `arena-root:set` 호출.
 * 3. 변경 응답이 requiresRestart=true 면 banner 노출 — 사용자가
 *    onboarding 계속 진행해도 무방하나 finish 후 앱을 재시작하라고
 *    안내한다 (settings 의 arenaRoot 만 갱신; main process 는 기존
 *    경로로 계속 동작 중. 재시작 시 새 경로로 ensure).
 *
 * 디폴트 경로를 명시적으로 보여주는 것이 핵심 — 사용자가 "어디에
 * 저장되는지" 즉시 인지하고, 외부 SSD / OneDrive / 다른 드라이브로
 * 옮기고 싶으면 한 번에 변경할 수 있다.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../components/primitives/button';
import { invoke } from '../../../ipc/invoke';

export function Step1ArenaRoot(): ReactElement {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [pending, setPending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [restartHint, setRestartHint] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { path } = await invoke('arena-root:get', undefined);
        if (!cancelled) setCurrentPath(path);
      } catch (reason) {
        if (!cancelled) {
          setErrorMessage(
            reason instanceof Error ? reason.message : String(reason),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = useCallback(async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setErrorMessage(null);
    try {
      const { folderPath } = await invoke('project:pick-folder', undefined);
      if (folderPath === null) {
        // 사용자 cancel — silent.
        setPending(false);
        return;
      }
      await invoke('arena-root:set', { path: folderPath });
      setCurrentPath(folderPath);
      setRestartHint(true);
    } catch (reason) {
      setErrorMessage(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setPending(false);
    }
  }, [pending]);

  return (
    <section
      data-testid="onboarding-step-1-arena-root"
      className="mx-auto mt-12 w-full max-w-2xl rounded-panel border border-border-soft bg-panel-bg p-4 text-sm text-fg"
    >
      <h3 className="text-xs font-bold uppercase tracking-wide text-fg-subtle">
        {t('onboarding.step1.arenaRoot.header', {
          defaultValue: '데이터 저장 폴더',
        })}
      </h3>
      <p className="mt-1 text-xs text-fg-muted">
        {t('onboarding.step1.arenaRoot.hint', {
          defaultValue:
            '여기에 직원 / 채널 / 메시지 / 합의 결과 / 신규 프로젝트 폴더가 모두 저장됩니다. 외부 SSD 같은 다른 위치를 원하면 변경하세요.',
        })}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code
          data-testid="onboarding-step-1-arena-root-path"
          className="flex-1 min-w-[260px] rounded-panel border border-border-soft bg-canvas px-2 py-1 font-mono text-xs"
        >
          {currentPath ?? t('onboarding.step1.arenaRoot.loading', {
            defaultValue: '경로 확인 중…',
          })}
        </code>
        <Button
          type="button"
          tone="primary"
          size="sm"
          onClick={() => {
            void handleChange();
          }}
          disabled={pending || currentPath === null}
          data-testid="onboarding-step-1-arena-root-change"
        >
          {pending
            ? t('onboarding.step1.arenaRoot.changing', {
                defaultValue: '변경 중…',
              })
            : t('onboarding.step1.arenaRoot.change', {
                defaultValue: '변경',
              })}
        </Button>
      </div>

      {restartHint ? (
        <p
          data-testid="onboarding-step-1-arena-root-restart-hint"
          className="mt-3 rounded-panel border border-border-soft bg-canvas px-2 py-1.5 text-xs text-fg-muted"
        >
          {t('onboarding.step1.arenaRoot.restart', {
            defaultValue:
              '폴더 변경은 앱을 재시작해야 적용됩니다. 마법사를 끝낸 뒤 앱을 다시 실행해 주세요.',
          })}
        </p>
      ) : null}

      {errorMessage !== null ? (
        <p
          data-testid="onboarding-step-1-arena-root-error"
          role="alert"
          className="mt-2 text-xs text-danger"
        >
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
