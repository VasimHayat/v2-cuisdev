/**
 * Locate the first syntax error in a JSON document with a tiny validating scanner.
 * Used when the engine's JSON.parse message carries no position (V8 omits it for
 * "unexpected token" errors). Returns undefined for valid JSON. Pure, no DOM.
 */

export interface ScanError {
  /** 0-based character offset. */
  offset: number;
  message: string;
}

class ScanFailure extends Error {
  constructor(
    public readonly offset: number,
    message: string,
  ) {
    super(message);
  }
}

export function scanJsonError(src: string): ScanError | undefined {
  const n = src.length;
  let i = 0;

  const ws = (): void => {
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) i++;
      else break;
    }
  };
  const fail = (message: string, at = i): never => {
    throw new ScanFailure(Math.min(at, n), message);
  };
  const describe = (): string => (i >= n ? 'end of input' : `"${src[i]}"`);

  const string = (): void => {
    i++;
    while (i < n) {
      const c = src[i] as string;
      if (c === '"') {
        i++;
        return;
      }
      if (c === '\\') {
        const e = src[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) fail('Invalid unicode escape', i);
          i += 6;
          continue;
        }
        if (e === undefined || !'"\\/bfnrt'.includes(e)) fail(`Invalid escape "\\${e ?? ''}"`, i);
        i += 2;
        continue;
      }
      if (c < ' ') fail('Unescaped control character in string (use \\n, \\t, ...)', i);
      i++;
    }
    fail('Unterminated string', n);
  };

  const number = (): void => {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 64));
    if (!m || m[0] === '' || m[0] === '-') fail('Invalid number');
    i += (m as RegExpExecArray)[0].length;
    if (src[i] === '.' || /[0-9]/.test(src[i] ?? '')) fail('Invalid number (leading zeros or a trailing dot are not allowed)');
  };

  const object = (): void => {
    i++;
    ws();
    if (src[i] === '}') {
      i++;
      return;
    }
    for (;;) {
      ws();
      if (src[i] !== '"') {
        if (src[i] === '}') fail('Trailing comma before "}"');
        fail(`Expected a quoted property name, found ${describe()}`);
      }
      string();
      ws();
      if (src[i] !== ':') fail(`Expected ":" after property name, found ${describe()}`);
      i++;
      value();
      ws();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === '}') {
        i++;
        return;
      }
      fail(`Expected "," or "}" after property value, found ${describe()}`);
    }
  };

  const array = (): void => {
    i++;
    ws();
    if (src[i] === ']') {
      i++;
      return;
    }
    for (;;) {
      ws();
      if (src[i] === ']') fail('Trailing comma before "]"');
      value();
      ws();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === ']') {
        i++;
        return;
      }
      fail(`Expected "," or "]" after array element, found ${describe()}`);
    }
  };

  const value = (): void => {
    ws();
    if (i >= n) fail('Unexpected end of input');
    const c = src[i] as string;
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    for (const lit of ['true', 'false', 'null']) {
      if (src.startsWith(lit, i)) {
        i += lit.length;
        return;
      }
    }
    if (c === "'") fail('Single quotes are not valid in JSON, use double quotes');
    fail(`Unexpected token ${describe()}`);
  };

  try {
    value();
    ws();
    if (i < n) fail(`Unexpected token ${describe()} after the JSON value`);
    return undefined;
  } catch (err) {
    if (err instanceof ScanFailure) return { offset: err.offset, message: err.message };
    throw err;
  }
}
