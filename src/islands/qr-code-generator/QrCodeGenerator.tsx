/**
 * QR Code Generator: content forms for URL, text, Wi-Fi, email, phone, SMS, vCard and
 * location; error correction, margin, colours, module style and an optional centre
 * logo; live SVG preview with SVG and PNG downloads. `qrcode` builds the matrix and is
 * loaded on first use; drawing is ours (see logic.ts). Wi-Fi passwords stay in memory.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/icons';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import {
  DEFAULT_DESIGN,
  EMPTY_CONTENT,
  MAX_LOGO_SCALE,
  buildPayload,
  capacity,
  contentWarning,
  draftToStore,
  parseDraft,
  renderSvg,
  scanWarning,
  type Content,
  type ContentType,
  type Design,
  type Ecl,
  type Matrix,
  type ModuleStyle,
} from './logic';

const TOOL = 'qr-code-generator';
const DRAFT_KEY = 'cuis-qr:draft';

type QrLib = typeof import('qrcode');
let libPromise: Promise<QrLib> | undefined;
const loadLib = () => (libPromise ??= import('qrcode').then((m) => ((m as unknown as { default?: QrLib }).default ?? m) as QrLib));

const TYPES: { value: ContentType; label: string }[] = [
  { value: 'url', label: 'URL' },
  { value: 'text', label: 'Text' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'sms', label: 'SMS' },
  { value: 'vcard', label: 'Contact' },
  { value: 'geo', label: 'Location' },
];

function loadDraft() {
  try {
    return parseDraft(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'));
  } catch {
    return { content: EMPTY_CONTENT, design: DEFAULT_DESIGN };
  }
}

interface Built {
  matrix: Matrix;
  version: number;
}

export default function QrCodeGenerator() {
  const initial = useMemo(loadDraft, []);
  const [content, setContent] = useState<Content>(initial.content);
  const [design, setDesign] = useState<Design>(initial.design);
  const [logo, setLogo] = useState<string | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);

  const patch = <K extends keyof Content>(key: K, value: Content[K]) => setContent((c) => ({ ...c, [key]: value }));
  const setD = (p: Partial<Design>) => setDesign((d) => ({ ...d, ...p }));

  // Save the draft without the Wi-Fi password.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draftToStore(content, design)));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [content, design]);

  const payload = useMemo(() => buildPayload(content), [content]);
  const ecl: Ecl = logo ? 'H' : design.ecl;
  const cap = capacity(payload, ecl);
  const warning = contentWarning(content);
  const colorWarning = scanWarning(design.fg, design.bg);

  // Build the matrix
  useEffect(() => {
    if (!payload) {
      setBuilt(null);
      setError(null);
      return;
    }
    if (cap.level === 'over') {
      setBuilt(null);
      setError(`Too much data: ${cap.bytes.toLocaleString('en-US')} bytes, the limit at error correction ${ecl} is ${cap.max.toLocaleString('en-US')}.`);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const lib = await loadLib();
        const qr = lib.create(payload, { errorCorrectionLevel: ecl });
        if (!cancelled) {
          setBuilt({ matrix: { size: qr.modules.size, get: (r, c) => qr.modules.get(r, c) }, version: qr.version });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setBuilt(null);
          setError(err instanceof Error ? err.message : 'Could not build the code.');
        }
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [payload, ecl, cap.level, cap.bytes, cap.max]);

  const svg = useMemo(() => (built ? renderSvg(built.matrix, { margin: design.margin, fg: design.fg, bg: design.bg, style: design.style, logo, logoScale: design.logoScale }) : ''), [built, design, logo]);
  const svgUrl = useMemo(() => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : ''), [svg]);

  // ------------------------------------------------------------------ actions

  const toPng = (px: number): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = px;
        canvas.height = px;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas is not available.'));
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, px, px);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png');
      };
      img.onerror = () => reject(new Error('Could not render the code.'));
      img.src = svgUrl;
    });

  const fileBase = () => `qr-${content.type}`;

  const downloadSvg = () => {
    if (!svg) return;
    downloadText(svg, `${fileBase()}.svg`, 'image/svg+xml');
    track('tool_action', { tool: TOOL, action: 'download_svg', type: content.type });
  };

  const downloadPng = async (px: number) => {
    if (!svg) return;
    try {
      const blob = await toPng(px);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileBase()}-${px}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      track('tool_action', { tool: TOOL, action: 'download_png', size: px, type: content.type });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Download failed', 'error');
    }
  };

  const copyPng = async () => {
    if (!svg) return;
    try {
      if (!('ClipboardItem' in window) || !navigator.clipboard?.write) throw new Error('This browser cannot copy images.');
      const blob = await toPng(1024);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('PNG copied');
      track('tool_action', { tool: TOOL, action: 'copy_png' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Copy failed', 'error');
    }
  };

  const pickLogo = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast('Choose an image file for the logo', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast('Logo images must be under 2 MB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
    track('tool_action', { tool: TOOL, action: 'logo' });
  };

  const reset = () => {
    setContent(EMPTY_CONTENT);
    setDesign(DEFAULT_DESIGN);
    setLogo(null);
  };

  // ------------------------------------------------------------------ render

  return (
    <div class="flex flex-col bg-surface-2 text-ink relative min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <div class="flex min-w-0 flex-wrap gap-1" role="radiogroup" aria-label="Content type">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={content.type === t.value}
              class={'rounded-md border px-2.5 py-1 text-[13px] font-medium ' + (content.type === t.value ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-3')}
              onClick={() => patch('type', t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span class="flex-1" />
        <button type="button" class="btn-ghost btn-sm" onClick={reset} title="Clear everything">
          <Icon name="eraser" size={14} /> Reset
        </button>
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        {/* Content and design */}
        <section class="flex min-w-0 flex-col gap-4 rounded-lg border border-line-strong bg-surface p-4 text-sm" aria-label="Content and design">
          <div class="space-y-3">
            {content.type === 'url' && <Field label="Website address"><input class="input" value={content.url} onInput={(e) => patch('url', val(e))} placeholder="https://example.com" inputMode="url" /></Field>}
            {content.type === 'text' && (
              <Field label="Text">
                <textarea class="input h-28 resize-y py-2" value={content.text} onInput={(e) => patch('text', val(e))} placeholder="Any text, up to about 2,000 characters" />
              </Field>
            )}
            {content.type === 'wifi' && (
              <>
                <Field label="Network name (SSID)"><input class="input" value={content.wifi.ssid} onInput={(e) => patch('wifi', { ...content.wifi, ssid: val(e) })} autocomplete="off" /></Field>
                <Field label="Security" group>
                  <Segmented
                    value={content.wifi.security}
                    onChange={(security) => patch('wifi', { ...content.wifi, security })}
                    options={[
                      { value: 'WPA', label: 'WPA/WPA2/WPA3' },
                      { value: 'WEP', label: 'WEP' },
                      { value: 'nopass', label: 'None' },
                    ]}
                    label="Security"
                  />
                </Field>
                {content.wifi.security !== 'nopass' && (
                  <Field label="Password (kept in this tab only, never saved)">
                    <div class="flex gap-1">
                      <input class="input flex-1" type={showPass ? 'text' : 'password'} value={content.wifi.password} onInput={(e) => patch('wifi', { ...content.wifi, password: val(e) })} autocomplete="off" />
                      <HeaderButton icon={showPass ? 'eye-off' : 'eye'} title={showPass ? 'Hide' : 'Show'} onClick={() => setShowPass((s) => !s)} />
                    </div>
                  </Field>
                )}
                <Chip on={content.wifi.hidden} onClick={() => patch('wifi', { ...content.wifi, hidden: !content.wifi.hidden })}>
                  Hidden network
                </Chip>
              </>
            )}
            {content.type === 'email' && (
              <>
                <Field label="To"><input class="input" value={content.email.to} onInput={(e) => patch('email', { ...content.email, to: val(e) })} inputMode="email" placeholder="name@example.com" /></Field>
                <Field label="Subject"><input class="input" value={content.email.subject} onInput={(e) => patch('email', { ...content.email, subject: val(e) })} /></Field>
                <Field label="Message"><textarea class="input h-20 resize-y py-2" value={content.email.body} onInput={(e) => patch('email', { ...content.email, body: val(e) })} /></Field>
              </>
            )}
            {content.type === 'phone' && <Field label="Phone number"><input class="input" value={content.phone} onInput={(e) => patch('phone', val(e))} inputMode="tel" placeholder="+44 20 7946 0000" /></Field>}
            {content.type === 'sms' && (
              <>
                <Field label="Phone number"><input class="input" value={content.sms.phone} onInput={(e) => patch('sms', { ...content.sms, phone: val(e) })} inputMode="tel" /></Field>
                <Field label="Message"><textarea class="input h-20 resize-y py-2" value={content.sms.message} onInput={(e) => patch('sms', { ...content.sms, message: val(e) })} /></Field>
              </>
            )}
            {content.type === 'vcard' && (
              <div class="grid grid-cols-2 gap-2">
                {(
                  [
                    ['firstName', 'First name', 'text'],
                    ['lastName', 'Last name', 'text'],
                    ['org', 'Organisation', 'text'],
                    ['phone', 'Phone', 'tel'],
                    ['email', 'Email', 'email'],
                    ['url', 'Website', 'url'],
                  ] as const
                ).map(([k, label, mode]) => (
                  <Field key={k} label={label}>
                    <input class="input" value={content.vcard[k]} onInput={(e) => patch('vcard', { ...content.vcard, [k]: val(e) })} inputMode={mode} />
                  </Field>
                ))}
              </div>
            )}
            {content.type === 'geo' && (
              <div class="grid grid-cols-2 gap-2">
                <Field label="Latitude"><input class="input" value={content.geo.lat} onInput={(e) => patch('geo', { ...content.geo, lat: val(e) })} inputMode="decimal" placeholder="51.5007" /></Field>
                <Field label="Longitude"><input class="input" value={content.geo.lon} onInput={(e) => patch('geo', { ...content.geo, lon: val(e) })} inputMode="decimal" placeholder="-0.1246" /></Field>
              </div>
            )}
            {warning && <p class="text-xs text-warning">{warning}</p>}
          </div>

          <div class="space-y-3 border-t border-line pt-3">
            <div class="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
              <Field label={logo ? 'Error correction (H while a logo is set)' : 'Error correction'} group>
                <Segmented
                  value={ecl}
                  onChange={(v: Ecl) => setD({ ecl: v })}
                  options={(['L', 'M', 'Q', 'H'] as Ecl[]).map((v) => ({ value: v, label: v, disabled: !!logo && v !== 'H', title: { L: 'Low, 7% recoverable', M: 'Medium, 15%', Q: 'Quartile, 25%', H: 'High, 30%' }[v] }))}
                  label="Error correction"
                />
              </Field>
              <Field label="Style" group>
                <Segmented
                  value={design.style}
                  onChange={(style: ModuleStyle) => setD({ style })}
                  options={[
                    { value: 'square', label: 'Square' },
                    { value: 'rounded', label: 'Rounded' },
                    { value: 'dots', label: 'Dots' },
                  ]}
                  label="Module style"
                />
              </Field>
              <ColorField label="Foreground" value={design.fg} onChange={(fg) => setD({ fg })} />
              <ColorField label="Background" value={design.bg} onChange={(bg) => setD({ bg })} />
              <Field label={`Quiet zone: ${design.margin} modules`}>
                <input type="range" class="w-full accent-brand-600" min={0} max={10} value={design.margin} onInput={(e) => setD({ margin: Number(val(e)) })} aria-label="Quiet zone" />
              </Field>
              <Field label="Centre logo" group>
                <div class="flex items-center gap-2">
                  <input
                    ref={logoRef}
                    type="file"
                    accept="image/*"
                    class="hidden"
                    onChange={(e) => {
                      const f = (e.currentTarget as HTMLInputElement).files?.[0];
                      if (f) void pickLogo(f);
                      (e.currentTarget as HTMLInputElement).value = '';
                    }}
                  />
                  <button type="button" class="btn-secondary btn-sm" onClick={() => logoRef.current?.click()}>
                    <Icon name="image" size={13} /> {logo ? 'Change' : 'Add logo'}
                  </button>
                  {logo && <HeaderButton icon="x" title="Remove logo" onClick={() => setLogo(null)} />}
                </div>
              </Field>
              {logo && (
                <Field label={`Logo size: ${Math.round(design.logoScale * 100)}% of the width`}>
                  <input
                    type="range"
                    class="w-full accent-brand-600"
                    min={0.08}
                    max={MAX_LOGO_SCALE}
                    step={0.01}
                    value={design.logoScale}
                    onInput={(e) => setD({ logoScale: Number(val(e)) })}
                    aria-label="Logo size"
                  />
                </Field>
              )}
            </div>
            {colorWarning && <p class="text-xs text-warning">{colorWarning}</p>}
          </div>
        </section>

        {/* Preview */}
        <section class="flex min-w-0 flex-col items-center gap-3 rounded-lg border border-line-strong bg-surface p-4" aria-label="Preview">
          <div class="flex aspect-square w-full max-w-[320px] items-center justify-center rounded-lg border border-line bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] [background-size:12px_12px]">
            {svgUrl ? (
              <img src={svgUrl} alt={`QR code for ${content.type === 'wifi' ? 'a Wi-Fi network' : 'the content entered'}`} class="h-full w-full rounded-md" />
            ) : (
              <p class="p-6 text-center text-sm text-ink-3">{error ?? 'Fill in the details to see your QR code.'}</p>
            )}
          </div>

          <div class="flex w-full max-w-[320px] flex-col gap-2">
            <div class="grid grid-cols-3 gap-1">
              {[512, 1024, 2048].map((px) => (
                <button key={px} type="button" class="btn-secondary btn-sm px-1 text-xs" onClick={() => void downloadPng(px)} disabled={!svg} title={`Download a ${px} by ${px} PNG`} aria-label={`Download PNG, ${px} by ${px} pixels`}>
                  <Icon name="download" size={12} /> PNG {px}
                </button>
              ))}
            </div>
            <div class="flex gap-1">
              <button type="button" class="btn-primary btn-sm flex-1" onClick={downloadSvg} disabled={!svg}>
                <Icon name="download" size={13} /> SVG
              </button>
              <button type="button" class="btn-secondary btn-sm flex-1" onClick={() => void copyPng()} disabled={!svg}>
                <Icon name="copy" size={13} /> Copy PNG
              </button>
            </div>
          </div>

          <dl class="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line pt-3 text-xs">
            <dt class="text-ink-3">Version</dt>
            <dd class="text-ink-2">{built ? `${built.version} (${built.matrix.size} × ${built.matrix.size} modules)` : '–'}</dd>
            <dt class="text-ink-3">Data</dt>
            <dd class={cap.level === 'ok' ? 'text-ink-2' : 'text-warning'}>
              {cap.bytes.toLocaleString('en-US')} of {cap.max.toLocaleString('en-US')} bytes at level {ecl}
              {cap.level === 'near' && ' (close to the limit; codes this dense are harder to scan)'}
            </dd>
            <dt class="text-ink-3">Encodes</dt>
            <dd class="min-w-0">
              <span class="block max-h-20 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] text-ink-2">
                {content.type === 'wifi' && content.wifi.password ? payload.replace(/P:(?:\\.|[^;])*;/, 'P:••••••;') : payload || '–'}
              </span>
              {payload && (
                <button type="button" class="mt-1 text-[11px] text-brand-600 hover:underline dark:text-brand-400" onClick={() => void copyText(payload).then((ok) => toast(ok ? 'Payload copied' : 'Copy failed', ok ? 'ok' : 'error'))}>
                  Copy text
                </button>
              )}
            </dd>
          </dl>
          <p class="mt-auto text-center text-[11px] text-ink-3">Generated in your browser. Test a printed code with two different phones before you rely on it.</p>
        </section>
      </div>
    </div>
  );
}

const val = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;

/** Labelled field. Use `group` for button groups, which must not sit inside a <label>. */
function Field(p: { label: string; group?: boolean; children: ComponentChildren }) {
  if (p.group)
    return (
      <div class="block min-w-0" role="group" aria-label={p.label}>
        <span class="mb-1 block text-xs text-ink-2">{p.label}</span>
        {p.children}
      </div>
    );
  return (
    <label class="block min-w-0">
      <span class="mb-1 block text-xs text-ink-2">{p.label}</span>
      {p.children}
    </label>
  );
}

function ColorField(p: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={p.label}>
      <div class="flex items-center gap-2">
        <input type="color" class="h-9 w-10 shrink-0 cursor-pointer rounded border border-line-strong bg-surface p-0.5" value={/^#[0-9a-f]{6}$/i.test(p.value) ? p.value : '#000000'} onInput={(e) => p.onChange(val(e))} aria-label={`${p.label} colour`} />
        <input class="input min-w-0 flex-1 font-mono text-xs" value={p.value} onInput={(e) => p.onChange(val(e))} spellcheck={false} aria-label={`${p.label} hex`} />
      </div>
    </Field>
  );
}
