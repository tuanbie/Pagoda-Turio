/**
 * Content for the wish tree, the stick tube and the riddle table.
 *
 * Deliberately NOT fortune telling: no "good / bad" lots, no predictions, no numbered
 * fortunes. The tree gives a wish (a kind word to someone), the tube gives a folk proverb
 * with its plain meaning, the riddles are folk riddles. Vietnamese rules on festivals and
 * cultural offences list xin xăm / xóc thẻ / xem bói as superstitious practices, and the
 * terms page says the software does not tell fortunes.
 *
 * Lao and Khmer fall back to English until native speakers can review a translation.
 */
import type { Locale } from '../i18n/index.ts';

type Lang = 'vi' | 'en';
const lang = (l: Locale): Lang => (l === 'vi' ? 'vi' : 'en');

const WISHES: Record<Lang, string[]> = {
  vi: [
    'Chúc bạn một ngày bình an, lòng nhẹ như mây.',
    'Mong bạn luôn khỏe mạnh và có giấc ngủ ngon.',
    'Chúc gia đình bạn đầm ấm, yêu thương.',
    'Mong mọi việc bạn làm đều suôn sẻ, nhẹ nhàng.',
    'Chúc bạn tìm thấy niềm vui trong những điều nhỏ bé.',
    'Mong bạn có thêm một người bạn tốt trong năm nay.',
    'Chúc bạn học hành tấn tới, công việc thuận lợi.',
    'Mong lòng bạn luôn bao dung và an yên.',
    'Chúc bạn đủ kiên nhẫn cho những ngày khó khăn.',
    'Mong bạn luôn được yêu thương và biết yêu thương.',
    'Chúc bạn một năm mới vui vẻ, nhiều tiếng cười.',
    'Mong bạn luôn giữ được sự tử tế.',
    'Chúc bạn sức khỏe dồi dào, tinh thần sáng suốt.',
    'Mong những người bạn thương đều bình an.',
    'Chúc bạn có những bữa cơm ấm cúng bên người thân.',
    'Mong bạn biết nghỉ ngơi khi mệt và mạnh mẽ khi cần.',
    'Chúc bạn hôm nay mỉm cười nhiều hơn hôm qua.',
    'Mong bạn luôn có một góc bình yên của riêng mình.',
    'Chúc bạn đi xa bình an, trở về vui vẻ.',
    'Mong mọi lo âu của bạn nhẹ dần theo làn gió.',
  ],
  en: [
    'May your day be calm and your heart as light as a cloud.',
    'Wishing you good health and good sleep.',
    'May your home be warm and full of love.',
    'May everything you do go smoothly and gently.',
    'Wishing you joy in the small things.',
    'May you make one more good friend this year.',
    'Wishing you good progress in your studies and your work.',
    'May your heart stay open and at peace.',
    'Wishing you patience for the hard days.',
    'May you always be loved, and know how to love.',
    'Wishing you a happy new year full of laughter.',
    'May you always keep your kindness.',
    'Wishing you strength of body and clarity of mind.',
    'May everyone you care about be safe.',
    'Wishing you warm meals with the people you love.',
    'May you rest when tired and be strong when needed.',
    'Wishing you more smiles today than yesterday.',
    'May you always have a quiet corner of your own.',
    'Safe travels, and a happy return.',
    'May your worries drift away on the wind.',
  ],
};

export interface Saying {
  text: string;
  meaning: string;
}
const SAYINGS: Record<Lang, Saying[]> = {
  vi: [
    { text: 'Uống nước nhớ nguồn.', meaning: 'Biết ơn những người đã cho mình điều tốt đẹp.' },
    { text: 'Ăn quả nhớ kẻ trồng cây.', meaning: 'Nhớ công sức của người đi trước.' },
    { text: 'Lá lành đùm lá rách.', meaning: 'Giúp đỡ người đang khó khăn hơn mình.' },
    { text: 'Một cây làm chẳng nên non, ba cây chụm lại nên hòn núi cao.', meaning: 'Cùng nhau thì làm được việc lớn.' },
    { text: 'Có công mài sắt, có ngày nên kim.', meaning: 'Kiên trì thì việc khó cũng thành.' },
    { text: 'Lời nói chẳng mất tiền mua, lựa lời mà nói cho vừa lòng nhau.', meaning: 'Nói năng nhẹ nhàng, tử tế.' },
    { text: 'Đi một ngày đàng, học một sàng khôn.', meaning: 'Mỗi trải nghiệm đều dạy ta điều mới.' },
    { text: 'Tốt gỗ hơn tốt nước sơn.', meaning: 'Phẩm chất bên trong quý hơn vẻ ngoài.' },
    { text: 'Thương người như thể thương thân.', meaning: 'Đối xử với người khác như với chính mình.' },
    { text: 'Gần mực thì đen, gần đèn thì sáng.', meaning: 'Bạn bè xung quanh ảnh hưởng tới ta.' },
    { text: 'Nước chảy đá mòn.', meaning: 'Bền bỉ từng chút sẽ làm được việc lớn.' },
    { text: 'Một điều nhịn, chín điều lành.', meaning: 'Nhường nhịn giữ được hòa khí.' },
    { text: 'Ai ơi bưng bát cơm đầy, dẻo thơm một hạt đắng cay muôn phần.', meaning: 'Trân trọng công sức của người làm ra hạt gạo.' },
    { text: 'Công cha như núi Thái Sơn, nghĩa mẹ như nước trong nguồn chảy ra.', meaning: 'Biết ơn và hiếu thảo với cha mẹ.' },
    { text: 'Chớ thấy sóng cả mà ngã tay chèo.', meaning: 'Đừng nản lòng trước khó khăn.' },
    { text: 'Học ăn, học nói, học gói, học mở.', meaning: 'Học cách cư xử khéo léo trong mọi việc.' },
  ],
  en: [
    { text: 'When you drink water, remember its source.', meaning: 'Be grateful to those who gave you something good.' },
    { text: 'When you eat the fruit, remember who planted the tree.', meaning: 'Remember the work of those who came before.' },
    { text: 'The whole leaf wraps the torn one.', meaning: 'Help those who are struggling more than you.' },
    { text: 'One tree is not a forest; three trees together make a mountain.', meaning: 'Together we can do great things.' },
    { text: 'Grind an iron bar long enough and it becomes a needle.', meaning: 'Patience turns hard work into results.' },
    { text: 'Kind words cost nothing, so choose them well.', meaning: 'Speak gently and kindly.' },
    { text: 'Travel a day, gain a basket of wisdom.', meaning: 'Every experience teaches something new.' },
    { text: 'Good wood beats good paint.', meaning: 'What is inside matters more than looks.' },
    { text: 'Love others as you love yourself.', meaning: 'Treat others as you would treat yourself.' },
    { text: 'Near ink you turn black; near a lamp you shine.', meaning: 'The people around us shape us.' },
    { text: 'Flowing water wears down stone.', meaning: 'Small, steady effort achieves big things.' },
    { text: 'Hold back once, and nine good things follow.', meaning: 'Patience keeps the peace.' },
    { text: 'Each soft grain in your full bowl holds much hard work.', meaning: 'Value the work of those who grow our food.' },
    { text: "A father's care is a mountain; a mother's love, a spring that never runs dry.", meaning: 'Be grateful to your parents.' },
    { text: "Don't drop the oars at the sight of big waves.", meaning: "Don't lose heart in hard times." },
    { text: 'Learn how to eat, how to speak, how to wrap and how to unwrap.', meaning: 'Learn to act with care and tact.' },
  ],
};

export interface Riddle {
  q: string;
  options: string[];
  /** index into options */
  answer: number;
}
const RIDDLES: Record<Lang, Riddle[]> = {
  vi: [
    { q: 'Không sơn mà đỏ, không gõ mà kêu, không khều mà rụng. Là những gì?', options: ['Mặt trời, sấm, mưa', 'Hoa, chuông, lá', 'Lửa, gió, quả', 'Trăng, mõ, sương'], answer: 0 },
    { q: 'Cái gì đi thì nằm, đứng cũng nằm, mà nằm lại đứng?', options: ['Bàn chân', 'Con rắn', 'Cái giường', 'Bóng cây'], answer: 0 },
    { q: 'Cái gì của bạn nhưng người khác dùng nhiều hơn bạn?', options: ['Tên của bạn', 'Đôi dép', 'Chiếc ô', 'Cái bút'], answer: 0 },
    { q: 'Cái gì luôn đến nhưng không bao giờ tới?', options: ['Ngày mai', 'Cơn gió', 'Tiếng chuông', 'Con thuyền'], answer: 0 },
    { q: 'Cái gì có nhiều răng nhưng không bao giờ cắn?', options: ['Cái lược', 'Con cá sấu', 'Cái cưa', 'Bánh xe'], answer: 0 },
    { q: 'Cái gì càng lấy đi càng to ra?', options: ['Cái hố', 'Đống cát', 'Ngọn nến', 'Quả bóng'], answer: 0 },
    { q: 'Cái gì ướt sũng khi làm khô người khác?', options: ['Chiếc khăn', 'Cơn gió', 'Mặt trời', 'Cái quạt'], answer: 0 },
    { q: 'Hình con cá mà không phải cá, gõ vào kêu cốc cốc, dùng để giữ nhịp. Là gì?', options: ['Cái mõ', 'Cái trống', 'Cái chuông', 'Cái kẻng'], answer: 0 },
    { q: 'Đứng thẳng một mình, càng cháy càng ngắn, tỏa khói thơm. Là gì?', options: ['Nén hương', 'Cây nến', 'Que diêm', 'Ngọn đuốc'], answer: 0 },
    { q: 'Treo cao lặng lẽ, đánh vào thì ngân vang, cả xóm cùng nghe. Là gì?', options: ['Quả chuông', 'Cái đèn lồng', 'Cái mõ', 'Lá cờ'], answer: 0 },
    { q: 'Có mặt mà không có mắt, có kim mà không khâu, ngày đêm đi mãi. Là gì?', options: ['Đồng hồ', 'La bàn', 'Cái gương', 'Con thoi'], answer: 0 },
    { q: 'Cái gì đi khắp thế giới mà vẫn nằm yên ở một góc?', options: ['Con tem', 'Tấm bản đồ', 'Cái va li', 'Đám mây'], answer: 0 },
  ],
  en: [
    { q: 'Red without paint, it calls without being struck, and falls without being shaken. What are they?', options: ['The sun, thunder, rain', 'A flower, a bell, a leaf', 'Fire, wind, fruit', 'The moon, a drum, dew'], answer: 0 },
    { q: 'It lies down when walking, lies down when standing, and stands up when lying down. What is it?', options: ['Your foot', 'A snake', 'A bed', 'A shadow'], answer: 0 },
    { q: 'What belongs to you, yet others use it more than you do?', options: ['Your name', 'Your sandals', 'Your umbrella', 'Your pen'], answer: 0 },
    { q: 'What is always coming but never arrives?', options: ['Tomorrow', 'The wind', 'The bell', 'A boat'], answer: 0 },
    { q: 'What has many teeth but never bites?', options: ['A comb', 'A crocodile', 'A saw', 'A wheel'], answer: 0 },
    { q: 'The more you take away, the bigger it gets. What is it?', options: ['A hole', 'A pile of sand', 'A candle', 'A ball'], answer: 0 },
    { q: 'What gets wet while drying others?', options: ['A towel', 'The wind', 'The sun', 'A fan'], answer: 0 },
    { q: 'Shaped like a fish but not a fish, it goes "tock tock" when struck and keeps the rhythm. What is it?', options: ['A wooden fish', 'A drum', 'A bell', 'A gong'], answer: 0 },
    { q: 'It stands alone, grows shorter as it burns, and gives off a fragrant smoke. What is it?', options: ['An incense stick', 'A candle', 'A match', 'A torch'], answer: 0 },
    { q: 'It hangs quietly up high; strike it and the whole village hears. What is it?', options: ['A bell', 'A lantern', 'A wooden fish', 'A flag'], answer: 0 },
    { q: 'It has a face but no eyes, hands but no fingers, and walks day and night. What is it?', options: ['A clock', 'A compass', 'A mirror', 'A shuttle'], answer: 0 },
    { q: 'What travels around the world while staying in a corner?', options: ['A stamp', 'A map', 'A suitcase', 'A cloud'], answer: 0 },
  ],
};

const pick = <T>(a: T[], not?: number): [T, number] => {
  let i = Math.floor(Math.random() * a.length);
  if (a.length > 1 && i === not) i = (i + 1) % a.length;
  return [a[i], i];
};

/**
 * The big collections live in JSON next to this file and are fetched the first time a visitor
 * opens one of the plaza panels (keeps the first load light). Until then, and if a fetch
 * fails, the short built-in lists above are used. Merged without duplicates.
 */
let loading: Promise<void> | null = null;
export function loadContent(): Promise<void> {
  loading ??= (async () => {
    const add = <T>(into: T[], more: T[] | undefined, key: (x: T) => string) => {
      if (!Array.isArray(more)) return;
      const seen = new Set(into.map(key));
      for (const x of more) {
        const k = key(x);
        if (!seen.has(k)) {
          seen.add(k);
          into.push(x);
        }
      }
    };
    const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const [w, sy, rd] = await Promise.allSettled([import('./data/wishes.json'), import('./data/sayings.json'), import('./data/riddles.json')]);
    for (const l of ['vi', 'en'] as const) {
      if (w.status === 'fulfilled') add(WISHES[l], (w.value.default as Record<Lang, string[]>)[l]?.filter((x) => typeof x === 'string' && x.trim()), norm);
      if (sy.status === 'fulfilled')
        add(SAYINGS[l], (sy.value.default as Record<Lang, Saying[]>)[l]?.filter((x) => x?.text && x?.meaning), (x) => norm(x.text));
      if (rd.status === 'fulfilled')
        add(
          RIDDLES[l],
          (rd.value.default as Record<Lang, { q: string; options: string[] }[]>)[l]
            ?.filter((x) => x?.q && Array.isArray(x.options) && x.options.length >= 2 && new Set(x.options).size === x.options.length)
            .map((x) => ({ q: x.q, options: x.options.slice(0, 4), answer: 0 })),
          (x) => norm(x.q),
        );
    }
  })();
  return loading;
}

export const randomWish = (l: Locale, not?: number) => pick(WISHES[lang(l)], not);
export const randomSaying = (l: Locale, not?: number) => pick(SAYINGS[lang(l)], not);

/** A riddle with its options shuffled (the stored answer is always option 0). */
export function randomRiddle(l: Locale, not?: number): [Riddle, number] {
  const [r, i] = pick(RIDDLES[lang(l)], not);
  const order = r.options.map((_, k) => k).sort(() => Math.random() - 0.5);
  return [{ q: r.q, options: order.map((k) => r.options[k]), answer: order.indexOf(r.answer) }, i];
}
