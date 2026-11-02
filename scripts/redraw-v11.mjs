// 2026-11-02 그림 눈 검토(355장)에서 「틀림·기호만·틀·글자·그림체 어긋남」으로 나온 36단어의 새 장면(v11 규칙) + 다시 그리기 SQL 만들기.
//   node scripts/redraw-v11.mjs [출력.sql]    기본 출력 out/audit_261102/redraw_v11.sql (Postgres 꼴, 실행은 사람이: node scripts/db/remote-sql.mjs <파일>)
// SQL 이 하는 일 — 장면을 「[pin] 」을 붙여 바꾸고(daily.mjs 가 다시 쓰지 않는다 · 그림 프롬프트에는 떼고 보냄) image_status 를 'none' 으로 되돌려
// 매일 작업의 「그림 없는 단어」 목록(runway need_image: image_status='none' AND scene_en IS NOT NULL, 공부 중인 카드 → 학습 순서)에 다시 들게 한다.
// 잘못된 옛 그림은 새 그림이 올라오기 전까지 카드에서 빠진다(image_id 도 비움). 추상어 18개는 두 칸 장면.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** id → [낱말, 새 장면]. 규칙: 직업=그 역할만의 물건 둘+장소 · 동사=가장 뚜렷한 순간 · 형용사=성질+반대 · 추상=두 칸. 금지 소품·기호 없음 */
export const SCENES = {
  w0007: ['gar', 'Two panels: left — Borti sits beside a food bowl that holds only a few crumbs, a round wall clock above; right — same room, same clock, Borti beside a bowl that is completely bare and shining clean'],
  w0008: ['stimmen', 'Borti standing on tiptoe dropping a folded paper into the slot of a tall ballot urn, a kitten waiting in line behind him'],
  w0010: ['verschwinden', "A magician's top hat on a table with only the tips of two long rabbit ears still showing above the rim and a few puffs of smoke, Borti staring at it with wide eyes"],
  w0011: ['einzig', 'Borti proudly hugging the one and only big yellow balloon on a bare floor, a kitten beside him with empty paws looking at it'],
  w0014: ['Tod', 'Two panels: left — Borti sits beside a tall potted flower with bright upright petals; right — same pot, same place, the flower has dropped its petals and hangs bent over, Borti looks down sadly'],
  w0039: ['schießen', 'Borti mid-kick, one hind leg swung back, a soccer ball flying into the top corner of a goal net while a kitten goalkeeper dives and misses'],
  w0043: ['kämpfen', 'Borti in red boxing gloves throwing a punch at a second puppy in blue gloves inside a small boxing ring with ropes'],
  w0074: ['Anwalt', 'Borti in a black gown with two white collar tabs standing next to a big pair of balance scales of justice, one front paw pointing at the scales'],
  w0110: ['fassen', 'Borti snapping up a red ball with both front paws as it drops from above, ears flying up, mouth open'],
  w0185: ['Vergangenheit', 'Two panels: left — grown-up Borti on a couch holds a small old photo in his paws and looks at it dreamily; right — same couch, same pose, a round dream cloud above him shows Borti as a tiny puppy playing with a ball'],
  w0224: ['erfüllen', 'Borti pressing the very last piece into a nearly finished jigsaw puzzle picture of a house, tail wagging'],
  w0229: ['Risiko', 'Two panels: left — Borti crosses a wide solid stone bridge over a river; right — same river, same Borti, he crosses on a thin bending plank with the water far below'],
  w0237: ['Energie', 'Two panels: left — Borti lies limp on the floor with a droopy tail beside a small gray battery; right — same spot, the battery is bright yellow and Borti leaps high with ears flying'],
  w0283: ['tauchen', 'Borti in a diving mask and flippers swimming down under the water, a single wavy line of the surface far above, bubbles rising, a starfish on the sandy bottom'],
  w0327: ['Zweifel', 'Two panels: left — Borti confidently grabs the one red ball in the room, tail up; right — same room, a red and a blue ball lie there and Borti holds a paw over each, ears drooping, unable to choose'],
  w0330: ['gründen', 'Borti pulling the cloth off a small brand-new shop front while a kitten claps, a cut red ribbon and big scissors on the ground'],
  w0384: ['möglicherweise', 'Two panels: left — Borti under a bright sun wearing sunglasses; right — same spot, same pose, a gray rain cloud has appeared and Borti holds an umbrella instead of wearing the sunglasses'],
  w0396: ['Alarm', 'Borti jolted upright in bed with ears straight up beside a ringing alarm clock with two bells that jumps on the nightstand, short motion lines around the clock'],
  w0406: ['Täter', 'Borti in a black eye mask and a striped shirt running away with a sack of coins over his shoulder, a small police puppy pointing after him'],
  w0420: ['tödlich', 'Borti freezing with ears flat in front of a huge coiled snake with bared fangs and a red-and-yellow warning pattern, a harmless little caterpillar crawling beside it'],
  w0532: ['ausschließen', 'Borti holding a garden gate shut with his front paws while a kitten stands outside the gate alone and a group of puppies plays together in the garden inside'],
  w0548: ['absolut', 'Two panels: left — Borti beside a cookie jar that is almost full; right — same table, same jar, now filled completely to the brim with no room for one more cookie, Borti proud'],
  w0563: ['Technologie', 'Borti waving at a big smiling robot with an antenna on its head and gear wheels on its chest, the robot waves back'],
  w0639: ['verraten', 'Borti whispering with a paw beside his mouth into the ear of a kitten, while his best friend, a puppy, stands behind him with tears in his eyes watching'],
  w0674: ['Alternative', 'Two panels: left — Borti stands at the end of one single path that stops at a wall; right — same spot, the path now splits in two, one path leading to a house and one to a lake, Borti looks at both'],
  w0750: ['Medium', 'A television, a radio and a tablet standing side by side on a low table, Borti sitting in front of them listening to the radio with ears up'],
  w0775: ['Forderung', 'Two panels: left — Borti sits quietly beside his empty food bowl; right — same spot, same bowl, Borti pushes the bowl forward toward a kitten holding a bag of dog food, ears up, one paw pointing at the bowl'],
  w0843: ['Saison', 'Borti standing in front of four trees in a row, from left to right a pink-blossom tree, a green leafy tree, an orange-leaved tree and a bare snow-covered tree'],
  w0893: ['Kritik', 'Two panels: left — Borti proudly shows a painting of a house to a kitten who smiles; right — same scene, the kitten frowns and points at the crooked roof of the painting while Borti ears droop'],
  w1018: ['Senior', 'Borti walking beside a very old gray-muzzled dog with round glasses, a cane and a knitted cardigan, helping to carry his bag'],
  w1024: ['Protest', 'Two panels: left — Borti and three other puppies stand quietly in front of a town hall; right — same place, same puppies, they march in a line with open mouths and one paw raised high'],
  w1724: ['Schuld', 'Two panels: left — Borti sits happily beside a white vase on a table; right — same table, the vase lies broken on the floor and Borti sits beside it with drooping ears while a kitten points at him'],
  w8393: ['töten', 'A flyswatter raised high in Borti paws just above a surprised fly sitting on a table, Borti braced and squinting'],
  w8397: ['Konsequenz', 'Two panels: left — Borti pushes the first of a long row of standing dominoes; right — same table, same row, every domino lies fallen flat and the last one has knocked down a small block tower'],
  w8463: ['Vorfall', 'Two panels: left — a ball rolls along a quiet street where Borti walks; right — same street, a bicycle lies on its side with a spinning wheel and spilled apples, Borti stares at it with wide eyes'],
  w8487: ['Digitalisierung', 'Two panels: left — Borti stands beside a tall shelf crammed with thick folders; right — same room, same shelf now empty except for one tablet, Borti smiles holding a thin tablet'],
};

const q = (s) => `'${s.replace(/'/g, "''")}'`;

/** Postgres 꼴 UPDATE 문 목록 */
export function buildSql(scenes = SCENES) {
  const lines = [
    '-- 2026-11-02 v11 다시 그리기 36단어: 새 장면([pin] = 매일 작업이 다시 쓰지 않음) + 그림 없는 단어 목록으로 되돌림(image_status none)',
    '-- 실행: node scripts/db/remote-sql.mjs out/audit_261102/redraw_v11.sql  (옛 그림은 새 그림이 올라올 때까지 카드에서 빠진다)',
  ];
  for (const [id, [lemma, scene]] of Object.entries(scenes)) {
    lines.push(`UPDATE words SET scene_en = ${q(`[pin] ${scene}`)}, image_status = 'none', image_id = NULL WHERE id = ${q(id)}; -- ${lemma}`);
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out', 'audit_261102', 'redraw_v11.sql');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, buildSql());
  console.log(`${Object.keys(SCENES).length}단어 → ${out}`);
}
