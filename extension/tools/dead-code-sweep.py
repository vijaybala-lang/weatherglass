#!/usr/bin/env python3
"""tools/dead-code-sweep.py -- the mechanical half of release step 0.

Finds shipped code with no consumer:
  * exported names (declarations and `export {}` forms) referenced by
    no other shipped module and no test/tool;
  * module-scope consts referenced nowhere (their own definition is
    the only hit);
  * imports (named and default) never referenced again in the file.
Exports consumed only by tests/tools are the lock pattern in this
codebase (the certification matrix grades them) -- reported as NOTE,
not failure. Anything with NO consumer anywhere fails (exit 1).

Born of the integer-10 audit: a grep-loop snippet in the skill
covered only `export function|const|...` declarations and missed
both real finds -- a dead `N_` const in prefs.js and an unused
`sceneFor` import in extension.js, each shipped since before
serial 16. This script is the maintained form of that sweep.

Run from the extension root:  python3 tools/dead-code-sweep.py
Optional arg: another extension root to sweep (e.g. a worktree).
"""

import glob
import os
import re
import sys


def refs(name, text):
    return len(re.findall(r'(?<![A-Za-z0-9_$])' + re.escape(name) +
                          r'(?![A-Za-z0-9_$])', text))


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    shipped = sorted(glob.glob(os.path.join(root, '*.js')))
    if not shipped:
        print(f'dead-code-sweep: no shipped modules under {root}',
              file=sys.stderr)
        return 2
    src = {os.path.basename(f): open(f).read() for f in shipped}
    tests_tools = ''
    for pattern in ('tests/*.mjs', 'tools/*.mjs', 'tools/**/*.js'):
        for f in glob.glob(os.path.join(root, pattern), recursive=True):
            tests_tools += open(f).read() + '\n'
    everything = '\n'.join(src.values()) + '\n' + tests_tools

    failures = []
    notes = []

    # exported names with no consumer outside their own file
    for fname, code in src.items():
        names = set(re.findall(
            r'export\s+(?:function|const|let|class)\s+(\w+)', code))
        for group in re.findall(r'export\s*\{([^}]+)\}', code):
            for part in group.split(','):
                if part.strip():
                    names.add(part.strip().split(' as ')[-1].strip())
        others = '\n'.join(c for k, c in src.items() if k != fname)
        for name in sorted(names):
            if refs(name, others):
                continue
            if refs(name, tests_tools):
                notes.append(f'{fname}: {name} (tests/tools only)')
            elif refs(name, code) < 2:
                failures.append(f'{fname}: export {name} has no consumer')

    # module-scope consts and imports referenced nowhere at all
    # (a single hit is the definition/import itself). Plain consts are
    # file-scoped, so they are judged in their own file only -- counting
    # corpus-wide let menu.js's live N_ mask prefs.js's dead one, the
    # exact find this tool exists to catch.
    for fname, code in src.items():
        for name in re.findall(
                r'^const ([A-Za-z_$][A-Za-z0-9_$]*)', code, re.M):
            if refs(name, code) < 2:
                failures.append(f'{fname}: const {name} is never used')
        imported = []
        for group in re.findall(r'import\s*\{([^}]+)\}\s*from', code, re.S):
            for part in group.split(','):
                if part.strip():
                    imported.append(part.strip().split(' as ')[-1].strip())
        imported += re.findall(r'import\s+(\w+)\s+from', code)
        for name in imported:
            if refs(name, code) < 2:
                failures.append(f'{fname}: import {name} is never used')

    for note in notes:
        print(f'NOTE {note}')
    for failure in failures:
        print(f'DEAD {failure}')
    print(f'dead-code-sweep: {len(shipped)} shipped modules, '
          f'{len(failures)} dead, {len(notes)} test-only exports')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
