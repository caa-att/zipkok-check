// AI 계약 분석 0단계: 가짜 서류 읽기 시험 돌리기 (2026-11-28)
// 쓰는 법 (PowerShell):
//   미리보기 주소는 Vercel 로그인 보호가 있어서 $env:VERCEL_BYPASS(Deployment Protection → Protection Bypass for Automation 값)도 넣어요.
//   $env:DOC_URL="https://미리보기주소/api/doc-test"; $env:DOC_TEST_SECRET="(Vercel에 넣은 값)"; node tests/doc0/run.mjs A 1
//   인자: 방법(A 또는 B) · 반복 횟수(기본 1) · 사례 이름 일부(선택)
// 결과: tests/doc0/out/result_방법_시각.json, 화면에 사례별 통과·실패와 토큰·시간 합계
// 방법 B는 브라우저 없이 HTML의 글자만 뽑아 흉내 내요(실제 PDF 글자층과 같이 말소 빨간 줄이 사라져요).
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(HERE, 'out');
const [method = 'A', rep = '1', only = ''] = process.argv.slice(2);
const URL_ = process.env.DOC_URL, SECRET = process.env.DOC_TEST_SECRET;
if(!URL_ || !SECRET){ console.error('DOC_URL과 DOC_TEST_SECRET을 넣어 주세요.'); process.exit(1); }

const htmlText = h => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<(br|\/p|\/tr|\/h\d|\/li|\/div)>/g, '\n').replace(/<\/t[dh]>/g, ' | ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
async function ask(kind, dir){
  const body = {kind, method};
  if(method === 'A') body.pdf = (await readFile(path.join(dir, kind + '.pdf'))).toString('base64');
  else body.text = htmlText(await readFile(path.join(dir, kind + '.html'), 'utf8'));
  const r = await fetch(URL_, {method: 'POST', headers: Object.assign({'Content-Type': 'application/json', 'x-test-secret': SECRET}, process.env.VERCEL_BYPASS ? {'x-vercel-protection-bypass': process.env.VERCEL_BYPASS} : {}), body: JSON.stringify(body)});
  return r.json().catch(()=>({error: 'json'}));
}

const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
function grade(name, ans, got){
  const fails = [], reg = got.reg && got.reg.data, bl = got.bldg && got.bldg.data, ct = got.contract && got.contract.data;
  if(name.startsWith('c13')){ if(!reg || reg.doc_ok !== false) fails.push('다른 서류를 등기부로 읽음'); return fails; }
  if(!reg) return ['등기부 읽기 실패 ' + JSON.stringify(got.reg).slice(0, 80)];
  if(name.startsWith('c12')){
    const sawEul = (reg.missing || []).join(' ');
    if(!/을구|3쪽|3 쪽/.test(sawEul) && !(reg.mortgages || []).length) fails.push('을구가 빠졌는데 「확인 못 함」이 없음');
    return fails;
  }
  const live = (reg.mortgages || []).filter(m=>!m.deleted).map(m=>m.amount_won), del = (reg.mortgages || []).filter(m=>m.deleted).map(m=>m.amount_won);
  if(ans.live_mortgages && !sameSet(live, ans.live_mortgages)) fails.push('살아 있는 근저당 ' + JSON.stringify(live) + ' ≠ ' + JSON.stringify(ans.live_mortgages));
  if(ans.deleted_mortgages && !sameSet(del, ans.deleted_mortgages)) fails.push('말소 근저당 ' + JSON.stringify(del) + ' ≠ ' + JSON.stringify(ans.deleted_mortgages));
  const owners = (reg.owners || []).map(o=>o.name.replace(/\s/g, ''));
  if(ans.owner && !ans.owner.every(n=>owners.some(o=>o.includes(n)))) fails.push('소유자 ' + JSON.stringify(owners));
  const kinds = (reg.other_rights || []).filter(x=>!x.deleted).map(x=>x.kind).join(' ');
  (ans.flags || []).filter(f=>f !== '공동명의').forEach(f=>{ if(!kinds.includes(f)) fails.push(f + ' 놓침'); });
  if(ans.flags && ans.flags.includes('공동명의') && owners.length < 2) fails.push('공동명의 놓침');
  if(!(ans.flags || []).length && /신탁|압류|가처분|경매/.test(kinds)) fails.push('없는 권리 만듦: ' + kinds);
  if(bl && ans.use && !String((bl.main_use || {}).value || '').includes(ans.use.replace('제2종', ''))) fails.push('용도 ' + JSON.stringify(bl.main_use));
  if(bl && ans.violation != null && !!(bl.violation || {}).value !== ans.violation) fails.push('위반건축물 ' + JSON.stringify(bl.violation));
  if(!bl) fails.push('대장 읽기 실패');
  if(!ct) fails.push('계약서 읽기 실패');
  // 대조에 쓸 값이 제대로 뽑혔는지(대조 자체는 2단계에서 코드가 해요)
  if(ct && name.startsWith('c08') && !String((ct.landlord || {}).value || '').includes('한')) fails.push('계약서 임대인 ' + JSON.stringify(ct.landlord));
  if(ct && name.startsWith('c09') && !String((ct.unit || {}).value || '').includes('202')) fails.push('계약서 호수 ' + JSON.stringify(ct.unit));
  // 근거 문장이 서류에 있는지(지어낸 값 막기): 숫자·이름 몇 개만 가볍게 봐요
  (reg.mortgages || []).forEach(m=>{ if(!String(m.quote || '').replace(/[,\s]/g, '').includes(String(m.amount_won))) fails.push('근거 문장에 금액 없음 ' + m.quote); });
  return fails;
}

const answers = JSON.parse(await readFile(path.join(OUT, 'answers.json'), 'utf8'));
const names = (await readdir(OUT, {withFileTypes: true})).filter(d=>d.isDirectory() && d.name.includes(only)).map(d=>d.name).sort();
const log = [], sum = {calls: 0, in: 0, out: 0, ms: 0, err: 0, pass: 0, fail: 0};
for(let k = 1; k <= +rep; k++){
  for(const name of names){
    const dir = path.join(OUT, name), got = {};
    for(const kind of ['reg', 'bldg', 'contract']){
      got[kind] = await ask(kind, dir); sum.calls++;
      if(got[kind].usage){ sum.in += got[kind].usage.in; sum.out += got[kind].usage.out; } else sum.err++;
      sum.ms += got[kind].ms || 0;
    }
    const fails = grade(name, answers[name], got);
    fails.length ? sum.fail++ : sum.pass++;
    console.log((fails.length ? '실패 ' : '통과 ') + k + '회 ' + name + (fails.length ? ' · ' + fails.join(' / ') : ''));
    log.push({round: k, name, fails, got});
  }
}
console.log('\n방법 ' + method + ' · 사례 ' + (sum.pass + sum.fail) + '번 중 통과 ' + sum.pass + ' · 호출 ' + sum.calls + '번(오류 ' + sum.err + ') · 보낸 토큰 ' + sum.in + ' · 받은 토큰 ' + sum.out + ' · 평균 ' + Math.round(sum.ms / Math.max(1, sum.calls)) + 'ms');
await writeFile(path.join(OUT, 'result_' + method + '_' + Date.now() + '.json'), JSON.stringify({method, sum, log}, null, 1));
