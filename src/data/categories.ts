import type { Category } from '../types/game'

export const categories: Category[] = [
  { id: 'film', name: '電影與戲劇', englishName: 'FILM & TV', symbol: '🎬', description: '大銀幕、小螢幕，都是熟悉的面孔。', color: 'peach' },
  { id: 'music', name: '音樂人物', englishName: 'MUSIC', symbol: '♫', description: '聽過他的歌，也認得他的臉嗎？', color: 'yellow' },
  { id: 'sports', name: '體壇明星', englishName: 'SPORTS', symbol: '🏀', description: '球場上的傳奇，這次換你上場。', color: 'green' },
  { id: 'science', name: '科學與歷史', englishName: 'SCIENCE & HISTORY', symbol: '🪐', description: '那些改變世界、值得記住的人。', color: 'blue' },
  { id: 'art', name: '藝術與文學', englishName: 'ART & LITERATURE', symbol: '🎨', description: '從畫布到書頁，尋找創作的靈魂。', color: 'purple' },
  { id: 'world', name: '世界名人', englishName: 'WORLD FIGURES', symbol: '🌏', description: '跨越國界，一起認識世界的面孔。', color: 'pink' },
]
