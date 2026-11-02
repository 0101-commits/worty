// v11 4단계: KBS RSS·본문·문장 나누기·점수·공부 자료 검사
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, deckHits, extractBody, parseKbsRss, prefilter, scoreCandidate, splitSentences, wordCount } from '../scripts/articles/kbs.mjs';
import { acceptLesson } from '../scripts/articles/lesson.mjs';
import { prevWeekday } from '../scripts/articles/run.mjs';

const RSS = `<rss><channel><item><title><![CDATA[Nach Binance-Hack: Kommission prüft Börsen]]></title><link><![CDATA[https://world.kbs.co.kr/service/news_view.htm?lang=g&Seq_Code=109823]]></link>
<description><![CDATA[[Wirtschaft] : <BR>Die Behörden haben eine Prüfung eingeleitet.]]></description><pubDate>Mon, 02 Nov 2026 14:53:38 +0900</pubDate></item>
<item><title><![CDATA[BTS erreicht zehn Milliarden Streams]]></title><link><![CDATA[http://world.kbs.co.kr/service/news_view.htm?lang=g&Seq_Code=109800]]></link><description><![CDATA[x]]></description><pubDate>Mon, 02 Nov 2026 10:00:00 +0900</pubDate></item></channel></rss>`;

test('parseKbsRss · prefilter', () => {
  const items = parseKbsRss(RSS);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { ext_id: '109823', url: 'https://world.kbs.co.kr/service/news_view.htm?lang=g&Seq_Code=109823', title: 'Nach Binance-Hack: Kommission prüft Börsen', category: 'Wirtschaft', published_at: '2026-11-02T05:53:38.000Z', desc: 'Die Behörden haben eine Prüfung eingeleitet.' });
  assert.equal(items[1].url.startsWith('https://'), true);
  assert.deepEqual(prefilter(items, []).map((x) => x.ext_id), ['109823'], '분야 없음·연예 제목 빼기');
  assert.deepEqual(prefilter(items, [{ ext_id: '109823' }]), []);
});

test('extractBody · splitSentences · wordCount', () => {
  const html = `<div class="body_txt fr-view">
    Die Behörden haben eine Prüfung eingeleitet. <br />\n<br />\nDie Kommission lud am Montag (2. November) Vertreter ein. Besprochen wurden z.B. Maßnahmen. <br />\n<br />\n
    <!-- Key word --></div>`;
  const p = extractBody(html);
  assert.deepEqual(p, ['Die Behörden haben eine Prüfung eingeleitet.', 'Die Kommission lud am Montag (2. November) Vertreter ein. Besprochen wurden z.B. Maßnahmen.']);
  assert.deepEqual(splitSentences(p[1]), ['Die Kommission lud am Montag (2. November) Vertreter ein.', 'Besprochen wurden z.B. Maßnahmen.']);
  assert.equal(wordCount(p), 18);
  assert.deepEqual(extractBody('<html>nichts</html>'), []);
});

test('점수 · 같은 사건 하나만 · 단어장 낱말 수 · 전 평일', () => {
  assert.equal(scoreCandidate({ words: 50, deckHits: 9, category: 'Politik' }), 0);
  assert.equal(scoreCandidate({ words: 130, deckHits: 20, category: 'Politik' }), 1.5);
  assert.equal(scoreCandidate({ words: 130, deckHits: 0, category: 'Politik' }, ['Politik']), 0.7);
  const d = dedupe([{ title: 'Binance-Hack: FBI', score: 1 }, { title: 'Binance-Hack: Kommission', score: 2 }, { title: 'Exporte steigen', score: 0.5 }], ['Lee und Merz in Seoul']);
  assert.deepEqual(d.map((x) => x.title), ['Binance-Hack: Kommission', 'Exporte steigen']);
  assert.equal(deckHits('Die Behörden haben Maßnahmen eingeleitet', ['Behörde', 'Maßnahme', 'sich freuen']), 2);
  assert.equal(prevWeekday('2026-11-02'), '2026-10-30', '월 → 금');
  assert.equal(prevWeekday('2026-11-04'), '2026-11-03');
});

test('acceptLesson: 모양 맞으면 통과, 틀리면 null', () => {
  const sentences = ['Die Behörden haben eine Sicherheitsüberprüfung eingeleitet.', 'Die Kommission lud Vertreter großer Börsen zu einer Sitzung ein.'];
  const ok = [{
    summary_ko: ['가', '나', '다'], key: ['Behörde', 'Unbekannt'],
    sentences: [{ ko: '당국이 보안 점검을 시작했다.' }, { ko: '위원회가 대형 거래소 대표들을 회의에 불렀다.' }],
    glossary: [
      { form: 'Behörden', lemma: 'Behörde', pos: 'noun', gender: 'die', gloss_ko: '당국', level: 'B1' },
      { form: 'Sicherheitsüberprüfung', lemma: 'Sicherheitsüberprüfung', pos: 'noun', gender: 'die', gloss_ko: '보안 점검', level: 'C1' },
      { form: 'eingeleitet', lemma: 'einleiten', pos: 'verb', gloss_ko: '시작하다', level: 'B2' },
      { form: 'Vertreter', lemma: 'Vertreter', pos: 'noun', gender: 'der', gloss_ko: '대표', level: 'B1' },
      { form: 'Börsen', lemma: 'Börse', pos: 'noun', gender: 'die', gloss_ko: '거래소', level: 'B2' },
      { form: 'Sitzung', lemma: 'Sitzung', pos: 'noun', gender: 'die', gloss_ko: '회의', level: 'B1' },
      { form: 'NichtImText', lemma: 'x', pos: 'noun', gloss_ko: 'x', level: 'B1' },
    ],
    expressions: [{ base: 'eine Überprüfung einleiten', meaning_ko: '점검을 시작하다', s: 0 }, { base: 'jemanden zu etwas einladen', meaning_ko: '누구를 무엇에 부르다', s: 1 }, { base: 'eine Sitzung abhalten', meaning_ko: '회의를 열다', s: 1 }, { base: 'einzeln', meaning_ko: '한 낱말은 빠짐', s: 0 }],
    quiz: [
      { type: 'topic', q_ko: '무엇에 관한?', options: ['a', 'b', 'c', 'd'], answer: 1 },
      { type: 'detail', q_ko: '누구를?', options: ['a', 'b', 'c'], answer: 0 },
      { type: 'article', noun: 'Sitzung', answer: 'der', s: 1 },
      { type: 'cloze', s: 1, text: 'Die Kommission lud Vertreter zu einer ___ ein.', options: ['Sitzung', 'Haus', 'Weg', 'Tag'], answer: 0 },
    ],
  }];
  const l = acceptLesson(ok, { sentences });
  assert.ok(l);
  assert.equal(l.glossary.length, 6, '본문에 없는 꼴 빼기');
  assert.deepEqual(l.key, ['Behörde']);
  assert.equal(l.expressions.length, 3, '한 낱말 표현 빼기');
  assert.equal(l.quiz[2].answer, 'die', '관사는 낱말 목록의 성을 믿음');
  assert.equal(l.sentences[1].de, sentences[1]);
  assert.equal(acceptLesson([{ ...ok[0], sentences: [{ ko: '하나만' }] }], { sentences }), null, '번역 수 틀림');
  assert.equal(acceptLesson([{ ...ok[0], quiz: ok[0].quiz.slice(0, 3) }], { sentences }), null, '퀴즈 3개');
});

test('extractBody: 사진 기사(사진 상자·설명 지움)', () => {
  const html = `<div class="body_txt fr-view">
    <div class="img_box top" id="ele1"><div class="photo no-print"><img src="x.jpg" alt="a"></div><p class="cap no-print">Photo : YONHAP News</p></div>
    Schnäppchenjäger haben dem Kospi verholfen. <br />\n<br />\nDer Leitindex stieg. <br />
    <!-- Key word --></div>`;
  assert.deepEqual(extractBody(html), ['Schnäppchenjäger haben dem Kospi verholfen.', 'Der Leitindex stieg.']);
});
