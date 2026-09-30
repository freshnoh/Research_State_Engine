// 서지 비교 (EVIDENCE 소유). deterministic — fuzzy similarity / LLM 없음. CONTRACT §4.
// 정규화 후 "동일 여부"만 본다. 형식 차이(대소문자·공백·문장부호·상태성 접두사)는 불일치가 아니다.

// 상태성 제목 접두사: 비교용 정규화에서만 제거한다 (Crossref 원본 제목은 그대로 저장).
const STATUS_PREFIX = [
  /^\s*(?:retracted article|retracted|withdrawn article|withdrawn)\s*[:：]\s*/,
  /^\s*[[(]\s*(?:retracted|withdrawn)\s*[\])]\s*[:：\-–—]?\s*/,
];

function stripMarkup(s) {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export function normalizeTitle(raw) {
  if (raw == null) return '';
  let s = stripMarkup(String(raw).normalize('NFKC')).toLowerCase();
  for (let i = 0; i < 3; i += 1) {
    const before = s;
    for (const re of STATUS_PREFIX) s = s.replace(re, '');
    if (s === before) break;
  }
  return s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const foldName = (s) => String(s).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// 입력 저자 한 명 → 성 후보 토큰들 ("LeCun", "Yann LeCun", "LeCun, Y." 모두 처리)
function authorTokens(a) {
  const s = String(a ?? '');
  const head = s.includes(',') ? s.split(',')[0] : s;
  return foldName(head).split(' ').filter((t) => t.length >= 2);
}

export function crossrefFamilies(authors) {
  return (authors ?? []).map((a) => foldName(a)).filter(Boolean);
}

const norm2 = (x) => (x == null ? '' : String(x));

/**
 * @param input  {title, authors, year}   사용자 입력 서지 (없으면 null/빈 값)
 * @param meta   {titles: string[], authors: string[], years: number[]}  Crossref 현재 서지
 * @returns {fields:{title,authors,year}, provided:string[], compared:string[], mismatch_fields:string[]}
 *   field 상태: match | mismatch | not_compared(입력은 있으나 Crossref 에 값 없음) | not_provided
 */
export function compareBibliography(input, meta) {
  const fields = { title: 'not_provided', authors: 'not_provided', year: 'not_provided' };

  const inTitle = normalizeTitle(input?.title);
  if (inTitle) {
    const cands = (meta.titles ?? []).map(normalizeTitle).filter(Boolean);
    fields.title = cands.length === 0 ? 'not_compared' : (cands.includes(inTitle) ? 'match' : 'mismatch');
  }

  const inAuthors = (input?.authors ?? []).map(authorTokens).filter((t) => t.length > 0);
  if (inAuthors.length > 0) {
    const fam = new Set(crossrefFamilies(meta.authors));
    if (fam.size === 0) fields.authors = 'not_compared';
    else {
      // 입력 저자(일부만 적어도 됨) 전원이 Crossref 저자 목록에 있어야 일치
      const allIn = inAuthors.every((tokens) => tokens.some((t) => fam.has(t)));
      fields.authors = allIn ? 'match' : 'mismatch';
    }
  }

  const inYear = input?.year == null || norm2(input.year) === '' ? null : Number(input.year);
  if (Number.isInteger(inYear)) {
    const years = (meta.years ?? []).filter(Number.isInteger);
    fields.year = years.length === 0 ? 'not_compared' : (years.includes(inYear) ? 'match' : 'mismatch');
  }

  const names = Object.keys(fields);
  return {
    fields,
    provided: names.filter((k) => fields[k] !== 'not_provided'),
    compared: names.filter((k) => fields[k] === 'match' || fields[k] === 'mismatch'),
    mismatch_fields: names.filter((k) => fields[k] === 'mismatch'),
  };
}
