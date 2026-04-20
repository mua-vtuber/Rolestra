/**
 * Remote access tab — Tailscale/direct mode, token management, sessions.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { showError } from '../../hooks/useErrorDialog';
import type { RemoteAccessGrant, RemoteAccessPolicy, RemotePermissionSet, RemoteSession, TailscaleStatus } from '../../../shared/remote-types';

/** Lightweight check for display hints — mirrors tls-util.needsTls logic. */
function wouldNeedTls(host: string): boolean {
  if (!host || host === '127.0.0.1' || host === '::1') return false;
  const parts = host.split('.');
  if (parts.length === 4) {
    const [a, b] = parts.map(Number);
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

export function RemoteAccessTab(): React.JSX.Element {
  const { t } = useTranslation();

  const [policy, setPolicy] = useState<RemoteAccessPolicy | null>(null);
  const [sessions, setSessions] = useState<RemoteSession[]>([]);
  const [saved, setSaved] = useState(false);
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);
  const [tailscaleLoading, setTailscaleLoading] = useState(false);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverLoading, setServerLoading] = useState(false);
  const [grants, setGrants] = useState<RemoteAccessGrant[]>([]);
  const [newToken, setNewToken] = useState('');
  const [tokenCopied, setTokenCopied] = useState(false);

  useEffect(() => {
    const fetch = async (): Promise<void> => {
      try {
        const [policyResult, sessionsResult, statusResult, grantsResult] = await Promise.all([
          window.arena.invoke('remote:get-policy', undefined),
          window.arena.invoke('remote:get-sessions', undefined),
          window.arena.invoke('remote:server-status', undefined),
          window.arena.invoke('remote:list-grants', undefined),
        ]);
        setPolicy(policyResult.policy);
        setSessions(sessionsResult.sessions);
        setServerRunning(statusResult.running);
        setGrants(grantsResult.grants);
      } catch (err) { console.warn('[remote:init-fetch] error:', err); }
    };
    void fetch();
  }, []);

  const refreshTailscaleStatus = useCallback(async () => {
    setTailscaleLoading(true);
    try {
      const result = await window.arena.invoke('remote:tailscale-status', undefined);
      setTailscaleStatus(result.status);
    } catch (err) { showError('remote:tailscale-status', err); }
    setTailscaleLoading(false);
  }, []);

  // Fetch Tailscale status when tailscale mode is selected
  useEffect(() => {
    if (policy?.mode !== 'tailscale') return;
    let cancelled = false;
    void (async () => {
      setTailscaleLoading(true);
      try {
        const result = await window.arena.invoke('remote:tailscale-status', undefined);
        if (!cancelled) setTailscaleStatus(result.status);
      } catch (err) { showError('remote:tailscale-status', err); }
      if (!cancelled) setTailscaleLoading(false);
    })();
    return () => { cancelled = true; };
  }, [policy?.mode]);

  const updatePolicy = <K extends keyof RemoteAccessPolicy>(key: K, value: RemoteAccessPolicy[K]): void => {
    setPolicy((prev) => prev ? { ...prev, [key]: value } : prev);
  };

  const handleSave = async (): Promise<void> => {
    if (!policy) return;
    try {
      await window.arena.invoke('remote:set-policy', { policy });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { showError('remote:set-policy', err); }
  };

  const handleStartServer = async (): Promise<void> => {
    if (!policy) return;
    setServerLoading(true);
    try {
      await window.arena.invoke('remote:set-policy', { policy });
      await window.arena.invoke('remote:start-server', undefined);
      setServerRunning(true);
    } catch (err) { showError('remote:start-server', err); }
    setServerLoading(false);
  };

  const handleStopServer = async (): Promise<void> => {
    setServerLoading(true);
    try {
      await window.arena.invoke('remote:stop-server', undefined);
      setServerRunning(false);
    } catch (err) { showError('remote:stop-server', err); }
    setServerLoading(false);
  };

  const handleGenerateToken = async (): Promise<void> => {
    const permissions: RemotePermissionSet = {
      read: { enabled: true },
      write: { enabled: false },
      execute: { enabled: false },
    };
    try {
      const result = await window.arena.invoke('remote:generate-token', { permissions });
      setNewToken(result.token);
      const grantsResult = await window.arena.invoke('remote:list-grants', undefined);
      setGrants(grantsResult.grants);
    } catch (err) { showError('remote:generate-token', err); }
  };

  const handleRevokeGrant = async (grantId: string): Promise<void> => {
    try {
      await window.arena.invoke('remote:revoke-token', { grantId });
      setGrants((prev) => prev.filter((g) => g.grantId !== grantId));
    } catch (err) { showError('remote:revoke-token', err); }
  };

  const handleCopyToken = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(newToken);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch (err) { showError('clipboard:copy', err); }
  };

  const [newIp, setNewIp] = useState('');

  const addAllowedIp = (): void => {
    if (!newIp.trim() || !policy) return;
    updatePolicy('directAccessAllowedIPs', [...policy.directAccessAllowedIPs, newIp.trim()]);
    setNewIp('');
  };

  const removeAllowedIp = (ip: string): void => {
    if (!policy) return;
    updatePolicy('directAccessAllowedIPs', policy.directAccessAllowedIPs.filter((i) => i !== ip));
  };

  if (!policy) {
    return <div className="settings-section"><p>{t('app.loading')}</p></div>;
  }

  return (
    <div className="settings-section">
      {/* Enable toggle */}
      <div className="settings-card">
        <div className="settings-row">
          <label className="settings-label settings-label--inline settings-label--title">
            {t('remote.enable')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(e) => updatePolicy('enabled', e.target.checked)}
              className="settings-checkbox"
            />
            <span className="text-base" style={{ color: policy.enabled ? 'var(--text-success)' : 'var(--text-tertiary)' }}>
              {policy.enabled ? t('remote.on') : t('remote.off')}
            </span>
          </label>
        </div>
      </div>

      {policy.enabled && (
        <>
          {/* Mode selector */}
          <div className="settings-card">
            <div className="settings-field-group">
              <label className="settings-label">{t('remote.mode')}</label>
              <select
                value={policy.mode}
                onChange={(e) => updatePolicy('mode', e.target.value as RemoteAccessPolicy['mode'])}
                className="settings-input settings-input--auto-min"
              >
                <option value="tailscale">{t('remote.modeTailscale')}</option>
                <option value="direct">{t('remote.modeDirect')}</option>
              </select>
            </div>

            {policy.mode === 'tailscale' && (
              <div style={{ marginTop: 12 }}>
                <div className="panel-header" style={{ marginBottom: 8 }}>
                  <h4 style={{ margin: 0 }}>{t('remote.tailscaleStatus')}</h4>
                  <button
                    className="btn-primary btn-primary--sm"
                    onClick={() => void refreshTailscaleStatus()}
                    disabled={tailscaleLoading}
                  >
                    {tailscaleLoading ? t('remote.tailscaleChecking') : t('remote.tailscaleRefresh')}
                  </button>
                </div>
                {tailscaleStatus === null && (
                  <p className="text-base" style={{ color: 'var(--text-tertiary)', margin: 0 }}>{t('remote.tailscaleChecking')}</p>
                )}
                {tailscaleStatus && !tailscaleStatus.installed && (
                  <div className="hint-box hint-box--danger-left">
                    <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{t('remote.tailscaleNotInstalled')}</p>
                    <p className="text-base" style={{ margin: 0, color: 'var(--text-tertiary)' }}>{t('remote.tailscaleInstallGuide')}</p>
                  </div>
                )}
                {tailscaleStatus && tailscaleStatus.installed && (
                  <div className="settings-card">
                    {tailscaleStatus.backendState && (
                      <div className="settings-row">
                        <span className="remote-status-label">{t('remote.tailscaleState')}</span>
                        <span className="remote-status-value" style={{
                          color: tailscaleStatus.backendState === 'Running' ? 'var(--text-success)' : 'var(--text-danger)',
                        }}>
                          {t(`remote.tailscaleState${tailscaleStatus.backendState}`)}
                        </span>
                      </div>
                    )}
                    {tailscaleStatus.version && (
                      <div className="settings-row">
                        <span className="remote-status-label">{t('remote.tailscaleVersion')}</span>
                        <code className="text-base">{tailscaleStatus.version}</code>
                      </div>
                    )}
                    {tailscaleStatus.selfIp && (
                      <div className="settings-row">
                        <span className="remote-status-label">{t('remote.tailscaleIp')}</span>
                        <code className="text-base">{tailscaleStatus.selfIp}</code>
                      </div>
                    )}
                    {tailscaleStatus.selfDnsName && (
                      <div className="settings-row">
                        <span className="remote-status-label">{t('remote.tailscaleDnsName')}</span>
                        <code className="text-base">{tailscaleStatus.selfDnsName}</code>
                      </div>
                    )}
                    {tailscaleStatus.onlinePeers !== undefined && (
                      <div className="settings-row">
                        <span className="remote-status-label">{t('remote.tailscaleOnlinePeers')}</span>
                        <span className="text-base">{tailscaleStatus.onlinePeers}</span>
                      </div>
                    )}
                    {tailscaleStatus.error && (
                      <div className="settings-row" style={{ color: 'var(--text-danger)' }}>
                        <span className="remote-status-label">{t('remote.tailscaleError')}</span>
                        <span className="text-base">{tailscaleStatus.error}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="hint-box" style={{ marginTop: 8 }}>
                  {t('remote.tailscaleHint')}
                </div>
              </div>
            )}
          </div>

          {/* Direct connection settings */}
          {policy.mode === 'direct' && (
            <div className="settings-card">
              <h4 style={{ margin: '0 0 12px' }}>{t('remote.directSettings')}</h4>

              <div className="settings-row">
                <label className="settings-label settings-label--inline settings-label--wide">{t('remote.port')}</label>
                <input
                  type="number"
                  className="settings-input settings-input--narrow-md"
                  value={policy.directAccessPort}
                  onChange={(e) => updatePolicy('directAccessPort', Number(e.target.value))}
                />
              </div>

              <div style={{ marginTop: 4, marginBottom: 4 }}>
                <div className="settings-row">
                  <label className="settings-label settings-label--inline settings-label--wide">{t('remote.bindAddress')}</label>
                  <input
                    type="text"
                    className="settings-input settings-input--med"
                    value={policy.bindAddress ?? ''}
                    onChange={(e) => updatePolicy('bindAddress', e.target.value || undefined)}
                    placeholder="127.0.0.1"
                  />
                </div>
                <div className="settings-hint settings-hint--indent">
                  {t('remote.bindAddressHint')}
                </div>
                {policy.bindAddress && wouldNeedTls(policy.bindAddress) && (
                  <div className="settings-hint settings-hint--indent" style={{ color: 'var(--text-success)' }}>
                    {t('remote.tlsAutoEnabled')}
                  </div>
                )}
                {policy.bindAddress === '0.0.0.0' && (
                  <div className="settings-hint settings-hint--indent" style={{ color: 'var(--text-danger)', fontWeight: 600 }}>
                    {t('remote.bindWarning')}
                  </div>
                )}
              </div>

              <div className="settings-row">
                <label className="settings-label settings-label--inline settings-label--wide">{t('remote.readOnly')}</label>
                <input
                  type="checkbox"
                  checked={policy.directAccessReadOnly}
                  onChange={(e) => updatePolicy('directAccessReadOnly', e.target.checked)}
                />
              </div>

              <div className="settings-row">
                <label className="settings-label settings-label--inline settings-label--wide">{t('remote.timeout')}</label>
                <input
                  type="number"
                  className="settings-input settings-input--narrow-md"
                  value={policy.directAccessSessionTimeoutMin}
                  onChange={(e) => updatePolicy('directAccessSessionTimeoutMin', Number(e.target.value))}
                />
                <span className="text-base" style={{ color: 'var(--text-tertiary)' }}>{t('remote.minutes')}</span>
              </div>

              {/* IP allowlist */}
              <div style={{ marginTop: 8 }}>
                <label className="settings-label">{t('remote.allowedIPs')}</label>
                {policy.directAccessAllowedIPs.map((ip) => (
                  <div key={ip} className="settings-row" style={{ marginBottom: 4 }}>
                    <code className="text-base">{ip}</code>
                    <button className="btn-danger" onClick={() => removeAllowedIp(ip)}>X</button>
                  </div>
                ))}
                <div className="action-buttons" style={{ justifyContent: 'flex-start', marginTop: 4 }}>
                  <input
                    className="settings-input settings-input--med"
                    value={newIp}
                    onChange={(e) => setNewIp(e.target.value)}
                    placeholder={t('remote.ipPlaceholder')}
                    onKeyDown={(e) => { if (e.key === 'Enter') addAllowedIp(); }}
                  />
                  <button
                    className="btn-primary btn-primary--md"
                    onClick={addAllowedIp}
                  >
                    {t('app.add')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Permission flags */}
          <div className="settings-card">
            <h4 style={{ margin: '0 0 12px' }}>{t('remote.permissions')}</h4>
            <div className="settings-row">
              <label className="settings-label settings-label--inline" style={{ flex: 1 }}>{t('remote.allowFileModification')}</label>
              <input
                type="checkbox"
                checked={policy.allowFileModification}
                onChange={(e) => updatePolicy('allowFileModification', e.target.checked)}
              />
            </div>
            <div className="settings-row">
              <label className="settings-label settings-label--inline" style={{ flex: 1 }}>{t('remote.allowCommandExecution')}</label>
              <input
                type="checkbox"
                checked={policy.allowCommandExecution}
                onChange={(e) => updatePolicy('allowCommandExecution', e.target.checked)}
              />
            </div>
          </div>

          {/* Server control */}
          <div className="settings-card">
            <h4 style={{ margin: '0 0 12px' }}>{t('remote.serverControl')}</h4>
            <div className="settings-row">
              <span className="text-base" style={{ color: 'var(--text-secondary)', flex: 1 }}>{t('remote.serverStatus')}</span>
              <span className={`server-status-badge ${serverRunning ? 'server-status-badge--running' : 'server-status-badge--stopped'}`}>
                {serverRunning ? t('remote.serverRunning') : t('remote.serverStopped')}
              </span>
            </div>
            <div className="action-buttons" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
              {!serverRunning ? (
                <button
                  className="btn-primary"
                  onClick={() => void handleStartServer()}
                  disabled={serverLoading}
                >
                  {serverLoading ? t('app.loading') : t('remote.startServer')}
                </button>
              ) : (
                <button
                  className="btn-danger"
                  onClick={() => void handleStopServer()}
                  disabled={serverLoading}
                >
                  {serverLoading ? t('app.loading') : t('remote.stopServer')}
                </button>
              )}
            </div>
          </div>

          {/* Token management */}
          <div className="settings-card">
            <h4 style={{ margin: '0 0 12px' }}>{t('remote.tokenManagement')}</h4>
            <p className="dialog-description">
              {t('remote.tokenDescription')}
            </p>

            <button
              className="btn-primary"
              style={{ marginBottom: 12 }}
              onClick={() => void handleGenerateToken()}
            >
              {t('remote.generateToken')}
            </button>

            {newToken && (
              <div className="token-display-box">
                <div className="text-md" style={{ color: 'var(--text-success)', fontWeight: 600, marginBottom: 4 }}>
                  {t('remote.tokenGenerated')}
                </div>
                <code className="token-code">
                  {newToken}
                </code>
                <div className="settings-save-row">
                  <button
                    className="btn-primary btn-primary--sm"
                    onClick={() => void handleCopyToken()}
                  >
                    {t('remote.copyToken')}
                  </button>
                  {tokenCopied && <span className="text-md" style={{ color: 'var(--text-success)' }}>{t('remote.tokenCopied')}</span>}
                </div>
                <div className="text-sm" style={{ color: 'var(--text-danger)', marginTop: 8 }}>
                  {t('remote.tokenWarning')}
                </div>
              </div>
            )}

            {/* Grants list */}
            {grants.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="text-base" style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 8 }}>
                  {t('remote.activeTokens')} ({grants.length})
                </div>
                {grants.map((grant) => (
                  <div key={grant.grantId} className="settings-row grant-row">
                    <div>
                      <code className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                        {grant.tokenHash.slice(0, 12)}...
                      </code>
                      <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {new Date(grant.createdAt).toLocaleString()}
                        {grant.lastUsedAt && ` / ${t('remote.lastUsed')}: ${new Date(grant.lastUsedAt).toLocaleString()}`}
                      </div>
                    </div>
                    <button
                      className="btn-danger"
                      onClick={() => void handleRevokeGrant(grant.grantId)}
                    >
                      {t('remote.revokeToken')}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {grants.length === 0 && (
              <p className="text-base" style={{ color: 'var(--text-tertiary)', margin: 0 }}>{t('remote.noTokens')}</p>
            )}
          </div>

          {/* Active sessions */}
          <div className="settings-card">
            <h4 style={{ margin: '0 0 12px' }}>
              {t('remote.activeSessions')} ({sessions.length})
            </h4>
            {sessions.length === 0 && (
              <p className="text-base" style={{ color: 'var(--text-tertiary)', margin: 0 }}>{t('remote.noSessions')}</p>
            )}
            {sessions.map((session) => (
              <div key={session.sessionId} className="settings-row session-row">
                <div>
                  <div className="text-base">
                    <strong>{session.mode}</strong>
                    {session.remoteIp && <span style={{ color: 'var(--text-tertiary)' }}> — {session.remoteIp}</span>}
                  </div>
                  <div className="text-md" style={{ color: 'var(--text-tertiary)' }}>
                    {t('remote.connectedAt')}: {new Date(session.connectedAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Save button */}
          <div className="settings-save-row">
            <button className="btn-primary" onClick={() => void handleSave()}>
              {t('app.save')}
            </button>
            {saved && <span className="settings-saved-msg">{t('settings.saved')}</span>}
          </div>
        </>
      )}

      {!policy.enabled && (
        <div className="settings-save-row">
          <button className="btn-primary" onClick={() => void handleSave()}>
            {t('app.save')}
          </button>
          {saved && <span className="settings-saved-msg">{t('settings.saved')}</span>}
        </div>
      )}
    </div>
  );
}
