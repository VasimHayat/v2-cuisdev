/**
 * HTML entity encoding and decoding: pure functions, no DOM.
 *
 * Decoding is implemented by hand so it is unit-testable and identical in Node and the
 * browser. It understands named, decimal (&#160;) and hex (&#xA0;) references, tolerates
 * a missing semicolon on the legacy entities browsers accept without one, and applies
 * the Windows-1252 remap the HTML spec requires for &#128; to &#159;.
 */

export type EntityMode = 'essential' | 'non-ascii' | 'decimal' | 'hex';

export class HtmlEntityError extends Error {
  override name = 'HtmlEntityError';
}

const ENTITY_TABLE =
  'quot:34,amp:38,lt:60,gt:62,apos:39,' +
  'nbsp:160,iexcl:161,cent:162,pound:163,curren:164,yen:165,brvbar:166,sect:167,uml:168,copy:169,' +
  'ordf:170,laquo:171,not:172,shy:173,reg:174,macr:175,deg:176,plusmn:177,sup2:178,sup3:179,' +
  'acute:180,micro:181,para:182,middot:183,cedil:184,sup1:185,ordm:186,raquo:187,frac14:188,' +
  'frac12:189,frac34:190,iquest:191,Agrave:192,Aacute:193,Acirc:194,Atilde:195,Auml:196,Aring:197,' +
  'AElig:198,Ccedil:199,Egrave:200,Eacute:201,Ecirc:202,Euml:203,Igrave:204,Iacute:205,Icirc:206,' +
  'Iuml:207,ETH:208,Ntilde:209,Ograve:210,Oacute:211,Ocirc:212,Otilde:213,Ouml:214,times:215,' +
  'Oslash:216,Ugrave:217,Uacute:218,Ucirc:219,Uuml:220,Yacute:221,THORN:222,szlig:223,agrave:224,' +
  'aacute:225,acirc:226,atilde:227,auml:228,aring:229,aelig:230,ccedil:231,egrave:232,eacute:233,' +
  'ecirc:234,euml:235,igrave:236,iacute:237,icirc:238,iuml:239,eth:240,ntilde:241,ograve:242,' +
  'oacute:243,ocirc:244,otilde:245,ouml:246,divide:247,oslash:248,ugrave:249,uacute:250,ucirc:251,' +
  'uuml:252,yacute:253,thorn:254,yuml:255,' +
  'OElig:338,oelig:339,Scaron:352,scaron:353,Yuml:376,fnof:402,circ:710,tilde:732,' +
  'Alpha:913,Beta:914,Gamma:915,Delta:916,Epsilon:917,Zeta:918,Eta:919,Theta:920,Iota:921,' +
  'Kappa:922,Lambda:923,Mu:924,Nu:925,Xi:926,Omicron:927,Pi:928,Rho:929,Sigma:931,Tau:932,' +
  'Upsilon:933,Phi:934,Chi:935,Psi:936,Omega:937,alpha:945,beta:946,gamma:947,delta:948,' +
  'epsilon:949,zeta:950,eta:951,theta:952,iota:953,kappa:954,lambda:955,mu:956,nu:957,xi:958,' +
  'omicron:959,pi:960,rho:961,sigmaf:962,sigma:963,tau:964,upsilon:965,phi:966,chi:967,psi:968,' +
  'omega:969,thetasym:977,upsih:978,piv:982,' +
  'ensp:8194,emsp:8195,thinsp:8201,zwnj:8204,zwj:8205,lrm:8206,rlm:8207,ndash:8211,mdash:8212,' +
  'lsquo:8216,rsquo:8217,sbquo:8218,ldquo:8220,rdquo:8221,bdquo:8222,dagger:8224,Dagger:8225,' +
  'bull:8226,hellip:8230,permil:8240,prime:8242,Prime:8243,lsaquo:8249,rsaquo:8250,oline:8254,' +
  'frasl:8260,euro:8364,' +
  'image:8465,weierp:8472,real:8476,trade:8482,alefsym:8501,larr:8592,uarr:8593,rarr:8594,' +
  'darr:8595,harr:8596,crarr:8629,lArr:8656,uArr:8657,rArr:8658,dArr:8659,hArr:8660,' +
  'forall:8704,part:8706,exist:8707,empty:8709,nabla:8711,isin:8712,notin:8713,ni:8715,prod:8719,' +
  'sum:8721,minus:8722,lowast:8727,radic:8730,prop:8733,infin:8734,ang:8736,and:8743,or:8744,' +
  'cap:8745,cup:8746,int:8747,there4:8756,sim:8764,cong:8773,asymp:8776,ne:8800,equiv:8801,' +
  'le:8804,ge:8805,sub:8834,sup:8835,nsub:8836,sube:8838,supe:8839,oplus:8853,otimes:8855,' +
  'perp:8869,sdot:8901,' +
  'lceil:8968,rceil:8969,lfloor:8970,rfloor:8971,lang:10216,rang:10217,loz:9674,spades:9824,' +
  'clubs:9827,hearts:9829,diams:9830,' +
  'excl:33,num:35,dollar:36,percnt:37,lpar:40,rpar:41,ast:42,plus:43,comma:44,period:46,sol:47,' +
  'colon:58,semi:59,equals:61,quest:63,commat:64,lsqb:91,bsol:92,rsqb:93,Hat:94,lowbar:95,' +
  'grave:96,lcub:123,verbar:124,rcub:125,hairsp:8202,horbar:8213,check:10003,cross:10007,' +
  'star:9734,starf:9733,phone:9742,female:9792,male:9794,hyphen:8208,' +
  'NewLine:10,Tab:9';

/** name -> code point */
export const NAMED_ENTITIES: ReadonlyMap<string, number> = new Map(
  ENTITY_TABLE.split(',').map((pair) => {
    const [name, code] = pair.split(':');
    return [name as string, Number(code)];
  }),
);

/** code point -> preferred name (first name listed wins). */
const NAME_FOR_CODE: ReadonlyMap<number, string> = (() => {
  const map = new Map<number, string>();
  for (const [name, code] of NAMED_ENTITIES) if (!map.has(code) && !['NewLine', 'Tab', 'apos'].includes(name)) map.set(code, name);
  return map;
})();

/** Entities browsers accept without a trailing semicolon (&copy2024 -> ©2024). */
const LEGACY_NAMES: ReadonlySet<string> = new Set([
  'amp', 'lt', 'gt', 'quot', 'AMP', 'LT', 'GT', 'QUOT', 'COPY', 'REG',
  ...[...NAMED_ENTITIES].filter(([, code]) => code >= 160 && code <= 255).map(([name]) => name),
]);

/** Windows-1252 remap required by the HTML spec for numeric references 0x80 to 0x9F. */
const C1_REMAP: Readonly<Record<number, number>> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

const ESSENTIAL: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESSENTIAL_RE = /[&<>"']/g;
const NON_ASCII_OR_ESSENTIAL_RE = /[&<>"']|[^\t\n\r -~]/gu;
const ALL_BUT_NEWLINES_RE = /[^\r\n]/gu;

/** Encode text as HTML entities. Line breaks are always kept literal. */
export function entityEncode(text: string, mode: EntityMode = 'essential'): string {
  if (text === '') return '';
  switch (mode) {
    case 'essential':
      return text.replace(ESSENTIAL_RE, (c) => ESSENTIAL[c] as string);
    case 'non-ascii':
      return text.replace(NON_ASCII_OR_ESSENTIAL_RE, (c) => {
        const essential = ESSENTIAL[c];
        if (essential) return essential;
        const code = c.codePointAt(0) as number;
        const name = NAME_FOR_CODE.get(code);
        return name ? `&${name};` : `&#${code};`;
      });
    case 'decimal':
      return text.replace(ALL_BUT_NEWLINES_RE, (c) => `&#${c.codePointAt(0)};`);
    case 'hex':
      return text.replace(ALL_BUT_NEWLINES_RE, (c) => `&#x${(c.codePointAt(0) as number).toString(16).toUpperCase()};`);
    default:
      throw new HtmlEntityError(`Unknown encode mode "${String(mode)}".`);
  }
}

const ENTITY_RE = /&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|([a-zA-Z][a-zA-Z0-9]*)(;?))/g;

/** Decode HTML entities. Unknown or malformed references are left untouched. */
export function entityDecode(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY_RE, (match, hex?: string, dec?: string, name?: string, semi?: string) => {
    if (hex !== undefined) return fromCodePointSafe(parseInt(hex, 16));
    if (dec !== undefined) return fromCodePointSafe(parseInt(dec, 10));
    if (name === undefined) return match;
    if (semi === ';') {
      const code = NAMED_ENTITIES.get(name);
      return code === undefined ? match : String.fromCodePoint(code);
    }
    for (let len = Math.min(name.length, 6); len >= 2; len--) {
      const prefix = name.slice(0, len);
      if (LEGACY_NAMES.has(prefix)) {
        const code = NAMED_ENTITIES.get(prefix) ?? NAMED_ENTITIES.get(prefix.toLowerCase());
        if (code !== undefined) return String.fromCodePoint(code) + name.slice(len);
      }
    }
    return match;
  });
}

/** Names that look like entities but are not in the table, e.g. &foo; */
export function findUnknownEntities(text: string): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(/&([a-zA-Z][a-zA-Z0-9]*);/g)) {
    const name = match[1] as string;
    if (!NAMED_ENTITIES.has(name)) unknown.add(`&${name};`);
  }
  return [...unknown];
}

/** True when the text contains at least one reference this decoder understands. */
export function hasEntities(text: string): boolean {
  const re = /&(?:#[xX][0-9a-fA-F]+;?|#[0-9]+;?|[a-zA-Z][a-zA-Z0-9]*;)/g;
  for (const m of text.matchAll(re)) {
    const s = m[0];
    if (s.startsWith('&#')) return true;
    if (NAMED_ENTITIES.has(s.slice(1, -1))) return true;
  }
  return false;
}

/** Count how many references were produced or resolved, for the status line. */
export function countEntities(text: string): number {
  return (text.match(/&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g) ?? []).length;
}

function fromCodePointSafe(code: number): string {
  if (Number.isNaN(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
  const remapped = C1_REMAP[code];
  return String.fromCodePoint(remapped ?? code);
}
