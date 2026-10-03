/** Inline password prompt shared by the PDF islands. */
import { Icon } from '../shared/icons';

export function PasswordCard(p: { value: string; error?: string; onChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <form
      class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
      onSubmit={(e) => {
        e.preventDefault();
        p.onSubmit();
      }}
    >
      <Icon name="lock" size={26} class="text-ink-3" />
      <p class="text-sm font-medium">This PDF is password protected</p>
      <div class="flex w-full max-w-xs gap-2">
        <input type="password" class="input h-9 flex-1" value={p.value} onInput={(e) => p.onChange((e.currentTarget as HTMLInputElement).value)} placeholder="Password" aria-label="PDF password" autocomplete="off" />
        <button type="submit" class="btn-primary" disabled={!p.value}>
          Unlock
        </button>
      </div>
      {p.error && <p class="text-xs text-danger">{p.error}</p>}
      <p class="max-w-xs text-xs text-ink-3">The password is used only in this tab to open the file.</p>
    </form>
  );
}
