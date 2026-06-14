// Validates that the inline <script> in index.html parses, without executing it.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');

const start = html.indexOf('<script>');
const end = html.indexOf('</script>', start);
if (start === -1 || end === -1) {
  console.error('check-syntax: could not locate the inline <script> block');
  process.exit(1);
}
const code = html.slice(start + '<script>'.length, end);

try {
  // Compiles (parses) the script; throws SyntaxError on invalid JS. Does not run it.
  new vm.Script(code, { filename: 'index.html#inline-script' });
  console.log('check-syntax: OK (' + code.length + ' chars parsed)');
} catch (e) {
  console.error('check-syntax: FAILED —', e.message);
  process.exit(1);
}
