/**
 * TLS utility for conditional HTTPS on the remote access server.
 *
 * - Determines whether TLS is needed based on bind address.
 * - Generates self-signed ECDSA P-256 certificates using pure Node.js.
 * - Caches certificates on disk and reuses them until expiry.
 */

import { generateKeyPairSync, createSign, X509Certificate, randomFillSync } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// ── needsTls ────────────────────────────────────────────────────────

/**
 * Determines whether the given bind address requires TLS.
 *
 * | Bind address               | TLS? | Reason                         |
 * |----------------------------|------|--------------------------------|
 * | 127.0.0.1 / ::1            | no   | Loopback — no external eavesdrop |
 * | 100.64.0.0/10 (Tailscale)  | no   | WireGuard already encrypts     |
 * | Everything else             | yes  | Plaintext token exposure risk  |
 */
export function needsTls(host: string): boolean {
  // Loopback
  if (host === '127.0.0.1' || host === '::1') {
    return false;
  }

  // Tailscale CGNAT range: 100.64.0.0/10 → 100.64.0.0 – 100.127.255.255
  if (isTailscaleCgnat(host)) {
    return false;
  }

  return true;
}

/**
 * Checks whether an IPv4 address falls within the Tailscale CGNAT range
 * (100.64.0.0/10 → first octet 100, second octet 64–127).
 */
function isTailscaleCgnat(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;

  const [a, b] = parts.map(Number);
  if (a !== 100) return false;

  // /10 mask: second octet must have the top 2 bits = 01 (64–127)
  return b >= 64 && b <= 127;
}

// ── Self-signed certificate generation (pure Node.js) ───────────────

/** Result of certificate generation. */
export interface CertKeyPair {
  cert: string;
  key: string;
}

/**
 * Generates a self-signed ECDSA P-256 certificate (1-year validity).
 *
 * Uses raw ASN.1 DER construction → no external dependencies.
 */
export function generateSelfSignedCert(): CertKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });

  // Export the public key in DER (SPKI) format for embedding in the cert
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });

  // Export the private key as PEM for the server
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  const now = new Date();
  const notBefore = now;
  const notAfter = new Date(now);
  notAfter.setFullYear(notAfter.getFullYear() + 1);

  // Build TBSCertificate
  const tbs = buildTbsCertificate(spkiDer, notBefore, notAfter);

  // Sign the TBS with ECDSA + SHA-256
  const signer = createSign('SHA256');
  signer.update(tbs);
  const signature = signer.sign(privateKey);

  // Wrap into Certificate sequence
  const certDer = buildCertificate(tbs, signature);

  // Convert to PEM
  const certPem = derToPem(certDer, 'CERTIFICATE');

  return { cert: certPem, key: keyPem };
}

// ── Certificate caching ─────────────────────────────────────────────

const CERT_FILENAME = 'self-signed.crt';
const KEY_FILENAME = 'self-signed.key';

/**
 * Returns a cached certificate from `certsDir`, or generates a new one
 * if none exists or the existing one has expired.
 */
export async function getOrCreateCert(certsDir: string): Promise<CertKeyPair> {
  const certPath = path.join(certsDir, CERT_FILENAME);
  const keyPath = path.join(certsDir, KEY_FILENAME);

  // Try reading existing cert
  try {
    const [certPem, keyPem] = await Promise.all([
      readFile(certPath, 'utf-8'),
      readFile(keyPath, 'utf-8'),
    ]);

    // Verify not expired
    const x509 = new X509Certificate(certPem);
    const validTo = new Date(x509.validTo);
    if (validTo > new Date()) {
      return { cert: certPem, key: keyPem };
    }
    // Expired — fall through to regenerate
  } catch {
    // Files don't exist — fall through to generate
  }

  // Generate fresh cert
  const pair = generateSelfSignedCert();

  // Persist
  await mkdir(certsDir, { recursive: true });
  await Promise.all([
    writeFile(certPath, pair.cert, 'utf-8'),
    writeFile(keyPath, pair.key, { encoding: 'utf-8', mode: 0o600 }),
  ]);

  return pair;
}

// ── ASN.1 DER builder helpers ───────────────────────────────────────

/** ASN.1 tag constants. */
const ASN1 = {
  SEQUENCE: 0x30,
  SET: 0x31,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OBJECT_IDENTIFIER: 0x06,
  UTF8_STRING: 0x0c,
  UTC_TIME: 0x17,
  CONTEXT_EXPLICIT_0: 0xa0,
} as const;

/** Known OIDs in DER-encoded form. */
const OID = {
  // ecdsaWithSHA256 (1.2.840.10045.4.3.2)
  ecdsaWithSha256: Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]),
  // commonName (2.5.4.3)
  commonName: Buffer.from([0x55, 0x04, 0x03]),
};

/** Wraps content in a TLV (tag-length-value) structure. */
function tlv(tag: number, content: Buffer): Buffer {
  const length = encodeLength(content.length);
  return Buffer.concat([Buffer.from([tag]), length, content]);
}

/** Encodes an ASN.1 length in DER format. */
function encodeLength(len: number): Buffer {
  if (len < 0x80) {
    return Buffer.from([len]);
  }
  // Determine how many bytes needed
  const bytes: number[] = [];
  let remaining = len;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** Encodes a non-negative integer as ASN.1 INTEGER. */
function asn1Integer(value: number | Buffer): Buffer {
  let content: Buffer;
  if (typeof value === 'number') {
    if (value === 0) {
      content = Buffer.from([0]);
    } else {
      const bytes: number[] = [];
      let v = value;
      while (v > 0) {
        bytes.unshift(v & 0xff);
        v >>= 8;
      }
      // Prepend 0x00 if high bit set (to indicate positive number)
      if (bytes[0] & 0x80) bytes.unshift(0);
      content = Buffer.from(bytes);
    }
  } else {
    // Buffer — ensure positive encoding
    content = value[0] & 0x80
      ? Buffer.concat([Buffer.from([0]), value])
      : value;
  }
  return tlv(ASN1.INTEGER, content);
}

/** Encodes a date as ASN.1 UTCTime (YYMMDDHHmmssZ). */
function asn1UtcTime(date: Date): Buffer {
  const yy = String(date.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  const str = `${yy}${mm}${dd}${hh}${min}${ss}Z`;
  return tlv(ASN1.UTC_TIME, Buffer.from(str, 'ascii'));
}

/** Encodes an OID as an ASN.1 OBJECT IDENTIFIER. */
function asn1Oid(oidBytes: Buffer): Buffer {
  return tlv(ASN1.OBJECT_IDENTIFIER, oidBytes);
}

/** Builds the AlgorithmIdentifier for ecdsaWithSHA256. */
function algorithmIdentifier(): Buffer {
  return tlv(ASN1.SEQUENCE, asn1Oid(OID.ecdsaWithSha256));
}

/** Builds an X.500 Name with a single CN attribute. */
function rdnSequence(cn: string): Buffer {
  const atv = tlv(
    ASN1.SEQUENCE,
    Buffer.concat([
      asn1Oid(OID.commonName),
      tlv(ASN1.UTF8_STRING, Buffer.from(cn, 'utf-8')),
    ]),
  );
  const rdn = tlv(ASN1.SET, atv);
  return tlv(ASN1.SEQUENCE, rdn);
}

/** Builds the TBSCertificate DER structure. */
function buildTbsCertificate(
  spkiDer: Buffer,
  notBefore: Date,
  notAfter: Date,
): Buffer {
  // version: [0] EXPLICIT INTEGER { v3(2) }
  const version = tlv(ASN1.CONTEXT_EXPLICIT_0, asn1Integer(2));

  // serialNumber — use a random 16-byte positive integer
  const serialBytes = Buffer.alloc(16);
  randomFillSync(serialBytes);
  serialBytes[0] &= 0x7f; // Ensure positive
  if (serialBytes[0] === 0) serialBytes[0] = 0x01; // Ensure non-zero leading byte
  const serial = asn1Integer(serialBytes);

  const sigAlg = algorithmIdentifier();
  const issuer = rdnSequence('AI Chat Arena Self-Signed');
  const validity = tlv(
    ASN1.SEQUENCE,
    Buffer.concat([asn1UtcTime(notBefore), asn1UtcTime(notAfter)]),
  );
  const subject = issuer; // Self-signed: issuer === subject
  // SubjectPublicKeyInfo is already DER-encoded from the export
  const subjectPublicKeyInfo = spkiDer;

  return tlv(
    ASN1.SEQUENCE,
    Buffer.concat([
      version,
      serial,
      sigAlg,
      issuer,
      validity,
      subject,
      subjectPublicKeyInfo,
    ]),
  );
}

/** Wraps TBS + signature into the final Certificate DER structure. */
function buildCertificate(tbs: Buffer, signature: Buffer): Buffer {
  const sigAlg = algorithmIdentifier();
  // BIT STRING: prepend a 0x00 byte for "unused bits" count
  const sigBits = tlv(ASN1.BIT_STRING, Buffer.concat([Buffer.from([0]), signature]));

  return tlv(ASN1.SEQUENCE, Buffer.concat([tbs, sigAlg, sigBits]));
}

/** Converts DER bytes to PEM format. */
function derToPem(der: Buffer, label: string): string {
  const b64 = der.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}
