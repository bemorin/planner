import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HELP_PARAM, addressWithoutHelp, asksForHelp, helpOnLaunch, openHelpFromAddress } from '../src/features/help-link.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('?help asks for How it works, with or without a value', () => {
  assert.equal(HELP_PARAM, 'help');
  assert.equal(asksForHelp('?help'), true);
  assert.equal(asksForHelp('?help='), true);
  assert.equal(asksForHelp('?ref=COACH_ANNA&help=1'), true);
  assert.equal(asksForHelp('?helpful=1'), false);
  assert.equal(asksForHelp('?license=abc'), false);
  assert.equal(asksForHelp(''), false);
  assert.equal(asksForHelp(undefined), false);
});

test('?help leaves the address; the rest of the query and the hash stay', () => {
  assert.equal(addressWithoutHelp('https://planner.bemorin.com/?help'), '/');
  assert.equal(addressWithoutHelp('https://planner.bemorin.com/?help&ref=COACH_ANNA#today'), '/?ref=COACH_ANNA#today');
  assert.equal(addressWithoutHelp('https://planner.bemorin.com/index.html?ref=A&help=1'), '/index.html?ref=A');
});

test('first-run setup comes first: Help opens only on a planner already set up', () => {
  assert.equal(helpOnLaunch('?help'), 'help');
  assert.equal(helpOnLaunch('?help', { firstRun: true }), 'setup', 'setup, then the tour, which ends on How it works');
  // 1.39: an old licence or gift parameter opens nothing, so Help still opens.
  assert.equal(helpOnLaunch('?help&license=abc'), 'help');
  assert.equal(helpOnLaunch('', { firstRun: true }), 'none');
});

test('the planner opens Help once and takes ?help out of the address, so a reload opens the planner as usual', () => {
  const page = (href, state = { from: 'app' }) => {
    const url = new URL(href);
    const calls = [];
    return {
      calls,
      location: { href, search: url.search },
      history: { state, replaceState: (...args) => calls.push(args) }
    };
  };
  let opened = 0;
  const open = () => { opened += 1; };

  const asked = page('https://planner.bemorin.com/?help&ref=COACH_ANNA');
  assert.equal(openHelpFromAddress({ open, location: asked.location, history: asked.history }), 'help');
  assert.equal(opened, 1);
  assert.deepEqual(asked.calls, [[{ from: 'app' }, '', '/?ref=COACH_ANNA']], 'its history state kept');

  const firstRun = page('https://planner.bemorin.com/?help');
  assert.equal(openHelpFromAddress({ open, firstRun: true, location: firstRun.location, history: firstRun.history }), 'setup');
  assert.equal(opened, 1, 'not on a first run');
  assert.deepEqual(firstRun.calls.map(call => call[2]), ['/'], 'still taken out of the address');

  const plain = page('https://planner.bemorin.com/?ref=COACH_ANNA');
  assert.equal(openHelpFromAddress({ open, location: plain.location, history: plain.history }), 'none');
  assert.deepEqual(plain.calls, [], 'any other address is left alone');

  const locked = page('https://planner.bemorin.com/?help');
  locked.history.replaceState = () => { throw new Error('SecurityError'); };
  assert.equal(openHelpFromAddress({ open, location: locked.location, history: locked.history }), 'help', 'a refused replaceState never stops Help');
  assert.equal(opened, 2);
});

test('the planner reads ?help on the frame of first-run setup, and opens How it works with focus inside', () => {
  const app = read('app.js');
  assert.match(app, /import \{ openHelpFromAddress \} from '\.\/src\/features\/help-link\.js';/);
  assert.match(app, /const firstRun = onboarding\.maybeOpen\(\);\n {4}openHelpFromAddress\(\{ firstRun, open: \(\) => \{ const help = qs\('\[data-help-modal\]'\); updateStorageUsage\(\); openModal\(help, qs\('\.modal__close', help\)\); \} \}\);/);
  // …before the entrance's first frame, which then finds a dialog open and steps aside (showPlanner never holds
  // the planner back for the opening seal when ?help asks for a dialog: src/features/app-entrance.js).
  assert.ok(app.indexOf('openHelpFromAddress({') < app.indexOf('showPlanner({'));
  assert.match(read('src/features/app-entrance.js'), /const arriving = dialog \|\| asksForHelp\(search\);/);
  assert.match(read('src/features/app-entrance.js'), /const opened = !!doc\.querySelector\('\.modal:not\(\[hidden\]\)'\);/);
  assert.match(read('sw.js'), /'\.\/src\/features\/help-link\.js'/, 'offline too');
});

test('“Help in the planner” on the Contact page opens the planner on How it works', () => {
  const page = read('contact/index.html');
  const link = /<a class="ct-link" href="([^"]+)"[^>]*>\s*<span class="ct-link__icon" aria-hidden="true"><svg class="i"><use href="#i-help"\/><\/svg><\/span>\s*<span class="ct-link__text"><b>Help in the planner<\/b>/.exec(page);
  assert.ok(link, 'the link is there');
  assert.equal(link[1], '../?help');
});

test('the landing page’s FAQ points to the same Help', () => {
  assert.match(read('welcome/index.html'), /<a href="\.\.\/\?help" data-cta="app">The planner’s own Help page<\/a>/);
});

test('a dialog that opens over another as the planner loads keeps the focus', () => {
  // openModal moves focus into its dialog a moment later: only while that dialog is still the one on top.
  // It goes to the control named, else the dialog's title (src/ui/dialog-focus.js, 1.35).
  assert.match(read('app.js'), /setTimeout\(\(\) => \{ if \(activeModal === modal\) focusDialog\(qs\('\.modal__panel', modal\), focusTarget\); \}, 80\);/);
});
