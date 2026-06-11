import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const nginx = readFileSync(new URL('../deploy/nginx.conf', import.meta.url), 'utf8')
const compose = readFileSync(new URL('../deploy/docker-compose.yml', import.meta.url), 'utf8')
const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')

assert.match(nginx, /Nordic nRF Connect SDK compiler service \(port 8772\)/)
assert.match(nginx, /location \/nordic\/\s*\{[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:8772\/nordic\//)
assert.match(compose, /nordic-compiler:/)
assert.match(compose, /image: nordic-compiler:latest/)
assert.match(compose, /container_name: nordic-compiler/)
assert.match(compose, /NORDIC_BUILD_BASE: \/tmp\/nordic-builds/)
assert.match(compose, /\/home\/wq\/vibeboard-nordic-build-cache\}:\/tmp\/nordic-builds/)
assert.match(vite, /'\/nordic':\s+'http:\/\/127\.0\.0\.1:8772'/)

console.log('nordic compiler service config tests passed')
