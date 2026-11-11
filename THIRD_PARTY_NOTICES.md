# Third-party notices

Daily Planner itself is by Ben Morin, released under the MIT licence (see `LICENSE` in the repository). It ships one third-party component, vendored in `src/vendor/`, and uses no web fonts of its own: its pages ask for Inter when the device has it and otherwise use the system font.

## Motion

- Component: Motion 13.4.2 — `animate` (mini, Web Animations API), `stagger`, `spring`
- Source: https://motion.dev · https://github.com/motiondivision/motion
- File: `src/vendor/motion.js` (rebuilt with `npm run vendor:motion`)

```text
The MIT License (MIT)

Copyright (c) 2024 [Motion](https://motion.dev) B.V.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Trademarks

Google Drive is a trademark of Google LLC, and Dropbox a trademark of Dropbox, Inc. Their logos in `assets/` only show which service Personal sync connects to; Daily Planner is not affiliated with either.
