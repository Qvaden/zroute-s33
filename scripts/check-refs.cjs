var fs = require('fs');
var path = require('path');
var R = process.cwd();

function checkFile(htmlPath) {
  var html = fs.readFileSync(path.join(R, htmlPath), 'utf8');
  var re = /src="(\.\/[^"?]+)"/g;
  var m;
  var missing = [];
  while ((m = re.exec(html)) !== null) {
    var rel = m[1].split('?')[0];
    if (!fs.existsSync(path.join(R, rel))) missing.push(rel);
  }
  return missing;
}

var m1 = checkFile('index.html');
var m2 = checkFile('admin.html');

// SW shell
var sw = fs.readFileSync(path.join(R, 'sw.js'), 'utf8');
var sre = /'\.\/([^']+)'/g;
var sm;
var swMissing = [];
while ((sm = sre.exec(sw)) !== null) {
  if (!fs.existsSync(path.join(R, sm[1]))) swMissing.push(sm[1]);
}

var all = m1.concat(m2).concat(swMissing);
if (all.length === 0) {
  console.log('ALL OK');
} else {
  console.log('MISSING:');
  all.forEach(function(f) { console.log('  ' + f); });
}
