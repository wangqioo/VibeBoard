import assert from 'node:assert/strict'
import {
  summarizeNordicBuildFailure,
  stripAnsi,
} from '../src/utils/nordicCompiler.js'

assert.equal(stripAnsi('\u001b[31merror\u001b[0m'), 'error')

const gccLog = `
-- west build: building application
[24/264] Building C object CMakeFiles/app.dir/src/main.c.obj FAILED
/home/wq/build/src/main.c:27:27: error: 'BT_LE_ADV_CONN_NAME' undeclared (first use in this function); did you mean 'BT_LE_ADV_CONN_DIR'?
   27 |     err = bt_le_adv_start(BT_LE_ADV_CONN_NAME, NULL, 0, NULL, 0);
      |                           ^~~~~~~~~~~~~~~~~~~
ninja: build stopped: subcommand failed.
`

assert.deepEqual(summarizeNordicBuildFailure(gccLog), {
  title: "src/main.c:27: 'BT_LE_ADV_CONN_NAME' undeclared",
  category: 'c-compile',
  file: 'src/main.c',
  line: 27,
  detail: "'BT_LE_ADV_CONN_NAME' undeclared",
  suggestion: '检查生成模板或刷新前端静态包；这类错误通常是 Zephyr API 或模板代码不兼容。',
  excerpt: [
    "/home/wq/build/src/main.c:27:27: error: 'BT_LE_ADV_CONN_NAME' undeclared (first use in this function); did you mean 'BT_LE_ADV_CONN_DIR'?",
    '27 |     err = bt_le_adv_start(BT_LE_ADV_CONN_NAME, NULL, 0, NULL, 0);',
    '|                           ^~~~~~~~~~~~~~~~~~~',
  ].join('\n'),
})

const kconfigLog = `
warning: MCUMGR_GRP_IMG was assigned the value 'y' but got the value 'n'.
error: Aborting due to Kconfig warnings
`

assert.deepEqual(summarizeNordicBuildFailure(kconfigLog), {
  title: 'Kconfig 配置不满足：MCUMGR_GRP_IMG was assigned the value',
  category: 'kconfig',
  file: '',
  line: null,
  detail: "MCUMGR_GRP_IMG was assigned the value 'y' but got the value 'n'.",
  suggestion: '检查 prj.conf/sysbuild.conf 中的依赖配置，尤其是 FLASH、MCUmgr、MCUboot、board capability。',
  excerpt: [
    "warning: MCUMGR_GRP_IMG was assigned the value 'y' but got the value 'n'.",
    'error: Aborting due to Kconfig warnings',
  ].join('\n'),
})

const cmakeLog = `
CMake Error at /home/wq/ncs/zephyr/cmake/modules/kconfig.cmake:409 (message):
  command failed with return code: 1
Call Stack (most recent call first):
  CMakeLists.txt:2 (find_package)
`

assert.equal(summarizeNordicBuildFailure(cmakeLog).title, 'CMake 配置失败：/home/wq/ncs/zephyr/cmake/modules/kconfig.cmake:409')
assert.equal(summarizeNordicBuildFailure(cmakeLog).category, 'cmake')

const fallback = summarizeNordicBuildFailure('line 1\nline 2\nline 3')
assert.equal(fallback.title, 'Nordic 构建失败，查看完整日志')
assert.equal(fallback.category, 'unknown')
assert.equal(fallback.excerpt, 'line 1\nline 2\nline 3')

console.log('nordic build log summary tests passed')
