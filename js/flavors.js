// Café Doux — вкусы макаронс для конструктора коробки.
// shell / cream — цвет скорлупки и начинки; null — исходная текстура модели (она и так малиновая).
export const FLAVORS = [
  { id: 'framboise', name: 'Framboise', ru: 'Малина и белый шоколад', shell: null, cream: null, swatch: '#E99AA8' },
  { id: 'pistache', name: 'Pistache', ru: 'Сицилийская фисташка', shell: 0xB7CF8E, cream: 0xE2E6C0, swatch: '#B7CF8E' },
  { id: 'chocolat', name: 'Chocolat', ru: 'Тёмный шоколад 70%', shell: 0x6E4433, cream: 0x4A2A1C, swatch: '#6E4433' },
  { id: 'vanille', name: 'Vanille', ru: 'Мадагаскарская ваниль', shell: 0xF1E3C8, cream: 0xFAF1DE, swatch: '#EFE0C2' },
  { id: 'citron', name: 'Citron', ru: 'Лимонный курд', shell: 0xF3D86A, cream: 0xF7EDB8, swatch: '#F3D86A' },
  { id: 'lavande', name: 'Lavande', ru: 'Лаванда и мёд', shell: 0xC5B0DD, cream: 0xEEE4F3, swatch: '#C5B0DD' },
];

// коробки: цена за коробку ниже, чем поштучно (220 ₽ × n)
export const BOXES = [
  { size: 6, cols: 3, rows: 2, price: 1250 },
  { size: 12, cols: 4, rows: 3, price: 2400 },
];
export const PIECE_PRICE = 220;
