const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

// Check index.html references
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const re = /src="(\.\/[^"?]+)"|href="(\.\/[^"?]+)"/g;
let m;
const missing = [];
while ((m = re.exec(indexHtml)) !== null) {
  const rel = m[1] || m[2];
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    missing.push(`${rel} (full: ${file})`);
  }
}

// Check admin.html references
const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const re2 = /src="(\.\/[^"?]+)"|href="(\.\/[^"?]+)"/g;
while ((m = re2.exec(adminHtml)) !== null) {
  const rel = m[1] || m[2];
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    missing.push(`${rel} (full: ${file})`);
  }
}

// Check all CSS files referenced by HTML exist
// Also check if SW shell files exist
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const shellRe = /'\.\/([^']+)'/g;
while ((m = shellRe.exec(sw)) !== null) {
  const rel = m[1];
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    missing.push(`SW SHELL: ${rel} (full: ${file})`);
  }
}

if (missing.length === 0) {
  console.log('All referenced files exist');
} else {
  console.log('MISSING FILES:');
  missing.forEach(f => console.log('  ' + f));
}
