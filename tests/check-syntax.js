// Validates that every inline <script> in index.html parses, without executing any of it.
//
// This used to call html.indexOf('<script>'), which found only the first block and only
// if it carried no attributes. index.html opens with a small bootstrap block, so the
// check reported "OK (1,154 chars parsed)" while the megabyte of application code that
// follows went unparsed. A syntax error in the app itself sailed through green.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');

// Attributes may carry '>' inside a quoted value, so the opening tag is matched with the
// quotes understood rather than by scanning to the first '>'.
const OPEN = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;

function attr(raw, name) {
  const m = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(raw);
  if (!m) return null;
  return (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]) || '';
}

// Anything that is not executable JavaScript to the browser is not ours to parse:
// external files have no inline body, and templates/JSON blocks are data.
const JS_TYPES = ['', 'text/javascript', 'application/javascript', 'module', 'text/ecmascript', 'application/ecmascript'];

const blocks = [];
let m;
while ((m = OPEN.exec(html)) !== null) {
  const raw = m[1] || '';
  const bodyStart = m.index + m[0].length;
  const bodyEnd = html.indexOf('</script', bodyStart);
  if (bodyEnd === -1) {
    console.error('check-syntax: unclosed <script> at offset ' + m.index);
    process.exit(1);
  }
  OPEN.lastIndex = bodyEnd;
  const line = html.slice(0, m.index).split('\n').length;
  if (attr(raw, 'src') !== null) { blocks.push({ line, skipped: 'external src' }); continue; }
  const type = (attr(raw, 'type') || '').trim().toLowerCase();
  if (JS_TYPES.indexOf(type) === -1) { blocks.push({ line, skipped: 'type=' + type }); continue; }
  // ES modules need vm.SourceTextModule, which only exists under --experimental-vm-modules.
  // Say plainly that the block went unchecked rather than failing it for the wrong reason.
  if (type === 'module' && typeof vm.SourceTextModule !== 'function') {
    blocks.push({ line, skipped: 'type=module, needs node --experimental-vm-modules' });
    continue;
  }
  blocks.push({ line, code: html.slice(bodyStart, bodyEnd), module: type === 'module' });
}

if (!blocks.length) {
  console.error('check-syntax: could not locate any <script> block');
  process.exit(1);
}

let parsed = 0, chars = 0, failed = 0;
for (const b of blocks) {
  if (b.skipped) { console.log('check-syntax: line ' + b.line + ' skipped (' + b.skipped + ')'); continue; }
  try {
    // Compiles (parses) the script; throws SyntaxError on invalid JS. Does not run it.
    if (b.module) new vm.SourceTextModule(b.code, { identifier: 'index.html:' + b.line });
    else new vm.Script(b.code, { filename: 'index.html:' + b.line });
    parsed++; chars += b.code.length;
    console.log('check-syntax: line ' + b.line + ' OK (' + b.code.length.toLocaleString('en-US') + ' chars)');
  } catch (e) {
    failed++;
    console.error('check-syntax: line ' + b.line + ' FAILED — ' + e.message);
  }
}

// The whole point of the rewrite: if the big block ever stops being found, say so loudly
// rather than passing on a bootstrap stub.
const BIGGEST = Math.max.apply(null, blocks.filter(b => b.code).map(b => b.code.length).concat([0]));
if (!failed && BIGGEST < 100000) {
  console.error('check-syntax: FAILED — largest parsed block is only ' + BIGGEST +
    ' chars; the application script was not found. Refusing to report a pass.');
  process.exit(1);
}

if (failed) process.exit(1);
console.log('check-syntax: OK (' + parsed + ' inline block(s), ' + chars.toLocaleString('en-US') + ' chars parsed)');
