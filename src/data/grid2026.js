// 2026 F1 grid — 11 teams, 22 regular drivers.
// Race numbers use each driver's permanent number.
// colors: primary livery color / accent (approximate 2026 team identities).
// pace: relative AI performance (1.00 = front-runner), used by the AI
// opponents to scale corner speeds.

export const TEAMS = [
  {
    id: 'mclaren', name: 'マクラーレン', fullName: 'McLaren Formula 1 Team',
    pu: 'Mercedes', color: 0xff8000, accent: 0x47c7fc, dark: 0x1a1a1a,
    drivers: [
      { name: 'ランド・ノリス', en: 'Lando Norris', num: 4, abbr: 'NOR', pace: 1.00 },
      { name: 'オスカー・ピアストリ', en: 'Oscar Piastri', num: 81, abbr: 'PIA', pace: 1.00 },
    ],
  },
  {
    id: 'ferrari', name: 'フェラーリ', fullName: 'Scuderia Ferrari HP',
    pu: 'Ferrari', color: 0xe80020, accent: 0xfff200, dark: 0x111111,
    drivers: [
      { name: 'シャルル・ルクレール', en: 'Charles Leclerc', num: 16, abbr: 'LEC', pace: 0.99 },
      { name: 'ルイス・ハミルトン', en: 'Lewis Hamilton', num: 44, abbr: 'HAM', pace: 0.98 },
    ],
  },
  {
    id: 'redbull', name: 'レッドブル', fullName: 'Oracle Red Bull Racing',
    pu: 'Red Bull Ford', color: 0x16244e, accent: 0xfcd203, dark: 0x0a1130,
    drivers: [
      { name: 'マックス・フェルスタッペン', en: 'Max Verstappen', num: 33, abbr: 'VER', pace: 1.00 },
      { name: 'アイザック・ハジャー', en: 'Isack Hadjar', num: 6, abbr: 'HAD', pace: 0.97 },
    ],
  },
  {
    id: 'mercedes', name: 'メルセデス', fullName: 'Mercedes-AMG PETRONAS F1 Team',
    pu: 'Mercedes', color: 0x0c0c0c, accent: 0x27f4d2, dark: 0x000000,
    drivers: [
      { name: 'ジョージ・ラッセル', en: 'George Russell', num: 63, abbr: 'RUS', pace: 0.99 },
      { name: 'アンドレア・キミ・アントネッリ', en: 'Kimi Antonelli', num: 12, abbr: 'ANT', pace: 0.98 },
    ],
  },
  {
    id: 'astonmartin', name: 'アストンマーティン', fullName: 'Aston Martin Aramco F1 Team',
    pu: 'Honda', color: 0x229971, accent: 0xcedc00, dark: 0x0b3b2e,
    drivers: [
      { name: 'フェルナンド・アロンソ', en: 'Fernando Alonso', num: 14, abbr: 'ALO', pace: 0.98 },
      { name: 'ランス・ストロール', en: 'Lance Stroll', num: 18, abbr: 'STR', pace: 0.95 },
    ],
  },
  {
    id: 'alpine', name: 'アルピーヌ', fullName: 'BWT Alpine F1 Team',
    pu: 'Mercedes', color: 0x0093cc, accent: 0xfd4bc7, dark: 0x021f3a,
    drivers: [
      { name: 'ピエール・ガスリー', en: 'Pierre Gasly', num: 10, abbr: 'GAS', pace: 0.96 },
      { name: 'フランコ・コラピント', en: 'Franco Colapinto', num: 43, abbr: 'COL', pace: 0.95 },
    ],
  },
  {
    id: 'williams', name: 'ウィリアムズ', fullName: 'Atlassian Williams Racing',
    pu: 'Mercedes', color: 0x1868db, accent: 0x9fcfff, dark: 0x041e42,
    drivers: [
      { name: 'アレクサンダー・アルボン', en: 'Alexander Albon', num: 23, abbr: 'ALB', pace: 0.97 },
      { name: 'カルロス・サインツ', en: 'Carlos Sainz', num: 55, abbr: 'SAI', pace: 0.97 },
    ],
  },
  {
    id: 'racingbulls', name: 'レーシングブルズ', fullName: 'Visa Cash App Racing Bulls F1 Team',
    pu: 'Red Bull Ford', color: 0xf4f4f4, accent: 0x2b3a8f, dark: 0xcccccc,
    drivers: [
      { name: 'リアム・ローソン', en: 'Liam Lawson', num: 30, abbr: 'LAW', pace: 0.96 },
      { name: 'アービッド・リンドブラッド', en: 'Arvid Lindblad', num: 41, abbr: 'LIN', pace: 0.95 },
    ],
  },
  {
    id: 'audi', name: 'アウディ', fullName: 'Audi F1 Team',
    pu: 'Audi', color: 0xa6a6a6, accent: 0xbb0a30, dark: 0x2e2e2e,
    drivers: [
      { name: 'ニコ・ヒュルケンベルグ', en: 'Nico Hülkenberg', num: 27, abbr: 'HUL', pace: 0.96 },
      { name: 'ガブリエル・ボルトレート', en: 'Gabriel Bortoleto', num: 5, abbr: 'BOR', pace: 0.97 },
    ],
  },
  {
    id: 'haas', name: 'ハース', fullName: 'MoneyGram Haas F1 Team',
    pu: 'Ferrari', color: 0xe6e6e6, accent: 0xda291c, dark: 0x9c9fa2,
    drivers: [
      { name: 'エステバン・オコン', en: 'Esteban Ocon', num: 31, abbr: 'OCO', pace: 0.96 },
      { name: 'オリバー・ベアマン', en: 'Oliver Bearman', num: 87, abbr: 'BEA', pace: 0.97 },
    ],
  },
  {
    id: 'cadillac', name: 'キャデラック', fullName: 'Cadillac Formula 1 Team',
    pu: 'Ferrari', color: 0x101418, accent: 0xb89d5a, dark: 0x05070a,
    drivers: [
      { name: 'セルジオ・ペレス', en: 'Sergio Pérez', num: 11, abbr: 'PER', pace: 0.96 },
      { name: 'バルテリ・ボッタス', en: 'Valtteri Bottas', num: 77, abbr: 'BOT', pace: 0.95 },
    ],
  },
];

export function findDriver(teamId, driverIndex) {
  const team = TEAMS.find(t => t.id === teamId) ?? TEAMS[0];
  return { team, driver: team.drivers[driverIndex] ?? team.drivers[0] };
}
