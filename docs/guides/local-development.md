# Local Development

## Prerequisites

- Node.js with npm.
- Chrome or Edge for Web Serial testing.
- Docker if you need the ESP-IDF compiler service locally.
- Python only for compiler-service security tests.

Compiler-service Python tests import the Flask server module directly. Install
those dependencies in a repo-local virtual environment:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/compiler-service/requirements-dev.txt
```

## Start The Frontend

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

`localhost` is treated as a secure browser context, so Web Serial can be tested
locally over HTTP.

## Focused Test Commands

Core generation and project assembly:

```bash
npm run test:code-generation
npm run test:compile-package
npm run test:project-validation
npm run test:project-config
npm run test:program-manifest
```

Workflow and evidence:

```bash
npm run test:build-evidence
npm run test:device-evidence
npm run test:hardware-workflow
npm run test:workflow-compiler-adapter
```

Compiler and delivery guards:

```bash
npm run test:python-runner
npm run test:compiler-security
npm run test:official-examples-backend
npm run test:remote-ota-backend
npm run test:ble-ota-guard
```

Digital twin:

```bash
npm run test:digital-twin-scene
npm run test:digital-twin-interaction
npm run test:lvgl-runtime-package
npm run test:lvgl-sim-service
```

Huangshan workspace:

```bash
npm run test:huangshan-profile
npm run test:huangshan-app-template
npm run test:huangshan-app-builder
npm run test:huangshan-build-evidence
npm run test:huangshan-build-artifacts
npm run test:huangshan-workspace-files
npm run test:huangshan-device-actions
npm run test:huangshan-semantic-preview
npm run test:huangshan-real-preview
npm run test:huangshan-workspace-ui
```

Nordic workspace:

```bash
npm run test:nordic-app-template
npm run test:nordic-workspace-ui
npm run test:nordic-compiler-service
npm run test:nordic-compiler-service-config
npm run test:nordic-dfu-protocol
npm run test:nordic-dfu-ui
```

Build the browser app:

```bash
npm run build
```

## Local Files To Ignore

The following are local/generated and should not be committed:

- `node_modules/`
- `dist/`
- `*.log`
- `__pycache__/`
- exported zips or presentation drafts

See `.gitignore` for the current ignored paths.
