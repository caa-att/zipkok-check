// 중개사 대화 분석: 사용자가 동의하고 "분석하기"를 누르면, 받아 적은 대화 글(가린 것)만 Gemini에 보내고
// 추가로 물어볼 질문 · 다시 따져 볼 말 · 사기 신호 · 관련 체크리스트 질문을 돌려줘요.
// 받은 글과 결과는 이 서버에 저장하지 않아요. 결과는 앱이 기기 브라우저에만 저장해요.
// 아래 두 목록(체크리스트 질문, 사기 유형)은 index.html의 Q · FRAUD와 이름이 같아야 해요. 고칠 때 같이 고쳐요.
import {gemini, fromOurSite, tooMany, jsonBody, mask, cut} from './_gemini.mjs';

const MAX_TEXT = 20000;

// 체크리스트 15개 질문 (index.html Q 순서와 같은 번호)
const CHECK = {
  q1:'집주인 본인 확인', q2:'계약서 임대인 정보 일치', q3:'공동명의 확인', q4:'중개사 정상 영업 확인',
  q5:'근저당 확인', q6:'선순위 보증금(다가구)', q7:'보증보험 가능 여부', q8:'세금 완납 확인',
  q9:'건축물 용도(주거용·위반건축물)', q10:'보증금 반환 시점', q11:'중도 해지 조건', q12:'시세 비교',
  q13:'입금 계좌 명의', q14:'잔금일 권리 변동(추가 대출 금지 특약)', q15:'중개보수'
};

// 사기 유형 (index.html FRAUD와 같은 번호. 출처: HUG 전세사기예방센터, 찾기쉬운 생활법령정보)
const FRAUD = {
  f1:'깡통전세: 보증금과 집에 걸린 빚을 합친 금액이 집값에 가까운 집. "집주인이 부자라 괜찮다"는 말, 보증보험이 안 된다는 말이 신호',
  f2:'가짜 임대인·위조 서류: 소유자가 아닌 사람이 집주인 행세. 신분증 이름과 등기부 소유자가 다르거나 등기부를 중개사가 준 것만 보여 주는 것이 신호',
  f3:'월세를 전세로 둔갑: 집주인 없이 중개사·중개보조원이 대리인이라며 계약하고 보증금 차액을 가로챔. 집주인 서류 없음, 중개사·보조원 계좌로 입금 요구가 신호',
  f4:'무등록·폐업 중개: 등록증·자격증을 빌려 사무소 운영. 등록번호를 말하지 않거나 공제증서를 보여 주지 않는 것이 신호',
  f5:'선순위 보증금 속이기(다가구): 먼저 사는 세입자 보증금 합계를 줄여서 말함. 말로만 "얼마 안 된다"며 확정일자 부여 현황 열람 동의를 거부하는 것이 신호',
  f6:'신탁 부동산: 신탁된 집을 신탁회사 동의 없이 임대해 계약이 무효가 될 수 있음. 등기부에 신탁, 위탁자(원래 주인) 계좌 입금 요구, 신탁회사 동의서 없음이 신호',
  f7:'이중계약: 한 집을 여러 사람에게 계약하고 잠적. 기존 세입자가 나가기 전에 잔금을 요구하는 것이 신호',
  f8:'잔금일·전입일 대출이나 매도: 전입신고 효력이 생기기 전(다음 날 0시)에 근저당을 설정하거나 집을 팔아 버림. 잔금일에 대출 예정, 특약 거부가 신호',
  f9:'전출 요구: 사는 중에 "잠깐 전입을 빼 달라"고 해서 대항력을 잃게 함',
  f10:'미납 세금: 집주인 국세·지방세 체납이 보증금보다 먼저 가져감. 납세증명서 보여 주기 거부가 신호',
  f11:'특약 불이행: 신탁 말소·근저당 말소 같은 특약을 적고도 지키지 않음. 이행 확인 없이 잔금을 요구하는 것이 신호',
  f12:'명의 대여·이면계약: "명의를 빌려주면 돈을 준다", 실제와 다른 금액이나 다른 이름으로 계약서를 쓰자는 제안'
};

const SYSTEM = [
  '너는 서울에서 처음 전월세 계약을 하는 대학생·사회초년생을 돕는 안내 도우미야.',
  '[대화]는 사용자가 집을 보러 가서 공인중개사나 집주인과 나눈 말을 받아 적은 글이야. 받아쓰기라 틀린 글자가 있을 수 있어.',
  '대화를 읽고 아래를 만들어 줘.',
  '- summary: 대화에서 들은 핵심을 3문장 이내로.',
  '- facts: 대화에서 실제로 나온 조건(보증금, 월세, 관리비, 집 종류, 근저당, 입주일, 계약 기간 등)을 항목과 들은 내용으로. 나오지 않은 것은 넣지 마.',
  '- followups: 사용자가 다음에 그대로 읽어서 물어볼 수 있는 질문. 대화에서 빠졌거나 대답이 애매했던 것 위주로, 처음 계약하는 사람이 놓치기 쉬운 것과 아래 사기 유형을 막는 질문을 우선해. 질문은 중개사에게 하는 존댓말 한 문장으로.',
  '- recheck: 대화에서 들은 말 중 다시 꼼꼼히 따져야 할 말. said에는 들은 말을 짧게 그대로, why에는 왜 위험할 수 있는지, how에는 무엇을 떼어 보거나 요청해서 확인할지.',
  '- fraud: 아래 [사기 유형] 가운데 대화에 실제 신호가 보이는 것만 번호(id)와 이유. 신호가 없으면 빈 목록. 추측으로 넣지 마.',
  '- checklist: 아래 [체크리스트] 가운데 이 대화와 관련 있어 앱에서 꼭 확인해 볼 질문 번호(id).',
  '- urgent: 이미 돈을 보냈는데 연락이 끊겼거나 사기를 당한 것 같은 말이 있으면 true.',
  '규칙: 대화에 없는 사실을 지어내지 마. 법률 이름·조항 번호·판례는 쓰지 마. 사람 이름과 연락처는 쓰지 마.',
  '쉬운 한국어 존댓말(-요)로 짧게 써. 마크다운 기호(**, #)는 쓰지 마. 단정하지 말고 참고 안내로 써.',
  '',
  '[체크리스트]',
  ...Object.entries(CHECK).map(([k, v]) => k + ': ' + v),
  '',
  '[사기 유형]',
  ...Object.entries(FRAUD).map(([k, v]) => k + ': ' + v)
].join('\n');

const S = (description) => ({type: 'STRING', description});
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: S('핵심 요약 3문장 이내'),
    facts: {type: 'ARRAY', items: {type: 'OBJECT', properties: {k: S('항목'), v: S('들은 내용')}, required: ['k', 'v']}},
    followups: {type: 'ARRAY', items: {type: 'OBJECT', properties: {q: S('그대로 읽을 질문'), why: S('왜 물어야 하는지')}, required: ['q', 'why']}},
    recheck: {type: 'ARRAY', items: {type: 'OBJECT', properties: {said: S('들은 말'), why: S('왜 따져야 하는지'), how: S('어떻게 확인할지')}, required: ['said', 'why', 'how']}},
    fraud: {type: 'ARRAY', items: {type: 'OBJECT', properties: {id: S('사기 유형 번호'), why: S('대화에서 보인 신호')}, required: ['id', 'why']}},
    checklist: {type: 'ARRAY', items: S('체크리스트 질문 번호')},
    urgent: {type: 'BOOLEAN'}
  },
  required: ['summary', 'facts', 'followups', 'recheck', 'fraud', 'checklist', 'urgent']
};

const list = (a, n) => (Array.isArray(a) ? a : []).slice(0, n);

export default async function handler(req, res){
  if(req.method !== 'POST'){ res.setHeader('Allow', 'POST'); return res.status(405).json({error: 'method'}); }
  if(!fromOurSite(req)) return res.status(403).json({error: 'origin'});
  if(tooMany(req, 'talk', 10, 10 * 60 * 1000)) return res.status(429).json({error: 'busy'});

  const b = jsonBody(req);
  const text = mask(b && typeof b.text === 'string' ? b.text.trim().slice(0, MAX_TEXT) : '');
  if(text.length < 10) return res.status(400).json({error: 'empty'});

  try {
    const r = await gemini({tag: '대화 분석', system: SYSTEM, schema: SCHEMA, timeout: 55000, parts: [{text: '[대화]\n' + text}]});
    // 받은 결과를 정해진 모양과 길이로 다시 맞춰요 (목록에 없는 번호는 버려요)
    const seen = new Set();
    const out = {
      summary: cut(r.summary, 400),
      facts: list(r.facts, 12).map(x => ({k: cut(x && x.k, 30), v: cut(x && x.v, 160)})).filter(x => x.k && x.v),
      followups: list(r.followups, 8).map(x => ({q: cut(x && x.q, 200), why: cut(x && x.why, 240)})).filter(x => x.q),
      recheck: list(r.recheck, 6).map(x => ({said: cut(x && x.said, 160), why: cut(x && x.why, 240), how: cut(x && x.how, 240)})).filter(x => x.said && x.why),
      fraud: list(r.fraud, 6).map(x => ({id: String(x && x.id || '').trim(), why: cut(x && x.why, 240)})).filter(x => FRAUD[x.id] && !seen.has(x.id) && seen.add(x.id)),
      checklist: [...new Set(list(r.checklist, 8).map(x => String(x).trim()).filter(x => CHECK[x]))],
      urgent: r.urgent === true
    };
    return res.status(200).json(out);
  } catch(e) {
    return res.status(502).json({error: 'ai'});
  }
}
