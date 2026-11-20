// 녹음 받아쓰기: 사용자가 동의하고 "분석하기"를 누르면, 앱이 녹음을 약 100초씩 나눈 소리 파일(WAV)을
// 하나씩 보내고, Gemini가 들리는 말을 글로 받아 적어 돌려줘요.
// 녹음과 받아 적은 글은 이 서버에 저장하지 않아요. 앱도 녹음은 저장하지 않고 받아 적은 글만 기기에 저장해요.
import {AUDIO_MODEL, gemini, fromOurSite, tooMany, rawBody, mask, logFail} from './_gemini.mjs';

const MAX_BYTES = 4 * 1024 * 1024; // Vercel 함수가 받을 수 있는 크기(약 4.5MB)보다 조금 작게

const SYSTEM = [
  '너는 한국어 대화 녹음을 글로 받아 적는 도우미야.',
  '녹음은 전월세 집을 보러 간 사람과 공인중개사(또는 집주인)가 나눈 대화일 가능성이 높아.',
  '들리는 말을 고치거나 요약하지 말고 들리는 그대로 한국어로 받아 적어.',
  '금액·날짜·숫자는 들린 그대로 적어(예: 보증금 천에 오십 → "보증금 천에 오십").',
  '말하는 사람이 바뀌면 줄을 바꿔. 누가 말했는지 확실할 때만 줄 앞에 "중개사:", "집주인:", "나:"를 붙이고, 확실하지 않으면 붙이지 마.',
  '들리지 않는 부분은 지어내지 말고 "(잘 안 들림)"이라고 적어.',
  '말소리가 없으면 아무것도 쓰지 마.',
  '받아 적은 글 말고 다른 설명은 쓰지 마.'
].join('\n');

export default async function handler(req, res){
  if(req.method !== 'POST'){ res.setHeader('Allow', 'POST'); return res.status(405).json({error: 'method'}); }
  if(!fromOurSite(req)) return res.status(403).json({error: 'origin'});
  // 한 사람이 10분에 60조각(약 100분 녹음)까지
  if(tooMany(req, 'transcribe', 60, 10 * 60 * 1000)) return res.status(429).json({error: 'busy'});

  const buf = await rawBody(req, MAX_BYTES);
  if(!buf) return res.status(413).json({error: 'too_big'});
  // WAV 파일인지 맨 앞 글자로 확인해요 (앱이 늘 WAV로 바꿔서 보내요)
  if(buf.length < 1000 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return res.status(400).json({error: 'format'});

  try {
    const text = await gemini({
      model: AUDIO_MODEL, tag: '받아쓰기', system: SYSTEM, temperature: 0, timeout: 55000,
      parts: [
        {inlineData: {mimeType: 'audio/wav', data: buf.toString('base64')}},
        {text: '이 녹음을 받아 적어 줘.'}
      ]
    });
    return res.status(200).json({text: mask(String(text).replace(/\*\*/g, '')).trim().slice(0, 8000)});
  } catch(e) {
    if(e.message !== 'ai' && e.message !== 'no_key') logFail('받아쓰기', '연결 오류 · ' + mask(e.message || '').slice(0, 120));
    return res.status(502).json({error: 'ai'});
  }
}
