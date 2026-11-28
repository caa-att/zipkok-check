// AI 계약 분석 2단계: 대화에서 「약속」을 맞게 뽑는지 실제 Gemini로 시험해요 (2026-11-29)
// 쓰는 법 (PowerShell): node tests/doc0/talk_run.mjs 3
//   미리보기 주소의 api/talk를 불러요. Vercel 보호 통과 값은 화면에 안 보이게 물어봐요.
//   대화 분석은 10분에 10번까지라 61초씩 쉬어요(3번 반복이면 약 12분).
// 가짜 대화만 써요. 결과: tests/doc0/out/talk_시각.json
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL_ = process.env.TALK_URL || 'https://zipkok-check-git-feature-doc-analysis-caa-att.vercel.app/api/talk';
const rep = +(process.argv[2] || 3);
function hidden(q){
  return new Promise(ok=>{
    process.stdout.write(q); let v = '';
    const inp = process.stdin; if(inp.setRawMode) inp.setRawMode(true); inp.resume(); inp.setEncoding('utf8');
    const on = ch => { for(const c of ch){
      if(c === '\r' || c === '\n'){ if(inp.setRawMode) inp.setRawMode(false); inp.pause(); inp.removeListener('data', on); process.stdout.write('\n'); return ok(v.trim()); }
      if(c === '\u0003') process.exit(1);
      if(c === '\u007f' || c === '\b') v = v.slice(0, -1); else v += c;
    } };
    inp.on('data', on);
  });
}
const BYPASS = process.env.VERCEL_BYPASS || await hidden('Vercel 보호 통과 값(Protection Bypass)을 붙여 넣고 Enter: ');

const CASES = [
  ['t1_말소약속', '세입자: 등기부 보니까 대출이 있던데요.\n중개사: 이 집 대출 있는 건 잔금 날 집주인이 다 갚고 근저당 말소해 드릴 거예요. 걱정 안 하셔도 돼요.', ['mort_clear']],
  ['t2_반환_해지', '세입자: 보증금은 언제 받을 수 있어요?\n중개사: 보증금은 계약 끝나는 날 바로 돌려드려요. 그리고 중간에 나가셔도 두 달 전에만 말씀해 주시면 돼요.', ['deposit_return', 'early_exit']],
  ['t3_대출금지_수리', '세입자: 잔금 뒤에 집주인이 대출을 더 받으면 어떡해요?\n중개사: 잔금 치르고 나서 집주인이 대출 더 받거나 하는 일은 없게 할게요. 에어컨도 고장 나면 바로 새 걸로 바꿔 드려요.', ['no_new_loan', 'repair']],
  ['t4_약속없음', '중개사: 이 집은 보증금 천에 월세 오십이에요. 관리비는 칠만 원이고요.\n세입자: 중간에 나가도 돼요?\n중개사: 그건 집주인한테 여쭤봐야 해요.', []]
];
const same = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...b].sort());
const host = new URL(URL_).host, log = []; let pass = 0, fail = 0;
for(let k = 1; k <= rep; k++) for(const [name, text, want] of CASES){
  const r = await fetch(URL_, {method: 'POST', redirect: 'manual', headers: {'Content-Type': 'application/json', Origin: 'https://' + host, 'x-vercel-protection-bypass': BYPASS}, body: JSON.stringify({text})});
  if(r.status === 302 || r.status === 401){ console.error('Vercel 로그인 보호에 막혔어요. 보호 통과 값을 확인해 주세요.'); process.exit(1); }
  const d = await r.json().catch(()=>({}));
  const got = (d.promises || []).map(p=>p.topic).filter(t=>t !== 'other');
  const ok = r.status === 200 && same(got, want);
  ok ? pass++ : fail++;
  console.log((ok ? '통과 ' : '실패 ') + k + '회 ' + name + (ok ? '' : ' · 받은 것 ' + JSON.stringify(got) + ' · 기대 ' + JSON.stringify(want) + (r.status !== 200 ? ' · 상태 ' + r.status : '')));
  log.push({round: k, name, status: r.status, promises: d.promises || null});
  await new Promise(ok=>setTimeout(ok, 61000));
}
console.log('\n약속 뽑기 · ' + (pass + fail) + '번 중 통과 ' + pass);
await writeFile(path.join(HERE, 'out', 'talk_' + Date.now() + '.json'), JSON.stringify({pass, fail, log}, null, 1));
process.exit(0);
