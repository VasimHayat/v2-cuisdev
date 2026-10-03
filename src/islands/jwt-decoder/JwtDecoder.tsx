/**
 * JWT Decoder workspace: paste a token, see the colour-coded segments, the header and
 * payload as JSON with a claims table (dates resolved, expiry judged), and verify HS256,
 * HS384 or HS512 signatures with a secret using WebCrypto. Nothing leaves the browser.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { json } from '@codemirror/lang-json';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, toast, track } from '../shared/toast';
import {
  JwtError,
  SAMPLE_SECRET,
  SAMPLE_TOKEN,
  decodeJwt,
  describeClaims,
  describeHeader,
  getTiming,
  isHmacAlg,
  normalizeToken,
  signHmac,
  summarize,
  verifyHmac,
  type ClaimRow,
  type DecodedJwt,
} from './logic';

const TOOL = 'jwt-decoder';
const DRAFT_KEY = 'cuis-jwt:draft';
type View = 'claims' | 'json';

export default function JwtDecoder() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      return sessionStorage.getItem(DRAFT_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [decoded, setDecoded] = useState<DecodedJwt | null>(null);
  const [error, setError] = useState<JwtError | null>(null);
  const [view, setView] = useState<View>('claims');
  const [secret, setSecret] = useState('');
  const [secretB64, setSecretB64] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [verify, setVerify] = useState<{ state: 'idle' | 'valid' | 'invalid' | 'error'; message?: string }>({ state: 'idle' });
  const [now, setNow] = useState(() => Date.now());
  const [full, setFull] = useState(false);

  // Keep relative times fresh
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Decode as you type (session-only draft: tokens are sensitive)
  useEffect(() => {
    try {
      if (token) sessionStorage.setItem(DRAFT_KEY, token);
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {}
    const t = setTimeout(() => {
      if (normalizeToken(token) === '') {
        setDecoded(null);
        setError(null);
        setVerify({ state: 'idle' });
        return;
      }
      try {
        setDecoded(decodeJwt(token));
        setError(null);
        setNow(Date.now());
      } catch (err) {
        setDecoded(null);
        setError(err instanceof JwtError ? err : new JwtError(String(err)));
      }
      setVerify({ state: 'idle' });
    }, 120);
    return () => clearTimeout(t);
  }, [token]);

  // Verify automatically when a secret is present and the alg is HMAC
  useEffect(() => {
    if (!decoded || !secret) {
      if (!secret) setVerify({ state: 'idle' });
      return;
    }
    if (!isHmacAlg(decoded.header.alg)) {
      setVerify({ state: 'error', message: describeNonHmac(decoded.header.alg) });
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const ok = await verifyHmac(token, secret, secretB64);
        if (!cancelled) setVerify({ state: ok ? 'valid' : 'invalid' });
      } catch (err) {
        if (!cancelled) setVerify({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [decoded, secret, secretB64, token]);

  const claims = useMemo(() => (decoded ? describeClaims(decoded.payload, now) : []), [decoded, now]);
  const headerRows = useMemo(() => (decoded ? describeHeader(decoded.header) : []), [decoded]);
  const summary = useMemo(() => (decoded ? summarize(decoded, now) : null), [decoded, now]);
  const timing = decoded ? getTiming(decoded.payload, now) : null;
  const normalized = normalizeToken(token);

  // ------------------------------------------------------------------ actions

  const loadSample = () => {
    setToken(SAMPLE_TOKEN);
    setSecret(SAMPLE_SECRET);
    setSecretB64(false);
    track('tool_action', { tool: TOOL, action: 'sample' });
  };

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text);
    toast(ok ? `${what} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', what });
  };

  const resign = async () => {
    if (!decoded || !secret) return;
    try {
      const t = await signHmac(decoded.header, decoded.payload, secret, secretB64);
      await copyText(t);
      toast('Token re-signed with this secret and copied');
      track('tool_action', { tool: TOOL, action: 'resign' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not sign', 'error', 4000);
    }
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && full) setFull(false);
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    document.body.style.overflow = full ? 'hidden' : '';
    const el = rootRef.current;
    if (full && el && document.fullscreenEnabled && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    else if (!full && el && document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
    return () => {
      document.body.style.overflow = '';
    };
  }, [full]);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const segs = normalized.split('.');

  return (
    <div
      ref={rootRef}
      class={'flex flex-col bg-surface-2 text-ink ' + (full ? 'fixed inset-0 z-[60] h-screen w-screen overflow-auto p-2' : 'relative rounded-xl border border-line-strong p-2 shadow-sm')}
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <span class="text-xs text-ink-2">Paste a token or an Authorization header. Decoding happens locally.</span>
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={loadSample} title="Load an example token and its secret">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button
            type="button"
            class="btn-ghost btn-sm"
            onClick={() => {
              setToken('');
              setSecret('');
            }}
            disabled={!token && !secret}
            title="Clear the token and secret"
          >
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      <div class="grid gap-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Token */}
        <section class="flex min-h-[220px] flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Encoded token">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Encoded token</span>
            <span class="ml-2 text-ink-3">{normalized ? `${normalized.length} chars` : ''}</span>
            <span class="flex-1" />
            <HeaderButton icon="copy" title="Copy the normalised token" onClick={() => void copy(normalized, 'Token')} disabled={!normalized} />
          </header>
          <textarea
            class="min-h-[140px] flex-1 resize-none bg-surface p-3 font-mono text-[12.5px] leading-6 text-ink outline-none placeholder:text-ink-3"
            value={token}
            onInput={(e) => setToken((e.currentTarget as HTMLTextAreaElement).value)}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature"
            spellcheck={false}
            autocomplete="off"
            aria-label="JWT to decode"
          />
          {decoded && segs.length === 3 && (
            <div class="break-all border-t border-line bg-surface-2 p-3 font-mono text-[12px] leading-5" aria-label="Token segments" title="Header . Payload . Signature">
              <span class="text-danger">{segs[0]}</span>
              <span class="text-ink-3">.</span>
              <span class="text-brand-600 dark:text-brand-400">{segs[1]}</span>
              <span class="text-ink-3">.</span>
              <span class="text-success">{segs[2] || <em class="not-italic text-ink-3">(no signature)</em>}</span>
            </div>
          )}

          {/* Signature */}
          <div class="border-t border-line p-3 text-sm">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs font-semibold uppercase tracking-wide text-ink-3">Verify signature</span>
              {decoded && (
                <span class="font-mono text-xs text-ink-2">{typeof decoded.header.alg === 'string' ? decoded.header.alg : 'no alg'}</span>
              )}
            </div>
            <div class="flex gap-2">
              <input
                type={showSecret ? 'text' : 'password'}
                class="input h-8 flex-1 font-mono text-xs"
                value={secret}
                onInput={(e) => setSecret((e.currentTarget as HTMLInputElement).value)}
                placeholder={decoded && !isHmacAlg(decoded.header.alg) ? 'Only HS256 / HS384 / HS512 can be verified here' : 'Shared secret (HS256 / HS384 / HS512)'}
                disabled={!decoded || !isHmacAlg(decoded.header.alg)}
                autocomplete="off"
                spellcheck={false}
                aria-label="Shared secret"
              />
              <HeaderButton icon={showSecret ? 'eye-off' : 'eye'} title={showSecret ? 'Hide secret' : 'Show secret'} onClick={() => setShowSecret((s) => !s)} />
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <Chip on={secretB64} onClick={() => setSecretB64((v) => !v)} title="The secret is base64 encoded (decode it before use)">
                Secret is base64
              </Chip>
              <button type="button" class="btn-secondary btn-sm" onClick={() => void resign()} disabled={!decoded || !secret || !isHmacAlg(decoded.header.alg)} title="Sign the decoded header and payload with this secret and copy the token">
                <Icon name="pencil" size={13} /> Re-sign and copy
              </button>
              <span class="flex-1" />
              {verify.state === 'valid' && (
                <span class="badge border-success/40 bg-success/10 text-success">
                  <Icon name="check" size={11} class="mr-1" /> Signature valid
                </span>
              )}
              {verify.state === 'invalid' && (
                <span class="badge border-danger/40 bg-danger/10 text-danger">
                  <Icon name="x" size={11} class="mr-1" /> Signature does not match
                </span>
              )}
            </div>
            {verify.state === 'error' && <p class="mt-2 text-xs text-warning">{verify.message}</p>}
          </div>
        </section>

        {/* Decoded */}
        <section class="flex min-h-[220px] flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Decoded token">
          <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Decoded</span>
            {summary && (
              <span class={'badge ' + (summary.tone === 'ok' ? 'border-success/40 bg-success/10 text-success' : summary.tone === 'warn' ? 'border-warning/50 bg-warning/10 text-ink-2' : 'border-danger/40 bg-danger/10 text-danger')}>{summary.text}</span>
            )}
            <span class="flex-1" />
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'claims', label: 'Claims', icon: 'list-tree' },
                { value: 'json', label: 'JSON', icon: 'file-json' },
              ]}
              label="Decoded view"
            />
          </header>

          {!decoded ? (
            <div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm">
              {error ? (
                <>
                  <Icon name="alert-circle" size={24} class="text-danger" />
                  <p class="max-w-md text-danger">{error.message}</p>
                  <p class="text-xs text-ink-3">Problem in: {error.part}</p>
                </>
              ) : (
                <>
                  <Icon name="key" size={26} class="text-ink-3/70" />
                  <p class="text-ink-3">Paste a JWT on the left to see its header, claims and expiry.</p>
                  <button type="button" class="btn-secondary btn-sm mt-1" onClick={loadSample}>
                    Try the sample
                  </button>
                </>
              )}
            </div>
          ) : view === 'json' ? (
            <div class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
              <SubHeader label="Header" color="text-danger" onCopy={() => void copy(decoded.headerJson, 'Header')} />
              <CodeEditor value={decoded.headerJson} readOnly language={json()} wrap ariaLabel="Header JSON" class="min-h-[96px]" />
              <SubHeader label="Payload" color="text-brand-600 dark:text-brand-400" onCopy={() => void copy(decoded.payloadJson, 'Payload')} />
              <CodeEditor value={decoded.payloadJson} readOnly language={json()} wrap ariaLabel="Payload JSON" class="min-h-[160px]" />
            </div>
          ) : (
            <div class="scrollbar-thin min-h-0 flex-1 overflow-auto">
              <SubHeader label="Header" color="text-danger" onCopy={() => void copy(decoded.headerJson, 'Header')} />
              <ClaimTable rows={headerRows} />
              <SubHeader label="Payload" color="text-brand-600 dark:text-brand-400" onCopy={() => void copy(decoded.payloadJson, 'Payload')} />
              <ClaimTable rows={claims} />
              {timing && (timing.expired || timing.notYetValid) && (
                <p class="m-3 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
                  {timing.expired ? 'This token has expired; servers should reject it.' : 'This token is not valid yet (nbf is in the future).'}
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">Tokens are decoded and verified in this browser tab and kept only for this session. Nothing is sent anywhere.</span>
        <span class="hidden shrink-0 sm:inline">Times shown in UTC and relative to now</span>
      </div>
    </div>
  );
}

function SubHeader(p: { label: string; color: string; onCopy: () => void }) {
  return (
    <div class="flex h-8 items-center gap-1 border-b border-t border-line bg-surface-2 pl-3 pr-1 text-xs first:border-t-0">
      <span class={'font-semibold ' + p.color}>{p.label}</span>
      <span class="flex-1" />
      <HeaderButton icon="copy" title={`Copy ${p.label.toLowerCase()} JSON`} onClick={p.onCopy} />
    </div>
  );
}

function ClaimTable({ rows }: { rows: ClaimRow[] }) {
  if (rows.length === 0) return <p class="p-3 text-xs text-ink-3">Empty object.</p>;
  return (
    <table class="w-full text-left text-[13px]">
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} class="border-b border-line align-top last:border-b-0">
            <th scope="row" class="w-[6.5rem] px-3 py-1.5 font-mono text-xs font-medium text-brand-700 dark:text-brand-300">
              {r.name}
            </th>
            <td class="px-2 py-1.5">
              <div class="break-all font-mono text-xs text-ink">{r.value}</div>
              {r.date && (
                <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
                  <span>{r.date.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}</span>
                  <span class="text-ink-3">· {r.relative}</span>
                  {r.status === 'expired' && <span class="badge border-danger/40 bg-danger/10 text-danger">expired</span>}
                  {r.status === 'not-yet-valid' && <span class="badge border-warning/50 bg-warning/10 text-ink-2">not yet valid</span>}
                  {r.status === 'ok' && r.name === 'exp' && <span class="badge border-success/40 bg-success/10 text-success">valid</span>}
                </div>
              )}
              {r.meaning && <div class="mt-0.5 text-xs text-ink-3">{r.meaning}</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function describeNonHmac(alg: unknown): string {
  if (alg === 'none') return 'This token is unsigned (alg none). There is no signature to verify; reject such tokens in production.';
  const shown = typeof alg === 'string' ? alg : 'missing';
  return `${shown} tokens are signed with a private key and need the issuer's public key to verify. Only HS256, HS384 and HS512 can be checked with a shared secret here.`;
}
