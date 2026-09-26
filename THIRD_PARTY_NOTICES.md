# Third-party notices

Pi Console uses the following npm packages at runtime (versions from `package-lock.json` at the time of this notice). The Pi CLI is installed separately and is **not** included in this repository or package. Pet artwork is loaded from separately installed packages; no pet sprites are included here. This list does not grant rights to redistribute third-party artwork.

| Package | Version | License | Use |
| --- | --- | --- | --- |
| [react](https://github.com/facebook/react) | 19.3.0 | MIT | Browser UI |
| [react-dom](https://github.com/facebook/react) | 19.3.0 | MIT | Browser UI |
| [scheduler](https://github.com/facebook/react) | 0.28.0 | MIT | React dependency |
| [jose](https://github.com/panva/jose) | 6.2.12 | MIT | Access JWT verification |
| [tsx](https://github.com/privatenumber/tsx) | 4.23.15 | MIT | Server TypeScript runtime |
| [esbuild](https://github.com/evanw/esbuild) | 0.28.2 | MIT | tsx dependency |
| [@esbuild platform binaries](https://github.com/evanw/esbuild) | 0.28.2 | MIT | Optional platform-specific esbuild binary (e.g. `@esbuild/win32-x64`) |

The project also uses development-only tools (not shipped as application runtime dependencies), including Playwright (Apache-2.0), TypeScript (Apache-2.0) and Vite (MIT). Their own packages carry their respective license and notice files. When redistributing an npm installation, retain the licenses and notices in its installed dependencies. Recheck this inventory after dependency updates or when changing the packaging method.

## MIT notices for runtime packages

The MIT license text below applies to each runtime package listed above. Copyright statements from their installed license files:

- react, react-dom, scheduler: Copyright (c) Meta Platforms, Inc. and affiliates.
- jose: Copyright (c) 2018 Filip Skokan
- tsx: Copyright (c) Hiroki Osame <hiroki.osame@gmail.com>
- esbuild and its platform binaries: Copyright (c) 2020 Evan Wallace

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
