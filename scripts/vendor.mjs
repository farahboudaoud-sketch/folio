// Copie epub.js, JSZip et les polices dans www/ (à relancer après une mise à jour des paquets).
import { copyFileSync, writeFileSync, existsSync } from 'node:fs';

copyFileSync('node_modules/epubjs/dist/epub.min.js', 'www/lib/epub.min.js');
copyFileSync('node_modules/jszip/dist/jszip.min.js', 'www/lib/jszip.min.js');

const fonts = [
  ['Literata', 'literata', [400, 600], ['normal', 'italic']],
  ['Inter', 'inter', [400, 500, 600], ['normal']],
  ['Source Serif', 'source-serif-4', [400, 600], ['normal', 'italic']],
  ['Atkinson Hyperlegible', 'atkinson-hyperlegible', [400, 700], ['normal', 'italic']],
];
let css = '';
for (const [family, pkg, weights, styles] of fonts) {
  for (const w of weights) for (const s of styles) for (const sub of ['latin', 'latin-ext']) {
    const name = `${pkg}-${sub}-${w}-${s}.woff2`;
    const src = `node_modules/@fontsource/${pkg}/files/${name}`;
    if (!existsSync(src)) continue;
    copyFileSync(src, `www/fonts/${name}`);
    css += `@font-face{font-family:'${family}';font-style:${s};font-weight:${w};font-display:swap;src:url('${name}') format('woff2');${sub === 'latin' ? '' : 'unicode-range:U+0100-02AF,U+0304,U+0308,U+0329,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;'}}\n`;
  }
}
writeFileSync('www/fonts/fonts.css', css);
console.log('ok');
