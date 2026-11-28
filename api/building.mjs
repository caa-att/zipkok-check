// 건축물대장 조회 (2026-11-28 사용자와 정함, 9번 「건축물 용도」 답을 채우는 데만 써요)
// 사용자가 「조회하기」를 누르면 적은 집 주소만 보내요. 이름·보증금·답은 보내지 않아요.
// ① 브이월드 주소 검색(지오코더)으로 주소 → 법정동 코드·지번  ② 국토교통부 건축HUB 건축물대장 표제부로 용도 조회
// 키는 Vercel 설정에만 있어요: BROKER_KEY(브이월드, 4번 조회와 같은 키), BLDG_KEY(공공데이터포털 일반 인증키). 키 값은 어디에도 적거나 남기지 않아요.
// 받은 주소와 결과는 저장하지 않고 로그에도 남기지 않아요.
import { fromOurSite, tooMany, jsonBody } from './_gemini.mjs';

const GEO = 'https://api.vworld.kr/req/address';
const SEARCH = 'https://api.vworld.kr/req/search';
const HUB = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
const logFail = why => console.error('건축물대장 조회 실패 · ' + String(why).replace(/\s+/g, ' ').slice(0, 140));

async function getJson(url, ms){
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ms || 10000);
  try {
    const r = await fetch(url, {signal: ctrl.signal});
    const text = await r.text();
    try { return {ok: r.ok, status: r.status, data: JSON.parse(text)}; } catch(e) { return {ok: false, status: r.status, text: text.slice(0, 200)}; }
  } finally { clearTimeout(timer); }
}

// 브이월드 지오코더: 주소 → 좌표, 좌표 → 지번 주소 구조(법정동 코드 level4LC, 지번 level5)
async function parcelOf(addr, key, domain){
  const base = {service: 'address', version: '2.0', crs: 'epsg:4326', format: 'json', errorformat: 'json', key, domain};
  // 2026-11-28: 도로명 주소는 좌표로 바꾼 뒤 그 자리 지번을 찾으면 옆 필지가 잡힐 때가 있어요(예: 월드컵북로 400 → 54길 12 건물).
  // 그래서 먼저 브이월드 주소 검색으로 그 도로명 주소의 "지번 주소"를 받아 지번으로 다시 찾고, 안 되면 예전 방법으로 해요.
  if(/[로길]\s*\d/.test(addr)){
    const q0 = new URLSearchParams({service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326', size: '5', page: '1', query: addr, type: 'address', category: 'road', format: 'json', errorformat: 'json', key, domain});
    const r0 = await getJson(SEARCH + '?' + q0.toString());
    const items0 = (((r0.data || {}).response || {}).result || {}).items;
    const it0 = [].concat(items0 || [])[0], jb = it0 && it0.address && String(it0.address.parcel || '').trim();
    if(jb){
      const full = /^서울/.test(jb) ? jb : '서울특별시 ' + jb;
      const q1 = new URLSearchParams(Object.assign({}, base, {request: 'getcoord', type: 'parcel', refine: 'true', simple: 'false', address: full}));
      const r1 = await getJson(GEO + '?' + q1.toString()), resp1 = r1.data && r1.data.response;
      const st1 = resp1 && resp1.status === 'OK' && ((resp1.refined || {}).structure || {});
      if(st1 && /^\d{10}$/.test(st1.level4LC || '') && st1.level5) return {code: st1.level4LC, jibun: st1.level5, text: (resp1.refined || {}).text || full};
    } else if(r0.data && !items0) logFail('브이월드 주소 검색 결과 없음');
  }
  for(const type of ['parcel', 'road']){
    const q = new URLSearchParams(Object.assign({}, base, {request: 'getcoord', type, refine: 'true', simple: 'false', address: addr}));
    const r = await getJson(GEO + '?' + q.toString());
    const resp = r.data && r.data.response;
    if(!resp) { logFail('브이월드 응답 모양 ' + r.status); continue; }
    if(resp.status === 'ERROR'){ logFail('브이월드 오류 · ' + ((resp.error || {}).code || '')); return {err: 'geo_key'}; }
    if(resp.status !== 'OK') continue;
    const st = (resp.refined || {}).structure || {}, pt = (resp.result || {}).point || {};
    if(type === 'parcel' && /^\d{10}$/.test(st.level4LC || '') && st.level5) return {code: st.level4LC, jibun: st.level5, text: (resp.refined || {}).text || addr};
    if(pt.x && pt.y){
      const q2 = new URLSearchParams(Object.assign({}, base, {request: 'getAddress', type: 'parcel', point: pt.x + ',' + pt.y}));
      const r2 = await getJson(GEO + '?' + q2.toString());
      const res2 = r2.data && r2.data.response;
      const it = res2 && res2.status === 'OK' && [].concat(res2.result || [])[0];
      const s2 = it && it.structure || {};
      if(/^\d{10}$/.test(s2.level4LC || '') && s2.level5) return {code: s2.level4LC, jibun: s2.level5, text: it.text || addr};
    }
  }
  return {err: 'not_found'};
}

// 지번 "산12-3" → 대지 구분(산=1), 번 0012, 지 0003
function splitJibun(j){
  const m = String(j).replace(/\s/g, '').match(/^(산)?(\d+)(?:-(\d+))?/);
  if(!m) return null;
  return {gb: m[1] ? '1' : '0', bun: m[2].padStart(4, '0').slice(-4), ji: (m[3] || '0').padStart(4, '0').slice(-4)};
}

// 9번 답으로 고를 만한 용도 (애매하면 고르지 않아요)
function suggest(items){
  if(!items.length) return null; // 2026-11-28: 결과가 없는데 「주택」을 골라 주던 문제 고침
  const main = items.filter(x => !/부속/.test(x.part || ''));
  const L = (main.length ? main : items);
  const all = L.map(x => (x.use || '') + ' ' + (x.etc || '')).join(' ');
  if(/오피스텔/.test(all)) return 'officetel';
  if(L.every(x => /주택/.test(x.use || ''))) return 'house';
  if(L.every(x => /근린생활시설|업무시설|판매시설|숙박시설/.test(x.use || '') && !/주택/.test(x.etc || ''))) return 'retail';
  return null; // 근린생활시설 + 주택처럼 섞인 건물은 층마다 달라서 직접 골라요
}

export default async function handler(req, res){
  if(req.method !== 'POST'){ res.setHeader('Allow', 'POST'); return res.status(405).json({error: 'method'}); }
  if(!fromOurSite(req)) return res.status(403).json({error: 'origin'});
  if(tooMany(req, 'bldg', 20, 10 * 60 * 1000)) return res.status(429).json({error: 'busy'});

  const b = jsonBody(req) || {};
  let addr = String(b.addr || '').replace(/[<>&"'%\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if(addr.length < 4) return res.status(400).json({error: 'input'});
  if(!/^서울/.test(addr)) addr = '서울특별시 ' + addr; // 서울 기준 앱이라 시를 붙여요

  const vkey = process.env.BROKER_KEY, raw = process.env.BLDG_KEY;
  if(!vkey || !raw){ logFail((!vkey ? 'BROKER_KEY ' : '') + (!raw ? 'BLDG_KEY ' : '') + '없음'); return res.status(500).json({error: 'no_key'}); }
  let hkey = raw.trim(); if(/%[0-9A-F]{2}/i.test(hkey)){ try { hkey = decodeURIComponent(hkey); } catch(e) {} } // 인코딩 키를 넣어도 돼요

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const domain = String(process.env.BROKER_DOMAIN || '').trim() || 'https://' + host;

  try {
    const p = await parcelOf(addr, vkey, domain);
    if(p.err) return res.status(p.err === 'not_found' ? 200 : 502).json(p.err === 'not_found' ? {items: [], reason: 'addr'} : {error: 'geo'});
    if(!/^11/.test(p.code)) return res.status(200).json({items: [], reason: 'seoul'});
    const j = splitJibun(p.jibun); if(!j) return res.status(200).json({items: [], reason: 'addr'});

    const q = new URLSearchParams({serviceKey: hkey, sigunguCd: p.code.slice(0, 5), bjdongCd: p.code.slice(5, 10), platGbCd: j.gb, bun: j.bun, ji: j.ji, _type: 'json', numOfRows: '20', pageNo: '1'});
    const r = await getJson(HUB + '?' + q.toString(), 12000);
    if(!r.data){
      // 2026-11-28: 도로명 주소에서 바꾼 지번으로 부르면 빈 응답이 올 때가 있어요. 오류 대신 "지번으로 다시"를 안내하고, 원인을 찾게 바꾼 코드·지번만 남겨요(키·주소 글자는 남기지 않아요)
      logFail('건축HUB 응답 ' + r.status + ' 길이 ' + String(r.text || '').length + ' · 코드 ' + p.code + ' 지번 ' + j.gb + '-' + j.bun + '-' + j.ji + ' ' + String(r.text || '').replace(/[A-Za-z0-9+/=]{30,}/g, '***').slice(0, 80));
      if(r.status === 401 || r.status === 403) return res.status(502).json({error: 'hub_key'});
      return res.status(200).json({items: [], reason: 'addr'});
    }
    const head = (r.data.response || {}).header || {};
    if(head.resultCode && head.resultCode !== '00'){ logFail('건축HUB 결과 ' + head.resultCode + ' ' + (head.resultMsg || '')); return res.status(502).json({error: 'hub'}); }
    const raw2 = (((r.data.response || {}).body || {}).items || {}).item;
    const items = [].concat(raw2 || []).map(x => ({
      name: [x.bldNm, x.dongNm].filter(Boolean).join(' ').trim(),
      use: String(x.mainPurpsCdNm || '').trim(), etc: String(x.etcPurps || '').trim(),
      kind: String(x.regstrKindCdNm || '').trim(), part: String(x.mainAtchGbCdNm || '').trim(),
      apr: String(x.useAprDay || '').replace(/^(\d{4})(\d{2})(\d{2}).*$/, '$1-$2-$3'),
      addr: String(x.newPlatPlc || x.platPlc || '').trim()
    })).filter(x => x.use || x.etc);
    console.log('건축물대장 조회 성공 · ' + items.length + '건');
    return res.status(200).json({items: items.slice(0, 6), total: items.length, place: p.text, pick: suggest(items)});
  } catch(e) {
    logFail(e.name === 'AbortError' ? '시간 초과' : '연결 오류');
    return res.status(502).json({error: 'lookup'});
  }
}
