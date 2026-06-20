const RESERVED_ROOTS = new Set(['project', 'sifli-sdk', 'customer', 'drivers', 'middleware', 'rtos'])

export function normalizeHuangshanAppName(input) {
  const ascii = String(input || '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!ascii || !/[A-Za-z]/.test(ascii)) return 'App'
  return ascii
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('_')
}

export function normalizeHuangshanAppId(input) {
  const id = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!id) return 'app'
  return /^[a-z]/.test(id) ? id : `app_${id}`
}

function normalizePath(path) {
  return String(path || '').trim().replace(/\\/g, '/').replace(/^['"`]+|['"`]+$/g, '')
}

function cStringLiteral(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
}

function asciiText(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || fallback
}

export function validateHuangshanAppFiles(files = {}, { appName } = {}) {
  const appDir = `src/gui_apps/${appName || 'App'}`
  const accepted = {}
  const rejected = []

  for (const [rawPath, content] of Object.entries(files || {})) {
    const path = normalizePath(rawPath)
    const first = path.split('/')[0]
    if (!path || path.startsWith('/') || path.split('/').includes('..')) {
      rejected.push({ path: rawPath, reason: 'unsafe-path' })
    } else if (RESERVED_ROOTS.has(first)) {
      rejected.push({ path: rawPath, reason: 'project-config-not-allowed' })
    } else if (!path.startsWith(`${appDir}/`)) {
      rejected.push({ path: rawPath, reason: 'outside-active-app' })
    } else if (!/\.(c|h)$/.test(path) && !path.endsWith('/SConscript')) {
      rejected.push({ path: rawPath, reason: 'unsupported-file-type' })
    } else {
      accepted[path] = String(content || '')
    }
  }

  return {
    ok: rejected.length === 0,
    accepted,
    rejected,
    message: rejected.map(item => `${item.path}: ${item.reason}`).join('\n'),
  }
}

export function createHuangshanAppFiles({ displayName = 'Codex App', description = 'Generated Huangshan LVGL app.' } = {}) {
  const safeDisplayName = asciiText(displayName, 'Codex App')
  const safeDescriptionText = asciiText(description, 'Generated Huangshan LVGL app.')
  const appName = normalizeHuangshanAppName(safeDisplayName)
  const appId = normalizeHuangshanAppId(safeDisplayName)
  const tag = appName
  const baseDir = `src/gui_apps/${appName}`
  const safeDescription = cStringLiteral(safeDescriptionText)

  return {
    [`${baseDir}/SConscript`]: `from building import *
import rtconfig

cwd = GetCurrentDir()

src = Glob('*.c')
inc = [cwd]

LOCAL_CCFLAGS = ''

group = DefineGroup('App_watch_demo', src, depend = [''], CPPPATH = inc, LOCAL_CCFLAGS = LOCAL_CCFLAGS)

Return('group')
`,
    [`${baseDir}/main.c`]: `#include <rtthread.h>
#include "lvgl.h"
#include "gui_app_fwk.h"
#include "lv_ext_resource_manager.h"
#include "lv_ex_data.h"

#define APP_ID "${appId}"

typedef struct
{
    lv_obj_t *root;
    lv_obj_t *status_label;
    lv_timer_t *timer;
    uint32_t tick_count;
} ${appId}_state_t;

static ${appId}_state_t g_state;

static void timer_cb(lv_timer_t *timer)
{
    ${appId}_state_t *state = (${appId}_state_t *)timer->user_data;
    state->tick_count++;
    if (state->status_label)
    {
        lv_label_set_text_fmt(state->status_label, "${appName}: %lu", state->tick_count);
    }
}

static void back_event_cb(lv_event_t *event)
{
    if (LV_EVENT_CLICKED == lv_event_get_code(event))
    {
        rt_kprintf("[${tag}] back to Main\\n");
        gui_app_run("Main");
    }
}

static void on_start(void)
{
    rt_memset(&g_state, 0, sizeof(g_state));

    g_state.root = lv_obj_create(lv_scr_act());
    lv_obj_set_size(g_state.root, LV_HOR_RES_MAX, LV_VER_RES_MAX);
    lv_obj_clear_flag(g_state.root, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(g_state.root, lv_color_hex(0x101820), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_bg_opa(g_state.root, LV_OPA_COVER, LV_PART_MAIN | LV_STATE_DEFAULT);

    lv_obj_t *back_btn = lv_btn_create(g_state.root);
    lv_obj_set_size(back_btn, 72, 36);
    lv_obj_align(back_btn, LV_ALIGN_TOP_LEFT, 12, 16);
    lv_obj_add_event_cb(back_btn, back_event_cb, LV_EVENT_CLICKED, RT_NULL);

    lv_obj_t *back_label = lv_label_create(back_btn);
    lv_label_set_text(back_label, "Back");
    lv_obj_center(back_label);

    lv_obj_t *title = lv_label_create(g_state.root);
    lv_label_set_text(title, "${safeDescription}");
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 64);

    g_state.status_label = lv_label_create(g_state.root);
    lv_label_set_text(g_state.status_label, "${appName}: ready");
    lv_obj_align(g_state.status_label, LV_ALIGN_CENTER, 0, 0);

    g_state.timer = lv_timer_create(timer_cb, 1000, &g_state);
    rt_kprintf("[${tag}] start\\n");
}

static void on_resume(void)
{
    rt_kprintf("[${tag}] resume\\n");
}

static void on_pause(void)
{
    rt_kprintf("[${tag}] pause\\n");
}

static void on_stop(void)
{
    if (g_state.timer)
    {
        lv_timer_del(g_state.timer);
        g_state.timer = RT_NULL;
    }
    if (g_state.root)
    {
        lv_obj_del(g_state.root);
        g_state.root = RT_NULL;
    }
    rt_kprintf("[${tag}] stop\\n");
}

static void msg_handler(gui_app_msg_type_t msg, void *param)
{
    switch (msg)
    {
    case GUI_APP_MSG_ONSTART:
        on_start();
        break;
    case GUI_APP_MSG_ONRESUME:
        on_resume();
        break;
    case GUI_APP_MSG_ONPAUSE:
        on_pause();
        break;
    case GUI_APP_MSG_ONSTOP:
        on_stop();
        break;
    default:
        break;
    }
}

LV_IMG_DECLARE(img_LiChuang);
BUILTIN_APP_EXPORT(LV_EXT_STR_ID(lckfb), LV_EXT_IMG_GET(img_LiChuang), APP_ID, msg_handler);
`,
  }
}
