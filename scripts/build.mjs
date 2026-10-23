import fs from 'node:fs';
// Assets serves every file in dist. Never publish leftovers from an earlier build.
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist', { recursive: true });
for (const file of ['index.html', 'admin.html', 'style.css', 'frame.css', 'app.js', 'audio.js', 'engine.js', 'modes.js', 'six-seat.js', 'presentation.js', 'rules.js', 'selection.js', 'tutorial.js', 'admin.css', 'i18n.js', 'admin.js', 'usage-view.js', 'rankings.js', 'board-loader.js', 'branding.js', 'favicon.svg', '_headers']) fs.copyFileSync(file, `dist/${file}`);
console.log('Built static game in dist/');
