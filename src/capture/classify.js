// 발화 종류 판정 — deterministic (CONTRACT §4: 실행 흔적 여부는 LLM 이 정하지 않는다).
// 저장 자격: execution 만. 단순 키워드가 아니라 "과거형 실행/결과 흔적"이 있어야 한다.
// 불명확하거나 실행+계획/가설이 섞이면 other (저장하지 않음).

const QUESTION = /\?|？|(?:될까요|할까요|일까요|있을까요|없을까요|인가요|나요|습니까|입니까|ㅂ니까|어떨까요|괜찮을까요|해도\s*되|알려\s*주|알려주|추천해|궁금)/;
const QUESTION_WORD = /(?:^|\s)(?:왜|어떻게|무엇|뭐가|뭘|어디서|언제)(?:\s|$)/;

const PLAN = /(?:하려\s*(?:고|합니다|는|해요|한다)|해\s*보려|해보려|해볼\s*(?:까|예정|계획|것)|할\s*예정|할\s*계획|예정입니다|예정이다|계획입니다|계획이다|하겠습니다|하겠다|할게요|할\s*것입니다|할\s*겁니다|할\s*생각|해\s*보겠|해보겠|다시\s*해볼)/;

const HYPOTHESIS = /(?:가설|것\s*같|것\s*같습|일\s*것이다|일\s*것입니다|일지도|일\s*수도|아마|추정|추측|예상됩니다|예상된다|것으로\s*보|생각합니다|생각한다|믿습니다)/;

// 인지·계획 동사의 과거형은 "실행"이 아니다
const COGNITIVE_PAST = /(?:생각했|가정했|예상했|추정했|추측했|기대했|계획했|고민했|가설을\s*세웠|세웠|믿었|의심했)/g;
// 가정·조건·추측 어미가 붙은 과거형도 실행이 아니다
const HYPOTHETICAL_PAST = /(?:했다면|했으면|했더라면|했을\s*때|했을까|했을\s*것|했을지|했을\s*수|했다가는)/g;
const NEGATION = /(?:하지\s*(?:않|못)|안\s*했|못\s*했|않았|못했|안\s*됐)/;
// 실제 수행/결과 발생의 과거형 흔적
const EXEC_PAST = /(?:했|돌렸|봤|나왔|멈췄|끝냈|마쳤|진행됐|측정됐|처리됐|중단됐|실패됐)/;

export function classifyUtterance(text) {
  const t = String(text ?? '').trim();
  if (!t) return { kind: 'other', reason: 'empty' };

  if (QUESTION.test(t) || QUESTION_WORD.test(t)) return { kind: 'question', reason: 'question_form' };

  const stripped = t.replace(COGNITIVE_PAST, ' ').replace(HYPOTHETICAL_PAST, ' ');
  const exec = EXEC_PAST.test(stripped) && !NEGATION.test(t);
  const plan = PLAN.test(t);
  const hyp = HYPOTHESIS.test(t);

  if (exec && !plan && !hyp) return { kind: 'execution', reason: 'past_execution_trace' };
  if (exec) return { kind: 'other', reason: 'mixed_execution_and_plan_or_hypothesis' };
  if (plan) return { kind: 'plan', reason: 'plan_form' };
  if (hyp) return { kind: 'hypothesis', reason: 'hypothesis_form' };
  return { kind: 'other', reason: NEGATION.test(t) ? 'negated_execution' : 'no_execution_trace' };
}
