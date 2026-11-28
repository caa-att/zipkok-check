// 중개사무소 등록 조회: 사용자가 "조회하기"를 누르면 구 코드·등록번호·상호만 브이월드(국가공간정보포털)에 보내요.
// 브이월드 "부동산중개업사무소정보조회"(getEBOfficeInfo)만 이 파일에서 불러요.
// 키는 Vercel 설정의 BROKER_KEY에만 있어요. 키 값은 어디에도 적거나 남기지 않아요.
// 받은 값과 조회 결과는 어디에도 저장하지 않고, 로그에도 남기지 않아요.

const URL_BASE = 'https://api.vworld.kr/ned/data/getEBOfficeInfo';
// 2026-11-28 사용자와 정함: 그 사무소에 등록된 사람(공인중개사·중개보조원) 조회 — 브이월드 「부동산중개업자정보」(getEBBrokerInfo), 같은 키
const PEOPLE_URL = 'https://api.vworld.kr/ned/data/getEBBrokerInfo';
const MAX_ITEMS = 5;

// 서울 25개 구 (시군구 코드)
const SEOUL = new Set(['11110','11140','11170','11200','11215','11230','11260','11290','11305','11320','11350','11380','11410','11440','11470','11500','11530','11545','11560','11590','11620','11650','11680','11710','11740']);

// Vercel 로그에 한 줄만 남겨요 (키 값과 사용자가 적은 값은 넣지 않아요)
const logFail = why => console.error('중개사무소 조회 실패 · ' + String(why).replace(/\s+/g, ' ').slice(0, 120));

// 응답 안에서 사무소 한 곳씩의 정보(상호나 등록번호가 있는 묶음)를 모두 찾아요
function collect(node, out){
  if(Array.isArray(node)){ node.forEach(n => collect(n, out)); return out; }
  if(node && typeof node === 'object'){
    if('bsnmCmpnm' in node || 'jurirno' in node) out.push(node);
    else Object.values(node).forEach(n => collect(n, out));
  }
  return out;
}

// 항목 이름이 조금 달라도 찾을 수 있게 후보를 차례로 봐요
const pick = (o, names) => { for(const n of names){ if(o[n] != null && String(o[n]).trim() !== '') return String(o[n]).trim(); } return ''; };
const pickRe = (o, re, not) => { for(const k of Object.keys(o)){ if(re.test(k) && !(not && not.test(k)) && o[k] != null && String(o[k]).trim() !== '') return String(o[k]).trim(); } return ''; };
// 날짜는 2024-01-29 모양으로 맞춰요
const day = s => { const d = String(s || '').replace(/[^0-9]/g, ''); return d.length >= 8 ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) : ''; };

function shape(o){
  return {
    office: pick(o, ['bsnmCmpnm']),
    no: pick(o, ['jurirno']),
    name: pick(o, ['brkrNm']),
    code: pick(o, ['sttusSeCode']),
    status: pick(o, ['sttusSeCodeNm', 'sttusSeNm']),
    gu: pick(o, ['ldCodeNm']),
    addr: pick(o, ['rdnmadr', 'mnnmadr']),
    reg: day(pick(o, ['registDe', 'registDt', 'regDe']) || pickRe(o, /regist|regDe/i)),
    gBegin: day(pick(o, ['estbsBeginDe', 'grntyBeginDe']) || pickRe(o, /(begin|bgn|start|strt)/i)),
    gEnd: day(pick(o, ['estbsEndDe', 'grntyEndDe']) || pickRe(o, /end(de|dt|date)?$/i, /regist/i)),
    base: day(pick(o, ['lastUpdtDt', 'dataStdrDe']) || pickRe(o, /(updt|stdr)/i))
  };
}

export default async function handler(req, res){
  if(req.method !== 'POST'){ res.setHeader('Allow', 'POST'); return res.status(405).json({error: 'method'}); }

  let b = req.body;
  if(typeof b === 'string'){ try { b = JSON.parse(b); } catch(e) { b = null; } }
  b = b || {};
  const gu = String(b.gu || '');
  // 등록번호는 한글·숫자·붙임표만, 상호는 꺾쇠 같은 기호를 빼고 받아요
  const no = String(b.no || '').replace(/[^0-9가-힣-]/g, '').slice(0, 30);
  const office = String(b.office || '').replace(/[<>&"'%\\]/g, '').trim().slice(0, 50);
  if(!SEOUL.has(gu) || (!no && !office)) return res.status(400).json({error: 'input'});

  const key = process.env.BROKER_KEY;
  if(!key){ logFail('BROKER_KEY 없음'); return res.status(500).json({error: 'no_key'}); }

  // 브이월드 키에 등록한 사이트 주소를 함께 보내야 해요.
  // Vercel 설정 BROKER_DOMAIN(실제 사이트 주소)이 있으면 늘 그 주소를 보내요. 미리보기 주소에서 시험할 때도 조회돼요.
  // 없으면 지금 열린 사이트 주소를 보내요.
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const domain = String(process.env.BROKER_DOMAIN || '').trim() || 'https://' + host;
  if(b.mode === 'people') return people(res, gu, no, key, domain);
  const q = new URLSearchParams({ldCode: gu, format: 'json', numOfRows: '20', pageNo: '1', key, domain});
  if(no) q.set('jurirno', no);
  if(office) q.set('bsnmCmpnm', office);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(URL_BASE + '?' + q.toString(), {signal: ctrl.signal});
    if(!r.ok){ logFail('응답 ' + r.status); return res.status(502).json({error: 'lookup'}); }
    let data;
    try { data = await r.json(); } catch(e) { logFail('JSON 아님'); return res.status(502).json({error: 'lookup'}); }

    const found = collect(data, []).map(shape).filter(x => x.office || x.no);
    if(!found.length){
      // 키·주소 문제 같은 오류 응답이면 "결과 없음"과 나눠서 알려 줘요
      const txt = JSON.stringify(data);
      if(/"status"\s*:\s*"ERROR"|INCORRECT_KEY|UNAVAILABLE_KEY|INVALID|"error"/i.test(txt) && !/NOT_FOUND/i.test(txt)){
        const m = txt.match(/"(?:code|resultCode)"\s*:\s*"([A-Z_0-9]{2,40})"/);
        logFail('브이월드 오류' + (m ? ' · ' + m[1] : ''));
        return res.status(502).json({error: 'lookup'});
      }
      return res.status(200).json({items: [], total: 0});
    }
    console.log('중개사무소 조회 성공 · ' + found.length + '곳');
    return res.status(200).json({items: found.slice(0, MAX_ITEMS), total: found.length});
  } catch(e) {
    logFail(e.name === 'AbortError' ? '시간 초과' : '연결 오류');
    return res.status(502).json({error: 'lookup'});
  } finally {
    clearTimeout(timer);
  }
}

// 그 사무소 사람 목록: 등록번호로만 물어요. 이름·구분(대표·소속공인중개사·중개보조원)·자격 취득일만 돌려줘요(공개 자료).
function collectP(node, out){
  if(Array.isArray(node)){ node.forEach(n => collectP(n, out)); return out; }
  if(node && typeof node === 'object'){
    if('brkrNm' in node) out.push(node);
    else Object.values(node).forEach(n => collectP(n, out));
  }
  return out;
}
async function people(res, gu, no, key, domain){
  if(!no) return res.status(400).json({error: 'input'});
  const q = new URLSearchParams({ldCode: gu, jurirno: no, format: 'json', numOfRows: '50', pageNo: '1', key, domain});
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(PEOPLE_URL + '?' + q.toString(), {signal: ctrl.signal});
    if(!r.ok){ logFail('사람 조회 응답 ' + r.status); return res.status(502).json({error: 'lookup'}); }
    let data; try { data = await r.json(); } catch(e) { logFail('사람 조회 JSON 아님'); return res.status(502).json({error: 'lookup'}); }
    const raw = collectP(data, []);
    const list = raw.map(o => ({
      name: pick(o, ['brkrNm']),
      role: pick(o, ['brkrAsortCodeNm', 'ofcpsSeCodeNm', 'brkrAsortNm']) || pickRe(o, /(asort|ofcps).*nm$/i),
      office: pick(o, ['bsnmCmpnm']),
      qual: day(pick(o, ['crqfcAcqdt', 'crqfcAcqDe']) || pickRe(o, /crqfc.*(dt|de)$/i))
    })).filter(x => x.name);
    if(!list.length){
      const txt = JSON.stringify(data);
      const m = txt.match(/"resultCode"\s*:\s*"([A-Z_0-9]{2,40})"/);
      if(m && !/NOT_FOUND|^0+$|SUCCESS|OK/i.test(m[1])){ logFail('사람 조회 오류 · ' + m[1]); return res.status(502).json({error: 'lookup'}); }
      return res.status(200).json({people: []});
    }
    console.log('중개업자 조회 성공 · ' + list.length + '명');
    return res.status(200).json({people: list.slice(0, 30), fields: Object.keys(raw[0]).slice(0, 40)});
  } catch(e) {
    logFail(e.name === 'AbortError' ? '사람 조회 시간 초과' : '사람 조회 연결 오류');
    return res.status(502).json({error: 'lookup'});
  } finally { clearTimeout(timer); }
}
