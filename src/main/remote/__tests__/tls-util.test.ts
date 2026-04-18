import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { needsTls, generateSelfSignedCert, getOrCreateCert } from '../tls-util';

// ── needsTls ────────────────────────────────────────────────────────

describe('needsTls', () => {
  it('returns false for 127.0.0.1 (IPv4 loopback)', () => {
    expect(needsTls('127.0.0.1')).toBe(false);
  });

  it('returns false for ::1 (IPv6 loopback)', () => {
    expect(needsTls('::1')).toBe(false);
  });

  it('returns false for Tailscale CGNAT addresses (100.64–127.x.x)', () => {
    expect(needsTls('100.64.0.1')).toBe(false);
    expect(needsTls('100.100.1.1')).toBe(false);
    expect(needsTls('100.127.255.255')).toBe(false);
  });

  it('returns true for addresses outside Tailscale CGNAT', () => {
    expect(needsTls('100.63.1.1')).toBe(true);   // Below range
    expect(needsTls('100.128.1.1')).toBe(true);   // Above range
  });

  it('returns true for LAN IP addresses', () => {
    expect(needsTls('192.168.1.5')).toBe(true);
    expect(needsTls('10.0.0.1')).toBe(true);
  });

  it('returns true for 0.0.0.0 (all interfaces)', () => {
    expect(needsTls('0.0.0.0')).toBe(true);
  });
});

// ── generateSelfSignedCert ──────────────────────────────────────────

describe('generateSelfSignedCert', () => {
  it('returns cert and key in PEM format', () => {
    const { cert, key } = generateSelfSignedCert();
    expect(cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(cert).toContain('-----END CERTIFICATE-----');
    expect(key).toContain('-----BEGIN PRIVATE KEY-----');
    expect(key).toContain('-----END PRIVATE KEY-----');
  });

  it('produces a valid X509Certificate', () => {
    const { cert } = generateSelfSignedCert();
    const x509 = new X509Certificate(cert);
    expect(x509.subject).toContain('CN=AI Chat Arena Self-Signed');
    expect(x509.issuer).toContain('CN=AI Chat Arena Self-Signed');
  });

  it('has validity period of ~1 year', () => {
    const { cert } = generateSelfSignedCert();
    const x509 = new X509Certificate(cert);
    const from = new Date(x509.validFrom).getTime();
    const to = new Date(x509.validTo).getTime();
    const diffDays = (to - from) / (1000 * 60 * 60 * 24);
    // Approximately 365 days (±2 for leap year / rounding)
    expect(diffDays).toBeGreaterThanOrEqual(363);
    expect(diffDays).toBeLessThanOrEqual(367);
  });
});

// ── getOrCreateCert ─────────────────────────────────────────────────

describe('getOrCreateCert', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'tls-util-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates cert files when none exist', async () => {
    const certsDir = path.join(tmpDir, 'certs');
    const pair = await getOrCreateCert(certsDir);

    expect(pair.cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(pair.key).toContain('-----BEGIN PRIVATE KEY-----');

    // Verify files were written
    const savedCert = await readFile(path.join(certsDir, 'self-signed.crt'), 'utf-8');
    const savedKey = await readFile(path.join(certsDir, 'self-signed.key'), 'utf-8');
    expect(savedCert).toBe(pair.cert);
    expect(savedKey).toBe(pair.key);
  });

  it('reuses cached cert on second call', async () => {
    const certsDir = path.join(tmpDir, 'certs');
    const first = await getOrCreateCert(certsDir);
    const second = await getOrCreateCert(certsDir);

    // Same cert and key (cached)
    expect(second.cert).toBe(first.cert);
    expect(second.key).toBe(first.key);
  });
});
